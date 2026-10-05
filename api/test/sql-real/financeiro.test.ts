// SQL real do módulo financeiro (contrato 2026-10-05 §3.2) contra um Postgres de verdade: PGlite com todas as
// migrations, RLS ligado, o TenantDb de produção e o ServicoDb (set local role service_role).
// O Asaas é sempre um fetch falso que registra as chamadas: nenhum teste toca rede.
// A chave da cifra é gerada aqui e posta em process.env só durante o arquivo.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AsaasCobrancaService } from '../../src/financeiro/asaas/asaas-cobranca.service';
import { AsaasConexaoService } from '../../src/financeiro/asaas/asaas-conexao.service';
import { cifrar } from '../../src/financeiro/asaas/asaas-crypto';
import { AsaasFila } from '../../src/financeiro/asaas/asaas-fila';
import { AsaasWebhookService } from '../../src/financeiro/asaas/asaas-webhook.service';
import { FaturasService } from '../../src/financeiro/faturas.service';
import {
  AcaoAsaasDto, AlterarLancamentoDto, BaixaDto, ConectarAsaasDto, CriarFaturaDto, CriarLancamentoDto, FiltroLancamentosDto, VencimentoDto,
} from '../../src/financeiro/financeiro.dto';
import { traduzirErroBanco } from '../../src/financeiro/financeiro.erros';
import { LancamentosService } from '../../src/financeiro/lancamentos.service';
import { RepassesService } from '../../src/financeiro/repasses.service';
import { ServicoDb } from '../../src/financeiro/servico-db';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { type BancoTeste, capturarErroHttp, criarBanco, USUARIO_A } from './harness';

type Linha = Record<string, unknown>;

let banco: BancoTeste;
let servicoDb: ServicoDb;
let lancamentos: LancamentosService;
let faturas: FaturasService;
let repasses: RepassesService;
let cobranca: AsaasCobrancaService;
let conexao: AsaasConexaoService;
let webhook: AsaasWebhookService;
const agendados: string[] = [];

const CHAVE = randomBytes(32).toString('hex');
const VARS = ['ASAAS_TOKEN_ENCRYPTION_KEY', 'ASAAS_WEBHOOK_URL_BASE', 'ASAAS_BASE_URL', 'ASAAS_API_KEY'] as const;
const envAntes: Record<string, string | undefined> = {};

const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const INEXISTENTE = '99999999-9999-4999-8999-999999999999';
const TOKEN_WEBHOOK_A = 'token-do-webhook-da-conta-a-0123456789';
const SLUG_A = 'slug-da-conta-a';
const CHAVE_API_A = '$aact_chave_da_conta_a_para_teste_0001';

// ---------------------------------------------------------------- fetch falso do Asaas

interface Chamada { metodo: string; url: string; corpo: unknown; cabecalhos: Record<string, string> }
type Rota = [metodo: string, caminho: RegExp, status: number, corpo: unknown];

function fetchFalso(rotas: Rota[] = []) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    chamadas.push({
      metodo, url: String(url), corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
      cabecalhos: (init?.headers ?? {}) as Record<string, string>,
    });
    const caminho = String(url).replace(/^https:\/\/api(-sandbox)?\.asaas\.com\/v3/, '');
    const rota = rotas.find(([m, re]) => m === metodo && re.test(caminho));
    if (!rota) return new Response(JSON.stringify({ errors: [{ description: `rota não prevista: ${metodo} ${caminho}` }] }), { status: 500 });
    return new Response(JSON.stringify(rota[3]), { status: rota[2] });
  }) as unknown as typeof fetch;
  return { f, chamadas };
}

function montarAsaas(rotas: Rota[] = []) {
  const falso = fetchFalso(rotas);
  const c = new AsaasCobrancaService(banco.db, servicoDb, falso.f);
  c.agora = () => new Date('2026-10-05T15:00:00Z');
  return { cobranca: c, conexao: new AsaasConexaoService(banco.db, servicoDb, falso.f), chamadas: falso.chamadas };
}

// ---------------------------------------------------------------- utilidades

const OPCOES_PIPE = { whitelist: true, forbidNonWhitelisted: true };
function dto<T extends object>(Classe: new () => T, corpo: Record<string, unknown>): T {
  const instancia = plainToInstance(Classe, corpo);
  assert.deepEqual(validateSync(instancia, OPCOES_PIPE).map((e) => e.property), [], 'o ValidationPipe deveria aceitar este corpo');
  return instancia;
}

async function falha(promessa: Promise<unknown>, status: number, codigo: string): Promise<Record<string, unknown>> {
  const r = await capturarErroHttp(promessa);
  assert.equal(r.status, status, JSON.stringify(r.corpo));
  assert.equal(r.corpo.codigo, codigo);
  return r.corpo;
}

