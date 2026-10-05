import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppEnv, ENV } from '../config/env';
import { SupabaseClaims } from '../prisma/tenant-db';
import { AuthService, SessaoEmitida } from './auth.service';
import { Claims } from './claims.decorator';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto } from './dto';
import { SupabaseAuthGuard } from './supabase-auth.guard';

/** Nome do cookie do refresh token. Escopo em /api/auth: nenhuma outra rota o recebe. */
const COOKIE_REFRESH = 'lotti_refresh';
const COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly servico: AuthService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<{ accessToken: string; expiresIn: number }> {
    const sessao = await this.servico.login(dto.email, dto.senha);
    this.gravarCookie(res, sessao);
    return { accessToken: sessao.accessToken, expiresIn: sessao.accessTtl };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ accessToken: string; expiresIn: number }> {
    const sessao = await this.servico.refresh(this.lerCookie(req));
    this.gravarCookie(res, sessao);
    return { accessToken: sessao.accessToken, expiresIn: sessao.accessTtl };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    await this.servico.logout(this.lerCookie(req));
    this.limparCookie(res);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  me(@Claims() claims: SupabaseClaims): { sub: string; email?: string; role: string } {
    return { sub: claims.sub, email: claims.email, role: claims.role };
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ mensagem: string }> {
    return this.servico.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<never> {
    return this.servico.resetPassword(dto.token, dto.senha);
  }

  // ── cookie do refresh ────────────────────────────────────────────────────

  private atributosBase(): string {
    const partes = [`Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Lax'];
    // Em produção o cookie só trafega em HTTPS. Em dev (sem isProd) fica sem
    // Secure para funcionar em http://localhost.
    if (this.env.isProd) partes.push('Secure');
    if (this.env.authCookieDomain) partes.push(`Domain=${this.env.authCookieDomain}`);
    return partes.join('; ');
  }

  private gravarCookie(res: Response, sessao: SessaoEmitida): void {
    const valor = `${COOKIE_REFRESH}=${sessao.refreshToken}; ${this.atributosBase()}; Max-Age=${sessao.refreshTtl}`;
    res.append('Set-Cookie', valor);
  }

  private limparCookie(res: Response): void {
    res.append('Set-Cookie', `${COOKIE_REFRESH}=; ${this.atributosBase()}; Max-Age=0`);
  }

  /** Lê o cookie do refresh sem depender de cookie-parser (que não está instalado). */
  private lerCookie(req: Request): string | undefined {
    const bruto = req.headers?.cookie;
    if (typeof bruto !== 'string') return undefined;
    for (const parte of bruto.split(';')) {
      const i = parte.indexOf('=');
      if (i === -1) continue;
      if (parte.slice(0, i).trim() === COOKIE_REFRESH) {
        return decodeURIComponent(parte.slice(i + 1).trim()) || undefined;
      }
    }
    return undefined;
  }
}
