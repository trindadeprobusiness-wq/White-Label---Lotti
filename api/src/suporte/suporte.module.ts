import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SuporteController } from './suporte.controller';
import { SuporteService } from './suporte.service';

/** Atendimento do backoffice (B6). PrismaService, TenantDb e ENV vêm dos módulos globais. */
@Module({
  controllers: [SuporteController],
  providers: [SuporteService, SupabaseAuthGuard],
})
export class SuporteModule {}
