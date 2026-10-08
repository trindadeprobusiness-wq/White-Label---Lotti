import { readPublicJson, PublicRequestError } from '../_shared/public-request.ts';
import {
  buildSummary, getNextQuestion, getQuestions,
  hasRecoverableContact, parseContact, pruneAnswers, scoreLead, segmentLabel,
  validateAnswer,
} from '../_shared/diagnostic/engine.ts';
import type { Answers, Question } from '../_shared/diagnostic/types.ts';
import { drainNotifications, type EmailConfig } from './notifications.ts';
import { enrichSummary } from './ai.ts';
import { credentials, corsHeaders, hash, ipHash, record, response, rpc, tracking, type RpcClient, type Snapshot } from './contracts.ts';

export type DiagnosticEnvironment = Record<string, string | undefined>;
export interface DiagnosticDependencies {
  client: RpcClient;
  env: DiagnosticEnvironment;
  schedule?: (task: Promise<unknown>) => void;
  notificationFetch?: typeof fetch;
  summaryRequest?: Parameters<typeof enrichSummary>[4]['request'];
  now?: () => number;
}

function envNumber(value: string | undefined, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function publicSnapshot(snapshot: Snapshot, nextQuestion?: Question | null) {
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
    next_question: nextQuestion === undefined ? getNextQuestion(snapshot.answers) : nextQuestion,
    summary,
    cta_requested: Array.isArray(events) && events.some(event => event.event_type === 'cta_clicked'),
  };
}

function queueNotifications(deps: DiagnosticDependencies, sessionId?: string) {
  const { env } = deps;
  const config: EmailConfig = {
    provider: env.EMAIL_PROVIDER || 'resend',
    apiKey: env.EMAIL_API_KEY || env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    to: env.LEAD_NOTIFICATION_EMAIL,
    publicUrl: env.DIAGNOSTIC_PUBLIC_URL,
    fetch: deps.notificationFetch,
  };
  const work = drainNotifications(deps.client, config, sessionId).catch(() => ({ sent: 0, failed: 0 }));
  if (deps.schedule) deps.schedule(work);
  else return work;
  return Promise.resolve({ sent: 0, failed: 0 });
}

function contactFields(answers: Answers, previous: Record<string, string | null> | null) {
  const name = typeof answers.name === 'string' ? answers.name.trim() : previous?.name ?? 'Contato por e-mail';
  const raw = typeof answers.contact === 'string' ? answers.contact : null;
  if (!raw) return { name, phone: previous?.phone ?? null, email: previous?.email ?? null };
  try {
    const parsed = parseContact(raw);
    return { name, phone: parsed.phone, email: parsed.email };
  } catch { throw new PublicRequestError(400, 'Informe um WhatsApp ou e-mail válido.'); }
}

function answerPayload(answers: Answers, snapshot: Snapshot, questionId: string, edited: boolean) {
  const questions = getQuestions(answers);
  const serialized = questions.flatMap((question, position) => {
    const value = answers[question.id];
    if (value === undefined) return [];
    return [{ question_id: question.id, question: question.prompt, answer: value, position }];
  });
  const recovered = hasRecoverableContact(answers) || Boolean(snapshot.lead?.email || (snapshot.lead?.phone && snapshot.lead?.name));
  const lead = contactFields(answers, snapshot.lead);
  const score = scoreLead(answers);
  return {
    question_id: questionId, edited, answers: serialized, recoverable: recovered,
    lead: {
      ...lead,
      company: typeof answers.company === 'string' ? answers.company : snapshot.lead?.company ?? null,
      segment: typeof answers.segment === 'string' ? answers.segment : snapshot.lead?.segment ?? null,
      city: typeof answers.city === 'string' ? answers.city : snapshot.lead?.city ?? null,
    },
    score: score.score,
    temperature: score.temperature,
  };
}

function validateHoneypot(value: unknown) {
  if (value == null || value === '') return false;
  if (typeof value !== 'string' || value.length > 500) throw new PublicRequestError(400, 'Requisição inválida.');
  return true;
}

function handleError(error: unknown) {
  if (error instanceof PublicRequestError) return response({ error: error.message }, error.status);
  const reason = error instanceof Error ? error.message : '';
  if (reason.includes('consent_required')) return response({ error: 'Confirme a política de privacidade para continuar.' }, 400);
  if (reason.includes('invalid_action')) return response({ error: 'Ação inválida.' }, 400);
  if (reason.includes('contact_required')) return response({ error: 'Informe um contato antes de concluir.' }, 400);
  if (reason.includes('diagnostic_database_error')) return response({ error: 'Diagnóstico temporariamente indisponível. Tente novamente.' }, 503);
  if (error instanceof Error && error.message.startsWith('Escolha') || error instanceof Error && /^(Confira|Informe|Preencha|Me conta|Use)/.test(error.message)) {
    return response({ error: error.message.slice(0, 250) }, 400);
  }
  return response({ error: 'Não foi possível salvar sua resposta. Tente novamente.' }, 500);
}

