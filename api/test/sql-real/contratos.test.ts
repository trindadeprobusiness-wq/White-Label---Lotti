// SQL real do módulo contratos (contrato 2026-10-05 §5.2) contra um Postgres de verdade: PGlite com todas as
// migrations, RLS ligado e o TenantDb de produção (claims + `set local role authenticated`).
// Cada método público roda o próprio SQL e é conferido no caminho feliz (formato do PostgREST), no isolamento
// entre as contas A e B e nos erros traduzidos. A cota de IA roda pelo caminho privilegiado (PrismaService
// fora do TenantDb) e o fetch do Gemini é sempre falso.
// O @Type do class-transformer lê Reflect.getMetadata ao decorar o DTO: carregue antes dele, como o Nest faz.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ContratosIaService } from '../../src/contratos/contratos-ia.service';
import {
  AlterarContratoDto, ContratosDosClientesDto, CriarContratoDto, CriarLocacaoDto, EditarLocacaoDto, ListarLocacaoDto,
} from '../../src/contratos/contratos.dto';
import { erroPg } from '../../src/contratos/contratos.erros';
import { ContratosService, type Linha } from '../../src/contratos/contratos.service';
import { AlterarDocumentoDto, CriarDocumentoDto } from '../../src/contratos/documentos.dto';
import { DocumentosService } from '../../src/contratos/documentos.service';
import { type ClienteCota, finalizarCota, reservarCota } from '../../src/contratos/ia/cota';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { SupabaseClaims } from '../../src/prisma/tenant-db';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

let banco: BancoTeste;
let contratos: ContratosService;
let documentos: DocumentosService;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';

const ERRO = {
  dadosInvalidos: { statusCode: 400, codigo: 'dados_invalidos', message: 'Dados inválidos. Confira os campos e tente de novo.' },
  nada: { statusCode: 400, codigo: 'nada_para_atualizar', message: 'Nada para atualizar.' },
  semCorretor: { statusCode: 403, codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' },
  contratoNaoEncontrado: { statusCode: 404, codigo: 'contrato_nao_encontrado', message: 'Contrato não encontrado.' },
  documentoNaoEncontrado: { statusCode: 404, codigo: 'documento_nao_encontrado', message: 'Documento não encontrado.' },
  clienteInvalido: { statusCode: 422, codigo: 'cliente_invalido', message: 'Cliente não encontrado nesta conta.' },
  imovelInvalido: { statusCode: 422, codigo: 'imovel_invalido', message: 'Imóvel não encontrado nesta conta.' },
  arquivoInvalido: { statusCode: 422, codigo: 'arquivo_invalido', message: 'O arquivo não pertence a esta conta.' },
  limiteLocacao: {
    statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_contratos_locacao',
    message: 'Limite de contratos de locação atingido. Acesse Plano e Assinatura para liberar mais contratos.',
  },
} as const;

async function falha(promessa: Promise<unknown>, esperado: { statusCode: number }): Promise<void> {
  assert.deepEqual(await capturarErroHttp(promessa), { status: esperado.statusCode, corpo: esperado });
}

const OPCOES_PIPE = { whitelist: true, forbidNonWhitelisted: true };

function dto<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): T {
  const instancia = plainToInstance(Classe, corpo);
  assert.deepEqual(validateSync(instancia, OPCOES_PIPE).map((e) => e.property), [], 'o ValidationPipe deveria aceitar este corpo');
  return instancia;
}

function semValidacao<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): T {
  const instancia = plainToInstance(Classe, corpo);
  assert.notEqual(validateSync(instancia, OPCOES_PIPE).length, 0, 'o ValidationPipe deveria recusar este corpo');
  return instancia;
}

const claimsSemConta = (): SupabaseClaims => ({
  sub: randomUUID(), role: 'authenticated', aud: 'authenticated', email: 'sem-conta@teste.lotti.local', aal: 'aal1', is_anonymous: false,
});

let clienteA: string;
let clienteB: string;
let imovelA: string;
let imovelB: string;
let contratoB: string;
let documentoB: string;
let hoje: string;
let ontem: string;
let amanha: string;

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const [r] = await banco.sqlSuperusuario<{ n: number }>(sql, params);
  return r.n;
}