const umaLinha = async <T = Linha>(sql: string, params: unknown[] = []): Promise<T> => (await banco.sqlSuperusuario<T>(sql, params))[0];
const fatura = (id: string) => umaLinha<Linha>(`select to_jsonb(f) as l from public.faturas_aluguel f where id = $1::uuid`, [id]).then((r) => (r as { l: Linha })?.l);

let clienteA: string;
let imovelA: string;
let contratoA: string;
let contratoB: string;
let faturaB: string;
let repasseB: string;
let lancamentoB: string;

async function novaFatura(corretor: string, contrato: string, cliente: string, imovel: string, mes: string, extra: Record<string, unknown> = {}): Promise<string> {
  return (await banco.inserir('faturas_aluguel', {
    contrato_id: contrato, cliente_id: cliente, imovel_id: imovel, corretor_id: corretor, mes_referencia: mes,
    data_vencimento: '2099-01-10', valor_aluguel: 2000, valor_condominio: 300.5, ...extra,
  })).id as string;
}

before(async () => {
  for (const v of VARS) envAntes[v] = process.env[v];
  process.env.ASAAS_TOKEN_ENCRYPTION_KEY = CHAVE;
  process.env.ASAAS_WEBHOOK_URL_BASE = 'https://api.lotti.teste/';
  delete process.env.ASAAS_BASE_URL;
  process.env.ASAAS_API_KEY = 'chave-global-que-nao-pode-ser-usada-000000';

  banco = await criarBanco();
  servicoDb = new ServicoDb(banco.prisma as unknown as PrismaService);
  lancamentos = new LancamentosService(banco.db);
  faturas = new FaturasService(banco.db);
  repasses = new RepassesService(banco.db);
  ({ cobranca, conexao } = montarAsaas());
  webhook = new AsaasWebhookService(servicoDb);
  webhook.agendar = (id) => { agendados.push(id); };

  clienteA = (await banco.inserir('clientes', {
    corretor_id: banco.corretorA, nome: 'Inquilina A', telefone: '(62) 98123-4567', cpf: '123.456.789-09', email: 'inquilina@teste.local',
  })).id as string;
  const clienteB = (await banco.inserir('clientes', { corretor_id: banco.corretorB, nome: 'Inquilino B', telefone: '62981234568' })).id as string;
  imovelA = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorA, titulo: 'Apto da A', tipo: 'APARTAMENTO', valor: 350000, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono A',
  })).id as string;
  const imovelB = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorB, titulo: 'Casa do B', tipo: 'CASA', valor: 500000, endereco: 'Rua 2', cidade: 'Anápolis', proprietario_nome: 'Dona B', anunciado: false,
  }, { semGatilhos: true })).id as string;
  const contrato = (corretor: string, cliente: string, imovel: string, valor: number) => banco.inserir('contratos', {
    corretor_id: corretor, cliente_id: cliente, imovel_id: imovel, tipo: 'LOCACAO_RESIDENCIAL', valor, data_inicio: '2026-01-01',
    conteudo: 'contrato', status: 'ATIVO', dia_vencimento: 10, dia_repasse_proprietario: 15, taxa_administracao_percentual: 10,
  }, { semGatilhos: true }).then((l) => l.id as string);
  contratoA = await contrato(banco.corretorA, clienteA, imovelA, 2000);
  contratoB = await contrato(banco.corretorB, clienteB, imovelB, 3000);
  faturaB = await novaFatura(banco.corretorB, contratoB, clienteB, imovelB, '01/2026');
  repasseB = (await banco.inserir('repasses_proprietario', {
    contrato_id: contratoB, corretor_id: banco.corretorB, proprietario_nome: 'Dona B', data_prevista: '2026-02-15',
    valor_bruto_recebido: 3000, valor_taxa_adm: 300, valor_liquido_repasse: 2700,
  })).id as string;
  lancamentoB = (await banco.inserir('lancamentos_financeiros', {
    corretor_id: banco.corretorB, tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'Do B', valor: 10, data: '2026-03-01',
  })).id as string;

  // Conexão Asaas da conta A, como a Edge grava (salvar_conexao_asaas só pelo service_role).
  await servicoDb.run((tx) => tx.$queryRaw(Prisma.sql`
    select public.salvar_conexao_asaas(${banco.corretorA}::uuid, 'sandbox', 'conectada', 'Conta A', 'a@teste.local', null, '0001',
      ${[]}::text[], 'wh_a', ${SLUG_A}::text, ${cifrar(CHAVE_API_A, CHAVE)}::text, ${cifrar(TOKEN_WEBHOOK_A, CHAVE)}::text)::text as id`));
});

