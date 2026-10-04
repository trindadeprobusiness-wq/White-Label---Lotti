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
      redisUrl: base.REDIS_URL,
      supabaseUrl: 'https://abc.supabase.co',
      supabaseJwtSecret: undefined,
      corsOrigins: [],
      agentApiToken: undefined,
    });
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
