import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { CrmClientesController } from './crm-clientes.controller';
import { CrmClientesService } from './crm-clientes.service';

// O TenantDb vem do PrismaModule global.
@Module({
  controllers: [CrmClientesController],
  providers: [CrmClientesService, SupabaseAuthGuard],
})
export class CrmClientesModule {}
