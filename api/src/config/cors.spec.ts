import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller';
import { AuthService, SessaoEmitida } from '../auth/auth.service';
import { opcoesCors } from './cors';
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
    ...loadEnv({ DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x', SUPABASE_URL: 'https://abc.supabase.co', NODE_ENV: 'production' }),
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