after(async () => {
  try {
    if (banco) assert.equal(banco.transacoes.commitsAbortados, 0, 'nenhum run pode terminar com a transação abortada');
  } finally {
    await banco?.fechar();
    for (const v of VARS) {
      if (envAntes[v] === undefined) delete process.env[v];
      else process.env[v] = envAntes[v];
    }
  }
});

// ---------------------------------------------------------------- lançamentos

describe('lançamentos', () => {
  test('POST na baseline (D1): descarta status/impacta_dre/data_competencia e grava a linha', async () => {
    const r = await lancamentos.criar(banco.claimsA, dto(CriarLancamentoDto, {
      tipo: 'DESPESA', categoria: 'MARKETING', descricao: 'Anúncio', valor: 150.75, data: '2026-03-10',
      data_competencia: '2026-03-01', status: 'pendente', impacta_dre: false, imovel_id: imovelA,
    }));
    assert.equal(r.length, 1);
    const l = r[0];
    assert.equal(l.corretor_id, banco.corretorA);
    assert.equal(l.valor, 150.75);
    assert.equal(l.recorrente, false);
    assert.equal(l.imovel_id, imovelA);
    assert.match(String(l.data), /^2026-03-10T00:00:00\+00:00$/);
    assert.equal('status' in l, false);
    assert.equal('impacta_dre' in l, false);
  });

  test('POST recorrente grava 12 linhas na ordem, com (n/12) e fim de mês ajustado', async () => {
    const r = await lancamentos.criar(banco.claimsA, dto(CriarLancamentoDto, {
      tipo: 'RECEITA', categoria: 'ALUGUEL', descricao: 'Aluguel sala', valor: 1000, data: '2026-01-31', recorrente: true,
    }));
    assert.equal(r.length, 12);
    assert.deepEqual(r.map((l) => String(l.data).slice(0, 10)).slice(0, 3), ['2026-01-31', '2026-02-28', '2026-03-31']);
    assert.equal(r[0].descricao, 'Aluguel sala');
    assert.equal(r[1].descricao, 'Aluguel sala (2/12)');
    assert.equal(r[11].descricao, 'Aluguel sala (12/12)');
    assert.ok(r.every((l) => l.recorrente === true));
  });

  test('GET filtra por tipo, categoria e período, só da conta, por data desc', async () => {
    const todos = await lancamentos.listar(banco.claimsA, dto(FiltroLancamentosDto, {}));
    assert.ok(todos.length >= 13);
    assert.ok(todos.every((l) => l.corretor_id === banco.corretorA));
    assert.ok(!todos.some((l) => l.id === lancamentoB));
    const datas = todos.map((l) => String(l.data));
    assert.deepEqual([...datas].sort().reverse(), datas);
    const filtrados = await lancamentos.listar(banco.claimsA, dto(FiltroLancamentosDto, { tipo: 'RECEITA', categoria: 'ALUGUEL', de: '2026-02-01', ate: '2026-03-31' }));
    assert.deepEqual(filtrados.map((l) => String(l.data).slice(0, 10)), ['2026-03-31', '2026-02-28']);
    const doB = await lancamentos.listar(banco.claimsB, dto(FiltroLancamentosDto, {}));
    assert.deepEqual(doB.map((l) => l.id), [lancamentoB]);
  });

  test('PATCH altera da conta; alheio ou inexistente → 404; vazio → 400', async () => {
    const [l] = await lancamentos.criar(banco.claimsA, dto(CriarLancamentoDto, {
      tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'Editar', valor: 1, data: '2026-04-01',
    }));
    const r = await lancamentos.alterar(banco.claimsA, String(l.id), dto(AlterarLancamentoDto, { descricao: 'Editado', valor: 2.5 }));
    assert.equal(r.descricao, 'Editado');
    assert.equal(r.valor, 2.5);
    await falha(lancamentos.alterar(banco.claimsA, lancamentoB, dto(AlterarLancamentoDto, { descricao: 'x' })), 404, 'lancamento_nao_encontrado');
    await falha(lancamentos.alterar(banco.claimsA, INEXISTENTE, dto(AlterarLancamentoDto, { descricao: 'x' })), 404, 'lancamento_nao_encontrado');
    await falha(lancamentos.alterar(banco.claimsA, String(l.id), dto(AlterarLancamentoDto, {})), 400, 'nada_para_atualizar');

    await lancamentos.excluir(banco.claimsA, String(l.id));
    assert.equal(await umaLinha(`select 1 from public.lancamentos_financeiros where id = $1::uuid`, [l.id]), undefined);
    // DELETE do lançamento de B pela conta A: 204 sem efeito.
    await lancamentos.excluir(banco.claimsA, lancamentoB);
    assert.ok(await umaLinha(`select 1 from public.lancamentos_financeiros where id = $1::uuid`, [lancamentoB]));
  });

  test('referência inexistente → 422 referencia_invalida', async () => {
    await falha(lancamentos.criar(banco.claimsA, dto(CriarLancamentoDto, {
      tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'x', valor: 1, data: '2026-04-01', contrato_id: INEXISTENTE,
    })), 422, 'referencia_invalida');
  });
});

