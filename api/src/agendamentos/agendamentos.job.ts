import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import {
  AGENDAMENTOS, agendamentoPorNome, agendamentosLigados, FILA_AGENDAMENTOS, FUSO_AGENDAMENTOS,
} from './agendamentos.config';
import { AgendamentosRepo, ResultadoAgendamento } from './agendamentos.repo';

/** O pedaço do Job do BullMQ que o processador lê. */
export interface JobAgendado {
  name: string;
  timestamp: number;
  delay?: number;
  opts?: { prevMillis?: number; delay?: number };
}

export type SaidaJob = ResultadoAgendamento | { executou: false; motivo: 'desconhecido' | 'atrasado' };

/** Só o código: a mensagem do Postgres pode trazer dado de linha e não vai para o log. */
function codigoErro(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (e.meta ?? {}) as { code?: unknown };
    return typeof meta.code === 'string' ? `${e.code}/${meta.code}` : e.code;
  }
  return e instanceof Error ? e.name : 'erro';
}

/**
 * Substitui os pg_cron gerar-faturas-mensais, marcar-faturas-atrasadas, sweeper-webhook-events e
 * gerar-alertas-vencimento (agendamentos.config.ts). Desligado por padrão (AGENDAMENTOS_ENABLED).
 *
 * Nunca roda duas vezes ao mesmo tempo:
 *  - um job scheduler por agendamento, com id FIXO: cada boot faz upsert do mesmo id (reiniciar ou ter
 *    várias réplicas não cria agendamento novo) e o BullMQ gera um único job por instante previsto;
 *  - o worker processa um job por vez (concurrency 1);
 *  - a instrução roda sob pg_try_advisory_xact_lock (agendamentos.repo.ts), que segura o caso de duas
 *    réplicas ou de um processo antigo ainda vivo durante o deploy pegarem jobs diferentes juntos.
 * Job interrompido no meio (processo morto) é refeito pelo BullMQ como "stalled": a transação não
 * confirmou, e as quatro instruções são idempotentes.
 */
@Injectable()
export class AgendamentosJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Agendamentos');
  private fila?: Queue;
  private worker?: Worker;
  private encerrando = false;
  /** Registro em andamento (os testes esperam por ele). */
  registro?: Promise<void>;

  constructor(private readonly repo: AgendamentosRepo, @Optional() private readonly redis?: RedisService) {}

  deveRegistrar(env: NodeJS.ProcessEnv = process.env): boolean {
    return agendamentosLigados(env) && !!this.redis;
  }

  onModuleInit(): void {
    if (!this.deveRegistrar()) return;
    // Sem await: com o Redis fora do ar o BullMQ espera a reconexão indefinidamente, e a API não pode
    // deixar de subir por causa dos agendamentos. O registro termina quando o Redis responder.
    this.registro = this.registrar().catch((e) => this.logger.error(`registro falhou: ${codigoErro(e)}`));
  }

  private async registrar(): Promise<void> {
    const connection = this.redis!.connection;
    this.fila = new Queue(FILA_AGENDAMENTOS, { connection });
    this.fila.on('error', (e) => this.logger.error(`fila: ${codigoErro(e)}`));
    const ids = new Set(AGENDAMENTOS.map((a) => a.schedulerId));
    // Agendamento que saiu da lista (renomeado ou removido) não pode continuar disparando.
    for (const antigo of await this.fila.getJobSchedulers()) {
      if (antigo.key && !ids.has(antigo.key)) await this.fila.removeJobScheduler(antigo.key);
    }
    for (const a of AGENDAMENTOS) {
      await this.fila.upsertJobScheduler(
        a.schedulerId,
        { pattern: a.padrao, tz: FUSO_AGENDAMENTOS },
        { name: a.nome, data: {}, opts: { attempts: 1, removeOnComplete: 50, removeOnFail: 200 } },
      );
    }
    if (this.encerrando) return;
    this.worker = new Worker(FILA_AGENDAMENTOS, async (job) => this.processar(job), { connection, concurrency: 1 });
    this.worker.on('error', (e) => this.logger.error(`worker: ${codigoErro(e)}`));
    this.worker.on('failed', (job, e) => this.logger.error(`${job?.name ?? 'agendamento'} falhou: ${codigoErro(e)}`));
    this.logger.log(`ligado: ${AGENDAMENTOS.map((a) => `${a.nome} "${a.padrao}" ${FUSO_AGENDAMENTOS}`).join('; ')}`);
  }

  /** Executa um job do scheduler. Erro sobe para o BullMQ marcar como falho (e o evento 'failed' registra). */
  async processar(job: JobAgendado, agora: number = Date.now()): Promise<SaidaJob> {
    const a = agendamentoPorNome(job.name);
    if (!a) {
      this.logger.warn(`job desconhecido ignorado: ${job.name}`);
      return { executou: false, motivo: 'desconhecido' };
    }
    const previsto = job.opts?.prevMillis ?? job.timestamp + (job.delay ?? job.opts?.delay ?? 0);
    if (agora - previsto > a.toleranciaMs) {
      this.logger.warn(`${a.nome}: previsto para ${new Date(previsto).toISOString()}, atrasado demais; não roda`);
      return { executou: false, motivo: 'atrasado' };
    }
    const r = await this.repo.executar(a);
    if (r.executou) this.logger.log(`${a.nome}: ${r.resultado}`);
    else this.logger.warn(`${a.nome}: outra execução em andamento; esta não roda`);
    return r;
  }

  async onModuleDestroy(): Promise<void> {
    this.encerrando = true;
    await this.worker?.close().catch(() => undefined);
    await this.fila?.close().catch(() => undefined);
  }
}
