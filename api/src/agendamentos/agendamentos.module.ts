import { Module } from '@nestjs/common';
import { AgendamentosJob } from './agendamentos.job';
import { AgendamentosRepo } from './agendamentos.repo';

/** pg_cron → BullMQ (bloco B5). PrismaService e RedisService vêm dos módulos globais. */
@Module({
  providers: [AgendamentosRepo, AgendamentosJob],
})
export class AgendamentosModule {}
