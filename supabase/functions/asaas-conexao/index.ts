import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import {
    AsaasError,
    clienteAsaas,
    clienteComCredencial,
    credencialInformada,
} from "../_shared/asaas.ts";
import {
    descricaoErroAsaas,
    extrairDadosConta,
    montarWebhookAsaas,
    normalizarAmbiente,
    normalizarApiKey,
} from "../_shared/asaas-conexao.ts";
import { cifrar, finalDaChave, tokenAleatorio } from "../_shared/asaas-crypto.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

class ErroConexao extends Error {
    constructor(
        readonly codigo: string,
        mensagem: string,
        readonly status = 400,
    ) {
        super(mensagem);
    }
}

interface ConexaoExistente {
    id: string;
    webhook_id: string | null;
    webhook_slug: string | null;
}

interface ConsultaConexao {
    eq: (coluna: string, valor: string) => ConsultaConexao;
    maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
}

interface BancoConexao {
    from: (tabela: string) => {
        select: (colunas: string) => ConsultaConexao;
    };
}

interface RespostaSaldo {
    balance?: number | string | null;
}

interface RespostaWebhook {
    id?: string;
}

interface ListaWebhooks {
    data?: RespostaWebhook[];
}

async function conexaoExistente(
    admin: unknown,
    corretorId: string,
): Promise<ConexaoExistente | null> {
    const banco = admin as BancoConexao;
    const { data, error } = await banco
        .from("asaas_conexoes")
        .select("id, webhook_id, webhook_slug")
        .eq("corretor_id", corretorId)
        .maybeSingle();
    if (error) throw error;
    if (!data || typeof data !== "object" || !("id" in data)) return null;
    const linha = data as Record<string, unknown>;
    return {
        id: String(linha.id),
        webhook_id: typeof linha.webhook_id === "string" ? linha.webhook_id : null,
        webhook_slug: typeof linha.webhook_slug === "string" ? linha.webhook_slug : null,
    };
}

async function apagarWebhookSemBloquear(cliente: Awaited<ReturnType<typeof clienteAsaas>> | null, webhookId: string | null) {
    if (!cliente || !webhookId) return null;
    try {
        await cliente.delete(`/webhooks/${encodeURIComponent(webhookId)}`);
        return null;
    } catch (error) {
        if (error instanceof AsaasError && error.status === 404) return null;
        return "A conexão foi removida da Lotti, mas confira o webhook antigo no painel do Asaas.";
    }
}