async function contratoGravado(id: string): Promise<Linha | undefined> {
  const [r] = await banco.sqlSuperusuario<{ linha: Linha }>(`select to_jsonb(c) as linha from public.contratos c where c.id = $1::uuid`, [id]);
  return r?.linha;
}

const locacao = (extra: Record<string, unknown> = {}) => ({
  cliente_id: clienteA, imovel_id: imovelA, valor: 1500.5, data_inicio: '2026-10-01', dia_vencimento: 10,
  conteudo: '{"obs":"x"}', ...extra,
});

before(async () => {
  banco = await criarBanco();
  contratos = new ContratosService(banco.db);
  documentos = new DocumentosService(banco.db);
  // A tem plano: libera locação ATIVA e a cota mensal de IA.
  await banco.sqlSuperusuario(
    `insert into public.plan_entitlements (plan_id, feature_key, feature_name, enabled, limit_value, unlimited)
     values ($1::uuid, 'max_contratos_locacao', 'Contratos de locação', true, 100, false),
            ($1::uuid, 'ai_contracts_monthly', 'IA de contratos', true, 5, false)`,
    [banco.contaA.planoId],
  );
  clienteA = (await banco.inserir('clientes', { corretor_id: banco.corretorA, nome: 'Cliente da A', telefone: '62981234567' })).id as string;
  clienteB = (await banco.inserir('clientes', { corretor_id: banco.corretorB, nome: 'Cliente do B', telefone: '62981234568' })).id as string;
  imovelA = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorA, titulo: 'Apto da A', tipo: 'APARTAMENTO', valor: 350000, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono',
  })).id as string;
  imovelB = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorB, titulo: 'Casa do B', tipo: 'CASA', valor: 200000, endereco: 'Rua 2', cidade: 'Goiânia', proprietario_nome: 'Dono B', anunciado: false,
  }, { semGatilhos: true })).id as string;
  contratoB = (await banco.inserir('contratos', {
    corretor_id: banco.corretorB, cliente_id: clienteB, tipo: 'COMPRA_VENDA', valor: 1000, data_inicio: '2026-01-01', conteudo: '',
  })).id as string;
  documentoB = (await banco.inserir('documentos', {
    corretor_id: banco.corretorB, nome: 'RG do B', tipo: 'RG', arquivo_path: `${banco.corretorB}/rg.pdf`,
  })).id as string;
  const [d] = await banco.sqlSuperusuario<{ hoje: string; ontem: string; amanha: string }>(`
    select (now() at time zone 'America/Sao_Paulo')::date::text as hoje,
           ((now() at time zone 'America/Sao_Paulo')::date - 1)::text as ontem,
           ((now() at time zone 'America/Sao_Paulo')::date + 1)::text as amanha`);
  ({ hoje, ontem, amanha } = d);
});

after(async () => {
  await banco?.fechar();
});

