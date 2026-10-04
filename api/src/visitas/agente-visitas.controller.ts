import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { SolicitarVisitaDto } from './solicitar-visita.dto';
import { VisitasService } from './visitas.service';

/** Chamado pelo agente do WhatsApp quando o lead pede visita com dia e horário. */
@Controller('agente/visitas')
@UseGuards(AgentTokenGuard)
export class AgenteVisitasController {
  constructor(private readonly visitas: VisitasService) {}

  @Post()
  solicitar(@Body() body: SolicitarVisitaDto) {
    return this.visitas.solicitar(body);
  }
}
