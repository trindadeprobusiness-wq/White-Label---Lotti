import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { ArquivosModule } from './arquivos/arquivos.module';
import { AuthModule } from './auth/auth.module';
import { AssinaturaModule } from './assinatura/assinatura.module';
import { ContratosModule } from './contratos/contratos.module';
import { CrmClientesModule } from './crm/clientes/crm-clientes.module';
import { CrmFunilModule } from './crm/funil/crm-funil.module';
import { FachadasModule } from './fachadas/fachadas.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { HealthController } from './health/health.controller';
import { ImoveisModule } from './imoveis/imoveis.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { ParceirosModule } from './parceiros/parceiros.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RotinaModule } from './rotina/rotina.module';
import { StorageModule } from './storage/storage.module';
import { VisitasModule } from './visitas/visitas.module';

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
    ContratosModule,
    FinanceiroModule,
    RotinaModule,
    FachadasModule,
    AssinaturaModule,
    ParceirosModule,
    NotificacoesModule,
    VisitasModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
