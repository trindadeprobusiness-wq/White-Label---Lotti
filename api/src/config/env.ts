import { Global, Module } from '@nestjs/common';

export interface AppEnv {
  isProd: boolean;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  supabaseUrl: string;
  /** Projetos com chave JWT legada (HS256). Vazio: valida pelas chaves públicas (JWKS). */
  supabaseJwtSecret?: string;
  corsOrigins: string[];
  /** Segredo compartilhado com o agente do WhatsApp (header x-lotti-agent). */
  agentApiToken?: string;
}

export const ENV = Symbol('ENV');

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (!value || value.trim() === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value.trim();
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const isProd = source.NODE_ENV === 'production';
  const corsOrigins = (source.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (isProd && corsOrigins.length === 0) throw new Error('Variável de ambiente obrigatória ausente: CORS_ORIGINS');
  return {
    isProd,
    port: Number(source.PORT ?? 3001),
    databaseUrl: required(source, 'DATABASE_URL'),
    redisUrl: required(source, 'REDIS_URL'),
    supabaseUrl: required(source, 'SUPABASE_URL').replace(/\/+$/, ''),
    supabaseJwtSecret: source.SUPABASE_JWT_SECRET?.trim() || undefined,
    corsOrigins,
    agentApiToken: (source.AGENT_API_TOKEN?.trim().length ?? 0) >= 32 ? source.AGENT_API_TOKEN!.trim() : undefined,
  };
}

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
