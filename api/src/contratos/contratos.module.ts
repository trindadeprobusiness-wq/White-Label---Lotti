import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ContratosIaController } from './contratos-ia.controller';
import { ContratosIaService } from './contratos-ia.service';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';

// TenantDb e PrismaService vêm do PrismaModule global.
// ContratosIaController primeiro: contratos/ia/* fica registrado antes de contratos/:id.
@Module({
  controllers: [ContratosIaController, ContratosController, DocumentosController],
  providers: [ContratosService, DocumentosService, ContratosIaService, SupabaseAuthGuard],
})
export class ContratosModule {}
