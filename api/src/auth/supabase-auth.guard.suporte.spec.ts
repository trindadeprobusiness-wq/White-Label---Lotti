import { ExecutionContext, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { SignJWT } from 'jose';
import { AppEnv } from '../config/env';
import { NotificacoesController } from '../notificacoes/notificacoes.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SuporteController } from '../suporte/suporte.controller';
import { AuthController } from './auth.controller';
import { PerfilController } from './perfil.controller';
import { RECUSA_SUPORTE, RecusaTokenSuporte } from './sessao-suporte';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { CLAIM_SUPORTE, emitirTokenSuporte } from './token-suporte';
import { emitirAccessToken } from './tokens';

const supabaseSecret = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const authSecret = 'segredo-proprio-com-mais-de-32-caracteres!!';
const authIssuer = 'lotti-api';
const env: AppEnv = {
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x',
  supabaseUrl: 'https://abc.supabase.co', supabaseJwtSecret: supabaseSecret, corsOrigins: [],
  authAccessTtl: 900, authRefreshTtl: 2592000, authIssuer, authJwtSecret: authSecret, emailHabilitado: false,
};

const TITULAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSAO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AUTH_SESSAO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CORRETOR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

async function tokenSuporte(): Promise<string> {
  return (await emitirTokenSuporte(
    { sub: TITULAR, email: 'titular@exemplo.com', sessaoId: SESSAO, authSessionId: AUTH_SESSAO, atorUserId: ADMIN,
      expiraEm: new Date(Date.now() + 30 * 60_000) },
    { segredo: authSecret, issuer: authIssuer },
  )).token;
}

class Rotas {
  livre(): void {}
  @RecusaTokenSuporte() fechada(): void {}
}

function contexto(token: string, opcoes: { metodo?: string; handler?: () => void; rota?: string } = {}) {
  const request: Record<string, unknown> = {
    headers: { authorization: `Bearer ${token}` },
    method: opcoes.metodo ?? 'GET',
    route: { path: opcoes.rota ?? '/api/imoveis/:id' },
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => opcoes.handler ?? Rotas.prototype.livre,
    getClass: () => Rotas,
  } as unknown as ExecutionContext;
  return { ctx, request };
}

/** PrismaService falso: devolve `linhas` para a conferência da sessão e guarda os parâmetros. */
function bancoFalso(linhas: Array<{ corretor_id: string }> | Error) {
  const consultas: Prisma.Sql[] = [];
  const prisma = {
    $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
      consultas.push(sql);
      if (linhas instanceof Error) throw linhas;
      return linhas;
    }),
  };
  return { prisma, consultas, guard: new SupabaseAuthGuard(env, prisma as unknown as PrismaService, new Reflector()) };
}

/** Troca um pedaço do payload mantendo cabeçalho e assinatura originais. */
function adulterar(token: string, mudar: (p: Record<string, unknown>) => void): string {
  const [h, p, s] = token.split('.');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
  mudar(payload);
  return [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.');
}

async function corpoDoErro(promessa: Promise<unknown>): Promise<{ status: number; corpo: unknown }> {
  try {
    await promessa;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() };
    throw e;
  }
  throw new Error('era esperado um erro');
}

