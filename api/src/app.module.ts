import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { AgendamentosModule } from './agendamentos/agendamentos.module';
import { ArquivosModule } from './arquivos/arquivos.module';
import { AuthModule } from './auth/auth.module';
import { AssinaturaModule } from './assinatura/assinatura.module';
import { ContratosModule } from './contratos/contratos.module';
import { CrmClientesModule } from './crm/clientes/crm-clientes.module';
import { CrmFunilModule } from './crm/funil/crm-funil.module';
import { CrmIntegracoesModule } from './crm/integracoes/crm-integracoes.module';
import { FachadasModule } from './fachadas/fachadas.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { HealthController } from './health/health.controller';
import { IaModule } from './ia/ia.module';
import { ImoveisModule } from './imoveis/imoveis.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { ParceirosModule } from './parceiros/parceiros.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RotinaModule } from './rotina/rotina.module';
import { StorageModule } from './storage/storage.module';
import { SuporteModule } from './suporte/suporte.module';
import { VisitasModule } from './visitas/visitas.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    StorageModule,
    ArquivosModule,
    ImoveisModule,
    CrmClientesModule,
    CrmFunilModule,
    CrmIntegracoesModule,
    ContratosModule,
    FinanceiroModule,
    RotinaModule,
    FachadasModule,
    AssinaturaModule,
    ParceirosModule,
    NotificacoesModule,
    VisitasModule,
    IaModule,
    AgendamentosModule,
    SuporteModule,
    WhatsappModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
