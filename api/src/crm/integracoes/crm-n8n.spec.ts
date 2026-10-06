import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmN8nController } from './crm-n8n.controller';
import { interesseDoLead, lerFiltrosBusca, statusDoLead, trackingDoLead } from './crm-n8n.regras';
import { CrmN8nRepo } from './crm-n8n.repo';
import { CrmN8nService } from './crm-n8n.service';
import { N8nSegredoGuard } from './n8n-segredo.guard';

const SEGREDO = 'segredo-do-n8n-para-teste';
const CORRETOR = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const IMOVEL = '33333333-3333-4333-8333-333333333333';

describe('regras do n8n', () => {
  it('status e interesse viram os valores dos ENUMs', () => {
    expect([statusDoLead('quente'), statusDoLead('descartado'), statusDoLead('morno'), statusDoLead(undefined)])
      .toEqual(['VISITA_PROPOSTA', 'FECHADO_PERDIDO', 'QUALIFICACAO', 'QUALIFICACAO']);
    expect(['compra', 'ALUGUEL', 'locacao', 'proprietario', 'ambos', 'x', undefined].map(interesseDoLead))
      .toEqual(['COMPRA', 'LOCACAO', 'LOCACAO', 'AMBOS', 'AMBOS', 'AMBOS', 'AMBOS']);
  });

  it('tracking: campos de qualificação + tracking_data do payload por cima; não-objeto é ignorado', () => {
    expect(JSON.parse(JSON.stringify(trackingDoLead({ classificacao: 'quente', faixa_valor_min: '300000', tracking_data: { origem: 'site', x: 1 } }))))
      .toEqual({ origem: 'site', canal: 'evolution_api', classificacao: 'quente', faixa_valor_min: '300000', x: 1 });
    expect(trackingDoLead({ tracking_data: 'abc' })).not.toHaveProperty('0');
  });

  it('filtros da busca: tipo → finalidades, categoria → tipo, `> 0` e limite até 20', () => {
    expect(lerFiltrosBusca({})).toEqual({
      corretorId: null, finalidades: null, categoria: null, valorMin: null, valorMax: null, dormitorios: null, cidade: null, limit: 5,
    });
    expect(lerFiltrosBusca({ tipo: 'venda', categoria: 'casa', valor_min: '100', valor_max: 'abc', dormitorios: '2', cidade: 'Goi', limit: '50', corretor_id: CORRETOR }))
      .toEqual({ corretorId: CORRETOR, finalidades: ['VENDA', 'AMBOS'], categoria: 'CASA', valorMin: 100, valorMax: null, dormitorios: 2, cidade: 'Goi', limit: 20 });
    expect(lerFiltrosBusca({ tipo: 'ALUGUEL' }).finalidades).toEqual(['LOCACAO', 'AMBOS']);
    expect(lerFiltrosBusca({ limit: 'x' }).limit).toBe(5);
    expect(lerFiltrosBusca({ limit: '0' }).limit).toBe(0);
  });
});

