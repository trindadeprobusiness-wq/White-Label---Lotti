// ImoveisGestaoService com o SQL REAL: cada método roda no PGlite com todas as migrations, RLS ligado e o
// TenantDb de produção (claims + `set local role authenticated`). Confere o formato da resposta (o mesmo do
// PostgREST, contrato §0.2 e §1), o isolamento entre contas e a tradução dos erros que o banco dá de verdade.
import { after, before, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { AtualizarImovelDto, CriarImovelDto, LIMITE_LISTA, RegistrarVendaDto } from '../../src/imoveis/imoveis-gestao.dto';
import { ImoveisGestaoService, type LinhaImovel } from '../../src/imoveis/imoveis-gestao.service';
import { type BancoTeste, capturarErroHttp, type ContaTeste, criarBanco, PASTA_MIGRATIONS, USUARIO_B } from './harness';

let banco: BancoTeste;
let servico: ImoveisGestaoService;
let imovelB: string;

before(async () => {
  banco = await criarBanco();
  servico = new ImoveisGestaoService(banco.db);
  // B não tem plano: a trava de cota recusaria o imóvel, então este entra com os gatilhos desligados.
  imovelB = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorB, titulo: 'Casa do B', tipo: 'CASA', valor: 500000, endereco: 'Rua 2', cidade: 'Anápolis', proprietario_nome: 'Dono B',
  }, { semGatilhos: true })).id as string;
});
after(async () => { await banco?.fechar(); });

// ------------------------------------------------------------------ apoio

/** Todas as colunas de to_jsonb(public.imoveis), como o contrato lista em §1 (LinhaImovel). */
const CHAVES_IMOVEL = [
  'id', 'corretor_id', 'titulo', 'tipo', 'valor', 'area_m2', 'dormitorios', 'garagem',
  'endereco', 'bairro', 'cidade', 'estado', 'cep', 'descricao', 'exclusividade_ate',
  'proprietario_nome', 'proprietario_cpf', 'proprietario_telefone', 'proprietario_email',
  'ativo', 'created_at', 'updated_at', 'tracking_data', 'status_venda', 'anunciado', 'finalidade', 'banheiros',
  'descricao_curta', 'proprietario_id', 'suites', 'is_sample_data', 'links_anuncio',
].sort();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** timestamptz pelo to_jsonb, como o PostgREST: ISO com fração opcional e fuso +00:00 (servidor em UTC). */
const INSTANTE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';
/** Formato aceito pelo ParseUUIDPipe e pelo banco, mas não v4 (contrato §0.2, regra larga). */
const NAO_V4 = '11111111-1111-1111-1111-111111111111';

