import { Controller, Get, HttpCode, INestApplication, Post, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller';
import { AuthService, SessaoEmitida } from '../auth/auth.service';
import { opcoesCors, rotaPublicaComCors } from './cors';
import { AppEnv, ENV, loadEnv, ORIGEM_APP } from './env';

/**
 * O login próprio cruza origem: app.plataformalotti.com.br chama api.plataformalotti.com.br com
 * credentials:'include'. Aqui sobe o AuthController de verdade com o CORS do main.ts e confere o
 * que o navegador exige: preflight respondido, Allow-Credentials true, origem exata (nunca '*'),
 * e o cookie de refresh HttpOnly; Secure; SameSite=Lax; Path=/api/auth (mesmo site: viaja).
 */
describe('CORS do login próprio (app → api com cookie)', () => {
  let app: INestApplication;
  const sessao: SessaoEmitida = { accessToken: 'a.b.c', refreshToken: 'opaco', accessTtl: 900, refreshTtl: 2592000 };
  const servico = { login: jest.fn(async () => sessao), refresh: jest.fn(async () => sessao) };
  const env: AppEnv = {
    ...loadEnv({ DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x', AUTH_JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'production' }),
    authJwtSecret: 'segredo-proprio-com-mais-de-32-caracteres!!',
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: servico }, { provide: ENV, useValue: env }],
    }).compile();
    app = ref.createNestApplication();
    app.enableCors(opcoesCors(env));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());

  it('preflight do app: origem exata e Allow-Credentials', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', ORIGEM_APP)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_APP);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('login do app: resposta legível com credenciais e cookie de refresh cross-origin same-site', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', ORIGEM_APP)
      .send({ email: 'c@x.com', senha: 's' });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_APP);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('lotti_refresh=opaco');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('origem fora da lista não recebe Allow-Origin (o navegador bloqueia)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Origin', 'https://site-qualquer.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

@Controller('publico/imoveis')
class VitrineFalsa {
  @Get()
  listar() { return { data: [], total: 0 }; }
}

@Controller('publico/leads')
class CapturaFalsa {
  @Post()
  @HttpCode(200)
  capturar() { return { success: true }; }
}

/**
 * Rotas públicas que OUTROS sites chamam (vitrine e captura de lead). As Edge Functions respondiam
 * Access-Control-Allow-Origin: *; aqui continua assim por padrão, mas SEM credenciais, e o resto da
 * API segue só com as origens do app.
 */
describe('CORS das rotas públicas de outros sites', () => {
  const SITE = 'https://site-institucional.example';
  const servico = { login: jest.fn(), refresh: jest.fn() };

  async function subir(publicas?: string): Promise<INestApplication> {
    const env: AppEnv = loadEnv({
      DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x', AUTH_JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'production',
      ...(publicas === undefined ? {} : { PUBLIC_CORS_ORIGINS: publicas }),
    });
    const ref = await Test.createTestingModule({
      controllers: [AuthController, VitrineFalsa, CapturaFalsa],
      providers: [{ provide: AuthService, useValue: servico }, { provide: ENV, useValue: { ...env, authJwtSecret: 'x'.repeat(40) } }],
    }).compile();
    const app = ref.createNestApplication();
    app.enableCors(opcoesCors(env));
    app.setGlobalPrefix('api');
    await app.init();
    return app;
  }

  it('padrão: qualquer origem lê a vitrine e envia lead, sem Allow-Credentials', async () => {
    const app = await subir();
    try {
      const get = await request(app.getHttpServer()).get('/api/publico/imoveis?tipo=venda').set('Origin', SITE);
      expect(get.status).toBe(200);
      expect(get.headers['access-control-allow-origin']).toBe('*');
      expect(get.headers['access-control-allow-credentials']).toBeUndefined();

      const preflight = await request(app.getHttpServer())
        .options('/api/publico/leads?imovel_id=1')
        .set('Origin', SITE)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,apikey');
      expect(preflight.status).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('*');
      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
      expect(preflight.headers['access-control-allow-headers']).toContain('content-type');
      expect(preflight.headers['access-control-allow-headers']).not.toContain('x-n8n-secret');

      const post = await request(app.getHttpServer()).post('/api/publico/leads').set('Origin', SITE).send({});
      expect(post.headers['access-control-allow-origin']).toBe('*');
      expect(post.headers['access-control-expose-headers']).toBe('Retry-After');
    } finally {
      await app.close();
    }
  });

  it('o resto da API continua fechado para a mesma origem', async () => {
    const app = await subir();
    try {
      const res = await request(app.getHttpServer())
        .options('/api/auth/refresh')
        .set('Origin', SITE)
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      const doApp = await request(app.getHttpServer())
        .options('/api/auth/refresh')
        .set('Origin', ORIGEM_APP)
        .set('Access-Control-Request-Method', 'POST');
      expect(doApp.headers['access-control-allow-origin']).toBe(ORIGEM_APP);
      expect(doApp.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('com PUBLIC_CORS_ORIGINS só as origens da lista (e o app), ainda sem credenciais', async () => {
    const app = await subir(`${SITE}/`);
    try {
      const liberada = await request(app.getHttpServer()).get('/api/publico/imoveis').set('Origin', SITE);
      expect(liberada.headers['access-control-allow-origin']).toBe(SITE);
      expect(liberada.headers['access-control-allow-credentials']).toBeUndefined();
      const outra = await request(app.getHttpServer()).get('/api/publico/imoveis').set('Origin', 'https://outro.example');
      expect(outra.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('casa só os prefixos públicos, ignorando query, caixa e barra final', () => {
    expect(rotaPublicaComCors('/api/publico/imoveis')).toBe(true);
    expect(rotaPublicaComCors('/api/publico/imoveis/detalhe?id=x')).toBe(true);
    expect(rotaPublicaComCors('/API/Publico/Leads/?imovel_id=x')).toBe(true);
    expect(rotaPublicaComCors('/api/publico/diagnostico')).toBe(true);
    expect(rotaPublicaComCors('/api/diagnostico/manutencao')).toBe(false);
    expect(rotaPublicaComCors('/api/publico/imoveisx')).toBe(false);
    expect(rotaPublicaComCors('/api/publico/fachadas/1')).toBe(false);
    expect(rotaPublicaComCors('/api/integracoes/n8n/crm-upsert-lead')).toBe(false);
    expect(rotaPublicaComCors('/api/auth/refresh?x=/api/publico/leads')).toBe(false);
    expect(rotaPublicaComCors(undefined)).toBe(false);
  });
});
