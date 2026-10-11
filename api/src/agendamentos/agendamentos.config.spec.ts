import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getNextMillis } from 'bullmq';
import { AGENDAMENTOS, agendamentoPorNome, agendamentosLigados, FUSO_AGENDAMENTOS } from './agendamentos.config';
import { AgendamentosRepo } from './agendamentos.repo';

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const normal = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Extrai o comando de cron.schedule('<nome>', '<padrão>', $$<sql>$$) da migration do Supabase. */
function doPgCron(arquivo: string, nome: string): { padrao: string; sql: string } {
  const texto = readFileSync(join(MIGRATIONS, arquivo), 'utf8');
  const m = new RegExp(`cron\\.schedule\\('${nome}', '([^']+)',\\s*\\$\\$([\\s\\S]*?)\\$\\$\\)`).exec(texto);
  if (!m) throw new Error(`cron ${nome} não encontrado em ${arquivo}`);
  return { padrao: m[1], sql: normal(m[2]) };
}

const ORIGEM: Record<string, string> = {
  'gerar-faturas-mensais': '20260708150000_asaas_core_financeiro.sql',
  'marcar-faturas-atrasadas': '20260708150000_asaas_core_financeiro.sql',
  'sweeper-webhook-events': '20260708150000_asaas_core_financeiro.sql',
  'gerar-alertas-vencimento': '20260729120000_central_contratos.sql',
};

describe('agendamentos (pg_cron → BullMQ)', () => {
  it('um interruptor só, desligado por padrão', () => {
    expect(agendamentosLigados({})).toBe(false);
    expect(agendamentosLigados({ AGENDAMENTOS_ENABLED: 'false' })).toBe(false);
    expect(agendamentosLigados({ AGENDAMENTOS_ENABLED: '1' })).toBe(false);
    expect(agendamentosLigados({ AGENDAMENTOS_ENABLED: 'true' })).toBe(true);
  });

  it('os cinco jobs, com id de scheduler fixo e único', () => {
    expect(AGENDAMENTOS.map((a) => a.nome)).toEqual([...Object.keys(ORIGEM), 'manutencao-diagnostico', 'lembrete-visita-corretor']);
    expect(new Set(AGENDAMENTOS.map((a) => a.schedulerId)).size).toBe(6);
    for (const a of AGENDAMENTOS) expect(a.schedulerId).toBe(`agendamento-${a.nome}`);
    expect(agendamentoPorNome('sweeper-webhook-events')?.padrao).toBe('*/5 * * * *');
    expect(agendamentoPorNome('outro')).toBeUndefined();
  });

  it.each(Object.entries(ORIGEM))('%s: mesmo padrão e mesmo SQL do pg_cron', (nome, arquivo) => {
    const a = agendamentoPorNome(nome)!;
    const cron = doPgCron(arquivo, nome);
    expect(a.padrao).toBe(cron.padrao);
    // O SELECT ganha só o alias "AS n" para o resultado ser lido.
    expect(normal(a.sql.text).replace(/ AS n$/, '')).toBe(cron.sql);
    expect(a.sql.values).toEqual([]);
  });

  it('manutenção do diagnóstico: a função do banco a cada minuto (como o cron do #54) e depois a fila de e-mail', () => {
    const a = agendamentoPorNome('manutencao-diagnostico')!;
    expect(a.padrao).toBe('* * * * *');
    expect(normal(a.sql.text)).toBe('SELECT public.diagnostic_maintenance() AS n');
    expect(a.sql.values).toEqual([]);
    expect(a.toleranciaMs).toBe(5 * 60_000);
    expect(a.depois).toBe('notificacoes-diagnostico');
    expect(AGENDAMENTOS.filter((x) => x.depois).map((x) => x.nome)).toEqual(['manutencao-diagnostico']);
  });

  it('instantes em UTC, os mesmos do pg_cron do Supabase (BRT = UTC-3)', () => {
    expect(FUSO_AGENDAMENTOS).toBe('UTC');
    const proximo = (nome: string, depois: string) => new Date(getNextMillis(Date.parse(depois), { pattern: agendamentoPorNome(nome)!.padrao, tz: FUSO_AGENDAMENTOS })!).toISOString();
    expect(proximo('gerar-faturas-mensais', '2026-10-06T12:00:00Z')).toBe('2026-10-25T06:00:00.000Z');
    expect(proximo('gerar-faturas-mensais', '2026-10-25T06:00:00Z')).toBe('2026-11-25T06:00:00.000Z');
    expect(proximo('marcar-faturas-atrasadas', '2026-10-06T07:00:00Z')).toBe('2026-10-07T07:00:00.000Z');
    expect(proximo('gerar-alertas-vencimento', '2026-10-06T07:59:59Z')).toBe('2026-10-06T08:00:00.000Z');
    expect(proximo('sweeper-webhook-events', '2026-10-06T12:03:10Z')).toBe('2026-10-06T12:05:00.000Z');
    // Em São Paulo o horário de verão não existe desde 2019, mas o padrão nem depende disso: é UTC.
    expect(proximo('gerar-faturas-mensais', '2027-01-01T00:00:00Z')).toBe('2027-01-25T06:00:00.000Z');
  });

  it('tolerância a atraso: curta no sweeper, meio dia nos diários e no mensal', () => {
    expect(agendamentoPorNome('sweeper-webhook-events')!.toleranciaMs).toBe(10 * 60_000);
    for (const nome of ['gerar-faturas-mensais', 'marcar-faturas-atrasadas', 'gerar-alertas-vencimento']) {
      expect(agendamentoPorNome(nome)!.toleranciaMs).toBe(12 * 3_600_000);
    }
  });
});

