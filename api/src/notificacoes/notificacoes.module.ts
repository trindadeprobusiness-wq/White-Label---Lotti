import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AlertasHub } from './alertas-hub';
import { AlertasListener } from './alertas-listener';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';

@Module({
  controllers: [NotificacoesController],
  providers: [AlertasHub, AlertasListener, NotificacoesService, SupabaseAuthGuard],
  exports: [AlertasHub],
})
export class NotificacoesModule {}
