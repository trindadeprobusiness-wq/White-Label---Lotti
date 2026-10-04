import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Get()
  async health() {
    let database: 'ok' | 'fail' = 'fail';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch {
      database = 'fail';
    }
    const redis: 'ok' | 'fail' = (await this.redis.ping()) ? 'ok' : 'fail';
    const ok = database === 'ok' && redis === 'ok';
    const body = { status: ok ? 'ok' : 'degraded', timestamp: new Date().toISOString(), checks: { database, redis } };
    if (!ok) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
