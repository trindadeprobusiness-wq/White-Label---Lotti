declare const Deno: { env: { get(name: string): string | undefined } };

const OPENAI_COMPAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const NATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

export interface AIProviderPolicy {
  timeoutMs?: number;
  retries?: number;
}

export interface AIProvider {
  readonly name: string;
  model(): string;
  chat(payload: Record<string, unknown>, policy?: AIProviderPolicy): Promise<Response>;
  generateContent(payload: Record<string, unknown>, policy?: AIProviderPolicy): Promise<Response>;
}

function apiKey(): string {
  const value = Deno.env.get("GEMINI_API_KEY");
  if (!value) throw new Error("GEMINI_API_KEY not configured");
  return value;
}

export function fastAIModel(): string {
  return Deno.env.get("LOTTI_AI_FAST_MODEL")?.trim() || DEFAULT_MODEL;
}

function positiveEnvNumber(name: string, fallback: number): number {
  const parsed = Number(Deno.env.get(name));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Estimativa operacional para texto; o faturamento real é a autoridade. */
export function estimateTextUsage(inputChars: number, outputChars: number) {
  const inputTokens = Math.ceil(Math.max(inputChars, 0) / 4);
  const outputTokens = Math.ceil(Math.max(outputChars, 0) / 4);
  const inputUsdPerMillion = positiveEnvNumber("LOTTI_AI_INPUT_USD_PER_MTOK", 0.30);
  const outputUsdPerMillion = positiveEnvNumber("LOTTI_AI_OUTPUT_USD_PER_MTOK", 2.50);
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens * inputUsdPerMillion + outputTokens * outputUsdPerMillion) / 1_000_000,
  };
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function requestWithPolicy(
  url: string,
  init: RequestInit,
  policy: AIProviderPolicy,
): Promise<Response> {
  const retries = Math.max(0, Math.min(policy.retries ?? 0, 2));
  const timeoutMs = Math.max(1_000, Math.min(policy.timeoutMs ?? 45_000, 120_000));

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (attempt >= retries || !retryable(response.status)) return response;
      await response.body?.cancel();
    } catch (error) {
      if (attempt >= retries) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
}

/** Endpoint OpenAI-compatible; modelo e chave nunca são aceitos do cliente. */
export class GeminiProvider implements AIProvider {
  readonly name = "google";

  model(): string {
    return fastAIModel();
  }

  chat(payload: Record<string, unknown>, policy: AIProviderPolicy = {}): Promise<Response> {
    return requestWithPolicy(OPENAI_COMPAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...payload, model: this.model() }),
    }, policy);
  }

  generateContent(payload: Record<string, unknown>, policy: AIProviderPolicy = {}): Promise<Response> {
    const model = encodeURIComponent(this.model());
    const url = `${NATIVE_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey())}`;
    return requestWithPolicy(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, policy);
  }
}

export const aiProvider: AIProvider = new GeminiProvider();

export function requestGeminiChat(
  payload: Record<string, unknown>,
  policy: AIProviderPolicy = {},
): Promise<Response> {
  return aiProvider.chat(payload, policy);
}

/** Endpoint multimodal nativo; centraliza segredo, modelo, timeout e retentativas. */
export function requestGeminiContent(
  payload: Record<string, unknown>,
  policy: AIProviderPolicy = {},
): Promise<Response> {
  return aiProvider.generateContent(payload, policy);
}
