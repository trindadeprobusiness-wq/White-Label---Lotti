import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CLAIM_SUPORTE } from '../auth/token-suporte';
import { verificarAccessToken } from '../auth/tokens';
import { AppEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { SuporteService } from './suporte.service';

const segredo = 'segredo-proprio-com-mais-de-32-caracteres!!';
const env = { authJwtSecret: segredo, authIssuer: 'lotti-api' } as AppEnv;
const ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TITULAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORRETOR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SESSAO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AUTH_SESSAO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const claimsAdmin: SupabaseClaims = { sub: ADMIN, role: 'authenticated' };

const erroDoBanco = (sqlstate: string, mensagem: string) => new Prisma.PrismaClientKnownRequestError('falha', {
  code: 'P2010', clientVersion: 'teste', meta: { code: sqlstate, message: `ERROR: ${mensagem}` },
});

interface Cenario {
  preparo?: Error;
  usuario?: Record<string, unknown> | null;
  mfa?: boolean;
  atorComPapel?: boolean;
  contaLivre?: boolean;
  encerrar?: Error;
}

/** TenantDb e PrismaService falsos que respondem pelo texto do SQL. */
function montar(c: Cenario = {}, ambiente: AppEnv = env) {
  const expiraEm = new Date(Date.now() + 30 * 60_000);
  const sqls: Prisma.Sql[] = [];
  const db = {
    run: jest.fn(async (_claims: SupabaseClaims, trabalho: (tx: unknown) => Promise<unknown>) => trabalho({
      $queryRaw: async (sql: Prisma.Sql) => {
        sqls.push(sql);
        if (c.preparo) throw c.preparo;
        return [{ alvo: { corretor_id: CORRETOR, user_id: TITULAR, nome: 'Conta Atendida' } }];
      },
    })),
  };
  const responder = async (sql: Prisma.Sql) => {
    sqls.push(sql);
    const t = sql.sql;
    if (t.includes('from auth.users')) {
      return c.usuario === null ? [] : [{
        id: TITULAR, email: 'titular@exemplo.com', email_confirmed_at: new Date(), user_metadata: { nome: 'Titular' },
        created_at: new Date('2026-01-01T00:00:00Z'), ...c.usuario,
      }];
    }
    if (t.includes("to_regclass('auth.mfa_factors')")) return [{ existe: c.mfa !== undefined }];
    if (t.includes('from auth.mfa_factors')) return [{ tem: c.mfa === true }];
    if (t.includes('where user_id = $1::uuid') || t.includes('from public.corretores where user_id')) return [{ id: CORRETOR }];
    if (t.includes('for share of c')) return c.contaLivre === false ? [] : [{ user_id: TITULAR }];
    if (t.includes('insert into public.admin_sessoes_suporte')) {
      return [{ id: SESSAO, corretor_id: CORRETOR, auth_session_id: AUTH_SESSAO, expira_em: expiraEm }];
    }
    if (t.includes('from public.user_roles')) return [{ ok: c.atorComPapel !== false }];
    throw new Error(`SQL inesperado: ${t}`);
  };
  const prisma = {
    $queryRaw: jest.fn(responder),
    $executeRaw: jest.fn(async (sql: Prisma.Sql) => { sqls.push(sql); if (c.encerrar) throw c.encerrar; return 1; }),
    $transaction: jest.fn(async (trabalho: (tx: unknown) => Promise<unknown>) => trabalho({ $queryRaw: responder })),
  };
  const servico = new SuporteService(db as unknown as TenantDb, prisma as unknown as PrismaService, ambiente);
  return { servico, db, prisma, sqls, expiraEm };
}

async function erro(promessa: Promise<unknown>): Promise<{ status: number; corpo: Record<string, unknown> }> {
  try {
    await promessa;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('era esperado um HttpException');
}

describe('SuporteService.abrir', () => {
  it('admin: cria a sessão e devolve o corpo da Edge com um token cujo sub é o titular', async () => {
    const { servico, sqls, expiraEm, prisma } = montar();
    const r = await servico.abrir(claimsAdmin, { corretor_id: CORRETOR });
    expect(r).toMatchObject({
      id: SESSAO, corretor_id: CORRETOR, nome: 'Conta Atendida', expira_em: expiraEm.toISOString(),
      user: { id: TITULAR, email: 'titular@exemplo.com', aud: 'authenticated', role: 'authenticated', app_metadata: {},
        user_metadata: { nome: 'Titular' }, created_at: '2026-01-01T00:00:00.000Z' },
    });
    const claims = await verificarAccessToken(r.token, { segredo, issuer: 'lotti-api' });
    expect(claims).toMatchObject({ sub: TITULAR, session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } });
    expect(claims.exp).toBeLessThanOrEqual(Math.floor(expiraEm.getTime() / 1000));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // O motivo de sempre vai para a auditoria de abertura.
    const abertura = sqls.find((s) => s.sql.includes('insert into public.admin_sessoes_suporte'));
    expect(abertura?.sql).toContain("'suporte_aberto'");
    expect(abertura?.values).toEqual([ADMIN, TITULAR, CORRETOR, 'Atendimento pelo backoffice']);
  });

  it('motivo informado vai para a auditoria; usuario_id resolve o corretor', async () => {
    const { servico, sqls } = montar();
    await servico.abrir(claimsAdmin, { usuario_id: TITULAR, motivo: '  Cliente pediu ajuda no funil  ' });
    const abertura = sqls.find((s) => s.sql.includes('insert into public.admin_sessoes_suporte'));
    expect(abertura?.values.at(-1)).toBe('Cliente pediu ajuda no funil');
  });

  it('quem não é admin → 403 e nada é criado', async () => {
    const { servico, prisma } = montar({ preparo: erroDoBanco('42501', 'acesso negado') });
    expect(await erro(servico.abrir(claimsAdmin, { corretor_id: CORRETOR }))).toEqual({
      status: 403, corpo: { statusCode: 403, codigo: 'sem_permissao', message: 'Acesso negado.' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('conta administrativa ou inativa → 403 com o texto da função', async () => {
    const adm = montar({ preparo: erroDoBanco('42501', 'Contas administrativas nao podem ser abertas em modo de atendimento.') });
    expect((await erro(adm.servico.abrir(claimsAdmin, { corretor_id: CORRETOR }))).corpo.codigo).toBe('conta_administrativa');
    const inativa = montar({ preparo: erroDoBanco('42501', 'A conta precisa estar ativa para iniciar atendimento.') });
    expect((await erro(inativa.servico.abrir(claimsAdmin, { corretor_id: CORRETOR }))).corpo.codigo).toBe('conta_inativa');
  });

  it('ator perdeu o papel ou a conta mudou entre o preparo e a transação → 403', async () => {
    expect((await erro(montar({ atorComPapel: false }).servico.abrir(claimsAdmin, { corretor_id: CORRETOR }))).corpo.codigo)
      .toBe('sem_permissao');
    expect((await erro(montar({ contaLivre: false }).servico.abrir(claimsAdmin, { corretor_id: CORRETOR }))).corpo.codigo)
      .toBe('conta_indisponivel');
  });

  it('e-mail não confirmado ou duas etapas → 409, sem sessão', async () => {
    const semEmail = montar({ usuario: { email_confirmed_at: null } });
    expect(await erro(semEmail.servico.abrir(claimsAdmin, { corretor_id: CORRETOR }))).toMatchObject({ status: 409 });
    expect(semEmail.prisma.$transaction).not.toHaveBeenCalled();
    const mfa = montar({ mfa: true });
    expect((await erro(mfa.servico.abrir(claimsAdmin, { corretor_id: CORRETOR }))).corpo.codigo).toBe('conta_com_duas_etapas');
    expect(mfa.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sem AUTH_JWT_SECRET → 503; conta ausente ou dupla → 400; token de atendimento como ator → 403', async () => {
    expect((await erro(montar({}, { ...env, authJwtSecret: undefined }).servico.abrir(claimsAdmin, { corretor_id: CORRETOR }))).status).toBe(503);
    const { servico, db } = montar();
    expect((await erro(servico.abrir(claimsAdmin, {}))).status).toBe(400);
    expect((await erro(servico.abrir(claimsAdmin, { corretor_id: CORRETOR, usuario_id: TITULAR }))).status).toBe(400);
    const deSuporte = { ...claimsAdmin, session_id: AUTH_SESSAO, [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } };
    expect((await erro(servico.abrir(deSuporte, { corretor_id: CORRETOR }))).status).toBe(403);
    expect(db.run).not.toHaveBeenCalled();
  });
});

describe('SuporteService.encerrar', () => {
  it('chama suporte_encerrar_sessao com a sessão e o ator do token', async () => {
    const { servico, prisma } = montar();
    await expect(servico.encerrar(claimsAdmin, SESSAO)).resolves.toEqual({ ok: true });
    expect(prisma.$executeRaw.mock.calls[0][0].values).toEqual([SESSAO, ADMIN]);
  });

  it('ator errado (42501 da função) → 403; outro erro sobe; token de atendimento → 403', async () => {
    expect(await erro(montar({ encerrar: erroDoBanco('42501', 'acesso negado') }).servico.encerrar(claimsAdmin, SESSAO))).toEqual({
      status: 403, corpo: { statusCode: 403, codigo: 'atendimento_nao_encerrado', message: 'Não foi possível encerrar o atendimento.' },
    });
    await expect(montar({ encerrar: new Error('rede') }).servico.encerrar(claimsAdmin, SESSAO)).rejects.toThrow('rede');
    const { servico, prisma } = montar();
    const deSuporte = { sub: TITULAR, role: 'authenticated', [CLAIM_SUPORTE]: { sessao_id: SESSAO, ator: ADMIN } };
    expect((await erro(servico.encerrar(deSuporte, SESSAO))).status).toBe(403);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
