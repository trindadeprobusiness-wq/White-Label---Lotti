import { Controller, Get } from '@nestjs/common';
import { Linha } from './assinatura.dto';
import { CatalogoService } from './catalogo.service';

/** Catálogo de planos: público, como as policies `FOR SELECT TO PUBLIC` já são hoje. Sem guard. */
@Controller('planos')
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  @Get()
  planos(): Promise<Linha[]> {
    return this.catalogo.listarPlanos();
  }

  @Get('entitlements')
  entitlements(): Promise<Linha[]> {
    return this.catalogo.listarEntitlements();
  }

  @Get('campanha')
  campanha(): Promise<Linha | null> {
    return this.catalogo.campanhaAtiva();
  }
}