// ---------------------------------------------------------------- faturas

describe('faturas', () => {
  let faturaA: string;

  test('ensureFatura: cria uma vez e depois devolve a mesma com criada:false; contrato alheio/inexistente → 404', async () => {
    const corpo = { contrato_id: contratoA, mes_referencia: '02/2026', data_vencimento: '2099-02-10' };
    const r1 = await faturas.garantirFatura(banco.claimsA, dto(CriarFaturaDto, corpo));
    const r2 = await faturas.garantirFatura(banco.claimsA, dto(CriarFaturaDto, corpo));
    assert.equal(r1.criada, true);
    assert.deepEqual(r2, { id: r1.id, criada: false });
    faturaA = r1.id;
    const f = await fatura(faturaA);
    assert.equal(f.valor_aluguel, 2000);
    assert.equal(f.status, 'PENDENTE');
    assert.equal(f.gerada_por, 'manual');
    await falha(faturas.garantirFatura(banco.claimsA, dto(CriarFaturaDto, { ...corpo, contrato_id: INEXISTENTE })), 404, 'contrato_nao_encontrado');
    await falha(faturas.garantirFatura(banco.claimsA, dto(CriarFaturaDto, { ...corpo, contrato_id: contratoB })), 404, 'contrato_nao_encontrado');
  });

  test('GET faturas no formato do PostgREST e isolado entre A e B', async () => {
    const lista = await faturas.listarFaturas(banco.claimsA);
    assert.ok(lista.length >= 1);
    assert.ok(!lista.some((f) => f.id === faturaB));
    const f = lista.find((x) => x.id === faturaA)!;
    assert.equal(typeof f.valor_total, 'number');
    assert.equal(f.valor_total, 2000);
    assert.match(String(f.data_vencimento), DATA);
    assert.match(String(f.created_at), TIMESTAMPTZ);
    assert.equal(f.mes_referencia, '02/2026');
    assert.deepEqual((await faturas.listarFaturas(banco.claimsB)).map((x) => x.id), [faturaB]);
  });

  test('contratos ativos com embeds e resumo da locação, por conta', async () => {
    const ativos = await faturas.contratosAtivos(banco.claimsA);
    assert.deepEqual(ativos.map((c) => c.id), [contratoA]);
    assert.deepEqual(ativos[0].imoveis, { titulo: 'Apto da A', endereco: 'Rua 1', proprietario_nome: 'Dono A' });
    assert.deepEqual(ativos[0].clientes, { nome: 'Inquilina A' });
    assert.deepEqual(await faturas.resumoLocacao(banco.claimsA), { contratos_ativos: 1, soma_valor: 2000 });
    assert.deepEqual(await faturas.resumoLocacao(banco.claimsB), { contratos_ativos: 1, soma_valor: 3000 });
  });

  test('vencimento, cancelar e reativar: da conta; alheia → 404', async () => {
    const v = await faturas.alterarVencimento(banco.claimsA, faturaA, dto(VencimentoDto, { data_vencimento: '2099-03-01' }));
    assert.equal(v.data_vencimento, '2099-03-01');
    await falha(faturas.alterarVencimento(banco.claimsA, faturaB, dto(VencimentoDto, { data_vencimento: '2099-03-01' })), 404, 'fatura_nao_encontrada');
    await banco.sqlSuperusuario(`update public.faturas_aluguel set external_id = 'pay_x', boleto_url = 'b' where id = $1::uuid`, [faturaA]);
    assert.equal((await faturas.cancelar(banco.claimsA, faturaA)).status, 'CANCELADO');
    await falha(faturas.darBaixa(banco.claimsA, faturaA, dto(BaixaDto, { data_pagamento: '2026-10-05' })), 409, 'fatura_cancelada');
    const r = await faturas.reativar(banco.claimsA, faturaA);
    assert.equal(r.status, 'PENDENTE');
    assert.equal(r.external_id, null);
    assert.equal(r.boleto_url, null);
    await falha(faturas.cancelar(banco.claimsA, faturaB), 404, 'fatura_nao_encontrada');
    await falha(faturas.reativar(banco.claimsA, faturaB), 404, 'fatura_nao_encontrada');
    assert.equal((await fatura(faturaB)).status, 'PENDENTE');
  });

  test('baixa dispara o gatilho (repasse, comissão e auditoria com o ator A) e não duplica', async () => {
    const r = await faturas.darBaixa(banco.claimsA, faturaA, dto(BaixaDto, { data_pagamento: '2026-10-05' }));
    assert.equal(r.status, 'PAGO');
    assert.equal(r.valor_pago, 2000);
    assert.equal(r.data_pagamento, '2026-10-05');
    await faturas.darBaixa(banco.claimsA, faturaA, dto(BaixaDto, { data_pagamento: '2026-10-06' }));
    const reps = await banco.sqlSuperusuario<{ status: string }>(`select status from public.repasses_proprietario where fatura_origem_id = $1::uuid`, [faturaA]);
    assert.deepEqual(reps.map((x) => x.status), ['AGENDADO']);
    const com = await banco.sqlSuperusuario(`select 1 from public.lancamentos_financeiros where fatura_id = $1::uuid and categoria = 'COMISSAO_LOCACAO'`, [faturaA]);
    assert.equal(com.length, 1);
    const aud = await banco.sqlSuperusuario<{ ator: string }>(`select ator from public.auditoria_financeira where entidade_id = $1::uuid and acao = 'PAGO'`, [faturaA]);
    assert.deepEqual(aud.map((x) => x.ator), [USUARIO_A]);
    await falha(faturas.darBaixa(banco.claimsA, faturaB, dto(BaixaDto, { data_pagamento: '2026-10-05' })), 404, 'fatura_nao_encontrada');
  });

  test('estorno volta a fatura e remove repasse e comissão; não paga → 409; alheia → 404', async () => {
    assert.deepEqual(await faturas.estornar(banco.claimsA, faturaA), { status: 'PENDENTE' });
    const f = await fatura(faturaA);
    assert.equal(f.status, 'PENDENTE');
    assert.equal(f.valor_pago, null);
    assert.equal((await banco.sqlSuperusuario(`select 1 from public.repasses_proprietario where fatura_origem_id = $1::uuid`, [faturaA])).length, 0);
    assert.equal((await banco.sqlSuperusuario(`select 1 from public.lancamentos_financeiros where fatura_id = $1::uuid`, [faturaA])).length, 0);
    const c = await falha(faturas.estornar(banco.claimsA, faturaA), 409, 'fatura_nao_paga');
    assert.equal(c.message, 'Só é possível desfazer o pagamento de faturas pagas.');
    await falha(faturas.estornar(banco.claimsA, faturaB), 404, 'fatura_nao_encontrada');
  });
});

