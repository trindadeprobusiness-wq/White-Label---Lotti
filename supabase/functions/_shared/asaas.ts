// Cliente HTTP da API Asaas (v3), resolvido POR INQUILINO.
//
// Antes este módulo exportava `asaasGet`/`asaasPost`/... como funções soltas que
// liam uma `ASAAS_API_KEY` global. Era impossível variar a chave por corretor, e
// o efeito não era só o saldo compartilhado na tela: `POST /payments` e
// `POST /customers` criavam a cobrança do inquilino B dentro da conta do
// inquilino A, com o aluguel caindo na conta errada.
//
// Agora a credencial vem de `asaas_conexoes` + `asaas_conexao_segredos`. Quem
// não conectou recebe `AsaasNaoConectado` e a operação não acontece — em vez de
// acontecer na conta de outro.

import { decifrar } from "./asaas-crypto.ts";

declare const Deno: { env: { get(name: string): string | undefined } } | undefined;

const URL_PRODUCAO = "https://api.asaas.com/v3";
const URL_SANDBOX = "https://api-sandbox.asaas.com/v3";

export class AsaasError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
        super(`Asaas API ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
        this.status = status;
        this.body = body;
    }
}

/**
 * O inquilino não tem conta Asaas conectada.
 *
 * É erro de configuração, não de falha: a interface deve convidar a conectar,
 * não mostrar vermelho. Por isso tem código próprio — a tela decide pelo
 * código, não por casar texto de mensagem.
 */
export class AsaasNaoConectado extends Error {
    readonly codigo = "ASAAS_NAO_CONECTADO";
    readonly status = 409;
    constructor(mensagem = "Este corretor ainda não conectou uma conta Asaas.") {
        super(mensagem);
    }
}

export interface Credencial {
    apiKey: string;
    ambiente: "sandbox" | "producao";
    baseUrl: string;
    contaNome: string | null;
    herdada: boolean;
}

export interface ConexaoLinha {
    id: string;
    ambiente?: string | null;
    status?: string | null;
    conta_nome?: string | null;
    herdada_do_ambiente?: boolean | null;
}

/** Dependências injetadas — é o que torna a precedência testável fora do Deno. */
export interface FontesCredencial {
    buscarConexao: (corretorId: string) => Promise<ConexaoLinha | null>;
    buscarCiphertext: (conexaoId: string) => Promise<string | null>;
    decifrar: (ciphertext: string) => Promise<string>;
    chaveDoAmbiente: () => string | undefined;
    permitirChaveGlobal?: () => boolean;
}

export function baseUrlPara(ambiente: "sandbox" | "producao"): string {
    // A sobrescrita por ambiente existe desde a versão global e é o que permite
    // apontar para um mock em homologação. Só vale para produção: em sandbox o
    // endereço é fixo, senão um engano de configuração mandaria cobrança real.
    const override = typeof Deno !== "undefined" ? Deno?.env.get("ASAAS_BASE_URL") : undefined;
    if (ambiente === "sandbox") return URL_SANDBOX;
    return (override ?? URL_PRODUCAO).replace(/\/$/, "");
}

/** Credencial recém-informada no onboarding, antes de existir no banco. */
export function credencialInformada(
    apiKey: string,
    ambiente: "sandbox" | "producao",
): Credencial {
    return {
        apiKey,
        ambiente,
        baseUrl: baseUrlPara(ambiente),
        contaNome: null,
        herdada: false,
    };
}

/**
 * Resolve QUAL chave usar para este corretor.
 *
 * A ordem importa e é a mesma adotada para o app da Meta: credencial do
 * inquilino vence; o ambiente é só ponte de migração, nunca preenchimento
 * automático para quem não configurou. Sem conexão NÃO existe caminho para a
 * chave global — é exatamente esse caminho que vazava a conta-mãe.
 */
export async function resolverCredencial(
    fontes: FontesCredencial,
    corretorId: string,
): Promise<Credencial> {
    if (!corretorId) throw new AsaasNaoConectado("Não foi possível identificar o corretor da sessão.");

    const conexao = await fontes.buscarConexao(corretorId);

    // Válvula de emergência: religa o comportamento antigo para TODOS. Existe
    // para reverter em produção sem redeploy, e nasce desligada.
    const global = fontes.permitirChaveGlobal?.() ?? false;

    if (!conexao) {
        if (global) {
            const chave = fontes.chaveDoAmbiente();
            if (chave) {
                return {
                    apiKey: chave,
                    ambiente: "producao",
                    baseUrl: baseUrlPara("producao"),
                    contaNome: null,
                    herdada: true,
                };
            }
        }
        throw new AsaasNaoConectado();
    }

    // Conexão que a própria Asaas já recusou não deve ser tentada de novo: a
    // chamada voltaria 401 e a tela mostraria "erro no gateway", quando o que a
    // pessoa precisa ver é o convite a reconectar. `sem_permissao` NÃO entra
    // aqui — ali a chave é boa, só falta um escopo, e as demais operações
    // continuam funcionando.
    if (conexao.status === "invalida") {
        throw new AsaasNaoConectado(
            "A chave da Asaas foi recusada. Conecte a conta novamente com uma chave válida.",
        );
    }

    const ambiente = conexao.ambiente === "sandbox" ? "sandbox" : "producao";
    const ciphertext = await fontes.buscarCiphertext(conexao.id);

    if (ciphertext) {
        const apiKey = await fontes.decifrar(ciphertext);
        if (!apiKey) {
            throw new AsaasNaoConectado("A chave da Asaas guardada está ilegível. Conecte a conta novamente.");
        }
        return {
            apiKey,
            ambiente,
            baseUrl: baseUrlPara(ambiente),
            contaNome: conexao.conta_nome ?? null,
            herdada: false,
        };
    }

    // Sem chave própria, só a conexão herdada pode usar o ambiente — e ela é
    // única por índice no banco.
    if (conexao.herdada_do_ambiente || global) {
        const chave = fontes.chaveDoAmbiente();
        if (!chave) {
            throw new AsaasNaoConectado(
                "A conta Asaas herdada não está mais configurada no servidor. Conecte a chave da sua conta.",
            );
        }
        return {
            apiKey: chave,
            ambiente,
            baseUrl: baseUrlPara(ambiente),
            contaNome: conexao.conta_nome ?? null,
            herdada: true,
        };
    }

    throw new AsaasNaoConectado();
}

export interface ClienteAsaas {
    get: <T = unknown>(path: string) => Promise<T>;
    post: <T = unknown>(path: string, body: unknown) => Promise<T>;
    put: <T = unknown>(path: string, body: unknown) => Promise<T>;
    delete: <T = unknown>(path: string) => Promise<T>;
    ambiente: "sandbox" | "producao";
    contaNome: string | null;
    herdada: boolean;
}

/** Monta o cliente HTTP já preso a uma credencial. */
export function clienteComCredencial(
    cred: Credencial,
    buscar: typeof fetch = fetch,
): ClienteAsaas {
    async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await buscar(`${cred.baseUrl}${path}`, {
            method,
            headers: {
                "access_token": cred.apiKey,
                "Content-Type": "application/json",
                "User-Agent": "Lotti/1.0",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        const text = await res.text();
        let parsed: unknown = text;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* mantém texto cru */ }

        if (!res.ok) throw new AsaasError(res.status, parsed);
        return parsed as T;
    }

    return {
        get: (path) => request("GET", path),
        post: (path, body) => request("POST", path, body),
        put: (path, body) => request("PUT", path, body),
        delete: (path) => request("DELETE", path),
        ambiente: cred.ambiente,
        contaNome: cred.contaNome,
        herdada: cred.herdada,
    };
}

interface ConsultaSupabaseCredencial {
    eq: (coluna: string, valor: string) => ConsultaSupabaseCredencial;
    maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null }>;
}

interface SupabaseCredenciais {
    from: (tabela: string) => {
        select: (colunas: string) => ConsultaSupabaseCredencial;
    };
}

/** Fontes reais: Supabase com service_role + cifra do ambiente. */
export function fontesDoSupabase(admin: unknown): FontesCredencial {
    const banco = admin as SupabaseCredenciais;
    return {
        buscarConexao: async (corretorId) => {
            const { data } = await banco
                .from("asaas_conexoes")
                .select("id, ambiente, status, conta_nome, herdada_do_ambiente")
                .eq("corretor_id", corretorId)
                .maybeSingle();
            return data ? data as unknown as ConexaoLinha : null;
        },
        buscarCiphertext: async (conexaoId) => {
            const { data } = await banco
                .from("asaas_conexao_segredos")
                .select("api_key_ciphertext")
                .eq("conexao_id", conexaoId)
                .maybeSingle();
            return typeof data?.api_key_ciphertext === "string" ? data.api_key_ciphertext : null;
        },
        decifrar: (ciphertext) => decifrar(ciphertext),
        chaveDoAmbiente: () => (typeof Deno !== "undefined" ? Deno?.env.get("ASAAS_API_KEY") : undefined),
        permitirChaveGlobal: () =>
            (typeof Deno !== "undefined" ? Deno?.env.get("ASAAS_PERMITIR_CHAVE_GLOBAL") : "")?.trim().toLowerCase() === "true",
    };
}

/** Atalho usado pelas Edge Functions. */
export async function clienteAsaas(admin: unknown, corretorId: string): Promise<ClienteAsaas> {
    const cred = await resolverCredencial(fontesDoSupabase(admin), corretorId);
    return clienteComCredencial(cred);
}
