import { Body, Controller, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AsaasWebhookService } from './asaas-webhook.service';

/** Rota pública (sem guard): quem autoriza é o token da conexão apontada pelo slug ?t=. */
@Controller('financeiro/asaas/webhook')
export class AsaasWebhookController {
  constructor(private readonly webhook: AsaasWebhookService) {}

  @Post()
  @HttpCode(200)
  receber(@Query('t') slug: string | undefined, @Req() req: Request, @Body() corpo: unknown): Promise<{ received: true; duplicate?: true }> {
    return this.webhook.receber(typeof slug === 'string' ? slug : null, req.headers as Record<string, unknown>, corpo);
  }
}
