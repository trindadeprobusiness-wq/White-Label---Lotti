// Atendimento do backoffice (B6) com o SQL REAL: SuporteService e o guard sobre o PGlite com todas as
// migrations. Abrir/encerrar gravam a sessão e a auditoria como as funções da Edge; o token de
// atendimento só passa no guard com a sessão ativa, e uma escrita feita com ele fica auditada pelo
// gatilho auditar_mutacao_suporte() com o administrador como ator.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthController } from '../../src/auth/auth.controller';
import { PerfilController } from '../../src/auth/perfil.controller';
import type { AtualizarCorretorDto } from '../../src/auth/perfil.dto';
import { PerfilService } from '../../src/auth/perfil.service';
import { SupabaseAuthGuard } from '../../src/auth/supabase-auth.guard';
import { verificarAccessToken } from '../../src/auth/tokens';
import type { AppEnv } from '../../src/config/env';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { SuporteController } from '../../src/suporte/suporte.controller';
import { SuporteService } from '../../src/suporte/suporte.service';
import { type BancoTeste, capturarErroHttp, type ContaTeste, criarBanco } from './harness';

const SEGREDO = 'segredo-proprio-com-mais-de-32-caracteres!!';
const ISSUER = 'lotti-api';
const env = {
  authJwtSecret: SEGREDO, authIssuer: ISSUER,
  supabaseUrl: 'https://abc.supabase.co', supabaseJwtSecret: 'segredo-do-supabase-com-mais-de-32-caracteres',
} as AppEnv;

let banco: BancoTeste;
let suporte: SuporteService;
let guard: SupabaseAuthGuard;
let perfil: PerfilService;
let admin: ContaTeste;
let outroAdmin: ContaTeste;

before(async () => {
  banco = await criarBanco();
  admin = await banco.criarConta({ nome: 'Admin do backoffice' });
  outroAdmin = await banco.criarConta({ nome: 'Outro admin' });
  await banco.inserir('user_roles', { user_id: admin.userId, role: 'admin' });
  await banco.inserir('user_roles', { user_id: outroAdmin.userId, role: 'super_admin' });
  const prisma = banco.prisma as unknown as PrismaService;
  suporte = new SuporteService(banco.db, prisma, env);
  guard = new SupabaseAuthGuard(env, prisma, new Reflector());
  perfil = new PerfilService(banco.db);
});
after(async () => { await banco?.fechar(); });

// ------------------------------------------------------------------ apoio

