import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PerfilController } from './perfil.controller';
import { PerfilService } from './perfil.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const claims = { sub: 'u1', role: 'authenticated' };

describe('PerfilController', () => {
  let app: INestApplication;
  const servico = {
    obter: jest.fn(async () => ({ corretor: { id: 'c1', nome: 'Ana' }, corretor_id: 'c1' })),
    atualizar: jest.fn(async (_c: unknown, d: Record<string, unknown>) => ({ id: 'c1', ...d })),
    registrarAtividade: jest.fn(async () => undefined),
  };
  const libera: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [PerfilController],
      providers: [{ provide: PerfilService, useValue: servico }],
    }).overrideGuard(SupabaseAuthGuard).useValue(libera).compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('GET /api/perfil/corretor devolve a linha e o corretor da conta', async () => {
    const res = await http().get('/api/perfil/corretor');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ corretor: { id: 'c1', nome: 'Ana' }, corretor_id: 'c1' });
    expect(servico.obter).toHaveBeenCalledWith(claims);
  });

  it('PATCH /api/perfil/corretor aceita os campos do formulário e a foto (null limpa)', async () => {
    const corpo = {
      nome: ' Ana Souza ', creci: '12345-F', creci_estado: 'GO', email: 'ana@x.com', telefone: '(62) 99999-0000',
      endereco: '', website: '', razao_social: 'Ana Imóveis', cnpj_cpf: '', endereco_completo: '', foto_url: null,
    };
    const res = await http().patch('/api/perfil/corretor').send(corpo);
    expect(res.status).toBe(200);
    expect(servico.atualizar).toHaveBeenCalledWith(claims, expect.objectContaining({ ...corpo, nome: 'Ana Souza' }));
  });

  it('PATCH recusa colunas fora da lista (status, user_id, preferencias) com 400', async () => {
    for (const extra of [{ status: 'ativo' }, { user_id: 'x' }, { preferencias: {} }, { id: 'c2' }]) {
      const res = await http().patch('/api/perfil/corretor').send({ nome: 'Ana', ...extra });
      expect(res.status).toBe(400);
    }
    expect(servico.atualizar).not.toHaveBeenCalled();
  });

  it('PATCH recusa e-mail inválido, UF fora de 2 letras e nome nulo', async () => {
    expect((await http().patch('/api/perfil/corretor').send({ email: 'nao-e-email' })).status).toBe(400);
    expect((await http().patch('/api/perfil/corretor').send({ creci_estado: 'GOI' })).status).toBe(400);
    expect((await http().patch('/api/perfil/corretor').send({ nome: null })).status).toBe(400);
    expect(servico.atualizar).not.toHaveBeenCalled();
  });

  it('POST /api/perfil/atividade responde 204 e só aceita os tipos da função', async () => {
    const ok = await http().post('/api/perfil/atividade').send({ tipo: 'login', rota: '/inicio' });
    expect(ok.status).toBe(204);
    expect(servico.registrarAtividade).toHaveBeenCalledWith(claims, { tipo: 'login', rota: '/inicio' });
    expect((await http().post('/api/perfil/atividade').send({ tipo: 'outro' })).status).toBe(400);
  });
});
