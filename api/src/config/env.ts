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
  /**
   * Origens das rotas públicas que outros sites chamam (vitrine do site institucional e captura de
   * lead das landing pages). SEM credenciais, sempre. '*' (padrão) é o que as Edge Functions faziam.
   * Ver config/cors.ts.
   */
  publicCorsOrigins?: '*' | string[];
  /** Segredo compartilhado com o agente do WhatsApp (header x-lotti-agent). */
  agentApiToken?: string;
  /**
   * Segredo compartilhado com o checkout do site institucional (header x-lotti-checkout).
   * Faltando (ou com menos de 32 caracteres): /api/checkout/* responde 503.
   */
  checkoutApiToken?: string;
  /**
   * Página da plataforma que cria a senha (LOTTI_APP_PASSWORD_SETUP_URL, ex.:
   * https://app.plataformalotti.com.br/nova-senha). O link sai como `${url}?token=...`.
   * Faltando: o checkout responde 503 `checkout_nao_configurado` antes de cobrar.
   */
  passwordSetupUrl?: string;
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

/**
 * O app publicado. Entra sempre na lista de CORS: o login próprio manda o cookie de
 * refresh com credentials:'include' de app.* para api.*, e uma CORS_ORIGINS no Railway
 * sem ele derrubaria todo login (foi o que travou a virada de 2026-10-06).
 */
export const ORIGEM_APP = 'https://app.plataformalotti.com.br';
/** Front local (Vite do projeto em 127.0.0.1:8085; 8080 e 5173 de outras configurações). Só fora de produção. */
export const ORIGENS_LOCAIS = [
  'http://localhost:8080', 'http://127.0.0.1:8080',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:8085', 'http://127.0.0.1:8085',
] as const;

/**
 * Origens aceitas pelo CORS (com credenciais, então nunca '*'). CORS_ORIGINS soma às
 * padrão (ex.: o serviço de ensaio). Barra final sai: o navegador manda a origem sem
 * ela e 'https://app.../' nunca casaria.
 */
function origensCors(bruto: string | undefined, isProd: boolean): string[] {
  const extras = (bruto ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (extras.includes('*')) throw new Error('CORS_ORIGINS não aceita "*": o login usa cookie com credenciais.');
  const padrao = isProd ? [ORIGEM_APP] : [ORIGEM_APP, ...ORIGENS_LOCAIS];
  return [...new Set([...padrao, ...extras])];
}

/**
 * PUBLIC_CORS_ORIGINS: vazia ou '*' → qualquer origem (como as Edge Functions); lista → só essas
 * origens, mais as do app. Nunca vale para rota com cookie: as rotas públicas respondem sem
 * Access-Control-Allow-Credentials (config/cors.ts).
 */
function origensCorsPublicas(bruto: string | undefined, origensApp: string[]): '*' | string[] {
  const lista = (bruto ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (lista.length === 0 || lista.includes('*')) return '*';
  return [...new Set([...origensApp, ...lista])];
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (!value || value.trim() === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value.trim();
}

/** Segredo de servidor a servidor: só vale com pelo menos 32 caracteres (curto = ausente = 503). */
function segredoForte(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = source[name]?.trim();
  return v && v.length >= 32 ? v : undefined;
}

/** URL http(s) absoluta, ou undefined (ausente ou inválida: o recurso fica desligado). */
function urlHttp(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = source[name]?.trim();
  if (!v) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
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
  const corsOrigins = origensCors(source.CORS_ORIGINS, isProd);

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
    publicCorsOrigins: origensCorsPublicas(source.PUBLIC_CORS_ORIGINS, corsOrigins),
    agentApiToken: (source.AGENT_API_TOKEN?.trim().length ?? 0) >= 32 ? source.AGENT_API_TOKEN!.trim() : undefined,
    checkoutApiToken: segredoForte(source, 'CHECKOUT_API_TOKEN'),
    passwordSetupUrl: urlHttp(source, 'LOTTI_APP_PASSWORD_SETUP_URL'),
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
