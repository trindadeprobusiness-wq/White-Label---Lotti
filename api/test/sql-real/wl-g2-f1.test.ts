/**
 * WL-G2 F1: regressões RED do contrato F0, sem implementação de F2.
 * Executar de api/: node --import tsx --test test/sql-real/wl-g2-f1.test.ts
 * Controles: node --import tsx --test --test-name-pattern=AUX test/sql-real/wl-g2-f1.test.ts
 * RED: node --import tsx --test --test-name-pattern=RED test/sql-real/wl-g2-f1.test.ts
 *
 * O harness aplica migrations reais em PGlite em memória, sem rede. Cada caso
 * recebe banco novo; auth.users cria UMA membership ativa em A para a identidade
 * sob teste. A conta B é outra identidade e fornece a organização de destino.
 * Este recorte cobre B4, revogação e o contexto atual sem seletor (RED3). Outsider,
 * organização forjada/nula, ID de B, parent-child cross-org e capability ficam para
 * F3/F6 conforme contrato; este arquivo não afirma cobertura desses cenários.
 * Não se desliga RLS/gatilhos nem se remove índice. Nenhum grant novo é inventado.
 * O insert privilegiado abaixo é uma sonda da constraint, não uma API de concessão.
 * PGlite não prova pool/Prisma reais, concorrência ou autorização multi-org futura.
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { buscarContexto, exigirContexto } from '../../src/rotina/rotina.contexto';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

interface Membership {
  organization_id: string;
  user_id: string;
  role: string;
  status: string;
}

let banco: BancoTeste | undefined;
let orgA: string;
let orgB: string;

function db(): BancoTeste {
  assert.ok(banco, 'o harness precisa concluir a criação do banco');
  return banco;
}

async function memberships(): Promise<Membership[]> {
  return db().sqlSuperusuario<Membership>(
    `select organization_id::text, user_id::text, role, status
       from public.routine_memberships where user_id = $1::uuid
       order by organization_id`,
    [db().contaA.userId],
  );
}

beforeEach(async () => {
  banco = await criarBanco();
  const inicial = await memberships();
  assert.equal(inicial.length, 1, 'setup não deve semear uma segunda membership');
  assert.equal(inicial[0].status, 'active');
  assert.equal(inicial[0].user_id, db().contaA.userId);
  orgA = inicial[0].organization_id;
  const destino = await db().sqlSuperusuario<{ id: string }>(
    `select id::text from public.routine_organizations where legacy_corretor_id = $1::uuid`,
    [db().corretorB],
  );
  assert.equal(destino.length, 1);
  orgB = destino[0].id;
  assert.notEqual(orgA, orgB);
});

afterEach(async () => {
  await banco?.fechar();
  banco = undefined;
});

test('AUX identidade em A lê somente sua membership sob RLS', async () => {
  const visiveis = await db().db.run(db().claimsA, (tx) => tx.$queryRaw<Array<{ organization_id: string }>>(Prisma.sql`
    select organization_id::text from public.routine_memberships
     where user_id = ${db().contaA.userId}::uuid and status = 'active'`));
  assert.deepEqual(visiveis, [{ organization_id: orgA }]);
});

test('AUX identidade inválida é recusada antes da transação', async () => {
  const antes = { ...db().transacoes };
  await assert.rejects(db().db.run({ sub: '', role: 'authenticated' }, async () => 1), /claims_invalidas/);
  assert.deepEqual(db().transacoes, antes);
});

test('AUX membership revogada não resolve contexto na próxima operação', async () => {
  await db().sqlSuperusuario(
    `update public.routine_memberships set status = 'revoked'
      where organization_id = $1::uuid and user_id = $2::uuid`,
    [orgA, db().contaA.userId],
  );
  assert.equal((await memberships())[0].status, 'revoked');
  const contexto = await db().db.run(db().claimsA, (tx) => buscarContexto(tx, db().contaA.userId));
  assert.equal(contexto, null);
  const erro = await capturarErroHttp(db().db.run(db().claimsA, (tx) => exigirContexto(tx, db().contaA.userId)));
  assert.equal(erro.status, 403);
  assert.equal(erro.corpo.codigo, 'routine_membership_required');
});

test('RED inserir membership ativa em B preserva a membership ativa inicial em A', async () => {
  const inicial = await memberships();
  let causa: unknown;
  try {
    // Operação sob teste: somente aqui se tenta criar o segundo vínculo ativo.
    await db().sqlSuperusuario(
      `insert into public.routine_memberships (organization_id, user_id, role, status)
       values ($1::uuid, $2::uuid, $3::text, 'active')`,
      // Papel não-owner válido; default de routine_memberships.role (0_init:1437).
      [orgB, db().contaA.userId, 'corretor'],
    );
  } catch (erro) {
    const pg = erro as { code?: string; constraint?: string };
    assert.equal(pg.code, '23505', 'falha de ambiente/setup não é o RED esperado');
    assert.equal(pg.constraint, 'uq_routine_membership_ativa_por_usuario');
    assert.deepEqual(await memberships(), inicial, 'insert recusado não deve alterar A');
    causa = erro;
  }
  assert.equal(causa, undefined,
    'F0 exige vínculos simultâneos; tentativa B recusada por SQLSTATE 23505 / uq_routine_membership_ativa_por_usuario');
  const depois = await memberships();
  assert.equal(depois.length, 2);
  assert.equal(depois.find((m) => m.organization_id === orgA)?.status, 'active');
  assert.equal(depois.find((m) => m.organization_id === orgB)?.status, 'active');
});

test('RED aceitar convite válido de B mantém A ativa para a mesma identidade', async () => {
  const convites = await db().db.run(db().claimsB, (tx) => tx.$queryRaw<Array<{ linha: { id: string; token: string } }>>(Prisma.sql`
    select public.criar_convite_organizacao(${db().contaA.email}::text) as linha`));
  assert.equal(convites.length, 1);
  const convite = convites[0].linha;
  assert.ok(convite.id);
  assert.ok(convite.token);
  assert.equal((await memberships()).length, 1, 'convite pendente não cria membership ativa em B');

  // Usa o e-mail autenticado de A e a função real de aceite; não simula seu efeito.
  const aceites = await db().db.run(db().claimsA, (tx) => tx.$queryRaw<Array<{ linha: { organization_id: string } }>>(Prisma.sql`
    select public.aceitar_convite_organizacao(${convite.token}::text) as linha`));
  assert.equal(aceites.length, 1);
  assert.equal(aceites[0].linha.organization_id, orgB);
  const estado = await db().sqlSuperusuario<{ status: string; aceito_por: string }>(
    `select status, aceito_por::text from public.organizacao_convites where id = $1::uuid`, [convite.id]);
  assert.deepEqual(estado, [{ status: 'aceito', aceito_por: db().contaA.userId }]);
  const depois = await memberships();
  assert.equal(depois.length, 2);
  assert.equal(depois.find((m) => m.organization_id === orgB)?.status, 'active');
  const estadoA = depois.find((m) => m.organization_id === orgA)?.status;
  assert.equal(estadoA, 'active',
    `F0 proíbe revogar A ao aceitar B; aceite concluiu e B está active, mas A ficou ${estadoA}`);
});

test('RED operação sem organização selecionada não escolhe A implicitamente', async () => {
  // A interface atual não recebe seletor organizacional: não inventar header/claim.
  const contexto = await db().db.run(db().claimsA, (tx) => buscarContexto(tx, db().contaA.userId));
  if (contexto) {
    assert.equal(contexto.organization.id, orgA, 'diagnóstico deve ser o fallback A, não outro tenant');
  }
  assert.equal(contexto, null, 'F0 exige negar contexto ausente; buscarContexto escolheu a membership A implicitamente');
});
