export type AmbienteAsaas = "sandbox" | "producao";

export const EVENTOS_WEBHOOK_ASAAS = [
    "PAYMENT_RECEIVED",
    "PAYMENT_CONFIRMED",
    "PAYMENT_RECEIVED_IN_CASH",
    "PAYMENT_OVERDUE",
    "PAYMENT_DELETED",
    "PAYMENT_REFUNDED",
    "TRANSFER_CREATED",
    "TRANSFER_PENDING",
    "TRANSFER_IN_BANK_PROCESSING",
    "TRANSFER_BLOCKED",
    "TRANSFER_DONE",
    "TRANSFER_FAILED",
    "TRANSFER_CANCELLED",
] as const;

export interface DadosContaAsaas {
    nome: string | null;
    email: string;
    cpfCnpj: string | null;
}

function texto(valor: unknown): string | null {
    return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function normalizarAmbiente(valor: unknown): AmbienteAsaas {
    return valor === "sandbox" ? "sandbox" : "producao";
}

/**
 * A Asaas pode evoluir o formato da chave. Validamos apenas propriedades de
 * segurança que não dependem do prefixo atual: tamanho plausível e ausência de
 * espaços. A autenticação real continua sendo a prova definitiva.
 */
export function normalizarApiKey(valor: unknown): string {
    if (typeof valor !== "string") throw new Error("Informe a chave de API da sua conta Asaas.");
    const chave = valor.trim();
    if (chave.length < 20 || chave.length > 512 || /\s/.test(chave)) {
        throw new Error("A chave informada não tem um formato válido.");
    }
    return chave;
}

export function extrairDadosConta(
    bruto: unknown,
    emailDaSessao: string | null | undefined,
): DadosContaAsaas {
    const info = bruto && typeof bruto === "object"
        ? bruto as Record<string, unknown>
        : {};
    const email = texto(info.email) ?? texto(emailDaSessao);
    if (!email) throw new Error("Sua conta precisa ter um e-mail válido para configurar o webhook Asaas.");

    return {
        nome: texto(info.companyName)
            ?? texto(info.tradingName)
            ?? texto(info.commercialName)
            ?? texto(info.name),
        email,
        cpfCnpj: texto(info.cpfCnpj),
    };
}

export function montarWebhookAsaas(
    url: string,
    email: string,
    authToken: string,
) {
    return {
        name: "Lotti - Gestão de Aluguéis",
        url,
        email,
        enabled: true,
        interrupted: false,
        apiVersion: 3,
        authToken,
        sendType: "NON_SEQUENTIALLY",
        events: [...EVENTOS_WEBHOOK_ASAAS],
    };
}

export function descricaoErroAsaas(body: unknown): string | null {
    if (typeof body === "string") return texto(body);
    if (!body || typeof body !== "object") return null;
    const objeto = body as Record<string, unknown>;
    if (Array.isArray(objeto.errors)) {
        for (const item of objeto.errors) {
            if (item && typeof item === "object") {
                const descricao = texto((item as Record<string, unknown>).description);
                if (descricao) return descricao;
            }
        }
    }
    return texto(objeto.message) ?? texto(objeto.error);
}
