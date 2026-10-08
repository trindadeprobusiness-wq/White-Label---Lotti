import { Module } from '@nestjs/common';
import { DiagnosticoCrescimentoController, DiagnosticoCrescimentoWorkerController } from './diagnostico-crescimento.controller';
import { DiagnosticoCrescimentoRepo } from './diagnostico-crescimento.repo';
import { DiagnosticoCrescimentoService } from './diagnostico-crescimento.service';

/**
 * Diagnóstico de Crescimento (conversa pública em /diagnostico), no lugar das Edge Functions
 * `diagnostic` e `diagnostic-notifications`. O painel (Edge `diagnostic-admin` do #54) fica em parceiros/admin
 * (POST /api/admin/diagnosticos-crescimento), com o is_admin() das RPCs. PrismaService vem do módulo global.
 */
@Module({
  controllers: [DiagnosticoCrescimentoController, DiagnosticoCrescimentoWorkerController],
  providers: [DiagnosticoCrescimentoRepo, DiagnosticoCrescimentoService],
  // O agendamento 'manutencao-diagnostico' drena a fila pelo mesmo service.
  exports: [DiagnosticoCrescimentoService],
})
export class DiagnosticoCrescimentoModule {}
