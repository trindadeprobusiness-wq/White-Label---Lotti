// Prova o banco de teste compartilhado: o TenantDb real sobre o PGlite com todas as migrations recusa
// claims inválidas, isola as contas pelo RLS, entrega erro de SQL como o Prisma (P2010) e roda o SQL
// real de um método de cada service novo.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { CrmClientesService } from '../../src/crm/clientes/crm-clientes.service';
import { erroPg, traduzirErroBanco } from '../../src/crm/clientes/crm-clientes.erros';
import { CrmFunilService } from '../../src/crm/funil/crm-funil.service';
import type { CriarImovelDto } from '../../src/imoveis/imoveis-gestao.dto';
import { ImoveisGestaoService } from '../../src/imoveis/imoveis-gestao.service';
import { type BancoTeste, capturarErroHttp, criarBanco, LIMITE_IMOVEIS_A } from './harness';

let banco: BancoTeste;
let clienteA: string;
let clienteB: string;
let imovelB: string;

const TELEFONE_A = '62981234567';

before(async () => {
  banco = await criarBanco();
  clienteA = (await banco.inserir('clientes', { corretor_id: banco.corretorA, nome: 'Cliente da A', telefone: TELEFONE_A })).id as string;
  clienteB = (await banco.inserir('clientes', { corretor_id: banco.corretorB, nome: 'Cliente do B', telefone: '62981234568' })).id as string;
  // B não tem plano: a trava de cota recusaria o imóvel, então este entra com os gatilhos desligados.
  imovelB = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorB, titulo: 'Casa do B', tipo: 'CASA', valor: 500000, endereco: 'Rua 2', cidade: 'Anápolis', proprietario_nome: 'Dona',
  }, { semGatilhos: true })).id as string;
});
after(async () => { await banco?.fechar(); });

const como = <T>(claims: BancoTeste['claimsA'], sql: Prisma.Sql) => banco.db.run(claims, (tx) => tx.$queryRaw<T>(sql));
const erroDe = async (p: Promise<unknown>): Promise<Prisma.PrismaClientKnownRequestError> => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof Prisma.PrismaClientKnownRequestError, `esperava PrismaClientKnownRequestError, veio ${String(e)}`);
    return e;
  }
  throw new Error('a consulta deveria ter falhado');
};

test('(a) o TenantDb recusa claims inválidas antes de abrir transação', async () => {
  const antes = { ...banco.transacoes };
  for (const claims of [{ sub: '', role: 'authenticated' }, { sub: banco.contaA.userId, role: 'anon' }, { sub: banco.contaA.userId, role: 'service_role' }]) {
    await assert.rejects(banco.db.run(claims, async () => 1), /claims_invalidas/);
  }
  await assert.rejects(banco.db.run(null as never, async () => 1), /claims_invalidas/);
  assert.deepEqual(banco.transacoes, antes);
});

test('(b) o RLS isola A de B pelo TenantDb (claims + papel authenticated)', async () => {
  const ver = (claims: BancoTeste['claimsA']) => como<Array<{ eu: string; clientes: string[]; imoveis: number }>>(claims, Prisma.sql`
    select public.get_corretor_id()::text as eu, current_user::text as papel,
      (select coalesce(array_agg(id::text order by id), '{}') from public.clientes) as clientes,
      (select count(*)::int from public.imoveis) as imoveis`);
  assert.deepEqual(await ver(banco.claimsA), [{ eu: banco.corretorA, papel: 'authenticated', clientes: [clienteA], imoveis: 0 }]);
  assert.deepEqual(await ver(banco.claimsB), [{ eu: banco.corretorB, papel: 'authenticated', clientes: [clienteB], imoveis: 1 }]);
  // A não lê nem altera o cliente de B: zero linhas, sem erro, como no PostgREST.
  assert.deepEqual(await como(banco.claimsA, Prisma.sql`select id from public.clientes where id = ${clienteB}::uuid`), []);
  const alteradas = await banco.db.run(banco.claimsA, (tx) => tx.$executeRaw(Prisma.sql`update public.clientes set nome = ${'invadido'}::text where id = ${clienteB}::uuid`));
  assert.equal(alteradas, 0);
  // Fora do run (superusuário) o dado de B continua igual e as sessões voltaram ao papel original.
  assert.deepEqual(await banco.sqlSuperusuario(`select nome, current_user::text as papel from public.clientes where id = $1`, [clienteB]),
    [{ nome: 'Cliente do B', papel: 'postgres' }]);
});

