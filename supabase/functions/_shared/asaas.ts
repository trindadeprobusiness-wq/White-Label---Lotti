// Cliente HTTP compartilhado da API Asaas (v3).
// Base URL vem de ASAAS_BASE_URL (produção por padrão); auth pelo header access_token.
// Reutilizado por asaas-sync (emissão on-demand) e, futuramente, asaas-worker.

const BASE_URL = (Deno.env.get("ASAAS_BASE_URL") ?? "https://api.asaas.com/v3").replace(/\/$/, "");

export class AsaasError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
        super(`Asaas API ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
        this.status = status;
        this.body = body;
    }
}

function apiKey(): string {
    const key = Deno.env.get("ASAAS_API_KEY");
    if (!key) throw new AsaasError(500, "ASAAS_API_KEY não configurada");
    return key;
}

async function request(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            "access_token": apiKey(),
            "Content-Type": "application/json",
            "User-Agent": "OliverCRM/1.0",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* mantém texto cru */ }

    if (!res.ok) {
        throw new AsaasError(res.status, parsed);
    }
    return parsed;
}

export const asaasGet = (path: string) => request("GET", path);
export const asaasPost = (path: string, body: unknown) => request("POST", path, body);
export const asaasPut = (path: string, body: unknown) => request("PUT", path, body);
export const asaasDelete = (path: string) => request("DELETE", path);
