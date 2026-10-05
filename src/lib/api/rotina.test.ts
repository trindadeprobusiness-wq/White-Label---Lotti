/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dublê do supabase-js: qualquer encadeamento de `.from(...)` termina em { data: [], error: null }.
const from = vi.fn();
const rpc = vi.fn(async (..._a: unknown[]) => ({ data: [], error: null }));
const invoke = vi.fn(async (..._a: unknown[]) => ({ data: null, error: null }));
function consulta(): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok, erro),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => consulta()) });
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
    from: (...a: unknown[]) => { from(...a); return consulta(); },
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

const USUARIO = '11111111-1111-4111-8111-111111111111';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: USUARIO } }) }));

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('sonner', () => ({ toast }));

const BASE = 'https://api.exemplo.com';
const EVENTO = '22222222-2222-4222-8222-222222222222';
const TAREFA = '33333333-3333-4333-8333-333333333333';
const CAL = '44444444-4444-4444-8444-444444444444';
const INBOX = '55555555-5555-4555-8555-555555555555';
const ORG = '66666666-6666-4666-8666-666666666666';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  from.mockClear(); rpc.mockClear(); invoke.mockClear();
  toast.success.mockClear(); toast.error.mockClear(); toast.warning.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const chamada = (i = 0) => {
  const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit & { headers: Record<string, string> };
  return {
    url: fetchMock.mock.calls[i][0] as string,
    method: init.method ?? 'GET',
    corpo: init.body === undefined ? undefined : JSON.parse(init.body as string),
    headers: init.headers,
  };
};

async function carregarCliente() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./rotina');
}

