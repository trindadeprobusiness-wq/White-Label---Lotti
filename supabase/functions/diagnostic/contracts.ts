import { PublicRequestError, UUID_PATTERN } from '../_shared/public-request.ts';
import type { Answers, DiagnosticSummary } from '../_shared/diagnostic/types.ts';

export interface RpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}
export interface Snapshot {
  session: { id: string; status: string; started_at: string; last_activity_at: string; completed_at: string | null; version: number; score?: number; temperature?: string; source?: string; [key: string]: unknown };
  answers: Answers;
  summary: DiagnosticSummary | null;
  lead: Record<string, string | null> | null;
  events?: { event_type: string }[];
}
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
export function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(status === 429 ? { 'Retry-After': '3600' } : {}) } });
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicRequestError(400, 'Dados inválidos.');
  return value as Record<string, unknown>;
}
export function credentials(body: Record<string, unknown>) {
  if (typeof body.session_id !== 'string' || !UUID_PATTERN.test(body.session_id) || typeof body.token !== 'string' || !(/^[a-f0-9]{64}$/i.test(body.token) || UUID_PATTERN.test(body.token)) || body.token === body.session_id) {
    throw new PublicRequestError(400, 'Sessão inválida.');
  }
  return { id: body.session_id.toLowerCase(), token: body.token };
}
export function tracking(value: unknown) {
  const input = value == null ? {} : record(value);
  const result: Record<string, string> = {};
  for (const key of ['source','utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
    if (input[key] == null) continue;
    if (typeof input[key] !== 'string' || (input[key] as string).length > 300) throw new PublicRequestError(400, 'Origem inválida.');
    // Strip control characters before persisting attribution values.
    // eslint-disable-next-line no-control-regex
    result[key] = (input[key] as string).replace(/[\u0000-\u001f<>]/g, '').trim();
  }
  if (input.referrer) {
    if (typeof input.referrer !== 'string' || input.referrer.length > 2048) throw new PublicRequestError(400, 'Origem inválida.');
    try {
      const url = new URL(input.referrer);
      if (['http:','https:'].includes(url.protocol)) result.referrer = `${url.origin}${url.pathname}`.slice(0, 500);
    } catch { /* An invalid optional referrer is discarded. */ }
  }
  result.source ||= result.utm_source || (result.referrer ? new URL(result.referrer).hostname : 'direct');
  return result;
}
export async function hash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
export async function ipHash(req: Request, secret: string) {
  if (!secret) throw new PublicRequestError(503, 'Diagnóstico temporariamente indisponível.');
  // Supabase gateway populates x-forwarded-for. Raw addresses are never persisted.
  const ip = (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || 'unknown').slice(0, 64);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
export async function rpc(client: RpcClient, name: string, args: Record<string, unknown> = {}) {
  let result;
  try { result = await client.rpc(name, args); }
  catch { throw new Error('diagnostic_database_error'); }
  if (result.error) {
    const reason = result.error.message || '';
    if (reason.includes('invalid_session')) throw new PublicRequestError(404, 'Sessão não encontrada.');
    if (reason.includes('version_conflict')) throw new PublicRequestError(409, 'Sua conversa foi atualizada. Retome a sessão e tente novamente.');
    if (reason.includes('session_completed')) throw new PublicRequestError(409, 'Este diagnóstico já foi concluído.');
    throw new Error('diagnostic_database_error');
  }
  return result.data;
}
