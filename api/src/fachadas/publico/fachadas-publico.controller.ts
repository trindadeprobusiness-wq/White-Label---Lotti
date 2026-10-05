import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ID } from '../fachadas.controller';
import { EnviarLeadDto } from './fachadas-publico.dto';
import { FachadasPublicoService } from './fachadas-publico.service';
import { FachadaPublica } from './fachadas-publico.repo';

/**
 * Porte da Edge Function fachada-publica (contrato §2). sem guarda e sem claims de usuario: a landing do QR
 * Code não tem sessão. O id é validado pelo ParseUUIDPipe, que substitui o UUID_PATTERN.test da função.
 * O limite de uso e as validações continuam no banco (§0.3), não aqui.
 */
@Controller('publico/fachadas')
export class FachadasPublicoController {
  constructor(private readonly publico: FachadasPublicoService) {}

  @Get(':id')
  verFachada(@Param('id', ID) id: string): Promise<FachadaPublica> {
    return this.publico.verFachada(id);
  }

  // Sem corpo declarado: o user_agent vem do cabeçalho, que o visitante não escolhe (§2.2). Qualquer corpo é ignorado.
  @Post(':id/escaneamentos')
  @HttpCode(204)
  registrarEscaneamento(@Param('id', ID) id: string, @Headers('user-agent') userAgent?: string): Promise<void> {
    return this.publico.registrarEscaneamento(id, userAgent ?? null);
  }

  @Post(':id/leads')
  @HttpCode(200)
  enviarLead(@Param('id', ID) id: string, @Body() dto: EnviarLeadDto): Promise<{ registrado: true }> {
    return this.publico.enviarLead(id, dto);
  }
}
