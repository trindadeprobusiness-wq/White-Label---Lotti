import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { ConversaDoAgenteDto, SolicitarVisitaDto } from './solicitar-visita.dto';
import { VisitasService } from './visitas.service';

/**
 * Chamado pelo agente do WhatsApp (como as tools de agenda do Clix): consultar horários livres antes de
 * oferecer, marcar/remarcar o horário escolhido e cancelar a pedido do cliente.
 */
@Controller('agente/visitas')
@UseGuards(AgentTokenGuard)
export class AgenteVisitasController {
  constructor(private readonly visitas: VisitasService) {}

  @Post()
  solicitar(@Body() body: SolicitarVisitaDto) {
    return this.visitas.solicitar(body);
  }

  @Post('horarios')
  horarios(@Body() body: ConversaDoAgenteDto) {
    return this.visitas.horarios(body);
  }

  @Post('cancelar')
  cancelar(@Body() body: ConversaDoAgenteDto) {
    return this.visitas.cancelar(body);
  }
}