const NAO_ENCONTRADO = { statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' };
const NADA_APAGADO = { statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Nada foi apagado: o imóvel não existe ou você não tem permissão.' };
const DADOS_INVALIDOS = { statusCode: 400, codigo: 'dados_invalidos', message: 'Dados inválidos. Confira os campos e tente de novo.' };
const ATENDIMENTO_EXPIRADO = { statusCode: 403, codigo: 'atendimento_expirado', message: 'Atendimento expirado.' };

const NOVO = {
  titulo: 'Apartamento no Jundiaí', tipo: 'APARTAMENTO', valor: 450000.5, area_m2: 72.35, dormitorios: 3, garagem: 2, suites: 1,
  banheiros: 2, endereco: 'Rua 1, 10', bairro: 'Jundiaí', cidade: 'Anápolis', proprietario_nome: '',
};

/** O corpo passa pelo mesmo ValidationPipe do main.ts, como o controller entregaria ao service. */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
async function corpo<T>(Classe: new () => T, dados: Record<string, unknown>): Promise<T> {
  return (await pipe.transform(dados, { type: 'body', metatype: Classe, data: '' })) as T;
}

/** Atalho para mandar ao service um valor que o DTO recusaria, para ver o que o banco faz com ele. */
const semDto = <T>(dados: Record<string, unknown>) => dados as unknown as T;

async function imovelNoBanco(id: string): Promise<Record<string, unknown> | undefined> {
  const linhas = await banco.sqlSuperusuario<{ linha: Record<string, unknown> }>('select to_jsonb(i) as linha from public.imoveis i where i.id = $1', [id]);
  return linhas[0]?.linha;
}

async function statusCliente(id: string): Promise<string | undefined> {
  return (await banco.sqlSuperusuario<{ status_funil: string }>('select status_funil::text as status_funil from public.clientes where id = $1', [id]))[0]?.status_funil;
}

let telefones = 0;
async function novoCliente(corretorId: string, extra: Record<string, unknown> = {}): Promise<string> {
  telefones += 1;
  const linha = await banco.inserir('clientes', { corretor_id: corretorId, nome: `Cliente ${telefones}`, telefone: `6298${String(1000000 + telefones)}`, ...extra });
  return linha.id as string;
}

async function novoImovelA(extra: Record<string, unknown> = {}): Promise<LinhaImovel> {
  return servico.criar(banco.claimsA, await corpo(CriarImovelDto, { ...NOVO, ...extra }));
}

/** Variação dos contadores de transação desde a chamada. */
function contarTransacoes(): () => BancoTeste['transacoes'] {
  const antes = { ...banco.transacoes };
  return () => ({
    commits: banco.transacoes.commits - antes.commits,
    rollbacks: banco.transacoes.rollbacks - antes.rollbacks,
    commitsAbortados: banco.transacoes.commitsAbortados - antes.commitsAbortados,
  });
}

/** O formato do PostgREST: chaves snake_case e tipos do to_jsonb (numeric como número, date 'YYYY-MM-DD', timestamptz ISO). */
function conferirFormato(linha: LinhaImovel): void {
  assert.deepEqual(Object.keys(linha).sort(), CHAVES_IMOVEL);
  assert.match(linha.id as string, UUID);
  assert.match(linha.corretor_id as string, UUID);
  assert.match(linha.created_at as string, INSTANTE_UTC);
  assert.match(linha.updated_at as string, INSTANTE_UTC);
  assert.equal(typeof linha.valor, 'number');
  for (const c of ['area_m2', 'dormitorios', 'garagem', 'suites', 'banheiros']) {
    assert.ok(linha[c] === null || typeof linha[c] === 'number', `${c} devia ser número ou null, veio ${typeof linha[c]}`);
  }
  assert.ok(linha.exclusividade_ate === null || /^\d{4}-\d{2}-\d{2}$/.test(linha.exclusividade_ate as string));
  assert.ok(typeof linha.tracking_data === 'object' && linha.tracking_data !== null && !Array.isArray(linha.tracking_data));
  assert.equal(typeof linha.ativo, 'boolean');
  assert.equal(typeof linha.anunciado, 'boolean');
  assert.equal(typeof linha.is_sample_data, 'boolean');
}

/** Claims de um atendimento de suporte: o JWT do titular carrega o session_id da sessão aberta pelo backoffice. */
async function claimsDeSuporte(conta: ContaTeste, expiraEmMs: number): Promise<SupabaseClaims> {
  const sessao = randomUUID();
  await banco.inserir('admin_sessoes_suporte', {
    ator_user_id: USUARIO_B, user_id: conta.userId, corretor_id: conta.corretorId, auth_session_id: sessao,
    criado_em: new Date(Date.now() - 3_600_000).toISOString(), expira_em: new Date(Date.now() + expiraEmMs).toISOString(),
  });
  return { ...conta.claims, session_id: sessao };
}

// ------------------------------------------------------------------ listar

describe('listar', () => {
  test('devolve as linhas da conta no formato do PostgREST e nada da outra conta', async () => {
    const criado = await novoImovelA();
    const daA = await servico.listar(banco.claimsA);
    assert.ok(daA.length >= 1);
    for (const linha of daA) {
      conferirFormato(linha);
      assert.equal(linha.corretor_id, banco.corretorA);
    }
    assert.ok(daA.some((i) => i.id === criado.id));
    assert.ok(!daA.some((i) => i.id === imovelB));
    // Inclui proprietario_* (rota de gestão do próprio corretor).
    assert.equal(daA.find((i) => i.id === criado.id)?.proprietario_nome, '');

    const doB = await servico.listar(banco.claimsB);
    assert.deepEqual(doB.map((i) => i.id), [imovelB]);
    assert.equal(doB[0].proprietario_nome, 'Dono B');
    assert.equal(doB[0].valor, 500000);
  });

  test('ordena por created_at desc com nulos primeiro, desempata por id e corta em 1000 linhas', async () => {
    const c = await banco.criarConta({ nome: 'Conta C' });
    const lote = await banco.sqlSuperusuario<{ id: string }>(
      `insert into public.imoveis (corretor_id, titulo, tipo, valor, endereco, cidade, proprietario_nome, ativo, created_at)
       select $1::uuid, 'Lote ' || g, 'TERRENO', 1000, 'Rua', 'Cidade', '', false, '2026-10-02T12:00:00Z'::timestamptz
       from generate_series(1, 1000) g returning id::text as id`, [c.corretorId]);
    const inserirC = async (titulo: string, created_at: string | null) => (await banco.inserir('imoveis', {
      corretor_id: c.corretorId, titulo, tipo: 'CASA', valor: 1, endereco: 'Rua', cidade: 'Cidade', proprietario_nome: '', ativo: false, created_at,
    })).id as string;
    const semData = await inserirC('Sem data', null);
    const recente = await inserirC('Recente', '2026-10-03T12:00:00Z');
    const antigo = await inserirC('Antigo', '2026-10-01T12:00:00Z');

    const lista = await servico.listar(c.claims);
    assert.equal(lista.length, LIMITE_LISTA);
    const idsLote = lote.map((l) => l.id).sort();
    // Nulos primeiro, depois o mais recente, depois o lote empatado em created_at por id; o mais antigo fica de fora.
    assert.deepEqual(lista.map((i) => i.id), [semData, recente, ...idsLote.slice(0, LIMITE_LISTA - 2)]);
    assert.equal(lista[0].created_at, null);
    assert.ok(!lista.some((i) => i.id === antigo));
  });
});

// ------------------------------------------------------------------ obter

describe('obter', () => {
  test('devolve a linha inteira, inclusive proprietario_*, com date, jsonb e numeric no formato do PostgREST', async () => {
    const criado = await novoImovelA();
    await banco.sqlSuperusuario(
      `update public.imoveis set estado = 'GO', cep = '75000-000', descricao = 'Desc', exclusividade_ate = '2026-12-31',
         proprietario_cpf = '000.000.000-00', proprietario_telefone = '62999990000', proprietario_email = 'dono@teste.lotti.local',
         tracking_data = '{"utm_source":"teste","n":1}', descricao_curta = 'Curta'
       where id = $1`, [criado.id]);
    const linha = await servico.obter(banco.claimsA, criado.id as string);
    conferirFormato(linha);
    assert.deepEqual(linha, await imovelNoBanco(criado.id as string));
    assert.equal(linha.estado, 'GO');
    assert.equal(linha.exclusividade_ate, '2026-12-31');
    assert.deepEqual(linha.tracking_data, { utm_source: 'teste', n: 1 });
    assert.equal(linha.valor, 450000.5);
    assert.equal(linha.area_m2, 72.35);
    assert.equal(linha.proprietario_cpf, '000.000.000-00');
    assert.equal(linha.proprietario_email, 'dono@teste.lotti.local');
  });

  test('imóvel de outra conta, inexistente ou com id não v4: 404 imovel_nao_encontrado', async () => {
    assert.deepEqual(await capturarErroHttp(servico.obter(banco.claimsA, imovelB)), { status: 404, corpo: NAO_ENCONTRADO });
    const criado = await novoImovelA();
    assert.deepEqual(await capturarErroHttp(servico.obter(banco.claimsB, criado.id as string)), { status: 404, corpo: NAO_ENCONTRADO });
    assert.deepEqual(await capturarErroHttp(servico.obter(banco.claimsA, INEXISTENTE)), { status: 404, corpo: NAO_ENCONTRADO });
    assert.deepEqual(await capturarErroHttp(servico.obter(banco.claimsA, NAO_V4)), { status: 404, corpo: NAO_ENCONTRADO });
  });

  test('id fora do formato (sem o ParseUUIDPipe na frente): o 22P02 do banco vira 400 dados_invalidos', async () => {
    assert.deepEqual(await capturarErroHttp(servico.obter(banco.claimsA, 'nao-e-uuid')), { status: 400, corpo: DADOS_INVALIDOS });
  });
});

// ------------------------------------------------------------------ listarClientesInteressados

describe('listarClientesInteressados', () => {
  test('devolve { id, nome, telefone, status_funil } dos clientes vinculados, na ordem do contrato', async () => {
    const imovel = await novoImovelA();
    const semData = await novoCliente(banco.corretorA, { created_at: null, nome: 'Sem data' });
    const recente = await novoCliente(banco.corretorA, { created_at: '2026-10-04T10:00:00Z', nome: 'Recente', status_funil: 'VISITA_PROPOSTA' });
    const antigo = await novoCliente(banco.corretorA, { created_at: '2026-10-01T10:00:00Z', nome: 'Antigo' });
    const naoVinculado = await novoCliente(banco.corretorA);
    for (const cliente_id of [antigo, semData, recente]) await banco.inserir('cliente_imovel', { cliente_id, imovel_id: imovel.id });

    const lista = await servico.listarClientesInteressados(banco.claimsA, imovel.id as string);
    assert.deepEqual(lista.map((c) => c.id), [semData, recente, antigo]);
    assert.ok(!lista.some((c) => c.id === naoVinculado));
    for (const c of lista) assert.deepEqual(Object.keys(c).sort(), ['id', 'nome', 'status_funil', 'telefone']);
    const [dadosRecente] = await banco.sqlSuperusuario<{ telefone: string }>('select telefone from public.clientes where id = $1', [recente]);
    assert.deepEqual(lista[1], { id: recente, nome: 'Recente', telefone: dadosRecente.telefone, status_funil: 'VISITA_PROPOSTA' });
    assert.equal(lista[0].status_funil, 'QUALIFICACAO');

    // A conta B não vê os vínculos nem os clientes da A.
    assert.deepEqual(await servico.listarClientesInteressados(banco.claimsB, imovel.id as string), []);
  });

  test('imóvel sem vínculo, inexistente ou de outra conta devolve lista vazia; id fora do formato vira 400', async () => {
    const semVinculo = await novoImovelA();
    assert.deepEqual(await servico.listarClientesInteressados(banco.claimsA, semVinculo.id as string), []);
    assert.deepEqual(await servico.listarClientesInteressados(banco.claimsA, INEXISTENTE), []);
    const clienteB = await novoCliente(banco.corretorB);
    await banco.inserir('cliente_imovel', { cliente_id: clienteB, imovel_id: imovelB });
    assert.deepEqual(await servico.listarClientesInteressados(banco.claimsA, imovelB), []);
    assert.deepEqual((await servico.listarClientesInteressados(banco.claimsB, imovelB)).map((c) => c.id), [clienteB]);
    assert.deepEqual(await capturarErroHttp(servico.listarClientesInteressados(banco.claimsA, 'nao-e-uuid')), { status: 400, corpo: DADOS_INVALIDOS });
  });
});

// ------------------------------------------------------------------ criar

describe('criar', () => {
  test('conta A: grava com o corretor resolvido no banco e devolve a linha gravada no formato do contrato', async () => {
    const transacoes = contarTransacoes();
    const criado = await servico.criar(banco.claimsA, await corpo(CriarImovelDto, NOVO));
    assert.deepEqual(transacoes(), { commits: 1, rollbacks: 0, commitsAbortados: 0 });
    conferirFormato(criado);
    assert.deepEqual(criado, await imovelNoBanco(criado.id as string));
    assert.equal(criado.corretor_id, banco.corretorA);
    assert.equal(criado.titulo, NOVO.titulo);
    assert.equal(criado.tipo, 'APARTAMENTO');
    assert.equal(criado.valor, 450000.5);
    assert.equal(criado.area_m2, 72.35);
    assert.equal(criado.dormitorios, 3);
    assert.equal(criado.garagem, 2);
    assert.equal(criado.suites, 1);
    assert.equal(criado.banheiros, 2);
    assert.equal(criado.bairro, 'Jundiaí');
    assert.equal(criado.proprietario_nome, '');
    // Omitidas ficam com o default do banco.
    assert.equal(criado.finalidade, 'VENDA');
    assert.equal(criado.ativo, true);
    assert.equal(criado.estado, 'SP');
    assert.equal(criado.status_venda, 'DISPONIVEL');
    assert.equal(criado.anunciado, false);
    assert.deepEqual(criado.tracking_data, {});
    assert.equal(criado.created_at, criado.updated_at);
  });

  test('só as colunas presentes entram: as omitidas ficam com o default e null grava NULL', async () => {
    const criado = await servico.criar(banco.claimsA, await corpo(CriarImovelDto, {
      titulo: 'Sala comercial', tipo: 'COMERCIAL', finalidade: 'LOCACAO', valor: 2500, endereco: '', cidade: 'Goiânia', proprietario_nome: 'Dona',
      bairro: null, area_m2: null, ativo: false,
    }));
    assert.equal(criado.finalidade, 'LOCACAO');
    assert.equal(criado.ativo, false);
    assert.equal(criado.bairro, null);
    assert.equal(criado.area_m2, null);
    assert.equal(criado.endereco, '');
    assert.equal(criado.dormitorios, 0);
    assert.equal(criado.garagem, 0);
    assert.equal(criado.banheiros, 0);
    assert.equal(criado.suites, null);
    assert.equal(criado.valor, 2500);
  });

  test('valores no limite do DTO cabem nas colunas numeric(15,2) e numeric(10,2)', async () => {
    const criado = await novoImovelA({ valor: 9999999999999.99, area_m2: 99999999.99, dormitorios: 999 });
    assert.equal(criado.valor, 9999999999999.99);
    assert.equal(criado.area_m2, 99999999.99);
    assert.equal(criado.dormitorios, 999);
  });

  test('conta B sem plano: 402 PLAN_LIMIT_REACHED (trava de cota real) e nada gravado', async () => {
    const contar = () => banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from public.imoveis where corretor_id = $1', [banco.corretorB]);
    const antes = await contar();
    const transacoes = contarTransacoes();
    const negado = await capturarErroHttp(servico.criar(banco.claimsB, await corpo(CriarImovelDto, { ...NOVO, titulo: 'Casa nova do B' })));
    assert.deepEqual(negado, {
      status: 402,
      corpo: {
        statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_imoveis',
        message: 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.',
      },
    });
    assert.deepEqual(transacoes(), { commits: 0, rollbacks: 1, commitsAbortados: 0 });
    assert.deepEqual(await contar(), antes);
  });

  test('sem corretor ativo (usuário sem conta ou conta suspensa): 403 corretor_nao_identificado e nada gravado', async () => {
    const corpoNegado = { statusCode: 403, codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' };
    const total = async () => (await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from public.imoveis'))[0].n;
    const antes = await total();

    const semConta: SupabaseClaims = { ...banco.claimsA, sub: randomUUID(), email: 'ninguem@teste.lotti.local' };
    assert.deepEqual(await capturarErroHttp(servico.criar(semConta, await corpo(CriarImovelDto, NOVO))), { status: 403, corpo: corpoNegado });

    const suspensa = await banco.criarConta({ nome: 'Conta suspensa', limiteImoveis: 10 });
    const imovelSuspensa = (await banco.inserir('imoveis', {
      corretor_id: suspensa.corretorId, titulo: 'Antes da suspensão', tipo: 'CASA', valor: 1, endereco: 'Rua', cidade: 'Cidade', proprietario_nome: '',
    })).id as string;
    await banco.sqlSuperusuario(`update public.corretores set status = 'suspenso' where id = $1`, [suspensa.corretorId]);
    assert.deepEqual(await capturarErroHttp(servico.criar(suspensa.claims, await corpo(CriarImovelDto, NOVO))), { status: 403, corpo: corpoNegado });
    // A leitura continua pela policy "routine organization: properties read" (o titular é 'proprietario' da própria
    // organização), igual ao PostgREST; a escrita depende de get_corretor_id(), que fica nulo: zero linhas → 404.
    assert.deepEqual((await servico.listar(suspensa.claims)).map((i) => i.id), [imovelSuspensa]);
    assert.deepEqual(await capturarErroHttp(servico.atualizar(suspensa.claims, imovelSuspensa, await corpo(AtualizarImovelDto, { titulo: 'Depois' }))),
      { status: 404, corpo: NAO_ENCONTRADO });
    assert.equal((await imovelNoBanco(imovelSuspensa))?.titulo, 'Antes da suspensão');

    assert.equal(await total(), antes + 1);
  });

  test('o que o DTO barraria, se chegasse ao banco, vira 400 dados_invalidos (22P02, 22003, 23502)', async () => {
    // O DTO recusa 'RURAL' antes (400 de validação com o texto em português).
    const validacao = await capturarErroHttp(corpo(CriarImovelDto, { ...NOVO, tipo: 'RURAL' }));
    assert.equal(validacao.status, 400);
    assert.deepEqual(validacao.corpo.message, ['Tipo de imóvel inválido. Use apartamento, casa, comercial ou terreno.']);

    const transacoes = contarTransacoes();
    for (const dados of [
      { ...NOVO, tipo: 'RURAL' }, // 22P02: valor fora do enum tipo_imovel
      { ...NOVO, valor: 1e14 }, // 22003: estoura numeric(15,2)
      { ...NOVO, titulo: null }, // 23502: titulo é NOT NULL
      { ...NOVO, titulo: 'a\uD800b' }, // 22P02: o jsonb recusa surrogate sozinho
    ]) {
      assert.deepEqual(await capturarErroHttp(servico.criar(banco.claimsA, semDto<CriarImovelDto>(dados))), { status: 400, corpo: DADOS_INVALIDOS }, JSON.stringify(dados));
    }
    assert.deepEqual(transacoes(), { commits: 0, rollbacks: 4, commitsAbortados: 0 });
  });
});

// ------------------------------------------------------------------ atualizar

describe('atualizar', () => {
  test('altera só as colunas enviadas e preserva as demais (inclusive as que a rota não edita)', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    await banco.sqlSuperusuario(
      `update public.imoveis set estado = 'GO', cep = '75000-000', descricao = 'Desc', exclusividade_ate = '2026-12-31',
         proprietario_cpf = '000.000.000-00', proprietario_telefone = '62999990000', proprietario_email = 'dono@teste.lotti.local',
         tracking_data = '{"utm_source":"teste"}', descricao_curta = 'Curta', status_venda = 'ALUGADO', ativo = false
       where id = $1`, [id]);
    const antes = (await imovelNoBanco(id))!;

    const transacoes = contarTransacoes();
    const linha = await servico.atualizar(banco.claimsA, id, await corpo(AtualizarImovelDto, {
      titulo: 'Título novo', valor: 500000.25, bairro: null, anunciado: true, finalidade: 'AMBOS', dormitorios: 4,
    }));
    assert.deepEqual(transacoes(), { commits: 1, rollbacks: 0, commitsAbortados: 0 });
    conferirFormato(linha);
    assert.deepEqual(linha, await imovelNoBanco(id));
    assert.deepEqual(linha, { ...antes, titulo: 'Título novo', valor: 500000.25, bairro: null, anunciado: true, finalidade: 'AMBOS', dormitorios: 4 });
  });

  test('uma coluna só (o switch "anunciado") também passa pelo set (col) = (select ...)', async () => {
    const criado = await novoImovelA();
    const linha = await servico.atualizar(banco.claimsA, criado.id as string, await corpo(AtualizarImovelDto, { anunciado: true }));
    assert.deepEqual(linha, { ...criado, anunciado: true });
  });

  test('zero linhas: inexistente ou de outra conta dá 404 e nada muda', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    const dto = await corpo(AtualizarImovelDto, { titulo: 'Invadido', anunciado: true });
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsB, id, dto)), { status: 404, corpo: NAO_ENCONTRADO });
    assert.deepEqual(await imovelNoBanco(id), criado);
    const doB = await imovelNoBanco(imovelB);
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, imovelB, dto)), { status: 404, corpo: NAO_ENCONTRADO });
    assert.deepEqual(await imovelNoBanco(imovelB), doB);
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, INEXISTENTE, dto)), { status: 404, corpo: NAO_ENCONTRADO });
  });

  test('corpo sem coluna: 400 nada_para_atualizar', async () => {
    const criado = await novoImovelA();
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, criado.id as string, await corpo(AtualizarImovelDto, {}))), {
      status: 400, corpo: { statusCode: 400, codigo: 'nada_para_atualizar', message: 'Nada para atualizar.' },
    });
  });

  test('conta B sem plano edita o próprio imóvel: a trava de cota não dispara porque ativo não é editável', async () => {
    const linha = await servico.atualizar(banco.claimsB, imovelB, await corpo(AtualizarImovelDto, { titulo: 'Casa do B reformada' }));
    assert.equal(linha.titulo, 'Casa do B reformada');
    assert.equal(linha.ativo, true);
    assert.equal(linha.corretor_id, banco.corretorB);
  });

  test('valor recusado pelo banco ou id fora do formato: 400 dados_invalidos, sem gravar', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, id, semDto<AtualizarImovelDto>({ finalidade: 'PERMUTA' }))), { status: 400, corpo: DADOS_INVALIDOS });
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, id, semDto<AtualizarImovelDto>({ titulo: null }))), { status: 400, corpo: DADOS_INVALIDOS });
    assert.deepEqual(await capturarErroHttp(servico.atualizar(banco.claimsA, 'nao-e-uuid', semDto<AtualizarImovelDto>({ titulo: 'x' }))), { status: 400, corpo: DADOS_INVALIDOS });
    assert.deepEqual(await imovelNoBanco(id), criado);
  });
});

