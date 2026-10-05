import { CanActivate, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AssinaturaController } from './assinatura.controller';
import { AssinaturaService } from './assinatura.service';
import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';

const claims = { sub: 'u1', role: 'authenticated' };

describe('controllers de catálogo e assinatura', () => {
  let app: INestApplication;
  const assinatura = {
    atual: jest.fn(async (..._a: unknown[]) => ({ id: 's1' })),
    uso: jest.fn(async (..._a: unknown[]) => ({ period_start: '2026-10-01', period_end: '2026-10-31', contadores: [], ativos: { max_imoveis: 0, max_contratos_locacao: 0, max_fachadas: 0 } })),
    addons: jest.fn(async (..._a: unknown[]) => []),
    contaAntiga: jest.fn(async (..._a: unknown[]) => ({ sem_limite: false })),
    cota: jest.fn(async (..._a: unknown[]) => ({ permitido: true, usado: 0, limite: 10, ilimitado: false, habilitado: true })),
  };
  const catalogo = {
    listarPlanos: jest.fn(async (..._a: unknown[]) => [{ code: 'pro' }]),
    listarEntitlements: jest.fn(async (..._a: unknown[]) => [{ feature_key: 'max_imoveis' }]),
    campanhaAtiva: jest.fn(async (..._a: unknown[]) => null),
  };
  /** O guard do catálogo nunca roda (não há guard lá); no de assinatura, sem token é 401. */
  const guard: CanActivate = {
    canActivate: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      if (!req.headers.authorization) throw new UnauthorizedException('Sessão ausente.');
      req.claims = claims;
      return true;
    },
  };
  const http = () => request(app.getHttpServer());
  const token = { Authorization: 'Bearer t' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogoController, AssinaturaController],
      providers: [
        { provide: AssinaturaService, useValue: assinatura },
        { provide: CatalogoService, useValue: catalogo },
      ],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => [assinatura, catalogo].forEach((s) => Object.values(s).forEach((f) => f.mockClear())));

  it('C1/C2/C3 respondem sem Authorization (não há guard no catálogo)', async () => {
    expect((await http().get('/api/planos')).status).toBe(200);
    expect((await http().get('/api/planos/entitlements')).body).toEqual([{ feature_key: 'max_imoveis' }]);
    const campanha = await http().get('/api/planos/campanha');
    expect(campanha.status).toBe(200);
    expect(campanha.body).toEqual({});
    expect(catalogo.campanhaAtiva).toHaveBeenCalled();
  });

  it('as rotas de assinatura exigem token', async () => {
    expect((await http().get('/api/assinatura')).status).toBe(401);
    expect((await http().get('/api/assinatura/uso')).status).toBe(401);
    expect(assinatura.atual).not.toHaveBeenCalled();
  });

  it('A1–A4 chegam ao service com as claims', async () => {
    expect((await http().get('/api/assinatura').set(token)).body).toEqual({ id: 's1' });
    expect(assinatura.atual.mock.calls[0][0]).toEqual(claims);
    await http().get('/api/assinatura/uso').set(token).expect(200);
    await http().get('/api/assinatura/addons').set(token).expect(200);
    expect((await http().get('/api/assinatura/conta-antiga').set(token)).body).toEqual({ sem_limite: false });
  });

  it('rotas estáticas não caem em cota/:chave', async () => {
    await http().get('/api/assinatura/uso').set(token).expect(200);
    expect(assinatura.cota).not.toHaveBeenCalled();
  });

  it('A5: chave conhecida chega ao service; desconhecida vira 400 recurso_invalido', async () => {
    await http().get('/api/assinatura/cota/max_imoveis').set(token).expect(200);
    expect(assinatura.cota.mock.calls[0]).toEqual([claims, 'max_imoveis']);
    const r = await http().get('/api/assinatura/cota/qualquer_coisa').set(token);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ statusCode: 400, codigo: 'recurso_invalido', message: 'Recurso de cota desconhecido.' });
    expect(assinatura.cota).toHaveBeenCalledTimes(1);
  });
});