describe('cliente da API da rotina', () => {
  it('cada função chama o caminho e o método fixos, com o corpo esperado e o token', async () => {
    const api = await carregarCliente();
    const casos: Array<{ chamar: () => Promise<unknown>; url: string; method: string; corpo?: unknown; status?: number; resposta?: unknown; espera?: unknown }> = [
      { chamar: () => api.contextoRotinaApi(), url: '/api/rotina/contexto', method: 'GET', resposta: null, espera: null },
      { chamar: () => api.listarMembrosApi(), url: '/api/rotina/membros', method: 'GET', resposta: [] },
      { chamar: () => api.listarTarefasApi(), url: '/api/rotina/tarefas', method: 'GET', resposta: [] },
      { chamar: () => api.listarTarefasApi({ responsavel: USUARIO }), url: `/api/rotina/tarefas?responsavel=${USUARIO}`, method: 'GET', resposta: [] },
      { chamar: () => api.listarAtividadeApi(), url: '/api/rotina/atividade', method: 'GET', resposta: [] },
      { chamar: () => api.listarInboxApi(), url: '/api/rotina/inbox', method: 'GET', resposta: [] },
      { chamar: () => api.criarInboxApi({ content: 'Ligar', kind: 'note' }), url: '/api/rotina/inbox', method: 'POST', corpo: { content: 'Ligar', kind: 'note' }, status: 201, resposta: { id: INBOX } },
      { chamar: () => api.arquivarInboxApi(INBOX), url: `/api/rotina/inbox/${INBOX}/arquivar`, method: 'POST', resposta: { arquivado: true }, espera: undefined },
      {
        chamar: () => api.detectarConflitosApi({ assigned_to: USUARIO, start_at: 'a', end_at: 'b' }),
        url: '/api/rotina/conflitos', method: 'POST', corpo: { assigned_to: USUARIO, start_at: 'a', end_at: 'b', exclude_event_id: null }, resposta: [],
      },
      {
        chamar: () => api.criarEventoApi({ title: 'Visita', assigned_to: USUARIO, start_at: 'a', end_at: 'b', organization_id: ORG, reminder_minutes: null }),
        url: '/api/rotina/eventos', method: 'POST', corpo: { title: 'Visita', assigned_to: USUARIO, start_at: 'a', end_at: 'b', reminder_minutes: null },
        status: 201, resposta: { evento: { id: EVENTO }, lembrete_criado: false }, espera: { id: EVENTO },
      },
      {
        chamar: () => api.criarTarefaApi({ title: 'Ligar', assigned_to: USUARIO, due_at: null, created_by: USUARIO }),
        url: '/api/rotina/tarefas', method: 'POST', corpo: { title: 'Ligar', assigned_to: USUARIO, due_at: null }, status: 201, resposta: { id: TAREFA },
      },
      {
        chamar: () => api.editarEventoApi(EVENTO, { start_at: 'a', end_at: 'b', id: EVENTO, updated_at: 'x' }, '2026-10-05T10:00:00.123456+00:00'),
        url: `/api/rotina/eventos/${EVENTO}`, method: 'PATCH', corpo: { start_at: 'a', end_at: 'b', expected_updated_at: '2026-10-05T10:00:00.123456+00:00' }, resposta: { id: EVENTO },
      },
      { chamar: () => api.editarTarefaApi(TAREFA, { title: 'Novo' }), url: `/api/rotina/tarefas/${TAREFA}`, method: 'PATCH', corpo: { title: 'Novo' }, resposta: { id: TAREFA } },
      {
        chamar: () => api.concluirItemApi('event', EVENTO), url: `/api/rotina/eventos/${EVENTO}/concluir`, method: 'POST',
        resposta: { item: { id: EVENTO }, registrado_no_crm: true }, espera: { id: EVENTO },
      },
      {
        chamar: () => api.concluirItemApi('task', TAREFA), url: `/api/rotina/tarefas/${TAREFA}/concluir`, method: 'POST',
        resposta: { item: { id: TAREFA }, registrado_no_crm: false }, espera: { id: TAREFA },
      },
      { chamar: () => api.removerItemApi('event', EVENTO), url: `/api/rotina/eventos/${EVENTO}`, method: 'DELETE', resposta: { removido: true }, espera: undefined },
      { chamar: () => api.removerItemApi('task', TAREFA), url: `/api/rotina/tarefas/${TAREFA}`, method: 'DELETE', resposta: { removido: true }, espera: undefined },
      { chamar: () => api.statusGoogleApi(), url: '/api/rotina/google/status', method: 'GET', resposta: { connected: false, status: 'not_connected' } },
      { chamar: () => api.conectarGoogleApi(), url: '/api/rotina/google/conectar', method: 'POST', resposta: { authorization_url: 'https://accounts.google.com/x' } },
      { chamar: () => api.desconectarGoogleApi(), url: '/api/rotina/google/desconectar', method: 'POST', resposta: { disconnected: true } },
      { chamar: () => api.configurarPrivacidadeApi('busy_only'), url: '/api/rotina/google/privacidade', method: 'PATCH', corpo: { privacy_mode: 'busy_only' }, resposta: { configured: true, privacy_mode: 'busy_only' } },
      { chamar: () => api.listarCalendariosApi(), url: '/api/rotina/google/calendarios', method: 'GET', resposta: [] },
      {
        chamar: () => api.configurarCalendarioApi(CAL, { is_default: true, organization_id: ORG }),
        url: `/api/rotina/google/calendarios/${CAL}`, method: 'PATCH', corpo: { is_default: true }, resposta: { id: CAL },
      },
      { chamar: () => api.sincronizarGoogleApi(), url: '/api/rotina/google/sincronizar', method: 'POST', corpo: { action: 'sync' }, resposta: { synced: true } },
      {
        chamar: () => api.sincronizarGoogleApi('resolve_conflict_google', EVENTO), url: '/api/rotina/google/sincronizar', method: 'POST',
        corpo: { action: 'resolve_conflict_google', event_id: EVENTO }, resposta: { resolved: true },
      },
      {
        chamar: () => api.interpretarComandoApi('visita amanhã 10h', 'America/Sao_Paulo'), url: '/api/rotina/comando', method: 'POST',
        corpo: { command: 'visita amanhã 10h', timezone: 'America/Sao_Paulo' }, resposta: { proposal: {} },
      },
    ];
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [i, c] of casos.entries()) {
      fetchMock.mockResolvedValueOnce(json('resposta' in c ? c.resposta : {}, c.status ?? 200));
      const r = await c.chamar();
      const feita = chamada(i);
      expect(feita.url, c.url).toBe(`${BASE}${c.url}`);
      expect(feita.method, c.url).toBe(c.method);
      expect(feita.corpo, c.url).toEqual(c.corpo);
      expect(feita.headers.Authorization).toBe('Bearer tok');
      expect(r, c.url).toEqual('espera' in c ? c.espera : c.resposta);
    }
    // lembrete recusado pelo servidor vira aviso no console, sem erro
    expect(aviso).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({ evento: { id: EVENTO }, lembrete_criado: false }, 201));
    await api.criarEventoApi({ title: 'x', reminder_minutes: 15 });
    expect(aviso).toHaveBeenCalledTimes(1);
    aviso.mockRestore();
  });

  it('listarEventosApi manda inicio e fim, e responsavel só quando houver', async () => {
    const api = await carregarCliente();
    fetchMock.mockImplementation(async () => json([]));
    await api.listarEventosApi({ inicio: '2026-10-01T00:00:00.000Z', fim: '2026-10-31T23:59:59.999Z' });
    await api.listarEventosApi({ inicio: '2026-10-01T00:00:00.000Z', fim: '2026-10-31T23:59:59.999Z', responsavel: USUARIO });
    const q0 = new URL(chamada(0).url).searchParams;
    const q1 = new URL(chamada(1).url).searchParams;
    expect(new URL(chamada(0).url).pathname).toBe('/api/rotina/eventos');
    expect(q0.get('inicio')).toBe('2026-10-01T00:00:00.000Z');
    expect(q0.get('fim')).toBe('2026-10-31T23:59:59.999Z');
    expect(q0.has('responsavel')).toBe(false);
    expect(q1.get('responsavel')).toBe(USUARIO);
  });

  it('409 CONFLICT vira Error("CONFLICT") com conflicts; CONCURRENCY_CONFLICT vira o Error de mesmo nome', async () => {
    const api = await carregarCliente();
    const conflitos = [{ event_id: EVENTO, title: 'Outro', start_at: 'a', end_at: 'b', is_private: false }];
    fetchMock.mockResolvedValueOnce(json({ statusCode: 409, codigo: 'CONFLICT', message: 'Existe outro compromisso nesse horário.', conflicts: conflitos }, 409));
    const e1 = await api.criarEventoApi({ title: 'x' }).catch((e) => e);
    expect(e1).toBeInstanceOf(Error);
    expect(e1.message).toBe('CONFLICT');
    expect(e1.conflicts).toEqual(conflitos);

    fetchMock.mockResolvedValueOnce(json({ statusCode: 409, codigo: 'CONCURRENCY_CONFLICT', message: 'Esse compromisso mudou.' }, 409));
    const e2 = await api.editarEventoApi(EVENTO, { title: 'x' }, 'v').catch((e) => e);
    expect(e2.message).toBe('CONCURRENCY_CONFLICT');

    fetchMock.mockResolvedValueOnce(json({ statusCode: 403, codigo: 'sem_permissao', message: 'Você não tem permissão para alterar esta atividade.' }, 403));
    const e3 = await api.removerItemApi('task', TAREFA).catch((e) => e);
    expect(e3.name).toBe('ErroApi');
    expect(e3.status).toBe(403);
    expect(e3.message).toBe('Você não tem permissão para alterar esta atividade.');

    fetchMock.mockResolvedValueOnce(json({ statusCode: 503, codigo: 'google_nao_configurado', message: 'x' }, 503));
    const e4 = await api.conectarGoogleApi().catch((e) => e);
    expect(e4.message).toBe('Não foi possível iniciar a conexão com o Google.');
  });
});

