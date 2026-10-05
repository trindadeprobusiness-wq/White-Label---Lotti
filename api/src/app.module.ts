import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { ContratosModule } from './contratos/contratos.module';
import { CrmClientesModule } from './crm/clientes/crm-clientes.module';
import { CrmFunilModule } from './crm/funil/crm-funil.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { HealthController } from './health/health.controller';
import { ImoveisModule } from './imoveis/imoveis.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RotinaModule } from './rotina/rotina.module';
import { VisitasModule } from './visitas/visitas.module';

@Module({
  imports: [
    EnvModule,
    PrismaModule,
    RedisModule,
    ImoveisModule,
    CrmClientesModule,
    CrmFunilModule,
    ContratosModule,
    FinanceiroModule,
    RotinaModule,
    NotificacoesModule,
    VisitasModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
