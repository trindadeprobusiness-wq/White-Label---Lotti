import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { asaasGet, asaasPost, AsaasError } from "../_shared/asaas.ts";

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

        const { action, fatura_id } = await req.json();

        // Ação: consultar o saldo da conta Asaas (não depende de fatura).
        if (action === "saldo") {
            const bal = await asaasGet("/finance/balance");
            return json({ balance: Number(bal?.balance ?? 0) });
        }

        if (action !== "emitir_cobranca" || !fatura_id) {
            return json({ error: "Requisição inválida" }, 400);
        }

        // 2. Carrega a fatura pelo cliente do usuário — a RLS garante que só o dono lê
        const { data: fatura, error: fErr } = await userClient
            .from("faturas_aluguel")
            .select("*, contratos(*), clientes(*), imoveis(*)")
            .eq("id", fatura_id)
            .single();

        if (fErr || !fatura) return json({ error: "Fatura não encontrada" }, 404);
        if (fatura.status === "PAGO") return json({ error: "Fatura já está paga" }, 409);
        if (fatura.status === "CANCELADO") return json({ error: "Fatura cancelada" }, 409);

        // Idempotência: já emitida → devolve os dados existentes sem recriar no Asaas
        if (fatura.external_id) {
            return json({
                already: true,
                external_id: fatura.external_id,
                boleto_url: fatura.boleto_url_asaas,
                pix: fatura.pix_qrcode_text,
            });
        }

        const cliente = fatura.clientes;
        const contrato = fatura.contratos;
        const imovel = fatura.imoveis;

        const cpf = (cliente?.cpf ?? "").replace(/\D/g, "");
        if (!cpf) {
            return json({ error: "O inquilino precisa ter CPF cadastrado para emitir a cobrança." }, 422);
        }

        // Cliente de serviço para escritas privilegiadas (auditoria não tem policy de INSERT
        // para authenticated; a posse da fatura já foi provada pela leitura acima).
        const admin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        );

        // 3. ensure_customer — garante o pagador no Asaas
        let customerId: string | null = cliente?.asaas_customer_id ?? null;
        if (!customerId) {
            // dedupe por CPF antes de criar
            try {
                const busca = await asaasGet(`/customers?cpfCnpj=${cpf}`);
                if (busca?.data?.length) customerId = busca.data[0].id;
            } catch (_) { /* segue para criação */ }

            if (!customerId) {
                const novo = await asaasPost("/customers", {
                    name: cliente.nome,
                    cpfCnpj: cpf,
                    email: cliente.email || undefined,
                    mobilePhone: (cliente.telefone ?? "").replace(/\D/g, "") || undefined,
                    externalReference: cliente.id,
                });
                customerId = novo.id;
            }
            await admin.from("clientes").update({ asaas_customer_id: customerId }).eq("id", cliente.id);
        }

        // 4. create_payment
        const vencimento = fatura.data_vencimento >= hoje() ? fatura.data_vencimento : hoje();
        const multaPct = Number(contrato?.multa_atraso_percentual ?? 0);
        const jurosDiaPct = Number(contrato?.juros_mora_diario_percentual ?? 0);
        const descImovel = imovel?.titulo || imovel?.endereco || "imóvel";

        const paymentBody: Record<string, unknown> = {
            customer: customerId,
            billingType: "UNDEFINED", // inquilino escolhe boleto, PIX ou cartão
            dueDate: vencimento,
            value: Number(fatura.valor_total),
            description: `Aluguel ${fatura.mes_referencia} — ${descImovel}`,
            externalReference: fatura.id,
        };
        if (multaPct > 0) paymentBody.fine = { value: multaPct, type: "PERCENTAGE" };
        if (jurosDiaPct > 0) paymentBody.interest = { value: Number((jurosDiaPct * 30).toFixed(2)) }; // Asaas usa % ao mês

        const payment = await asaasPost("/payments", paymentBody);

        // PIX copia-e-cola (não fatal se indisponível)
        let pixText: string | null = null;
        try {
            const pix = await asaasGet(`/payments/${payment.id}/pixQrCode`);
            pixText = pix?.payload ?? null;
        } catch (_) { /* segue sem PIX */ }

        // 5. Persiste na fatura + auditoria
        await admin.from("faturas_aluguel").update({
            external_id: payment.id,
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
            calculo: { multa_pct: multaPct, juros_mensal_pct: Number((jurosDiaPct * 30).toFixed(2)) },
            origem: "ui",
            ator: user.id,
        });

        return json({
            ok: true,
            external_id: payment.id,
            boleto_url: payment.bankSlipUrl ?? payment.invoiceUrl ?? null,
            pix: pixText,
            status: payment.status,
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
