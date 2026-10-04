import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';

const prismaOk = { $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) };
const prismaFail = { $queryRaw: jest.fn(async () => { throw new Error('down'); }) };
const redis = (ok: boolean) => ({ ping: jest.fn(async () => ok) });

describe('HealthController', () => {
  it('ok quando banco e Redis respondem', async () => {
    const body = await new HealthController(prismaOk as never, redis(true) as never).health();
    expect(body).toMatchObject({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('503 quando o banco falha', async () => {
    await expect(new HealthController(prismaFail as never, redis(true) as never).health()).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ status: 'degraded', checks: { database: 'fail', redis: 'ok' } }),
    });
  });

  it('503 quando o Redis falha', async () => {
    const promise = new HealthController(prismaOk as never, redis(false) as never).health();
    await expect(promise).rejects.toBeInstanceOf(HttpException);
    await expect(promise).rejects.toMatchObject({ status: 503 });
  });
});
