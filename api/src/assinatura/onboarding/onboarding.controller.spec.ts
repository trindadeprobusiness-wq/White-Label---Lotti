import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

const claims = { sub: 'u1', role: 'authenticated' };
const ORG = '11111111-1111-1111-1111-111111111111';

describe('OnboardingController', () => {
  let app: INestApplication;
  const onboarding = {
    contexto: jest.fn(async (..._a: unknown[]) => ({ profile: { id: 'p' } })),
    salvar: jest.fn(async (..._a: unknown[]) => null),
    executarAcao: jest.fn(async (..._a: unknown[]) => ({ id: 'i1', reused: false })),
    registrarEvento: jest.fn(async (..._a: unknown[]) => undefined),
    salvarTour: jest.fn(async (..._a: unknown[]) => undefined),
    salvarChecklist: jest.fn(async (..._a: unknown[]) => undefined),
    atualizarPerfil: jest.fn(async (..._a: unknown[]) => undefined),
    atualizarOrganizacao: jest.fn(async (..._a: unknown[]) => undefined),
    criarConvite: jest.fn(async (..._a: unknown[]) => ({ id: 'c1', token: 't', expires_in_days: 7 })),
    aceitarConvite: jest.fn(async (..._a: unknown[]) => ({ organization_id: ORG, papel: 'gestor' })),
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
      controllers: [OnboardingController],
      providers: [{ provide: OnboardingService, useValue: onboarding }],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => Object.values(onboarding).forEach((f) => f.mockClear()));

  it('O1/O2: contexto e salvar passam as claims', async () => {
    expect((await http().get('/api/onboarding/contexto')).body).toEqual({ profile: { id: 'p' } });
    expect(onboarding.contexto.mock.calls[0][0]).toEqual(claims);
    const r = await http().post('/api/onboarding/salvar').send({ stepKey: 'persona', stepStatus: 'concluido' });
    expect(r.status).toBe(200);
    expect(onboarding.salvar.mock.calls[0][1]).toEqual({ stepKey: 'persona', stepStatus: 'concluido' });
  });

  it('O2: stepStatus fora da lista vira 400 em português', async () => {
    const r = await http().post('/api/onboarding/salvar').send({ stepStatus: 'qualquer' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Status de etapa inválido.');
  });

  it('O3: ação fora da lista vira 400; chave desconhecida no corpo também', async () => {
    const r = await http().post('/api/onboarding/acoes').send({ action: 'apagar_tudo' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Ação de onboarding inválida.');
    expect((await http().post('/api/onboarding/acoes').send({ action: 'first_client', extra: 1 })).status).toBe(400);
    expect(onboarding.executarAcao).not.toHaveBeenCalled();
  });

  it('O4: evento válido responde 204 sem corpo; inválido 400', async () => {
    const ok = await http().post('/api/onboarding/eventos').send({ eventName: 'persona_selected' });
    expect(ok.status).toBe(204);
    expect(ok.text).toBe('');
    const r = await http().post('/api/onboarding/eventos').send({ eventName: 'nao_existe' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Evento de onboarding inválido.');
  });

  it('O5: tour responde 204; tourKey vazio 400; status inválido 400', async () => {
    expect((await http().put('/api/onboarding/tours').send({ tourKey: 'crm', status: 'concluido', currentStep: 2 })).status).toBe(204);
    expect(onboarding.salvarTour.mock.calls[0][1]).toEqual({ tourKey: 'crm', status: 'concluido', currentStep: 2 });
    const vazio = await http().put('/api/onboarding/tours').send({ tourKey: '', status: 'concluido' });
    expect(vazio.status).toBe(400);
    expect(vazio.body.message).toContain('Informe o tour.');
    const status = await http().put('/api/onboarding/tours').send({ tourKey: 'crm', status: 'x' });
    expect(status.body.message).toContain('Status de tour inválido.');
  });

  it('O6: checklist responde 204; valor não booleano 400', async () => {
    expect((await http().patch('/api/onboarding/checklist').send({ minimized: true })).status).toBe(204);
    const r = await http().patch('/api/onboarding/checklist').send({ dismissed: 'sim' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Valor inválido para dispensado.');
  });

  it('O7: perfil responde 204; creci_status fora da lista 400; chave desconhecida 400', async () => {
    expect((await http().patch('/api/onboarding/perfil').send({ nome: 'Ana' })).status).toBe(204);
    const r = await http().patch('/api/onboarding/perfil').send({ creci_status: 'inventado' });
    expect(r.body.message).toContain('Situação de CRECI inválida.');
    expect((await http().patch('/api/onboarding/perfil').send({ senha: 'x' })).status).toBe(400);
  });

  it('O8: paridade URL × corpo e id inválido', async () => {
    const ok = await http().patch(`/api/onboarding/organizacoes/${ORG}`).send({ nome: 'Imobiliária' });
    expect(ok.status).toBe(204);
    expect(onboarding.atualizarOrganizacao.mock.calls[0]).toEqual([claims, ORG, { nome: 'Imobiliária' }]);
    const r = await http().patch('/api/onboarding/organizacoes/abc').send({ nome: 'x' });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ statusCode: 400, codigo: 'id_invalido', message: 'Identificador inválido.' });
  });

  it('O8: tipo_operacao precisa ser lista de texto', async () => {
    const r = await http().patch(`/api/onboarding/organizacoes/${ORG}`).send({ tipo_operacao: 'venda' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Tipo de operação inválido.');
  });

  it('O9: e-mail inválido 400; papel inválido 400; válido responde 200 com o corpo da função', async () => {
    const ruim = await http().post('/api/onboarding/convites').send({ email: 'sem-arroba' });
    expect(ruim.status).toBe(400);
    expect(ruim.body.message).toContain('Informe um e-mail válido.');
    const papel = await http().post('/api/onboarding/convites').send({ email: 'a@b.com', papel: 'dono' });
    expect(papel.body.message).toContain('Escolha uma função válida para o convite.');
    const ok = await http().post('/api/onboarding/convites').send({ email: 'a@b.com', papel: 'gestor' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ id: 'c1', token: 't', expires_in_days: 7 });
  });

  it('O10: token obrigatório; a rota estática não cai em :id', async () => {
    const r = await http().post('/api/onboarding/convites/aceitar').send({ token: '' });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Informe o código do convite.');
    const ok = await http().post('/api/onboarding/convites/aceitar').send({ token: 'abc' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ organization_id: ORG, papel: 'gestor' });
    expect(onboarding.criarConvite).not.toHaveBeenCalled();
  });
});
