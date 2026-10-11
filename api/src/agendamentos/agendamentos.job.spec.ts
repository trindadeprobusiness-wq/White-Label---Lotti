import { AGENDAMENTOS, agendamentoPorNome } from './agendamentos.config';
import { AgendamentosJob } from './agendamentos.job';
import { AgendamentosRepo } from './agendamentos.repo';

const mockFilas: MockFila[] = [];
const mockControle = { falhar: false };
const mockWorkers: MockWorker[] = [];

class MockFila {
  schedulers: Array<{ key: string }> = [{ key: 'agendamento-gerar-faturas-mensais' }, { key: 'agendamento-velho' }];
  upsertJobScheduler = jest.fn(async () => ({}));
  removeJobScheduler = jest.fn(async () => true);
  getJobSchedulers = jest.fn(async () => {
    if (mockControle.falhar) throw new Error('redis fora');
    return this.schedulers;
  });
  on = jest.fn();
  close = jest.fn(async () => undefined);
  constructor(public nome: string, public opts: unknown) { mockFilas.push(this); }
}
class MockWorker {
  on = jest.fn();
  close = jest.fn(async () => undefined);
  constructor(public nome: string, public processador: (job: unknown) => Promise<unknown>, public opts: { concurrency?: number }) { mockWorkers.push(this); }
}

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((nome: string, opts: unknown) => new MockFila(nome, opts)),
  Worker: jest.fn().mockImplementation((nome: string, p: (job: unknown) => Promise<unknown>, opts: { concurrency?: number }) => new MockWorker(nome, p, opts)),
}));

const salvo = process.env.AGENDAMENTOS_ENABLED;
afterEach(() => {
  mockFilas.length = 0;
  mockWorkers.length = 0;
  if (salvo === undefined) delete process.env.AGENDAMENTOS_ENABLED;
  else process.env.AGENDAMENTOS_ENABLED = salvo;
});

function montar(comRedis = true) {
  const repo = { executar: jest.fn(async () => ({ executou: true as const, resultado: 2 })) };
  const redis = comRedis ? { connection: { url: 'redis://teste' } } : undefined;
  const diagnostico = { drenarFila: jest.fn(async () => ({ sent: 0, failed: 0 })) };
  return { repo, diagnostico, job: new AgendamentosJob(repo as unknown as AgendamentosRepo, redis as never, diagnostico as never) };
}

describe('AgendamentosJob: registro', () => {
  it('desligado por padrão: nem fila nem worker (a cópia do banco nunca roda os jobs)', async () => {
    delete process.env.AGENDAMENTOS_ENABLED;
    const { job } = montar();
    job.onModuleInit();
    await job.registro;
    expect(mockFilas).toHaveLength(0);
    expect(mockWorkers).toHaveLength(0);
    process.env.AGENDAMENTOS_ENABLED = 'true';
    expect(montar(false).job.deveRegistrar()).toBe(false);
  });

  it('ligado: um scheduler por job, id fixo, padrão do pg_cron em UTC; worker com concurrency 1', async () => {
    process.env.AGENDAMENTOS_ENABLED = 'true';
    const { job } = montar();
    job.onModuleInit();
    await job.registro;
    expect(mockFilas).toHaveLength(1);
    const fila = mockFilas[0];
    expect(fila.nome).toBe('agendamentos');
    expect(fila.opts).toEqual({ connection: { url: 'redis://teste' } });
    expect(fila.upsertJobScheduler.mock.calls).toEqual(AGENDAMENTOS.map((a) => [
      a.schedulerId,
      { pattern: a.padrao, tz: 'UTC' },
      { name: a.nome, data: {}, opts: { attempts: 1, removeOnComplete: 50, removeOnFail: 200 } },
    ]));
    expect(fila.upsertJobScheduler.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      'agendamento-gerar-faturas-mensais', 'agendamento-marcar-faturas-atrasadas',
      'agendamento-sweeper-webhook-events', 'agendamento-gerar-alertas-vencimento', 'agendamento-manutencao-diagnostico', 'agendamento-lembrete-visita-corretor',
    ]);
    // Scheduler que saiu da lista é removido; os atuais não.
    expect(fila.removeJobScheduler.mock.calls).toEqual([['agendamento-velho']]);
    expect(mockWorkers).toHaveLength(1);
    expect(mockWorkers[0].nome).toBe('agendamentos');
    expect(mockWorkers[0].opts).toMatchObject({ concurrency: 1, connection: { url: 'redis://teste' } });
    // Ouvintes de erro: um 'error' sem ouvinte derrubaria o processo.
    expect(fila.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockWorkers[0].on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockWorkers[0].on).toHaveBeenCalledWith('failed', expect.any(Function));
    await job.onModuleDestroy();
    expect(mockWorkers[0].close).toHaveBeenCalled();
    expect(fila.close).toHaveBeenCalled();
  });

  it('Redis fora do ar não segura o boot: onModuleInit volta na hora e o erro do registro só vai para o log', async () => {
    process.env.AGENDAMENTOS_ENABLED = 'true';
    mockControle.falhar = true;
    try {
      const { job } = montar();
      expect(job.onModuleInit()).toBeUndefined();
      await expect(job.registro).resolves.toBeUndefined();
      expect(mockFilas).toHaveLength(1);
      expect(mockWorkers).toHaveLength(0);
    } finally {
      mockControle.falhar = false;
    }
  });

  it('reiniciar repete o upsert dos MESMOS ids (não cria agendamento novo)', async () => {
    process.env.AGENDAMENTOS_ENABLED = 'true';
    for (const { job } of [montar(), montar()]) {
      job.onModuleInit();
      await job.registro;
    }
    const ids = mockFilas.map((f) => f.upsertJobScheduler.mock.calls.map((c) => (c as unknown[])[0]));
    expect(ids[0]).toEqual(ids[1]);
  });
});

