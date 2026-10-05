import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { RepassesController } from './repasses.controller';
import { RepassesService } from './repasses.service';

const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: 'u1', role: 'authenticated' };

describe('RepassesController', () => {
  let app: INestApplication;
  const servico = {
    listar: jest.fn(async () => [{ id: NAO_V4 }]),
    confirmar: jest.fn(async () => ({ id: NAO_V4, status: 'CONFIRMADO' })),
  };
  const guard: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };

  beforeAll(async () => {
    const m = await Test.createTestingModule({ controllers: [RepassesController], providers: [{ provide: RepassesService, useValue: servico }] })
      .overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());

  it('guard, lista e confirmar com 200; id inválido → 400', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RepassesController)).toEqual([SupabaseAuthGuard]);
    expect((await request(app.getHttpServer()).get('/api/financeiro/repasses')).body).toEqual([{ id: NAO_V4 }]);
    const ok = await request(app.getHttpServer()).post(`/api/financeiro/repasses/${NAO_V4}/confirmar`);
    expect(ok.status).toBe(200);
    expect(servico.confirmar).toHaveBeenCalledWith(claims, NAO_V4);
    expect((await request(app.getHttpServer()).post('/api/financeiro/repasses/x/confirmar')).body.codigo).toBe('id_invalido');
  });
});
