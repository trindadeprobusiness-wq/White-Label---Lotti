import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppEnv, ENV } from '../config/env';
import { SupabaseClaims } from '../prisma/tenant-db';
import { verificarAccessToken } from './tokens';

/**
 * Aceita DOIS tokens durante a transição para o login próprio:
 *  1) o token próprio da API (HS256, AUTH_JWT_SECRET, issuer AUTH_ISSUER);
 *  2) o token do Supabase (JWKS/HS256, issuer <supabaseUrl>/auth/v1) — exatamente
 *     como antes.
 * Qualquer um resolve para o MESMO request.claims { sub, role:'authenticated', email },
 * então nada quebra enquanto o front ainda manda o token do Supabase. A validação
 * do Supabase NUNCA é removida aqui. Sem AUTH_JWT_SECRET, o caminho próprio é
 * pulado e o guard age exatamente como hoje.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Sessão ausente.');

    const payload = await this.resolver(token);
    if (!payload || payload.role !== 'authenticated' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    request.claims = payload as SupabaseClaims;
    return true;
  }

  /**
   * Tenta o token próprio primeiro (quando há segredo configurado); se falhar,
   * cai no Supabase, sem mudar a verificação de hoje. Falha nos dois ⇒ null, e o
   * chamador responde com a mesma mensagem de sempre.
   */
  private async resolver(token: string): Promise<JWTPayload | null> {
    if (this.env.authJwtSecret) {
      try {
        return await verificarAccessToken(token, { segredo: this.env.authJwtSecret, issuer: this.env.authIssuer });
      } catch {
        // Não é (ou não é mais) um token próprio válido: tenta o Supabase.
      }
    }
    try {
      return (await this.verify(token)).payload;
    } catch {
      return null;
    }
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
