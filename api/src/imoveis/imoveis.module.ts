import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ImoveisController } from './imoveis.controller';
import { ImoveisService } from './imoveis.service';

@Module({
  controllers: [ImoveisController],
  providers: [ImoveisService, SupabaseAuthGuard],
  exports: [ImoveisService],
})
export class ImoveisModule {}
