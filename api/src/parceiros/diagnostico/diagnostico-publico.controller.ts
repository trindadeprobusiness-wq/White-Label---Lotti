import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ERROS } from '../parceiros.erros';
import { DiagnosticoService, RespostaDiagnostico } from './diagnostico.service';

/** Mesmo teto da Edge Function (readPublicJson): 16 KiB. */
const LIMITE_CORPO = 16_384;

/**
 * Rota pública (substitui a Edge commercial-diagnostic): sem guard e sem DTO no @Body, porque o corpo
 * muda conforme `action`. O DTO certo é validado à mão no service.
 */
@Controller('diagnostico-comercial')
export class DiagnosticoPublicoController {
  constructor(private readonly servico: DiagnosticoService) {}

  /**
   * Mesmo teto de corpo da Edge Function (readPublicJson, 16 KiB).
   *
   * A rota é anônima e o analisador de JSON do servidor aceita 21 MB (o PDF do analisador de
   * contrato). Sem este corte, qualquer um poderia fazer a API desserializar megabytes por
   * requisição antes de a validação recusar.
   */
  @Post()
  @HttpCode(200)
  receber(
    @Body() corpo: Record<string, unknown>,
    @Headers('content-length') tamanho?: string,
  ): Promise<RespostaDiagnostico> {
    if (Number(tamanho) > LIMITE_CORPO) throw ERROS.corpoGrande();
    return this.servico.receber(corpo);
  }
}
