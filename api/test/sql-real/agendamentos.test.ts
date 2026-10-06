// Bloco B5 da virada com o SQL REAL (PGlite com todas as migrations): os quatro pg_cron que passam a
// rodar na API (agendamentos.config.ts) executados pelo AgendamentosRepo, como o worker do BullMQ faz.
// Confere o efeito de cada instrução, a idempotência, a trava contra execução simultânea e o fuso: a
// sessão do banco é posta num fuso em que a data local difere da data UTC, e o resultado tem de ser o
// do pg_cron do Supabase (UTC). Nenhuma rede, nenhum Redis.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Prisma } from '@prisma/client';
import { agendamentoPorNome } from '../../src/agendamentos/agendamentos.config';
import { AgendamentosRepo } from '../../src/agendamentos/agendamentos.repo';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { type BancoTeste, criarBanco } from './harness';

type Linha = Record<string, unknown>;

let banco: BancoTeste;
let repo: AgendamentosRepo;
let clienteA: string;
let imovelA: string;
const contratos: Record<string, string> = {};

const job = (nome: string) => agendamentoPorNome(nome)!;
const umaLinha = async <T = Linha>(sql: string, params: unknown[] = []): Promise<T> => (await banco.sqlSuperusuario<T>(sql, params))[0];

/** Datas em UTC, como o pg_cron do Supabase as via. */
const DIA = 86_400_000;
const dataUtc = (deslocamentoDias = 0) => new Date(Date.now() + deslocamentoDias * DIA).toISOString().slice(0, 10);
function proximoMesUtc(): { ano: number; mes: number; ref: string; ultimoDia: number } {
  const agora = new Date();
  const ano = agora.getUTCMonth() === 11 ? agora.getUTCFullYear() + 1 : agora.getUTCFullYear();
  const mes = (agora.getUTCMonth() + 1) % 12 + 1;
  return { ano, mes, ref: `${String(mes).padStart(2, '0')}/${ano}`, ultimoDia: new Date(Date.UTC(ano, mes, 0)).getUTCDate() };
}

/**
 * Um fuso em que a data local AGORA é diferente da data UTC (UTC+14 depois do meio-dia UTC, UTC-12
 * antes). Se o job não forçasse UTC, CURRENT_DATE/now() sairiam com um dia de diferença.
 */
const fusoDivergente = () => (new Date().getUTCHours() >= 12 ? 'Etc/GMT-14' : 'Etc/GMT+12');

async function contrato(tipo: string, dados: Linha): Promise<string> {
  return (await banco.inserir('contratos', {
    corretor_id: banco.corretorA, cliente_id: clienteA, imovel_id: imovelA, tipo, valor: 2500, data_inicio: '2026-01-01',
    conteudo: 'contrato', status: 'ATIVO', ...dados,
  }, { semGatilhos: true })).id as string;
}

before(async () => {
  banco = await criarBanco();
  repo = new AgendamentosRepo(banco.prisma as unknown as PrismaService);
  clienteA = (await banco.inserir('clientes', { corretor_id: banco.corretorA, nome: 'Inquilina', telefone: '62981234567' })).id as string;
  imovelA = (await banco.inserir('imoveis', {
    corretor_id: banco.corretorA, titulo: 'Apto', tipo: 'APARTAMENTO', valor: 300000, endereco: 'Rua 1', cidade: 'Anápolis', proprietario_nome: 'Dono',
  })).id as string;
  contratos.residencial = await contrato('LOCACAO_RESIDENCIAL', { dia_vencimento: 5 });
  contratos.comercial31 = await contrato('LOCACAO_COMERCIAL', { dia_vencimento: 31 });
  contratos.legado = await contrato('LOCACAO_RESIDENCIAL', { dia_vencimento: null, dia_vencimento_aluguel: 12 });
  contratos.rascunho = await contrato('LOCACAO_RESIDENCIAL', { status: 'RASCUNHO', dia_vencimento: 5 });
  contratos.venda = await contrato('COMPRA_VENDA', { dia_vencimento: 5 });
});