describe('contratos: criação e formato', () => {
  test('criar sem status grava RASCUNHO, no formato to_jsonb, e listar devolve as colunas da tabela', async () => {
    const criado = await contratos.criar(banco.claimsA, dto(CriarContratoDto, {
      tipo: 'COMPRA_VENDA', cliente_id: clienteA, imovel_id: imovelA, valor: 350000.25, data_inicio: '2026-05-21', data_fim: '2026-12-31', conteudo: '',
    }));
    assert.match(criado.id as string, UUID);
    assert.equal(criado.status, 'RASCUNHO');
    assert.equal(criado.corretor_id, banco.corretorA);
    assert.equal(criado.valor, 350000.25);
    assert.equal(criado.data_inicio, '2026-05-21');
    assert.match(criado.created_at as string, TIMESTAMPTZ);
    assert.deepEqual(criado, await contratoGravado(criado.id as string));

    const lista = await contratos.listar(banco.claimsA);
    const [{ linha: modelo }] = await banco.sqlSuperusuario<{ linha: Linha }>('select to_jsonb(c) as linha from public.contratos c limit 1');
    const achado = lista.find((l) => l.id === criado.id)!;
    assert.deepEqual(Object.keys(achado).sort(), Object.keys(modelo).sort());
    assert.equal(typeof achado.valor, 'number');
    assert.match(achado.data_inicio as string, DATA);
    assert.match(achado.created_at as string, TIMESTAMPTZ);
  });

  test("tipo 'OUTRO' é barrado pelo DTO e, se chegar ao banco, vira 400 dados_invalidos (22P02)", async () => {
    const corpo = { tipo: 'OUTRO', valor: 1, data_inicio: '2026-05-21', conteudo: '' };
    await falha(contratos.criar(banco.claimsA, semValidacao(CriarContratoDto, corpo)), ERRO.dadosInvalidos);
  });

  test('data impossível (31/02) passa no formato e o banco responde 400', async () => {
    await falha(contratos.criar(banco.claimsA, dto(CriarContratoDto, {
      tipo: 'DISTRATO', valor: 1, data_inicio: '2026-02-31', conteudo: '',
    })), ERRO.dadosInvalidos);
  });

  test('versao/modelo_ia/tempo_geracao_ms e corretor_id são recusados pelo DTO', async () => {
    for (const extra of [{ versao: 1 }, { modelo_ia: 'x' }, { tempo_geracao_ms: 5 }, { corretor_id: banco.corretorB }]) {
      semValidacao(CriarContratoDto, { tipo: 'DISTRATO', valor: 1, data_inicio: '2026-05-21', conteudo: '', ...extra });
    }
  });

  test('usuário sem conta → 403 corretor_nao_identificado', async () => {
    await falha(contratos.criar(claimsSemConta(), dto(CriarContratoDto, { tipo: 'DISTRATO', valor: 1, data_inicio: '2026-05-21', conteudo: '' })), ERRO.semCorretor);
  });

  test('central: embeds de imóvel e cliente, null sem vínculo, data_fim asc com nulos no fim', async () => {
    await contratos.criar(banco.claimsA, dto(CriarContratoDto, { tipo: 'PROCURACAO', valor: 0, data_inicio: '2026-01-01', conteudo: '' }));
    await contratos.criar(banco.claimsA, dto(CriarContratoDto, { tipo: 'PROCURACAO', valor: 0, data_inicio: '2026-01-01', data_fim: '2026-06-30', conteudo: '' }));
    const lista = await contratos.listarCentral(banco.claimsA);
    assert.ok(lista.length >= 3);
    const comVinculo = lista.find((l) => l.cliente_id === clienteA && l.tipo === 'COMPRA_VENDA')!;
    assert.deepEqual(comVinculo.imoveis, { titulo: 'Apto da A' });
    assert.deepEqual(comVinculo.clientes, { nome: 'Cliente da A' });
    const semVinculo = lista.find((l) => l.cliente_id === null)!;
    assert.equal(semVinculo.imoveis, null);
    assert.equal(semVinculo.clientes, null);
    assert.deepEqual(Object.keys(comVinculo).sort(), [
      'arquivo_url', 'cliente_id', 'clientes', 'created_at', 'data_fim', 'data_inicio', 'id', 'imoveis', 'imovel_id', 'observacoes', 'status', 'tipo', 'valor',
    ]);
    const fins = lista.map((l) => l.data_fim as string | null);
    const primeiroNulo = fins.indexOf(null);
    assert.ok(primeiroNulo > 0);
    assert.ok(fins.slice(primeiroNulo).every((f) => f === null));
    const datas = fins.slice(0, primeiroNulo) as string[];
    assert.deepEqual([...datas].sort(), datas);
    assert.ok(lista.every((l) => l.id !== contratoB));
  });
});

