/** Token do Nest para trocar o fetch global nos testes (opcional: sem provider, usa o fetch do Node). */
export const FETCH_ROTINA = Symbol('FETCH_ROTINA');
export type Fetcher = typeof fetch;

const esperarPadrao = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const TEMPORARIOS = [408, 429, 500, 502, 503, 504];

/** Porte de googleRequest: Authorization + JSON e backoff exponencial em falhas temporárias. */
export async function googleRequest(
  fetcher: Fetcher,
  accessToken: string,
  url: string,
  init: RequestInit = {},
  retries = 2,
  esperar: (ms: number) => Promise<void> = esperarPadrao,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetcher(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string> | undefined) || {}),
      },
    });
    if (attempt >= retries || !TEMPORARIOS.includes(response.status)) return response;
    await response.body?.cancel().catch(() => undefined);
    await esperar(300 * (2 ** attempt) + Math.floor(Math.random() * 100));
  }
}

export function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : 'unknown';
  return /^[a-z0-9_]{1,80}$/i.test(value) ? value : 'unexpected_error';
}