describe('rotas do n8n (segredo + porte das Edge crm-*)', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
  const salvo = process.env.N8N_SHARED_SECRET;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [CrmN8nController],
      providers: [CrmN8nService, CrmN8nRepo, N8nSegredoGuard, { provide: PrismaService, useValue: prisma }],
    }).compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    if (salvo === undefined) delete process.env.N8N_SHARED_SECRET;
    else process.env.N8N_SHARED_SECRET = salvo;
  });
  beforeEach(() => {
    process.env.N8N_SHARED_SECRET = SEGREDO;
    prisma.$queryRaw.mockReset();
    prisma.$executeRaw.mockReset().mockResolvedValue(1);
  });

  const texto = (m: jest.Mock, i: number) => (m.mock.calls[i][0] as Prisma.Sql).text.replace(/\s+/g, ' ');
  const valores = (m: jest.Mock, i: number) => (m.mock.calls[i][0] as Prisma.Sql).values;
  const post = (rota: string, corpo: object, segredo: string | null = SEGREDO) => {
    const r = request(app.getHttpServer()).post(`/api/integracoes/n8n/${rota}`);
    return (segredo === null ? r : r.set('x-n8n-secret', segredo)).send(corpo);
  };

  it('segredo ausente ou errado → 401; servidor sem segredo → 503; nada vai ao banco', async () => {
    for (const s of [null, 'errado', '']) {
      const r = await post('crm-upsert-lead', { telefone: '1' }, s);
      expect([r.status, r.body]).toEqual([401, { success: false, error: 'unauthorized' }]);
    }
    const busca = await request(app.getHttpServer()).get('/api/integracoes/n8n/crm-buscar-imoveis').set('x-n8n-secret', 'x');
    expect(busca.status).toBe(401);
    delete process.env.N8N_SHARED_SECRET;
    const r = await post('crm-anexar-historico', { mensagem: 'oi' });
    expect([r.status, r.body]).toEqual([503, { success: false, error: 'N8N_SHARED_SECRET not configured' }]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  describe('crm-upsert-lead', () => {
    it('telefone obrigatório e corretor_id resolvido como na Edge', async () => {
      expect((await post('crm-upsert-lead', { nome: 'x' })).body).toEqual({ error: 'telefone é obrigatório' });
      const invalido = await post('crm-upsert-lead', { telefone: '62999990000', corretor_id: 'nao-uuid' });
      expect([invalido.status, invalido.body]).toEqual([400, { error: 'corretor_id informado não existe' }]);
      prisma.$queryRaw.mockResolvedValueOnce([]);
      expect((await post('crm-upsert-lead', { telefone: '62999990000', corretor_id: CORRETOR })).body).toEqual({ error: 'corretor_id informado não existe' });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
      const dois = await post('crm-upsert-lead', { telefone: '62999990000' });
      expect([dois.status, dois.body]).toEqual([400, { error: 'Há mais de um corretor cadastrado: informe corretor_id no payload.' }]);
      prisma.$queryRaw.mockResolvedValueOnce([]);
      const nenhum = await post('crm-upsert-lead', { telefone: '62999990000' });
      expect([nenhum.status, nenhum.body]).toEqual([500, { error: 'nenhum corretor cadastrado' }]);
    });

    it('cliente novo: find_or_create com os dados do lead, vínculo da mesma conta e alerta do quente', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: CORRETOR }])
        .mockResolvedValueOnce([{ r: { cliente_id: CLIENTE, created: true } }]);
      const r = await post('crm-upsert-lead', {
        telefone: 5562999990000, corretor_id: CORRETOR, nome: 'Ana', email: 'a@b.co', tipo_interesse: 'ALUGUEL',
        classificacao: 'quente', faixa_valor_max: 3000, imovel_interesse: IMOVEL, campo_extra: true,
      }).expect(200);
      expect(r.body).toEqual({ success: true, cliente_id: CLIENTE, classificacao: 'quente' });
      expect(texto(prisma.$queryRaw, 1)).toContain('public.lotti_find_or_create_cliente');
      const [owner, phone, name, dados] = valores(prisma.$queryRaw, 1) as [string, string, string, string];
      expect([owner, phone, name]).toEqual([CORRETOR, '5562999990000', 'Ana']);
      expect(JSON.parse(dados)).toMatchObject({
        email: 'a@b.co', tipo_interesse: 'LOCACAO', status_funil: 'VISITA_PROPOSTA',
        tracking_data: { origem: 'whatsapp', canal: 'evolution_api', classificacao: 'quente', faixa_valor_max: 3000 },
      });
      // Novo: sem update; vínculo restrito à conta; alerta FOLLOWUP.
      expect(texto(prisma.$executeRaw, 0)).toContain('insert into public.cliente_imovel');
      expect(texto(prisma.$executeRaw, 0)).toContain('i.corretor_id =');
      expect(valores(prisma.$executeRaw, 0)).toEqual([CLIENTE, IMOVEL, CORRETOR]);
      expect(texto(prisma.$executeRaw, 1)).toContain("'FOLLOWUP'");
      expect(valores(prisma.$executeRaw, 1)).toEqual([CLIENTE, CORRETOR, 'Lead quente via WhatsApp: Ana (5562999990000)']);
    });

    it('cliente existente: atualiza a qualificação, soma o tracking e não troca nome pelo genérico', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: CORRETOR }])
        .mockResolvedValueOnce([{ r: { cliente_id: CLIENTE, created: false } }]);
      await post('crm-upsert-lead', { telefone: '62999990000', classificacao: 'descartado', email: null }).expect(200);
      expect(valores(prisma.$queryRaw, 1)[2]).toBe('Lead WhatsApp');
      expect(texto(prisma.$executeRaw, 0)).toContain('update public.clientes');
      expect(texto(prisma.$executeRaw, 0)).toContain("coalesce(tracking_data, '{}'::jsonb) ||");
      const [nome, email, tipo, status, obs] = valores(prisma.$executeRaw, 0);
      expect([nome, email, tipo, status, obs]).toEqual([null, null, 'AMBOS', 'FECHADO_PERDIDO', null]);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('crm-buscar-imoveis', () => {
    it('GET com a query: { success, total, imoveis } da conta, só DISPONIVEL e ativo', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: CORRETOR }])
        .mockResolvedValueOnce([{ imoveis: [{ id: IMOVEL, tipo: 'VENDA', categoria: 'CASA', url_website: null, fotos: [] }] }]);
      const r = await request(app.getHttpServer())
        .get(`/api/integracoes/n8n/crm-buscar-imoveis?tipo=VENDA&categoria=CASA&valor_min=100000&cidade=Goi&corretor_id=${CORRETOR}`)
        .set('x-n8n-secret', SEGREDO)
        .expect(200);
      expect(r.body).toEqual({ success: true, total: 1, imoveis: [{ id: IMOVEL, tipo: 'VENDA', categoria: 'CASA', url_website: null, fotos: [] }] });
      const sql = texto(prisma.$queryRaw, 1);
      expect(sql).toContain("i.status_venda = 'DISPONIVEL' and i.ativo = true");
      expect(sql).not.toMatch(/proprietario|i\.\*/);
      expect(valores(prisma.$queryRaw, 1)).toEqual([CORRETOR, ['VENDA', 'AMBOS'], ['VENDA', 'AMBOS'], 'CASA', 'CASA', 100000, 100000, null, null, null, null, 'Goi', 'Goi', 5]);
    });

    it('erros de corretor no formato { success: false, error } e mensagem "na query"', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
      const r = await request(app.getHttpServer()).post('/api/integracoes/n8n/crm-buscar-imoveis').set('x-n8n-secret', SEGREDO).expect(400);
      expect(r.body).toEqual({ success: false, error: 'Há mais de um corretor cadastrado: informe corretor_id na query.' });
    });

    it('falha do banco: 500 genérico, sem a mensagem do Postgres', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(new Error('column imoveis.categoria does not exist'));
      const r = await request(app.getHttpServer()).get('/api/integracoes/n8n/crm-buscar-imoveis').set('x-n8n-secret', SEGREDO).expect(500);
      expect(r.body).toEqual({ success: false, error: 'Não foi possível concluir a operação.' });
    });
  });

  describe('crm-anexar-historico', () => {
    it('mensagem obrigatória; busca por telefone exige corretor_id; cliente ausente → 404', async () => {
      expect((await post('crm-anexar-historico', { telefone: '1' })).body).toEqual({ error: 'mensagem é obrigatória' });
      const semCorretor = await post('crm-anexar-historico', { telefone: '62999990000', mensagem: 'oi', direcao: 'IN' });
      expect(semCorretor.status).toBe(400);
      expect(semCorretor.body.error).toContain('corretor_id é obrigatório');
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'x' }, { id: 'y' }]);
      const ambiguo = await post('crm-anexar-historico', { telefone: '62999990000', corretor_id: CORRETOR, mensagem: 'oi', direcao: 'IN' });
      expect([ambiguo.status, ambiguo.body]).toEqual([404, { error: 'cliente não encontrado; chame crm-upsert-lead antes' }]);
      expect((await post('crm-anexar-historico', { mensagem: 'oi', direcao: 'IN' })).status).toBe(404);
    });

    it('grava WHATSAPP com a direção, toca ultimo_contato e devolve os ids', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ id: CLIENTE }])
        .mockResolvedValueOnce([{ id: CLIENTE }])
        .mockResolvedValueOnce([{ id: 'h1' }]);
      const r = await post('crm-anexar-historico', { telefone: '62999990000', corretor_id: CORRETOR, mensagem: 'Olá', direcao: 'OUT', metadata: { a: 1 } }).expect(200);
      expect(r.body).toEqual({ success: true, historico_id: 'h1', cliente_id: CLIENTE });
      expect(valores(prisma.$queryRaw, 0)).toEqual([CORRETOR, '62999990000']);
      expect(valores(prisma.$queryRaw, 1)).toEqual([CLIENTE, CORRETOR, CORRETOR]);
      expect(texto(prisma.$queryRaw, 2)).toContain("'WHATSAPP'");
      expect(valores(prisma.$queryRaw, 2)).toEqual([CLIENTE, 'OUT', 'Olá', '{"a":1}']);
      expect(texto(prisma.$executeRaw, 0)).toContain('set ultimo_contato = now()');
    });

    it('direção inválida → 400 antes de gravar', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ id: CLIENTE }]);
      const r = await post('crm-anexar-historico', { cliente_id: CLIENTE, mensagem: 'oi', direcao: 'X' });
      expect([r.status, r.body]).toEqual([400, { success: false, error: 'direcao deve ser IN ou OUT' }]);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
