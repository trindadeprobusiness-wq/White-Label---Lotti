import {
  CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Optional, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JWTPayload } from 'jose';
import { AppEnv, ENV } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims } from '../prisma/tenant-db';
import { conferirSessaoSuporte, RECUSA_SUPORTE } from './sessao-suporte';
import { lerSuporte, SuporteDoToken } from './token-suporte';
import { verificarAccessToken } from './tokens';

const METODOS_DE_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);


/** Atendimento encerrado, vencido ou com o acesso revogado (mesmo texto do proxy da Edge). */
const ATENDIMENTO_ENCERRADO = {
  statusCode: 403, codigo: 'atendimento_encerrado', message: 'Atendimento encerrado ou acesso revogado.',
};
const INDISPONIVEL_NO_ATENDIMENTO = {
  statusCode: 403, codigo: 'indisponivel_no_atendimento', message: 'Esta ação não está disponível durante o atendimento.',
};

/**
 * Só o login próprio da API (HS256, AUTH_JWT_SECRET, issuer AUTH_ISSUER). O login do Supabase saiu de vez:
 * o Supabase Auth é outro banco, a senha antiga seguia valendo lá e abria a API. Sem AUTH_JWT_SECRET
 * ninguém entra (falha fechada; em produção a API nem sobe sem ele — ver config/env.ts).
 *
 * Token de ATENDIMENTO (token próprio com a marca `suporte`, ver token-suporte.ts): além da
 * assinatura, a sessão em admin_sessoes_suporte é conferida no banco A CADA requisição (encerrada,
 * vencida ou com o papel do administrador revogado ⇒ 403), e toda requisição que escreve deixa a
 * linha `suporte_requisicao` na auditoria antes de chegar ao handler. As claims seguem inteiras para
 * o TenantDb: o `session_id` delas é o que auditar_mutacao_suporte() usa para gravar o ator real.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    // Opcionais só para os testes que montam o guard à mão. Sem o banco, token de atendimento
    // nunca passa (falha fechada); token comum segue igual.
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Sessão ausente.');

    const resolvido = await this.resolver(token);
    if (!resolvido || resolvido.payload.role !== 'authenticated' || typeof resolvido.payload.sub !== 'string') {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    const { payload } = resolvido;
    const sub = resolvido.payload.sub;

    let suporte: SuporteDoToken | null;
    try {
      suporte = lerSuporte(payload);
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    if (suporte) await this.conferirAtendimento(ctx, request, sub, suporte);

    request.claims = payload as SupabaseClaims;
    return true;
  }

  private async conferirAtendimento(
    ctx: ExecutionContext, request: Record<string, unknown>, sub: string, suporte: SuporteDoToken,
  ): Promise<void> {
    if (this.rotaRecusaSuporte(ctx)) throw new ForbiddenException(INDISPONIVEL_NO_ATENDIMENTO);
    if (!this.prisma) throw new ForbiddenException(ATENDIMENTO_ENCERRADO);
    const metodo = String(request.method ?? 'GET').toUpperCase();
    const corretorId = await conferirSessaoSuporte(this.prisma, {
      ...suporte,
      userId: sub,
      escrita: !METODOS_DE_LEITURA.has(metodo),
      metodo,
      recurso: recursoDaRota(request),
    });
    if (!corretorId) throw new ForbiddenException(ATENDIMENTO_ENCERRADO);
  }

  /** Sem como ler a regra da rota (guard montado à mão), o token de atendimento não passa. */
  private rotaRecusaSuporte(ctx: ExecutionContext): boolean {
    if (!this.reflector || typeof ctx.getHandler !== 'function' || typeof ctx.getClass !== 'function') return true;
    return this.reflector.getAllAndOverride<boolean>(RECUSA_SUPORTE, [ctx.getHandler(), ctx.getClass()]) === true;
  }

  /** Token próprio válido ⇒ payload; qualquer outra coisa (inclusive o do Supabase) ⇒ null. */
  private async resolver(token: string): Promise<{ payload: JWTPayload } | null> {
    if (!this.env.authJwtSecret) return null;
    try {
      return { payload: await verificarAccessToken(token, { segredo: this.env.authJwtSecret, issuer: this.env.authIssuer }) };
    } catch {
      return null;
    }
  }
}

/**
 * O padrão da rota (Express preenche request.route dentro do handler, onde os guards rodam): sem
 * ids, sem query e sem dado pessoal. Fora disso, só os dois primeiros segmentos do caminho.
 */
function recursoDaRota(request: Record<string, unknown>): string {
  const rota = request.route as { path?: unknown } | undefined;
  if (typeof rota?.path === 'string' && rota.path) return rota.path.slice(0, 200);
  const caminho = typeof request.path === 'string' ? request.path : '';
  return caminho.split('/').slice(0, 3).join('/').slice(0, 200);
}
