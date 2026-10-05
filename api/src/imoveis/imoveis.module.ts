import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ImoveisController } from './imoveis.controller';
import { ImoveisGestaoService } from './imoveis-gestao.service';
import { ImoveisService } from './imoveis.service';

@Module({
  controllers: [ImoveisController],
  providers: [ImoveisService, ImoveisGestaoService, SupabaseAuthGuard],
  exports: [ImoveisService],
})
export class ImoveisModule {}
