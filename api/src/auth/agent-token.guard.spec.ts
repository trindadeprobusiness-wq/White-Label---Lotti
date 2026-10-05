import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AppEnv } from '../config/env';
import { AgentTokenGuard } from './agent-token.guard';

const env = (agentApiToken?: string): AppEnv => ({
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x', supabaseUrl: 'https://abc.supabase.co', corsOrigins: [], agentApiToken,
  authAccessTtl: 900, authRefreshTtl: 2592000, authIssuer: 'lotti-api', emailHabilitado: false,
});
const ctx = (header?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: header ? { 'x-lotti-agent': header } : {} }) }) }) as unknown as ExecutionContext;
const token = 't'.repeat(40);

describe('AgentTokenGuard', () => {
  it('aceita o segredo certo', () => {
    expect(new AgentTokenGuard(env(token)).canActivate(ctx(token))).toBe(true);
  });
  it('recusa segredo errado ou ausente com 401', () => {
    expect(() => new AgentTokenGuard(env(token)).canActivate(ctx('x'.repeat(40)))).toThrow(UnauthorizedException);
    expect(() => new AgentTokenGuard(env(token)).canActivate(ctx())).toThrow(UnauthorizedException);
  });
  it('sem segredo configurado responde 503, nunca aceita', () => {
    expect(() => new AgentTokenGuard(env()).canActivate(ctx(token))).toThrow(ServiceUnavailableException);
  });
});