// ------------------------------------------------------------------ remover

describe('remover', () => {
  test('apaga o imóvel da conta, com os vínculos de cliente em cascata', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    const cliente = await novoCliente(banco.corretorA);
    await banco.inserir('cliente_imovel', { cliente_id: cliente, imovel_id: id });
    const transacoes = contarTransacoes();
    assert.equal(await servico.remover(banco.claimsA, id), undefined);
    assert.deepEqual(transacoes(), { commits: 1, rollbacks: 0, commitsAbortados: 0 });
    assert.equal(await imovelNoBanco(id), undefined);
    assert.deepEqual(await banco.sqlSuperusuario('select id from public.cliente_imovel where imovel_id = $1', [id]), []);
    assert.equal(await statusCliente(cliente), 'QUALIFICACAO');
  });

  test('outra conta ou inexistente: 404 com a mensagem do contrato e nada apagado', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    assert.deepEqual(await capturarErroHttp(servico.remover(banco.claimsB, id)), { status: 404, corpo: NADA_APAGADO });
    assert.deepEqual(await imovelNoBanco(id), criado);
    assert.deepEqual(await capturarErroHttp(servico.remover(banco.claimsA, imovelB)), { status: 404, corpo: NADA_APAGADO });
    assert.ok(await imovelNoBanco(imovelB));
    assert.deepEqual(await capturarErroHttp(servico.remover(banco.claimsA, INEXISTENTE)), { status: 404, corpo: NADA_APAGADO });
  });

  test('contrato vinculado (FK RESTRICT): 409 imovel_com_contrato com sqlstate 23503 e o imóvel fica', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    await banco.inserir('contratos', {
      corretor_id: banco.corretorA, imovel_id: id, tipo: 'COMPRA_VENDA', valor: 450000, data_inicio: '2026-10-05', conteudo: 'Contrato de teste',
    });
    // O SQLSTATE depende da versão: 23503 até o Postgres 17, 23001 (restrict_violation) no 18 (PGlite e Railway).
    const bruto = await banco.db.run(banco.claimsA, (tx) => tx.$queryRaw(Prisma.sql`delete from public.imoveis where id = ${id}::uuid returning id`))
      .then(() => assert.fail('o delete devia ter sido barrado pelo contrato'), (e: unknown) => e);
    assert.ok(bruto instanceof Prisma.PrismaClientKnownRequestError && bruto.code === 'P2010');
    const meta = bruto.meta as { code: string; message: string };
    assert.ok(['23001', '23503'].includes(meta.code), meta.code);
    assert.match(meta.message, /^ERROR: .*foreign key constraint "contratos_imovel_id_fkey" on table "contratos"/);

    assert.deepEqual(await capturarErroHttp(servico.remover(banco.claimsA, id)), {
      status: 409,
      corpo: { statusCode: 409, codigo: 'imovel_com_contrato', message: 'Existem contratos vinculados a este imóvel.', sqlstate: '23503' },
    });
    assert.deepEqual(await imovelNoBanco(id), criado);
  });
});

