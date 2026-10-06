import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ImoveisController } from './imoveis.controller';
import { ImoveisFotosController } from './imoveis-fotos.controller';
import { ImoveisFotosService } from './imoveis-fotos.service';
import { ImoveisGestaoService } from './imoveis-gestao.service';
import { ImoveisVendaEventoService } from './imoveis-venda-evento.service';
import { ImoveisService } from './imoveis.service';
import { ImoveisPublicoController } from './publico/imoveis-publico.controller';
import { ImoveisPublicoRepo } from './publico/imoveis-publico.repo';
import { ImoveisPublicoService } from './publico/imoveis-publico.service';

@Module({
  // ImoveisPublicoController (publico/imoveis) não colide com as rotas de id de imoveis/.
  controllers: [ImoveisController, ImoveisFotosController, ImoveisPublicoController],
  providers: [ImoveisService, ImoveisGestaoService, ImoveisFotosService, ImoveisVendaEventoService, SupabaseAuthGuard,
    ImoveisPublicoService, ImoveisPublicoRepo],
  exports: [ImoveisService],
})
export class ImoveisModule {}