// ---------------------------------------------------------------- repasses

describe('repasses', () => {
  test('lista com o título do imóvel, isolada; confirmar grava data_transferencia; alheio → 404', async () => {
    const doB = await repasses.listar(banco.claimsB);
    assert.deepEqual(doB.map((r) => r.id), [repasseB]);
    assert.deepEqual(doB[0].contratos, { imoveis: { titulo: 'Casa do B' } });
    assert.ok(!(await repasses.listar(banco.claimsA)).some((r) => r.id === repasseB));
    await falha(repasses.confirmar(banco.claimsA, repasseB), 404, 'repasse_nao_encontrado');
    const r = await repasses.confirmar(banco.claimsB, repasseB);
    assert.equal(r.status, 'CONFIRMADO');
    assert.match(String(r.data_transferencia), DATA);
  });
});

// ---------------------------------------------------------------- ServicoDb e conexão

describe('ServicoDb e conexão Asaas', () => {
  test('ServicoDb grava auditoria e lê segredos; o TenantDb da conta A não lê segredos (403)', async () => {
    await servicoDb.run((tx) => tx.$executeRaw(Prisma.sql`
      insert into public.auditoria_financeira (corretor_id, entidade, entidade_id, acao, origem, ator)
      values (${banco.corretorA}::uuid, 'teste', ${INEXISTENTE}::uuid, 'SERVICO', 'ui', 'teste')`));
    assert.ok(await umaLinha(`select 1 from public.auditoria_financeira where acao = 'SERVICO'`));
    const segredos = await servicoDb.run((tx) => tx.$queryRaw<unknown[]>(Prisma.sql`select api_key_ciphertext from public.asaas_conexao_segredos`));
    assert.ok(segredos.length >= 1);
    await falha((async () => {
      try {
        await banco.db.run(banco.claimsA, (tx) => tx.$queryRaw(Prisma.sql`select api_key_ciphertext from public.asaas_conexao_segredos`));
      } catch (e) {
        traduzirErroBanco(e);
      }
    })(), 403, 'sem_permissao');
  });

  test('GET conexão: A vê a sua, sem segredo; B vê null', async () => {
    const a = await conexao.status(banco.claimsA);
    assert.equal(a.disponivel, true);
    assert.equal(a.conexao?.ambiente, 'sandbox');
    assert.equal(a.conexao?.chave_final, '0001');
    assert.deepEqual(a.conexao?.escopos_faltando, []);
    assert.match(String(a.conexao?.validada_em), TIMESTAMPTZ);
    assert.equal(JSON.stringify(a).includes('v1.'), false);
    assert.deepEqual(await conexao.status(banco.claimsB), { disponivel: true, conexao: null });
  });

  test('conectar e desconectar a conta B pelo fetch falso, com URL do webhook da API', async () => {
    const { conexao: c, chamadas } = montarAsaas([
      ['GET', /^\/myAccount\/commercialInfo\/$/, 200, { companyName: 'B Ltda', email: 'b@teste.local', cpfCnpj: '11222333000181' }],
      ['GET', /^\/customers\?limit=1$/, 200, { data: [] }],
      ['GET', /^\/payments\?limit=1$/, 200, { data: [] }],
      ['GET', /^\/finance\/balance$/, 403, { errors: [{ description: 'sem permissão' }] }],
      ['GET', /^\/webhooks\?limit=100$/, 200, { data: [] }],
      ['POST', /^\/webhooks$/, 200, { id: 'wh_b' }],
      ['DELETE', /^\/webhooks\/wh_b$/, 200, { deleted: true }],
    ]);
    const r = await c.conectar(banco.claimsB, dto(ConectarAsaasDto, { api_key: '$aact_chave_da_conta_b_para_teste_0002', ambiente: 'producao' })) as Record<string, any>;
    assert.equal(r.ok, true);
    assert.equal(r.balance, null);
    assert.equal(r.conexao.status, 'sem_permissao');
    assert.deepEqual(r.conexao.escopos_faltando, ['FINANCIAL_TRANSACTION:READ']);
    assert.equal(r.conexao.chave_final, '0002');
    const webhookCriado = chamadas.find((x) => x.metodo === 'POST')!;
    assert.match(String((webhookCriado.corpo as Record<string, unknown>).url), /^https:\/\/api\.lotti\.teste\/api\/financeiro\/asaas\/webhook\?t=[\w-]+$/);
    const salva = await umaLinha<{ corretor_id: string; webhook_id: string }>(
      `select corretor_id::text, webhook_id from public.asaas_conexoes where id = $1::uuid`, [r.conexao.id]);
    assert.deepEqual(salva, { corretor_id: banco.corretorB, webhook_id: 'wh_b' });
    assert.equal((await conexao.status(banco.claimsB)).conexao?.status, 'sem_permissao');

    assert.deepEqual(await c.desconectar(banco.claimsB), { ok: true, aviso: null });
    assert.equal(chamadas.at(-1)?.metodo, 'DELETE');
    assert.equal(await umaLinha(`select 1 from public.asaas_conexoes where corretor_id = $1::uuid`, [banco.corretorB]), undefined);
    assert.equal(await umaLinha(`select 1 from public.asaas_conexao_segredos where conexao_id = $1::uuid`, [r.conexao.id]), undefined);
  });
});

