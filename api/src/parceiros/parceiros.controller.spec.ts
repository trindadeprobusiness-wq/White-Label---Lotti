import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ConviteService } from './convite/convite.service';
import { DiagnosticoPublicoController } from './diagnostico/diagnostico-publico.controller';
import { DiagnosticoService } from './diagnostico/diagnostico.service';
import { ParceirosController } from './parceiros.controller';
import { PortalService } from './portal/portal.service';
import { ParceirosPublicoController } from './publico/parceiros-publico.controller';
import { ParceirosPublicoService } from './publico/parceiros-publico.service';

const A = '11111111-1111-4111-8111-111111111111';
const V4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const claims = { sub: A, role: 'authenticated', email: 'a@x.com' };

describe('Controllers de parceiros', () => {
  let app: INestApplication;
  let autenticou = 0;
  const publico = {
    registrarClique: jest.fn(async () => ({ ok: true, parceiro_nome: 'Ana' })),
    reivindicarAtribuicao: jest.fn(async () => ({ ok: true })),
  };
  const portal = {
    painel: jest.fn(async () => ({ teto_renovacoes: null })),
    salvarRepasse: jest.fn(async () => ({ salvo: true })),
  };
  const convite = { convidar: jest.fn(async () => ({ ok: true })) };
  const diagnostico = { receber: jest.fn(async () => ({ success: true })) };
  const guard: CanActivate = {
    canActivate: (ctx) => { autenticou += 1; ctx.switchToHttp().getRequest().claims = claims; return true; },
  };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ParceirosPublicoController, DiagnosticoPublicoController, ParceirosController],
      providers: [
        { provide: ParceirosPublicoService, useValue: publico },
        { provide: PortalService, useValue: portal },
        { provide: ConviteService, useValue: convite },
        { provide: DiagnosticoService, useValue: diagnostico },
      ],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); autenticou = 0; });

  it('P1 é público: 200 sem guard, e recebe os cabeçalhos', async () => {
    const r = await http().post('/parceiros/clique').send({ slug: 'parceiro-ana', visitante_id: V4 }).expect(200);
    expect(r.body).toEqual({ ok: true, parceiro_nome: 'Ana' });
    expect(autenticou).toBe(0);
    expect(publico.registrarClique).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'parceiro-ana', visitante_id: V4 }),
      expect.objectContaining({ host: expect.any(String) }),
    );
  });

  it('D1 é público', async () => {
    await http().post('/diagnostico-comercial').send({ action: 'event', session_id: V4, event: 'cta_clicked' }).expect(200);
    expect(autenticou).toBe(0);
    expect(diagnostico.receber).toHaveBeenCalledWith({ action: 'event', session_id: V4, event: 'cta_clicked' });
  });

  it('o clique recusa slug e visitante fora do formato', async () => {
    await http().post('/parceiros/clique').send({ slug: 'AB', visitante_id: V4 }).expect(400);
    await http().post('/parceiros/clique').send({ slug: 'parceiro-ana', visitante_id: '11111111-1111-1111-1111-111111111111' }).expect(400);
    await http().post('/parceiros/clique').send({ slug: 'parceiro-ana', visitante_id: V4, extra: 1 }).expect(400);
    expect(publico.registrarClique).not.toHaveBeenCalled();
  });

  it('T1–T4 passam pelo guard e recebem as claims', async () => {
    await http().post('/parceiros/atribuicao').send({ visitante_id: V4 }).expect(200);
    expect(publico.reivindicarAtribuicao).toHaveBeenCalledWith(claims, expect.objectContaining({ visitante_id: V4 }));
    await http().get('/parceiros/portal').expect(200);
    expect(portal.painel).toHaveBeenCalledWith(claims);
    await http().put('/parceiros/portal/repasse')
      .send({ documento: '12345678901', tipo_chave: 'cpf', chave: '12345678901' }).expect(200);
    expect(portal.salvarRepasse).toHaveBeenCalledWith(claims, expect.objectContaining({ tipo_chave: 'cpf' }));
    await http().post('/parceiros/convites').send({ parceiro_id: A }).expect(200);
    expect(convite.convidar).toHaveBeenCalledWith(claims, expect.objectContaining({ parceiro_id: A }));
    expect(autenticou).toBe(4);
  });

  it('o convite exige dados em acao=criar e parceiro_id no reenvio', async () => {
    await http().post('/parceiros/convites').send({ acao: 'criar' }).expect(400);
    await http().post('/parceiros/convites').send({}).expect(400);
    await http().post('/parceiros/convites').send({ acao: 'criar', dados: { parceiro: { nome: 'Ana' } } }).expect(200);
  });

  it('o repasse recusa tipo de chave desconhecido', async () => {
    await http().put('/parceiros/portal/repasse')
      .send({ documento: '12345678901', tipo_chave: 'boleto', chave: '12345678901' }).expect(400);
  });
});
