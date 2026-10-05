// SQL real do CrmFunilService (frente C, contrato §3) contra um Postgres de verdade: PGlite com todas as
// migrations, RLS ligado e o TenantDb de produção (claims + `set local role authenticated`).
// Cada método público roda o próprio SQL e é conferido em três frentes: o caminho feliz no formato do
// PostgREST (chaves snake_case, número, 'YYYY-MM-DD' e timestamptz com fuso), o isolamento entre as
// contas A e B e os erros do banco traduzidos para o HTTP e o `codigo` que o contrato fixa.
// Os corpos passam pelo mesmo plainToInstance + validação que o ValidationPipe aplica; os que o DTO
// barraria vão por `semValidacao`, só para provar a tradução do erro do banco.
// O @Type do class-transformer lê Reflect.getMetadata ao decorar o DTO: carregue antes dele, como o Nest faz.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ConcluirTarefaDto, CriarOportunidadeDto, CriarTarefaDto, ExcluirOportunidadesDto, LIMITE_LISTA, MoverOportunidadeDto, SalvarEtapasDto,
} from '../../src/crm/funil/crm-funil.dto';
import { CrmFunilService, type Linha } from '../../src/crm/funil/crm-funil.service';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

let banco: BancoTeste;
let servico: CrmFunilService;

// ---------------------------------------------------------------- formato e erros do contrato

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** timestamptz pelo to_jsonb com TimeZone UTC, como o PostgREST entrega. */
const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';

const COLUNAS_ETAPA = ['ativo', 'cor', 'corretor_id', 'created_at', 'id', 'nome', 'ordem', 'tipo'];
const COLUNAS_OPORTUNIDADE = [
  'cliente_id', 'corretor_id', 'created_at', 'data_prevista_fechamento', 'etapa_id', 'fechada_em', 'id', 'imovel_id', 'is_sample_data',
  'motivo_perda', 'observacoes', 'ordem', 'origem', 'probabilidade', 'titulo', 'updated_at', 'valor_estimado',
];
const COLUNAS_TAREFA = [
  'cliente_id', 'concluida', 'concluida_em', 'corretor_id', 'created_at', 'data_prevista', 'descricao', 'id', 'is_sample_data',
  'oportunidade_id', 'tipo', 'titulo',
];

const ERRO = {
  dadosInvalidos: { statusCode: 400, codigo: 'dados_invalidos', message: 'Dados inválidos. Confira os campos e tente de novo.' },
  semCorretor: { statusCode: 403, codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' },
  tarefaNaoEncontrada: { statusCode: 404, codigo: 'tarefa_nao_encontrada', message: 'Tarefa não encontrada.' },
  conflito: { statusCode: 409, codigo: 'CONFLITO', message: 'Este negócio foi movido em outro lugar.' },
  etapaRepetida: { statusCode: 409, codigo: 'registro_repetido', message: 'Já existe uma etapa com este nome.' },
  etapaInvalida: { statusCode: 422, codigo: 'etapa_invalida', message: 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.' },
  clienteInvalido: { statusCode: 422, codigo: 'cliente_invalido', message: 'Cliente não encontrado nesta conta.' },
  imovelInvalido: { statusCode: 422, codigo: 'imovel_invalido', message: 'Imóvel não encontrado nesta conta.' },
  oportunidadeInvalida: { statusCode: 422, codigo: 'oportunidade_invalida', message: 'Negócio não encontrado nesta conta.' },
} as const;

/** Espera o HttpException do contrato: status e corpo inteiros. */
async function falha(promessa: Promise<unknown>, esperado: { statusCode: number }): Promise<void> {
  assert.deepEqual(await capturarErroHttp(promessa), { status: esperado.statusCode, corpo: esperado });
}

const OPCOES_PIPE = { whitelist: true, forbidNonWhitelisted: true };

/** O corpo como o ValidationPipe entrega (transform + whitelist + forbidNonWhitelisted); falha se ele recusaria. */
function dto<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): T {
  const instancia = plainToInstance(Classe, corpo);
  assert.deepEqual(validateSync(instancia, OPCOES_PIPE).map((e) => e.property), [], 'o ValidationPipe deveria aceitar este corpo');
  return instancia;
}

/** Corpo que o ValidationPipe recusaria: chega ao service só para provar a tradução do erro do banco. */
function semValidacao<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): T {
  const instancia = plainToInstance(Classe, corpo);
  assert.notEqual(validateSync(instancia, OPCOES_PIPE).length, 0, 'o ValidationPipe deveria recusar este corpo');
  return instancia;
}

const chaves = (o: object) => Object.keys(o).sort();
const sem = (o: Linha, ...fora: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !fora.includes(k)));

// ---------------------------------------------------------------- dados

const TELEFONE_A = '62981234567';
const TELEFONE_B = '62981234568';
/** Token de concorrência com microssegundos, como o to_jsonb entrega. */
const TOKEN_VENDA = '2026-10-04T12:34:56.123456+00:00';

/** Ids fixos (v4) para conferir a ordem: venda tem o menor id, mas a maior ordem. */
const OP = {
  venda: '0a000001-0000-4000-8000-000000000001',
  semVinculo: '0a000002-0000-4000-8000-000000000002',
  alheios: '0a000003-0000-4000-8000-000000000003',
  precisao: '0a000004-0000-4000-8000-000000000004',
  descartavel: '0a000005-0000-4000-8000-000000000005',
  doB: '0b000001-0000-4000-8000-000000000001',
};
const TAREFA = {
  mesmaData: '0c000000-0000-4000-8000-000000000000',
  ligar: '0c000001-0000-4000-8000-000000000001',
  semData: '0c000002-0000-4000-8000-000000000002',
  alheia: '0c000003-0000-4000-8000-000000000003',
  doB: '0d000001-0000-4000-8000-000000000001',
};

