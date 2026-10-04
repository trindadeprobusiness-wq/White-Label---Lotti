import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AgenteVisitasController } from './agente-visitas.controller';
import { VisitasController } from './visitas.controller';
import { VisitasService } from './visitas.service';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('rotas da visita', () => {
  let app: INestApplication;
  const service = {
    solicitar: jest.fn(async () => ({ visitaId: 'v1', situacao: 'agendada', routineEventId: 'evt1' })),
    confirmar: jest.fn(async () => ({ routineEventId: 'evt1' })),
  };
  const libera: CanActivate = {
    canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = { sub: 'u1', role: 'authenticated' }; return true; },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgenteVisitasController, VisitasController],
      providers: [{ provide: VisitasService, useValue: service }],
    }).overrideGuard(AgentTokenGuard).useValue(libera).overrideGuard(SupabaseAuthGuard).useValue(libera).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('agente pede visita com corpo válido', async () => {
    const body = { conversationId: UUID, corretorId: UUID, data: '2026-10-07', hora: '15:30', imovelId: null };
    const res = await request(app.getHttpServer()).post('/api/agente/visitas').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ visitaId: 'v1', situacao: 'agendada', routineEventId: 'evt1' });
    expect(service.solicitar).toHaveBeenCalledWith(body);
  });

  it('recusa data ou hora em formato errado', async () => {
    for (const bad of [{ data: '07/10/2026', hora: '15:30' }, { data: '2026-10-07', hora: '25:00' }, { data: '2026-10-07', hora: '9h' }]) {
      const res = await request(app.getHttpServer()).post('/api/agente/visitas').send({ conversationId: UUID, corretorId: UUID, ...bad });
      expect(res.status).toBe(400);
    }
    expect(service.solicitar).not.toHaveBeenCalled();
  });

  it('confirmar repassa as claims de quem clicou', async () => {
    const res = await request(app.getHttpServer()).post(`/api/visitas/${UUID}/confirmar`);
    expect(res.status).toBe(201);
    expect(service.confirmar).toHaveBeenCalledWith({ sub: 'u1', role: 'authenticated' }, UUID);
  });

  it('confirmar recusa id que não é uuid', async () => {
    const res = await request(app.getHttpServer()).post('/api/visitas/abc/confirmar');
    expect(res.status).toBe(400);
  });
});