describe('AgendamentosJob: processar', () => {
  const PREVISTO = Date.parse('2026-10-25T06:00:00Z');

  it('roda o SQL do job pelo nome', async () => {
    const { job, repo } = montar();
    const r = await job.processar({ name: 'gerar-faturas-mensais', timestamp: PREVISTO - 1000, opts: { prevMillis: PREVISTO } }, PREVISTO + 5_000);
    expect(r).toEqual({ executou: true, resultado: 2 });
    expect(repo.executar).toHaveBeenCalledWith(agendamentoPorNome('gerar-faturas-mensais'));
  });

  it('job atrasado além da tolerância não roda (não gera fatura fora de hora)', async () => {
    const { job, repo } = montar();
    const tarde = PREVISTO + 12 * 3_600_000 + 1;
    expect(await job.processar({ name: 'gerar-faturas-mensais', timestamp: 0, opts: { prevMillis: PREVISTO } }, tarde))
      .toEqual({ executou: false, motivo: 'atrasado' });
    // Sem prevMillis, o previsto é timestamp + delay.
    expect(await job.processar({ name: 'sweeper-webhook-events', timestamp: PREVISTO, delay: 60_000 }, PREVISTO + 60_000 + 10 * 60_000 + 1))
      .toEqual({ executou: false, motivo: 'atrasado' });
    expect(repo.executar).not.toHaveBeenCalled();
    // Dentro da tolerância roda.
    await job.processar({ name: 'sweeper-webhook-events', timestamp: PREVISTO, delay: 60_000 }, PREVISTO + 60_000 + 10 * 60_000);
    expect(repo.executar).toHaveBeenCalledTimes(1);
  });

  it('nome desconhecido é ignorado; erro do banco sobe para o BullMQ marcar falha', async () => {
    const { job, repo } = montar();
    expect(await job.processar({ name: 'outro', timestamp: Date.now() })).toEqual({ executou: false, motivo: 'desconhecido' });
    repo.executar.mockRejectedValueOnce(new Error('boom'));
    await expect(job.processar({ name: 'marcar-faturas-atrasadas', timestamp: Date.now() })).rejects.toThrow('boom');
  });

  it('manutenção do diagnóstico: SQL e depois a fila de e-mail; falha da fila não derruba o job', async () => {
    const { job, repo, diagnostico } = montar();
    const agora = Date.now();
    expect(await job.processar({ name: 'manutencao-diagnostico', timestamp: agora, opts: { prevMillis: agora } }, agora)).toEqual({ executou: true, resultado: 2 });
    expect(repo.executar).toHaveBeenCalledWith(agendamentoPorNome('manutencao-diagnostico'));
    expect(diagnostico.drenarFila).toHaveBeenCalledTimes(1);
    diagnostico.drenarFila.mockRejectedValueOnce(new Error('fora'));
    await expect(job.processar({ name: 'manutencao-diagnostico', timestamp: agora, opts: { prevMillis: agora } }, agora)).resolves.toEqual({ executou: true, resultado: 2 });
    // Os outros jobs não tocam na fila; e se a trava não foi pega, a fila também não roda.
    await job.processar({ name: 'marcar-faturas-atrasadas', timestamp: agora, opts: { prevMillis: agora } }, agora);
    repo.executar.mockResolvedValueOnce({ executou: false, motivo: 'em_andamento' } as never);
    await job.processar({ name: 'manutencao-diagnostico', timestamp: agora, opts: { prevMillis: agora } }, agora);
    expect(diagnostico.drenarFila).toHaveBeenCalledTimes(2);
  });

  it('o worker chama processar com o job do BullMQ', async () => {
    process.env.AGENDAMENTOS_ENABLED = 'true';
    const { job, repo } = montar();
    job.onModuleInit();
    await job.registro;
    await mockWorkers[0].processador({ name: 'gerar-alertas-vencimento', timestamp: Date.now(), opts: { prevMillis: Date.now() } });
    expect(repo.executar).toHaveBeenCalledWith(agendamentoPorNome('gerar-alertas-vencimento'));
  });
});
