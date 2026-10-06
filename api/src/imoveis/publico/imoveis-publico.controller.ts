import { Controller, Get, Header, Query } from '@nestjs/common';
import type { Consulta } from './imoveis-publico.regras';
import { ImoveisPublicoService } from './imoveis-publico.service';

/**
 * Rotas públicas, sem guarda (substituem as Edge Functions public-imoveis e imovel-detalhe, que
 * alimentam o site institucional). O CORS delas é o de rota pública (config/cors.ts): '*' ou
 * PUBLIC_CORS_ORIGINS, sem credenciais. Sem DTO na query, de propósito: ver imoveis-publico.regras.ts.
 *
 *   GET /api/publico/imoveis?tipo=&limit=&offset=&bairro=&preco_min=&preco_max=&quartos_min=&tipo_imovel=
 *   GET /api/publico/imoveis/detalhe?id=<uuid>
 */
@Controller('publico/imoveis')
export class ImoveisPublicoController {
  constructor(private readonly servico: ImoveisPublicoService) {}

  @Get()
  @Header('X-Content-Type-Options', 'nosniff')
  listar(@Query() consulta: Consulta) {
    return this.servico.listar(consulta);
  }

  @Get('detalhe')
  @Header('X-Content-Type-Options', 'nosniff')
  detalhe(@Query() consulta: Consulta) {
    return this.servico.detalhe(consulta);
  }
}
