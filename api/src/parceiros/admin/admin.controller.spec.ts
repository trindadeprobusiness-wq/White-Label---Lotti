import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

const A = '11111111-1111-4111-8111-111111111111';
/** Aceito pelo FORMATO_UUID e pelo ParseUUIDPipe do módulo: não é v4 (módulo 2 §0.5). */
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: A, role: 'authenticated', email: 'admin@x.com' };

describe('AdminController', () => {
  let app: INestApplication;
  let autenticou = 0;
  const admin: Record<string, jest.Mock> = {
    papeis: jest.fn(async () => ['admin']),
    listarAuditoria: jest.fn(async () => ({})),
    registrarAuditoria: jest.fn(async () => ({ id: 1 })),
    listarParceiros: jest.fn(async () => ({})),
    opcoesParceiros: jest.fn(async () => ({})),
    parceiro: jest.fn(async () => ({})),
    criarParceiro: jest.fn(async () => ({ id: A })),
    editarParceiro: jest.fn(async () => ({ id: A })),
    definirPercentual: jest.fn(async () => ({})),
    criarLink: jest.fn(async () => ({ id: A, slug: 'ana' })),
    revogarLink: jest.fn(async () => ({ revogado: true })),
    listarComissoes: jest.fn(async () => ({})),
    transicionarComissao: jest.fn(async () => ({})),
    registrarPagamento: jest.fn(async () => ({})),
    listarReceita: jest.fn(async () => ({})),
    registrarReceita: jest.fn(async () => ({})),
    estornarReceita: jest.fn(async () => ({})),
    elegiveisRepasse: jest.fn(async () => ({})),
    listarLotes: jest.fn(async () => ({})),
    lote: jest.fn(async () => ({})),
    gerarLote: jest.fn(async () => ({})),
    marcarLoteExportado: jest.fn(async () => ({})),
    marcarLotePago: jest.fn(async () => ({})),
    cancelarLote: jest.fn(async () => ({})),
    listarUsuarios: jest.fn(async () => ({})),
    usuario: jest.fn(async () => ({})),
    definirStatusCorretor: jest.fn(async () => ({})),
    listarAtendimento: jest.fn(async () => ({})),
    listarAssinaturas: jest.fn(async () => ({})),
    listarPagamentos: jest.fn(async () => ({})),
    listarCancelamentos: jest.fn(async () => ({})),
    registrarCancelamento: jest.fn(async () => ({})),
    listarOrganizacoes: jest.fn(async () => ({})),
    organizacao: jest.fn(async () => ({})),
    listarAcessos: jest.fn(async () => ({})),
    metricas: jest.fn(async () => ({})),
    metricasSaas: jest.fn(async () => ({})),
    metricasCancelamento: jest.fn(async () => ({})),
    metricasOnboarding: jest.fn(async () => ({})),
    statusIntegracoes: jest.fn(async () => ({})),
    listarConfig: jest.fn(async () => ({})),
    listarLinhasConfig: jest.fn(async () => []),
    atualizarConfig: jest.fn(async () => ({})),
    salvarConfig: jest.fn(async () => ({})),
    listarDiagnosticos: jest.fn(async () => []),
    atualizarStatusDiagnostico: jest.fn(async () => ({})),
    listarDiagnosticosCrescimento: jest.fn(async () => ({ items: [], total: 0 })),
    diagnosticoCrescimento: jest.fn(async () => ({})),
  };
  const guard: CanActivate = {
    canActivate: (ctx) => { autenticou += 1; ctx.switchToHttp().getRequest().claims = claims; return true; },
  };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: admin }],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); autenticou = 0; });

  it('toda rota passa pelo guard e recebe as claims', async () => {
    await http().get('/admin/papeis').expect(200);
    expect(autenticou).toBe(1);
    expect(admin.papeis).toHaveBeenCalledWith(claims);
  });

  it('as rotas estáticas vêm antes das rotas com :id', async () => {
    await http().get('/admin/parceiros/opcoes').expect(200);
    expect(admin.opcoesParceiros).toHaveBeenCalled();
    expect(admin.parceiro).not.toHaveBeenCalled();
    await http().get('/admin/config/linhas').expect(200);
    expect(admin.listarLinhasConfig).toHaveBeenCalled();
    await http().get('/admin/metricas/saas?inicio=2026-01-01&fim=2026-02-01').expect(200);
    expect(admin.metricasSaas).toHaveBeenCalled();
    expect(admin.metricas).not.toHaveBeenCalled();
  });

  it('ParseUUIDPipe devolve 400 id_invalido e aceita uuid sem versão v4', async () => {
    const r = await http().get('/admin/parceiros/nao-e-uuid').expect(400);
    expect(r.body).toMatchObject({ codigo: 'id_invalido', message: 'Identificador inválido.' });
    await http().get(`/admin/parceiros/${NAO_V4}`).expect(200);
    expect(admin.parceiro).toHaveBeenCalledWith(claims, NAO_V4);
  });

  it('paridade de uuid entre a URL e o corpo', async () => {
    await http().post('/admin/pagamentos-parceiro').send({ parceiro_id: NAO_V4, comissao_ids: [NAO_V4] }).expect(201);
    expect(admin.registrarPagamento).toHaveBeenCalledWith(claims, expect.objectContaining({ parceiro_id: NAO_V4 }));
  });

  it('a chave de configuração é validada', async () => {
    await http().put('/admin/config/programa_hold_dias').send({ valor: 7 }).expect(200);
    expect(admin.atualizarConfig).toHaveBeenCalledWith(claims, 'programa_hold_dias', { valor: 7 });
    const r = await http().put('/admin/config/Chave-Invalida').send({ valor: 7 }).expect(400);
    expect(r.body).toMatchObject({ codigo: 'chave_invalida' });
    await http().post('/admin/config/programa_hold_dias').send({ valor: { a: 1 } }).expect(200);
    expect(admin.salvarConfig).toHaveBeenCalledWith(claims, 'programa_hold_dias', { valor: { a: 1 } });
  });

  it('o ValidationPipe recusa chave desconhecida e valor ausente', async () => {
    await http().put('/admin/config/programa_hold_dias').send({}).expect(400);
    await http().post('/admin/parceiros').send({ nome: 'Ana', email: 'ana@x.com', status: 'ativo', user_id: A }).expect(400);
    await http().post('/admin/parceiros').send({ nome: 'Ana', email: 'ana@x.com', status: 'ativo', convite_status: 'aceito' }).expect(400);
    expect(admin.criarParceiro).not.toHaveBeenCalled();
  });

  it('os códigos de status seguem o contrato', async () => {
    await http().post('/admin/auditoria').send({ acao: 'x', entidade: 'y' }).expect(201);
    await http().post('/admin/parceiros').send({ nome: 'Ana', email: 'ana@x.com', status: 'ativo' }).expect(201);
    await http().post(`/admin/parceiros/${A}/percentuais`).send({ percentual: 10, base_calculo: 'receita_bruta' }).expect(201);
    await http().post(`/admin/parceiros/${A}/links`).send({ slug: 'ana-2026' }).expect(201);
    await http().post(`/admin/links/${A}/revogar`).expect(200);
    await http().post(`/admin/comissoes/${A}/status`).send({ novo_status: 'aprovada' }).expect(200);
    await http().post(`/admin/lotes/${A}/exportado`).expect(200);
    await http().post(`/admin/lotes/${A}/pago`).send({ pago_em: '2026-10-01', referencia: 'TED' }).expect(200);
    await http().post(`/admin/lotes/${A}/cancelar`).send({ motivo: 'erro na geracao' }).expect(200);
    await http().post(`/admin/receita/${A}/estornar`).send({ motivo: 'chargeback do cartao' }).expect(200);
    await http().patch(`/admin/diagnosticos/${A}`).send({ status: 'em_contato' }).expect(200);
  });

  it('origem_direta=false chega como false, e nao como o Boolean da string', async () => {
    await http().get('/admin/atendimento?origem_direta=false').expect(200);
    expect(admin.listarAtendimento).toHaveBeenCalledWith(claims, { origem_direta: false });
    await http().get('/admin/atendimento?origem_direta=true').expect(200);
    expect(admin.listarAtendimento).toHaveBeenLastCalledWith(claims, { origem_direta: true });
    await http().get('/admin/atendimento?origem_direta=talvez').expect(400);
  });

  it('Diagnóstico de Crescimento: filtros e offset/limite convertidos; :id validado', async () => {
    await http().get('/admin/diagnosticos-crescimento?busca=ana&status=completed&temperatura=HOT&segmento=real_estate&origem=ig&offset=25&limite=25').expect(200);
    expect(admin.listarDiagnosticosCrescimento).toHaveBeenCalledWith(claims, {
      busca: 'ana', status: 'completed', temperatura: 'HOT', segmento: 'real_estate', origem: 'ig', offset: 25, limite: 25,
    });
    await http().get('/admin/diagnosticos-crescimento?limite=1000').expect(400);
    await http().get('/admin/diagnosticos-crescimento?offset=-1').expect(400);
    await http().get('/admin/diagnosticos-crescimento?outro=1').expect(400);
    await http().get(`/admin/diagnosticos-crescimento/${A}`).expect(200);
    expect(admin.diagnosticoCrescimento).toHaveBeenCalledWith(claims, A);
    expect(admin.atualizarStatusDiagnostico).not.toHaveBeenCalled();
    await http().get('/admin/diagnosticos-crescimento/nao-e-uuid').expect(400);
  });

  it('a paginação chega convertida em número', async () => {
    await http().get('/admin/parceiros?pagina=3&por_pagina=10&busca=ana').expect(200);
    expect(admin.listarParceiros).toHaveBeenCalledWith(claims, { pagina: 3, por_pagina: 10, busca: 'ana' });
    await http().get('/admin/parceiros?pagina=0').expect(400);
  });
});
