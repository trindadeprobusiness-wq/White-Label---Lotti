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
        // Eventos sem payment (transfers, tokens de API etc.): não há fatura a mexer
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

        if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
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

        // 3. event_id: id do Asaas (evt_...) ou hash determinístico como fallback
        const eventId: string = payload?.id
            ?? await sha256Hex(`${event}:${payment?.id ?? ''}:${payment?.dateCreated ?? ''}`);

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