/** HTTP entry point is dependency-injected so requests can be exercised against PostgreSQL locally. */
export function createDiagnosticHandler(deps: DiagnosticDependencies) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== 'POST') return response({ error: 'Método não permitido.' }, 405);
    try {
      const input = record(await readPublicJson(request, 16_384));
      const { id: sessionId, token } = credentials(input);
      const action = input.action;
      if (!['start', 'resume', 'answer', 'complete', 'cta'].includes(String(action))) throw new PublicRequestError(400, 'Ação inválida.');
      const spam = validateHoneypot(input.honeypot);
      if (spam) throw new PublicRequestError(400, 'Não foi possível iniciar este diagnóstico.');

      const hashedToken = await hash(token.toLowerCase());
      const addressHash = await ipHash(request, deps.env.DIAGNOSTIC_RATE_LIMIT_SECRET || deps.env.SUPABASE_SERVICE_ROLE_KEY || '');
      const allowed = await rpc(deps.client, 'diagnostic_consume_limit', {
        p_ip_hash: addressHash, p_session: sessionId, p_start: action === 'start',
      });
      if (allowed !== true) throw new PublicRequestError(429, 'Muitas tentativas. Aguarde um pouco e tente novamente.');

      let snapshot: Snapshot;
      if (action === 'start') {
        if (input.consent !== true) throw new PublicRequestError(400, 'Confirme a política de privacidade para começar.');
        const source = tracking(input.tracking);
        snapshot = await rpc(deps.client, 'diagnostic_mutate', {
          p_session: sessionId, p_token_hash: hashedToken, p_action: 'start', p_version: null,
          p_payload: { consent: true, tracking: source },
        }) as Snapshot;
        await queueNotifications(deps, sessionId);
        return response(publicSnapshot(snapshot));
      }

      snapshot = await rpc(deps.client, 'diagnostic_mutate', {
        p_session: sessionId, p_token_hash: hashedToken, p_action: 'read', p_version: null,
      }) as Snapshot;
      if (action === 'resume') {
        snapshot = await rpc(deps.client, 'diagnostic_mutate', {
          p_session: sessionId, p_token_hash: hashedToken, p_action: 'resume', p_version: null,
        }) as Snapshot;
        return response(publicSnapshot(snapshot));
      }
      if (action === 'cta') {
        snapshot = await rpc(deps.client, 'diagnostic_mutate', {
          p_session: sessionId, p_token_hash: hashedToken, p_action: 'cta', p_version: null,
        }) as Snapshot;
        return response(publicSnapshot(snapshot, null));
      }
      if (snapshot.session.status === 'completed') return response(publicSnapshot(snapshot, null), 409);

      const inputVersion = input.version;
      if (!Number.isSafeInteger(inputVersion) || inputVersion !== snapshot.session.version) {
        throw new PublicRequestError(409, 'Sua conversa foi atualizada em outra aba. Retome as respostas salvas.');
      }
      let updated = snapshot.answers;

      if (action === 'answer') {
        if (typeof input.question_id !== 'string' || input.question_id.length > 100) throw new PublicRequestError(400, 'Pergunta inválida.');
        const question = getQuestions(snapshot.answers).find(item => item.id === input.question_id);
        if (!question) throw new PublicRequestError(400, 'Esta etapa não pertence a esta conversa.');
        const next = getNextQuestion(snapshot.answers);
        const isCurrent = next?.id === question.id;
        const isEdit = Object.hasOwn(snapshot.answers, question.id);
        if (!isCurrent && !isEdit) throw new PublicRequestError(409, 'Responda a etapa anterior antes de continuar.');
        const normalized = validateAnswer(question, input.answer);
        updated = pruneAnswers(snapshot.answers, question.id, normalized);
        const payload = answerPayload(updated, snapshot, question.id, isEdit);
        // The database transaction is the source of truth; never advance the UI before it commits.
        snapshot = await rpc(deps.client, 'diagnostic_mutate', {
          p_session: sessionId, p_token_hash: hashedToken, p_action: 'answer',
          p_version: inputVersion, p_payload: payload,
        }) as Snapshot;
        if (snapshot.lead?.id || hasRecoverableContact(updated)) await queueNotifications(deps, sessionId);
        return response(publicSnapshot(snapshot));
      }

      if (action === 'complete') {
        if (getNextQuestion(snapshot.answers)) throw new PublicRequestError(400, 'Conclua as perguntas antes de ver o diagnóstico.');
        if (!snapshot.lead?.id) throw new PublicRequestError(400, 'Informe um contato antes de concluir.');
        const score = scoreLead(snapshot.answers);
        const fallback = buildSummary(snapshot.answers);
        const enriched = await enrichSummary(deps.client, sessionId, snapshot.answers, fallback, {
          enabled: deps.env.DIAGNOSTIC_AI_ENABLED === 'true',
          dailyLimit: envNumber(deps.env.DIAGNOSTIC_AI_DAILY_LIMIT, 100, 1000),
          request: deps.summaryRequest,
        });
        const storedSummary = {
          ...enriched,
          summary: enriched.summary.slice(0, 1400),
          user_message: fallback.user_message,
        };
        snapshot = await rpc(deps.client, 'diagnostic_mutate', {
          p_session: sessionId, p_token_hash: hashedToken, p_action: 'complete',
          p_version: inputVersion, p_payload: { summary: storedSummary, score: score.score, temperature: score.temperature },
        }) as Snapshot;
        await queueNotifications(deps, sessionId);
        return response(publicSnapshot(snapshot, null));
      }
      return response({ error: 'Ação inválida.' }, 400);
    } catch (error) { return handleError(error); }
  };
}

export async function runDiagnosticMaintenance(deps: DiagnosticDependencies) {
  const abandoned = await rpc(deps.client, 'diagnostic_maintenance') as number;
  const notifications = await queueNotifications(deps);
  return { abandoned, notifications };
}