interface Etapa { id: string; nome: string; ordem: number }
let etapasA: Etapa[];
let etapasB: Etapa[];
let clienteA: string;
let clienteB: string;
let imovelA: string;
let imovelB: string;

const etapasDe = (corretor: string) => banco.sqlSuperusuario<Etapa>(
  `select id::text as id, nome, ordem from public.crm_etapas where corretor_id = $1::uuid and ativo order by ordem, nome, id`, [corretor]);

/** A linha gravada, lida como superusuário (sem RLS), no mesmo formato to_jsonb. */
async function gravada(tabela: 'crm_etapas' | 'crm_oportunidades' | 'crm_tarefas', id: string): Promise<Linha | undefined> {
  const [r] = await banco.sqlSuperusuario<{ linha: Linha }>(`select to_jsonb(t) as linha from public.${tabela} t where t.id = $1::uuid`, [id]);
  return r?.linha;
}

async function contar(tabela: 'crm_oportunidades' | 'crm_tarefas'): Promise<number> {
  const [r] = await banco.sqlSuperusuario<{ n: number }>(`select count(*)::int as n from public.${tabela}`);
  return r.n;
}

/** Claims válidas de um usuário que não tem conta (get_corretor_id() devolve null). */
const claimsSemConta = (): SupabaseClaims => ({
  sub: randomUUID(), role: 'authenticated', aud: 'authenticated', email: 'sem-conta@teste.lotti.local', aal: 'aal1', is_anonymous: false,
});

before(async () => {
  banco = await criarBanco();
  servico = new CrmFunilService(banco.db);
  etapasA = await etapasDe(banco.corretorA);
  etapasB = await etapasDe(banco.corretorB);
  clienteA = (await banco.inserir('clientes', { corretor_id: banco.corretorA, nome: 'Cliente da A', telefone: TELEFONE_A })).id as string;
  clienteB = (await banco.inserir('clientes', { corretor_id: banco.corretorB, nome: 'Cliente do B', telefone: TELEFONE_B })).id as string;
  imovelA = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorA, titulo: 'Apto da A', tipo: 'APARTAMENTO', valor: 350000, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono',
  })).id as string;
  // B não tem plano: a trava de cota recusaria o imóvel. Não anunciado, para o RLS esconder de A.
  imovelB = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorB, titulo: 'Casa do B', tipo: 'CASA', valor: 500000, endereco: 'Rua 2', cidade: 'Anápolis', proprietario_nome: 'Dona', anunciado: false,
  }, { semGatilhos: true })).id as string;

  await banco.inserir('crm_oportunidades', {
    id: OP.venda, corretor_id: banco.corretorA, etapa_id: etapasA[0].id, titulo: 'Venda da casa', cliente_id: clienteA, imovel_id: imovelA,
    valor_estimado: 450000.5, probabilidade: 40, data_prevista_fechamento: '2026-12-31', origem: 'site', ordem: 2, updated_at: TOKEN_VENDA,
  });
  await banco.inserir('crm_oportunidades', { id: OP.semVinculo, corretor_id: banco.corretorA, etapa_id: etapasA[0].id, titulo: 'Sem vínculo', ordem: 1 });
  // Negócio de A apontando para cliente e imóvel de B (carga antiga): o embed fica oculto pelo RLS.
  await banco.inserir('crm_oportunidades', {
    id: OP.alheios, corretor_id: banco.corretorA, etapa_id: etapasA[1].id, titulo: 'Vínculos alheios', cliente_id: clienteB, imovel_id: imovelB, ordem: 1,
  });
  await banco.inserir('crm_oportunidades', { id: OP.doB, corretor_id: banco.corretorB, etapa_id: etapasB[0].id, titulo: 'Negócio do B', cliente_id: clienteB });
});
after(async () => { await banco?.fechar(); });

// ---------------------------------------------------------------- etapas

