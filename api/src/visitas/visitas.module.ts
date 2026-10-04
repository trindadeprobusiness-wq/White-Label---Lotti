import { Module } from '@nestjs/common';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AgenteVisitasController } from './agente-visitas.controller';
import { VisitasController } from './visitas.controller';
import { VisitasRepo } from './visitas.repo';
import { VisitasService } from './visitas.service';

@Module({
  controllers: [AgenteVisitasController, VisitasController],
  providers: [VisitasRepo, VisitasService, AgentTokenGuard, SupabaseAuthGuard],
})
export class VisitasModule {}
