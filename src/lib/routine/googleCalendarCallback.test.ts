import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * O callback OAuth do Google Agenda precisa existir num domínio da Lotti.
 *
 * MOTIVO: enquanto a marca não está verificada, o Google mostra na tela de
 * consentimento o domínio do redirect_uri em vez do nome do app — apontar
 * direto para *.supabase.co faz o usuário ler o identificador do projeto. Pior:
 * a verificação exige que todo domínio de redirect seja comprovado no Search
 * Console, e `supabase.co` não é comprovável por nós. Sem esta reescrita a
 * verificação é recusada.
 */
const CALLBACK_PATH = '/google-agenda/callback';
const FUNCTION_SUFFIX = '/functions/v1/google-calendar-auth/callback';

interface VercelConfig {
  rewrites?: { source: string; destination: string }[];
  headers?: { source: string; headers: { key: string; value: string }[] }[];
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig;

describe('callback do Google Agenda no domínio da Lotti', () => {
  it('reescreve o callback para a Edge Function', () => {
    const rewrite = config.rewrites?.find((entry) => entry.source === CALLBACK_PATH);

    expect(rewrite).toBeDefined();
    expect(rewrite!.destination).toMatch(/^https:\/\//);
    expect(rewrite!.destination.endsWith(FUNCTION_SUFFIX)).toBe(true);
  });

  it('coloca o callback antes do curinga do SPA', () => {
    const rewrites = config.rewrites ?? [];
    const callback = rewrites.findIndex((entry) => entry.source === CALLBACK_PATH);
    const spa = rewrites.findIndex((entry) => entry.destination === '/index.html');

    // A Vercel avalia as reescritas em ordem: depois do curinga, o callback
    // receberia o index.html e o código do Google morreria sem ser trocado.
    expect(callback).toBeGreaterThanOrEqual(0);
    expect(spa).toBeGreaterThanOrEqual(0);
    expect(callback).toBeLessThan(spa);
  });

  it('proíbe cache na resposta do callback', () => {
    const regra = config.headers?.find((entry) => entry.source === CALLBACK_PATH);

    // Um `code` do OAuth é de uso único e a resposta carrega o destino final da
    // sessão. Servir isso do CDN entrega a volta de uma pessoa para outra.
    expect(regra).toBeDefined();
    const valores = Object.fromEntries(regra!.headers.map((h) => [h.key, h.value]));
    expect(valores['Cache-Control']).toBe('no-store');
    expect(valores['x-vercel-enable-rewrite-caching']).toBe('0');
  });

  it('mantém o proxy de desenvolvimento no mesmo caminho', () => {
    const viteConfig = readFileSync('vite.config.ts', 'utf8');

    expect(viteConfig).toContain(CALLBACK_PATH);
    expect(viteConfig).toContain(FUNCTION_SUFFIX);
  });
});
