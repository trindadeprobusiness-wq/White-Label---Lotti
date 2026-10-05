import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ContratosIaController } from './contratos-ia.controller';
import { ContratosIaService } from './contratos-ia.service';
import { ContratosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: 'u1', role: 'authenticated' };

const locacao = (extra: Record<string, unknown> = {}) => ({
  cliente_id: A, imovel_id: B, valor: 1500, data_inicio: '2026-10-01', dia_vencimento: 10, conteudo: '{}', ...extra,
});

describe('controllers de contratos, documentos e IA', () => {
  let app: INestApplication;
  const contratos = {
    listar: jest.fn(async () => [{ id: A }]),
    listarCentral: jest.fn(async () => [{ id: 'central' }]),
    listarLocacao: jest.fn(async () => [{ id: 'locacao' }]),
    listarDosClientes: jest.fn(async () => []),
    criar: jest.fn(async () => ({ id: A })),
    criarLocacao: jest.fn(async () => ({ contrato: { id: A }, fatura: { id: B } })),
    editarLocacao: jest.fn(async () => ({ contrato: { id: A }, faturas_emitidas: [] })),
    alterar: jest.fn(async () => ({ id: A })),
    remover: jest.fn(async () => undefined),
  };
  const documentos = {
    listar: jest.fn(async () => []),
    criar: jest.fn(async () => ({ id: A })),
    alterar: jest.fn(async () => ({ id: A })),
    remover: jest.fn(async () => undefined),
  };
  const ia = {
    gerar: jest.fn(async () => ({ contrato: 'x', modelo_ia: 'm', prompt_version: 'v', tempo_geracao_ms: 1 })),
    analisar: jest.fn(async () => ({ dados: {} })),
  };
  const guard: CanActivate = {
    canActivate: (ctx) => {
      ctx.switchToHttp().getRequest().claims = claims;
      return true;
    },
  };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContratosIaController, ContratosController, DocumentosController],
      providers: [
        { provide: ContratosService, useValue: contratos },
        { provide: DocumentosService, useValue: documentos },
        { provide: ContratosIaService, useValue: ia },
      ],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => [contratos, documentos, ia].forEach((s) => Object.values(s).forEach((f) => f.mockClear())));

  it('rotas estáticas não caem em :id', async () => {
    expect((await http().get('/api/contratos/central')).body).toEqual([{ id: 'central' }]);
    expect((await http().get('/api/contratos/locacao?tipo=LOCACAO_COMERCIAL')).body).toEqual([{ id: 'locacao' }]);
    expect(contratos.listarLocacao).toHaveBeenCalledWith(claims, { tipo: 'LOCACAO_COMERCIAL' });
    expect((await http().get('/api/contratos/locacao?tipo=COMPRA_VENDA')).status).toBe(400);
    expect((await http().post('/api/contratos/ia/gerar').send({ tipo: 'x', cliente: {}, imovel: {}, detalhes: {} })).status).toBe(200);
    expect(ia.gerar).toHaveBeenCalled();
    expect((await http().get('/api/contratos')).body).toEqual([{ id: A }]);
  });

  it('POST /contratos: 201; corretor_id e campos de IA → 400; tipo OUTRO → 400 em português', async () => {
    const base = { tipo: 'COMPRA_VENDA', valor: 10, data_inicio: '2026-01-01', conteudo: '' };
    expect((await http().post('/api/contratos').send(base)).status).toBe(201);
    for (const extra of [{ corretor_id: A }, { versao: 1 }, { modelo_ia: 'x' }, { tempo_geracao_ms: 1 }]) {
      expect((await http().post('/api/contratos').send({ ...base, ...extra })).status).toBe(400);
    }
    const r = await http().post('/api/contratos').send({ ...base, tipo: 'OUTRO' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Tipo de contrato inválido.');
    expect((await http().post('/api/contratos').send({ ...base, data_inicio: '01/01/2026' })).body.message).toContain('Data de início inválida.');
    expect((await http().post('/api/contratos').send({ ...base, status: null })).body.message).toContain('Status do contrato inválido.');
    expect((await http().post('/api/contratos').send({ ...base, cliente_id: null, data_fim: null })).status).toBe(201);
    expect(contratos.criar).toHaveBeenCalledTimes(2);
  });

  it('POST /contratos/locacao: 201; sem primeira_fatura ou mês inválido → 400', async () => {
    const primeira = { data_vencimento: '2026-11-10', mes_referencia: '11/2026' };
    expect((await http().post('/api/contratos/locacao').send(locacao({ primeira_fatura: primeira }))).status).toBe(201);
    expect((await http().post('/api/contratos/locacao').send(locacao())).body.message).toContain('Informe a primeira fatura.');
    const r = await http().post('/api/contratos/locacao').send(locacao({ primeira_fatura: { ...primeira, mes_referencia: '13/2026' } }));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.message)).toContain('Mês de referência inválido.');
    expect((await http().post('/api/contratos/locacao').send(locacao({ valor: 0, primeira_fatura: primeira }))).body.message).toContain('Informe um valor válido.');
  });

  it('paridade de uuid não v4 na URL e no corpo', async () => {
    const r = await http().patch(`/api/contratos/${NAO_V4}/locacao`).send(locacao({ cliente_id: NAO_V4 }));
    expect(r.status).toBe(200);
    expect(contratos.editarLocacao).toHaveBeenCalledWith(claims, NAO_V4, expect.objectContaining({ cliente_id: NAO_V4 }));
    const ruim = await http().patch('/api/contratos/abc/locacao').send(locacao());
    expect(ruim.status).toBe(400);
    expect(ruim.body).toEqual({ statusCode: 400, codigo: 'id_invalido', message: 'Identificador inválido.' });
  });

  it('PATCH /contratos/:id e DELETE → 204', async () => {
    expect((await http().patch(`/api/contratos/${A}`).send({ status: 'ENCERRADO' })).status).toBe(200);
    expect((await http().patch(`/api/contratos/${A}`).send({ status: 'X' })).body.message).toContain('Status do contrato inválido.');
    expect((await http().delete(`/api/contratos/${A}`)).status).toBe(204);
    expect(contratos.remover).toHaveBeenCalledWith(claims, A);
  });

  it('POST /contratos/por-clientes: 200; lista vazia → 400', async () => {
    expect((await http().post('/api/contratos/por-clientes').send({ cliente_ids: [A] })).status).toBe(200);
    expect((await http().post('/api/contratos/por-clientes').send({ cliente_ids: [] })).body.message).toContain('Informe os clientes.');
  });

  it('documentos: 201, 400 em português, DELETE 204', async () => {
    expect((await http().post('/api/documentos').send({ nome: 'RG', tipo: 'RG', arquivo_path: 'x/y' })).status).toBe(201);
    expect((await http().post('/api/documentos').send({ nome: '', tipo: 'RG', arquivo_path: 'x/y' })).body.message).toContain('Informe o nome do documento.');
    expect((await http().patch(`/api/documentos/${A}`).send({ validado: 'sim' })).body.message).toContain('Valor inválido.');
    expect((await http().patch(`/api/documentos/${A}`).send({ updated_at: 'x' })).status).toBe(400);
    expect((await http().delete(`/api/documentos/${A}`)).status).toBe(204);
  });

  it('IA: analisar 200; mimeType inválido → 400 com o texto da função', async () => {
    expect((await http().post('/api/contratos/ia/analisar').send({ fileBase64: 'AAAA', mimeType: 'application/pdf' })).status).toBe(200);
    const r = await http().post('/api/contratos/ia/analisar').send({ fileBase64: 'AAAA', mimeType: 'text/plain' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Formato inválido. Envie PDF ou imagem (JPG, PNG, WEBP).');
    expect((await http().post('/api/contratos/ia/gerar').send({ tipo: 'x', cliente: 'Ana', imovel: {}, detalhes: {} })).body.message).toContain('Dados do contrato inválidos.');
  });
});