describe('contratos: isolamento entre contas', () => {
  test('contrato de B não aparece para A; PATCH/DELETE de A no id de B → 404', async () => {
    assert.ok((await contratos.listar(banco.claimsA)).every((l) => l.id !== contratoB));
    assert.ok((await contratos.listar(banco.claimsB)).some((l) => l.id === contratoB));
    await falha(contratos.alterar(banco.claimsA, contratoB, dto(AlterarContratoDto, { status: 'ENCERRADO' })), ERRO.contratoNaoEncontrado);
    await falha(contratos.remover(banco.claimsA, contratoB), ERRO.contratoNaoEncontrado);
    await falha(contratos.editarLocacao(banco.claimsA, contratoB, dto(EditarLocacaoDto, locacao())), ERRO.contratoNaoEncontrado);
    assert.ok(await contratoGravado(contratoB));
  });

  test('cliente ou imóvel de B no corpo de A → 422', async () => {
    const base = { tipo: 'COMPRA_VENDA', valor: 1, data_inicio: '2026-05-21', conteudo: '' };
    await falha(contratos.criar(banco.claimsA, dto(CriarContratoDto, { ...base, cliente_id: clienteB })), ERRO.clienteInvalido);
    await falha(contratos.criar(banco.claimsA, dto(CriarContratoDto, { ...base, imovel_id: imovelB })), ERRO.imovelInvalido);
    await falha(contratos.criar(banco.claimsA, dto(CriarContratoDto, { ...base, cliente_id: INEXISTENTE })), ERRO.clienteInvalido);
  });

  test('por-clientes: só os contratos visíveis, com o título do imóvel', async () => {
    const linhas = await contratos.listarDosClientes(banco.claimsA, dto(ContratosDosClientesDto, { cliente_ids: [clienteA, clienteB] }));
    assert.ok(linhas.length > 0);
    assert.ok(linhas.every((l) => l.cliente_id === clienteA));
    assert.deepEqual(Object.keys(linhas[0]).sort(), ['cliente_id', 'id', 'imoveis', 'status', 'tipo']);
    assert.deepEqual(await contratos.listarDosClientes(banco.claimsA, dto(ContratosDosClientesDto, { cliente_ids: [clienteB] })), []);
  });
});

