/** Controles compartilhados das entradas públicas. Nunca expor erros internos. */
export class PublicRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readPublicJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  if (Number(req.headers.get('content-length')) > maxBytes) {
    throw new PublicRequestError(413, 'Requisição muito grande.');
  }
  const reader = req.body?.getReader();
  if (!reader) throw new PublicRequestError(400, 'Corpo inválido.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PublicRequestError(413, 'Requisição muito grande.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new PublicRequestError(400, 'Corpo inválido.'); }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicRequestError(400, 'Dados inválidos.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max || Array.from(value).some(c => c.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(c))) {
    throw new PublicRequestError(400, 'Campo inválido ou muito longo.');
  }
  return value.trim() || undefined;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function publicInteger(raw: string | null, fallback: number, min: number, max: number) {
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new PublicRequestError(400, 'Parâmetro numérico inválido.');
  return value;
}

export function parseLead(input: unknown, queryId?: string | null) {
  const p = object(input);
  // Valida inclusive aliases preteridos, para não aceitar tipos inesperados.
  const names = ['nome', 'first_name', 'last_name'].map(k => text(p[k], 120));
  const nome = names[0] || [names[1], names[2]].filter(Boolean).join(' ') || 'Lead de Campanha';
  if (nome.length < 2 || nome.length > 120) throw new PublicRequestError(400, 'Nome inválido.');
  const phones = ['telefone', 'celular', 'phone'].map(k => text(p[k], 32));
  const digits = (phones.find(Boolean) || '').replace(/\D/g, '');
  const local = (digits.length === 12 || digits.length === 13) && digits.startsWith('55') ? digits.slice(2) : digits;
  if (!/^[1-9]\d{9,10}$/.test(local)) throw new PublicRequestError(400, 'Telefone inválido.');
  const email = text(p.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicRequestError(400, 'E-mail inválido.');
  const ids = [queryId, p.imovel_id, p.imovel_interesse_id].map(v => text(v, 36)).filter((v): v is string => !!v);
  if (ids.some(id => !UUID_PATTERN.test(id)) || new Set(ids.map(id => id.toLowerCase())).size > 1) {
    throw new PublicRequestError(400, 'Imóvel inválido.');
  }
  const incoming = p.tracking_data == null ? {} : object(p.tracking_data);
  const tracking: Record<string, string> = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'interesse', 'faixa_preco', 'bairro_interesse']) {
    const value = text(incoming[key] ?? p[key], 300);
    if (value) tracking[key] = value;
  }
  return { nome, telefone: `55${local}`, email, imovelId: ids[0]?.toLowerCase(), mensagem: text(p.mensagem, 2000), origem: text(p.origem, 100), assunto: text(p.assunto, 200), tracking };
}

export async function isTrustedIntegration(headers: Headers, expected?: string): Promise<boolean> {
  const got = headers.get('x-n8n-secret');
  if (got === null) return false;
  if (!expected || got.length > 1024) throw new PublicRequestError(401, 'Integração não autorizada.');
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(got), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference !== 0) throw new PublicRequestError(401, 'Integração não autorizada.');
  return true;
}

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: unknown }> };
export async function consumeLeadLimit(client: RpcClient, phone: string, secret: string) {
  if (!secret) throw new PublicRequestError(503, 'Serviço temporariamente indisponível.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`lead:${phone}`)));
  const hash = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  let result;
  try { result = await client.rpc('consume_public_lead_limit', { _subject_hash: hash }); }
  catch { throw new PublicRequestError(503, 'Serviço temporariamente indisponível.'); }
  if (result.error || typeof result.data !== 'boolean') throw new PublicRequestError(503, 'Serviço temporariamente indisponível.');
  if (!result.data) throw new PublicRequestError(429, 'Muitas tentativas. Aguarde alguns minutos.');
}

export function publicLeadResponse(trusted: boolean, details: Record<string, unknown> = {}) {
  return { success: true, message: 'Recebemos seu contato! Em breve alguém falará com você.', ...(trusted ? details : {}) };
}