// ------------------------------------------------------------------ registrarVenda

describe('registrarVenda', () => {
  test('sem cliente_id (ausente ou null): um run só, imóvel VENDIDO e cliente_atualizado false', async () => {
    for (const dados of [{}, { cliente_id: null }]) {
      const criado = await novoImovelA();
      const id = criado.id as string;
      const transacoes = contarTransacoes();
      const resposta = await servico.registrarVenda(banco.claimsA, id, await corpo(RegistrarVendaDto, dados));
      assert.deepEqual(resposta, { imovel_id: id, status_venda: 'VENDIDO', cliente_atualizado: false });
      assert.deepEqual(transacoes(), { commits: 1, rollbacks: 0, commitsAbortados: 0 });
      assert.deepEqual(await imovelNoBanco(id), { ...criado, status_venda: 'VENDIDO' });
      // A leitura pela rota confirma (passo 3 da fumaça do §5).
      assert.equal((await servico.obter(banco.claimsA, id)).status_venda, 'VENDIDO');
    }
  });

  test('com cliente da conta: cliente vai a FECHADO_GANHO, cliente_atualizado true e a conversa ganha o evento de etapa', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    const cliente = await novoCliente(banco.corretorA);
    const conversa = (await banco.inserir('lotti_agent_conversations', {
      channel_id: randomUUID(), corretor_id: banco.corretorA, cliente_id: cliente, phone: '62981230000',
    }, { semGatilhos: true })).id as string;

    const transacoes = contarTransacoes();
    const resposta = await servico.registrarVenda(banco.claimsA, id, await corpo(RegistrarVendaDto, { cliente_id: cliente }));
    assert.deepEqual(resposta, { imovel_id: id, status_venda: 'VENDIDO', cliente_atualizado: true });
    assert.deepEqual(transacoes(), { commits: 2, rollbacks: 0, commitsAbortados: 0 });
    assert.equal((await imovelNoBanco(id))?.status_venda, 'VENDIDO');
    assert.equal(await statusCliente(cliente), 'FECHADO_GANHO');
    const [corretorA] = await banco.sqlSuperusuario<{ nome: string }>('select nome from public.corretores where id = $1', [banco.corretorA]);
    assert.deepEqual(
      await banco.sqlSuperusuario('select kind, from_label, to_label, actor_label from public.lotti_inbox_events where conversation_id = $1', [conversa]),
      [{ kind: 'stage', from_label: 'QUALIFICACAO', to_label: 'FECHADO_GANHO', actor_label: corretorA.nome }],
    );
  });

  test('passo do cliente falha de verdade (gatilho legado de produção, 22P02): o imóvel continua VENDIDO e cliente_atualizado false', async () => {
    // Recoloca no banco de teste a versão de produção do gatilho (0_init), anterior à correção 20261005020000.
    const init = readFileSync(join(PASTA_MIGRATIONS, '0_init', 'migration.sql'), 'utf8');
    const legado = /CREATE OR REPLACE FUNCTION public\.lotti_inbox_record_legacy_stage\(\)[\s\S]*?\$function\$\s*;/.exec(init)?.[0] ?? '';
    assert.ok(legado.includes("coalesce(old.status_funil, 'Sem etapa')"), 'a versão legada do gatilho não foi encontrada no 0_init');
    const [{ def: corrigido }] = await banco.sqlSuperusuario<{ def: string }>(
      `select pg_get_functiondef('public.lotti_inbox_record_legacy_stage()'::regprocedure) as def`);

    const criado = await novoImovelA();
    const id = criado.id as string;
    const cliente = await novoCliente(banco.corretorA, { nome: 'Nome que não pode ir ao log', telefone: '62987654321' });
    const aviso = mock.method(Logger.prototype, 'warn', () => undefined);
    await banco.pglite.exec(legado);
    try {
      const transacoes = contarTransacoes();
      const resposta = await servico.registrarVenda(banco.claimsA, id, await corpo(RegistrarVendaDto, { cliente_id: cliente }));
      assert.deepEqual(resposta, { imovel_id: id, status_venda: 'VENDIDO', cliente_atualizado: false });
      // O imóvel foi confirmado no 1º run; o 2º voltou com erro (ROLLBACK), sem transação abortada engolida.
      assert.deepEqual(transacoes(), { commits: 1, rollbacks: 1, commitsAbortados: 0 });
      assert.deepEqual(await imovelNoBanco(id), { ...criado, status_venda: 'VENDIDO' });
      assert.equal(await statusCliente(cliente), 'QUALIFICACAO');
      // O log só leva o SQLSTATE: nada de nome, telefone ou texto do Postgres.
      assert.deepEqual(aviso.mock.calls.map((c) => c.arguments[0]), ['venda sem cliente atualizado: 22P02']);
    } finally {
      aviso.mock.restore();
      await banco.pglite.exec(corrigido);
    }
    // Com a correção de volta, a mesma troca de etapa grava.
    assert.deepEqual(await servico.registrarVenda(banco.claimsA, id, await corpo(RegistrarVendaDto, { cliente_id: cliente })),
      { imovel_id: id, status_venda: 'VENDIDO', cliente_atualizado: true });
  });

  test('cliente de outra conta ou inexistente: imóvel VENDIDO, cliente_atualizado false e o cliente alheio intacto', async () => {
    const clienteB = await novoCliente(banco.corretorB);
    for (const cliente_id of [clienteB, INEXISTENTE, NAO_V4]) {
      const criado = await novoImovelA();
      const id = criado.id as string;
      const transacoes = contarTransacoes();
      const resposta = await servico.registrarVenda(banco.claimsA, id, await corpo(RegistrarVendaDto, { cliente_id }));
      assert.deepEqual(resposta, { imovel_id: id, status_venda: 'VENDIDO', cliente_atualizado: false }, cliente_id);
      assert.deepEqual(transacoes(), { commits: 2, rollbacks: 0, commitsAbortados: 0 });
      assert.equal((await imovelNoBanco(id))?.status_venda, 'VENDIDO');
    }
    assert.equal(await statusCliente(clienteB), 'QUALIFICACAO');
  });

  test('imóvel de outra conta ou inexistente: 404 e o cliente não é tocado (um run só)', async () => {
    const cliente = await novoCliente(banco.corretorA);
    const doB = await imovelNoBanco(imovelB);
    for (const id of [imovelB, INEXISTENTE]) {
      const transacoes = contarTransacoes();
      assert.deepEqual(await capturarErroHttp(servico.registrarVenda(banco.claimsA, id, await corpo(RegistrarVendaDto, { cliente_id: cliente }))),
        { status: 404, corpo: NAO_ENCONTRADO });
      assert.deepEqual(transacoes(), { commits: 0, rollbacks: 1, commitsAbortados: 0 });
    }
    assert.deepEqual(await imovelNoBanco(imovelB), doB);
    assert.equal(await statusCliente(cliente), 'QUALIFICACAO');
    assert.deepEqual(await capturarErroHttp(servico.registrarVenda(banco.claimsA, 'nao-e-uuid', await corpo(RegistrarVendaDto, {}))), { status: 400, corpo: DADOS_INVALIDOS });
  });
});