test('(c) erro de SQL chega como P2010 com meta.code e meta.message iguais aos do Prisma', async () => {
  const uuidRuim = await erroDe(como(banco.claimsA, Prisma.sql`select ${'nao-e-uuid'}::uuid as id`));
  assert.equal(uuidRuim.code, 'P2010');
  assert.deepEqual(uuidRuim.meta, { code: '22P02', message: 'ERROR: invalid input syntax for type uuid: "nao-e-uuid"' });

  // RAISE com DETAIL (gatilho de telefone repetido): o tradutor da frente B tira o uuid do DETAIL.
  const repetido = await erroDe(banco.db.run(banco.claimsA, (tx) => tx.$executeRaw(Prisma.sql`
    insert into public.clientes (corretor_id, nome, telefone) values (${banco.corretorA}::uuid, ${'Outro'}::text, ${TELEFONE_A}::text)`)));
  assert.deepEqual(repetido.meta, { code: 'P0001', message: `ERROR: duplicate_client_phone\nDETAIL: ${clienteA}` });
  assert.deepEqual(erroPg(repetido), { sqlstate: 'P0001', mensagem: 'duplicate_client_phone', detalhe: clienteA, bruto: `ERROR: duplicate_client_phone\nDETAIL: ${clienteA}` });
  const http = await capturarErroHttp((async () => traduzirErroBanco(repetido))());
  assert.deepEqual(http, { status: 409, corpo: { statusCode: 409, codigo: 'duplicate_client_phone', message: 'Este telefone já é de outro cliente do CRM.', detalhe: clienteA } });

  // RLS na escrita: 42501.
  const rls = await erroDe(banco.db.run(banco.claimsA, (tx) => tx.$executeRaw(Prisma.sql`
    insert into public.historico_contatos (cliente_id, tipo, direcao, conteudo) values (${clienteB}::uuid, 'WHATSAPP', 'OUT', ${'x'}::text)`)));
  assert.equal((rls.meta as { code: string }).code, '42501');

  // Parâmetro tipado pelo valor, como no Prisma: sem cast, uuid = text não existe.
  const semCast = await erroDe(como(banco.claimsA, Prisma.sql`select 1 from public.clientes where id = ${clienteA}`));
  assert.equal((semCast.meta as { code: string }).code, '42883');
  assert.match((semCast.meta as { message: string }).message, /^ERROR: operator does not exist: uuid = text\nHINT: /);

  // Coluna que o Prisma não desserializa (void) falha em $queryRaw.
  const vazio = await erroDe(como(banco.claimsA, Prisma.sql`select pg_sleep(0)`));
  assert.equal((vazio.meta as { code: string }).code, 'N/A');
  assert.match((vazio.meta as { message: string }).message, /^Failed to deserialize column of type 'void'/);
});

test('(c) erro dentro do run aborta a transação de verdade (25P02) e nada é gravado', async () => {
  const antes = { ...banco.transacoes };
  let seguinte: unknown;
  const resposta = await banco.db.run(banco.claimsA, async (tx) => {
    await tx.$executeRaw(Prisma.sql`update public.clientes set observacoes = ${'gravado?'}::text where id = ${clienteA}::uuid`);
    await tx.$queryRaw(Prisma.sql`select ${'x'}::uuid`).catch(() => undefined); // o erro engolido que o contrato proíbe
    seguinte = await tx.$queryRaw(Prisma.sql`select 1 as um`).catch((e: unknown) => e);
    return 'sucesso aparente';
  });
  assert.equal(resposta, 'sucesso aparente');
  assert.ok(seguinte instanceof Prisma.PrismaClientKnownRequestError);
  assert.equal((seguinte.meta as { code: string }).code, '25P02');
  assert.deepEqual(banco.transacoes, { ...antes, commitsAbortados: antes.commitsAbortados + 1 });
  assert.deepEqual(await banco.sqlSuperusuario(`select observacoes from public.clientes where id = $1`, [clienteA]), [{ observacoes: null }]);
});