// ---------------------------------------------------------------- ações Asaas

describe('ações Asaas', () => {
  test('A sobre a fatura de B → 404 sem nenhuma chamada ao Asaas', async () => {
    const { cobranca: c, chamadas } = montarAsaas();
    await falha(c.acao(banco.claimsA, faturaB, dto(AcaoAsaasDto, { acao: 'emitir_cobranca' })), 404, 'fatura_nao_encontrada');
    assert.equal(chamadas.length, 0);
  });

  test('receber em dinheiro sem cobrança não fala com o Asaas; B sem conexão → saldo 409', async () => {
    const faturaSem = await novaFatura(banco.corretorA, contratoA, clienteA, imovelA, '03/2026');
    const { cobranca: c, chamadas } = montarAsaas();
    assert.deepEqual(await c.acao(banco.claimsA, faturaSem, dto(AcaoAsaasDto, { acao: 'receber_em_dinheiro' })), { ok: true, sem_cobranca: true, avisos: [] });
    assert.equal(chamadas.length, 0);
    const corpo = await falha(c.saldo(banco.claimsB), 409, 'ASAAS_NAO_CONECTADO');
    assert.equal(corpo.nao_conectado, true);
  });

  test('emitir grava cliente, fatura e auditoria; emitir de novo é idempotente; excluir cancela', async () => {
    const faturaE = await novaFatura(banco.corretorA, contratoA, clienteA, imovelA, '04/2026');
    const { cobranca: c, chamadas } = montarAsaas([
      ['GET', /^\/customers\?cpfCnpj=12345678909$/, 200, { data: [] }],
      ['POST', /^\/customers$/, 200, { id: 'cus_a' }],
      ['PUT', /^\/customers\/cus_a$/, 200, { id: 'cus_a' }],
      ['GET', /^\/payments\?externalReference=/, 200, { data: [] }],
      ['POST', /^\/payments$/, 200, { id: 'pay_e1', status: 'PENDING', bankSlipUrl: 'https://boleto/e1', value: 2300.5 }],
      ['GET', /^\/payments\/pay_e1\/pixQrCode$/, 200, { payload: 'pix-e1' }],
      ['GET', /^\/payments\/pay_e1$/, 200, { status: 'PENDING' }],
      ['DELETE', /^\/payments\/pay_e1$/, 200, { deleted: true }],
      ['GET', /^\/finance\/balance$/, 200, { balance: 123.45 }],
    ]);
    const r = await c.acao(banco.claimsA, faturaE, dto(AcaoAsaasDto, { acao: 'emitir_cobranca' }));
    assert.deepEqual(r, { ok: true, external_id: 'pay_e1', boleto_url: 'https://boleto/e1', pix: 'pix-e1', status: 'PENDING', avisos: [] });
    assert.ok(chamadas.every((x) => x.cabecalhos.access_token === CHAVE_API_A));
    assert.ok(chamadas.every((x) => x.url.startsWith('https://api-sandbox.asaas.com/v3')));
    const f = await fatura(faturaE);
    assert.equal(f.external_id, 'pay_e1');
    assert.equal(f.pix_qrcode_text, 'pix-e1');
    assert.equal(f.asaas_status, 'PENDING');
    assert.equal(f.data_vencimento, '2099-01-10');
    const cli = await umaLinha<{ asaas_customer_id: string }>(`select asaas_customer_id from public.clientes where id = $1::uuid`, [clienteA]);
    assert.equal(cli.asaas_customer_id, 'cus_a');
    const aud = await umaLinha<{ ator: string; origem: string }>(
      `select ator, origem from public.auditoria_financeira where entidade_id = $1::uuid and acao = 'COBRANCA_EMITIDA'`, [faturaE]);
    assert.deepEqual(aud, { ator: USUARIO_A, origem: 'ui' });

    const antes = chamadas.length;
    const de2 = await c.acao(banco.claimsA, faturaE, dto(AcaoAsaasDto, { acao: 'emitir_cobranca' }));
    assert.equal(de2.already, true);
    assert.equal(chamadas.length, antes);

    assert.deepEqual(await c.saldo(banco.claimsA), { balance: 123.45 });

    assert.deepEqual(await c.acao(banco.claimsA, faturaE, dto(AcaoAsaasDto, { acao: 'excluir_cobranca' })), { ok: true, avisos: [] });
    const g = await fatura(faturaE);
    assert.equal(g.status, 'CANCELADO');
    assert.equal(g.external_id, null);
    assert.equal(g.asaas_status, 'DELETED');
    assert.ok(!chamadas.some((x) => x.url.includes('/transfers')));
  });
});

