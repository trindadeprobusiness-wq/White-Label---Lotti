import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { CrmN8nService } from './crm-n8n.service';
import { N8nSegredoGuard } from './n8n-segredo.guard';

/**
 * Integrações do n8n (substituem as Edge Functions crm-*). O último trecho do caminho é o nome da
 * função: no n8n basta trocar a variável SUPABASE_EDGE_URL para `https://<api>/api/integracoes/n8n`.
 * Autenticação: cabeçalho x-n8n-secret = N8N_SHARED_SECRET (N8nSegredoGuard). Sem DTO no corpo: o
 * n8n manda o que o modelo preencheu e a Edge ignorava campo extra (ver crm-n8n.regras.ts).
 * Chamada de servidor para servidor: não entra no CORS das rotas públicas.
 */
@Controller('integracoes/n8n')
@UseGuards(N8nSegredoGuard)
export class CrmN8nController {
  constructor(private readonly servico: CrmN8nService) {}

  @Post('crm-upsert-lead')
  @HttpCode(200)
  upsertLead(@Body() corpo: Record<string, unknown>) {
    return this.servico.upsertLead(corpo);
  }

  /** A Edge lia só a query, qualquer que fosse o método; o n8n chama com GET. */
  @Get('crm-buscar-imoveis')
  buscarImoveis(@Query() consulta: Record<string, unknown>) {
    return this.servico.buscarImoveis(consulta);
  }

  @Post('crm-buscar-imoveis')
  @HttpCode(200)
  buscarImoveisPost(@Query() consulta: Record<string, unknown>) {
    return this.servico.buscarImoveis(consulta);
  }

  @Post('crm-anexar-historico')
  @HttpCode(200)
  anexarHistorico(@Body() corpo: Record<string, unknown>) {
    return this.servico.anexarHistorico(corpo);
  }
}
