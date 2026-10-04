import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppEnv, ENV } from '../config/env';
import { SupabaseClaims } from '../prisma/tenant-db';

/** Aceita o mesmo token que o front já recebe do Supabase Auth. */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Sessão ausente.');
    let payload: JWTPayload;
    try {
      payload = (await this.verify(token)).payload;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    request.claims = payload as SupabaseClaims;
    return true;
  }

  private verify(token: string) {
    const options = { issuer: `${this.env.supabaseUrl}/auth/v1`, audience: 'authenticated' };
    if (this.env.supabaseJwtSecret) {
      return jwtVerify(token, new TextEncoder().encode(this.env.supabaseJwtSecret), options);
    }
    this.jwks ??= createRemoteJWKSet(new URL(`${this.env.supabaseUrl}/auth/v1/.well-known/jwks.json`));
    return jwtVerify(token, this.jwks, options);
  }
}
