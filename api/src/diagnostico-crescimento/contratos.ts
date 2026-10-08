import { createHash, createHmac } from 'node:crypto';
import type { Answers, DiagnosticSummary, Question } from './motor/types';
import { getNextQuestion } from './motor/engine';

/**
 * Porte de supabase/functions/diagnostic/contracts.ts (commit 204e0e0) para a API.
 *
 * As respostas públicas mantêm o formato da Edge Function: corpo `{ error }` com o status dela,
 * e o snapshot público (sem score, temperatura nem token). Só muda quem fala com o banco:
 * a conexão da API (dona das tabelas), no lugar do service_role do PostgREST.
 */

/** Erro com status e texto para o visitante (PublicRequestError da Edge Function). */
export class ErroPublico extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Snapshot {
  session: {
    id: string; status: string; started_at: string; last_activity_at: string; completed_at: string | null;
    version: number; score?: number; temperature?: string; source?: string; [key: string]: unknown;
  };
  answers: Answers;
  summary: DiagnosticSummary | null;
  lead: Record<string, string | null> | null;
  events?: { event_type: string }[];
}

/** Resposta pronta para o controller: status HTTP e corpo JSON. */
export interface RespostaPublica {
  status: number;
  corpo: unknown;
}

export const resposta = (corpo: unknown, status = 200): RespostaPublica => ({ status, corpo });

export function registro(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new ErroPublico(400, 'Dados inválidos.');
  return valor as Record<string, unknown>;
}

export function credenciais(corpo: Record<string, unknown>): { id: string; token: string } {
  if (typeof corpo.session_id !== 'string' || !UUID.test(corpo.session_id) || typeof corpo.token !== 'string'
    || !(/^[a-f0-9]{64}$/i.test(corpo.token) || UUID.test(corpo.token)) || corpo.token === corpo.session_id) {
    throw new ErroPublico(400, 'Sessão inválida.');
  }
  return { id: corpo.session_id.toLowerCase(), token: corpo.token };
}

export function origem(valor: unknown): Record<string, string> {
  const entrada = valor == null ? {} : registro(valor);
  const resultado: Record<string, string> = {};
  for (const chave of ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (entrada[chave] == null) continue;
    if (typeof entrada[chave] !== 'string' || (entrada[chave] as string).length > 300) throw new ErroPublico(400, 'Origem inválida.');
    // Tira caracteres de controle antes de gravar a atribuição.
    // eslint-disable-next-line no-control-regex
    resultado[chave] = (entrada[chave] as string).replace(/[\u0000-\u001f<>]/g, '').trim();
  }
  if (entrada.referrer) {
    if (typeof entrada.referrer !== 'string' || entrada.referrer.length > 2048) throw new ErroPublico(400, 'Origem inválida.');
    try {
      const url = new URL(entrada.referrer);
      if (['http:', 'https:'].includes(url.protocol)) resultado.referrer = `${url.origin}${url.pathname}`.slice(0, 500);
    } catch { /* Referrer opcional inválido é descartado. */ }
  }
  resultado.source ||= resultado.utm_source || (resultado.referrer ? new URL(resultado.referrer).hostname : 'direct');
  return resultado;
}

export function sha256(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

/**
 * HMAC do IP: o endereço cru nunca é gravado. Sem segredo, a rota responde 503 (como a Edge sem
 * DIAGNOSTIC_RATE_LIMIT_SECRET nem service key).
 */
export function hashDoIp(ip: string | null, segredo: string): string {
  if (!segredo) throw new ErroPublico(503, 'Diagnóstico temporariamente indisponível.');
  return createHmac('sha256', segredo).update((ip || 'unknown').slice(0, 64), 'utf8').digest('hex');
}

/** O que o visitante vê: sem score, temperatura, lead, token nem payload da IA. */
export function snapshotPublico(snapshot: Snapshot, proxima?: Question | null) {
  const { id, status, started_at, last_activity_at, completed_at, version } = snapshot.session;
  const summary = snapshot.summary ? {
    summary: snapshot.summary.summary,
    primary_bottleneck: snapshot.summary.primary_bottleneck,
    secondary_bottleneck: snapshot.summary.secondary_bottleneck,
    recommended_next_step: snapshot.summary.recommended_next_step,
    user_message: snapshot.summary.user_message,
    source: snapshot.summary.source,
  } : null;
  const events = snapshot.events;
  return {
    session: { id, status, started_at, last_activity_at, completed_at, version },
    answers: snapshot.answers,
    next_question: proxima === undefined ? getNextQuestion(snapshot.answers) : proxima,
    summary,
    cta_requested: Array.isArray(events) && events.some((e) => e.event_type === 'cta_clicked'),
  };
}