/** Uma requisição pelo guard real, com o handler e a classe do controller (para a regra de rota). */
function pedido(token: string, metodo: string, handler: (...a: never[]) => unknown, classe: object, rota: string) {
  const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` }, method: metodo, route: { path: rota } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => classe,
  } as unknown as ExecutionContext;
  return { ctx, request };
}
const lerPerfil = (t: string) => pedido(t, 'GET', PerfilController.prototype.obter, PerfilController, '/api/perfil/corretor');
const editarPerfil = (t: string) => pedido(t, 'PATCH', PerfilController.prototype.atualizar, PerfilController, '/api/perfil/corretor');

async function passar(p: { ctx: ExecutionContext; request: Record<string, unknown> }): Promise<SupabaseClaims> {
  assert.equal(await guard.canActivate(p.ctx), true);
  return p.request.claims as SupabaseClaims;
}

const auditoria = (acao: string, sessao: string) => banco.sqlSuperusuario<{
  ator: string; entidade: string; entidade_id: string; dados: Record<string, unknown>; motivo: string | null;
}>(`select ator_user_id::text as ator, entidade, entidade_id, dados_depois as dados, motivo
      from public.admin_auditoria where acao = $1 and dados_depois->>'sessao_id' = $2 order by id`, [acao, sessao]);

const contar = async (sql: string, params: unknown[] = []) => Number((await banco.sqlSuperusuario<{ n: number }>(sql, params))[0].n);

const ENCERRADO = { statusCode: 403, codigo: 'atendimento_encerrado', message: 'Atendimento encerrado ou acesso revogado.' };

// ------------------------------------------------------------------ abrir: quem pode e o que fica gravado

describe('abrir', () => {
  test('quem não é admin → 403 e nada é gravado', async () => {
    const antes = await contar('select count(*)::int as n from public.admin_sessoes_suporte');
    const erro = await capturarErroHttp(suporte.abrir(banco.claimsB, { corretor_id: banco.corretorA }));
    assert.deepEqual(erro, { status: 403, corpo: { statusCode: 403, codigo: 'sem_permissao', message: 'Acesso negado.' } });
    assert.equal(await contar('select count(*)::int as n from public.admin_sessoes_suporte'), antes);
    assert.equal(await contar(`select count(*)::int as n from public.admin_auditoria where acao = 'suporte_aberto' and ator_user_id = $1::uuid`, [banco.contaB.userId]), 0);
  });

  test('conta administrativa e conta sem corretor → 403 com o texto da função', async () => {
    const adm = await capturarErroHttp(suporte.abrir(admin.claims, { corretor_id: outroAdmin.corretorId }));
    assert.equal(adm.status, 403);
    assert.equal(adm.corpo.codigo, 'conta_administrativa');
    const inexistente = await capturarErroHttp(suporte.abrir(admin.claims, { usuario_id: '99999999-9999-4999-8999-999999999999' }));
    assert.equal(inexistente.corpo.codigo, 'conta_inativa');
  });

  test('admin: sessão de 30 min, auditoria suporte_aberto com o motivo, token do titular com o session_id da sessão', async () => {
    const r = await suporte.abrir(admin.claims, { usuario_id: banco.contaA.userId, motivo: 'Ajuda com o perfil' });
    const [s] = await banco.sqlSuperusuario<{
      ator: string; titular: string; corretor: string; auth_session_id: string; minutos: number; encerrado: boolean; exp: number;
    }>(`select ator_user_id::text as ator, user_id::text as titular, corretor_id::text as corretor,
               auth_session_id::text as auth_session_id, extract(epoch from expira_em - criado_em)::int / 60 as minutos,
               encerrado_em is not null as encerrado, floor(extract(epoch from expira_em))::int as exp
          from public.admin_sessoes_suporte where id = $1::uuid`, [r.id]);
    assert.deepEqual({ ...s, auth_session_id: undefined, exp: undefined }, {
      ator: admin.userId, titular: banco.contaA.userId, corretor: banco.corretorA, auth_session_id: undefined,
      minutos: 30, encerrado: false, exp: undefined,
    });
    assert.equal(r.corretor_id, banco.corretorA);
    assert.equal(r.user.id, banco.contaA.userId);
    assert.equal(r.user.email, banco.contaA.email);
    assert.ok(r.nome);

    const aberta = await auditoria('suporte_aberto', r.id);
    assert.equal(aberta.length, 1);
    assert.deepEqual({ ator: aberta[0].ator, entidade: aberta[0].entidade, entidade_id: aberta[0].entidade_id, motivo: aberta[0].motivo },
      { ator: admin.userId, entidade: 'corretores', entidade_id: banco.corretorA, motivo: 'Ajuda com o perfil' });
    assert.ok(aberta[0].dados.expira_em);

    const claims = await verificarAccessToken(r.token, { segredo: SEGREDO, issuer: ISSUER });
    assert.equal(claims.sub, banco.contaA.userId);
    assert.equal(claims.session_id, s.auth_session_id);
    assert.deepEqual(claims.suporte, { sessao_id: r.id, ator: admin.userId });
    assert.ok((claims.exp as number) <= s.exp);
    assert.equal(claims.sv, undefined);
  });
});

// ------------------------------------------------------------------ o atendimento de ponta a ponta

describe('atendimento', () => {
  test('escrita com o token passa pelo guard e fica auditada com o administrador como ator; encerrar mata o token', async () => {
    const r = await suporte.abrir(admin.claims, { corretor_id: banco.corretorA });

    // Leitura: passa e não deixa linha de requisição.
    const lidas = await passar(lerPerfil(r.token));
    assert.equal(lidas.sub, banco.contaA.userId);
    assert.equal((await auditoria('suporte_requisicao', r.id)).length, 0);
    assert.equal((await perfil.obter(lidas)).corretor?.id, banco.corretorA);

    // Escrita: o guard grava a requisição; o gatilho grava a mudança campo a campo, com o ator real.
    const claims = await passar(editarPerfil(r.token));
    const requisicao = await auditoria('suporte_requisicao', r.id);
    assert.equal(requisicao.length, 1);
    assert.deepEqual({ ator: requisicao[0].ator, entidade_id: requisicao[0].entidade_id, dados: requisicao[0].dados }, {
      ator: admin.userId, entidade_id: banco.corretorA,
      dados: { sessao_id: r.id, servico: 'api', recurso: '/api/perfil/corretor', metodo: 'PATCH' },
    });
    const linha = await perfil.atualizar(claims, { nome: 'Nome pelo suporte' } as AtualizarCorretorDto);
    assert.equal(linha.nome, 'Nome pelo suporte');
    const mudanca = await auditoria('suporte_update', r.id);
    assert.equal(mudanca.length, 1);
    assert.equal(mudanca[0].ator, admin.userId);
    assert.equal(mudanca[0].entidade, 'corretores');
    assert.equal(mudanca[0].entidade_id, banco.corretorA);
    assert.equal(mudanca[0].motivo, 'Atendimento pelo backoffice');
    assert.equal(mudanca[0].dados.corretor_id, banco.corretorA);
    assert.ok((mudanca[0].dados.campos as string[]).includes('nome'));

    // Outro administrador não encerra a sessão alheia.
    assert.deepEqual(await capturarErroHttp(suporte.encerrar(outroAdmin.claims, r.id)), {
      status: 403, corpo: { statusCode: 403, codigo: 'atendimento_nao_encerrado', message: 'Não foi possível encerrar o atendimento.' },
    });
    assert.equal(await contar('select count(*)::int as n from public.admin_sessoes_suporte where id = $1::uuid and encerrado_em is null', [r.id]), 1);

    // O token de atendimento não serve para encerrar (nem para nada de Auth).
    const comToken = pedido(r.token, 'POST', SuporteController.prototype.encerrar, SuporteController, '/api/admin/suporte/encerrar');
    assert.equal((await capturarErroHttp(guard.canActivate(comToken.ctx))).corpo.codigo, 'indisponivel_no_atendimento');
    const me = pedido(r.token, 'GET', AuthController.prototype.me, AuthController, '/api/auth/me');
    assert.equal((await capturarErroHttp(guard.canActivate(me.ctx))).corpo.codigo, 'indisponivel_no_atendimento');

    // O ator encerra: auditoria suporte_encerrado; o token para de passar no guard na hora.
    assert.deepEqual(await suporte.encerrar(admin.claims, r.id), { ok: true });
    assert.equal((await auditoria('suporte_encerrado', r.id)).length, 1);
    assert.deepEqual(await capturarErroHttp(guard.canActivate(lerPerfil(r.token).ctx)), { status: 403, corpo: ENCERRADO });

    // Mesmo quem guardou as claims e pulasse o guard: o gatilho recusa a escrita e nada muda.
    assert.deepEqual(await capturarErroHttp(perfil.atualizar(claims, { nome: 'Depois do fim' } as AtualizarCorretorDto)), {
      status: 403, corpo: { statusCode: 403, codigo: 'atendimento_expirado', message: 'Atendimento expirado.' },
    });
    assert.equal((await perfil.obter(banco.claimsA)).corretor?.nome, 'Nome pelo suporte');

    // Encerrar de novo é idempotente: nenhuma auditoria a mais.
    assert.deepEqual(await suporte.encerrar(admin.claims, r.id), { ok: true });
    assert.equal((await auditoria('suporte_encerrado', r.id)).length, 1);
  });

  test('sessão vencida → 403 no guard', async () => {
    const r = await suporte.abrir(admin.claims, { corretor_id: banco.corretorA });
    await passar(lerPerfil(r.token));
    await banco.sqlSuperusuario(`update public.admin_sessoes_suporte set expira_em = now() - interval '1 minute' where id = $1::uuid`, [r.id]);
    assert.deepEqual(await capturarErroHttp(guard.canActivate(editarPerfil(r.token).ctx)), { status: 403, corpo: ENCERRADO });
    assert.equal((await auditoria('suporte_requisicao', r.id)).length, 0);
  });

  test('papel do administrador revogado no meio do atendimento → 403 no guard', async () => {
    const r = await suporte.abrir(admin.claims, { corretor_id: banco.corretorA });
    await passar(lerPerfil(r.token));
    await banco.sqlSuperusuario(`update public.user_roles set revogado_em = now() where user_id = $1::uuid`, [admin.userId]);
    try {
      assert.deepEqual(await capturarErroHttp(guard.canActivate(lerPerfil(r.token).ctx)), { status: 403, corpo: ENCERRADO });
      assert.equal((await capturarErroHttp(suporte.abrir(admin.claims, { corretor_id: banco.corretorA }))).corpo.codigo, 'sem_permissao');
    } finally {
      await banco.sqlSuperusuario(`update public.user_roles set revogado_em = null where user_id = $1::uuid`, [admin.userId]);
    }
  });
});

test('nenhuma chamada deixou transação abortada para trás (COMMIT que vira ROLLBACK calado)', () => {
  assert.equal(banco.transacoes.commitsAbortados, 0);
  assert.ok(banco.transacoes.commits > 0);
});
