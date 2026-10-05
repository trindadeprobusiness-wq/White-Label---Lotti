import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { AsaasConexaoController } from './asaas-conexao.controller';
import { AsaasConexaoService } from './asaas-conexao.service';
import { AsaasWebhookController } from './asaas-webhook.controller';
import { AsaasWebhookService } from './asaas-webhook.service';

const claims = { sub: 'u1', role: 'authenticated' };

describe('AsaasConexaoController e AsaasWebhookController', () => {
  let app: INestApplication;
  const conexao = {
    status: jest.fn(async () => ({ disponivel: true, conexao: null })),
    conectar: jest.fn(async () => ({ ok: true })),
    desconectar: jest.fn(async () => ({ ok: true, aviso: null })),
  };
  const webhook = { receber: jest.fn(async () => ({ received: true })) };
  const guard: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [AsaasConexaoController, AsaasWebhookController],
      providers: [{ provide: AsaasConexaoService, useValue: conexao }, { provide: AsaasWebhookService, useValue: webhook }],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());

  it('conexão usa o guard; o webhook é público', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AsaasConexaoController)).toEqual([SupabaseAuthGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AsaasWebhookController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, AsaasWebhookController.prototype.receber)).toBeUndefined();
  });

  it('GET, POST (200) e DELETE (200) da conexão; ambiente inválido ou campo extra → 400', async () => {
    expect((await http().get('/api/financeiro/asaas/conexao')).body).toEqual({ disponivel: true, conexao: null });
    const ok = await http().post('/api/financeiro/asaas/conexao').send({ api_key: '$aact_x', ambiente: 'sandbox' });
    expect(ok.status).toBe(200);
    expect(conexao.conectar).toHaveBeenCalledWith(claims, { api_key: '$aact_x', ambiente: 'sandbox' });
    expect((await http().post('/api/financeiro/asaas/conexao').send({ api_key: '$aact_x', ambiente: 'prod' })).status).toBe(400);
    expect((await http().post('/api/financeiro/asaas/conexao').send({ api_key: '$aact_x', ambiente: 'sandbox', corretor_id: 'x' })).status).toBe(400);
    expect((await http().delete('/api/financeiro/asaas/conexao')).status).toBe(200);
  });

  it('webhook: 200, slug da query, cabeçalhos e corpo cru (sem DTO)', async () => {
    const res = await http().post('/api/financeiro/asaas/webhook?t=slug-a').set('asaas-access-token', 'tok').send({ event: 'PAYMENT_RECEIVED', extra: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const [slug, cab, corpo] = (webhook.receber.mock.calls[0] as unknown) as [string, Record<string, unknown>, unknown];
    expect(slug).toBe('slug-a');
    expect(cab['asaas-access-token']).toBe('tok');
    expect(corpo).toEqual({ event: 'PAYMENT_RECEIVED', extra: 1 });
  });
});
