/**
 * Login próprio contra o schema REAL (PGlite com todas as migrations).
 *
 * Prova o que o contrato fixa como invariante:
 *  - as tabelas public.usuarios e public.auth_refresh_tokens existem com RLS
 *    habilitada e SEM policy pública (nenhum papel do PostgREST lê/escreve);
 *  - o UsuariosRepo real (SQL de produção) acha a conta pelo e-mail normalizado,
 *    grava só o hash do refresh e faz rotação/revogação por família;
 *  - o id PRESERVADO (usuarios.id = auth.users.id) resolve o MESMO get_corretor_id().
 */
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { UsuariosRepo } from '../../src/auth/usuarios.repo';
import { type BancoTeste, criarBanco, USUARIO_A } from './harness';

let banco: BancoTeste;
let repo: UsuariosRepo;

before(async () => {
  banco = await criarBanco();
  repo = new UsuariosRepo(banco.prisma as unknown as PrismaService);
  // A conta nasce vazia em produção; aqui preenchemos UMA linha como o script da
  // virada faria: id PRESERVADO da conta A, e-mail e um bcrypt qualquer.
  await banco.inserir('public.usuarios', {
    id: USUARIO_A,
    email: 'Conta-A@teste.lotti.local',
    password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEF0123456789ghijklm',
    status: 'ativo',
  });
});

after(async () => { await banco.fechar(); });

describe('tabelas do login próprio', () => {
  test('usuarios e auth_refresh_tokens têm RLS habilitada e nenhuma policy', async () => {
    const rls = await banco.sqlSuperusuario<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname in ('usuarios', 'auth_refresh_tokens') and relnamespace = 'public'::regnamespace
       order by relname`,
    );
    assert.deepEqual(rls.map((r) => r.relname), ['auth_refresh_tokens', 'usuarios']);
    assert.ok(rls.every((r) => r.relrowsecurity === true), 'RLS precisa estar habilitada nas duas');

    const policies = await banco.sqlSuperusuario<{ tablename: string }>(
      `select tablename from pg_policies where schemaname = 'public'
       and tablename in ('usuarios', 'auth_refresh_tokens')`,
    );
    assert.equal(policies.length, 0, 'não pode existir policy pública: só o dono enxerga');
  });

  test('o índice único é por e-mail normalizado (lower/btrim)', async () => {
    // Mesmo e-mail em outra caixa/with espaços colide com a linha já inserida.
    await assert.rejects(
      banco.inserir('public.usuarios', { id: randomUUID(), email: '  conta-a@TESTE.lotti.local  ' }),
      /duplicate key|unique/i,
    );
  });
});

describe('UsuariosRepo (SQL real)', () => {
  test('buscarPorEmail acha pela forma normalizada e devolve o hash para o compare', async () => {
    const u = await repo.buscarPorEmail('conta-a@teste.lotti.local');
    assert.ok(u, 'deveria achar a conta');
    assert.equal(u!.id, USUARIO_A);
    assert.equal(u!.passwordHash?.slice(0, 3), '$2a');
    assert.equal(u!.status, 'ativo');
    assert.equal(await repo.buscarPorEmail('ninguem@teste.lotti.local'), null);
  });

  test('rotação e revogação por família guardam só o hash do refresh', async () => {
    const familyId = randomUUID();
    const bruto = 'refresh-opaco-de-teste';
    const tokenHash = createHash('sha256').update(bruto).digest('hex');
    const id = await repo.inserirRefreshToken({
      userId: USUARIO_A, familyId, tokenHash, sessionVersion: 0,
      expiresAt: new Date(Date.now() + 86400_000),
    });
    assert.ok(id);

    // só o hash foi gravado, nunca o token cru
    const linhas = await banco.sqlSuperusuario<{ token_hash: string }>(
      `select token_hash from public.auth_refresh_tokens where id = $1::uuid`, [id],
    );
    assert.equal(linhas[0].token_hash, tokenHash);
    assert.notEqual(linhas[0].token_hash, bruto);

    const achado = await repo.buscarRefreshPorHash(tokenHash);
    assert.equal(achado!.familyId, familyId);
    assert.equal(achado!.usedAt, null);

    assert.equal(await repo.marcarUsado(id), 1);
    assert.equal(await repo.marcarUsado(id), 0, 'segunda marcação não pega (já usado)');

    assert.equal(await repo.revogarFamilia(familyId), 1);
    assert.equal(await repo.revogarFamilia(familyId), 0, 'revogação é idempotente');
  });
});

describe('id preservado mantém o RLS idêntico', () => {
  test('sub = auth.users.id resolve o MESMO get_corretor_id() de hoje', async () => {
    const claims: SupabaseClaims = { sub: USUARIO_A, role: 'authenticated', aud: 'authenticated', email: 'conta-a@teste.lotti.local' };
    const [{ corretor_id }] = await banco.db.run(claims, (tx) =>
      tx.$queryRawUnsafe<Array<{ corretor_id: string | null }>>('select public.get_corretor_id()::text as corretor_id'),
    );
    assert.equal(corretor_id, banco.corretorA, 'o id preservado precisa resolver o mesmo corretor da conta A');
  });
});
