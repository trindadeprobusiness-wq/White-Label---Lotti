import { Module } from '@nestjs/common';
import { DiagnosticoCrescimentoModule } from '../diagnostico-crescimento/diagnostico-crescimento.module';
import { AgendamentosJob } from './agendamentos.job';
import { AgendamentosRepo } from './agendamentos.repo';

/** pg_cron → BullMQ (bloco B5). PrismaService e RedisService vêm dos módulos globais. */
@Module({
  // A manutenção do diagnóstico drena a fila de e-mail pelo mesmo service da rota /api/diagnostico/manutencao.
  imports: [DiagnosticoCrescimentoModule],
  providers: [AgendamentosRepo, AgendamentosJob],
})
export class AgendamentosModule {}
