import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AppEnv } from '../config/env';
import { emitirAccessToken } from './tokens';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const secret = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const authSecret = 'segredo-proprio-com-mais-de-32-caracteres!!';
const authIssuer = 'lotti-api';
const baseEnv: AppEnv = {
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x',
  supabaseUrl: 'https://abc.supabase.co', supabaseJwtSecret: secret, corsOrigins: [],
  authAccessTtl: 900, authRefreshTtl: 2592000, authIssuer, emailHabilitado: false,
};
const env: AppEnv = baseEnv;

async function token(overrides: Record<string, unknown> = {}, key = secret) {
  return new SignJWT({ role: 'authenticated', email: 'corretor@exemplo.com', ...overrides })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-1111-1111-1111-111111111111')
    .setIssuer('https://abc.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(key));
}

function context(authorization?: string) {
  const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('SupabaseAuthGuard', () => {
  const guard = new SupabaseAuthGuard(env);

  it('aceita token válido e grava as claims na requisição', async () => {
    const { ctx, request } = context(`Bearer ${await token()}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.claims).toMatchObject({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' });
  });

  it('recusa requisição sem token', async () => {
    await expect(guard.canActivate(context().ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token assinado com outra chave', async () => {
    const { ctx } = context(`Bearer ${await token({}, 'outra-chave-qualquer-com-mais-de-32-caracteres')}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token anônimo (role anon)', async () => {
    const { ctx } = context(`Bearer ${await token({ role: 'anon' })}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('SupabaseAuthGuard — modo duplo (transição)', () => {
  const guardDuplo = new SupabaseAuthGuard({ ...baseEnv, authJwtSecret: authSecret });
  const sub = '11111111-1111-1111-1111-111111111111';

  it('(a) token do Supabase válido ainda passa quando há segredo próprio', async () => {
    const { ctx, request } = context(`Bearer ${await token()}`);
    await expect(guardDuplo.canActivate(ctx)).resolves.toBe(true);
    expect((request.claims as { sub: string }).sub).toBe(sub);
  });

  it('(b) token próprio válido passa', async () => {
    const proprio = await emitirAccessToken(
      { sub, email: 'corretor@exemplo.com', sessionVersion: 0 },
      { segredo: authSecret, issuer: authIssuer, ttlSegundos: 900 },
    );
    const { ctx, request } = context(`Bearer ${proprio}`);
    await expect(guardDuplo.canActivate(ctx)).resolves.toBe(true);
    expect((request.claims as { sub: string }).sub).toBe(sub);
  });

  it('(d) os dois tokens resolvem o MESMO claims.sub', async () => {
    const proprio = await emitirAccessToken({ sub, sessionVersion: 0 }, { segredo: authSecret, issuer: authIssuer, ttlSegundos: 900 });
    const c1 = context(`Bearer ${await token()}`);
    const c2 = context(`Bearer ${proprio}`);
    await guardDuplo.canActivate(c1.ctx);
    await guardDuplo.canActivate(c2.ctx);
    expect((c1.request.claims as { sub: string }).sub).toBe((c2.request.claims as { sub: string }).sub);
  });

  it('(c) token inválido/assinatura trocada é recusado', async () => {
    const { ctx } = context(`Bearer ${await token({}, 'chave-totalmente-diferente-com-32-caracteres!!')}`);
    await expect(guardDuplo.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('(c) token próprio com issuer do Supabase (cross-issuer) é recusado', async () => {
    // Assinado com o segredo próprio mas com o issuer do Supabase: não é nenhum dos dois caminhos.
    const cruzado = await new SignJWT({ role: 'authenticated', aud: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
      .setIssuer('https://abc.supabase.co/auth/v1').setAudience('authenticated')
      .setExpirationTime('5m').sign(new TextEncoder().encode(authSecret));
    const { ctx } = context(`Bearer ${cruzado}`);
    await expect(guardDuplo.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sem AUTH_JWT_SECRET age como hoje: só o Supabase, token próprio não entra', async () => {
    const guardHoje = new SupabaseAuthGuard(baseEnv); // sem authJwtSecret
    const proprio = await emitirAccessToken({ sub, sessionVersion: 0 }, { segredo: authSecret, issuer: authIssuer, ttlSegundos: 900 });
    const { ctx } = context(`Bearer ${proprio}`);
    await expect(guardHoje.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    // mas o do Supabase continua passando
    const ok = context(`Bearer ${await token()}`);
    await expect(guardHoje.canActivate(ok.ctx)).resolves.toBe(true);
  });
});
