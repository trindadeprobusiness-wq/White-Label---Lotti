import { timingSafeEqual } from 'node:crypto';
import { Controller, Headers, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ipDoCliente } from '../auth/auth.controller';
import { lerConfigDiagnostico } from './diagnostico-crescimento.config';
import { DiagnosticoCrescimentoService } from './diagnostico-crescimento.service';

/** readPublicJson da Edge: 16 KiB na conversa, 1 KiB no worker. */
export const LIMITE_CORPO = 16_384;
export const LIMITE_CORPO_WORKER = 1024;

const CABECALHOS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const;

export function enviar(res: Response, status: number, corpo: unknown): void {
  res.set(CABECALHOS);
  // A Edge mandava Retry-After: 3600 no 429 (a janela dos contadores é de 1 hora).
  if (status === 429) res.set('Retry-After', '3600');
  res.status(status).json(corpo);
}

/** Tamanho do corpo: o Content-Length e, sem ele (chunked), o JSON já lido. */
export function grandeDemais(req: Request, tamanho: string | undefined, limite: number): boolean {
  if (Number(tamanho) > limite) return true;
  try {
    return Buffer.byteLength(JSON.stringify(req.body ?? null), 'utf8') > limite;
  } catch {
    return true;
  }
}

/**
 * POST /api/publico/diagnostico — substitui a Edge Function `diagnostic` (verify_jwt=false).
 * Pública, sem guard e sem DTO: o corpo muda conforme `action` e é validado no service. Respostas e
 * status idênticos aos da Edge (`{ error }` nos erros). CORS de rota pública (config/cors.ts): chamada
 * pelo app (/diagnostico) e pelo site, sem credenciais.
 */
@Controller('publico/diagnostico')
export class DiagnosticoCrescimentoController {
  constructor(private readonly servico: DiagnosticoCrescimentoService) {}

  @Post()
  async receber(@Req() req: Request, @Res() res: Response, @Headers('content-length') tamanho?: string): Promise<void> {
    if (grandeDemais(req, tamanho, LIMITE_CORPO)) return enviar(res, 413, { error: 'Requisição muito grande.' });
    const r = await this.servico.receber(req.body, ipDoCliente(req));
    enviar(res, r.status, r.corpo);
  }
}

/** Comparação em tempo constante (equalSecret da Edge). */
export function segredoConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/diagnostico/manutencao — substitui a Edge Function `diagnostic-notifications`, para o
 * agendador (a cada 5 min, segundo docs/DIAGNOSTICO_CRESCIMENTO.md). Authorization: Bearer com
 * DIAGNOSTIC_WORKER_SECRET (32+ caracteres); corpo `{ "action": "maintenance" }`. Marca abandonos,
 * limpa os contadores vencidos e drena a fila de e-mail (só com DIAGNOSTIC_NOTIFICATIONS_ENABLED).
 */
@Controller('diagnostico')
export class DiagnosticoCrescimentoWorkerController {
  constructor(private readonly servico: DiagnosticoCrescimentoService) {}

  @Post('manutencao')
  async manutencao(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('authorization') autorizacao?: string,
    @Headers('content-length') tamanho?: string,
  ): Promise<void> {
    const esperado = lerConfigDiagnostico().segredoWorker;
    const recebido = autorizacao ?? '';
    if (!esperado || esperado.length < 32 || !recebido.startsWith('Bearer ') || !segredoConfere(recebido.slice(7), esperado)) {
      return enviar(res, 401, { error: 'Unauthorized' });
    }
    if (grandeDemais(req, tamanho, LIMITE_CORPO_WORKER)) return enviar(res, 413, { error: 'Invalid request' });
    const corpo = req.body as Record<string, unknown> | undefined;
    if (!corpo || typeof corpo !== 'object' || corpo.action !== 'maintenance') return enviar(res, 400, { error: 'Invalid action' });
    try {
      enviar(res, 200, { ok: true, ...(await this.servico.manutencao()) });
    } catch {
      enviar(res, 503, { error: 'Maintenance unavailable' });
    }
  }
}