describe('SupabaseAuthGuard — token de atendimento', () => {
  it('sessão ativa: passa, com as claims inteiras (session_id é o que o gatilho de auditoria lê)', async () => {
    const { guard, consultas } = bancoFalso([{ corretor_id: CORRETOR }]);
    const { ctx, request } = contexto(await tokenSuporte());
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.claims).toMatchObject({
      sub: TITULAR, role: 'authenticated', session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN },
    });
    // Conferência com sessão, auth_session_id, ator e titular do token; leitura não audita.
    expect(consultas).toHaveLength(1);
    expect(consultas[0].values).toEqual([SESSAO, AUTH_SESSAO, ADMIN, TITULAR, '/api/imoveis/:id', 'GET', false]);
  });

  it('escrita: a auditoria suporte_requisicao vai no mesmo comando, com o padrão da rota e o método', async () => {
    const { guard, consultas } = bancoFalso([{ corretor_id: CORRETOR }]);
    const { ctx } = contexto(await tokenSuporte(), { metodo: 'patch', rota: '/api/clientes/:id' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(consultas[0].values).toEqual([SESSAO, AUTH_SESSAO, ADMIN, TITULAR, '/api/clientes/:id', 'PATCH', true]);
    expect(consultas[0].sql).toContain("'suporte_requisicao'");
  });

  it('sessão encerrada, vencida, de outro ator ou com o papel revogado (banco sem linha) → 403', async () => {
    const { guard } = bancoFalso([]);
    const { ctx, request } = contexto(await tokenSuporte(), { metodo: 'POST' });
    expect(await corpoDoErro(guard.canActivate(ctx))).toEqual({
      status: 403, corpo: { statusCode: 403, codigo: 'atendimento_encerrado', message: 'Atendimento encerrado ou acesso revogado.' },
    });
    expect(request.claims).toBeUndefined();
  });

  it('rota que recusa atendimento → 403 sem nem consultar o banco', async () => {
    const { guard, prisma } = bancoFalso([{ corretor_id: CORRETOR }]);
    const { ctx } = contexto(await tokenSuporte(), { handler: Rotas.prototype.fechada });
    expect(await corpoDoErro(guard.canActivate(ctx))).toEqual({
      status: 403,
      corpo: { statusCode: 403, codigo: 'indisponivel_no_atendimento', message: 'Esta ação não está disponível durante o atendimento.' },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('token adulterado (outro ator, outra sessão, outro titular), sem assinatura ou de outra chave → 401', async () => {
    const { guard, prisma } = bancoFalso([{ corretor_id: CORRETOR }]);
    const original = await tokenSuporte();
    const [h, p] = original.split('.');
    const adulterados = [
      adulterar(original, (x) => { (x[CLAIM_SUPORTE] as Record<string, unknown>).ator = TITULAR; }),
      adulterar(original, (x) => { x.session_id = SESSAO; }),
      adulterar(original, (x) => { x.sub = ADMIN; }),
      adulterar(original, (x) => { x.exp = Math.floor(Date.now() / 1000) + 86_400; }),
      `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`,
      `${h}.${p}.assinatura-falsa`,
      await new SignJWT({ role: 'authenticated', aud: 'authenticated', session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(TITULAR).setIssuer(authIssuer).setExpirationTime('5m')
        .sign(new TextEncoder().encode('outra-chave-qualquer-com-mais-de-32-caracteres')),
    ];
    for (const token of adulterados) {
      await expect(guard.canActivate(contexto(token).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('token de atendimento vencido → 401', async () => {
    const { guard } = bancoFalso([{ corretor_id: CORRETOR }]);
    const vencido = await new SignJWT({ role: 'authenticated', aud: 'authenticated', session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(TITULAR).setIssuer(authIssuer)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(authSecret));
    await expect(guard.canActivate(contexto(vencido).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token próprio com session_id e sem a marca (ou marca sem session_id) → 401', async () => {
    const { guard, prisma } = bancoFalso([{ corretor_id: CORRETOR }]);
    const assinar = (claims: Record<string, unknown>) => new SignJWT({ role: 'authenticated', aud: 'authenticated', ...claims })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(TITULAR).setIssuer(authIssuer).setExpirationTime('5m')
      .sign(new TextEncoder().encode(authSecret));
    await expect(guard.canActivate(contexto(await assinar({ session_id: AUTH_SESSAO })).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(contexto(await assinar({ [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } })).ctx))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('token do Supabase com a marca de atendimento → 401; sem ela segue como hoje (session_id nativo não é atendimento)', async () => {
    const { guard, prisma } = bancoFalso([{ corretor_id: CORRETOR }]);
    const supabase = (extra: Record<string, unknown>) => new SignJWT({ role: 'authenticated', session_id: AUTH_SESSAO, ...extra })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(TITULAR).setIssuer('https://abc.supabase.co/auth/v1')
      .setAudience('authenticated').setExpirationTime('5m').sign(new TextEncoder().encode(supabaseSecret));
    await expect(guard.canActivate(contexto(await supabase({ [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } })).ctx))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(contexto(await supabase({})).ctx)).resolves.toBe(true);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('token comum (login próprio) não consulta o banco', async () => {
    const { guard, prisma } = bancoFalso([]);
    const comum = await emitirAccessToken({ sub: ADMIN, sessionVersion: 0 }, { segredo: authSecret, issuer: authIssuer, ttlSegundos: 900 });
    await expect(guard.canActivate(contexto(comum, { handler: Rotas.prototype.fechada }).ctx)).resolves.toBe(true);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('falha fechada: sem banco no guard → 403; erro do banco sobe (nunca libera)', async () => {
    const semBanco = new SupabaseAuthGuard(env);
    await expect(semBanco.canActivate(contexto(await tokenSuporte()).ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const { guard } = bancoFalso(new Error('banco fora'));
    await expect(guard.canActivate(contexto(await tokenSuporte(), { metodo: 'POST' }).ctx)).rejects.toThrow('banco fora');
  });

  it('as rotas de Auth, o sino ao vivo, a telemetria e o próprio atendimento recusam o token de atendimento', () => {
    expect(Reflect.getMetadata(RECUSA_SUPORTE, SuporteController)).toBe(true);
    expect(Reflect.getMetadata(RECUSA_SUPORTE, AuthController.prototype.me)).toBe(true);
    expect(Reflect.getMetadata(RECUSA_SUPORTE, NotificacoesController.prototype.eventos)).toBe(true);
    expect(Reflect.getMetadata(RECUSA_SUPORTE, PerfilController.prototype.registrarAtividade)).toBe(true);
    // Os dados do titular seguem abertos ao atendimento (como o PostgREST pelo proxy).
    expect(Reflect.getMetadata(RECUSA_SUPORTE, PerfilController.prototype.atualizar)).toBeUndefined();
    expect(Reflect.getMetadata(RECUSA_SUPORTE, NotificacoesController.prototype.listar)).toBeUndefined();
  });
});