describe('contratos: locação', () => {
  test('conta sem cota de locação → 402 e nada gravado (nem contrato, nem fatura)', async () => {
    const antes = { c: await contar('select count(*)::int as n from public.contratos'), f: await contar('select count(*)::int as n from public.faturas_aluguel') };
    const imovelProprioB = imovelB;
    await falha(contratos.criarLocacao(banco.claimsB, dto(CriarLocacaoDto, locacao({
      cliente_id: clienteB, imovel_id: imovelProprioB, primeira_fatura: { data_vencimento: amanha, mes_referencia: '11/2026' },
    }))), ERRO.limiteLocacao);
    assert.equal(await contar('select count(*)::int as n from public.contratos'), antes.c);
    assert.equal(await contar('select count(*)::int as n from public.faturas_aluguel'), antes.f);
  });

  test('cria contrato ATIVO e a primeira fatura juntos; ATRASADO para ontem e hoje (São Paulo), PENDENTE para amanhã', async () => {
    const abortadosAntes = banco.transacoes.commitsAbortados;
    for (const [venc, esperado] of [[ontem, 'ATRASADO'], [hoje, 'ATRASADO'], [amanha, 'PENDENTE']] as const) {
      const r = await contratos.criarLocacao(banco.claimsA, dto(CriarLocacaoDto, locacao({
        primeira_fatura: { data_vencimento: venc, mes_referencia: '10/2026' },
      })));
      assert.equal(r.contrato.status, 'ATIVO');
      assert.equal(r.contrato.tipo, 'LOCACAO_RESIDENCIAL');
      assert.equal(r.contrato.valor, 1500.5);
      assert.equal(r.fatura.contrato_id, r.contrato.id);
      assert.equal(r.fatura.data_vencimento, venc);
      assert.equal(r.fatura.mes_referencia, '10/2026');
      assert.equal(r.fatura.status, esperado);
      assert.equal(r.fatura.valor_aluguel, 1500.5);
      assert.equal(r.fatura.corretor_id, banco.corretorA);
      assert.equal(await contar('select count(*)::int as n from public.faturas_aluguel where contrato_id = $1::uuid', [r.contrato.id]), 1);
    }
    assert.equal(banco.transacoes.commitsAbortados, abortadosAntes);
  });

  test('listar locação: só o tipo pedido, com embeds de cliente e imóvel', async () => {
    const lista = await contratos.listarLocacao(banco.claimsA, dto(ListarLocacaoDto, {}));
    assert.ok(lista.length >= 3);
    assert.ok(lista.every((l) => l.tipo === 'LOCACAO_RESIDENCIAL'));
    assert.deepEqual(lista[0].clientes, { nome: 'Cliente da A', telefone: '62981234567' });
    assert.deepEqual(lista[0].imoveis, { titulo: 'Apto da A', endereco: 'Rua 1', proprietario_nome: 'Dono' });
    assert.deepEqual(await contratos.listarLocacao(banco.claimsA, dto(ListarLocacaoDto, { tipo: 'LOCACAO_COMERCIAL' })), []);
  });

  test('criar locação com cliente de B → 422 e nada gravado', async () => {
    const antes = await contar('select count(*)::int as n from public.contratos');
    await falha(contratos.criarLocacao(banco.claimsA, dto(CriarLocacaoDto, locacao({
      cliente_id: clienteB, primeira_fatura: { data_vencimento: amanha, mes_referencia: '10/2026' },
    }))), ERRO.clienteInvalido);
    assert.equal(await contar('select count(*)::int as n from public.contratos'), antes);
  });

  test('edição sincroniza faturas abertas: valor novo, dia 31 em 02/2027 → 28, PAGO intocada, emitidas só com external_id', async () => {
    const { contrato } = await contratos.criarLocacao(banco.claimsA, dto(CriarLocacaoDto, locacao({
      primeira_fatura: { data_vencimento: '2027-01-10', mes_referencia: '01/2027' },
    })));
    const id = contrato.id as string;
    const base = { contrato_id: id, cliente_id: clienteA, imovel_id: imovelA, corretor_id: banco.corretorA, valor_aluguel: 1500.5 };
    const emitida = (await banco.inserir('faturas_aluguel', { ...base, mes_referencia: '02/2027', data_vencimento: '2027-02-10', external_id: 'pay_1' })).id as string;
    const atrasada = (await banco.inserir('faturas_aluguel', { ...base, mes_referencia: '03/2027', data_vencimento: '2027-03-10', status: 'ATRASADO' })).id as string;
    const paga = (await banco.inserir('faturas_aluguel', { ...base, mes_referencia: '04/2027', data_vencimento: '2027-04-10', status: 'PAGO', external_id: 'pay_2' })).id as string;
    await banco.sqlSuperusuario(`update public.contratos set updated_at = '2020-01-01T00:00:00Z' where id = $1::uuid`, [id]);

    const r = await contratos.editarLocacao(banco.claimsA, id, dto(EditarLocacaoDto, locacao({ valor: 2000, dia_vencimento: 31 })));
    assert.equal(r.contrato.valor, 2000);
    assert.equal(r.contrato.dia_vencimento, 31);
    assert.equal(r.contrato.status, 'ATIVO');
    assert.ok((r.contrato.updated_at as string) > '2020-01-02');
    assert.deepEqual(r.faturas_emitidas, [emitida]);

    const faturas = await banco.sqlSuperusuario<{ id: string; v: string; d: string }>(
      `select id::text as id, valor_aluguel::text as v, data_vencimento::text as d from public.faturas_aluguel where contrato_id = $1::uuid`, [id]);
    const por = Object.fromEntries(faturas.map((f) => [f.id, f]));
    assert.deepEqual(por[emitida], { id: emitida, v: '2000.00', d: '2027-02-28' });
    assert.deepEqual(por[atrasada], { id: atrasada, v: '2000.00', d: '2027-03-31' });
    assert.deepEqual(por[paga], { id: paga, v: '1500.50', d: '2027-04-10' });
    const primeira = faturas.find((f) => ![emitida, atrasada, paga].includes(f.id))!;
    assert.deepEqual({ v: primeira.v, d: primeira.d }, { v: '2000.00', d: '2027-01-31' });

    // Mesmo dia: só o valor muda, a data fica.
    await contratos.editarLocacao(banco.claimsA, id, dto(EditarLocacaoDto, locacao({ valor: 2100, dia_vencimento: 31 })));
    const [depois] = await banco.sqlSuperusuario<{ v: string; d: string }>(
      `select valor_aluguel::text as v, data_vencimento::text as d from public.faturas_aluguel where id = $1::uuid`, [emitida]);
    assert.deepEqual(depois, { v: '2100.00', d: '2027-02-28' });
  });

  test('alterar: encerra, avança updated_at; sem campos → 400; reativar acima da cota → 402', async () => {
    const { contrato } = await contratos.criarLocacao(banco.claimsA, dto(CriarLocacaoDto, locacao({
      primeira_fatura: { data_vencimento: amanha, mes_referencia: '12/2026' },
    })));
    const id = contrato.id as string;
    await banco.sqlSuperusuario(`update public.contratos set updated_at = '2020-01-01T00:00:00Z' where id = $1::uuid`, [id]);
    const encerrado = await contratos.alterar(banco.claimsA, id, dto(AlterarContratoDto, { status: 'ENCERRADO', data_fim: '2026-12-31' }));
    assert.equal(encerrado.status, 'ENCERRADO');
    assert.equal(encerrado.data_fim, '2026-12-31');
    assert.ok((encerrado.updated_at as string) > '2020-01-02');
    await assert.rejects(Promise.resolve().then(() => contratos.alterar(banco.claimsA, id, dto(AlterarContratoDto, {}))), (e: unknown) => {
      assert.deepEqual((e as { getResponse(): unknown }).getResponse(), ERRO.nada);
      return true;
    });
    await banco.sqlSuperusuario(`update public.plan_entitlements set limit_value = 0 where plan_id = $1::uuid and feature_key = 'max_contratos_locacao'`, [banco.contaA.planoId]);
    try {
      await falha(contratos.alterar(banco.claimsA, id, dto(AlterarContratoDto, { status: 'ATIVO' })), ERRO.limiteLocacao);
      assert.equal((await contratoGravado(id))!.status, 'ENCERRADO');
    } finally {
      await banco.sqlSuperusuario(`update public.plan_entitlements set limit_value = 100 where plan_id = $1::uuid and feature_key = 'max_contratos_locacao'`, [banco.contaA.planoId]);
    }
  });

  test('excluir apaga o contrato e as faturas dele (CASCADE)', async () => {
    const { contrato } = await contratos.criarLocacao(banco.claimsA, dto(CriarLocacaoDto, locacao({
      primeira_fatura: { data_vencimento: amanha, mes_referencia: '10/2026' },
    })));
    const id = contrato.id as string;
    assert.equal(await contratos.remover(banco.claimsA, id), undefined);
    assert.equal(await contratoGravado(id), undefined);
    assert.equal(await contar('select count(*)::int as n from public.faturas_aluguel where contrato_id = $1::uuid', [id]), 0);
    await falha(contratos.remover(banco.claimsA, id), ERRO.contratoNaoEncontrado);
  });
});

