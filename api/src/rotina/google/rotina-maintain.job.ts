import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { RedisService } from '../../redis/redis.service';
import { lerConfigRotina } from '../rotina.config';
import { RotinaGoogleService } from './rotina-google.service';

export const FILA_ROTINA_GOOGLE = 'rotina-google';
export const JOB_MAINTAIN = 'maintain';
export const INTERVALO_MAINTAIN = 1_800_000;

/** Substitui o cron `routine-google-calendar-maintain` do pg_cron (contrato §2.6). Desligado por padrão. */
@Injectable()
export class RotinaMaintainJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RotinaMaintain');
  private fila?: Queue;
  private worker?: Worker;

  constructor(private readonly google: RotinaGoogleService, @Optional() private readonly redis?: RedisService) {}

  /** Só liga com ROUTINE_CALENDAR_MAINTAIN_ENABLED='true' e o Google configurado. */
  deveRegistrar(env: NodeJS.ProcessEnv = process.env): boolean {
    const cfg = lerConfigRotina(env);
    return cfg.maintainHabilitado && cfg.google.configurado && !!this.redis;
  }

  async onModuleInit(): Promise<void> {
    if (!this.deveRegistrar()) return;
    const connection = this.redis!.connection;
    this.fila = new Queue(FILA_ROTINA_GOOGLE, { connection });
    await this.fila.add(JOB_MAINTAIN, {}, { repeat: { every: INTERVALO_MAINTAIN }, jobId: 'rotina-google-maintain' });
    this.worker = new Worker(FILA_ROTINA_GOOGLE, async () => this.google.manter(), { connection });
    this.worker.on('failed', (_job, e) => this.logger.error(`maintain falhou: ${e?.message ?? 'erro'}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.fila?.close().catch(() => undefined);
  }
}
