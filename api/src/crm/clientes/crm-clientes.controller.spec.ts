import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { CrmClientesController } from './crm-clientes.controller';
import { CrmClientesService } from './crm-clientes.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: 'u1', role: 'authenticated' };

describe('CrmClientesController', () => {
  let app: INestApplication;
  const servico = {
    listar: jest.fn(async (_c: unknown) => [{ id: A, cliente_imovel: [] }]),
    buscarCandidatos: jest.fn(async (_c: unknown, _q: unknown) => [] as unknown),
    criar: jest.fn(async (_c: unknown, _d: unknown) => ({ status: 'created', cliente_id: A }) as unknown),
    converterLead: jest.fn(async (_c: unknown, _d: unknown) => ({ status: 'ja_convertido', cliente_id: A }) as unknown),
    obter: jest.fn(async (_c: unknown, _id: string) => ({ id: A })),
    atualizar: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ id: A })),
    remover: jest.fn(async (_c: unknown, _id: string) => undefined),
    moverNoFunil: jest.fn(async (_c: unknown, id: string, _d: unknown) => ({ id })),
    definirImovelInteresse: jest.fn(async (_c: unknown, id: string, d: { imovel_id?: string | null }) => ({ cliente_id: id, imovel_id: d.imovel_id ?? null })),
    completarCpf: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ atualizado: true })),
    listarHistorico: jest.fn(async (_c: unknown, _id: string) => [] as unknown[]),
    listarHistoricoGeral: jest.fn(async (_c: unknown) => [{ id: B }] as unknown[]),
    registrarHistorico: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ id: B })),
  };
  const libera: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [CrmClientesController],
      providers: [{ provide: CrmClientesService, useValue: servico }],
    }).overrideGuard(SupabaseAuthGuard).useValue(libera).compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('GET /api/clientes lista com as claims', async () => {
    const res = await http().get('/api/clientes');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: A, cliente_imovel: [] }]);
    expect(servico.listar).toHaveBeenCalledWith(claims);
  });

  describe('GET /api/clientes/candidatos', () => {
    it('não é capturada por :id e repassa só os filtros enviados', async () => {
      const res = await http().get('/api/clientes/candidatos?telefone=&email=a%40b.com');
      expect(res.status).toBe(200);
      expect(servico.obter).not.toHaveBeenCalled();
      expect(servico.buscarCandidatos).toHaveBeenCalledWith(claims, expect.objectContaining({ telefone: '', email: 'a@b.com' }));
      expect((servico.buscarCandidatos.mock.calls[0][1] as Record<string, unknown>).cpf).toBeUndefined();
    });

    it('filtro grande demais vira 400 em português', async () => {
      const res = await http().get(`/api/clientes/candidatos?telefone=${'9'.repeat(41)}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Telefone inválido.');
      expect(servico.buscarCandidatos).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/clientes', () => {
    it('responde 200 com o jsonb da função; nome vazio chega ao service (quem recusa é o banco)', async () => {
      const corpo = { nome: '', telefone: '', tracking_data: { utm_source: 'google' } };
      const res = await http().post('/api/clientes').send(corpo);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'created', cliente_id: A });
      expect(servico.criar).toHaveBeenCalledWith(claims, expect.objectContaining(corpo));
    });

    it('recusa corretor_id com 400', async () => {
      const res = await http().post('/api/clientes').send({ nome: 'Ana', telefone: '1', corretor_id: A });
      expect(res.status).toBe(400);
      expect(servico.criar).not.toHaveBeenCalled();
    });

    it('observações com 5001 caracteres viram 400 em português', async () => {
      const res = await http().post('/api/clientes').send({ nome: 'Ana', telefone: '1', observacoes: 'x'.repeat(5001) });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('As observações podem ter até 5000 caracteres.');
    });

    it('status do funil fora do enum vira 400', async () => {
      const res = await http().post('/api/clientes').send({ nome: 'Ana', telefone: '1', status_funil: 'Sem etapa' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Etapa do funil inválida.');
    });
  });

  describe('POST /api/clientes/converter-lead', () => {
    it('responde 200 e repassa o corpo', async () => {
      const res = await http().post('/api/clientes/converter-lead').send({ lead_id: A, etapa_id: null, nome: 'Ana', email: null });
      expect(res.status).toBe(200);
      expect(servico.converterLead).toHaveBeenCalledWith(claims, expect.objectContaining({ lead_id: A, etapa_id: null, nome: 'Ana', email: null }));
    });

    it('lead_id fora do formato vira 400 em português', async () => {
      const res = await http().post('/api/clientes/converter-lead').send({ lead_id: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Lead inválido.');
    });
  });

  describe('rotas com :id', () => {
    it('id fora do formato vira 400 id_invalido', async () => {
      const res = await http().get('/api/clientes/nao-uuid');
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ codigo: 'id_invalido', message: 'Identificador inválido.' });
      expect(servico.obter).not.toHaveBeenCalled();
    });

    it('GET /api/clientes/:id', async () => {
      const res = await http().get(`/api/clientes/${A}`);
      expect(res.status).toBe(200);
      expect(servico.obter).toHaveBeenCalledWith(claims, A);
    });

    it('PATCH /api/clientes/:id chega ao service; tipo de interesse inválido vira 400', async () => {
      const ok = await http().patch(`/api/clientes/${A}`).send({ ultimo_contato: '2026-10-04T12:00:00.000Z' });
      expect(ok.status).toBe(200);
      expect(servico.atualizar).toHaveBeenCalledWith(claims, A, expect.objectContaining({ ultimo_contato: '2026-10-04T12:00:00.000Z' }));
      const ruim = await http().patch(`/api/clientes/${A}`).send({ tipo_interesse: 'ALUGUEL' });
      expect(ruim.status).toBe(400);
      expect(ruim.body.message).toContain('Tipo de interesse inválido.');
    });

    it('PATCH /api/clientes/:id recusa cpf (fora da edição) com 400', async () => {
      const res = await http().patch(`/api/clientes/${A}`).send({ cpf: '12345678909' });
      expect(res.status).toBe(400);
      expect(servico.atualizar).not.toHaveBeenCalled();
    });

    it('DELETE /api/clientes/:id responde 204 sem corpo', async () => {
      const res = await http().delete(`/api/clientes/${A}`);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(servico.remover).toHaveBeenCalledWith(claims, A);
    });

    it('PATCH /api/clientes/:id/status', async () => {
      const ok = await http().patch(`/api/clientes/${A}/status`).send({ status_funil: 'FECHADO_GANHO' });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ id: A });
      const ruim = await http().patch(`/api/clientes/${A}/status`).send({ status_funil: 'GANHO' });
      expect(ruim.status).toBe(400);
      expect(ruim.body.message).toContain('Etapa do funil inválida.');
    });
  });

  describe('PUT /api/clientes/:id/imovel-interesse', () => {
    it('imovel_id fora do formato vira 400 em português', async () => {
      const res = await http().put(`/api/clientes/${A}/imovel-interesse`).send({ imovel_id: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Imóvel inválido.');
      expect(servico.definirImovelInteresse).not.toHaveBeenCalled();
    });

    it('paridade URL x corpo: id não v4 nos dois chega ao service', async () => {
      const res = await http().put(`/api/clientes/${NAO_V4}/imovel-interesse`).send({ imovel_id: NAO_V4 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cliente_id: NAO_V4, imovel_id: NAO_V4 });
      expect(servico.definirImovelInteresse).toHaveBeenCalledWith(claims, NAO_V4, expect.objectContaining({ imovel_id: NAO_V4 }));
    });

    it('imovel_id null remove o vínculo', async () => {
      const res = await http().put(`/api/clientes/${A}/imovel-interesse`).send({ imovel_id: null });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ cliente_id: A, imovel_id: null });
    });
  });

  describe('POST /api/clientes/:id/completar-cpf', () => {
    it('responde 200 com 11 dígitos', async () => {
      const res = await http().post(`/api/clientes/${A}/completar-cpf`).send({ cpf: '12345678909' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ atualizado: true });
      expect(servico.completarCpf).toHaveBeenCalledWith(claims, A, expect.objectContaining({ cpf: '12345678909' }));
    });

    it('recusa 123 com a mensagem em português', async () => {
      const res = await http().post(`/api/clientes/${A}/completar-cpf`).send({ cpf: '123' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('CPF/CNPJ deve ter 11 ou 14 dígitos.');
    });
  });

  describe('histórico', () => {
    it('GET /api/clientes/historico (sem cliente) não é capturada por :id', async () => {
      const res = await http().get('/api/clientes/historico');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: B }]);
      expect(servico.listarHistoricoGeral).toHaveBeenCalledWith(claims);
      expect(servico.obter).not.toHaveBeenCalled();
    });

    it('GET /api/clientes/:id/historico', async () => {
      const res = await http().get(`/api/clientes/${A}/historico`);
      expect(res.status).toBe(200);
      expect(servico.listarHistorico).toHaveBeenCalledWith(claims, A);
    });

    it('POST /api/clientes/:id/historico responde 201 e aceita metadata como objeto', async () => {
      const corpo = { tipo: 'WHATSAPP', direcao: 'OUT', conteudo: 'Olá', metadata: { tipo_ui: 'WHATSAPP', via: 'wa.me' } };
      const res = await http().post(`/api/clientes/${A}/historico`).send(corpo);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: B });
      expect(servico.registrarHistorico).toHaveBeenCalledWith(claims, A, expect.objectContaining(corpo));
    });

    it('canal fora do enum vira 400 em português; id e data_contato do cliente não são aceitos', async () => {
      const canal = await http().post(`/api/clientes/${A}/historico`).send({ tipo: 'LIGACAO', conteudo: 'Olá' });
      expect(canal.status).toBe(400);
      expect(canal.body.message).toContain('Canal de contato inválido.');
      const id = await http().post(`/api/clientes/${A}/historico`).send({ tipo: 'WHATSAPP', conteudo: 'Olá', id: B });
      expect(id.status).toBe(400);
      const data = await http().post(`/api/clientes/${A}/historico`).send({ tipo: 'WHATSAPP', conteudo: 'Olá', data_contato: '2026-10-04' });
      expect(data.status).toBe(400);
      expect(servico.registrarHistorico).not.toHaveBeenCalled();
    });
  });
});
