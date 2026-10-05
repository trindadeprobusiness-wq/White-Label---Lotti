import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { RotinaComandoService } from './comando/rotina-comando.service';
import { RotinaGooglePublicoController } from './google/rotina-google-publico.controller';
import { RotinaGoogleController } from './google/rotina-google.controller';
import { RotinaGoogleService } from './google/rotina-google.service';
import { RotinaController } from './rotina.controller';
import { RotinaService } from './rotina.service';

const A = '11111111-1111-4111-8111-111111111111';
const NAO_V4 = '11111111-1111-1111-1111-111111111111';
const claims = { sub: A, role: 'authenticated' };
const eventoValido = (extra: Record<string, unknown> = {}) => ({
  title: '  Visita  ', activity_type: 'visita_imovel', priority: 'medium', assigned_to: NAO_V4, visibility: 'team',
  start_at: '2026-11-10T13:00:00.000Z', end_at: '2026-11-10T14:00:00.000Z', all_day: false, ...extra,
});

describe('Controllers da rotina', () => {
  let app: INestApplication;
  const rotina = {
    contexto: jest.fn(async () => null),
    listarMembros: jest.fn(async () => []),
    listarEventos: jest.fn(async () => []),
    listarTarefas: jest.fn(async () => []),
    listarAtividade: jest.fn(async () => []),
    listarInbox: jest.fn(async () => []),
    criarInbox: jest.fn(async () => ({ id: A })),
    arquivarInbox: jest.fn(async () => ({ arquivado: true })),
    detectarConflitos: jest.fn(async () => []),
    criarEvento: jest.fn(async () => ({ evento: { id: A }, lembrete_criado: false })),
    criarTarefa: jest.fn(async () => ({ id: A })),
    editarEvento: jest.fn(async () => ({ id: A })),
    editarTarefa: jest.fn(async () => ({ id: A })),
    concluir: jest.fn(async () => ({ item: { id: A }, registrado_no_crm: false })),
    remover: jest.fn(async () => ({ removido: true })),
  };
  const comando = { interpretar: jest.fn(async () => ({ proposal: {} })) };
  const google = {
    status: jest.fn(async () => ({ connected: false, status: 'not_connected' })),
    conectar: jest.fn(async () => ({ authorization_url: 'https://accounts.google.com/x' })),
    desconectar: jest.fn(async () => ({ disconnected: true })),
    configurarPrivacidade: jest.fn(async () => ({ configured: true, privacy_mode: 'full' })),
    listarCalendarios: jest.fn(async () => []),
    configurarCalendario: jest.fn(async () => ({ id: A })),
    sincronizar: jest.fn(async () => ({ synced: true })),
    callback: jest.fn(async () => 'http://localhost:8085/rotina?google_calendar=connected'),
    webhook: jest.fn(async () => ({ status: 200, body: { received: true } })),
  };
  const guard: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RotinaController, RotinaGoogleController, RotinaGooglePublicoController],
      providers: [
        { provide: RotinaService, useValue: rotina },
        { provide: RotinaComandoService, useValue: comando },
        { provide: RotinaGoogleService, useValue: google },
      ],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => [rotina, comando, google].forEach((s) => Object.values(s).forEach((f) => f.mockClear())));

  it('GET contexto, membros, atividade e inbox repassam as claims', async () => {
    for (const [rota, fn] of [['contexto', rotina.contexto], ['membros', rotina.listarMembros], ['atividade', rotina.listarAtividade], ['inbox', rotina.listarInbox]] as const) {
      const res = await http().get(`/api/rotina/${rota}`);
      expect(res.status).toBe(200);
      expect(fn).toHaveBeenCalledWith(claims);
    }
  });

  it('GET eventos exige período; responsável inválido dá 400', async () => {
    expect((await http().get('/api/rotina/eventos')).status).toBe(400);
    const ruim = await http().get('/api/rotina/eventos').query({ inicio: '2026-11-01T00:00:00Z', fim: '2026-11-30T00:00:00Z', responsavel: 'abc' });
    expect(ruim.status).toBe(400);
    expect(ruim.body.message).toContain('Responsável inválido.');
    const ok = await http().get('/api/rotina/eventos').query({ inicio: '2026-11-01T00:00:00Z', fim: '2026-11-30T00:00:00Z', responsavel: NAO_V4 });
    expect(ok.status).toBe(200);
    expect(rotina.listarEventos).toHaveBeenCalledWith(claims, { inicio: '2026-11-01T00:00:00Z', fim: '2026-11-30T00:00:00Z', responsavel: NAO_V4 });
  });

  it('POST eventos: 201, título aparado e uuid não-v4 aceito no corpo', async () => {
    const res = await http().post('/api/rotina/eventos').send(eventoValido({ reminder_minutes: 30, client_id: null }));
    expect(res.status).toBe(201);
    expect(rotina.criarEvento).toHaveBeenCalledWith(claims, expect.objectContaining({ title: 'Visita', assigned_to: NAO_V4, reminder_minutes: 30, client_id: null }));
  });

  it('POST eventos inválidos: título vazio, prioridade, uuid e chave extra', async () => {
    const vazio = await http().post('/api/rotina/eventos').send(eventoValido({ title: '   ' }));
    expect(vazio.status).toBe(400);
    expect(vazio.body.message).toContain('Informe o título.');
    expect((await http().post('/api/rotina/eventos').send(eventoValido({ priority: 'max' }))).status).toBe(400);
    const uuid = await http().post('/api/rotina/eventos').send(eventoValido({ assigned_to: 'abc' }));
    expect(uuid.status).toBe(400);
    expect(uuid.body.message).toContain('Responsável inválido.');
    expect((await http().post('/api/rotina/eventos').send(eventoValido({ organization_id: A }))).status).toBe(400);
    expect((await http().post('/api/rotina/eventos').send(eventoValido({ reminder_minutes: 525601 }))).status).toBe(400);
    expect(rotina.criarEvento).not.toHaveBeenCalled();
  });

  it('PATCH, concluir e DELETE: uuid não-v4 aceito na URL; abc → 400 id_invalido', async () => {
    expect((await http().patch(`/api/rotina/eventos/${NAO_V4}`).send({ title: 'x' })).status).toBe(200);
    expect(rotina.editarEvento).toHaveBeenCalledWith(claims, NAO_V4, { title: 'x' });
    const ruim = await http().patch('/api/rotina/eventos/abc').send({ title: 'x' });
    expect(ruim.status).toBe(400);
    expect(ruim.body).toEqual({ statusCode: 400, codigo: 'id_invalido', message: 'Identificador inválido.' });
    expect((await http().patch(`/api/rotina/tarefas/${A}`).send({ due_at: null })).status).toBe(200);
    expect((await http().post(`/api/rotina/eventos/${A}/concluir`)).status).toBe(200);
    expect(rotina.concluir).toHaveBeenCalledWith(claims, 'evento', A);
    expect((await http().post(`/api/rotina/tarefas/${A}/concluir`)).status).toBe(200);
    expect(rotina.concluir).toHaveBeenLastCalledWith(claims, 'tarefa', A);
    expect((await http().delete(`/api/rotina/eventos/${A}`)).status).toBe(200);
    expect((await http().delete(`/api/rotina/tarefas/${A}`)).status).toBe(200);
    expect(rotina.remover).toHaveBeenLastCalledWith(claims, 'tarefa', A);
    expect((await http().delete('/api/rotina/tarefas/abc')).body.codigo).toBe('id_invalido');
  });

  it('inbox, conflitos, tarefas e comando', async () => {
    expect((await http().post('/api/rotina/inbox').send({ content: 'nota', kind: 'idea' })).status).toBe(201);
    expect((await http().post('/api/rotina/inbox').send({ content: '  ' })).body.message).toContain('Escreva a anotação.');
    expect((await http().post(`/api/rotina/inbox/${A}/arquivar`)).status).toBe(200);
    expect((await http().post('/api/rotina/conflitos').send({ assigned_to: A, start_at: '2026-11-10T13:00:00Z', end_at: '2026-11-10T14:00:00Z', exclude_event_id: null })).status).toBe(200);
    expect((await http().post('/api/rotina/tarefas').send({ title: 'T', activity_type: 'outro', priority: 'low', assigned_to: A, visibility: 'team', source: 'inbox' })).status).toBe(201);
    expect((await http().post('/api/rotina/comando').send({ command: 'visita amanhã', timezone: 'America/Sao_Paulo' })).status).toBe(200);
    expect((await http().post('/api/rotina/comando').send({ command: '' })).body.message).toContain('Escreva o que deseja organizar.');
  });

  it('rotas do Google', async () => {
    expect((await http().get('/api/rotina/google/status')).status).toBe(200);
    expect((await http().post('/api/rotina/google/conectar')).body).toEqual({ authorization_url: 'https://accounts.google.com/x' });
    expect((await http().post('/api/rotina/google/desconectar')).status).toBe(200);
    expect((await http().patch('/api/rotina/google/privacidade').send({ privacy_mode: 'x' })).body.message).toContain('Modo de privacidade inválido.');
    expect((await http().patch('/api/rotina/google/privacidade').send({ privacy_mode: 'full' })).status).toBe(200);
    expect((await http().get('/api/rotina/google/calendarios')).status).toBe(200);
    expect((await http().patch(`/api/rotina/google/calendarios/${NAO_V4}`).send({ is_default: true })).status).toBe(200);
    expect((await http().post('/api/rotina/google/sincronizar').send({})).status).toBe(200);
    expect(google.sincronizar).toHaveBeenCalledWith(claims, expect.objectContaining({ action: 'sync' }));
    const semEvento = await http().post('/api/rotina/google/sincronizar').send({ action: 'push_event' });
    expect(semEvento.status).toBe(400);
    expect(semEvento.body.message).toContain('Informe a atividade.');
    expect((await http().post('/api/rotina/google/sincronizar').send({ action: 'resolve_conflict_google', event_id: A })).status).toBe(200);
  });

  it('rotas públicas: callback 302 e webhook com o status do serviço', async () => {
    const cb = await http().get('/api/google-agenda/callback').query({ state: 's', code: 'c' });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:8085/rotina?google_calendar=connected');
    expect(google.callback).toHaveBeenCalledWith({ state: 's', code: 'c' });
    google.webhook.mockResolvedValueOnce({ status: 401, body: { error: 'Unauthorized notification' } } as never);
    const wh = await http().post('/api/google-agenda/webhook').set('x-goog-channel-id', 'c1');
    expect(wh.status).toBe(401);
    expect(google.webhook).toHaveBeenCalledWith(expect.objectContaining({ 'x-goog-channel-id': 'c1' }));
  });
});
