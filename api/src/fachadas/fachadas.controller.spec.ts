import { readFileSync } from 'node:fs';
import { CanActivate, INestApplication, Type, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { FachadasLeadsController } from './fachadas-leads.controller';
import { FachadasLeadsService } from './fachadas-leads.service';
import { FachadasMetricasController } from './fachadas-metricas.controller';
import { FachadasMetricasService } from './fachadas-metricas.service';
import { FachadasMidiasController } from './fachadas-midias.controller';
import { FachadasMidiasService } from './fachadas-midias.service';
import { FachadasTemplatesController } from './fachadas-templates.controller';
import { FachadasTemplatesService } from './fachadas-templates.service';
import { FachadasController } from './fachadas.controller';
import { FachadasModule } from './fachadas.module';
import { FachadasService } from './fachadas.service';
import { FachadasPublicoController } from './publico/fachadas-publico.controller';
import { FachadasPublicoRepo } from './publico/fachadas-publico.repo';
import { FachadasPublicoService } from './publico/fachadas-publico.service';

const FACHADA = '11111111-1111-4111-8111-111111111111';
const IMOVEL = '22222222-2222-4222-8222-222222222222';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: 'u1', role: 'authenticated' };

const criar = (extra: Record<string, unknown> = {}) => ({
  imovel_id: IMOVEL, tipo_negocio: 'VENDA', template_id: 'venda-classica', cta_principal: 'WHATSAPP',
  modo_conversao: false, ...extra,
});

/** A ordem registrada no módulo é a ordem do casamento de rotas no Nest (contrato §1.1). */
const CONTROLLERS = Reflect.getMetadata('controllers', FachadasModule) as Array<Type<unknown>>;

describe('ordem dos caminhos no FachadasModule', () => {
  it('os quatro prefixos literais e o público vêm antes; FachadasController é o último', () => {
    expect(CONTROLLERS).toEqual([
      FachadasLeadsController, FachadasMetricasController, FachadasTemplatesController,
      FachadasMidiasController, FachadasPublicoController, FachadasController,
    ]);
    expect(CONTROLLERS[CONTROLLERS.length - 1]).toBe(FachadasController);
  });

  it('templates/por-imagem é declarada antes de templates/:id', () => {
    const fonte = readFileSync(`${__dirname}/fachadas-templates.controller.ts`, 'utf8');
    expect(fonte.indexOf("@Get('por-imagem')")).toBeGreaterThan(-1);
    expect(fonte.indexOf("@Get('por-imagem')")).toBeLessThan(fonte.indexOf("@Delete(':id')"));
  });
});

describe('guardas', () => {
  it('os cinco controllers autenticados têm SupabaseAuthGuard', () => {
    for (const c of [FachadasController, FachadasLeadsController, FachadasMetricasController,
      FachadasTemplatesController, FachadasMidiasController]) {
      expect(Reflect.getMetadata('__guards__', c)).toEqual([SupabaseAuthGuard]);
    }
  });

  it('o controller público não tem guarda nenhuma, na classe nem nos métodos', () => {
    expect(Reflect.getMetadata('__guards__', FachadasPublicoController) ?? []).toEqual([]);
    const proto = FachadasPublicoController.prototype as unknown as Record<string, () => unknown>;
    for (const metodo of ['verFachada', 'registrarEscaneamento', 'enviarLead']) {
      expect(Reflect.getMetadata('__guards__', proto[metodo]) ?? []).toEqual([]);
    }
  });

  it('nenhum método público recebe @Claims', () => {
    const fonte = readFileSync(`${__dirname}/publico/fachadas-publico.controller.ts`, 'utf8');
    expect(fonte).not.toContain('@Claims');
    expect(fonte).not.toContain('UseGuards');
  });

  it('P2 não declara @Body(): o user_agent vem do cabeçalho', () => {
    const fonte = readFileSync(`${__dirname}/publico/fachadas-publico.controller.ts`, 'utf8');
    const trecho = fonte.slice(fonte.indexOf('registrarEscaneamento('), fonte.indexOf('enviarLead('));
    expect(trecho).not.toContain('@Body');
    expect(trecho).toContain("@Headers('user-agent')");
  });
});

