import { HttpException } from '@nestjs/common';
import { SincronizarDto } from '../rotina.dto';
import { cifrar } from './cripto';
import { googleEventIdForRoutine } from './mapeamento';
import { RotinaMaintainJob } from './rotina-maintain.job';
import { RotinaGoogleService } from './rotina-google.service';

const CHAVE = 'ab'.repeat(32);
const ORG = '0a000000-0000-4000-8000-000000000000';
const USER = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const EVENTO = '33333333-3333-4333-8333-333333333333';
const claims = { sub: USER, role: 'authenticated' };
const VARIAVEIS = [
  'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_TOKEN_ENCRYPTION_KEY', 'GOOGLE_CALENDAR_REDIRECT_URI',
  'GOOGLE_CALENDAR_APP_REDIRECT_URL', 'GOOGLE_CALENDAR_WEBHOOK_URL', 'SUPABASE_URL', 'ROUTINE_CALENDAR_MAINTAIN_ENABLED',
];
const salvas: Record<string, string | undefined> = {};

function comChaves() {
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'cid';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'segredo';
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = CHAVE;
  process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'https://api.lotti.test/api/google-agenda/callback';
}

const conexao = (extra: Record<string, unknown> = {}) => ({
  id: 'conn-1', organization_id: ORG, user_id: USER, status: 'connected', privacy_mode: 'full' as const,
  access_token_ciphertext: cifrar('token-valido', CHAVE), refresh_token_ciphertext: cifrar('refresh', CHAVE),
  token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), ...extra,
});
const calendario = (extra: Record<string, unknown> = {}) => ({
  id: 'cal-1', connection_id: 'conn-1', organization_id: ORG, user_id: USER, external_calendar_id: 'a@gmail.com', summary: 'A',
  selected: true, is_primary: true, is_default: true, sync_direction: 'bidirectional', ...extra,
});
const evento = (extra: Record<string, unknown> = {}) => ({
  id: EVENTO, organization_id: ORG, title: 'Visita', start_at: '2026-11-10T13:00:00+00:00', end_at: '2026-11-10T14:00:00+00:00',
  sync_version: 2, status: 'confirmed', deleted_at: null, source: 'lotti', ...extra,
});

type Rota = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

function montar(rota: Rota = () => json({}, 500)) {
  const repo = {
    conexaoDoUsuario: jest.fn(async (): Promise<unknown> => null),
    conexaoConectada: jest.fn(async (): Promise<unknown> => null),
    conexoesConectadas: jest.fn(async (): Promise<unknown[]> => []),
    statusConexao: jest.fn(async (): Promise<unknown> => null),
    prepararStart: jest.fn(async () => undefined),
    conexaoPorState: jest.fn(async (): Promise<unknown> => null),
    atualizarConexao: jest.fn(async () => 1),
    limparStateConexao: jest.fn(async () => undefined),
    marcarErroCallback: jest.fn(async () => undefined),
    configurarPrivacidade: jest.fn(async () => 1),
    gravarErroConexao: jest.fn(async () => undefined),
    marcarSincronizada: jest.fn(async () => undefined),
    apagarConexao: jest.fn(async () => 1),
    canaisDaConexao: jest.fn(async (): Promise<unknown[]> => []),
    upsertCalendario: jest.fn(async () => undefined),
    calendariosAtivos: jest.fn(async (): Promise<unknown[]> => [calendario()]),
    calendarioDaConexao: jest.fn(async (): Promise<unknown> => calendario()),
    calendarioComConexaoConectada: jest.fn(async (): Promise<unknown> => null),
    syncState: jest.fn(async (): Promise<unknown> => ({ sync_token_ciphertext: null })),
    criarSyncState: jest.fn(async (): Promise<unknown> => ({})),
    atualizarSyncState: jest.fn(async () => undefined),
    mapeamentoPorGoogleId: jest.fn(async (): Promise<unknown> => null),
    mapeamentoPorEvento: jest.fn(async (): Promise<unknown> => null),
    mapeamentosDeOutrasConexoes: jest.fn(async (): Promise<unknown[]> => []),
    atualizarMapeamento: jest.fn(async () => undefined),
    inserirMapeamento: jest.fn(async () => undefined),
    upsertMapeamento: jest.fn(async () => undefined),
    eventoPorId: jest.fn(async (): Promise<unknown> => evento()),
    atualizarEvento: jest.fn(async (): Promise<number | null> => 3),
    inserirEvento: jest.fn(async () => ({ id: 'novo', sync_version: 1 })),
    eventosParaPush: jest.fn(async (): Promise<unknown[]> => []),
    contextoImovel: jest.fn(async () => null),
    canalVigente: jest.fn(async (): Promise<unknown> => null),
    canaisAtivosDoCalendario: jest.fn(async (): Promise<unknown[]> => []),
    trocarCanal: jest.fn(async () => undefined),
    canalDoWebhook: jest.fn(async (): Promise<unknown> => null),
    inserirRecibo: jest.fn(async (): Promise<'inserido' | 'duplicado'> => 'inserido'),
    apagarRecibo: jest.fn(async () => undefined),
    limparRecibosAntigos: jest.fn(async () => 0),
  };
  const tx = { $queryRaw: jest.fn(async (): Promise<unknown[]> => [{ membership: { organization_id: ORG, user_id: USER }, organization: { id: ORG } }]), $executeRaw: jest.fn() };
  const db = { run: jest.fn(async (_c: unknown, w: (t: typeof tx) => unknown) => w(tx)) };
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = jest.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url: String(url), init });
    return rota(String(url), init);
  });
  const servico = new RotinaGoogleService(db as never, repo as never, fetcher as unknown as typeof fetch);
  return { repo, tx, db, fetcher, chamadas, servico };
}

