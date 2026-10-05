import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ArquivosController } from './arquivos.controller';
import { ArquivosRepo } from './arquivos.repo';

/**
 * ArquivosModule: as rotas de arquivo (públicas e privadas). O cliente S3 vem do StorageModule
 * (@Global) e o TenantDb/PrismaService do PrismaModule (@Global). A integração no AppModule é feita
 * à parte; aqui só se garante que o módulo é importável.
 */
@Module({
  controllers: [ArquivosController],
  providers: [ArquivosRepo, SupabaseAuthGuard],
})
export class ArquivosModule {}
