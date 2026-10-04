import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AppEnv } from '../config/env';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const secret = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const env: AppEnv = {
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x',
  supabaseUrl: 'https://abc.supabase.co', supabaseJwtSecret: secret, corsOrigins: [],
};

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