async function erroDe(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('não lançou');
}

beforeEach(() => { for (const v of VARIAVEIS) { salvas[v] ??= process.env[v]; delete process.env[v]; } });
afterAll(() => { for (const v of VARIAVEIS) { if (salvas[v] === undefined) delete process.env[v]; else process.env[v] = salvas[v]; } });

describe('matriz de configuração (§0.5)', () => {
  it('sem chaves: G1 responde, G3 apaga sem rede; G2, G7 e webhook dão 503', async () => {
    const { repo, fetcher, servico } = montar();
    expect(await servico.status(claims)).toEqual({ connected: false, status: 'not_connected' });
    repo.conexaoDoUsuario.mockResolvedValueOnce(conexao());
    expect(await servico.desconectar(claims)).toEqual({ disconnected: true });
    expect(repo.apagarConexao).toHaveBeenCalledWith('conn-1', ORG, USER);
    expect(fetcher).not.toHaveBeenCalled();
    for (const p of [servico.conectar(claims), servico.sincronizar(claims, new SincronizarDto()), servico.webhook({})]) {
      const { status, body } = await erroDe(p);
      expect(status).toBe(503);
      expect(body.codigo).toBe('google_nao_configurado');
    }
  });

  it('sem chaves: callback redireciona com google_calendar=error e push em segundo plano não faz nada', async () => {
    const { repo, servico } = montar();
    expect(await servico.callback({ state: 's', code: 'c' })).toBe('http://localhost:8085/rotina?google_calendar=error');
    expect(repo.conexaoPorState).not.toHaveBeenCalled();
    await servico.pushEventoEmSegundoPlano(EVENTO, USER);
    expect(repo.eventoPorId).not.toHaveBeenCalled();
  });

  it('job maintain só registra com a variável nova e o Google configurado', () => {
    const job = new RotinaMaintainJob({} as never, { connection: { url: 'redis://x' } } as never);
    expect(job.deveRegistrar({})).toBe(false);
    expect(job.deveRegistrar({ ROUTINE_CALENDAR_MAINTAIN_ENABLED: 'true' })).toBe(false);
    expect(job.deveRegistrar({
      ROUTINE_CALENDAR_MAINTAIN_ENABLED: 'true', GOOGLE_CALENDAR_CLIENT_ID: 'a', GOOGLE_CALENDAR_CLIENT_SECRET: 'b', GOOGLE_TOKEN_ENCRYPTION_KEY: CHAVE,
    })).toBe(true);
  });
});

