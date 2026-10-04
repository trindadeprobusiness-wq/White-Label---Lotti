import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { ImoveisModule } from './imoveis/imoveis.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [EnvModule, PrismaModule, ImoveisModule],
})
export class AppModule {}