describe('etapas', () => {
  test('listarEtapas: só as ativas da conta, por ordem, nome e id, no formato do PostgREST', async () => {
    const mesmaOrdem = await banco.inserir('crm_etapas', { corretor_id: banco.corretorA, nome: 'Aaa mesma ordem', ordem: 1, cor: 'teal' });
    const inativa = await banco.inserir('crm_etapas', { corretor_id: banco.corretorA, nome: 'Arquivada', ordem: 0, ativo: false });
    try {
      const daA = await servico.listarEtapas(banco.claimsA);
      // ordem 1 empata: 'Aaa mesma ordem' vem antes de 'Novo lead' pelo nome; a inativa não aparece.
      assert.deepEqual(daA.map((e) => e.id), [mesmaOrdem.id, ...etapasA.map((e) => e.id)]);
      assert.deepEqual(daA.map((e) => e.nome).slice(0, 3), ['Aaa mesma ordem', 'Novo lead', 'Primeiro contato']);
      for (const e of daA) {
        assert.deepEqual(chaves(e), COLUNAS_ETAPA);
        assert.equal(e.corretor_id, banco.corretorA);
        assert.equal(typeof e.ordem, 'number');
        assert.equal(e.ativo, true);
        assert.match(String(e.created_at), TIMESTAMPTZ);
      }
      assert.deepEqual(sem(daA[1], 'created_at'), {
        id: etapasA[0].id, corretor_id: banco.corretorA, nome: 'Novo lead', ordem: 1, cor: 'slate', tipo: 'ABERTA', ativo: true,
      });
      assert.equal(daA[9].tipo, 'PERDIDO');

      const doB = await servico.listarEtapas(banco.claimsB);
      assert.deepEqual(doB.map((e) => e.id), etapasB.map((e) => e.id));
      assert.ok(doB.every((e) => e.corretor_id === banco.corretorB));
    } finally {
      await banco.sqlSuperusuario(`delete from public.crm_etapas where id in ($1::uuid, $2::uuid)`, [mesmaOrdem.id, inativa.id]);
    }
  });

  test('salvarEtapas grava os itens da conta num run e não conta etapa alheia nem inexistente', async () => {
    const [e1, , , , , , , , e9] = etapasA;
    const etapaDoB = await gravada('crm_etapas', etapasB[0].id);
    const r = await servico.salvarEtapas(banco.claimsA, dto(SalvarEtapasDto, { etapas: [
      { id: e1.id, nome: 'Lead novo', cor: 'teal', tipo: 'ABERTA', ordem: 10 },
      { id: e9.id, nome: 'Perdido', cor: 'rose', tipo: 'PERDIDO', ordem: 9 },
      { id: etapasB[0].id, nome: 'Invadida', cor: 'red', tipo: 'GANHO', ordem: 0 },
      { id: INEXISTENTE, nome: 'Fantasma', cor: 'red', tipo: 'ABERTA', ordem: 0 },
    ] }));
    assert.deepEqual(r, { atualizadas: 2 });
    assert.deepEqual(sem((await gravada('crm_etapas', e1.id))!, 'created_at'), {
      id: e1.id, corretor_id: banco.corretorA, nome: 'Lead novo', cor: 'teal', tipo: 'ABERTA', ordem: 10, ativo: true,
    });
    assert.deepEqual(sem((await gravada('crm_etapas', e9.id))!, 'created_at'), {
      id: e9.id, corretor_id: banco.corretorA, nome: 'Perdido', cor: 'rose', tipo: 'PERDIDO', ordem: 9, ativo: true,
    });
    assert.deepEqual(await gravada('crm_etapas', etapasB[0].id), etapaDoB);
    // A nova ordem já vale na listagem.
    assert.equal((await servico.listarEtapas(banco.claimsA)).at(-1)?.id, e1.id);
  });

  test('salvarEtapas: a conta B não altera etapa de A (zero atualizadas, sem erro)', async () => {
    const antes = await gravada('crm_etapas', etapasA[1].id);
    const r = await servico.salvarEtapas(banco.claimsB, dto(SalvarEtapasDto, { etapas: [
      { id: etapasA[1].id, nome: 'Invadida', cor: 'red', tipo: 'GANHO', ordem: 0 },
    ] }));
    assert.deepEqual(r, { atualizadas: 0 });
    assert.deepEqual(await gravada('crm_etapas', etapasA[1].id), antes);
  });

  test('salvarEtapas: nome repetido na conta dá 409 e desfaz também os itens anteriores', async () => {
    const [, e2, e3, e4] = etapasA;
    const antes = [await gravada('crm_etapas', e2.id), await gravada('crm_etapas', e3.id)];
    const t0 = { ...banco.transacoes };
    await falha(servico.salvarEtapas(banco.claimsA, dto(SalvarEtapasDto, { etapas: [
      { id: e2.id, nome: 'Contato feito', cor: 'sky', tipo: 'ABERTA', ordem: 2 }, // grava, depois é desfeito
      { id: e3.id, nome: e4.nome, cor: 'blue', tipo: 'ABERTA', ordem: 3 }, // 23505 no unique (corretor_id, nome)
    ] })), ERRO.etapaRepetida);
    assert.deepEqual([await gravada('crm_etapas', e2.id), await gravada('crm_etapas', e3.id)], antes);
    assert.deepEqual(banco.transacoes, { ...t0, rollbacks: t0.rollbacks + 1 });
  });

  test('salvarEtapas: o unique é por conta (B pode repetir um nome de A)', async () => {
    const r = await servico.salvarEtapas(banco.claimsB, dto(SalvarEtapasDto, { etapas: [
      { id: etapasB[0].id, nome: 'Lead novo', cor: 'slate', tipo: 'ABERTA', ordem: 1 },
    ] }));
    assert.deepEqual(r, { atualizadas: 1 });
    assert.equal((await gravada('crm_etapas', etapasB[0].id))?.nome, 'Lead novo');
  });

  test('salvarEtapas: tipo fora do check do banco vira 400 dados_invalidos, sem gravar nada', async () => {
    const [, e2, e3] = etapasA;
    const antes = await gravada('crm_etapas', e2.id);
    await falha(servico.salvarEtapas(banco.claimsA, semValidacao(SalvarEtapasDto, { etapas: [
      { id: e2.id, nome: 'Contato feito', cor: 'sky', tipo: 'ABERTA', ordem: 2 },
      { id: e3.id, nome: e3.nome, cor: 'blue', tipo: 'OUTRO', ordem: 3 }, // 23514
    ] })), ERRO.dadosInvalidos);
    assert.deepEqual(await gravada('crm_etapas', e2.id), antes);
  });
});

// ---------------------------------------------------------------- oportunidades