describe('auth', () => {
  it('G2 start grava hash do state e verifier cifrado; URL com PKCE S256', async () => {
    comChaves();
    const { repo, servico } = montar();
    const { authorization_url } = await servico.conectar(claims);
    const url = new URL(authorization_url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent select_account');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.lotti.test/api/google-agenda/callback');
    const [org, uid, hash, ver] = repo.prepararStart.mock.calls[0] as unknown as string[];
    expect([org, uid]).toEqual([ORG, USER]);
    expect(hash).not.toBe(url.searchParams.get('state'));
    expect(ver.startsWith('v1.')).toBe(true);
  });

  it('G2 sem redirect URI nem SUPABASE_URL → 503', async () => {
    comChaves();
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    const { servico } = montar();
    expect((await erroDe(servico.conectar(claims))).status).toBe(503);
  });

  it('G4 sem conexão → 409 google_nao_conectado', async () => {
    const { servico } = montar();
    expect((await erroDe(servico.configurarPrivacidade(claims, { privacy_mode: 'full' }))).body.codigo).toBe('google_nao_conectado');
  });

  it('callback com erro: connected só limpa o state; pending vira error; URL só com google_calendar', async () => {
    comChaves();
    const { repo, servico } = montar();
    repo.conexaoPorState.mockResolvedValueOnce(conexao({ status: 'connected' }));
    const url = await servico.callback({ state: 's', error: 'access_denied' });
    expect([...new URL(url).searchParams.entries()]).toEqual([['google_calendar', 'error']]);
    expect(repo.limparStateConexao).toHaveBeenCalledWith('conn-1');
    expect(repo.marcarErroCallback).not.toHaveBeenCalled();

    repo.conexaoPorState.mockResolvedValueOnce(conexao({ status: 'pending' }));
    await servico.callback({ state: 's', error: 'access_denied' });
    expect(repo.marcarErroCallback).toHaveBeenCalledWith('conn-1', 'oauth_denied');

    repo.conexaoPorState.mockResolvedValueOnce(null);
    expect(await servico.callback({ state: 'x', code: 'c' })).toContain('google_calendar=error');
    expect(await servico.callback({ code: 'c' })).toContain('google_calendar=error');
  });

  it('callback: troca falha numa conexão pending grava o código; sucesso conecta e preserva calendários pelo upsert', async () => {
    comChaves();
    const { repo, servico } = montar((url) => {
      if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600, scope: 'openid email' });
      if (url.includes('userinfo')) return json({ sub: 'g-sub', email: 'a@gmail.com' });
      if (url.includes('calendarList')) return json({ items: [{ id: 'a@gmail.com', summary: 'A', primary: true, accessRole: 'owner' }, { id: 'feriados', accessRole: 'reader' }] });
      return json({}, 500);
    });
    repo.conexaoPorState.mockResolvedValueOnce(conexao({ status: 'pending', pkce_verifier_ciphertext: cifrar('verif', CHAVE) }));
    expect(await servico.callback({ state: 's', code: 'c' })).toBe('http://localhost:8085/rotina?google_calendar=connected');
    const campos = repo.atualizarConexao.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(campos[1]).toMatchObject({ status: 'connected', provider_email: 'a@gmail.com', scopes: ['openid', 'email'], oauth_state_hash: null, oauth_expires_at: null });
    expect(repo.upsertCalendario).toHaveBeenCalledTimes(2);
    expect((repo.upsertCalendario.mock.calls[1] as unknown[])[1]).toMatchObject({ external_calendar_id: 'feriados', sync_direction: 'import_only', primary: false, summary: 'Google Agenda' });

    repo.conexaoPorState.mockResolvedValueOnce(conexao({ status: 'pending', pkce_verifier_ciphertext: 'quebrado' }));
    expect(await servico.callback({ state: 's', code: 'c' })).toContain('google_calendar=error');
    expect(repo.marcarErroCallback).toHaveBeenCalledWith('conn-1', 'token_decrypt_failed');
  });

  it('refresh com invalid_grant grava refresh_token_revoked', async () => {
    comChaves();
    const { repo, servico } = montar(() => json({ error: 'invalid_grant' }, 400));
    await expect(servico.accessTokenForConnection(conexao({ token_expires_at: null }) as never)).rejects.toThrow('refresh_token_revoked');
    expect(repo.atualizarConexao).toHaveBeenCalledWith('conn-1', { status: 'expired', last_error_code: 'refresh_token_revoked' });
  });

  it('token válido é reutilizado sem rede; expirado é renovado e salvo cifrado', async () => {
    comChaves();
    const { repo, fetcher, servico } = montar(() => json({ access_token: 'novo', expires_in: 3600 }));
    expect(await servico.accessTokenForConnection(conexao() as never)).toBe('token-valido');
    expect(fetcher).not.toHaveBeenCalled();
    expect(await servico.accessTokenForConnection(conexao({ token_expires_at: null }) as never)).toBe('novo');
    const salvo = (repo.atualizarConexao.mock.calls[0] as unknown as [string, Record<string, string>])[1];
    expect(salvo.access_token_ciphertext.startsWith('v1.')).toBe(true);
  });
});

