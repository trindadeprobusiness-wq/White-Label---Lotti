import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { HealthController } from './health/health.controller';
import { ImoveisModule } from './imoveis/imoveis.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { VisitasModule } from './visitas/visitas.module';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, ImoveisModule, NotificacoesModule, VisitasModule],
  controllers: [HealthController],
})
export class AppModule {}