describe('oportunidades', () => {
  test('listarOportunidades: por ordem e id, colunas do PostgREST e embeds de cliente e imóvel', async () => {
    const daA = await servico.listarOportunidades(banco.claimsA);
    assert.deepEqual(daA.map((o) => o.id), [OP.semVinculo, OP.alheios, OP.venda]);
    for (const o of daA) assert.deepEqual(chaves(o), [...COLUNAS_OPORTUNIDADE, 'clientes', 'imoveis'].sort());

    const venda = daA[2];
    assert.deepEqual(sem(venda, 'created_at'), {
      id: OP.venda, corretor_id: banco.corretorA, cliente_id: clienteA, imovel_id: imovelA, etapa_id: etapasA[0].id, titulo: 'Venda da casa',
      valor_estimado: 450000.5, probabilidade: 40, data_prevista_fechamento: '2026-12-31', motivo_perda: null, origem: 'site', ordem: 2,
      observacoes: null, fechada_em: null, updated_at: TOKEN_VENDA, is_sample_data: false,
      clientes: { nome: 'Cliente da A', telefone: TELEFONE_A }, imoveis: { titulo: 'Apto da A' },
    });
    assert.match(String(venda.created_at), TIMESTAMPTZ);

    // Sem vínculo: embeds null. Vínculo de outra conta: o RLS esconde e o embed sai null, como no PostgREST.
    assert.deepEqual([daA[0].clientes, daA[0].imoveis, daA[0].valor_estimado, daA[0].probabilidade], [null, null, 0, 0]);
    assert.deepEqual([daA[1].cliente_id, daA[1].clientes, daA[1].imovel_id, daA[1].imoveis], [clienteB, null, imovelB, null]);

    const doB = await servico.listarOportunidades(banco.claimsB);
    assert.deepEqual(doB.map((o) => o.id), [OP.doB]);
    assert.deepEqual([doB[0].corretor_id, doB[0].clientes, doB[0].imoveis], [banco.corretorB, { nome: 'Cliente do B', telefone: TELEFONE_B }, null]);
  });

  test('criarOportunidade grava com o corretor resolvido no servidor e devolve só o id', async () => {
    const r = await servico.criarOportunidade(banco.claimsA, dto(CriarOportunidadeDto, {
      etapa_id: etapasA[1].id, titulo: 'Nova pela API', cliente_id: clienteA, imovel_id: imovelA, valor_estimado: 350000.75, probabilidade: 30,
      data_prevista_fechamento: '2027-01-15', motivo_perda: null, origem: 'whatsapp', ordem: 3, observacoes: 'Quer visitar sábado',
    }));
    assert.deepEqual(chaves(r), ['id']);
    assert.match(r.id, UUID);
    const linha = (await gravada('crm_oportunidades', r.id))!;
    assert.deepEqual(sem(linha, 'created_at', 'updated_at'), {
      id: r.id, corretor_id: banco.corretorA, cliente_id: clienteA, imovel_id: imovelA, etapa_id: etapasA[1].id, titulo: 'Nova pela API',
      valor_estimado: 350000.75, probabilidade: 30, data_prevista_fechamento: '2027-01-15', motivo_perda: null, origem: 'whatsapp', ordem: 3,
      observacoes: 'Quer visitar sábado', fechada_em: null, is_sample_data: false,
    });
    assert.match(String(linha.updated_at), TIMESTAMPTZ);

    // Só os obrigatórios: o resto fica com o default do banco.
    const minima = await servico.criarOportunidade(banco.claimsA, dto(CriarOportunidadeDto, { etapa_id: etapasA[1].id, titulo: 'Só o título' }));
    assert.deepEqual(sem((await gravada('crm_oportunidades', minima.id))!, 'created_at', 'updated_at'), {
      id: minima.id, corretor_id: banco.corretorA, cliente_id: null, imovel_id: null, etapa_id: etapasA[1].id, titulo: 'Só o título',
      valor_estimado: 0, probabilidade: 0, data_prevista_fechamento: null, motivo_perda: null, origem: null, ordem: 0,
      observacoes: null, fechada_em: null, is_sample_data: false,
    });

    const ids = (await servico.listarOportunidades(banco.claimsA)).map((o) => o.id);
    assert.ok(ids.includes(r.id) && ids.includes(minima.id));
    assert.deepEqual((await servico.listarOportunidades(banco.claimsB)).map((o) => o.id), [OP.doB]);
  });

  test('criarOportunidade: B não usa etapa, cliente nem imóvel de A (422) e nada é gravado', async () => {
    const antes = await contar('crm_oportunidades');
    await falha(servico.criarOportunidade(banco.claimsB, dto(CriarOportunidadeDto, { etapa_id: etapasA[0].id, titulo: 'x' })), ERRO.etapaInvalida);
    await falha(servico.criarOportunidade(banco.claimsB, dto(CriarOportunidadeDto, {
      etapa_id: etapasB[0].id, titulo: 'x', cliente_id: clienteA,
    })), ERRO.clienteInvalido);
    await falha(servico.criarOportunidade(banco.claimsB, dto(CriarOportunidadeDto, {
      etapa_id: etapasB[0].id, titulo: 'x', imovel_id: imovelA,
    })), ERRO.imovelInvalido);
    await falha(servico.criarOportunidade(banco.claimsA, dto(CriarOportunidadeDto, { etapa_id: INEXISTENTE, titulo: 'x' })), ERRO.etapaInvalida);
    assert.equal(await contar('crm_oportunidades'), antes);
  });

  test('criarOportunidade: sem conta → 403; erro do banco → 400 dados_invalidos', async () => {
    const antes = await contar('crm_oportunidades');
    await falha(servico.criarOportunidade(claimsSemConta(), dto(CriarOportunidadeDto, { etapa_id: etapasA[0].id, titulo: 'x' })), ERRO.semCorretor);
    // A regex do DTO aceita 30/02; o banco recusa a data (22008).
    await falha(servico.criarOportunidade(banco.claimsA, dto(CriarOportunidadeDto, {
      etapa_id: etapasA[0].id, titulo: 'x', data_prevista_fechamento: '2026-02-30',
    })), ERRO.dadosInvalidos);
    // O DTO barraria; o check do banco (23514) também.
    await falha(servico.criarOportunidade(banco.claimsA, semValidacao(CriarOportunidadeDto, {
      etapa_id: etapasA[0].id, titulo: 'x', probabilidade: 150,
    })), ERRO.dadosInvalidos);
    assert.equal(await contar('crm_oportunidades'), antes);
  });

  test('moverOportunidade: o token da listagem grava; o mesmo token depois dá 409 CONFLITO', async () => {
    const [, , e3, e4] = etapasA;
    const token = (await servico.listarOportunidades(banco.claimsA)).find((o) => o.id === OP.venda)?.updated_at;
    assert.equal(token, TOKEN_VENDA);

    assert.deepEqual(await servico.moverOportunidade(banco.claimsA, OP.venda, dto(MoverOportunidadeDto, {
      etapa_id: e3.id, ordem: 5, updated_at: token,
    })), { id: OP.venda });
    const movida = (await gravada('crm_oportunidades', OP.venda))!;
    assert.deepEqual([movida.etapa_id, movida.ordem], [e3.id, 5]);
    // O gatilho trg_crm_oport_updated_at trocou a versão.
    assert.match(String(movida.updated_at), TIMESTAMPTZ);
    assert.notEqual(movida.updated_at, TOKEN_VENDA);

    await falha(servico.moverOportunidade(banco.claimsA, OP.venda, dto(MoverOportunidadeDto, {
      etapa_id: e4.id, ordem: 0, updated_at: token,
    })), ERRO.conflito);
    assert.deepEqual(await gravada('crm_oportunidades', OP.venda), movida);

    // Com o token novo, da nova listagem, volta a gravar.
    const novo = (await servico.listarOportunidades(banco.claimsA)).find((o) => o.id === OP.venda)?.updated_at;
    assert.equal(novo, movida.updated_at);
    assert.deepEqual(await servico.moverOportunidade(banco.claimsA, OP.venda, dto(MoverOportunidadeDto, {
      etapa_id: e4.id, ordem: 1, updated_at: novo,
    })), { id: OP.venda });
    assert.equal((await gravada('crm_oportunidades', OP.venda))?.etapa_id, e4.id);
  });

  test('moverOportunidade: o token compara o instante com microssegundos', async () => {
    await banco.inserir('crm_oportunidades', {
      id: OP.precisao, corretor_id: banco.corretorA, etapa_id: etapasA[0].id, titulo: 'Precisão', updated_at: '2026-10-04T08:00:00.654321+00:00',
    });
    // Truncado em milissegundos (o que um Date do JS daria): não casa.
    await falha(servico.moverOportunidade(banco.claimsA, OP.precisao, dto(MoverOportunidadeDto, {
      etapa_id: etapasA[1].id, ordem: 0, updated_at: '2026-10-04T08:00:00.654+00:00',
    })), ERRO.conflito);
    // O mesmo instante escrito em outro fuso casa.
    assert.deepEqual(await servico.moverOportunidade(banco.claimsA, OP.precisao, dto(MoverOportunidadeDto, {
      etapa_id: etapasA[1].id, ordem: 0, updated_at: '2026-10-04T05:00:00.654321-03:00',
    })), { id: OP.precisao });
  });

  test('moverOportunidade: etapa alheia → 422, token mal formado → 400, negócio inexistente → 409', async () => {
    const atual = (await gravada('crm_oportunidades', OP.venda))!;
    const token = String(atual.updated_at);
    await falha(servico.moverOportunidade(banco.claimsA, OP.venda, dto(MoverOportunidadeDto, {
      etapa_id: etapasB[0].id, ordem: 0, updated_at: token,
    })), ERRO.etapaInvalida);
    // O DTO só exige texto; o banco recusa o timestamptz (22007).
    await falha(servico.moverOportunidade(banco.claimsA, OP.venda, dto(MoverOportunidadeDto, {
      etapa_id: etapasA[0].id, ordem: 0, updated_at: 'ontem',
    })), ERRO.dadosInvalidos);
    await falha(servico.moverOportunidade(banco.claimsA, INEXISTENTE, dto(MoverOportunidadeDto, {
      etapa_id: etapasA[0].id, ordem: 0, updated_at: token,
    })), ERRO.conflito);
    assert.deepEqual(await gravada('crm_oportunidades', OP.venda), atual);
  });

  test('moverOportunidade: B não move negócio de A, nem com o token certo', async () => {
    const atual = (await gravada('crm_oportunidades', OP.venda))!;
    const token = String(atual.updated_at);
    await falha(servico.moverOportunidade(banco.claimsB, OP.venda, dto(MoverOportunidadeDto, {
      etapa_id: etapasB[0].id, ordem: 0, updated_at: token,
    })), ERRO.conflito);
    await falha(servico.moverOportunidade(banco.claimsB, OP.venda, dto(MoverOportunidadeDto, {
      etapa_id: etapasA[0].id, ordem: 0, updated_at: token,
    })), ERRO.etapaInvalida);
    assert.deepEqual(await gravada('crm_oportunidades', OP.venda), atual);
  });

  test('moverOportunidade: o gatilho da inbox roda com as claims do usuário', async () => {
    // Canal sandbox: a conversa não abre negócio novo no funil.
    const canal = await banco.inserir('lotti_agent_channels', { corretor_id: banco.corretorA, instance: 'teste-funil-a', sandbox: true });
    const conversa = await banco.inserir('lotti_agent_conversations', { channel_id: canal.id, corretor_id: banco.corretorA, cliente_id: clienteA, phone: TELEFONE_A });
    const atual = (await gravada('crm_oportunidades', OP.venda))!;
    const de = etapasA.find((e) => e.id === atual.etapa_id)!;
    const para = etapasA[4];
    await servico.moverOportunidade(banco.claimsA, OP.venda, dto(MoverOportunidadeDto, { etapa_id: para.id, ordem: 0, updated_at: atual.updated_at }));
    const eventos = await banco.sqlSuperusuario(
      `select kind, from_label, to_label, subject_label, actor_label from public.lotti_inbox_events where conversation_id = $1::uuid`, [conversa.id]);
    assert.deepEqual(eventos, [{ kind: 'stage', from_label: de.nome, to_label: para.nome, subject_label: 'Venda da casa', actor_label: 'Corretora A' }]);
  });

  test('membro da organização de A só com leitura: vê o negócio, mas não move, não exclui e não cria', async () => {
    // Só uma participação ativa por usuário (uq_routine_membership_ativa_por_usuario). O perfil de C continua
    // apontando para a organização dela, agora suspensa: get_corretor_id() dá null e só a policy
    // "routine organization: deals read" (participação ativa na organização de A) dá acesso.
    const contaC = await banco.criarConta({ nome: 'Colaboradora C' });
    await banco.sqlSuperusuario(`update public.routine_memberships set status = 'suspended' where user_id = $1::uuid`, [contaC.userId]);
    const [org] = await banco.sqlSuperusuario<{ id: string }>(
      `select id::text as id from public.routine_organizations where legacy_corretor_id = $1::uuid`, [banco.corretorA]);
    await banco.inserir('routine_memberships', { organization_id: org.id, user_id: contaC.userId, role: 'colaborador', status: 'active' });

    // A listagem não filtra por corretor: o RLS decide, como no PostgREST.
    const visto = (await servico.listarOportunidades(contaC.claims)).find((o) => o.id === OP.venda);
    assert.ok(visto, 'o membro com leitura deveria ver o negócio de A');
    assert.deepEqual(await servico.listarEtapas(contaC.claims), []);
    const antes = await gravada('crm_oportunidades', OP.venda);
    // Nenhuma etapa é visível para ele, então o mover para no passo 1 (422), antes do token.
    const [etapaC] = await etapasDe(contaC.corretorId);
    for (const etapa_id of [etapaC.id, etapasA[0].id]) {
      await falha(servico.moverOportunidade(contaC.claims, OP.venda, dto(MoverOportunidadeDto, {
        etapa_id, ordem: 0, updated_at: visto.updated_at,
      })), ERRO.etapaInvalida);
    }
    assert.deepEqual(await servico.excluirOportunidades(contaC.claims, dto(ExcluirOportunidadesDto, { ids: [OP.venda] })), { excluidas: 0 });
    await falha(servico.criarOportunidade(contaC.claims, dto(CriarOportunidadeDto, { etapa_id: etapasA[0].id, titulo: 'x' })), ERRO.semCorretor);
    assert.deepEqual(await gravada('crm_oportunidades', OP.venda), antes);
  });

  test('excluirOportunidades: apaga só os da conta, conta os apagados e leva as tarefas por cascata', async () => {
    await banco.inserir('crm_oportunidades', { id: OP.descartavel, corretor_id: banco.corretorA, etapa_id: etapasA[0].id, titulo: 'Descartável', cliente_id: clienteA });
    const tarefa = await banco.inserir('crm_tarefas', { corretor_id: banco.corretorA, oportunidade_id: OP.descartavel, titulo: 'Ligar antes' });
    assert.deepEqual(await servico.excluirOportunidades(banco.claimsA, dto(ExcluirOportunidadesDto, {
      ids: [OP.descartavel, OP.doB, INEXISTENTE],
    })), { excluidas: 1 });
    assert.equal(await gravada('crm_oportunidades', OP.descartavel), undefined);
    assert.equal(await gravada('crm_tarefas', tarefa.id as string), undefined);
    assert.ok(await gravada('crm_oportunidades', OP.doB));

    // B não apaga de A: zero, sem erro.
    assert.deepEqual(await servico.excluirOportunidades(banco.claimsB, dto(ExcluirOportunidadesDto, { ids: [OP.semVinculo, OP.venda] })), { excluidas: 0 });
    assert.ok(await gravada('crm_oportunidades', OP.semVinculo));
    assert.ok(await gravada('crm_oportunidades', OP.venda));

    // id que não é uuid (o DTO barraria): 22P02 → 400.
    await falha(servico.excluirOportunidades(banco.claimsA, semValidacao(ExcluirOportunidadesDto, { ids: ['x'] })), ERRO.dadosInvalidos);
  });

  test('excluirOportunidades: negócio ligado à rotina (agenda e tarefa) sai, e a rotina perde só o vínculo', async () => {
    const id = '0a000006-0000-4000-8000-000000000006';
    await banco.inserir('crm_oportunidades', { id, corretor_id: banco.corretorA, etapa_id: etapasA[0].id, titulo: 'Com agenda' });
    const [org] = await banco.sqlSuperusuario<{ id: string }>(
      `select id::text as id from public.routine_organizations where legacy_corretor_id = $1::uuid`, [banco.corretorA]);
    const base = { organization_id: org.id, assigned_to: banco.contaA.userId, created_by: banco.contaA.userId, deal_id: id };
    const tarefa = await banco.inserir('routine_tasks', { ...base, title: 'Retornar proposta' });
    const evento = await banco.inserir('routine_events', {
      ...base, title: 'Visita', start_at: '2026-10-20T13:00:00+00:00', end_at: '2026-10-20T14:00:00+00:00',
    });
    // O SET NULL da FK dispara os gatilhos da rotina (validação, versão e log) dentro da transação do usuário.
    assert.deepEqual(await servico.excluirOportunidades(banco.claimsA, dto(ExcluirOportunidadesDto, { ids: [id] })), { excluidas: 1 });
    assert.equal(await gravada('crm_oportunidades', id), undefined);
    const vinculos = await banco.sqlSuperusuario<{ deal_id: string | null }>(
      `select deal_id::text as deal_id from public.routine_tasks where id = $1::uuid
       union all select deal_id::text from public.routine_events where id = $2::uuid`, [tarefa.id, evento.id]);
    assert.deepEqual(vinculos, [{ deal_id: null }, { deal_id: null }]);
  });

  test('teto LIMITE_LISTA: a lista traz 1000 por ordem e id, e o excluir aceita os 1000 numa chamada', async () => {
    const contaD = await banco.criarConta({ nome: 'Corretor D' });
    const [etapaD] = await etapasDe(contaD.corretorId);
    await banco.sqlSuperusuario(
      `insert into public.crm_oportunidades (corretor_id, etapa_id, titulo, ordem)
       select $1::uuid, $2::uuid, 'Lote ' || g, g % 7 from generate_series(1, $3::int) g`,
      [contaD.corretorId, etapaD.id, LIMITE_LISTA + 1]);

    const lista = await servico.listarOportunidades(contaD.claims);
    assert.equal(lista.length, LIMITE_LISTA);
    for (let i = 1; i < lista.length; i++) {
      const [a, b] = [lista[i - 1], lista[i]];
      assert.ok((a.ordem as number) < (b.ordem as number) || (a.ordem === b.ordem && String(a.id) < String(b.id)), `fora de ordem em ${i}`);
    }
    const [ultimo] = await banco.sqlSuperusuario<{ id: string }>(
      `select id::text as id from public.crm_oportunidades where corretor_id = $1::uuid order by ordem desc, id desc limit 1`, [contaD.corretorId]);
    assert.ok(!lista.some((o) => o.id === ultimo.id));

    assert.deepEqual(await servico.excluirOportunidades(contaD.claims, dto(ExcluirOportunidadesDto, { ids: lista.map((o) => o.id) })), { excluidas: LIMITE_LISTA });
    assert.deepEqual((await servico.listarOportunidades(contaD.claims)).map((o) => o.id), [ultimo.id]);
  });
});

