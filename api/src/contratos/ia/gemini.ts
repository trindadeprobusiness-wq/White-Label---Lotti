import { Logger } from '@nestjs/common';
// Porte de supabase/functions/_shared/ai/provider.ts: mesmas URLs e corpos, sem retentativa (retries 0, como as funções).
// A chave e o modelo nunca vêm do cliente. Nunca logar a chave, o prompt ou a resposta.

export const OPENAI_COMPAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const NATIVE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// O gemini-2.5-flash não é mais liberado para projetos novos do Google (404 "no longer available to
// new users", visto em 2026-10-07 com a chave nova).
// Em 2026-10-08 o 3.8-flash ficou 60 s sem mandar nada nas duas perguntas do assistente, e o
// 3.1-flash-lite respondeu a mesma pergunta em 2 s. Por isso o que é conversa (assistente, WhatsApp,
// fotos, diagnóstico, rotina) usa o lite primeiro, e o 3.8-flash fica com os contratos (minuta e
// análise), onde a qualidade pesa mais que alguns segundos. Um é a reserva do outro.
export const MODELO_PADRAO = 'gemini-3.8-flash';
export const MODELO_RAPIDO = 'gemini-3.1-flash-lite';
/** Reserva do MODELO_PADRAO (mantido para quem importava o nome antigo). */
export const MODELO_RESERVA = MODELO_RAPIDO;
const STATUS_RESERVA = new Set([404, 429, 500, 502, 503, 504]);
export const TIMEOUT_IA_MS = 90_000;
/** Contratos: o principal tem até 45 s dos 90; travou, o reserva ainda tem tempo. */
export const PRAZO_PRINCIPAL_CONTRATO_MS = 45_000;

type FetchImpl = typeof globalThis.fetch;
const log = new Logger('IaModelo');

/** Lida a cada chamada; vazio conta como ausente. */
export function chaveGemini(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

/** Conversas e respostas curtas (assistente, WhatsApp, fotos, diagnóstico, rotina). */
export function modeloRapido(): string {
  return process.env.LOTTI_AI_FAST_MODEL?.trim() || MODELO_RAPIDO;
}

/** Minuta e análise de contrato. */
export function modeloContrato(): string {
  return process.env.LOTTI_AI_MODEL?.trim() || MODELO_PADRAO;
}

/** Reserva de `principal`: LOTTI_AI_FALLBACK_MODEL (off desliga) ou o outro dos dois modelos. */
export function modeloReserva(principal?: string): string {
  const v = process.env.LOTTI_AI_FALLBACK_MODEL?.trim();
  if (v === 'off') return '';
  if (v) return v;
  return principal === MODELO_RAPIDO ? MODELO_PADRAO : MODELO_RAPIDO;
}

/** Junta dois sinais de cancelamento (qualquer um cancela). */
export function juntarSinais(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  return a && b ? AbortSignal.any([a, b]) : a ?? b;
}

export interface OpcoesReserva {
  /**
   * Tempo do modelo principal antes de passar para o reserva. Só para chamadas SEM stream: o sinal
   * também cobre a leitura do corpo, e num stream cortaria uma resposta longa no meio.
   */
  prazoPrincipalMs?: number;
}

/**
 * Chama com o modelo pedido e, se ele responder indisponível/sobrecarregado (ou, com prazoPrincipalMs,
 * não responder a tempo), uma vez com o reserva. O tempo total e o cancelamento de quem pediu sobem
 * como erro, sem reserva.
 */
export async function comModeloReserva(
  modelo: string,
  chamar: (modelo: string, sinal?: AbortSignal) => Promise<Response>,
  o: OpcoesReserva = {},
): Promise<Response> {
  const reserva = modeloReserva(modelo);
  const temReserva = !!reserva && reserva !== modelo;
  const prazo = temReserva && o.prazoPrincipalMs ? AbortSignal.timeout(o.prazoPrincipalMs) : undefined;
  let resposta: Response;
  try {
    resposta = await chamar(modelo, prazo);
  } catch (e) {
    if (!prazo?.aborted) throw e;
    log.warn(`IA_RESERVA modelo=${modelo} motivo=prazo`);
    return chamar(reserva);
  }
  if (!STATUS_RESERVA.has(resposta.status) || !temReserva) return resposta;
  log.warn(`IA_RESERVA modelo=${modelo} motivo=status_${resposta.status}`);
  await resposta.body?.cancel().catch(() => undefined);
  return chamar(reserva);
}

export interface OpcoesChat {
  chave: string;
  modelo: string;
  mensagens: Array<{ role: string; content: string }>;
  temperature: number;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
}

/** Endpoint OpenAI-compatible (gerar-contrato). Timeout e erro de rede sobem como exceção. */
export function chatGemini(o: OpcoesChat): Promise<Response> {
  const f = o.fetchImpl ?? globalThis.fetch;
  return comModeloReserva(o.modelo, (modelo, prazo) => f(OPENAI_COMPAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.chave}`, 'Content-Type': 'application/json' },
    // reasoning_effort 'none' desliga o "thinking" do 2.5-flash: com ele a minuta passava de 90 s
    // e a geração caía em TimeoutError (visto nos logs de gerar-contrato em 2026-10-06).
    body: JSON.stringify({ messages: o.mensagens, stream: false, temperature: o.temperature, model: modelo, reasoning_effort: 'none' }),
    signal: juntarSinais(AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_IA_MS), prazo),
  }), { prazoPrincipalMs: Math.min(PRAZO_PRINCIPAL_CONTRATO_MS, Math.floor((o.timeoutMs ?? TIMEOUT_IA_MS) / 2)) });
}

export interface OpcoesConteudo {
  chave: string;
  modelo: string;
  partes: unknown[];
  generationConfig: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
}

/** Endpoint multimodal nativo (analisar-contrato). */
export function conteudoGemini(o: OpcoesConteudo): Promise<Response> {
  const f = o.fetchImpl ?? globalThis.fetch;
  return comModeloReserva(o.modelo, (modelo, prazo) => f(`${NATIVE_BASE_URL}/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(o.chave)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: o.partes }], generationConfig: o.generationConfig }),
    signal: juntarSinais(AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_IA_MS), prazo),
  }), { prazoPrincipalMs: Math.min(PRAZO_PRINCIPAL_CONTRATO_MS, Math.floor((o.timeoutMs ?? TIMEOUT_IA_MS) / 2)) });
}

/** generationConfig da função analisar-contrato. */
export const CONFIG_EXTRACAO = {
  response_mime_type: 'application/json',
  temperature: 0.1,
  // Extração determinística não precisa de "pensamento"; os tokens de raciocínio consumiam o teto.
  thinkingConfig: { thinkingBudget: 0 },
  maxOutputTokens: 8192,
} as const;
