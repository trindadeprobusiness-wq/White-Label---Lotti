import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ServicoDb } from '../servico-db';
import { processarFilaLigado } from './asaas.config';
import { AsaasWebhookService } from './asaas-webhook.service';

export const INTERVALO_FILA_MS = 60_000;

/**
 * Reprocessa eventos parados (D3). Desligado por padrão: enquanto a Edge Function e o pg_cron
 * existirem, quem processa é a Edge. A reserva condicional de processar() impede processamento duplo.
 */
@Injectable()
export class AsaasFila implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AsaasFila.name);
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;

  constructor(private readonly servico: ServicoDb, private readonly webhook: AsaasWebhookService) {}

  onModuleInit(): void {
    if (!processarFilaLigado()) return;
    this.timer = setInterval(() => { void this.volta(); }, INTERVALO_FILA_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get ligada(): boolean {
    return this.timer !== null;
  }

  /** Uma volta: até 20 eventos RECEIVED há mais de 1 minuto ou FAILED com menos de 5 tentativas. */
  async volta(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      const linhas = await this.servico.run((tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        select id::text as id from public.asaas_webhook_events
         where (status = 'RECEIVED' and received_at < now() - interval '1 minute')
            or (status = 'FAILED' and attempts < 5)
         order by received_at, id limit 20`));
      for (const { id } of linhas) await this.webhook.processar(id);
      return linhas.length;
    } catch {
      this.logger.error({ codigo: 'fila_asaas_falhou' });
      return 0;
    } finally {
      this.rodando = false;
    }
  }
}