describe('sync e push', () => {
  it('push 412 → conflict; 404 sem mapeamento → POST com id determinístico; erro num evento não aborta os outros', async () => {
    comChaves();
    const outro = '44444444-4444-4444-8444-444444444444';
    const terceiro = '55555555-5555-4555-8555-555555555555';
    const { repo, chamadas, servico } = montar((url, init) => {
      if (init.method === 'PUT' && url.endsWith(googleEventIdForRoutine(EVENTO))) return json({}, 412);
      if (init.method === 'PUT' && url.endsWith(googleEventIdForRoutine(outro))) return json({}, 404);
      if (init.method === 'POST' && url.includes('sendUpdates=none')) return json({ id: googleEventIdForRoutine(outro), etag: 'e' });
      if (init.method === 'PUT') return json({ error: 'quebrou' }, 400);
      if (url.includes('/events?')) return json({ items: [] });
      return json({}, 500);
    });
    repo.mapeamentoPorEvento.mockImplementation(async () => null);
    repo.eventosParaPush.mockResolvedValueOnce([evento(), evento({ id: outro }), evento({ id: terceiro })]);
    const r = await servico.syncConnection(conexao() as never);
    expect(r).toEqual({ imported: 0, cancelled: 0, pushed: 1, conflicts: 1, errors: 1 });
    expect(repo.atualizarEvento).toHaveBeenCalledWith(EVENTO, null, { sync_status: 'conflict' });
    expect(repo.atualizarEvento).toHaveBeenCalledWith(terceiro, null, { sync_status: 'error' });
    const post = chamadas.find((c) => c.init.method === 'POST');
    expect(JSON.parse(String(post!.init.body)).id).toBe(googleEventIdForRoutine(outro));
    expect(repo.upsertMapeamento).toHaveBeenCalledWith(expect.objectContaining({ routine_event_id: outro, external_calendar_id: 'cal-1' }));
    expect(repo.marcarSincronizada).toHaveBeenCalledWith('conn-1');
  });

  it('evento mapeado num calendário import_only não recebe PUT', async () => {
    comChaves();
    const { repo, chamadas, servico } = montar(() => json({ items: [] }));
    repo.mapeamentoPorEvento.mockResolvedValueOnce({ id: 'm', external_calendar_id: 'cal-ro', google_event_id: 'g', sync_version: 1 });
    repo.calendarioDaConexao.mockResolvedValueOnce(calendario({ id: 'cal-ro', sync_direction: 'import_only' }));
    repo.eventosParaPush.mockResolvedValueOnce([evento()]);
    expect((await servico.syncConnection(conexao() as never, EVENTO)).pushed).toBe(0);
    expect(chamadas.some((c) => c.init.method === 'PUT')).toBe(false);
  });

  it('troca de responsável: DELETE na conexão antiga conectada e marca; desconectada só marca', async () => {
    comChaves();
    const { repo, chamadas, servico } = montar((_u, init) => (init.method === 'DELETE' ? new Response(null, { status: 410 }) : json({ items: [] })));
    repo.conexaoConectada.mockResolvedValueOnce(conexao({ id: 'conn-novo', user_id: OUTRO }));
    repo.mapeamentosDeOutrasConexoes.mockResolvedValueOnce([
      { id: 'm-ok', google_event_id: 'g1', calendario_externo: 'a@gmail.com', conexao: conexao() },
      { id: 'm-off', google_event_id: 'g2', calendario_externo: 'b@gmail.com', conexao: conexao({ id: 'conn-x', status: 'expired' }) },
    ]);
    await servico.pushEventoEmSegundoPlano(EVENTO, OUTRO, USER);
    expect(repo.mapeamentosDeOutrasConexoes).toHaveBeenCalledWith(EVENTO, ORG, 'conn-novo');
    const deletes = chamadas.filter((c) => c.init.method === 'DELETE');
    expect(deletes.map((c) => c.url)).toEqual(['https://www.googleapis.com/calendar/v3/calendars/a%40gmail.com/events/g1']);
    expect(repo.atualizarMapeamento).toHaveBeenCalledWith('m-ok', expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(repo.atualizarMapeamento).toHaveBeenCalledWith('m-off', expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(repo.eventosParaPush).toHaveBeenCalledWith(expect.objectContaining({ id: 'conn-novo' }), EVENTO, false);
  });

  it('G7 push_event usa a conexão do responsável; sem ela devolve skipped; resolve sem ela → 409', async () => {
    comChaves();
    const { repo, tx, servico } = montar();
    tx.$queryRaw
      .mockResolvedValueOnce([{ membership: { organization_id: ORG }, organization: {} }]).mockResolvedValueOnce([{ assigned_to: OUTRO }])
      .mockResolvedValueOnce([{ membership: { organization_id: ORG }, organization: {} }]).mockResolvedValueOnce([{ assigned_to: OUTRO }])
      .mockResolvedValueOnce([{ membership: { organization_id: ORG }, organization: {} }]).mockResolvedValueOnce([]);
    expect(await servico.sincronizar(claims, Object.assign(new SincronizarDto(), { action: 'push_event', event_id: EVENTO }))).toEqual({ skipped: true });
    expect(repo.conexaoConectada).toHaveBeenCalledWith(ORG, OUTRO);
    expect((await erroDe(servico.sincronizar(claims, Object.assign(new SincronizarDto(), { action: 'resolve_conflict_lotti', event_id: EVENTO })))).body.codigo).toBe('google_nao_conectado');
    expect((await erroDe(servico.sincronizar(claims, Object.assign(new SincronizarDto(), { action: 'push_event', event_id: EVENTO })))).status).toBe(404);
  });

  it('G7 sync: falha geral grava last_error_code e responde 500 sync_pendente', async () => {
    comChaves();
    const { repo, servico } = montar(() => json({}, 403));
    repo.conexaoConectada.mockResolvedValueOnce(conexao());
    const { status, body } = await erroDe(servico.sincronizar(claims, new SincronizarDto()));
    expect(status).toBe(500);
    expect(body.codigo).toBe('sync_pendente');
    expect(repo.gravarErroConexao).toHaveBeenCalledWith('conn-1', 'events_list_failed_403');
  });
});

describe('webhook (P2)', () => {
  const cabecalhos = (token = 'tok') => ({
    'x-goog-channel-id': 'canal', 'x-goog-channel-token': token, 'x-goog-resource-id': 'rec', 'x-goog-resource-state': 'exists', 'x-goog-message-number': '5',
  });

  it('cabeçalho faltando → 400; token errado → 401', async () => {
    comChaves();
    const { repo, servico } = montar();
    expect((await servico.webhook({ 'x-goog-channel-id': 'c' })).status).toBe(400);
    const { sha256Base64Url } = await import('./cripto');
    repo.canalDoWebhook.mockResolvedValueOnce({ channel_token_hash: sha256Base64Url('certo'), external_calendar_id: 'cal-1' });
    expect(await servico.webhook(cabecalhos('errado'))).toEqual({ status: 401, body: { error: 'Unauthorized notification' } });
    expect(repo.inserirRecibo).not.toHaveBeenCalled();
  });

  it('duplicado → duplicate:true; sucesso só faz pull do calendário, sem push', async () => {
    comChaves();
    const { sha256Base64Url } = await import('./cripto');
    const { repo, chamadas, servico } = montar(() => json({ items: [], nextSyncToken: 'n' }));
    repo.canalDoWebhook.mockResolvedValue({ channel_token_hash: sha256Base64Url('tok'), external_calendar_id: 'cal-1' });
    repo.inserirRecibo.mockResolvedValueOnce('duplicado');
    expect(await servico.webhook(cabecalhos())).toEqual({ status: 200, body: { received: true, duplicate: true } });
    repo.calendarioComConexaoConectada.mockResolvedValueOnce({ calendario: calendario({ selected: false, sync_direction: 'import_only' }), conexao: conexao() });
    expect(await servico.webhook(cabecalhos())).toEqual({ status: 200, body: { received: true } });
    expect(repo.calendarioComConexaoConectada).toHaveBeenCalledWith('cal-1');
    expect(chamadas.map((c) => c.init.method ?? 'GET')).toEqual(['GET']);
    expect(repo.eventosParaPush).not.toHaveBeenCalled();
    expect(repo.calendariosAtivos).not.toHaveBeenCalled();
  });

  it('falha no pull apaga o recibo e responde 500; sem conexão conectada também', async () => {
    comChaves();
    const { sha256Base64Url } = await import('./cripto');
    const { repo, servico } = montar(() => json({}, 403));
    repo.canalDoWebhook.mockResolvedValue({ channel_token_hash: sha256Base64Url('tok'), external_calendar_id: 'cal-1' });
    repo.calendarioComConexaoConectada.mockResolvedValueOnce({ calendario: calendario(), conexao: conexao() });
    expect((await servico.webhook(cabecalhos())).status).toBe(500);
    expect(repo.apagarRecibo).toHaveBeenCalledWith('canal', 5);
    expect(repo.gravarErroConexao).toHaveBeenCalledWith('conn-1', 'events_list_failed_403');
    expect((await servico.webhook(cabecalhos())).status).toBe(500);
    expect(repo.apagarRecibo).toHaveBeenCalledTimes(2);
  });
});
