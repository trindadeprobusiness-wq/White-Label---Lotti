import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CapturaLeadController } from './captura-lead.controller';
import { CapturaLeadService, EntradaCaptura } from './captura-lead.service';
import { CapturaLeadRepo } from './captura-lead.repo';

/**
 * A rota pública com o pipe e o analisador de JSON de produção (21 MB): corpo em text/plain (fetch
 * sem cabeçalho de uma landing page), teto de 16 KiB, cabeçalhos e o Retry-After do 429.
 */
describe('CapturaLeadController', () => {
  let app: NestExpressApplication;
  const repo = {
    consumirLimite: jest.fn(async () => true),
    donoDoImovel: jest.fn(async () => 'dono'),
    corretores: jest.fn(async () => ['owner-0']),
    gravarLeadSemDestino: jest.fn(async () => 1),
    upsertCliente: jest.fn(async () => ({ cliente_id: 'c1', created: true })),
    vincularImovel: jest.fn(async () => 1),
    criarAlertaDoLead: jest.fn(async () => 1),
    cota: jest.fn(),
    avisoDePlanoDesde: jest.fn(),
    criarAvisoDePlano: jest.fn(),
  };
  const salvo = process.env.PUBLIC_RATE_LIMIT_SECRET;

  beforeAll(async () => {
    process.env.PUBLIC_RATE_LIMIT_SECRET = 'segredo-de-teste';
    const ref = await Test.createTestingModule({
      controllers: [CapturaLeadController],
      providers: [CapturaLeadService, { provide: CapturaLeadRepo, useValue: repo }],
    }).compile();
    app = ref.createNestApplication<NestExpressApplication>();
    app.useBodyParser('json', { limit: '21mb' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    if (salvo === undefined) delete process.env.PUBLIC_RATE_LIMIT_SECRET;
    else process.env.PUBLIC_RATE_LIMIT_SECRET = salvo;
  });
  beforeEach(() => jest.clearAllMocks());

  const OK = { success: true, message: 'Recebemos seu contato! Em breve alguém falará com você.' };

  it('JSON com campo extra e ?imovel_id= na URL: 200 genérico, no-store e nosniff', async () => {
    const IMOVEL = '11111111-1111-4111-8111-111111111111';
    const r = await request(app.getHttpServer())
      .post(`/api/publico/leads?imovel_id=${IMOVEL}`)
      .send({ nome: 'Ana', telefone: '11999991234', campo_que_a_lp_manda: 1 })
      .expect(200);
    expect(r.body).toEqual(OK);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(repo.donoDoImovel).toHaveBeenCalledWith(IMOVEL);
  });

  it('text/plain com JSON (como a Edge aceitava) também entra', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/publico/leads')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify({ nome: 'Ana', telefone: '11999991234' }))
      .expect(200);
    expect(r.body).toEqual(OK);
    expect(repo.upsertCliente).toHaveBeenCalled();
  });

  it('corpo acima de 16 KiB → 413 sem tocar o banco', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/publico/leads')
      .send({ nome: 'Ana', telefone: '11999991234', mensagem: 'x'.repeat(20_000) })
      .expect(413);
    expect(r.body).toEqual({ success: false, error: 'Requisição muito grande.' });
    const texto = await request(app.getHttpServer())
      .post('/api/publico/leads')
      .set('Content-Type', 'text/plain')
      .send('x'.repeat(20_000))
      .expect(413);
    expect(texto.body).toEqual({ success: false, error: 'Requisição muito grande.' });
    expect(repo.consumirLimite).not.toHaveBeenCalled();
  });

  it('429 com Retry-After: 600; erro de validação no formato { success: false, error }', async () => {
    repo.consumirLimite.mockResolvedValueOnce(false);
    const r = await request(app.getHttpServer()).post('/api/publico/leads').send({ nome: 'Ana', telefone: '11999991234' }).expect(429);
    expect(r.headers['retry-after']).toBe('600');
    expect(r.body).toEqual({ success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const invalido = await request(app.getHttpServer()).post('/api/publico/leads').send({ nome: 'Ana', telefone: '123' }).expect(400);
    expect(invalido.headers['retry-after']).toBeUndefined();
    expect(invalido.body).toEqual({ success: false, error: 'Telefone inválido.' });
  });

  it('passa o segredo do cabeçalho e lê o corpo só depois dele', async () => {
    const servico = app.get(CapturaLeadService);
    const espiao = jest.spyOn(servico, 'capturar');
    await request(app.getHttpServer()).post('/api/publico/leads').set('x-n8n-secret', 'qualquer').send({ nome: 'Ana', telefone: '11999991234' }).expect(401);
    const arg = espiao.mock.calls[0][0] as EntradaCaptura;
    expect(arg.segredo).toBe('qualquer');
    expect(arg.imovelIdDaQuery).toBeNull();
    espiao.mockRestore();
  });
});