test('(c) valores das linhas saem como o Prisma entrega', async () => {
  const [linha] = await como<Array<Record<string, unknown>>>(banco.claimsA, Prisma.sql`
    select count(*) as contagem, 450000.5::numeric as preco, '2026-10-04'::date as dia,
      '2026-10-04 12:34:56.123456+00'::timestamptz as instante, '2026-10-04 12:34:56'::timestamp as sem_fuso,
      ${[clienteA, clienteB]}::uuid[] as ids, ${JSON.stringify({ a: [1, 2] })}::jsonb as dados,
      'VISITA_PROPOSTA'::public.status_funil as status, array['QUALIFICACAO']::public.status_funil[] as status_lista,
      to_jsonb(450000.5::numeric) as preco_json, to_jsonb('2026-10-04 12:34:56.123456+00'::timestamptz) as instante_json,
      ${1.5}::int as arredondado
    from public.clientes`);
  assert.equal(linha.contagem, 1n);
  assert.ok(Prisma.Decimal.isDecimal(linha.preco) && (linha.preco as Prisma.Decimal).equals('450000.5'));
  assert.deepEqual(linha.dia, new Date('2026-10-04T00:00:00.000Z'));
  assert.deepEqual(linha.instante, new Date('2026-10-04T12:34:56.123Z'));
  assert.deepEqual(linha.sem_fuso, new Date('2026-10-04T12:34:56.000Z'));
  assert.deepEqual(linha.ids, [clienteA, clienteB]);
  assert.deepEqual(linha.dados, { a: [1, 2] });
  assert.equal(linha.status, 'VISITA_PROPOSTA');
  assert.deepEqual(linha.status_lista, ['QUALIFICACAO']);
  assert.equal(linha.preco_json, 450000.5);
  assert.equal(linha.instante_json, '2026-10-04T12:34:56.123456+00:00');
  assert.equal(linha.arredondado, 2);
});

test('(d) ImoveisGestaoService.listar roda o SQL real e só vê os imóveis da conta', async () => {
  const servico = new ImoveisGestaoService(banco.db);
  assert.deepEqual(await servico.listar(banco.claimsA), []);
  const doB = await servico.listar(banco.claimsB);
  assert.equal(doB.length, 1);
  assert.equal(doB[0].id, imovelB);
  assert.equal(doB[0].corretor_id, banco.corretorB);
  assert.equal(doB[0].valor, 500000); // numeric pelo to_jsonb: número JSON, como no PostgREST
  assert.equal(doB[0].proprietario_nome, 'Dona');
});

test('(d) CrmClientesService.listar roda o SQL real com cliente_imovel embutido', async () => {
  const servico = new CrmClientesService(banco.db);
  const daA = await servico.listar(banco.claimsA);
  assert.deepEqual(daA.map((c) => [c.id, c.corretor_id, c.nome, c.cliente_imovel]), [[clienteA, banco.corretorA, 'Cliente da A', []]]);
  assert.match(String(daA[0].created_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/);
  assert.deepEqual((await servico.listar(banco.claimsB)).map((c) => c.id), [clienteB]);
});

test('(d) CrmFunilService.listarEtapas devolve as 9 etapas que o gatilho criou para a conta', async () => {
  const servico = new CrmFunilService(banco.db);
  const daA = await servico.listarEtapas(banco.claimsA);
  assert.deepEqual(daA.map((e) => e.ordem), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(daA[0].nome, 'Novo lead');
  assert.ok(daA.every((e) => e.corretor_id === banco.corretorA));
  const doB = await servico.listarEtapas(banco.claimsB);
  assert.equal(doB.length, 9);
  assert.ok(doB.every((e) => e.corretor_id === banco.corretorB));
});

test('fixture: a conta A cria imóvel pela rota (plano ativo) e a B recebe 402 PLAN_LIMIT_REACHED', async () => {
  const servico = new ImoveisGestaoService(banco.db);
  const dto = { titulo: 'Apto da A', tipo: 'APARTAMENTO', valor: 350000, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono' } as CriarImovelDto;
  const criado = await servico.criar(banco.claimsA, dto);
  assert.equal(criado.corretor_id, banco.corretorA);
  assert.equal(criado.status_venda, 'DISPONIVEL');
  assert.equal(criado.ativo, true);
  assert.deepEqual((await servico.listar(banco.claimsA)).map((i) => i.id), [criado.id]);
  assert.deepEqual(await banco.sqlSuperusuario(`select limite from public.checar_cota($1, 'max_imoveis')`, [banco.corretorA]), [{ limite: LIMITE_IMOVEIS_A }]);

  const negado = await capturarErroHttp(servico.criar(banco.claimsB, { ...dto, titulo: 'Casa nova do B' } as CriarImovelDto));
  assert.equal(negado.status, 402);
  assert.equal(negado.corpo.codigo, 'PLAN_LIMIT_REACHED');
  assert.equal(negado.corpo.recurso, 'max_imoveis');
  assert.equal((await servico.listar(banco.claimsB)).length, 1);
});
