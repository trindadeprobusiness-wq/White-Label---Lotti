import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AsaasCobrancaService } from './asaas/asaas-cobranca.service';
import { FaturasController } from './faturas.controller';
import { FaturasService } from './faturas.service';
import { erroApi } from './financeiro.erros';

const A = '11111111-1111-4111-8111-111111111111';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: 'u1', role: 'authenticated' };

describe('FaturasController', () => {
  let app: INestApplication;
  const faturas = {
    contratosAtivos: jest.fn(async () => [{ id: A }]),
    resumoLocacao: jest.fn(async () => ({ contratos_ativos: 1, soma_valor: 2000 })),
    listarFaturas: jest.fn(async () => [{ id: A }]),
    garantirFatura: jest.fn(async () => ({ id: A, criada: true })),
    alterarVencimento: jest.fn(async () => ({ id: A })),
    darBaixa: jest.fn(async () => ({ id: A })),
    estornar: jest.fn(async () => ({ status: 'PENDENTE' })),
    cancelar: jest.fn(async () => ({ id: A })),
    reativar: jest.fn(async () => ({ id: A })),
  };
  const cobranca = {
    acao: jest.fn(async () => ({ ok: true, avisos: [] })),
    saldo: jest.fn(async (): Promise<unknown> => ({ balance: 1 })),
  };
  const guard: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [FaturasController],
      providers: [{ provide: FaturasService, useValue: faturas }, { provide: AsaasCobrancaService, useValue: cobranca }],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => [...Object.values(faturas), ...Object.values(cobranca)].forEach((f) => f.mockClear()));

  it('usa o SupabaseAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FaturasController)).toEqual([SupabaseAuthGuard]);
  });

  it('rotas estáticas: contratos-ativos, locacao/resumo, asaas/saldo, faturas', async () => {
    expect((await http().get('/api/financeiro/contratos-ativos')).body).toEqual([{ id: A }]);
    expect((await http().get('/api/financeiro/locacao/resumo')).body).toEqual({ contratos_ativos: 1, soma_valor: 2000 });
    expect((await http().get('/api/financeiro/asaas/saldo')).body).toEqual({ balance: 1 });
    expect((await http().get('/api/financeiro/faturas')).body).toEqual([{ id: A }]);
  });

  it('saldo 409 ASAAS_NAO_CONECTADO leva nao_conectado', async () => {
    cobranca.saldo.mockRejectedValueOnce(erroApi(409, 'ASAAS_NAO_CONECTADO', 'Este corretor ainda não conectou uma conta Asaas.', { nao_conectado: true }));
    const res = await http().get('/api/financeiro/asaas/saldo');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ statusCode: 409, codigo: 'ASAAS_NAO_CONECTADO', message: 'Este corretor ainda não conectou uma conta Asaas.', nao_conectado: true });
  });

  it('POST faturas 200; valor ou corretor no corpo → 400; contrato não-v4 aceito', async () => {
    const corpo = { contrato_id: NAO_V4, mes_referencia: '10/2026', data_vencimento: '2026-10-10' };
    const ok = await http().post('/api/financeiro/faturas').send(corpo);
    expect(ok.status).toBe(200);
    expect(faturas.garantirFatura).toHaveBeenCalledWith(claims, corpo);
    expect((await http().post('/api/financeiro/faturas').send({ ...corpo, valor_aluguel: 1 })).status).toBe(400);
    expect((await http().post('/api/financeiro/faturas').send({ ...corpo, corretor_id: A })).status).toBe(400);
    expect((await http().post('/api/financeiro/faturas').send({ ...corpo, mes_referencia: '2026-10' })).status).toBe(400);
  });

  it('ações por :id com 200 e id validado', async () => {
    expect((await http().patch(`/api/financeiro/faturas/${A}/vencimento`).send({ data_vencimento: '2026-11-10' })).status).toBe(200);
    expect((await http().post(`/api/financeiro/faturas/${NAO_V4}/baixa`).send({ data_pagamento: '2026-10-05' })).status).toBe(200);
    expect(faturas.darBaixa).toHaveBeenCalledWith(claims, NAO_V4, { data_pagamento: '2026-10-05' });
    expect((await http().post(`/api/financeiro/faturas/${A}/baixa`).send({ data_pagamento: '2026-10-05', valor_pago: 1 })).status).toBe(400);
    expect((await http().post(`/api/financeiro/faturas/${A}/estorno`)).body).toEqual({ status: 'PENDENTE' });
    expect((await http().post(`/api/financeiro/faturas/${A}/cancelar`)).status).toBe(200);
    expect((await http().post(`/api/financeiro/faturas/${A}/reativar`)).status).toBe(200);
    const ruim = await http().post('/api/financeiro/faturas/xyz/cancelar');
    expect(ruim.status).toBe(400);
    expect(ruim.body.codigo).toBe('id_invalido');
  });

  it('POST faturas/:id/asaas valida a ação', async () => {
    const ok = await http().post(`/api/financeiro/faturas/${A}/asaas`).send({ acao: 'receber_em_dinheiro', data_pagamento: '2026-10-05' });
    expect(ok.status).toBe(200);
    expect(cobranca.acao).toHaveBeenCalledWith(claims, A, { acao: 'receber_em_dinheiro', data_pagamento: '2026-10-05' });
    expect((await http().post(`/api/financeiro/faturas/${A}/asaas`).send({ acao: 'saldo' })).status).toBe(400);
  });
});