// ---------------------------------------------------------------- webhook

describe('webhook', () => {
  const cab = { 'asaas-access-token': TOKEN_WEBHOOK_A };

  test('sem slug ou com token errado → 401, sem gravar evento', async () => {
    await falha(webhook.receber(null, cab, { event: 'PAYMENT_RECEIVED' }), 401, 'webhook_recusado');
    await falha(webhook.receber(SLUG_A, { 'asaas-access-token': 'errado' }, { event: 'PAYMENT_RECEIVED' }), 401, 'webhook_recusado');
    await falha(webhook.receber('slug-que-nao-existe', cab, { event: 'PAYMENT_RECEIVED' }), 401, 'webhook_recusado');
    assert.equal((await banco.sqlSuperusuario(`select 1 from public.asaas_webhook_events`)).length, 0);
  });

  test('PAYMENT_RECEIVED de A: fatura PAGO, repasse com ator system, evento PROCESSED; reentrega → duplicate', async () => {
    const faturaW = await novaFatura(banco.corretorA, contratoA, clienteA, imovelA, '05/2026');
    const payload = {
      id: 'evt_pago_1', event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay_w1', status: 'RECEIVED', value: 2300.5, paymentDate: '2026-10-05', creditDate: '2026-10-06', externalReference: faturaW },
    };
    assert.deepEqual(await webhook.receber(SLUG_A, { 'x-hook-token': TOKEN_WEBHOOK_A }, payload), { received: true });
    const id = agendados.at(-1)!;
    const recebido = await umaLinha<{ status: string; corretor_id: string }>(`select status, corretor_id::text from public.asaas_webhook_events where id = $1::uuid`, [id]);
    assert.deepEqual(recebido, { status: 'RECEIVED', corretor_id: banco.corretorA });
    await webhook.processar(id);

    const f = await fatura(faturaW);
    assert.equal(f.status, 'PAGO');
    assert.equal(f.valor_pago, 2300.5);
    assert.equal(f.data_credito, '2026-10-06');
    const rep = await banco.sqlSuperusuario(`select 1 from public.repasses_proprietario where fatura_origem_id = $1::uuid and status = 'AGENDADO'`, [faturaW]);
    assert.equal(rep.length, 1);
    const aud = await umaLinha<{ ator: string }>(`select ator from public.auditoria_financeira where entidade_id = $1::uuid and acao = 'PAGO'`, [faturaW]);
    assert.equal(aud.ator, 'system');
    const ev = await umaLinha<{ status: string; attempts: number; payment_id: string }>(
      `select status, attempts, payment_id from public.asaas_webhook_events where id = $1::uuid`, [id]);
    assert.deepEqual(ev, { status: 'PROCESSED', attempts: 1, payment_id: 'pay_w1' });
    // Na baseline registrar_alerta_financeiro falha (alertas não tem a coluna prioridade): o alerta vai num run
    // separado e a falha não muda o desfecho do evento, como na Edge (que ignorava o erro do rpc).
    const alerta = await banco.sqlSuperusuario(`select 1 from public.alertas where entidade_id = $1::uuid`, [faturaW]);
    assert.equal(alerta.length, 0);

    // Reserva condicional: processar de novo não faz nada.
    await webhook.processar(id);
    assert.equal((await umaLinha<{ attempts: number }>(`select attempts from public.asaas_webhook_events where id = $1::uuid`, [id])).attempts, 1);

    assert.deepEqual(await webhook.receber(SLUG_A, cab, payload), { received: true, duplicate: true });
  });

  test('evento pelo slug de A apontando a fatura de B → FAILED, fatura de B intacta', async () => {
    const payload = { id: 'evt_alheio', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_b1', status: 'RECEIVED', value: 3000, externalReference: faturaB } };
    await webhook.receber(SLUG_A, cab, payload);
    const id = agendados.at(-1)!;
    await webhook.processar(id);
    const ev = await umaLinha<{ status: string; last_error: string }>(`select status, last_error from public.asaas_webhook_events where id = $1::uuid`, [id]);
    assert.deepEqual(ev, { status: 'FAILED', last_error: 'fatura_nao_encontrada' });
    assert.equal((await fatura(faturaB)).status, 'PENDENTE');
  });

  test('fila reprocessa o FAILED (até 5 tentativas) pela mesma reserva', async () => {
    const fila = new AsaasFila(servicoDb, webhook);
    assert.ok(await fila.volta() >= 1);
    const ev = await umaLinha<{ status: string; attempts: number }>(`select status, attempts from public.asaas_webhook_events where event_id = 'evt_alheio'`);
    assert.deepEqual(ev, { status: 'FAILED', attempts: 2 });
  });

  test('TRANSFER_DONE concilia pelo external_id e confirma o repasse de A; em trânsito só registra o estado', async () => {
    const rep = (await banco.inserir('repasses_proprietario', {
      contrato_id: contratoA, corretor_id: banco.corretorA, proprietario_nome: 'Dono A', data_prevista: '2026-11-15',
      valor_bruto_recebido: 2000, valor_taxa_adm: 200, valor_liquido_repasse: 1800, external_id: 'tr_1',
    })).id as string;
    await webhook.receber(SLUG_A, cab, { id: 'evt_tr_pend', event: 'TRANSFER_PENDING', transfer: { id: 'tr_1', status: 'PENDING' } });
    await webhook.processar(agendados.at(-1)!);
    assert.equal((await umaLinha<{ transferencia_status: string }>(
      `select transferencia_status from public.repasses_proprietario where id = $1::uuid`, [rep])).transferencia_status, 'PENDING');

    await webhook.receber(SLUG_A, cab, { id: 'evt_tr_done', event: 'TRANSFER_DONE', transfer: { id: 'tr_1', status: 'DONE', value: 1800, effectiveDate: '2026-10-05' } });
    const id = agendados.at(-1)!;
    await webhook.processar(id);
    const r = await umaLinha<{ status: string; data_transferencia: Date; conciliacao_pendente: string | null }>(
      `select status, data_transferencia, conciliacao_pendente from public.repasses_proprietario where id = $1::uuid`, [rep]);
    assert.equal(r.status, 'CONFIRMADO');
    assert.equal(r.data_transferencia.toISOString().slice(0, 10), '2026-10-05');
    const aud = await umaLinha<{ ator: string }>(`select ator from public.auditoria_financeira where entidade_id = $1::uuid and acao = 'TRANSFERENCIA_CONFIRMADA'`, [rep]);
    assert.equal(aud.ator, 'asaas');
    const ev = await umaLinha<{ status: string }>(`select status from public.asaas_webhook_events where id = $1::uuid`, [id]);
    assert.equal(ev.status, 'PROCESSED');
  });
});