function erroDaAsaas(error: AsaasError): ErroConexao {
    if (error.status === 401) {
        return new ErroConexao(
            "ASAAS_CHAVE_INVALIDA",
            "A Asaas recusou essa chave. Confira se ela pertence ao ambiente escolhido e tente novamente.",
        );
    }
    if (error.status === 403) {
        return new ErroConexao(
            "ASAAS_PERMISSOES_INSUFICIENTES",
            "A chave é válida, mas não tem todas as permissões necessárias. Libere leitura e escrita de clientes, cobranças e webhooks; para exibir o saldo, libere também dados financeiros.",
        );
    }
    const detalhe = descricaoErroAsaas(error.body);
    return new ErroConexao(
        "ASAAS_REJEITOU_CONEXAO",
        detalhe ? `A Asaas não aceitou a conexão: ${detalhe}` : "A Asaas não aceitou a conexão. Revise a chave e tente novamente.",
        error.status >= 500 ? 502 : 400,
    );
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

    try {
        const authorization = req.headers.get("Authorization");
        if (!authorization) return json({ error: "Sessão ausente" }, 401);

        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
        if (!supabaseUrl || !anonKey || !serviceKey) {
            throw new ErroConexao("CONFIGURACAO_INCOMPLETA", "A integração Asaas ainda não está disponível.", 500);
        }

        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authorization } },
        });
        const { data: { user }, error: authError } = await userClient.auth.getUser();
        if (authError || !user) return json({ error: "Sua sessão expirou. Entre novamente." }, 401);

        const { data: corretorId, error: corretorError } = await userClient.rpc("get_corretor_id");
        if (corretorError || !corretorId) {
            return json({ error: "Não foi possível identificar sua operação." }, 403);
        }

        const admin = createClient(supabaseUrl, serviceKey);
        const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
        const action = corpo.action;

        if (action === "desconectar") {
            const existente = await conexaoExistente(admin, corretorId as string);
            let clienteAnterior: Awaited<ReturnType<typeof clienteAsaas>> | null = null;
            if (existente) {
                try { clienteAnterior = await clienteAsaas(admin, corretorId as string); } catch { /* chave revogada */ }
            }
            const aviso = await apagarWebhookSemBloquear(clienteAnterior, existente?.webhook_id ?? null);
            const { error } = await admin.from("asaas_conexoes").delete().eq("corretor_id", corretorId);
            if (error) throw error;
            return json({ ok: true, aviso });
        }

        if (action !== "conectar") {
            return json({ error: "Ação inválida" }, 400);
        }

        const apiKey = normalizarApiKey(corpo.api_key);
        const ambiente = normalizarAmbiente(corpo.ambiente);
        const clienteNovo = clienteComCredencial(credencialInformada(apiKey, ambiente));

        let infoComercial: unknown = {};
        try {
            infoComercial = await clienteNovo.get("/myAccount/commercialInfo/");
        } catch (error) {
            if (error instanceof AsaasError && error.status !== 403) throw error;
        }

        // Essas leituras comprovam que a chave não é apenas válida: ela pode
        // operar os dois recursos que a emissão usa. A escrita do webhook logo
        // abaixo comprova a permissão de provisionamento automático.
        await clienteNovo.get("/customers?limit=1");
        await clienteNovo.get("/payments?limit=1");

        let saldo: number | null = null;
        let saldoSemPermissao = false;
        try {
            const resultado = await clienteNovo.get<RespostaSaldo>("/finance/balance");
            saldo = Number.isFinite(Number(resultado?.balance)) ? Number(resultado.balance) : null;
        } catch (error) {
            if (error instanceof AsaasError && error.status === 403) saldoSemPermissao = true;
            else throw error;
        }

        const conta = extrairDadosConta(infoComercial, user.email);
        const anterior = await conexaoExistente(admin, corretorId as string);
        let clienteAnterior: Awaited<ReturnType<typeof clienteAsaas>> | null = null;
        if (anterior) {
            try { clienteAnterior = await clienteAsaas(admin, corretorId as string); } catch { /* conexão anterior inválida */ }
        }

        const webhookToken = tokenAleatorio(36);
        let webhookSlug = anterior?.webhook_slug ?? tokenAleatorio(24);
        let webhookId: string | null = null;
        const webhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/asaas-webhook?t=${encodeURIComponent(webhookSlug)}`;
        const webhookPayload = montarWebhookAsaas(webhookUrl, conta.email, webhookToken);

        // Se a chave nova ainda pertence à mesma conta, reaproveita o webhook e
        // evita consumir uma das dez vagas. Em troca de conta, o id não aparece
        // na listagem e um webhook novo é criado.
        const listagem = await clienteNovo.get<ListaWebhooks>("/webhooks?limit=100");
        const webhooks = Array.isArray(listagem?.data) ? listagem.data : [];
        if (anterior?.webhook_id && webhooks.some((item) => item?.id === anterior.webhook_id)) {
            const atualizado = await clienteNovo.put<RespostaWebhook>(
                `/webhooks/${encodeURIComponent(anterior.webhook_id)}`,
                webhookPayload,
            );
            webhookId = atualizado?.id ?? anterior.webhook_id;
        } else {
            webhookSlug = tokenAleatorio(24);
            const urlNova = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/asaas-webhook?t=${encodeURIComponent(webhookSlug)}`;
            const criado = await clienteNovo.post<RespostaWebhook>(
                "/webhooks",
                montarWebhookAsaas(urlNova, conta.email, webhookToken),
            );
            webhookId = criado?.id ?? null;
        }
        if (!webhookId) throw new ErroConexao("ASAAS_WEBHOOK_INVALIDO", "A Asaas não confirmou a criação do webhook.", 502);

        const apiKeyCiphertext = await cifrar(apiKey);
        const webhookTokenCiphertext = await cifrar(webhookToken);
        const { data: conexaoId, error: saveError } = await admin.rpc("salvar_conexao_asaas", {
            p_corretor_id: corretorId,
            p_ambiente: ambiente,
            p_status: saldoSemPermissao ? "sem_permissao" : "conectada",
            p_conta_nome: conta.nome,
            p_conta_email: conta.email,
            p_conta_cpf_cnpj: conta.cpfCnpj,
            p_chave_final: finalDaChave(apiKey),
            p_escopos_faltando: saldoSemPermissao ? ["FINANCIAL_TRANSACTION:READ"] : [],
            p_webhook_id: webhookId,
            p_webhook_slug: webhookSlug,
            p_api_key_ciphertext: apiKeyCiphertext,
            p_webhook_token_ciphertext: webhookTokenCiphertext,
        });

        if (saveError || !conexaoId) {
            try { await clienteNovo.delete(`/webhooks/${encodeURIComponent(webhookId)}`); } catch { /* limpeza best-effort */ }
            throw saveError ?? new Error("A conexão não foi persistida");
        }

        let aviso: string | null = null;
        if (anterior?.webhook_id && anterior.webhook_id !== webhookId) {
            aviso = await apagarWebhookSemBloquear(clienteAnterior, anterior.webhook_id);
        }

        return json({
            ok: true,
            balance: saldo,
            aviso,
            conexao: {
                id: conexaoId,
                ambiente,
                status: saldoSemPermissao ? "sem_permissao" : "conectada",
                conta_nome: conta.nome,
                conta_email: conta.email,
                chave_final: finalDaChave(apiKey),
                escopos_faltando: saldoSemPermissao ? ["FINANCIAL_TRANSACTION:READ"] : [],
                webhook_configurado: true,
            },
        });
    } catch (error) {
        if (error instanceof ErroConexao) {
            return json({ error: error.message, codigo: error.codigo }, error.status);
        }
        if (error instanceof AsaasError) {
            const tratado = erroDaAsaas(error);
            return json({ error: tratado.message, codigo: tratado.codigo }, tratado.status);
        }
        console.error("Falha ao configurar conexão Asaas:", error instanceof Error ? error.message : "erro desconhecido");
        return json({ error: "Não foi possível salvar a conexão Asaas agora.", codigo: "ASAAS_CONEXAO_FALHOU" }, 500);
    }
});
