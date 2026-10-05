import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { CrmFunilController } from './crm-funil.controller';
import { erroApi } from './crm-funil.erros';
import { CrmFunilService } from './crm-funil.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const TOKEN = '2026-10-04T12:34:56.123456+00:00';
const claims = { sub: 'u1', role: 'authenticated' };

const etapa = (extra: Record<string, unknown> = {}) => ({ id: A, nome: 'Novo lead', cor: 'slate', tipo: 'ABERTA', ordem: 1, ...extra });
const idsDistintos = (n: number) => Array.from({ length: n }, (_, i) => `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`);

describe('CrmFunilController', () => {
  let app: INestApplication;
  const servico = {
    listarEtapas: jest.fn(async (_c: unknown) => [{ id: A }]),
    salvarEtapas: jest.fn(async (_c: unknown, _d: unknown) => ({ atualizadas: 1 })),
    listarOportunidades: jest.fn(async (_c: unknown) => [{ id: A, updated_at: TOKEN }]),
    criarOportunidade: jest.fn(async (_c: unknown, _d: unknown) => ({ id: A })),
    excluirOportunidades: jest.fn(async (_c: unknown, _d: unknown) => ({ excluidas: 1 })),
    moverOportunidade: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ id: A })),
    listarTarefas: jest.fn(async (_c: unknown) => [{ id: B }]),
    criarTarefa: jest.fn(async (_c: unknown, _d: unknown) => ({ id: B, titulo: 'Ligar' })),
    concluirTarefa: jest.fn(async (_c: unknown, _id: string, _d: unknown) => ({ id: B, concluida: true })),
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
      controllers: [CrmFunilController],
      providers: [{ provide: CrmFunilService, useValue: servico }],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => Object.values(servico).forEach((f) => f.mockClear()));

  describe('etapas', () => {
    it('GET lista com as claims', async () => {
      const res = await http().get('/api/crm/etapas');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: A }]);
      expect(servico.listarEtapas).toHaveBeenCalledWith(claims);
    });

    it('PATCH repassa a lista validada', async () => {
      const res = await http().patch('/api/crm/etapas').send({ etapas: [etapa()] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ atualizadas: 1 });
      expect(servico.salvarEtapas).toHaveBeenCalledWith(claims, { etapas: [etapa()] });
    });

    it("PATCH com id 'novo-123' dá 400", async () => {
      const res = await http().patch('/api/crm/etapas').send({ etapas: [etapa({ id: 'novo-123' })] });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('etapas.0.Etapa inválida.');
      expect(servico.salvarEtapas).not.toHaveBeenCalled();
    });

    it('PATCH com chave extra num item dá 400', async () => {
      const res = await http().patch('/api/crm/etapas').send({ etapas: [etapa({ ativo: false })] });
      expect(res.status).toBe(400);
      expect(servico.salvarEtapas).not.toHaveBeenCalled();
    });

    it('PATCH com nome vazio dá 400 com o texto em português (prefixo do item vem do ValidationPipe)', async () => {
      const res = await http().patch('/api/crm/etapas').send({ etapas: [etapa({ nome: '' })] });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('etapas.0.Informe o nome da etapa.');
      expect(servico.salvarEtapas).not.toHaveBeenCalled();
    });

    it('PATCH sem etapas e com mais de 50 dá 400 em português', async () => {
      const vazio = await http().patch('/api/crm/etapas').send({ etapas: [] });
      expect(vazio.status).toBe(400);
      expect(vazio.body.message).toContain('Envie ao menos uma etapa.');
      const muitas = await http().patch('/api/crm/etapas').send({ etapas: idsDistintos(51).map((id) => etapa({ id })) });
      expect(muitas.status).toBe(400);
      expect(muitas.body.message).toContain('Envie no máximo 50 etapas.');
    });

    it('paridade: etapas[0].id fora da versão 4 chega ao service', async () => {
      const res = await http().patch('/api/crm/etapas').send({ etapas: [etapa({ id: NAO_V4 })] });
      expect(res.status).toBe(200);
      expect(servico.salvarEtapas).toHaveBeenCalledWith(claims, { etapas: [etapa({ id: NAO_V4 })] });
    });
  });

  describe('oportunidades', () => {
    it('GET lista com as claims', async () => {
      const res = await http().get('/api/crm/oportunidades');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: A, updated_at: TOKEN }]);
      expect(servico.listarOportunidades).toHaveBeenCalledWith(claims);
    });

    it('POST cria e responde 201 com o id', async () => {
      const res = await http().post('/api/crm/oportunidades').send({ etapa_id: A, titulo: 'Casa', cliente_id: null });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: A });
      expect(servico.criarOportunidade).toHaveBeenCalledWith(claims, { etapa_id: A, titulo: 'Casa', cliente_id: null });
    });

    it('POST com corretor_id ou id no corpo dá 400', async () => {
      expect((await http().post('/api/crm/oportunidades').send({ etapa_id: A, titulo: 'Casa', corretor_id: B })).status).toBe(400);
      expect((await http().post('/api/crm/oportunidades').send({ etapa_id: A, titulo: 'Casa', id: B })).status).toBe(400);
      expect(servico.criarOportunidade).not.toHaveBeenCalled();
    });

    it('POST com valores fora da faixa dá 400 em português', async () => {
      const res = await http().post('/api/crm/oportunidades').send({ etapa_id: A, titulo: '', probabilidade: 101, data_prevista_fechamento: '2026-13-01' });
      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(expect.arrayContaining(['Informe o título.', 'Probabilidade inválida.', 'Data prevista inválida.']));
      expect(servico.criarOportunidade).not.toHaveBeenCalled();
    });

    it('excluir: 200 e repassa os ids', async () => {
      const res = await http().post('/api/crm/oportunidades/excluir').send({ ids: [A, B] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ excluidas: 1 });
      expect(servico.excluirOportunidades).toHaveBeenCalledWith(claims, { ids: [A, B] });
    });

    it("excluir com ids: ['x'] dá 400 em português", async () => {
      const res = await http().post('/api/crm/oportunidades/excluir').send({ ids: ['x'] });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Negócio inválido.');
      expect(servico.excluirOportunidades).not.toHaveBeenCalled();
    });

    it('excluir com 1000 ids distintos chega ao service', async () => {
      const ids = idsDistintos(1000);
      const res = await http().post('/api/crm/oportunidades/excluir').send({ ids });
      expect(res.status).toBe(200);
      expect(servico.excluirOportunidades).toHaveBeenCalledWith(claims, { ids });
    });

    it('excluir com 1001 ids dá 400', async () => {
      const res = await http().post('/api/crm/oportunidades/excluir').send({ ids: idsDistintos(1001) });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Escolha no máximo 1000 negócios por vez.');
      expect(servico.excluirOportunidades).not.toHaveBeenCalled();
    });

    it('excluir sem nenhum id dá 400', async () => {
      const res = await http().post('/api/crm/oportunidades/excluir').send({ ids: [] });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Escolha ao menos um negócio.');
    });

    it('mover repassa id, etapa, ordem e o token como texto', async () => {
      const res = await http().patch(`/api/crm/oportunidades/${A}/mover`).send({ etapa_id: B, ordem: 2, updated_at: TOKEN });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: A });
      expect(servico.moverOportunidade).toHaveBeenCalledWith(claims, A, { etapa_id: B, ordem: 2, updated_at: TOKEN });
    });

    it('mover sem updated_at dá 400', async () => {
      const res = await http().patch(`/api/crm/oportunidades/${A}/mover`).send({ etapa_id: B, ordem: 2 });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Versão do negócio ausente.');
      expect(servico.moverOportunidade).not.toHaveBeenCalled();
    });

    it('mover com id que não é uuid dá 400 id_invalido', async () => {
      const res = await http().patch('/api/crm/oportunidades/nao-uuid/mover').send({ etapa_id: B, ordem: 2, updated_at: TOKEN });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ statusCode: 400, codigo: 'id_invalido', message: 'Identificador inválido.' });
      expect(servico.moverOportunidade).not.toHaveBeenCalled();
    });

    it('paridade: id fora da versão 4 na URL e em etapa_id chega ao service', async () => {
      const res = await http().patch(`/api/crm/oportunidades/${NAO_V4}/mover`).send({ etapa_id: NAO_V4, ordem: 0, updated_at: TOKEN });
      expect(res.status).toBe(200);
      expect(servico.moverOportunidade).toHaveBeenCalledWith(claims, NAO_V4, { etapa_id: NAO_V4, ordem: 0, updated_at: TOKEN });
    });

    it('o 409 CONFLITO do service sai como veio', async () => {
      servico.moverOportunidade.mockRejectedValueOnce(erroApi(409, 'CONFLITO', 'Este negócio foi movido em outro lugar.'));
      const res = await http().patch(`/api/crm/oportunidades/${A}/mover`).send({ etapa_id: B, ordem: 2, updated_at: TOKEN });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ statusCode: 409, codigo: 'CONFLITO', message: 'Este negócio foi movido em outro lugar.' });
    });
  });

  describe('tarefas', () => {
    it('GET lista com as claims', async () => {
      const res = await http().get('/api/crm/tarefas');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: B }]);
      expect(servico.listarTarefas).toHaveBeenCalledWith(claims);
    });

    it('POST cria e responde 201 com a linha', async () => {
      const res = await http().post('/api/crm/tarefas').send({ titulo: 'Ligar', tipo: 'LIGACAO', oportunidade_id: A });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: B, titulo: 'Ligar' });
      expect(servico.criarTarefa).toHaveBeenCalledWith(claims, { titulo: 'Ligar', tipo: 'LIGACAO', oportunidade_id: A });
    });

    it('POST com tipo desconhecido ou corretor_id dá 400', async () => {
      const tipo = await http().post('/api/crm/tarefas').send({ titulo: 'Ligar', tipo: 'JANTAR' });
      expect(tipo.status).toBe(400);
      expect(tipo.body.message).toContain('Tipo de tarefa inválido.');
      expect((await http().post('/api/crm/tarefas').send({ titulo: 'Ligar', corretor_id: A })).status).toBe(400);
      expect(servico.criarTarefa).not.toHaveBeenCalled();
    });

    it('concluir repassa o id e o booleano', async () => {
      const res = await http().patch(`/api/crm/tarefas/${B}/concluir`).send({ concluida: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: B, concluida: true });
      expect(servico.concluirTarefa).toHaveBeenCalledWith(claims, B, { concluida: true });
    });

    it('concluir sem booleano dá 400 em português', async () => {
      const res = await http().patch(`/api/crm/tarefas/${B}/concluir`).send({ concluida: 'sim' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Informe se a tarefa foi concluída.');
      expect(servico.concluirTarefa).not.toHaveBeenCalled();
    });

    it('concluir com id que não é uuid dá 400 id_invalido', async () => {
      const res = await http().patch('/api/crm/tarefas/abc/concluir').send({ concluida: true });
      expect(res.status).toBe(400);
      expect(res.body.codigo).toBe('id_invalido');
    });
  });
});
