// Porte de supabase/functions/_shared/ai/provider.ts: mesmas URLs e corpos, sem retentativa (retries 0, como as funções).
// A chave e o modelo nunca vêm do cliente. Nunca logar a chave, o prompt ou a resposta.

export const OPENAI_COMPAT_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const NATIVE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const MODELO_PADRAO = 'gemini-2.5-flash';
export const TIMEOUT_IA_MS = 90_000;

type FetchImpl = typeof globalThis.fetch;

/** Lida a cada chamada; vazio conta como ausente. */
export function chaveGemini(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

export function modeloRapido(): string {
  return process.env.LOTTI_AI_FAST_MODEL?.trim() || MODELO_PADRAO;
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
  return f(OPENAI_COMPAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${o.chave}`, 'Content-Type': 'application/json' },
    // reasoning_effort 'none' desliga o "thinking" do 2.5-flash: com ele a minuta passava de 90 s
    // e a geração caía em TimeoutError (visto nos logs de gerar-contrato em 2026-10-06).
    body: JSON.stringify({ messages: o.mensagens, stream: false, temperature: o.temperature, model: o.modelo, reasoning_effort: 'none' }),
    signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_IA_MS),
  });
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
  const url = `${NATIVE_BASE_URL}/${encodeURIComponent(o.modelo)}:generateContent?key=${encodeURIComponent(o.chave)}`;
  return f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: o.partes }], generationConfig: o.generationConfig }),
    signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_IA_MS),
  });
}

/** generationConfig da função analisar-contrato. */
export const CONFIG_EXTRACAO = {
  response_mime_type: 'application/json',
  temperature: 0.1,
  // Extração determinística não precisa de "pensamento"; os tokens de raciocínio consumiam o teto.
  thinkingConfig: { thinkingBudget: 0 },
  maxOutputTokens: 8192,
} as const;