// ---------------------------------------------------------------- tarefas

describe('tarefas', () => {
  before(async () => {
    const base = { corretor_id: banco.corretorA };
    await banco.inserir('crm_tarefas', {
      ...base, id: TAREFA.ligar, titulo: 'Ligar', tipo: 'LIGACAO', data_prevista: '2026-10-10T15:00:00+00:00', cliente_id: clienteA, oportunidade_id: OP.venda,
    });
    await banco.inserir('crm_tarefas', { ...base, id: TAREFA.mesmaData, titulo: 'Mesma data', data_prevista: '2026-10-10T15:00:00+00:00' });
    await banco.inserir('crm_tarefas', { ...base, id: TAREFA.semData, titulo: 'Sem data' });
    await banco.inserir('crm_tarefas', { ...base, id: TAREFA.alheia, titulo: 'Cliente alheio', data_prevista: '2026-10-09T08:00:00.5+00:00', cliente_id: clienteB });
    await banco.inserir('crm_tarefas', { id: TAREFA.doB, corretor_id: banco.corretorB, titulo: 'Tarefa do B', cliente_id: clienteB });
  });

  test('listarTarefas: data prevista com nulos no fim, desempate por id, embed do cliente', async () => {
    const daA = await servico.listarTarefas(banco.claimsA);
    assert.deepEqual(daA.map((t) => t.id), [TAREFA.alheia, TAREFA.mesmaData, TAREFA.ligar, TAREFA.semData]);
    for (const t of daA) assert.deepEqual(chaves(t), [...COLUNAS_TAREFA, 'clientes'].sort());
    const ligar = daA[2];
    assert.deepEqual(sem(ligar, 'created_at'), {
      id: TAREFA.ligar, corretor_id: banco.corretorA, oportunidade_id: OP.venda, cliente_id: clienteA, titulo: 'Ligar', descricao: null,
      tipo: 'LIGACAO', data_prevista: '2026-10-10T15:00:00+00:00', concluida: false, concluida_em: null, is_sample_data: false,
      clientes: { nome: 'Cliente da A' },
    });
    assert.match(String(ligar.created_at), TIMESTAMPTZ);
    assert.equal(daA[0].data_prevista, '2026-10-09T08:00:00.5+00:00');
    assert.deepEqual([daA[0].cliente_id, daA[0].clientes], [clienteB, null]); // embed oculto pelo RLS
    assert.deepEqual([daA[3].data_prevista, daA[3].clientes, daA[3].tipo], [null, null, 'OUTRO']);

    const doB = await servico.listarTarefas(banco.claimsB);
    assert.deepEqual(doB.map((t) => [t.id, t.corretor_id, t.clientes]), [[TAREFA.doB, banco.corretorB, { nome: 'Cliente do B' }]]);
  });

  test('criarTarefa devolve a linha to_jsonb gravada com o corretor do servidor', async () => {
    const criada = await servico.criarTarefa(banco.claimsA, dto(CriarTarefaDto, {
      titulo: 'Visitar apto', descricao: 'Levar as chaves', tipo: 'VISITA', data_prevista: '2026-11-01T10:30:00-03:00',
      oportunidade_id: OP.venda, cliente_id: clienteA,
    }));
    assert.deepEqual(chaves(criada), COLUNAS_TAREFA);
    assert.match(String(criada.id), UUID);
    assert.match(String(criada.created_at), TIMESTAMPTZ);
    assert.deepEqual(sem(criada, 'id', 'created_at'), {
      corretor_id: banco.corretorA, oportunidade_id: OP.venda, cliente_id: clienteA, titulo: 'Visitar apto', descricao: 'Levar as chaves',
      tipo: 'VISITA', data_prevista: '2026-11-01T13:30:00+00:00', concluida: false, concluida_em: null, is_sample_data: false,
    });
    assert.deepEqual(await gravada('crm_tarefas', String(criada.id)), criada);

    const minima = await servico.criarTarefa(banco.claimsA, dto(CriarTarefaDto, { titulo: 'Só o título' }));
    assert.deepEqual(sem(minima, 'id', 'created_at'), {
      corretor_id: banco.corretorA, oportunidade_id: null, cliente_id: null, titulo: 'Só o título', descricao: null,
      tipo: 'OUTRO', data_prevista: null, concluida: false, concluida_em: null, is_sample_data: false,
    });
    assert.ok(!(await servico.listarTarefas(banco.claimsB)).some((t) => t.id === criada.id || t.id === minima.id));
  });

  test('criarTarefa: negócio ou cliente de outra conta → 422; sem conta → 403; erro do banco → 400', async () => {
    const antes = await contar('crm_tarefas');
    await falha(servico.criarTarefa(banco.claimsB, dto(CriarTarefaDto, { titulo: 'x', oportunidade_id: OP.venda })), ERRO.oportunidadeInvalida);
    await falha(servico.criarTarefa(banco.claimsB, dto(CriarTarefaDto, { titulo: 'x', cliente_id: clienteA })), ERRO.clienteInvalido);
    await falha(servico.criarTarefa(banco.claimsA, dto(CriarTarefaDto, { titulo: 'x', oportunidade_id: INEXISTENTE })), ERRO.oportunidadeInvalida);
    await falha(servico.criarTarefa(claimsSemConta(), dto(CriarTarefaDto, { titulo: 'x' })), ERRO.semCorretor);
    // IsISO8601 sem strict aceita 30/02; o banco recusa (22008).
    await falha(servico.criarTarefa(banco.claimsA, dto(CriarTarefaDto, { titulo: 'x', data_prevista: '2026-02-30T10:00:00Z' })), ERRO.dadosInvalidos);
    // O DTO barraria; o check do banco (23514) também.
    await falha(servico.criarTarefa(banco.claimsA, semValidacao(CriarTarefaDto, { titulo: 'x', tipo: 'XYZ' })), ERRO.dadosInvalidos);
    assert.equal(await contar('crm_tarefas'), antes);
  });

  test('concluirTarefa marca e desmarca, com concluida_em do banco; zero linhas → 404', async () => {
    const antes = (await gravada('crm_tarefas', TAREFA.ligar))!;
    const feita = await servico.concluirTarefa(banco.claimsA, TAREFA.ligar, dto(ConcluirTarefaDto, { concluida: true }));
    assert.deepEqual(chaves(feita), COLUNAS_TAREFA);
    assert.equal(feita.concluida, true);
    assert.match(String(feita.concluida_em), TIMESTAMPTZ);
    assert.deepEqual(sem(feita, 'concluida', 'concluida_em'), sem(antes, 'concluida', 'concluida_em'));
    assert.deepEqual(await gravada('crm_tarefas', TAREFA.ligar), feita);

    const desfeita = await servico.concluirTarefa(banco.claimsA, TAREFA.ligar, dto(ConcluirTarefaDto, { concluida: false }));
    assert.deepEqual(desfeita, antes);

    await falha(servico.concluirTarefa(banco.claimsB, TAREFA.ligar, dto(ConcluirTarefaDto, { concluida: true })), ERRO.tarefaNaoEncontrada);
    await falha(servico.concluirTarefa(banco.claimsA, INEXISTENTE, dto(ConcluirTarefaDto, { concluida: true })), ERRO.tarefaNaoEncontrada);
    await falha(servico.concluirTarefa(banco.claimsA, TAREFA.doB, dto(ConcluirTarefaDto, { concluida: true })), ERRO.tarefaNaoEncontrada);
    assert.deepEqual(await gravada('crm_tarefas', TAREFA.ligar), antes);
    assert.equal((await gravada('crm_tarefas', TAREFA.doB))?.concluida, false);
  });
});

test('nenhum run do service terminou com a transação abortada (erro de banco engolido dentro do run)', () => {
  assert.equal(banco.transacoes.commitsAbortados, 0);
  assert.ok(banco.transacoes.commits > 0 && banco.transacoes.rollbacks > 0);
});