describe('controllers de fachadas (HTTP)', () => {
  let app: INestApplication;
  const fachadas = {
    listar: jest.fn(async () => [{ id: FACHADA }]),
    criar: jest.fn(async () => ({ id: FACHADA })),
    editar: jest.fn(async () => ({ id: FACHADA, ativo: false })),
    remover: jest.fn(async () => undefined),
  };
  const leads = { listar: jest.fn(async () => [{ id: 'lead' }]), remover: jest.fn(async () => undefined) };
  const metricas = {
    obter: jest.fn(async () => ({
      totalFachadas: 1, totalEscaneamentos: 2, totalLeads: 1, taxaConversao: 50, fachadasMaisAcessadas: [], leadsPorDia: [],
    })),
  };
  const templates = {
    listar: jest.fn(async () => [{ id: 'tpl' }]),
    criar: jest.fn(async () => ({ id: 'tpl' })),
    remover: jest.fn(async () => undefined),
    porImagem: jest.fn(async () => null),
  };
  const midias = { obter: jest.fn(async () => ({ foto_principal_url: null, fotos: 0, videos: 0 })) };
  const publico = {
    verFachada: jest.fn(async () => ({ fachada: { id: FACHADA }, fotos: [] })),
    registrarEscaneamento: jest.fn(async () => undefined),
    enviarLead: jest.fn(async () => ({ registrado: true as const })),
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
      controllers: CONTROLLERS,
      providers: [
        { provide: FachadasService, useValue: fachadas },
        { provide: FachadasLeadsService, useValue: leads },
        { provide: FachadasMetricasService, useValue: metricas },
        { provide: FachadasTemplatesService, useValue: templates },
        { provide: FachadasMidiasService, useValue: midias },
        { provide: FachadasPublicoService, useValue: publico },
        { provide: FachadasPublicoRepo, useValue: {} },
      ],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('F1/F2/F3/F4 nas rotas e códigos do contrato', async () => {
    await http().get('/fachadas').expect(200, [{ id: FACHADA }]);
    await http().post('/fachadas').send(criar()).expect(201, { id: FACHADA });
    await http().patch(`/fachadas/${FACHADA}`).send({ ativo: false }).expect(200, { id: FACHADA, ativo: false });
    await http().delete(`/fachadas/${FACHADA}`).expect(204);
    expect(fachadas.criar).toHaveBeenCalledWith(claims, expect.objectContaining({ imovel_id: IMOVEL }));
  });

  it('GET /fachadas/leads cai no FachadasLeadsController, não em /fachadas/:id', async () => {
    await http().get('/fachadas/leads').expect(200, [{ id: 'lead' }]);
    expect(leads.listar).toHaveBeenCalledTimes(1);
    expect(fachadas.listar).not.toHaveBeenCalled();
  });

  it('os outros prefixos literais também não caem em /fachadas/:id', async () => {
    await http().get('/fachadas/metricas?dias=7').expect(200);
    await http().get('/fachadas/templates').expect(200, [{ id: 'tpl' }]);
    await http().get('/fachadas/templates/por-imagem?imagem_url=https://host/a.png').expect(200, '');
    await http().get(`/fachadas/midias/${IMOVEL}`).expect(200);
    expect(metricas.obter).toHaveBeenCalledWith(claims, { dias: 7 });
    expect(templates.porImagem).toHaveBeenCalledWith(claims, { imagem_url: 'https://host/a.png' });
    expect(midias.obter).toHaveBeenCalledWith(claims, IMOVEL);
  });

  it('F5, F6, F9 e F10', async () => {
    await http().get(`/fachadas/leads?fachada_id=${FACHADA}`).expect(200);
    expect(leads.listar).toHaveBeenCalledWith(claims, { fachada_id: FACHADA });
    await http().delete(`/fachadas/leads/${FACHADA}`).expect(204);
    await http().post('/fachadas/templates').send({ nome: 'Arte', categoria: 'VENDA', config: {} }).expect(201);
    await http().delete(`/fachadas/templates/${FACHADA}`).expect(204);
  });

  it('F5 com convertido=false lista só os pendentes; valor fora de true/false dá 400', async () => {
    await http().get('/fachadas/leads?convertido=false').expect(200);
    expect(leads.listar).toHaveBeenCalledWith(claims, { convertido: false });
    await http().get('/fachadas/leads?convertido=true').expect(200);
    expect(leads.listar).toHaveBeenLastCalledWith(claims, { convertido: true });
    leads.listar.mockClear();
    await http().get('/fachadas/leads?convertido=talvez').expect(400);
    expect(leads.listar).not.toHaveBeenCalled();
  });

  it('id fora do formato dá 400 id_invalido, inclusive nas rotas públicas', async () => {
    for (const caminho of ['/fachadas/nao-e-uuid', '/fachadas/leads/nao-e-uuid', '/fachadas/templates/nao-e-uuid',
      '/fachadas/midias/nao-e-uuid', '/publico/fachadas/nao-e-uuid']) {
      const r = await request(app.getHttpServer()).get(caminho);
      if (r.status !== 404) expect(r.body).toMatchObject({ statusCode: 400, codigo: 'id_invalido', message: 'Identificador inválido.' });
    }
    await http().delete('/fachadas/nao-e-uuid').expect(400);
    await http().post('/publico/fachadas/nao-e-uuid/escaneamentos').expect(400);
  });

  it('uuid sem versão 4 é aceito, como o ParseUUIDPipe sem versão', async () => {
    await http().get(`/publico/fachadas/${NAO_V4}`).expect(200);
    await http().delete(`/fachadas/${NAO_V4}`).expect(204);
  });

  it('corpo com chave fora do DTO dá 400 antes de chegar ao service', async () => {
    await http().post('/fachadas').send(criar({ corretor_id: IMOVEL })).expect(400);
    await http().post('/fachadas').send(criar({ id: FACHADA })).expect(400);
    await http().patch(`/fachadas/${FACHADA}`).send({ total_leads: 9 }).expect(400);
    expect(fachadas.criar).not.toHaveBeenCalled();
    expect(fachadas.editar).not.toHaveBeenCalled();
  });

  it('P1, P2 e P3 nas rotas e códigos do contrato, sem sessão', async () => {
    await http().get(`/publico/fachadas/${FACHADA}`).expect(200, { fachada: { id: FACHADA }, fotos: [] });
    await http().post(`/publico/fachadas/${FACHADA}/escaneamentos`).set('User-Agent', 'Mozilla/5.0').expect(204);
    expect(publico.registrarEscaneamento).toHaveBeenCalledWith(FACHADA, 'Mozilla/5.0');
    await http().post(`/publico/fachadas/${FACHADA}/leads`)
      .send({ nome: 'Ana Souza', telefone: '(11) 99999-8888' }).expect(200, { registrado: true });
  });

  it('P2 ignora qualquer corpo', async () => {
    await http().post(`/publico/fachadas/${FACHADA}/escaneamentos`)
      .set('User-Agent', 'ua').send({ user_agent: 'forjado', ip_hash: 'x' }).expect(204);
    expect(publico.registrarEscaneamento).toHaveBeenCalledWith(FACHADA, 'ua');
  });

  it('P3 recusa as chaves que o visitante não pode forjar', async () => {
    const base = { nome: 'Ana Souza', telefone: '(11) 99999-8888' };
    for (const extra of [{ convertido: true }, { cliente_id: FACHADA }, { created_at: '2026-01-01' }, { ip_hash: 'x' }]) {
      await http().post(`/publico/fachadas/${FACHADA}/leads`).send({ ...base, ...extra }).expect(400);
    }
    expect(publico.enviarLead).not.toHaveBeenCalled();
  });

  it("P3 recusa email vazio e telefone inválido com texto em português", async () => {
    const r = await http().post(`/publico/fachadas/${FACHADA}/leads`)
      .send({ nome: 'Ana Souza', telefone: '011999998888' }).expect(400);
    expect(JSON.stringify(r.body)).toContain('Informe um telefone válido com DDD.');
    await http().post(`/publico/fachadas/${FACHADA}/leads`).send({ nome: 'Ana Souza', telefone: '11999998888', email: '' }).expect(400);
  });

  it('dias fora de 1..365 dá 400 no ValidationPipe', async () => {
    for (const dias of ['0', '366', 'abc']) await http().get(`/fachadas/metricas?dias=${dias}`).expect(400);
    expect(metricas.obter).not.toHaveBeenCalled();
  });
});
