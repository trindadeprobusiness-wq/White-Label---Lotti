import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { erroApi } from './imoveis.erros';
import { ImoveisController } from './imoveis.controller';
import { ImoveisGestaoService } from './imoveis-gestao.service';
import { ImoveisFotosController } from './imoveis-fotos.controller';
import { ImoveisFotosService } from './imoveis-fotos.service';
import { ImoveisVendaEventoService } from './imoveis-venda-evento.service';
import { ImoveisService } from './imoveis.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: 'u1', role: 'authenticated' };
const MSG_TIPO = 'Tipo de imóvel inválido. Use apartamento, casa, comercial ou terreno.';

const NOVO = {
  titulo: 'Casa no Jundiaí',
  tipo: 'CASA',
  valor: 450000,
  endereco: 'Rua 1, 10',
  cidade: 'Anápolis',
  proprietario_nome: '',
};

describe('ImoveisController (gestão)', () => {
  let app: INestApplication;
  const busca = { buscar: jest.fn(async (_c: unknown, _f: unknown) => [{ id: 'i1' }]) };
  const gestao = {
    listar: jest.fn(async (_c: unknown) => [{ id: A }]),
    obter: jest.fn(async (_c: unknown, _id: string) => ({ id: A })),
    listarClientesInteressados: jest.fn(async (_c: unknown, _id: string) => [{ id: B, nome: 'Bia' }]),
    criar: jest.fn(async (_c: unknown, _d: unknown) => ({ id: A }) as Record<string, unknown>),
    atualizar: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ id: A }) as Record<string, unknown>),
    remover: jest.fn(async (_c: unknown, _id: string) => undefined),
    registrarVenda: jest.fn(async (_c: unknown, id: string, _d: unknown) => ({
      imovel_id: id, status_venda: 'VENDIDO' as const, cliente_atualizado: false,
    })),
  };
  const eventoVenda = { enfileirar: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ enfileirado: true as const, id: C })) };
  const fotos = {
    listar: jest.fn(async (_c: unknown, _id: string) => [{ id: C }] as Record<string, unknown>[]),
    criar: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ id: C }) as Record<string, unknown>),
    remover: jest.fn(async (_c: unknown, _id: string) => undefined),
    reordenar: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ atualizadas: 2 })),
    definirPrincipal: jest.fn(async (_c: unknown, id: string, fotoId: string) => ({ imovel_id: id, foto_id: fotoId })),
    resumo: jest.fn(async (_c: unknown, _d: unknown) => []),
  };
  const libera: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [ImoveisController, ImoveisFotosController],
      providers: [
        { provide: ImoveisService, useValue: busca },
        { provide: ImoveisGestaoService, useValue: gestao },
        { provide: ImoveisVendaEventoService, useValue: eventoVenda },
        { provide: ImoveisFotosService, useValue: fotos },
      ],
    }).overrideGuard(SupabaseAuthGuard).useValue(libera).compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const http = () => request(app.getHttpServer());

  it('GET /api/imoveis/busca continua na busca e não é capturada por :id', async () => {
    const res = await http().get('/api/imoveis/busca');
    expect(res.status).toBe(200);
    expect(busca.buscar).toHaveBeenCalled();
    expect(gestao.obter).not.toHaveBeenCalled();
  });

  it('id que não é uuid responde 400 id_invalido em português', async () => {
    const res = await http().get('/api/imoveis/nao-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ statusCode: 400, codigo: 'id_invalido', message: 'Identificador inválido.' });
    expect(gestao.obter).not.toHaveBeenCalled();
    expect((await http().patch('/api/imoveis/nao-uuid').send({ titulo: 'X' })).body.codigo).toBe('id_invalido');
    expect((await http().delete('/api/imoveis/nao-uuid')).body.codigo).toBe('id_invalido');
    expect((await http().get('/api/imoveis/nao-uuid/clientes-interessados')).body.codigo).toBe('id_invalido');
    expect((await http().post('/api/imoveis/nao-uuid/venda').send({})).body.codigo).toBe('id_invalido');
  });

  it('GET /api/imoveis lista com as claims', async () => {
    const res = await http().get('/api/imoveis');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: A }]);
    expect(gestao.listar).toHaveBeenCalledWith(claims);
  });

  it('GET /api/imoveis/:id e /clientes-interessados', async () => {
    const um = await http().get(`/api/imoveis/${A}`);
    expect(um.status).toBe(200);
    expect(um.body).toEqual({ id: A });
    expect(gestao.obter).toHaveBeenCalledWith(claims, A);
    const interessados = await http().get(`/api/imoveis/${A}/clientes-interessados`);
    expect(interessados.status).toBe(200);
    expect(interessados.body).toEqual([{ id: B, nome: 'Bia' }]);
    expect(gestao.listarClientesInteressados).toHaveBeenCalledWith(claims, A);
  });

  it('404 do service chega com o corpo combinado', async () => {
    gestao.obter.mockRejectedValueOnce(erroApi(404, 'imovel_nao_encontrado', 'Imóvel não encontrado.'));
    const res = await http().get(`/api/imoveis/${A}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' });
  });

  describe('POST /api/imoveis', () => {
    it('cria com 201 e repassa o corpo validado (proprietario_nome vazio é aceito)', async () => {
      const res = await http().post('/api/imoveis').send({ ...NOVO, bairro: null, ativo: true });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: A });
      expect(gestao.criar).toHaveBeenCalledWith(claims, { ...NOVO, bairro: null, ativo: true });
    });

    it('tipo RURAL responde 400 com o texto do tipo', async () => {
      const res = await http().post('/api/imoveis').send({ ...NOVO, tipo: 'RURAL' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain(MSG_TIPO);
      expect(gestao.criar).not.toHaveBeenCalled();
    });

    it('corretor_id no corpo responde 400', async () => {
      const res = await http().post('/api/imoveis').send({ ...NOVO, corretor_id: B });
      expect(res.status).toBe(400);
      expect(gestao.criar).not.toHaveBeenCalled();
    });

    it('dormitórios acima de 999 responde 400 em português', async () => {
      const res = await http().post('/api/imoveis').send({ ...NOVO, dormitorios: 1000 });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Quantidade de dormitórios inválida.');
    });

    it('ativo null responde 400', async () => {
      const res = await http().post('/api/imoveis').send({ ...NOVO, ativo: null });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Valor inválido para ativo.');
      expect(gestao.criar).not.toHaveBeenCalled();
    });

    it('campos obrigatórios e valor negativo respondem em português', async () => {
      const res = await http().post('/api/imoveis').send({ ...NOVO, titulo: undefined, valor: -1 });
      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(expect.arrayContaining(['Informe o título do imóvel.', 'O valor não pode ser negativo.']));
    });

    it('402 de cota chega com codigo e recurso', async () => {
      gestao.criar.mockRejectedValueOnce(erroApi(402, 'PLAN_LIMIT_REACHED',
        'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.', { recurso: 'max_imoveis' }));
      const res = await http().post('/api/imoveis').send(NOVO);
      expect(res.status).toBe(402);
      expect(res.body).toMatchObject({ codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_imoveis' });
    });
  });

  describe('PATCH /api/imoveis/:id', () => {
    it('corpo vazio chega ao service, que responde 400', async () => {
      gestao.atualizar.mockRejectedValueOnce(erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.'));
      const res = await http().patch(`/api/imoveis/${A}`).send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ statusCode: 400, codigo: 'nada_para_atualizar', message: 'Nada para atualizar.' });
      expect(gestao.atualizar).toHaveBeenCalledWith(claims, A, {});
    });

    it('aceita anunciado e bairro null', async () => {
      const res = await http().patch(`/api/imoveis/${A}`).send({ anunciado: true, bairro: null });
      expect(res.status).toBe(200);
      expect(gestao.atualizar).toHaveBeenCalledWith(claims, A, { anunciado: true, bairro: null });
    });

    it('recusa ativo, status_venda e descricao, e anunciado null', async () => {
      for (const corpo of [{ ativo: false }, { status_venda: 'VENDIDO' }, { descricao: 'x' }, { corretor_id: B }]) {
        expect((await http().patch(`/api/imoveis/${A}`).send(corpo)).status).toBe(400);
      }
      const nulo = await http().patch(`/api/imoveis/${A}`).send({ anunciado: null });
      expect(nulo.status).toBe(400);
      expect(nulo.body.message).toContain('Valor inválido para anunciado.');
      expect(gestao.atualizar).not.toHaveBeenCalled();
    });
  });

  describe('texto com caractere nulo (o jsonb recusaria com 22P05 e viraria 500)', () => {
    const NUL = 'a\u0000b';
    const CASOS: Array<[string, string]> = [
      ['titulo', 'O título tem um caractere inválido.'],
      ['endereco', 'O endereço tem um caractere inválido.'],
      ['bairro', 'O bairro tem um caractere inválido.'],
      ['cidade', 'A cidade tem um caractere inválido.'],
      ['proprietario_nome', 'O nome do proprietário tem um caractere inválido.'],
    ];

    it('POST recusa em cada campo de texto com 400 em português', async () => {
      for (const [campo, mensagem] of CASOS) {
        const res = await http().post('/api/imoveis').send({ ...NOVO, bairro: 'Centro', [campo]: NUL });
        expect(res.status).toBe(400);
        expect(res.body.message).toEqual([mensagem]);
      }
      expect(gestao.criar).not.toHaveBeenCalled();
    });

    it('PATCH recusa em cada campo de texto com 400 em português', async () => {
      for (const [campo, mensagem] of CASOS) {
        const res = await http().patch(`/api/imoveis/${A}`).send({ [campo]: NUL });
        expect(res.status).toBe(400);
        expect(res.body.message).toEqual([mensagem]);
      }
      expect(gestao.atualizar).not.toHaveBeenCalled();
    });

    it('tipo errado não ganha a mensagem do caractere, e texto comum com acento e quebra de linha passa', async () => {
      const tipo = await http().post('/api/imoveis').send({ ...NOVO, cidade: 123 });
      expect(tipo.status).toBe(400);
      expect(tipo.body.message).toContain('Informe a cidade.');
      expect(tipo.body.message).not.toContain('A cidade tem um caractere inválido.');
      const comum = await http().patch(`/api/imoveis/${A}`).send({ titulo: 'Casa\tnova\nem Anápolis' });
      expect(comum.status).toBe(200);
      expect(gestao.atualizar).toHaveBeenCalledWith(claims, A, { titulo: 'Casa\tnova\nem Anápolis' });
    });
  });

  describe('DELETE /api/imoveis/:id', () => {
    it('responde 204 sem corpo', async () => {
      const res = await http().delete(`/api/imoveis/${A}`);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(gestao.remover).toHaveBeenCalledWith(claims, A);
    });

    it('contrato vinculado chega como 409 com sqlstate', async () => {
      gestao.remover.mockRejectedValueOnce(erroApi(409, 'imovel_com_contrato', 'Existem contratos vinculados a este imóvel.', { sqlstate: '23503' }));
      const res = await http().delete(`/api/imoveis/${A}`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        statusCode: 409, codigo: 'imovel_com_contrato', message: 'Existem contratos vinculados a este imóvel.', sqlstate: '23503',
      });
    });
  });

  describe('POST /api/imoveis/:id/venda', () => {
    it('responde 200 com o resultado da venda', async () => {
      const res = await http().post(`/api/imoveis/${A}/venda`).send({ cliente_id: B });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ imovel_id: A, status_venda: 'VENDIDO', cliente_atualizado: false });
      expect(gestao.registrarVenda).toHaveBeenCalledWith(claims, A, { cliente_id: B });
    });

    it('aceita sem cliente e com cliente null', async () => {
      expect((await http().post(`/api/imoveis/${A}/venda`).send({})).status).toBe(200);
      expect((await http().post(`/api/imoveis/${A}/venda`).send({ cliente_id: null })).status).toBe(200);
      expect(gestao.registrarVenda).toHaveBeenCalledTimes(2);
    });

    it('cliente_id que não é uuid responde 400 em português', async () => {
      const res = await http().post(`/api/imoveis/${A}/venda`).send({ cliente_id: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cliente inválido.');
      expect(gestao.registrarVenda).not.toHaveBeenCalled();
    });

    it('paridade: id fora do v4 é aceito igual na URL e no corpo', async () => {
      const res = await http().post(`/api/imoveis/${NAO_V4}/venda`).send({ cliente_id: NAO_V4 });
      expect(res.status).toBe(200);
      expect(gestao.registrarVenda).toHaveBeenCalledWith(claims, NAO_V4, { cliente_id: NAO_V4 });
    });
  });

  describe('POST /api/imoveis/:id/venda/evento', () => {
    it('responde 200 e repassa valor e cliente; não cai na rota da venda', async () => {
      const res = await http().post(`/api/imoveis/${A}/venda/evento`).send({ valor: 500000, cliente_id: B });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enfileirado: true, id: C });
      expect(eventoVenda.enfileirar).toHaveBeenCalledWith(claims, A, { valor: 500000, cliente_id: B });
      expect(gestao.registrarVenda).not.toHaveBeenCalled();
    });

    it('valor negativo ou texto e campo fora do DTO respondem 400', async () => {
      expect((await http().post(`/api/imoveis/${A}/venda/evento`).send({ valor: -1 })).body.message)
        .toContain('O valor da venda não pode ser negativo.');
      expect((await http().post(`/api/imoveis/${A}/venda/evento`).send({ valor: '10' })).status).toBe(400);
      expect((await http().post(`/api/imoveis/${A}/venda/evento`).send({ payload: { x: 1 } })).status).toBe(400);
      expect(eventoVenda.enfileirar).not.toHaveBeenCalled();
    });
  });

  describe('fotos (ImoveisFotosController)', () => {
    it('GET /api/imoveis/:id/fotos lista e não é capturada por :id', async () => {
      const res = await http().get(`/api/imoveis/${A}/fotos`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: C }]);
      expect(fotos.listar).toHaveBeenCalledWith(claims, A);
      expect(gestao.obter).not.toHaveBeenCalled();
    });

    it('POST /api/imoveis/:id/fotos valida o corpo e repassa', async () => {
      const corpo = { arquivo_path: `${A}/1_casa.jpg`, arquivo_url: 'https://api.exemplo/api/arquivos/publico/foto/x.jpg', principal: true };
      const res = await http().post(`/api/imoveis/${A}/fotos`).send(corpo);
      expect(res.status).toBe(201);
      expect(fotos.criar).toHaveBeenCalledWith(claims, A, corpo);
      const semUrl = await http().post(`/api/imoveis/${A}/fotos`).send({ ...corpo, arquivo_url: 'javascript:alert(1)' });
      expect(semUrl.status).toBe(400);
      expect(semUrl.body.message).toContain('Endereço da foto inválido.');
      const nul = await http().post(`/api/imoveis/${A}/fotos`).send({ ...corpo, arquivo_path: `${A}/a\u0000.jpg` });
      expect(nul.body.message).toContain('Caminho da foto inválido.');
      expect((await http().post(`/api/imoveis/${A}/fotos`).send({ ...corpo, principal: 'sim' })).status).toBe(400);
      expect(fotos.criar).toHaveBeenCalledTimes(1);
    });

    it('DELETE /api/imoveis/fotos/:fotoId responde 204 e não cai no DELETE do imóvel', async () => {
      const res = await http().delete(`/api/imoveis/fotos/${C}`);
      expect(res.status).toBe(204);
      expect(fotos.remover).toHaveBeenCalledWith(claims, C);
      expect(gestao.remover).not.toHaveBeenCalled();
      expect((await http().delete('/api/imoveis/fotos/x')).status).toBe(400);
    });

    it('PATCH /api/imoveis/:id/fotos/ordem exige ids únicos', async () => {
      const ok = await http().patch(`/api/imoveis/${A}/fotos/ordem`).send({ ids: [C, B] });
      expect(ok.status).toBe(200);
      expect(fotos.reordenar).toHaveBeenCalledWith(claims, A, { ids: [C, B] });
      const repetido = await http().patch(`/api/imoveis/${A}/fotos/ordem`).send({ ids: [C, C] });
      expect(repetido.status).toBe(400);
      expect(repetido.body.message).toContain('A mesma foto apareceu duas vezes na ordem.');
      expect((await http().patch(`/api/imoveis/${A}/fotos/ordem`).send({ ids: [] })).status).toBe(400);
      expect(gestao.atualizar).not.toHaveBeenCalled();
    });

    it('PATCH /api/imoveis/:id/fotos/:fotoId/principal', async () => {
      const res = await http().patch(`/api/imoveis/${A}/fotos/${C}/principal`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ imovel_id: A, foto_id: C });
      expect(fotos.definirPrincipal).toHaveBeenCalledWith(claims, A, C);
    });

    it('POST /api/imoveis/fotos/resumo responde 200 e recusa id inválido', async () => {
      const res = await http().post('/api/imoveis/fotos/resumo').send({ imovel_ids: [A, B] });
      expect(res.status).toBe(200);
      expect(fotos.resumo).toHaveBeenCalledWith(claims, { imovel_ids: [A, B] });
      const ruim = await http().post('/api/imoveis/fotos/resumo').send({ imovel_ids: ['x'] });
      expect(ruim.status).toBe(400);
      expect(ruim.body.message).toContain('Imóvel inválido.');
    });
  });
});