after(async () => {
  try {
    if (banco) assert.equal(banco.transacoes.commitsAbortados, 0, 'nenhuma execução pode terminar com a transação abortada');
  } finally {
    await banco?.fechar();
  }
});

describe('gerar-faturas-mensais (dia 25, 06:00 UTC)', () => {
  test('gera a competência do mês seguinte (UTC) para cada locação ATIVA, uma vez só', async () => {
    const fuso = fusoDivergente();
    await banco.sqlSuperusuario(`set timezone to '${fuso}'`);
    try {
      const prox = proximoMesUtc();
      assert.deepEqual(await repo.executar(job('gerar-faturas-mensais')), { executou: true, resultado: 3 });
      const faturas = await banco.sqlSuperusuario<{ contrato: string; mes: string; venc: string; valor: string; status: string; gerada_por: string }>(`
        select contrato_id::text as contrato, mes_referencia as mes, to_char(data_vencimento, 'YYYY-MM-DD') as venc,
               valor_aluguel::text as valor, status, gerada_por
          from public.faturas_aluguel order by data_vencimento, contrato_id`);
      const dia = (d: number) => `${prox.ano}-${String(prox.mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const esperado = [
        { contrato: contratos.residencial, venc: dia(5) },
        { contrato: contratos.legado, venc: dia(12) },
        // Dia 31 num mês mais curto cai no último dia do mês (fallback da função).
        { contrato: contratos.comercial31, venc: dia(Math.min(31, prox.ultimoDia)) },
      ];
      assert.deepEqual(faturas.map((f) => ({ contrato: f.contrato, venc: f.venc })), esperado);
      for (const f of faturas) assert.deepEqual([f.mes, f.valor, f.status], [prox.ref, '2500.00', 'PENDENTE']);
      // A sessão continua no fuso dela: o UTC foi local à transação do job.
      assert.equal((await umaLinha<{ tz: string }>('select current_setting(\'TimeZone\') as tz')).tz, fuso);
      // Rodar de novo (restart, job refeito) não duplica nada.
      assert.deepEqual(await repo.executar(job('gerar-faturas-mensais')), { executou: true, resultado: 0 });
      assert.equal(Number((await umaLinha<{ n: number }>('select count(*)::int as n from public.faturas_aluguel')).n), 3);
    } finally {
      await banco.sqlSuperusuario(`set timezone to 'UTC'`);
    }
  });
});

describe('marcar-faturas-atrasadas (todo dia, 07:00 UTC)', () => {
  test('PENDENTE vencida antes de hoje (UTC) vira ATRASADO; a de hoje, as pagas e as futuras ficam', async () => {
    const nova = async (mes: string, venc: string, status = 'PENDENTE') => (await banco.inserir('faturas_aluguel', {
      contrato_id: contratos.residencial, cliente_id: clienteA, imovel_id: imovelA, corretor_id: banco.corretorA, mes_referencia: mes,
      data_vencimento: venc, valor_aluguel: 2500, status,
    })).id as string;
    const ontem = await nova('01/2001', dataUtc(-1));
    const hoje = await nova('02/2001', dataUtc(0));
    const futura = await nova('03/2001', dataUtc(3));
    const paga = await nova('04/2001', dataUtc(-10), 'PAGO');
    const fuso = fusoDivergente();
    await banco.sqlSuperusuario(`set timezone to '${fuso}'`);
    try {
      const r = await repo.executar(job('marcar-faturas-atrasadas'));
      assert.equal(r.executou, true);
      const status = async (id: string) => (await umaLinha<{ s: string }>('select status as s from public.faturas_aluguel where id = $1::uuid', [id])).s;
      assert.deepEqual([await status(ontem), await status(hoje), await status(futura), await status(paga)], ['ATRASADO', 'PENDENTE', 'PENDENTE', 'PAGO']);
      assert.deepEqual(await repo.executar(job('marcar-faturas-atrasadas')), { executou: true, resultado: 0 });
    } finally {
      await banco.sqlSuperusuario(`set timezone to 'UTC'`);
    }
  });
});

describe('sweeper-webhook-events (a cada 5 min)', () => {
  test('só PROCESSING com mais de 10 minutos volta para RECEIVED', async () => {
    const evento = async (id: string, status: string, minutosAtras: number) => (await banco.inserir('asaas_webhook_events', {
      event_id: id, event_type: 'PAYMENT_RECEIVED', payload: { id }, status, received_at: new Date(Date.now() - minutosAtras * 60_000).toISOString(),
    })).id as string;
    const preso = await evento('evt_preso', 'PROCESSING', 11);
    const recente = await evento('evt_recente', 'PROCESSING', 5);
    const falho = await evento('evt_falho', 'FAILED', 60);
    const feito = await evento('evt_feito', 'PROCESSED', 60);
    assert.deepEqual(await repo.executar(job('sweeper-webhook-events')), { executou: true, resultado: 1 });
    const linhas = await banco.sqlSuperusuario<{ id: string; status: string; attempts: number }>(
      'select id::text as id, status, attempts from public.asaas_webhook_events order by received_at');
    const porId = Object.fromEntries(linhas.map((l) => [l.id, l.status]));
    assert.deepEqual([porId[preso], porId[recente], porId[falho], porId[feito]], ['RECEIVED', 'PROCESSING', 'FAILED', 'PROCESSED']);
    assert.deepEqual(await repo.executar(job('sweeper-webhook-events')), { executou: true, resultado: 0 });
  });
});

describe('trava contra execução simultânea', () => {
  // O PGlite tem uma sessão só, e trava consultiva é reentrante na mesma sessão: a disputa entre duas
  // réplicas não dá para reproduzir aqui (o caso "não pegou a trava → não roda" está no spec do repo).
  // O que se prova aqui: a trava é de TRANSAÇÃO (some no fim, mesmo quando a instrução falha) e cada
  // agendamento usa a sua chave.
  test('a trava do job é solta no fim da transação, com sucesso ou com erro', async () => {
    const travas = async () => Number((await umaLinha<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory'`)).n);
    assert.equal(await travas(), 0);
    assert.equal((await repo.executar(job('sweeper-webhook-events'))).executou, true);
    assert.equal(await travas(), 0);
    const quebrado = { ...job('sweeper-webhook-events'), sql: Prisma.sql`select 1 / 0 as n`, modo: 'valor' as const };
    await assert.rejects(repo.executar(quebrado));
    assert.equal(await travas(), 0);
  });
});

