import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AsaasCobrancaService } from './asaas/asaas-cobranca.service';
import { AsaasConexaoController } from './asaas/asaas-conexao.controller';
import { AsaasConexaoService } from './asaas/asaas-conexao.service';
import { AsaasFila } from './asaas/asaas-fila';
import { FETCH_ASAAS } from './asaas/asaas-http';
import { AsaasWebhookController } from './asaas/asaas-webhook.controller';
import { AsaasWebhookService } from './asaas/asaas-webhook.service';
import { FaturasController } from './faturas.controller';
import { FaturasService } from './faturas.service';
import { LancamentosController } from './lancamentos.controller';
import { LancamentosService } from './lancamentos.service';
import { RepassesController } from './repasses.controller';
import { RepassesService } from './repasses.service';
import { ServicoDb } from './servico-db';

@Module({
  controllers: [LancamentosController, FaturasController, RepassesController, AsaasConexaoController, AsaasWebhookController],
  providers: [SupabaseAuthGuard, ServicoDb, LancamentosService, FaturasService, RepassesService,
    AsaasCobrancaService, AsaasConexaoService, AsaasWebhookService, AsaasFila,
    { provide: FETCH_ASAAS, useValue: globalThis.fetch.bind(globalThis) }],
})
export class FinanceiroModule {}
