import { Controller, Headers, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Claims } from '../../auth/claims.decorator';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { enviar, grandeDemais, LIMITE_CORPO } from '../../diagnostico-crescimento/diagnostico-crescimento.controller';
import { SupabaseClaims } from '../../prisma/tenant-db';
import { DiagnosticosCrescimentoAdminService } from './diagnosticos-crescimento.service';

/**
 * POST /api/admin/diagnosticos-crescimento — no lugar da Edge Function `diagnostic-admin` (#54), que o
 * painel /admin/diagnosticos chama por src/features/diagnostic/admin-api.ts. Corpo `{ action, ... }`
 * e respostas iguais às da Edge (jsonb da RPC ou `{ error }`), com o login próprio no guard e o
 * is_admin() no banco. Sem DTO: o corpo muda conforme `action` e é validado no service.
 */
@Controller('admin/diagnosticos-crescimento')
@UseGuards(SupabaseAuthGuard)
export class DiagnosticosCrescimentoAdminController {
  constructor(private readonly servico: DiagnosticosCrescimentoAdminService) {}

  @Post()
  async executar(
    @Claims() claims: SupabaseClaims,
    @Req() req: Request,
    @Res() res: Response,
    @Headers('content-length') tamanho?: string,
  ): Promise<void> {
    if (grandeDemais(req, tamanho, LIMITE_CORPO)) return enviar(res, 413, { error: 'Requisição muito grande.' });
    const r = await this.servico.executar(claims, req.body);
    enviar(res, r.status, r.corpo);
  }
}
