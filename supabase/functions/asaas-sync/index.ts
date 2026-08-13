import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { asaasGet, asaasPost, asaasPut, AsaasError } from "../_shared/asaas.ts";
import { telefoneParaAsaas } from "../_shared/telefone.ts";

const AVISO_TELEFONE =
    "A cobrança foi emitida, mas o telefone do inquilino não foi aceito pelo Asaas e ficou de fora do cadastro. Corrija o telefone no cadastro do cliente.";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

const hoje = () => new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

// Vencimento do boleto = dia_vencimento do contrato no mês de referência da
// fatura ("MM/YYYY"). Clampa no último dia (mês curto). Se já passou, usa hoje
// (o Asaas rejeita cobrança com vencimento no passado). É o MESMO dia que a
// tela mostra, então boleto e lista nunca divergem.
function computeVencimento(mesRef: string, diaVenc: number): string {
    const [mmStr, yyyyStr] = String(mesRef ?? "").split("/");
    const mm = Number(mmStr), yyyy = Number(yyyyStr);
    if (!mm || !yyyy) return hoje();
    const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
    const day = Math.min(diaVenc > 0 ? diaVenc : 10, lastDay);
    const iso = new Date(Date.UTC(yyyy, mm - 1, day)).toISOString().slice(0, 10);
    return iso < hoje() ? hoje() : iso;
}

