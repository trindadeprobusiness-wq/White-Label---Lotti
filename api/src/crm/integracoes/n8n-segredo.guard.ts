import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { erroN8n } from './crm-n8n.regras';
import { cabecalho, CABECALHO_SEGREDO_N8N, segredoConfere, segredoN8nConfigurado } from './segredo-n8n';

/**
 * assertN8nSecret das Edge Functions crm-*: o cabeçalho x-n8n-secret tem de ser o N8N_SHARED_SECRET.
 * Sem a variável no servidor → 503 (a Edge respondia 400 com o mesmo texto); errado/ausente → 401
 * `{ success: false, error: 'unauthorized' }`. A comparação é em tempo constante.
 */
@Injectable()
export class N8nSegredoGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const esperado = segredoN8nConfigurado();
    if (!esperado) throw erroN8n(503, 'N8N_SHARED_SECRET not configured');
    const recebido = cabecalho(ctx.switchToHttp().getRequest<Request>().headers[CABECALHO_SEGREDO_N8N]);
    if (!recebido || recebido.length > 1024 || !segredoConfere(recebido, esperado)) throw erroN8n(401, 'unauthorized');
    return true;
  }
}
