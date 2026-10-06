import { Module } from '@nestjs/common';
import { CapturaLeadController } from './captura-lead.controller';
import { CapturaLeadRepo } from './captura-lead.repo';
import { CapturaLeadService } from './captura-lead.service';
import { CrmN8nController } from './crm-n8n.controller';
import { CrmN8nRepo } from './crm-n8n.repo';
import { CrmN8nService } from './crm-n8n.service';
import { N8nSegredoGuard } from './n8n-segredo.guard';

/**
 * Entradas do CRM que não vêm do app: a captura pública de lead (publico/leads) e as integrações
 * do n8n (integracoes/n8n/*). PrismaService vem do PrismaModule global.
 */
@Module({
  controllers: [CapturaLeadController, CrmN8nController],
  providers: [CapturaLeadService, CapturaLeadRepo, CrmN8nService, CrmN8nRepo, N8nSegredoGuard],
})
export class CrmIntegracoesModule {}
