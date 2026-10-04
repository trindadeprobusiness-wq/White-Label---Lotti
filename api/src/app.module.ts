import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [EnvModule, PrismaModule],
})
export class AppModule {}
