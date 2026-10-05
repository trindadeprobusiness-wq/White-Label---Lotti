import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { LancamentosController } from './lancamentos.controller';
import { LancamentosService } from './lancamentos.service';

const A = '11111111-1111-4111-8111-111111111111';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: 'u1', role: 'authenticated' };
const novo = { tipo: 'DESPESA', categoria: 'OUTROS', descricao: 'Conta', valor: 10.5, data: '2026-01-31' };

describe('LancamentosController', () => {
  let app: INestApplication;
  const servico = {
    listar: jest.fn(async (_c: unknown, _f: unknown) => [{ id: A }]),
    criar: jest.fn(async (_c: unknown, _d: unknown) => [{ id: A }]),
    alterar: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ id: A })),
    excluir: jest.fn(async (_c: unknown, _id: string) => undefined),
  };
  const guard: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const m = await Test.createTestingModule({ controllers: [LancamentosController], providers: [{ provide: LancamentosService, useValue: servico }] })
      .overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => Object.values(servico).forEach((f) => f.mockClear()));

  it('usa o SupabaseAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, LancamentosController)).toEqual([SupabaseAuthGuard]);
  });

  it('GET valida a query e repassa os filtros', async () => {
    const res = await http().get('/api/financeiro/lancamentos?tipo=RECEITA&de=2026-01-01');
    expect(res.status).toBe(200);
    expect(servico.listar).toHaveBeenCalledWith(claims, { tipo: 'RECEITA', de: '2026-01-01' });
    expect((await http().get('/api/financeiro/lancamentos?de=01/01/2026')).status).toBe(400);
    expect((await http().get('/api/financeiro/lancamentos?tipo=OUTRO')).status).toBe(400);
  });

  it('POST 201; corretor_id no corpo → 400; contrato_id com uuid não-v4 passa (paridade FORMATO_UUID)', async () => {
    expect((await http().post('/api/financeiro/lancamentos').send(novo)).status).toBe(201);
    expect(servico.criar).toHaveBeenCalledWith(claims, novo);
    const extra = await http().post('/api/financeiro/lancamentos').send({ ...novo, corretor_id: A });
    expect(extra.status).toBe(400);
    expect((await http().post('/api/financeiro/lancamentos').send({ ...novo, contrato_id: NAO_V4 })).status).toBe(201);
    const neg = await http().post('/api/financeiro/lancamentos').send({ ...novo, valor: -1 });
    expect(neg.status).toBe(400);
    expect(neg.body.message).toContain('O valor não pode ser negativo.');
  });

  it('PATCH e DELETE: id não-v4 aceito na URL; id inválido → 400 id_invalido; DELETE 204', async () => {
    expect((await http().patch(`/api/financeiro/lancamentos/${NAO_V4}`).send({ descricao: 'x' })).status).toBe(200);
    expect(servico.alterar).toHaveBeenCalledWith(claims, NAO_V4, { descricao: 'x' });
    const ruim = await http().patch('/api/financeiro/lancamentos/abc').send({ descricao: 'x' });
    expect(ruim.status).toBe(400);
    expect(ruim.body.codigo).toBe('id_invalido');
    expect((await http().patch(`/api/financeiro/lancamentos/${A}`).send({ status: 'pago' })).status).toBe(400);
    const del = await http().delete(`/api/financeiro/lancamentos/${A}`);
    expect(del.status).toBe(204);
    expect(servico.excluir).toHaveBeenCalledWith(claims, A);
  });
});