// ------------------------------------------------------------------ atendimento de suporte (o 42501 real das escritas)

describe('atendimento de suporte', () => {
  test('sessão expirada: toda escrita dá 403 atendimento_expirado e nada muda', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    const expirada = await claimsDeSuporte(banco.contaA, -60_000);
    const total = async () => (await banco.sqlSuperusuario<{ n: number }>('select count(*)::int as n from public.imoveis where corretor_id = $1', [banco.corretorA]))[0].n;
    const antes = await total();

    assert.deepEqual(await capturarErroHttp(servico.criar(expirada, await corpo(CriarImovelDto, NOVO))), { status: 403, corpo: ATENDIMENTO_EXPIRADO });
    assert.deepEqual(await capturarErroHttp(servico.atualizar(expirada, id, await corpo(AtualizarImovelDto, { titulo: 'Pelo suporte' }))), { status: 403, corpo: ATENDIMENTO_EXPIRADO });
    assert.deepEqual(await capturarErroHttp(servico.remover(expirada, id)), { status: 403, corpo: ATENDIMENTO_EXPIRADO });
    assert.deepEqual(await capturarErroHttp(servico.registrarVenda(expirada, id, await corpo(RegistrarVendaDto, {}))), { status: 403, corpo: ATENDIMENTO_EXPIRADO });
    assert.equal(await total(), antes);
    assert.deepEqual(await imovelNoBanco(id), criado);
    // Leitura não passa pelo gatilho de auditoria.
    assert.equal((await servico.obter(expirada, id)).id, id);
  });

  test('sessão válida: a escrita grava e fica auditada com o ator e os campos alterados', async () => {
    const criado = await novoImovelA();
    const id = criado.id as string;
    const valida = await claimsDeSuporte(banco.contaA, 30 * 60_000);
    const linha = await servico.atualizar(valida, id, await corpo(AtualizarImovelDto, { titulo: 'Pelo suporte' }));
    assert.equal(linha.titulo, 'Pelo suporte');
    const auditoria = await banco.sqlSuperusuario<{ ator: string; acao: string; entidade: string; entidade_id: string; campos: unknown }>(
      `select ator_user_id::text as ator, acao, entidade, entidade_id, dados_depois->'campos' as campos
       from public.admin_auditoria where entidade_id = $1`, [id]);
    assert.deepEqual(auditoria, [{ ator: USUARIO_B, acao: 'suporte_update', entidade: 'imoveis', entidade_id: id, campos: ['titulo'] }]);
  });
});

test('nenhuma chamada deixou transação abortada para trás (COMMIT que vira ROLLBACK calado)', () => {
  assert.equal(banco.transacoes.commitsAbortados, 0);
  assert.ok(banco.transacoes.commits > 0);
});
