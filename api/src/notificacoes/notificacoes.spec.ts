import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstValueFrom, take, toArray } from 'rxjs';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AlertasHub } from './alertas-hub';
import { AlertasListener, ClienteAviso } from './alertas-listener';
import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService, paraSino } from './notificacoes.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const claims = { sub: 'u1', role: 'authenticated' };

describe('AlertasHub', () => {
  it('avisa só quem é dono do alerta e bate o coração para manter a conexão', async () => {
    const hub = new AlertasHub();
    hub.batimentoMs = 5;
    const deA = firstValueFrom(hub.observar(A).pipe(take(2), toArray()));
    const deB: unknown[] = [];
    const sub = hub.observar(B).subscribe((e) => deB.push(e));
    hub.avisar(A);
    expect(await deA).toEqual([{ data: { tipo: 'alertas' } }, { data: { tipo: 'ping' } }]);
    expect(deB.filter((e) => (e as { data: { tipo: string } }).data.tipo === 'alertas')).toEqual([]);
    sub.unsubscribe();
  });
});

describe('AlertasListener', () => {
  function fakeCliente() {
    const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
    const c = {
      queries: [] as string[],
      connect: jest.fn(async () => undefined),
      query: jest.fn(async (sql: string) => { c.queries.push(sql); }),
      end: jest.fn(async () => undefined),
      on: (ev: string, fn: (...a: unknown[]) => void) => { (handlers[ev] ||= []).push(fn); return c; },
      removeAllListeners: () => { for (const k of Object.keys(handlers)) delete handlers[k]; return c; },
      emitir: (ev: string, ...a: unknown[]) => (handlers[ev] || []).forEach((f) => f(...a)),
    };
    return c;
  }
  const env = (directUrl?: string) => ({ isProd: false, port: 1, databaseUrl: 'x', directUrl, redisUrl: 'x', supabaseUrl: 'x', corsOrigins: [] });

  it('escuta lotti_alertas e repassa só ids válidos para o hub', async () => {
    const hub = new AlertasHub();
    const avisos: string[] = [];
    hub.avisar = (id) => { avisos.push(id); };
    const cliente = fakeCliente();
    const listener = new AlertasListener(env('postgresql://x'), hub, () => cliente as unknown as ClienteAviso);
    await listener.conectar();
    expect(cliente.queries).toEqual(['LISTEN lotti_alertas']);
    cliente.emitir('notification', { channel: 'lotti_alertas', payload: A });
    cliente.emitir('notification', { channel: 'lotti_alertas', payload: "x'; drop" });
    cliente.emitir('notification', { channel: 'outro', payload: B });
    expect(avisos).toEqual([A]);
    await listener.onModuleDestroy();
    expect(cliente.end).toHaveBeenCalled();
  });

  it('sem DIRECT_URL não liga (o sino segue pela sondagem do front)', () => {
    const fabrica = jest.fn();
    new AlertasListener(env(undefined), new AlertasHub(), fabrica).onModuleInit();
    expect(fabrica).not.toHaveBeenCalled();
  });

  it('se a conexão cai, reconecta com espera crescente', async () => {
    jest.useFakeTimers();
    try {
      const clientes = [fakeCliente(), fakeCliente()];
      let i = 0;
      const listener = new AlertasListener(env('postgresql://x'), new AlertasHub(), () => clientes[i++] as unknown as ClienteAviso);
      await listener.conectar();
      clientes[0].emitir('error', new Error('caiu'));
      expect(clientes[0].end).toHaveBeenCalled();
      expect(i).toBe(1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(i).toBe(2);
      expect(clientes[1].queries).toEqual(['LISTEN lotti_alertas']);
      await listener.onModuleDestroy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('NotificacoesService', () => {
  const linha = {
    id: 'a1', clienteId: null, corretorId: 'c1', tipo: 'GERAL', mensagem: 'Oi', metadata: { prioridade: 'ALTA' }, lido: false,
    createdAt: new Date('2026-10-04T12:00:00Z'), readAt: null, origem: 'ia', entidadeTipo: 'cliente', entidadeId: 'e1',
  };

  it('devolve no formato que o sino já usa (colunas do banco)', () => {
    expect(paraSino(linha as never)).toEqual({
      id: 'a1', cliente_id: null, corretor_id: 'c1', tipo: 'GERAL', mensagem: 'Oi', metadata: { prioridade: 'ALTA' }, lido: false,
      created_at: '2026-10-04T12:00:00.000Z', read_at: null, origem: 'ia', entidade_tipo: 'cliente', entidade_id: 'e1',
    });
  });

  it('lista pelo TenantDb, mais recentes primeiro, com limite', async () => {
    const findMany = jest.fn(async (_q: unknown) => [linha]);
    const db = { run: jest.fn(async (_c: unknown, w: (tx: unknown) => unknown) => w({ alerta: { findMany } })) };
    const out = await new NotificacoesService(db as never).listar(claims, 50);
    expect(db.run).toHaveBeenCalledWith(claims, expect.any(Function));
    expect(findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 50 });
    expect(out).toHaveLength(1);
  });

  it('marca lidas pela mesma função do banco que o front usa (todas quando não vêm ids)', async () => {
    const chamadas: unknown[][] = [];
    const tx = { $queryRaw: jest.fn(async (_s: TemplateStringsArray, ...v: unknown[]) => { chamadas.push(v); return [{ n: 3 }]; }) };
    const db = { run: jest.fn(async (_c: unknown, w: (t: unknown) => unknown) => w(tx)) };
    const s = new NotificacoesService(db as never);
    expect(await s.marcarLidas(claims)).toBe(3);
    expect(await s.marcarLidas(claims, [A])).toBe(3);
    expect(chamadas).toEqual([[null], [[A]]]);
  });
});

describe('NotificacoesController', () => {
  let app: INestApplication;
  const servico = {
    listar: jest.fn(async (_c: unknown, _l?: number) => [{ id: 'a1' }]),
    marcarLidas: jest.fn(async (_c: unknown, _ids?: string[]) => 2),
    corretorId: jest.fn(async (_c: unknown) => A as string | null),
  };
  const hub = new AlertasHub();
  const libera: CanActivate = { canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = claims; return true; } };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      controllers: [NotificacoesController],
      providers: [{ provide: NotificacoesService, useValue: servico }, { provide: AlertasHub, useValue: hub }],
    }).overrideGuard(SupabaseAuthGuard).useValue(libera).compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('GET /api/notificacoes com limite validado', async () => {
    expect((await request(app.getHttpServer()).get('/api/notificacoes?limite=20')).body).toEqual([{ id: 'a1' }]);
    expect(servico.listar).toHaveBeenCalledWith(claims, 20);
    expect((await request(app.getHttpServer()).get('/api/notificacoes?limite=9999')).status).toBe(400);
  });

  it('POST /api/notificacoes/lidas aceita só uuids', async () => {
    const ok = await request(app.getHttpServer()).post('/api/notificacoes/lidas').send({ ids: [A] });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ marcadas: 2 });
    expect(servico.marcarLidas).toHaveBeenCalledWith(claims, [A]);
    expect((await request(app.getHttpServer()).post('/api/notificacoes/lidas').send({ ids: ['x'] })).status).toBe(400);
  });

  it('eventos: o fluxo do sino segue o corretor de quem está logado', async () => {
    const controller = app.get(NotificacoesController);
    const primeiro = firstValueFrom(controller.eventos(claims).pipe(take(1)));
    await new Promise((r) => setImmediate(r));
    hub.avisar(B);
    hub.avisar(A);
    expect(await primeiro).toEqual({ data: { tipo: 'alertas' } });
  });
});
