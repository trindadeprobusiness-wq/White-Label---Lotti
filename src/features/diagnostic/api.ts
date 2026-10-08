import { z } from 'zod';
import type { Question, DiagnosticSummary } from '../../../supabase/functions/_shared/diagnostic/types';

const STORAGE_KEY = 'gt:diagnostic:session:v1';
const identitySchema = z.object({
  session_id: z.string().uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

const questionSchema = z.object({
  id: z.string().min(1).max(100),
  prompt: z.string().min(1).max(1200),
  type: z.enum(['text', 'single', 'multi', 'contact']),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  placeholder: z.string().optional(),
  hint: z.string().optional(),
  optional: z.boolean().optional(),
  maxLength: z.number().optional(),
});

const responseSchema = z.object({
  session: z.object({
    id: z.string().uuid(),
    status: z.enum(['started', 'contact_captured', 'in_progress', 'completed', 'abandoned']),
    started_at: z.string(),
    last_activity_at: z.string(),
    version: z.number().int().nonnegative(),
    completed_at: z.string().nullable().optional(),
  }),
  answers: z.record(z.union([z.string(), z.array(z.string())])),
  next_question: questionSchema.nullable(),
  summary: z.object({
    summary: z.string(),
    primary_bottleneck: z.string(),
    secondary_bottleneck: z.string().nullable().optional(),
    recommended_next_step: z.string(),
    user_message: z.string(),
    source: z.string().optional(),
  }).nullable(),
  cta_requested: z.boolean().default(false),
});

export interface DiagnosticIdentity { session_id: string; token: string }
export interface DiagnosticResponse {
  session: { id: string; status: 'started' | 'contact_captured' | 'in_progress' | 'completed' | 'abandoned'; started_at: string; last_activity_at: string; completed_at?: string | null; version: number };
  answers: Record<string, string | string[]>;
  next_question: Question | null;
  summary: DiagnosticSummary | null;
  cta_requested: boolean;
}
export type DiagnosticQuestion = Question;
export type DiagnosticAnswer = string | string[];

export class DiagnosticApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

/** Only the opaque session credentials are kept in this browser. Answers stay on the server. */
export function readDiagnosticIdentity(): DiagnosticIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = identitySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data as DiagnosticIdentity : null;
  } catch { return null; }
}

export function createDiagnosticIdentity(): DiagnosticIdentity {
  const existing = readDiagnosticIdentity();
  if (existing) return existing;
  const identity = {
    session_id: crypto.randomUUID(),
    token: `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ''),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(identity)); }
  catch {
    throw new DiagnosticApiError('Ative o armazenamento deste navegador para salvar e retomar seu diagnóstico.');
  }
  return identity;
}

export function forgetDiagnosticIdentity() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Browser storage may be unavailable. */ }
}

export function diagnosticTracking() {
  const params = new URLSearchParams(window.location.search);
  const tracking: Record<string, string> = {};
  for (const key of ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = params.get(key)?.trim().slice(0, 200);
    if (value) tracking[key] = value;
  }
  // Referrer queries can contain personal data or authorization tokens.
  if (document.referrer) {
    try { const url = new URL(document.referrer); tracking.referrer = `${url.origin}${url.pathname}`.slice(0, 500); }
    catch { /* An invalid referrer adds no useful attribution. */ }
  }
  return tracking;
}

export async function diagnosticRequest(
  identity: DiagnosticIdentity,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<DiagnosticResponse> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '');
  const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !publicKey) {
    throw new DiagnosticApiError('O diagnóstico está temporariamente indisponível. Tente novamente em alguns minutos.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = window.setTimeout(abort, 25000);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${baseUrl}/functions/v1/diagnostic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: publicKey },
      body: JSON.stringify({ ...payload, ...identity }),
      signal: controller.signal,
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      if (response.status === 429) throw new DiagnosticApiError('Vamos com calma. Aguarde um minuto e tente novamente.', 429);
      if (response.status === 401 || response.status === 403) throw new DiagnosticApiError('Não foi possível acessar esta sessão. Você pode iniciar um novo diagnóstico.', response.status);
      if (response.status === 404) throw new DiagnosticApiError('Esta sessão ainda não foi encontrada. Tente iniciar o diagnóstico novamente.', 404);
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && response.status === 400
        ? body.error.slice(0, 250)
        : 'Não conseguimos salvar agora. Sua resposta continua aqui. Tente novamente.';
      throw new DiagnosticApiError(message, response.status);
    }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new DiagnosticApiError('Não conseguimos carregar a próxima etapa. Tente novamente; suas respostas já enviadas permanecem salvas.');
    return parsed.data as DiagnosticResponse;
  } catch (error) {
    if (error instanceof DiagnosticApiError) throw error;
    if (signal?.aborted) throw error;
    throw new DiagnosticApiError('A conexão demorou ou foi interrompida. Confira sua internet e tente novamente.');
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
