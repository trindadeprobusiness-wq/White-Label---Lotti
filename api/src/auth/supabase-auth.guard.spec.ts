import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AppEnv } from '../config/env';
import { emitirAccessToken } from './tokens';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const authSecret = 'segredo-proprio-com-mais-de-32-caracteres!!';
const authIssuer = 'lotti-api';
const baseEnv: AppEnv = {
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x', corsOrigins: [],
  authJwtSecret: authSecret, authAccessTtl: 900, authRefreshTtl: 2592000, authIssuer, emailHabilitado: false,
};
const sub = '11111111-1111-1111-1111-111111111111';

const proprio = (dados: Partial<{ sub: string; email: string }> = {}) => emitirAccessToken(
  { sub, email: 'corretor@exemplo.com', sessionVersion: 0, ...dados },
  { segredo: authSecret, issuer: authIssuer, ttlSegundos: 900 },
);

/** Token do jeito que o Supabase Auth emitia: issuer <projeto>/auth/v1, aud authenticated. */
async function tokenDoSupabase(chave = 'qualquer-chave-do-supabase-com-mais-de-32-caracteres') {
  return new SignJWT({ role: 'authenticated', email: 'corretor@exemplo.com' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
    .setIssuer('https://abc.supabase.co/auth/v1').setAudience('authenticated')
    .setExpirationTime('5m').sign(new TextEncoder().encode(chave));
}

function context(authorization?: string) {
  const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('SupabaseAuthGuard — só o login próprio da API', () => {
  const guard = new SupabaseAuthGuard(baseEnv);

  it('token próprio válido entra e grava as claims na requisição', async () => {
    const { ctx, request } = context(`Bearer ${await proprio()}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.claims).toMatchObject({ sub, role: 'authenticated' });
  });

  it('recusa requisição sem token', async () => {
    await expect(guard.canActivate(context().ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login do Supabase NUNCA entra, nem assinado com a própria chave da API', async () => {
    await expect(guard.canActivate(context(`Bearer ${await tokenDoSupabase()}`).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    // Mesmo com a assinatura certa, o issuer do Supabase não é o da API.
    await expect(guard.canActivate(context(`Bearer ${await tokenDoSupabase(authSecret)}`).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token próprio assinado com outra chave', async () => {
    const forjado = await emitirAccessToken({ sub, sessionVersion: 0 }, { segredo: 'outra-chave-qualquer-com-mais-de-32-caracteres', issuer: authIssuer, ttlSegundos: 900 });
    await expect(guard.canActivate(context(`Bearer ${forjado}`).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sem AUTH_JWT_SECRET ninguém entra (falha fechada)', async () => {
    const semSegredo = new SupabaseAuthGuard({ ...baseEnv, authJwtSecret: undefined });
    await expect(semSegredo.canActivate(context(`Bearer ${await proprio()}`).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
