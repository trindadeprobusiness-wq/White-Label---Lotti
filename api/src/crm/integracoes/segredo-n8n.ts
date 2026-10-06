import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Segredo compartilhado com o n8n (cabeçalho x-n8n-secret), o mesmo N8N_SHARED_SECRET das Edge
 * Functions. Lido a cada uso (os testes trocam a variável) e nunca registrado em log.
 */
export const VAR_SEGREDO_N8N = 'N8N_SHARED_SECRET';
export const CABECALHO_SEGREDO_N8N = 'x-n8n-secret';

export function segredoN8nConfigurado(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env[VAR_SEGREDO_N8N];
  return v ? v : null;
}

/** Comparação em tempo constante sobre o SHA-256 dos dois lados (tamanhos diferentes não vazam). */
export function segredoConfere(recebido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

/** Primeiro valor de um cabeçalho do Express (string | string[] | undefined). */
export function cabecalho(valor: string | string[] | undefined): string | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return typeof valor === 'string' ? valor : null;
}
