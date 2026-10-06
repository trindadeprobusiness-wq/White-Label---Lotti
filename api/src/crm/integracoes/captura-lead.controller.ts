import { Controller, HttpCode, HttpException, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { lerCorpoLead } from './captura-lead.regras';
import { CapturaLeadService } from './captura-lead.service';
import { cabecalho, CABECALHO_SEGREDO_N8N } from './segredo-n8n';

/**
 * POST /api/publico/leads[?imovel_id=<uuid>] — substitui a Edge Function lead-capture (o "webhook do
 * imóvel" que o corretor cola em landing pages, Meta Ads e PerfectPay). Pública, sem guarda; CORS de
 * rota pública (config/cors.ts). Sem @Body: o corpo é lido no service depois do segredo, aceita o
 * text/plain que a Edge aceitava e nunca passa pelo ValidationPipe (campo extra não é erro).
 */
@Controller('publico/leads')
export class CapturaLeadController {
  constructor(private readonly servico: CapturaLeadService) {}

  @Post()
  @HttpCode(200)
  async capturar(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown>> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const imovelId = req.query?.imovel_id;
    try {
      return await this.servico.capturar({
        segredo: cabecalho(req.headers[CABECALHO_SEGREDO_N8N]),
        imovelIdDaQuery: typeof imovelId === 'string' ? imovelId : Array.isArray(imovelId) && typeof imovelId[0] === 'string' ? imovelId[0] : null,
        lerCorpo: () => lerCorpoLead(req),
      });
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 429) res.setHeader('Retry-After', '600');
      throw e;
    }
  }
}