describe('documentos', () => {
  test('criar, listar, validar, editar e excluir para o dono; nunca escreve updated_at', async () => {
    const doc = await documentos.criar(banco.claimsA, dto(CriarDocumentoDto, {
      nome: 'Contrato assinado', tipo: 'CONTRATO', arquivo_path: `${banco.corretorA}/contrato.pdf`, cliente_id: clienteA,
      data_validade: '2027-01-01T00:00:00Z',
    }));
    assert.match(doc.id as string, UUID);
    assert.equal(doc.validado, false);
    assert.equal(doc.corretor_id, banco.corretorA);
    assert.match(doc.data_validade as string, TIMESTAMPTZ);
    // A coluna existe desde 20261006120000_ajustes_modulos; quem preenche é o banco.
    assert.match(doc.updated_at as string, TIMESTAMPTZ);

    const lista = await documentos.listar(banco.claimsA);
    assert.ok(lista.some((l) => l.id === doc.id));
    assert.ok(lista.every((l) => l.id !== documentoB));

    const validado = await documentos.alterar(banco.claimsA, doc.id as string, dto(AlterarDocumentoDto, { validado: true }));
    assert.equal(validado.validado, true);
    const editado = await documentos.alterar(banco.claimsA, doc.id as string, dto(AlterarDocumentoDto, { nome: 'Novo nome', observacoes: null, imovel_id: imovelA }));
    assert.equal(editado.nome, 'Novo nome');
    assert.equal(editado.imovel_id, imovelA);

    assert.equal(await documentos.remover(banco.claimsA, doc.id as string), undefined);
    await falha(documentos.remover(banco.claimsA, doc.id as string), ERRO.documentoNaoEncontrado);
  });

  test('arquivo_path sem o prefixo do corretor → 422; de B → 422; cliente de B → 422', async () => {
    const base = { nome: 'X', tipo: 'RG' };
    await falha(documentos.criar(banco.claimsA, dto(CriarDocumentoDto, { ...base, arquivo_path: 'solto.pdf' })), ERRO.arquivoInvalido);
    await falha(documentos.criar(banco.claimsA, dto(CriarDocumentoDto, { ...base, arquivo_path: `${banco.corretorB}/x.pdf` })), ERRO.arquivoInvalido);
    await falha(documentos.criar(banco.claimsA, dto(CriarDocumentoDto, {
      ...base, arquivo_path: `${banco.corretorA}/x.pdf`, cliente_id: clienteB,
    })), ERRO.clienteInvalido);
  });

  test('documento de B: invisível para A, PATCH/DELETE → 404, sem campos → 400', async () => {
    await falha(documentos.alterar(banco.claimsA, documentoB, dto(AlterarDocumentoDto, { validado: true })), ERRO.documentoNaoEncontrado);
    await falha(documentos.remover(banco.claimsA, documentoB), ERRO.documentoNaoEncontrado);
    await assert.rejects(Promise.resolve().then(() => documentos.alterar(banco.claimsA, documentoB, dto(AlterarDocumentoDto, {}))));
    const [r] = await banco.sqlSuperusuario<{ validado: boolean }>('select validado from public.documentos where id = $1::uuid', [documentoB]);
    assert.equal(r.validado, false);
  });
});

