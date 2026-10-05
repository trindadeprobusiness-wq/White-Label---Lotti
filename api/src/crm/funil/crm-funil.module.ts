import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { CrmFunilController } from './crm-funil.controller';
import { CrmFunilService } from './crm-funil.service';

@Module({
  controllers: [CrmFunilController],
  providers: [CrmFunilService, SupabaseAuthGuard],
})
export class CrmFunilModule {}
