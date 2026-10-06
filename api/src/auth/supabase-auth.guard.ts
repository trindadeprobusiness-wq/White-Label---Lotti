import {
  CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Optional, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppEnv, ENV } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims } from '../prisma/tenant-db';
import { conferirSessaoSuporte, RECUSA_SUPORTE } from './sessao-suporte';
import { CLAIM_SUPORTE, lerSuporte, SuporteDoToken } from './token-suporte';
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
 * Aceita DOIS tokens durante a transição para o login próprio:
 *  1) o token próprio da API (HS256, AUTH_JWT_SECRET, issuer AUTH_ISSUER);
 *  2) o token do Supabase (JWKS/HS256, issuer <supabaseUrl>/auth/v1) — exatamente
 *     como antes.
 * Qualquer um resolve para o MESMO request.claims { sub, role:'authenticated', email },
 * então nada quebra enquanto o front ainda manda o token do Supabase. A validação
 * do Supabase NUNCA é removida aqui. Sem AUTH_JWT_SECRET, o caminho próprio é
 * pulado e o guard age exatamente como hoje.
 *
 * Token de ATENDIMENTO (token próprio com a marca `suporte`, ver token-suporte.ts): além da
 * assinatura, a sessão em admin_sessoes_suporte é conferida no banco A CADA requisição (encerrada,
 * vencida ou com o papel do administrador revogado ⇒ 403), e toda requisição que escreve deixa a
 * linha `suporte_requisicao` na auditoria antes de chegar ao handler. As claims seguem inteiras para
 * o TenantDb: o `session_id` delas é o que auditar_mutacao_suporte() usa para gravar o ator real.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

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
      // A marca de atendimento só vale em token próprio. No do Supabase ela não existe; se vier,
      // o token não é nenhum dos dois que a API emite ou aceita.
      if (!resolvido.proprio && payload[CLAIM_SUPORTE] !== undefined) throw new Error('suporte_invalido');
      suporte = resolvido.proprio ? lerSuporte(payload) : null;
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

  /**
   * Tenta o token próprio primeiro (quando há segredo configurado); se falhar,
   * cai no Supabase, sem mudar a verificação de hoje. Falha nos dois ⇒ null, e o
   * chamador responde com a mesma mensagem de sempre.
   */
  private async resolver(token: string): Promise<{ payload: JWTPayload; proprio: boolean } | null> {
    if (this.env.authJwtSecret) {
      try {
        const payload = await verificarAccessToken(token, { segredo: this.env.authJwtSecret, issuer: this.env.authIssuer });
        return { payload, proprio: true };
      } catch {
        // Não é (ou não é mais) um token próprio válido: tenta o Supabase.
      }
    }
    try {
      return { payload: (await this.verify(token)).payload, proprio: false };
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
