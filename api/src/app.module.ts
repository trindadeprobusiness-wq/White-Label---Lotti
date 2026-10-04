import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { HealthController } from './health/health.controller';
import { ImoveisModule } from './imoveis/imoveis.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, ImoveisModule],
  controllers: [HealthController],
})
export class AppModule {}
