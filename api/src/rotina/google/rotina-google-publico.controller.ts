import { Controller, Get, Headers, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RotinaGoogleService } from './rotina-google.service';

/** Rotas chamadas pelo Google (sem sessão): callback do OAuth e webhook do watch. */
@Controller('google-agenda')
export class RotinaGooglePublicoController {
  constructor(private readonly google: RotinaGoogleService) {}

  @Get('callback')
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    res.redirect(302, await this.google.callback(query));
  }

  @Post('webhook')
  async webhook(@Headers() headers: Record<string, string | string[] | undefined>, @Res() res: Response): Promise<void> {
    const { status, body } = await this.google.webhook(headers);
    res.status(status).json(body);
  }
}