describe('gerar-alertas-vencimento (todo dia, 08:00 UTC)', () => {
  test('sem contrato na janela de aviso, roda e devolve 0', async () => {
    assert.deepEqual(await repo.executar(job('gerar-alertas-vencimento')), { executou: true, resultado: 0 });
  });

  test('com contrato na janela, cria os avisos no formato do sino e não repete (20261006190000)', async () => {
    // Antes da migration a função gravava colunas que não existem e falhava com 42703.
    // Vence em 5 dias: entram os degraus de 20, 15 e 10 dias; o de 0 ainda não.
    const id = await contrato('EXCLUSIVIDADE_VENDA', { data_fim: dataUtc(5) });
    try {
      assert.deepEqual(await repo.executar(job('gerar-alertas-vencimento')), { executou: true, resultado: 3 });
      const a = await umaLinha<{ n: number; entidade: string; prioridade: string }>(
        `select count(*)::int as n, min(entidade_tipo) as entidade, min(metadata->>'prioridade') as prioridade
           from public.alertas where entidade_id = $1::uuid`, [id]);
      assert.deepEqual({ ...a, n: Number(a.n) }, { n: 3, entidade: 'contrato', prioridade: 'ALTA' });
      assert.deepEqual(await repo.executar(job('gerar-alertas-vencimento')), { executou: true, resultado: 0 });
    } finally {
      await banco.sqlSuperusuario('delete from public.alertas where entidade_id = $1::uuid', [id]);
      await banco.sqlSuperusuario('delete from public.contratos where id = $1::uuid', [id]);
    }
  });
});
