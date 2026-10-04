import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppEnv, ENV } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  /** Formato aceito pelo BullMQ: new Queue(nome, { connection: redis.connection }). */
  readonly connection: { url: string };
  private readonly client: Redis;

  constructor(@Inject(ENV) env: AppEnv) {
    this.connection = { url: env.redisUrl };
    this.client = new Redis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
