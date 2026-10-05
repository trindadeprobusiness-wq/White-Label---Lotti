/** Códigos que o front compara em `e.message` (vindos das funções do banco ou do mover). */
export const CODIGOS_DO_BANCO = ['forbidden', 'invalid_name', 'invalid_stage', 'duplicate_client_phone', 'CONFLITO'] as const;

/** O ValidationPipe põe o caminho do campo antes da mensagem de item de lista ("etapas.0.Informe..."). */
const PREFIXO_CAMPO = /^(?:[a-z_][a-z0-9_]*\.(?:\d+\.)*)+/;

/** Erro da API no formato que codigoDoErro, clienteDoTelefone, mensagemDeErro e barradoPorContrato já leem. */
export class ErroApi extends Error {
  status: number;
  codigo: string | null;
  details: string | null;
  code: string | null;
  constructor(status: number, codigo: string | null, message: string, details: string | null = null, code: string | null = null) {
    super(message);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.details = details;
    this.code = code;
  }
}

export async function lerErroApi(res: Response, padrao: string): Promise<ErroApi> {
  let corpo: Record<string, unknown> = {};
  try { corpo = ((await res.json()) ?? {}) as Record<string, unknown>; } catch { /* sem corpo */ }
  const codigo = typeof corpo.codigo === 'string' ? corpo.codigo : null;
  const bruto = corpo.message;
  const texto = res.status >= 500 ? ''
    : Array.isArray(bruto)
      ? [...new Set(bruto.filter((s): s is string => typeof s === 'string').map((s) => s.replace(PREFIXO_CAMPO, '')))].join(' ')
      : typeof bruto === 'string' ? bruto : '';
  const message = codigo && (CODIGOS_DO_BANCO as readonly string[]).includes(codigo) ? codigo : (texto || padrao);
  return new ErroApi(res.status, codigo, message,
    typeof corpo.detalhe === 'string' ? corpo.detalhe : null,
    typeof corpo.sqlstate === 'string' ? corpo.sqlstate : null);
}

export async function lerJson<T>(res: Response, padrao: string): Promise<T> {
  if (!res.ok) throw await lerErroApi(res, padrao);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const corpoJson = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', corpo?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});

/** Mesmo formato { data, error } do supabase-js, para os ramos existentes seguirem iguais. */
export async function comoResultado<T>(p: Promise<T>): Promise<{ data: T | null; error: unknown }> {
  try { return { data: await p, error: null }; } catch (error) { return { data: null, error }; }
}

/** Copia só as chaves aceitas pela rota (o DTO recusa as outras com 400), sem as que estão undefined. */
export function escolher<K extends string>(obj: object, chaves: readonly K[]): Partial<Record<K, unknown>> {
  const fonte = obj as Record<string, unknown>;
  const saida: Partial<Record<K, unknown>> = {};
  for (const k of chaves) if (fonte[k] !== undefined) saida[k] = fonte[k];
  return saida;
}
