import { loadEnv, ORIGEM_APP, ORIGENS_LOCAIS } from './env';

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
      corsOrigins: [ORIGEM_APP, ...ORIGENS_LOCAIS],
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
    // O app e as locais já vêm por padrão; CORS_ORIGINS soma sem repetir.
    expect(env.corsOrigins).toEqual([ORIGEM_APP, ...ORIGENS_LOCAIS]);
    expect(env.port).toBe(8080);
  });

  it('recusa subir sem variável obrigatória e diz qual falta', () => {
    expect(() => loadEnv({ REDIS_URL: base.REDIS_URL, SUPABASE_URL: base.SUPABASE_URL })).toThrow('DATABASE_URL');
  });

  it('lê o segredo do agente só quando tem 32+ caracteres', () => {
    expect(loadEnv({ ...base, AGENT_API_TOKEN: 'curto' }).agentApiToken).toBeUndefined();
    expect(loadEnv({ ...base, AGENT_API_TOKEN: 'a'.repeat(32) }).agentApiToken).toBe('a'.repeat(32));
  });

  it('em produção o app entra sempre e as origens locais ficam de fora', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'production' }).corsOrigins).toEqual([ORIGEM_APP]);
    const comEnsaio = loadEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://app-teste.up.railway.app/' });
    expect(comEnsaio.corsOrigins).toEqual([ORIGEM_APP, 'https://app-teste.up.railway.app']);
    expect(comEnsaio.corsOrigins).not.toContain('http://localhost:8080');
  });

  it('recusa "*" em CORS_ORIGINS (o login usa cookie com credenciais)', () => {
    expect(() => loadEnv({ ...base, CORS_ORIGINS: '*' })).toThrow('CORS_ORIGINS');
  });

  it('fora de produção libera o front local nas portas 8080 e 5173', () => {
    const env = loadEnv({ ...base });
    expect(env.corsOrigins).toEqual(expect.arrayContaining(['http://localhost:8080', 'http://localhost:5173', ORIGEM_APP]));
  });
});