// Multa/juros do contrato. A coluna guarda o juros AO DIA; o Asaas usa % ao mês
// (×30). Enviamos SEMPRE fine/interest com valor explícito (inclusive 0), para
// que "sem multa" no contrato realmente zere a multa no boleto, sem depender de
// padrões da conta Asaas.
function multaJuros(contrato: Record<string, unknown> | null) {
    const multaPct = Math.max(0, Number((contrato as any)?.multa_atraso_percentual ?? 0) || 0);
    const jurosDiaPct = Math.max(0, Number((contrato as any)?.juros_mora_diario_percentual ?? 0) || 0);
    const jurosMensalPct = Number((jurosDiaPct * 30).toFixed(2));
    return {
        multaPct,
        jurosMensalPct,
        fine: { value: multaPct, type: "PERCENTAGE" },
        interest: { value: jurosMensalPct },
    };
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        // 1. Autenticação: valida a sessão do corretor (cliente com o JWT do usuário)
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return json({ error: "Unauthorized" }, 401);

        // Extrai o token do header e valida explicitamente (mais robusto que getUser()
        // sem argumento, que depende do parsing do header global). O front envia
        // `Authorization: Bearer <access_token>` da sessão do corretor.
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        const userClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: authHeader } } },
        );
        const { data: { user }, error: authError } = await userClient.auth.getUser(token);
        if (authError || !user) {
            return json({ error: "Sua sessão expirou. Entre novamente para continuar." }, 401);
        }

        const { action, fatura_id, data_pagamento } = await req.json();

        // Ação: consultar o saldo da conta Asaas (não depende de fatura).
        if (action === "saldo") {
            try {
                const bal = await asaasGet("/finance/balance");
                return json({ balance: Number(bal?.balance ?? 0) });
            } catch (e) {
                // Chave Asaas sem escopo FINANCIAL_TRANSACTION:READ → não é erro do app.
                if (e instanceof AsaasError && (e.status === 403 || e.status === 401)) {
                    return json({
                        balance: null,
                        unavailable: true,
                        message: "Ative a permissão de leitura de saldo (FINANCIAL_TRANSACTION:READ) na sua chave de API do Asaas para ver o saldo aqui.",
                    });
                }
                throw e;
            }
        }

        const ACOES_FATURA = [
            "emitir_cobranca", "atualizar_cobranca", "receber_em_dinheiro", "desfazer_recebimento",
        ];
        if (!ACOES_FATURA.includes(action) || !fatura_id) {
            return json({ error: "Requisição inválida" }, 400);
        }

        // 2. Carrega a fatura pelo cliente do usuário — a RLS garante que só o dono lê
        const { data: fatura, error: fErr } = await userClient
            .from("faturas_aluguel")
            .select("*, contratos(*), clientes(*), imoveis(*)")
            .eq("id", fatura_id)
            .single();

        if (fErr || !fatura) return json({ error: "Fatura não encontrada" }, 404);
        // A baixa manual e o estorno agem justamente sobre fatura paga (ou prestes a
        // ser marcada como tal), então essas guardas valem só para emitir/atualizar.
        if (action === "emitir_cobranca" || action === "atualizar_cobranca") {
            if (fatura.status === "PAGO") return json({ error: "Fatura já está paga" }, 409);
            if (fatura.status === "CANCELADO") return json({ error: "Fatura cancelada" }, 409);
        }

        const cliente = fatura.clientes;
        const contrato = fatura.contratos;
        const imovel = fatura.imoveis;
        const descImovel = imovel?.titulo || imovel?.endereco || "imóvel";

        // Cliente de serviço para escritas privilegiadas (auditoria não tem policy de INSERT
        // para authenticated; a posse da fatura já foi provada pela leitura acima).
        const admin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );

        // Vencimento: a data gravada na fatura é a fonte por-fatura (o corretor pode
        // editar o vencimento de uma fatura específica). Se ausente/inválida, deriva
        // do dia do contrato. Sempre >= hoje (o Asaas rejeita data no passado).
        const dataGravada = typeof fatura.data_vencimento === "string" ? fatura.data_vencimento.slice(0, 10) : "";
        const vencimento = /^\d{4}-\d{2}-\d{2}$/.test(dataGravada)
            ? (dataGravada < hoje() ? hoje() : dataGravada)
            : computeVencimento(fatura.mes_referencia, Number(contrato?.dia_vencimento) || 10);
        const mj = multaJuros(contrato);

        // ── Ação: ATUALIZAR uma cobrança já emitida (mesmo link) ──
        if (action === "atualizar_cobranca") {
            if (!fatura.external_id) {
                return json({ error: "Esta cobrança ainda não foi emitida." }, 409);
            }
            // Não altera cobrança já paga/confirmada no Asaas.
            const atual = await asaasGet(`/payments/${fatura.external_id}`);
            if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(String(atual?.status))) {
                return json({ error: "Cobrança já foi paga/confirmada — não é possível alterar." }, 409);
            }

            const payment = await asaasPut(`/payments/${fatura.external_id}`, {
                billingType: atual?.billingType ?? "UNDEFINED",
                dueDate: vencimento,
                value: Number(fatura.valor_total),
                description: `Aluguel ${fatura.mes_referencia} — ${descImovel}`,
                externalReference: fatura.id,
                fine: mj.fine,
                interest: mj.interest,
            });

            let pixText: string | null = fatura.pix_qrcode_text ?? null;
            try {
                const pix = await asaasGet(`/payments/${payment.id}/pixQrCode`);
                pixText = pix?.payload ?? pixText;
            } catch (_) { /* segue com o pix atual */ }

            await admin.from("faturas_aluguel").update({
                data_vencimento: vencimento,
                boleto_url_asaas: payment.bankSlipUrl ?? payment.invoiceUrl ?? fatura.boleto_url_asaas,
                pix_qrcode_text: pixText,
                asaas_status: payment.status,
            }).eq("id", fatura.id);

            await admin.from("auditoria_financeira").insert({
                corretor_id: fatura.corretor_id,
                entidade: "faturas_aluguel",
                entidade_id: fatura.id,
                acao: "COBRANCA_ATUALIZADA",
                dados_depois: {
                    external_id: payment.id,
                    value: payment.value,
                    dueDate: vencimento,
                    status: payment.status,
                },
                calculo: { multa_pct: mj.multaPct, juros_mensal_pct: mj.jurosMensalPct },
                origem: "ui",
                ator: user.id,
            });

            return json({
                ok: true,
                updated: true,
                external_id: payment.id,
                boleto_url: payment.bankSlipUrl ?? payment.invoiceUrl ?? fatura.boleto_url_asaas,
                pix: pixText,
                status: payment.status,
            });
        }

        // ── Ação: BAIXA MANUAL → recebimento em dinheiro no Asaas ──
        // O corretor recebeu por fora (PIX/transferência em outro banco) e deu baixa
        // na mão. Sem isto a cobrança seguia ABERTA no Asaas: o boleto continuava
        // pagável e o inquilino podia pagar de novo, além do painel mostrar pendente.
        if (action === "receber_em_dinheiro") {
            if (!fatura.external_id) {
                // Nunca foi emitida — não existe cobrança no Asaas para baixar.
                return json({ ok: true, sem_cobranca: true, avisos: [] });
            }

            const atual = await asaasGet(`/payments/${fatura.external_id}`);
            const st = String(atual?.status ?? "");

            if (st === "RECEIVED_IN_CASH") {
                return json({ ok: true, already: true, status: st, avisos: [] });
            }
            if (["RECEIVED", "CONFIRMED"].includes(st)) {
                // Já entrou pelo boleto/PIX; o webhook cuidou. Marcar em dinheiro aqui
                // duplicaria o recebimento no Asaas.
                return json({
                    ok: true,
                    status: st,
                    avisos: ["Esta cobrança já constava paga no Asaas (boleto ou PIX). A baixa foi registrada apenas no sistema, para não lançar o valor duas vezes."],
                });
            }

            const dataPg = /^\d{4}-\d{2}-\d{2}$/.test(String(data_pagamento ?? "")) ? data_pagamento : hoje();
            const recebido = await asaasPost(`/payments/${fatura.external_id}/receiveInCash`, {
                paymentDate: dataPg,
                value: Number(fatura.valor_total),
                notifyCustomer: false,
            });

            await admin.from("faturas_aluguel")
                .update({ asaas_status: recebido?.status ?? "RECEIVED_IN_CASH" })
                .eq("id", fatura.id);

            await admin.from("auditoria_financeira").insert({
                corretor_id: fatura.corretor_id,
                entidade: "faturas_aluguel",
                entidade_id: fatura.id,
                acao: "RECEBIMENTO_EM_DINHEIRO",
                dados_depois: {
                    external_id: fatura.external_id,
                    paymentDate: dataPg,
                    value: Number(fatura.valor_total),
                    status: recebido?.status ?? null,
                },
                origem: "ui",
                ator: user.id,
            });

            return json({ ok: true, status: recebido?.status ?? null, avisos: [] });
        }

        // ── Ação: DESFAZER a baixa manual no Asaas ──
        if (action === "desfazer_recebimento") {
            if (!fatura.external_id) return json({ ok: true, sem_cobranca: true, avisos: [] });

            const atual = await asaasGet(`/payments/${fatura.external_id}`);
            const st = String(atual?.status ?? "");
            if (st !== "RECEIVED_IN_CASH") {
                // Não foi baixa em dinheiro (ou já foi desfeita): nada a reverter lá.
                return json({
                    ok: true,
                    nao_aplicavel: true,
                    status: st,
                    avisos: st === "RECEIVED" || st === "CONFIRMED"
                        ? ["A cobrança consta paga no Asaas por boleto/PIX. O estorno foi feito só no sistema — se for o caso, estorne também no painel do Asaas."]
                        : [],
                });
            }

            const desfeito = await asaasPost(`/payments/${fatura.external_id}/undoReceivedInCash`, {});

            await admin.from("faturas_aluguel")
                .update({ asaas_status: desfeito?.status ?? "PENDING" })
                .eq("id", fatura.id);

            await admin.from("auditoria_financeira").insert({
                corretor_id: fatura.corretor_id,
                entidade: "faturas_aluguel",
                entidade_id: fatura.id,
                acao: "RECEBIMENTO_EM_DINHEIRO_DESFEITO",
                dados_depois: { external_id: fatura.external_id, status: desfeito?.status ?? null },
                origem: "ui",
                ator: user.id,
            });

            return json({ ok: true, status: desfeito?.status ?? null, avisos: [] });
        }

        // ── Ação: EMITIR (idempotente) ──
        // Idempotência: já emitida → devolve os dados existentes sem recriar no Asaas
        if (fatura.external_id) {
            return json({
                already: true,
                external_id: fatura.external_id,
                boleto_url: fatura.boleto_url_asaas,
                pix: fatura.pix_qrcode_text,
            });
        }

        const cpf = (cliente?.cpf ?? "").replace(/\D/g, "");
        if (!cpf) {
            return json({ error: "O inquilino precisa ter CPF cadastrado para emitir a cobrança." }, 422);
        }

        // 3. ensure_customer — garante o pagador no Asaas.
        // O telefone NUNCA pode barrar a emissão: para o Asaas ele é opcional, só o
        // CPF é obrigatório (checado acima). Antes mandávamos `clientes.telefone` cru
        // e qualquer número torto derrubava o POST /customers com HTTP 400, matando a
        // cobrança inteira antes de chegar no POST /payments.
        const avisos: string[] = [];
        const tel = telefoneParaAsaas(cliente?.telefone);
        const temTelefoneValido = !!(tel.mobilePhone || tel.phone);
        if (!temTelefoneValido && (cliente?.telefone ?? "").trim()) {
            avisos.push(AVISO_TELEFONE);
        }

        let customerId: string | null = cliente?.asaas_customer_id ?? null;
        if (!customerId) {
            // dedupe por CPF antes de criar
            try {
                const busca = await asaasGet(`/customers?cpfCnpj=${cpf}`);
                if (busca?.data?.length) customerId = busca.data[0].id;
            } catch (_) { /* segue para criação */ }

            if (!customerId) {
                const base = {
                    name: cliente.nome,
                    cpfCnpj: cpf,
                    email: cliente.email || undefined,
                    externalReference: cliente.id,
                };
                // Cria primeiro só com os dados necessários para cobrar. Telefone é
                // enriquecimento opcional e nunca participa desta requisição crítica.
                const novo = await asaasPost("/customers", base);
                customerId = novo.id;
            }
            await admin.from("clientes").update({ asaas_customer_id: customerId }).eq("id", cliente.id);
        }

        if (temTelefoneValido) {
            // Atualiza o contato somente depois de o pagador estar garantido. É
            // best-effort: qualquer regra do Asaas sobre telefone fica isolada e a
            // cobrança continua sendo criada apenas com customer, CPF e valor.
            try {
                await asaasPut(`/customers/${customerId}`, tel);
            } catch (e) {
                console.warn("Não foi possível atualizar o telefone do customer no Asaas.", e);
                avisos.push(AVISO_TELEFONE);
            }
        }

        // 4. create_payment
        const payment = await asaasPost("/payments", {
            customer: customerId,
            billingType: "UNDEFINED", // inquilino escolhe boleto, PIX ou cartão
            dueDate: vencimento,
            value: Number(fatura.valor_total),
            description: `Aluguel ${fatura.mes_referencia} — ${descImovel}`,
            externalReference: fatura.id,
            fine: mj.fine,
            interest: mj.interest,
        });

        // PIX copia-e-cola (não fatal se indisponível)
        let pixText: string | null = null;
        try {
            const pix = await asaasGet(`/payments/${payment.id}/pixQrCode`);
            pixText = pix?.payload ?? null;
        } catch (_) { /* segue sem PIX */ }

        // 5. Persiste na fatura + auditoria
        await admin.from("faturas_aluguel").update({
            external_id: payment.id,
            data_vencimento: vencimento,
            boleto_url_asaas: payment.bankSlipUrl ?? payment.invoiceUrl ?? null,
            pix_qrcode_text: pixText,
            asaas_status: payment.status,
        }).eq("id", fatura.id);

        await admin.from("auditoria_financeira").insert({
            corretor_id: fatura.corretor_id,
            entidade: "faturas_aluguel",
            entidade_id: fatura.id,
            acao: "COBRANCA_EMITIDA",
            dados_depois: {
                external_id: payment.id,
                value: payment.value,
                dueDate: vencimento,
                status: payment.status,
            },
            calculo: { multa_pct: mj.multaPct, juros_mensal_pct: mj.jurosMensalPct },
            origem: "ui",
            ator: user.id,
        });

        return json({
            ok: true,
            external_id: payment.id,
            boleto_url: payment.bankSlipUrl ?? payment.invoiceUrl ?? null,
            pix: pixText,
            status: payment.status,
            avisos,
        });
    } catch (error) {
        if (error instanceof AsaasError) {
            console.error("Asaas error:", error.status, error.body);
            const msg = typeof error.body === "object" && error.body !== null
                ? ((error.body as any).errors?.[0]?.description ?? "Erro na API do Asaas")
                : "Erro na API do Asaas";
            return json({ error: msg }, error.status === 401 ? 502 : 400);
        }
        console.error("asaas-sync error:", error);
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        return json({ error: message }, 500);
    }
});
