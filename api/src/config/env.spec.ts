import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@db:5432/postgres',
  REDIS_URL: 'redis://redis:6379',
  SUPABASE_URL: 'https://abc.supabase.co',
};

describe('loadEnv', () => {
  it('lê as obrigatórias e aplica padrões', () => {
    const env = loadEnv({ ...base });
    expect(env).toEqual({
      isProd: false,
      port: 3001,
      databaseUrl: base.DATABASE_URL,
      directUrl: undefined,
      redisUrl: base.REDIS_URL,
      supabaseUrl: 'https://abc.supabase.co',
      supabaseJwtSecret: undefined,
      corsOrigins: [],
      agentApiToken: undefined,
      authJwtSecret: undefined,
      authAccessTtl: 900,
      authRefreshTtl: 2592000,
      authIssuer: 'lotti-api',
      authCookieDomain: undefined,
      resendApiKey: undefined,
      emailFrom: undefined,
      emailReplyTo: undefined,
      emailDomain: undefined,
      passwordResetUrl: undefined,
      emailHabilitado: false,
    });
  });

  it('lê o segredo do login próprio só com 32+ caracteres e recusa chave curta', () => {
    expect(loadEnv({ ...base }).authJwtSecret).toBeUndefined();
    expect(loadEnv({ ...base, AUTH_JWT_SECRET: 'x'.repeat(40) }).authJwtSecret).toBe('x'.repeat(40));
    expect(() => loadEnv({ ...base, AUTH_JWT_SECRET: 'curto' })).toThrow('AUTH_JWT_SECRET');
  });

  it('AUTH_ISSUER não pode ser igual ao issuer do Supabase', () => {
    expect(() => loadEnv({ ...base, AUTH_ISSUER: 'https://abc.supabase.co/auth/v1' })).toThrow('AUTH_ISSUER');
  });

  it('emailHabilitado só com todas as variáveis de e-mail presentes', () => {
    expect(loadEnv({ ...base }).emailHabilitado).toBe(false);
    const comEmail = loadEnv({
      ...base, RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b', EMAIL_REPLY_TO: 'r@b', EMAIL_DOMAIN: 'b', PASSWORD_RESET_URL: 'https://b/reset',
    });
    expect(comEmail.emailHabilitado).toBe(true);
  });

  it('TTLs aceitam override inteiro positivo e caem no padrão quando inválidos', () => {
    expect(loadEnv({ ...base, AUTH_ACCESS_TTL: '600', AUTH_REFRESH_TTL: '100' }).authAccessTtl).toBe(600);
    expect(loadEnv({ ...base, AUTH_ACCESS_TTL: 'abc' }).authAccessTtl).toBe(900);
    expect(loadEnv({ ...base, AUTH_REFRESH_TTL: '-5' }).authRefreshTtl).toBe(2592000);
  });

  it('separa as origens de CORS e tira a barra final da URL do Supabase', () => {
    const env = loadEnv({ ...base, SUPABASE_URL: 'https://abc.supabase.co/', CORS_ORIGINS: 'https://app.plataformalotti.com.br, http://127.0.0.1:8085', PORT: '8080' });
    expect(env.supabaseUrl).toBe('https://abc.supabase.co');
    expect(env.corsOrigins).toEqual(['https://app.plataformalotti.com.br', 'http://127.0.0.1:8085']);
    expect(env.port).toBe(8080);
  });

  it('recusa subir sem variável obrigatória e diz qual falta', () => {
    expect(() => loadEnv({ REDIS_URL: base.REDIS_URL, SUPABASE_URL: base.SUPABASE_URL })).toThrow('DATABASE_URL');
  });

  it('lê o segredo do agente só quando tem 32+ caracteres', () => {
    expect(loadEnv({ ...base, AGENT_API_TOKEN: 'curto' }).agentApiToken).toBeUndefined();
    expect(loadEnv({ ...base, AGENT_API_TOKEN: 'a'.repeat(32) }).agentApiToken).toBe('a'.repeat(32));
  });

  it('em produção exige ao menos uma origem de CORS', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow('CORS_ORIGINS');
  });
});
