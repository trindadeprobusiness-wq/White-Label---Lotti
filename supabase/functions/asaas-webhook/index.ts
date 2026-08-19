import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Comparação em tempo constante via digests SHA-256 (evita timing attack no token)
async function tokenValido(fornecido: string | null, esperado: string): Promise<boolean> {
    if (!fornecido) return false;
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(fornecido)),
        crypto.subtle.digest('SHA-256', enc.encode(esperado)),
    ]);
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
    return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function admin() {
    return createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
}

/** Valor em reais → "R$ 1.840,00", para o texto da notificação. */
function moedaBR(v: unknown): string {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'R$ —';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Chave PIX de destino da transferência.
 *
 * O Asaas varia o formato conforme o tipo: PIX manda `pixAddressKey`, conta
 * bancária manda o objeto `bankAccount`. Procurar num campo só perderia
 * metade dos casos.
 */
function chaveDestino(transfer: Record<string, any>): string | null {
    return (
        transfer?.pixAddressKey ??
        transfer?.bankAccount?.pixAddressKey ??
        transfer?.bankAccount?.cpfCnpj ??
        transfer?.cpfCnpj ??
        null
    );
}

/**
 * Transferência do Asaas → baixa do repasse + notificação.
 *
 * Só DONE dá baixa. FAILED/CANCELLED devolvem o repasse para AGENDADO, porque
 * o dinheiro não saiu e ele precisa voltar para a fila do corretor.
 *
 * O que este código NÃO faz: escolher entre repasses candidatos. Quando a
 * conciliação é ambígua, registra a pendência e notifica — dar baixa no
 * repasse errado credita o proprietário errado, e isso não se desfaz com um
 * update.
 */
async function processarTransferencia(
    supabase: any,
    payload: any,
    event: string,
    eventRowId: string,
    finalize: (status: string, extra?: Record<string, unknown>) => Promise<void>,
) {
    const transfer = payload?.transfer;
    if (!transfer?.id) {
        await finalize('IGNORED');
        return;
    }

    const situacao = String(transfer.status ?? '').toUpperCase();
    const concluida = event === 'TRANSFER_DONE' || situacao === 'DONE';
    const falhou =
        event === 'TRANSFER_FAILED' ||
        event === 'TRANSFER_CANCELLED' ||
        ['FAILED', 'CANCELLED', 'BLOCKED'].includes(situacao);

    // Em trânsito (PENDING, BANK_PROCESSING): registra o estado e espera. Dar
    // baixa aqui marcaria como pago algo que ainda pode falhar.
    if (!concluida && !falhou) {
        await supabase
            .from('repasses_proprietario')
            .update({ transferencia_status: situacao, transferencia_payload: payload })
            .eq('external_id', transfer.id);
        await finalize('PROCESSED');
        return;
    }

    const { data: conciliacao } = await supabase.rpc('conciliar_transferencia_repasse', {
        _corretor_id: null,
        _transfer_id: transfer.id,
        _external_ref: transfer.externalReference ?? null,
        _valor: transfer.value ?? transfer.netValue ?? null,
        _chave_pix: chaveDestino(transfer),
    });

    const achado = Array.isArray(conciliacao) ? conciliacao[0] : conciliacao;
    const repasseId: string | null = achado?.repasse_id ?? null;
    const criterio: string = achado?.criterio ?? 'sem_correspondencia';

    if (!repasseId) {
        // Sem repasse identificado. Não é erro do Asaas nem falha nossa: pode
        // ser uma transferência que não é repasse. Fica registrado e o evento
        // não vira FAILED, para o sweeper não ficar reprocessando à toa.
        console.log(`transferência ${transfer.id} sem repasse (${criterio})`);
        await finalize('IGNORED', {
            last_error: `Transferência não conciliada: ${criterio}`,
        });
        return;
    }

    const { data: repasse } = await supabase
        .from('repasses_proprietario')
        .select('id, corretor_id, proprietario_nome, valor_liquido_repasse, status')
        .eq('id', repasseId)
        .maybeSingle();

    if (!repasse) {
        await finalize('FAILED', { last_error: `Repasse ${repasseId} sumiu entre a conciliação e a leitura` });
        return;
    }

    await supabase
        .from('asaas_webhook_events')
        .update({ corretor_id: repasse.corretor_id })
        .eq('id', eventRowId);

    const nome = repasse.proprietario_nome ?? 'proprietário';
    const valor = moedaBR(repasse.valor_liquido_repasse ?? transfer.value);

    if (concluida) {
        // Idempotente: se já está CONFIRMADO, o update não muda nada e o alerta
        // não é duplicado. O Asaas reentrega evento, e reentrega acontece.
        if (repasse.status === 'CONFIRMADO') {
            await finalize('IGNORED');
            return;
        }

        await supabase
            .from('repasses_proprietario')
            .update({
                status: 'CONFIRMADO',
                external_id: transfer.id,
                transferencia_status: situacao || 'DONE',
                transferencia_efetivada_em: new Date().toISOString(),
                data_transferencia: transfer.effectiveDate ?? transfer.dateCreated ?? new Date().toISOString(),
                transferencia_payload: payload,
                conciliacao_pendente: null,
            })
            .eq('id', repasse.id);

        await supabase.rpc('registrar_alerta_financeiro', {
            _corretor_id: repasse.corretor_id,
            _tipo: 'TRANSFERENCIA',
            _mensagem: `Repasse de ${valor} confirmado para ${nome}`,
            _entidade_tipo: 'repasse',
            _entidade_id: repasse.id,
            _metadata: {
                valor: repasse.valor_liquido_repasse,
                proprietario: nome,
                transfer_id: transfer.id,
                criterio_conciliacao: criterio,
            },
            _prioridade: 'MEDIA',
        });

        await supabase.from('auditoria_financeira').insert({
            corretor_id: repasse.corretor_id,
            entidade: 'repasses_proprietario',
            entidade_id: repasse.id,
            acao: 'TRANSFERENCIA_CONFIRMADA',
            dados_antes: { status: repasse.status },
            dados_depois: { status: 'CONFIRMADO', transfer_id: transfer.id },
            calculo: { criterio_conciliacao: criterio },
            origem: 'webhook',
            ator: 'asaas',
        });

        await finalize('PROCESSED');
        return;
    }

    // Falhou: o dinheiro não saiu. Volta para a fila e avisa com prioridade
    // alta — repasse parado é problema com o proprietário, não com o sistema.
    await supabase
        .from('repasses_proprietario')
        .update({
            status: 'ERRO',
            transferencia_status: situacao || 'FAILED',
            transferencia_payload: payload,
            conciliacao_pendente: `Transferência ${situacao || 'falhou'} no Asaas`,
        })
        .eq('id', repasse.id);

    await supabase.rpc('registrar_alerta_financeiro', {
        _corretor_id: repasse.corretor_id,
        _tipo: 'TRANSFERENCIA',
        _mensagem: `Repasse de ${valor} para ${nome} NÃO foi concluído`,
        _entidade_tipo: 'repasse',
        _entidade_id: repasse.id,
        _metadata: {
            valor: repasse.valor_liquido_repasse,
            proprietario: nome,
            transfer_id: transfer.id,
            status_asaas: situacao,
        },
        _prioridade: 'ALTA',
    });

    await finalize('PROCESSED');
}

// Processa um evento já persistido em asaas_webhook_events (roda em background).
async function processEvent(eventRowId: string) {
    const supabase = admin();

    // Claim: RECEIVED -> PROCESSING (evita corrida com o sweeper)
    const { data: claimed } = await supabase
        .from('asaas_webhook_events')
        .update({ status: 'PROCESSING' })
        .eq('id', eventRowId)
        .in('status', ['RECEIVED', 'FAILED'])
        .select('id, event_type, payload')
        .single();

    if (!claimed) return; // outro worker já pegou

    const payload = claimed.payload as any;
    const event = claimed.event_type as string;
    const payment = payload?.payment;

    const finalize = async (status: string, extra: Record<string, unknown> = {}) => {
        await supabase.from('asaas_webhook_events')
            .update({ status, processed_at: new Date().toISOString(), ...extra })
            .eq('id', eventRowId);
    };

    try {
        // Transferência (repasse ao proprietário). Antes caía no descarte
        // abaixo junto com "eventos sem payment" — o PIX saía, o Asaas avisava,
        // e o repasse continuava AGENDADO para sempre.
        if (event.startsWith('TRANSFER_')) {
            await processarTransferencia(supabase, payload, event, eventRowId, finalize);
            return;
        }

        // Demais eventos sem payment (tokens de API, checkout): nada a fazer
        if (!payment?.id) {
            await finalize('IGNORED');
            return;
        }

        // Resolve a fatura por external_id; fallback pelo externalReference (= fatura.id)
        let fatura: any = null;
        {
            const byExt = await supabase.from('faturas_aluguel')
                .select('*').eq('external_id', payment.id).maybeSingle();
            fatura = byExt.data;
            if (!fatura && payment.externalReference) {
                const byRef = await supabase.from('faturas_aluguel')
                    .select('*').eq('id', payment.externalReference).maybeSingle();
                fatura = byRef.data;
            }
        }

        if (!fatura) {
            // Nunca 200-e-esquece: fica FAILED para o sweeper reprocessar / alertar
            await finalize('FAILED', {
                attempts: 1,
                last_error: `Fatura não encontrada para payment ${payment.id}`,
            });
            return;
        }

        // Vincula corretor ao evento (para RLS/leitura por tenant)
        await supabase.from('asaas_webhook_events')
            .update({ corretor_id: fatura.corretor_id, payment_id: payment.id })
            .eq('id', eventRowId);

        // RECEIVED_IN_CASH cobre a baixa manual: a que o sistema faz ao clicar em
        // "Baixar" (aí a fatura já está PAGO e cai no dedup abaixo) e a que o corretor
        // faz direto no painel do Asaas — que antes não chegava até aqui.
        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED_IN_CASH') {
            if (fatura.status === 'PAGO') {
                await finalize('IGNORED'); // dedup de negócio (CONFIRMED + RECEIVED)
                return;
            }
            // Marca PAGO — o trigger handle_bill_payment() cria o repasse + lançamento + auditoria.
            // (Este webhook NÃO cria repasse: fonte única é o trigger do banco.)
            await supabase.from('faturas_aluguel').update({
                status: 'PAGO',
                valor_pago: payment.value,
                data_pagamento: payment.paymentDate,
                data_credito: payment.creditDate,
                asaas_status: payment.status,
                recibo_url: payment.transactionReceiptUrl,
                raw_payload: payload,
            }).eq('id', fatura.id);

            // Notifica o recebimento. Vem depois do update e não bloqueia o
            // finalize: se o alerta falhar, a fatura continua paga — o dinheiro
            // é o fato, a notificação é conveniência.
            try {
                const { data: inquilino } = await supabase
                    .from('contratos')
                    .select('clientes(nome)')
                    .eq('id', fatura.contrato_id)
                    .maybeSingle();
                const nome = inquilino?.clientes?.nome;
                const ref = fatura.mes_referencia ? ` (${fatura.mes_referencia})` : '';

                await supabase.rpc('registrar_alerta_financeiro', {
                    _corretor_id: fatura.corretor_id,
                    _tipo: 'PAGAMENTO',
                    _mensagem: nome
                        ? `Recebimento de ${moedaBR(payment.value)} de ${nome}${ref}`
                        : `Recebimento de ${moedaBR(payment.value)}${ref}`,
                    _entidade_tipo: 'fatura',
                    _entidade_id: fatura.id,
                    _metadata: {
                        valor: payment.value,
                        inquilino: nome ?? null,
                        mes_referencia: fatura.mes_referencia ?? null,
                        payment_id: payment.id,
                        recibo_url: payment.transactionReceiptUrl ?? null,
                    },
                    _prioridade: 'MEDIA',
                });
            } catch (e) {
                console.error('alerta de recebimento falhou (fatura segue paga)', e);
            }

            await finalize('PROCESSED');
        } else if (event === 'PAYMENT_OVERDUE') {
            if (fatura.status === 'PENDENTE') {
                await supabase.from('faturas_aluguel')
                    .update({ status: 'ATRASADO', asaas_status: payment.status })
                    .eq('id', fatura.id);
            }
            await finalize('PROCESSED');
        } else if (event === 'PAYMENT_DELETED') {
            if (fatura.status !== 'PAGO') {
                await supabase.from('faturas_aluguel')
                    .update({ status: 'CANCELADO', motivo_cancelamento: 'Removido no Asaas', asaas_status: payment.status })
                    .eq('id', fatura.id);
            }
            await finalize('PROCESSED');
        } else if (event === 'PAYMENT_REFUNDED') {
            await supabase.from('faturas_aluguel')
                .update({ status: 'CANCELADO', motivo_cancelamento: 'Estorno', asaas_status: payment.status })
                .eq('id', fatura.id);
            await supabase.from('auditoria_financeira').insert({
                corretor_id: fatura.corretor_id, entidade: 'faturas_aluguel', entidade_id: fatura.id,
                acao: 'ESTORNO', dados_depois: { asaas_status: payment.status }, origem: 'webhook', ator: 'system',
            });
            await finalize('PROCESSED');
        } else {
            // Evento conhecido mas sem ação (CREATED, UPDATED, CHECKOUT_VIEWED...)
            await finalize('IGNORED');
        }
    } catch (err) {
        console.error('processEvent error:', err);
        await finalize('FAILED', {
            attempts: (claimed as any).attempts ? (claimed as any).attempts + 1 : 1,
            last_error: err instanceof Error ? err.message : String(err),
        });
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // 1. Valida o token do webhook (header que o Asaas realmente envia)
        const requestToken = req.headers.get('asaas-access-token') ?? req.headers.get('x-hook-token');
        const secretToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN');
        if (!secretToken) {
            console.error("ASAAS_WEBHOOK_TOKEN não configurado");
            return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
                status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        if (!(await tokenValido(requestToken, secretToken))) {
            console.error("Invalid Webhook Token");
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 2. Parse do payload
        const payload = await req.json();
        const event: string = payload?.event ?? 'UNKNOWN';
        const payment = payload?.payment;

        // 3. event_id: id do Asaas (evt_...) ou hash determinístico como fallback.
        //
        // O fallback PRECISA incluir a transferência. Antes usava só `payment`,
        // e evento de transferência não tem `payment` — todo TRANSFER_DONE sem
        // `payload.id` gerava o hash de "TRANSFER_DONE::", idêntico para
        // qualquer transferência. O primeiro repasse entrava, e do segundo em
        // diante o unique de event_id descartava tudo como reentrega: o PIX
        // saía, o Asaas avisava, e o repasse ficava AGENDADO para sempre.
        const transfer = payload?.transfer;
        const entidadeId = payment?.id ?? transfer?.id ?? '';
        const entidadeCriadaEm = payment?.dateCreated ?? transfer?.dateCreated ?? '';
        const eventId: string = payload?.id
            ?? await sha256Hex(`${event}:${entidadeId}:${entidadeCriadaEm}`);

        // 4. Idempotência na porta: insere o evento; conflito = reentrega
        const supabase = admin();
        const { data: inserted, error: insErr } = await supabase
            .from('asaas_webhook_events')
            .insert({
                event_id: eventId,
                event_type: event,
                payment_id: payment?.id ?? null,
                payload,
                status: 'RECEIVED',
            })
            .select('id')
            .maybeSingle();

        // Conflito (evento repetido) → insErr de unique; responde 200 e encerra
        if (insErr) {
            if (insErr.code === '23505') {
                return new Response(JSON.stringify({ received: true, duplicate: true }), {
                    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }
            throw insErr;
        }

        // 5. Responde 200 IMEDIATAMENTE; processa em background (fila do Asaas nunca pausa)
        if (inserted?.id) {
            // @ts-ignore EdgeRuntime é global no runtime do Supabase
            EdgeRuntime.waitUntil(processEvent(inserted.id));
        }

        return new Response(JSON.stringify({ received: true }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error("Error handling webhook:", error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