describe('cota de IA (caminho privilegiado)', () => {
  const contador = async () => contar(
    `select coalesce(sum(used_quantity), 0)::int as n from public.usage_counters where corretor_id = $1::uuid and feature_key = 'ai_contracts_monthly'`,
    [banco.corretorA]);

  test('reservar fora do TenantDb funciona e finalizar(false) devolve 1 ao contador', async () => {
    const antes = await contador();
    const cota = await reservarCota(banco.prisma as unknown as ClienteCota, banco.corretorA);
    assert.equal(cota.allowed, true);
    assert.match(cota.reservation_id!, UUID);
    assert.equal(cota.quota, 5);
    assert.equal(await contador(), antes + 1);
    assert.equal(await finalizarCota(banco.prisma as unknown as ClienteCota, cota.reservation_id!, false), 1);
    assert.equal(await contador(), antes);
  });

  test('a mesma chamada dentro do TenantDb falha com 42501 (D16)', async () => {
    await assert.rejects(
      banco.db.run(banco.claimsA, (tx) => reservarCota(tx as unknown as ClienteCota, banco.corretorA)),
      (e: unknown) => {
        assert.equal(erroPg(e)?.sqlstate, '42501');
        return true;
      },
    );
  });

  test('gerar pelo service: sucesso consome 1 da cota; conta sem plano → 402 sem chamar o fetch', async () => {
    const anterior = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'chave-de-teste';
    try {
      const ia = new ContratosIaService(banco.db, banco.prisma as unknown as PrismaService);
      let chamadas = 0;
      ia.fetchImpl = async () => {
        chamadas += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'MINUTA PARA REVISÃO JURÍDICA' } }] }), { status: 200 });
      };
      const corpo = { tipo: 'Locação', cliente: { nome: 'Ana' }, imovel: { endereco: 'Rua 1' }, detalhes: { valor: 1500 } };
      const antes = await contador();
      const r = await ia.gerar(banco.claimsA, corpo as never);
      assert.equal(r.contrato, 'MINUTA PARA REVISÃO JURÍDICA');
      assert.equal(await contador(), antes + 1);
      const [res] = await banco.sqlSuperusuario<{ n: number }>(
        `select count(*)::int as n from public.contract_quota_reservations where corretor_id = $1::uuid and status = 'succeeded'`, [banco.corretorA]);
      assert.equal(res.n, 1);

      const erro = await capturarErroHttp(ia.gerar(banco.claimsB, corpo as never));
      assert.equal(erro.status, 402);
      assert.equal(erro.corpo.recurso, 'ai_contracts_monthly');
      assert.equal(chamadas, 1);
    } finally {
      if (anterior === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = anterior;
    }
  });
});
