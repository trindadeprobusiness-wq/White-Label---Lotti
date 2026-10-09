import { chaveGemini, comModeloReserva, juntarSinais, modeloRapido, NATIVE_BASE_URL, OPENAI_COMPAT_URL } from '../contratos/ia/gemini';

// Porte de supabase/functions/_shared/ai/provider.ts para as funções de IA gerais (assistente, fotos,
// WhatsApp, Inbox). Reaproveita chave, modelo e URLs de contratos/ia/gemini.ts (mesma leitura de env).
// A chave e o modelo nunca vêm do cliente. Nunca logar a chave, o prompt ou a resposta.

export { chaveGemini, modeloRapido };

export type FetchImpl = typeof globalThis.fetch;

/** Mesma política de requestWithPolicy: timeout entre 1 s e 120 s, até 2 retentativas. */
export interface PoliticaIa {
  timeoutMs?: number;
  retries?: number;
  /** Cancela a chamada (ex.: o navegador fechou o stream do assistente). */
  sinal?: AbortSignal;
}

function repetivel(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function comPolitica(fetchImpl: FetchImpl, url: string, init: RequestInit, politica: PoliticaIa = {}): Promise<Response> {
  const retries = Math.max(0, Math.min(politica.retries ?? 0, 2));
  const timeoutMs = Math.max(1_000, Math.min(politica.timeoutMs ?? 45_000, 120_000));
  for (let tentativa = 0; ; tentativa++) {
    const tempo = AbortSignal.timeout(timeoutMs);
    const signal = politica.sinal ? AbortSignal.any([tempo, politica.sinal]) : tempo;
    try {
      const resposta = await fetchImpl(url, { ...init, signal });
      if (tentativa >= retries || !repetivel(resposta.status)) return resposta;
      await resposta.body?.cancel().catch(() => undefined);
    } catch (e) {
      if (tentativa >= retries || politica.sinal?.aborted) throw e;
    }
    await esperar(250 * (tentativa + 1));
  }
}

export interface OpcoesIa {
  chave: string;
  modelo: string;
  corpo: Record<string, unknown>;
  politica?: PoliticaIa;
  fetchImpl?: FetchImpl;
}

/**
 * Endpoint OpenAI-compatible. O corpo é o da função; o servidor fixa o modelo e, como o chatGemini
 * de contratos, manda reasoning_effort 'none' (sem "thinking": menos latência e nada de timeout).
 */
export function chatIa(o: OpcoesIa): Promise<Response> {
  // Com stream o prazo do principal cortaria a resposta no meio: o assistente vigia o primeiro pedaço.
  const reserva = o.corpo.stream === true ? {} : { prazoPrincipalMs: prazoPrincipal(o.politica) };
  return comModeloReserva(o.modelo, (modelo, prazo) => comPolitica(o.fetchImpl ?? ((...a) => globalThis.fetch(...a)), OPENAI_COMPAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...o.corpo, model: modelo, reasoning_effort: 'none' }),
  }, { ...o.politica, sinal: juntarSinais(o.politica?.sinal, prazo) }), reserva);
}

/** Endpoint multimodal nativo (generateContent): corpo da função, sem mexer. */
export function conteudoIa(o: OpcoesIa): Promise<Response> {
  return comModeloReserva(o.modelo, (modelo, prazo) => comPolitica(o.fetchImpl ?? ((...a) => globalThis.fetch(...a)), `${NATIVE_BASE_URL}/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(o.chave)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(o.corpo),
  }, { ...o.politica, sinal: juntarSinais(o.politica?.sinal, prazo) }), { prazoPrincipalMs: prazoPrincipal(o.politica) });
}

/** Metade do tempo da chamada, no máximo 20 s: travou, o reserva ainda tem o tempo inteiro dele. */
export const PRAZO_PRINCIPAL_MAX_MS = 20_000;
function prazoPrincipal(politica: PoliticaIa = {}): number {
  const total = Math.max(1_000, Math.min(politica.timeoutMs ?? 45_000, 120_000));
  return Math.min(PRAZO_PRINCIPAL_MAX_MS, Math.floor(total / 2));
}

function numeroDoAmbiente(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  const n = Number(bruto);
  return bruto !== undefined && bruto.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : padrao;
}

/** Estimativa operacional para texto (estimateTextUsage); o faturamento real é a autoridade. */
export function estimarUso(inputChars: number, outputChars: number) {
  const inputTokens = Math.ceil(Math.max(inputChars, 0) / 4);
  const outputTokens = Math.ceil(Math.max(outputChars, 0) / 4);
  const entrada = numeroDoAmbiente('LOTTI_AI_INPUT_USD_PER_MTOK', 0.3);
  const saida = numeroDoAmbiente('LOTTI_AI_OUTPUT_USD_PER_MTOK', 2.5);
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens * entrada + outputTokens * saida) / 1_000_000,
  };
}

/** Texto da 1ª parte de uma resposta generateContent, sem cercas de código. */
export function textoDoConteudo(data: unknown): string {
  const d = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> } | null;
  const texto = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  return (typeof texto === 'string' ? texto : '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}
