import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { ImoveisPublicoController } from './imoveis-publico.controller';
import { ImoveisPublicoRepo } from './imoveis-publico.repo';
import { ImoveisPublicoService } from './imoveis-publico.service';

/**
 * Rotas públicas da vitrine com o pipe global de produção (forbidNonWhitelisted): parâmetro extra na
 * query não pode virar 400, e os erros saem no formato `{ error }` das Edge Functions.
 */
describe('ImoveisPublicoController', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };
  const ID = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [ImoveisPublicoController],
      providers: [ImoveisPublicoService, ImoveisPublicoRepo, { provide: PrismaService, useValue: prisma }],
    }).compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => prisma.$queryRaw.mockReset());

  const sql = (i = 0) => prisma.$queryRaw.mock.calls[i][0] as Prisma.Sql;

  it('lista com os filtros na query, aceita parâmetro extra e devolve { data, total, limit, offset }', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ total: 7, imoveis: [{
      id: ID, titulo: 'Casa', tipo: 'CASA', valor: 500000, area_m2: 120, dormitorios: 3, banheiros: 2, garagem: 2, endereco: 'Rua',
      bairro: 'Centro', cidade: 'Anápolis', estado: 'GO', descricao: 'd', descricao_curta: null, created_at: '2026-10-05T00:00:00+00:00',
      imovel_fotos: [], venda: false, aluguel: true,
    }] }]);
    const r = await request(app.getHttpServer())
      .get('/api/publico/imoveis?tipo=Aluguel&limit=2&offset=4&bairro=Cen&preco_min=1&preco_max=900000&quartos_min=1&tipo_imovel=casa&utm_source=x&_=1')
      .expect(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.body).toEqual({
      data: [expect.objectContaining({ id: ID, tipo_negocio: 'aluguel', tipo_imovel: 'CASA', valor: 500000, foto_principal: null, fotos: [] })],
      total: 7, limit: 2, offset: 4,
    });
    // Os filtros chegam ao SQL já normalizados, na ordem em que aparecem na consulta.
    expect(sql().values).toEqual(['aluguel', 'aluguel', 'aluguel', 'CASA', 'CASA', 'Cen', 'Cen', 1, 1, 900000, 900000, 1, 1, 2, 4]);
  });

  it('a consulta nunca lê colunas do proprietário', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ total: 0, imoveis: [] }]);
    await request(app.getHttpServer()).get('/api/publico/imoveis').expect(200);
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get(`/api/publico/imoveis/detalhe?id=${ID}`).expect(404);
    for (const i of [0, 1]) {
      expect(sql(i).text).not.toMatch(/proprietario|select \* from public|to_jsonb\([ix]\)|\b[ix]\.\*/);
      expect(sql(i).text).toContain("status_venda = 'DISPONIVEL'");
    }
    expect(sql(0).text).toContain('fa.ativo = true');
    expect(sql(1).text).toContain('i.anunciado = true');
  });

  it('erros no formato { error } da Edge', async () => {
    const r400 = await request(app.getHttpServer()).get('/api/publico/imoveis?limit=99').expect(400);
    expect(r400.body).toEqual({ error: 'Parâmetro numérico inválido.' });
    const semId = await request(app.getHttpServer()).get('/api/publico/imoveis/detalhe').expect(400);
    expect(semId.body).toEqual({ error: 'Parâmetro "id" é obrigatório' });
    prisma.$queryRaw.mockResolvedValueOnce([]);
    const r404 = await request(app.getHttpServer()).get(`/api/publico/imoveis/detalhe?id=${ID}`).expect(404);
    expect(r404.body).toEqual({ error: 'Imóvel não encontrado ou não disponível' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falha do banco não vaza detalhe: 500 com o texto genérico', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('relation "x" does not exist'));
    const lista = await request(app.getHttpServer()).get('/api/publico/imoveis').expect(500);
    expect(lista.body).toEqual({ error: 'Não foi possível carregar os dados.' });
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const detalhe = await request(app.getHttpServer()).get(`/api/publico/imoveis/detalhe?id=${ID}`).expect(500);
    expect(detalhe.body).toEqual({ error: 'Não foi possível carregar os dados. Tente novamente.' });
  });

  it('detalhe com similares', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{
      imovel: {
        id: ID, titulo: 'Apto', tipo: 'APARTAMENTO', valor: 300000, area_m2: 80, dormitorios: 2, banheiros: 1, garagem: 1, endereco: 'Rua',
        bairro: 'B', cidade: 'C', estado: 'GO', cep: '1', descricao: null, descricao_curta: null, status_venda: 'DISPONIVEL',
        finalidade: 'VENDA', created_at: '2026-10-05T00:00:00+00:00', imovel_fotos: [{ id: 'f', arquivo_url: 'u', ordem: 0, principal: true }],
      },
      similares: [],
    }]);
    const r = await request(app.getHttpServer()).get(`/api/publico/imoveis/detalhe?id=${ID}`).expect(200);
    expect(r.body).toEqual({ data: expect.objectContaining({ id: ID, tipo_negocio: 'venda', foto_principal: 'u', fotos: ['u'], cep: '1' }), similares: [] });
    expect(sql().values).toEqual([ID]);
  });
});
