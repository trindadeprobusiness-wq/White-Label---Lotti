import { Module } from '@nestjs/common';
import { DiagnosticoCrescimentoController, DiagnosticoCrescimentoWorkerController } from './diagnostico-crescimento.controller';
import { DiagnosticoCrescimentoRepo } from './diagnostico-crescimento.repo';
import { DiagnosticoCrescimentoService } from './diagnostico-crescimento.service';

/**
 * Diagnóstico de Crescimento (conversa pública em /diagnostico), no lugar das Edge Functions
 * `diagnostic` e `diagnostic-notifications`. A leitura do painel fica em parceiros/admin
 * (/api/admin/diagnosticos-crescimento), com o is_admin() das policies. PrismaService vem do módulo global.
 */
@Module({
  controllers: [DiagnosticoCrescimentoController, DiagnosticoCrescimentoWorkerController],
  providers: [DiagnosticoCrescimentoRepo, DiagnosticoCrescimentoService],
})
export class DiagnosticoCrescimentoModule {}
