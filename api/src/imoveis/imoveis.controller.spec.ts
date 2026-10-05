import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ImoveisController } from './imoveis.controller';
import { ImoveisGestaoService } from './imoveis-gestao.service';
import { ImoveisService } from './imoveis.service';

describe('GET /api/imoveis/busca', () => {
  let app: INestApplication;
  const buscar = jest.fn(async (_claims: unknown, _filtros: unknown) => [{ id: 'i1' }]);
  let permitir = true;
  const guard: CanActivate = {
    canActivate: (ctx) => {
      if (!permitir) return false;
      ctx.switchToHttp().getRequest().claims = { sub: 'u1', role: 'authenticated' };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ImoveisController],
      providers: [{ provide: ImoveisService, useValue: { buscar } }, { provide: ImoveisGestaoService, useValue: {} }],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => { buscar.mockClear(); permitir = true; });

  it('converte os filtros da query e repassa com as claims', async () => {
    const res = await request(app.getHttpServer()).get('/api/imoveis/busca?cidade=An%C3%A1polis&valorMax=450000&dormitoriosMin=2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'i1' }]);
    expect(buscar).toHaveBeenCalledWith({ sub: 'u1', role: 'authenticated' }, { cidade: 'Anápolis', valorMax: 450000, dormitoriosMin: 2 });
  });

  it('recusa filtro inválido com 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/imoveis/busca?tipo=CASTELO');
    expect(res.status).toBe(400);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('recusa parâmetro desconhecido com 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/imoveis/busca?corretor_id=outro');
    expect(res.status).toBe(400);
  });

  it('sem login responde 403 e não consulta', async () => {
    permitir = false;
    const res = await request(app.getHttpServer()).get('/api/imoveis/busca');
    expect(res.status).toBe(403);
    expect(buscar).not.toHaveBeenCalled();
  });
});