describe('AgendamentosRepo', () => {
  function montar(trava: boolean, resultado: unknown = [{ n: 3 }]) {
    const tx = { $executeRaw: jest.fn(async (_sql: unknown) => 7), $queryRaw: jest.fn() };
    tx.$queryRaw.mockResolvedValueOnce([{ ok: trava }]).mockResolvedValueOnce(resultado);
    const prisma = { $transaction: jest.fn(async (f: (t: typeof tx) => unknown, _o?: unknown) => f(tx)) };
    return { tx, prisma, repo: new AgendamentosRepo(prisma as never) };
  }
  const texto = (m: jest.Mock, i: number) => normal((m.mock.calls[i][0] as { text: string }).text);
  const valores = (m: jest.Mock, i: number) => (m.mock.calls[i][0] as { values: unknown[] }).values;

  it('fuso UTC local à transação, trava pelo nome e o SQL do job', async () => {
    const { tx, prisma, repo } = montar(true);
    expect(await repo.executar(agendamentoPorNome('gerar-faturas-mensais')!)).toEqual({ executou: true, resultado: 3 });
    expect(texto(tx.$executeRaw, 0)).toBe("select set_config('TimeZone', $1::text, true)");
    expect(valores(tx.$executeRaw, 0)).toEqual(['UTC']);
    expect(texto(tx.$queryRaw, 0)).toContain('pg_try_advisory_xact_lock(hashtextextended($1::text, 0))');
    expect(valores(tx.$queryRaw, 0)).toEqual(['agendamento:gerar-faturas-mensais']);
    expect(tx.$queryRaw.mock.calls[1][0]).toBe(agendamentoPorNome('gerar-faturas-mensais')!.sql);
    // Transação com folga para rodar todas as contas (o padrão do Prisma é 5 s).
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 120_000 });
  });

  it('update devolve as linhas afetadas', async () => {
    const { tx, repo } = montar(true);
    expect(await repo.executar(agendamentoPorNome('sweeper-webhook-events')!)).toEqual({ executou: true, resultado: 7 });
    expect(tx.$executeRaw.mock.calls[1][0]).toBe(agendamentoPorNome('sweeper-webhook-events')!.sql);
  });

  it('sem a trava não roda nada', async () => {
    const { tx, repo } = montar(false);
    expect(await repo.executar(agendamentoPorNome('marcar-faturas-atrasadas')!)).toEqual({ executou: false, motivo: 'em_andamento' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