// ── Adaptadores (useRoutine, useGoogleCalendarReturn) ────────────────────

const contexto = {
  organization: { id: ORG, timezone: 'America/Sao_Paulo' },
  membership: { user_id: USUARIO },
} as never;

function invólucro() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: ['/rotina?google_calendar=connected'] },
      createElement(QueryClientProvider, { client: qc }, children));
}

async function carregarHooks(comApi: boolean) {
  vi.resetModules();
  if (comApi) vi.stubEnv('VITE_API_URL', BASE);
  else vi.stubEnv('VITE_API_URL', '');
  return import('@/hooks/routine/useRoutine');
}

const rascunhoEvento = {
  kind: 'event', title: 'Visita', description: '', activity_type: 'visita', priority: 'medium',
  assigned_to: USUARIO, visibility: 'team', start_at: '2026-10-06T13:00:00.000Z', end_at: '2026-10-06T14:00:00.000Z',
  all_day: false, recurrence_rule: '', location: '', client_id: '', property_id: '', reminder_minutes: 30,
} as never;

describe('adaptadores da rotina', () => {
  it('sem VITE_API_URL, useRoutine segue no Supabase e não chama a API', async () => {
    const hooks = await carregarHooks(false);
    const range = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-10-31T00:00:00Z') };
    const w = invólucro();
    const ev = renderHook(() => hooks.useRoutineEvents(contexto, range, 'mine'), { wrapper: w });
    const tf = renderHook(() => hooks.useRoutineTasks(contexto), { wrapper: w });
    await waitFor(() => expect(ev.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(tf.result.current.isSuccess).toBe(true));

    const acoes = renderHook(() => hooks.useRoutineActions(contexto), { wrapper: w });
    await acoes.result.current.create.mutateAsync(rascunhoEvento).catch(() => undefined);
    await acoes.result.current.checkConflicts(USUARIO, 'a', 'b');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('routine_events');
    expect(from).toHaveBeenCalledWith('routine_tasks');
    expect(rpc).toHaveBeenCalledWith('routine_detect_conflicts', expect.anything());
  });

  it('com VITE_API_URL, lista e cria pela API, sem Supabase, sem push nem RPC no front', async () => {
    const hooks = await carregarHooks(true);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/rotina/eventos?')) return json([]);
      if (url.endsWith('/api/rotina/eventos')) return json({ evento: { id: EVENTO }, lembrete_criado: true }, 201);
      return json([]);
    });
    const range = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-10-31T00:00:00Z') };
    const w = invólucro();
    const ev = renderHook(() => hooks.useRoutineEvents(contexto, range, 'mine'), { wrapper: w });
    await waitFor(() => expect(ev.result.current.isSuccess).toBe(true));
    const lista = new URL(chamada(0).url);
    expect(lista.pathname).toBe('/api/rotina/eventos');
    expect(lista.searchParams.get('responsavel')).toBe(USUARIO);
    expect(lista.searchParams.get('inicio')).toBe('2026-10-01T00:00:00.000Z');

    const acoes = renderHook(() => hooks.useRoutineActions(contexto), { wrapper: w });
    await acoes.result.current.create.mutateAsync(rascunhoEvento);
    const criar = fetchMock.mock.calls.map((_, i) => chamada(i)).find((c) => c.method === 'POST');
    expect(criar?.url).toBe(`${BASE}/api/rotina/eventos`);
    expect(criar?.corpo).toEqual({
      title: 'Visita', description: null, activity_type: 'visita', priority: 'medium', assigned_to: USUARIO,
      visibility: 'team', recurrence_rule: null, source: 'lotti', client_id: null, property_id: null,
      start_at: '2026-10-06T13:00:00.000Z', end_at: '2026-10-06T14:00:00.000Z', all_day: false, location: null,
      reminder_minutes: 30,
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Atividade criada.');
  });

  it('com VITE_API_URL, conflito na criação mostra o mesmo aviso de hoje', async () => {
    const hooks = await carregarHooks(true);
    fetchMock.mockResolvedValue(json({ statusCode: 409, codigo: 'CONFLICT', message: 'x', conflicts: [] }, 409));
    const acoes = renderHook(() => hooks.useRoutineActions(contexto), { wrapper: invólucro() });
    await acoes.result.current.create.mutateAsync(rascunhoEvento).catch(() => undefined);
    expect(toast.warning).toHaveBeenCalledWith('Existe outro compromisso nesse horário. Escolha um horário livre.');
  });

  it('com VITE_API_URL, a volta do OAuth sincroniza pela API', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', BASE);
    const { useGoogleCalendarReturn } = await import('@/hooks/routine/useGoogleCalendarReturn');
    fetchMock.mockResolvedValue(json({ synced: true }));
    renderHook(() => useGoogleCalendarReturn(), { wrapper: invólucro() });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(chamada(0).url).toBe(`${BASE}/api/rotina/google/sincronizar`);
    expect(chamada(0).corpo).toEqual({ action: 'sync' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
