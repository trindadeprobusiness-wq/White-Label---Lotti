import { Global, Module } from '@nestjs/common';

export interface AppEnv {
  isProd: boolean;
  port: number;
  databaseUrl: string;
  /** Conexão de sessão (migrations e LISTEN do sino ao vivo). Opcional. */
  directUrl?: string;
  redisUrl: string;
  supabaseUrl: string;
  /** Projetos com chave JWT legada (HS256). Vazio: valida pelas chaves públicas (JWKS). */
  supabaseJwtSecret?: string;
  corsOrigins: string[];
  /** Segredo compartilhado com o agente do WhatsApp (header x-lotti-agent). */
  agentApiToken?: string;
  /**
   * Chave simétrica (HS256) do login próprio da API. Faltando: as rotas de
   * /api/auth respondem 503 e o guard age como hoje, só com o Supabase. Exigida
   * com pelo menos 32 caracteres para não nascer uma chave fraca por engano.
   */
  authJwtSecret?: string;
  /** Validade do access token, em segundos (curto, 10–15 min). */
  authAccessTtl: number;
  /** Validade do refresh token, em segundos. */
  authRefreshTtl: number;
  /** Issuer do token próprio. NUNCA pode ser igual ao issuer do Supabase. */
  authIssuer: string;
  /** Domínio do cookie de refresh. Vazio: o navegador usa o host da própria API. */
  authCookieDomain?: string;
  /** E-mail (Resend). Só quando TODAS presentes a recuperação/convite ligam. */
  resendApiKey?: string;
  emailFrom?: string;
  emailReplyTo?: string;
  emailDomain?: string;
  passwordResetUrl?: string;
  /** true só quando todas as variáveis de e-mail acima estão presentes. */
  emailHabilitado: boolean;
}

export const ENV = Symbol('ENV');

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (!value || value.trim() === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value.trim();
}

/** Inteiro positivo de uma variável, ou o padrão quando ausente/ inválida. */
function inteiroPositivo(source: NodeJS.ProcessEnv, name: string, padrao: number): number {
  const bruto = source[name]?.trim();
  if (!bruto) return padrao;
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : padrao;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const isProd = source.NODE_ENV === 'production';
  const corsOrigins = (source.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (isProd && corsOrigins.length === 0) throw new Error('Variável de ambiente obrigatória ausente: CORS_ORIGINS');

  const authIssuer = source.AUTH_ISSUER?.trim() || 'lotti-api';
  const supabaseUrl = required(source, 'SUPABASE_URL').replace(/\/+$/, '');
  if (authIssuer === `${supabaseUrl}/auth/v1`) {
    throw new Error('AUTH_ISSUER não pode ser igual ao issuer do Supabase.');
  }
  // Chave fraca é pior que ausente: faltando a API age como hoje (só Supabase);
  // presente mas curta é um convite a forjar token. Recusa de cara.
  const authJwtBruto = source.AUTH_JWT_SECRET?.trim();
  if (authJwtBruto && authJwtBruto.length < 32) {
    throw new Error('AUTH_JWT_SECRET precisa ter pelo menos 32 caracteres.');
  }

  const resendApiKey = source.RESEND_API_KEY?.trim() || undefined;
  const emailFrom = source.EMAIL_FROM?.trim() || undefined;
  const emailReplyTo = source.EMAIL_REPLY_TO?.trim() || undefined;
  const emailDomain = source.EMAIL_DOMAIN?.trim() || undefined;
  const passwordResetUrl = source.PASSWORD_RESET_URL?.trim() || undefined;
  const emailHabilitado = Boolean(resendApiKey && emailFrom && emailReplyTo && emailDomain && passwordResetUrl);

  return {
    isProd,
    port: Number(source.PORT ?? 3001),
    databaseUrl: required(source, 'DATABASE_URL'),
    directUrl: source.DIRECT_URL?.trim() || undefined,
    redisUrl: required(source, 'REDIS_URL'),
    supabaseUrl,
    supabaseJwtSecret: source.SUPABASE_JWT_SECRET?.trim() || undefined,
    corsOrigins,
    agentApiToken: (source.AGENT_API_TOKEN?.trim().length ?? 0) >= 32 ? source.AGENT_API_TOKEN!.trim() : undefined,
    authJwtSecret: authJwtBruto || undefined,
    authAccessTtl: inteiroPositivo(source, 'AUTH_ACCESS_TTL', 900),
    authRefreshTtl: inteiroPositivo(source, 'AUTH_REFRESH_TTL', 2592000),
    authIssuer,
    authCookieDomain: source.AUTH_COOKIE_DOMAIN?.trim() || undefined,
    resendApiKey,
    emailFrom,
    emailReplyTo,
    emailDomain,
    passwordResetUrl,
    emailHabilitado,
  };
}

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
