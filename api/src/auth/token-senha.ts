import { createHash, randomBytes } from 'node:crypto';

/**
 * Token dos links de senha (public.auth_password_tokens). O cru (256 bits, base64url) só
 * existe no link; o banco guarda o SHA-256 hex. Uso único e validade curta.
 */
export type FinalidadeTokenSenha = 'definir_senha' | 'recuperar_senha';

/** Validade do link de criar senha: 24 h, como o convite do Supabase. */
export const TTL_LINK_SENHA_S = 24 * 60 * 60;

/** Formato do token cru: base64url de 32 bytes (43 caracteres). Folga para versões futuras. */
export const FORMATO_TOKEN_SENHA = /^[A-Za-z0-9_-]{32,128}$/;

export function hashTokenSenha(bruto: string): string {
  return createHash('sha256').update(bruto, 'utf8').digest('hex');
}

export function gerarTokenSenha(): { bruto: string; hash: string } {
  const bruto = randomBytes(32).toString('base64url');
  return { bruto, hash: hashTokenSenha(bruto) };
}

/** `${base}?token=...` preservando o que a base já tiver de query (URL cuida da codificação). */
export function montarLinkSenha(base: string, token: string): string {
  const url = new URL(base);
  url.searchParams.set('token', token);
  return url.toString();
}
