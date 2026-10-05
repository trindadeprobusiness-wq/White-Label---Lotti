import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { CliqueDto } from '../parceiros.dto';
import { ParceirosPublicoService, RespostaClique } from './parceiros-publico.service';

/** Rota pública (substitui a Edge parceiro-clique): roda antes de existir conta, sem guard. */
@Controller('parceiros')
export class ParceirosPublicoController {
  constructor(private readonly servico: ParceirosPublicoService) {}

  @Post('clique')
  @HttpCode(200)
  clique(@Body() dto: CliqueDto, @Headers() cabecalhos: Record<string, string | string[] | undefined>): Promise<RespostaClique> {
    return this.servico.registrarClique(dto, cabecalhos);
  }
}
