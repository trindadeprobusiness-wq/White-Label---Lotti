import { baseUrlProducao } from './asaas.config';

/** Porte de supabase/functions/_shared/asaas.ts (cliente HTTP) com timeout e fetch injetado. */
export const FETCH_ASAAS = Symbol('FETCH_ASAAS');
export type FetchAsaas = typeof fetch;

const URL_PRODUCAO = 'https://api.asaas.com/v3';
const URL_SANDBOX = 'https://api-sandbox.asaas.com/v3';
export const TIMEOUT_ASAAS_MS = 20_000;

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/** Primeiro errors[].description do corpo do Asaas (ou message/error). */
export function descricaoErroAsaas(body: unknown): string | null {
  if (typeof body === 'string') return texto(body);
  if (!body || typeof body !== 'object') return null;
  const objeto = body as Record<string, unknown>;
  if (Array.isArray(objeto.errors)) {
    for (const item of objeto.errors) {
      if (item && typeof item === 'object') {
        const descricao = texto((item as Record<string, unknown>).description);
        if (descricao) return descricao;
      }
    }
  }
  return texto(objeto.message) ?? texto(objeto.error);
}

export class AsaasError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly descricao: string | null;
  constructor(status: number, body: unknown, descricao?: string | null) {
    // A mensagem não leva o corpo: ele pode trazer CPF, e-mail ou nome do pagador.
    super(`Asaas API ${status}`);
    this.status = status;
    this.body = body;
    this.descricao = descricao !== undefined ? descricao : descricaoErroAsaas(body);
  }
}

/** O corretor não tem conta Asaas conectada (configuração que falta, não falha). */
export class AsaasNaoConectado extends Error {
  readonly codigo = 'ASAAS_NAO_CONECTADO';
  readonly status = 409;
  constructor(mensagem = 'Este corretor ainda não conectou uma conta Asaas.') {
    super(mensagem);
  }
}

export type AmbienteAsaas = 'sandbox' | 'producao';

/** Sobrescrita só em produção: em sandbox o endereço é fixo, para engano de configuração não cobrar de verdade. */
export function baseUrlPara(ambiente: AmbienteAsaas): string {
  if (ambiente === 'sandbox') return URL_SANDBOX;
  return (baseUrlProducao() ?? URL_PRODUCAO).replace(/\/$/, '');
}

function ehTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

export class AsaasHttp {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly fetchImpl: FetchAsaas) {}

  get<T = unknown>(path: string): Promise<T> { return this.request<T>('GET', path); }
  post<T = unknown>(path: string, body: unknown): Promise<T> { return this.request<T>('POST', path, body); }
  put<T = unknown>(path: string, body: unknown): Promise<T> { return this.request<T>('PUT', path, body); }
  delete<T = unknown>(path: string): Promise<T> { return this.request<T>('DELETE', path); }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { access_token: this.apiKey, 'Content-Type': 'application/json', 'User-Agent': 'Lotti/1.0' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_ASAAS_MS),
      });
      text = await res.text();
    } catch (e) {
      if (ehTimeout(e)) throw new AsaasError(504, null, 'O Asaas não respondeu a tempo.');
      throw e;
    }
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* mantém texto cru */ }
    if (!res.ok) throw new AsaasError(res.status, parsed);
    return parsed as T;
  }
}
