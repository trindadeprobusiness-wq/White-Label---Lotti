import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantDb } from './tenant-db';

@Global()
@Module({
  providers: [PrismaService, TenantDb],
  exports: [PrismaService, TenantDb],
})
export class PrismaModule {}
