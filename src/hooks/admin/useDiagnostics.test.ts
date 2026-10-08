/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dublê do supabase-js: o ramo antigo (sem VITE_API_URL) continua lendo pelo PostgREST.
const from = vi.fn();
const rpc = vi.fn(async (..._a: unknown[]) => ({ data: { items: [], total: 0 }, error: null }));
function encadeada(dados: unknown): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: dados, error: null }).then(ok, erro),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => encadeada(dados)) });
}
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: async () => 'tok', renovarAposRecusa: async () => null } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...a: unknown[]) => { from(...a); return encadeada(a[0] === 'diagnostic_sessions' ? { id: SESSAO } : []); },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
const USUARIO = '99999999-9999-4999-8999-999999999999';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: USUARIO }, isAuthenticated: true, loading: false }) }));

const BASE = 'https://api.exemplo.com';
const SESSAO = '77777777-7777-4777-8777-777777777777';
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
const FILTROS = { search: ' Ana ', status: 'completed', temperature: 'HOT', segment: '', source: 'instagram', page: 3 };

async function ambiente(comApi: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', comApi ? BASE : '');
  const { createElement } = await import('react');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const testing = await import('@testing-library/react');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envolver = ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  const hooks = await import('./useDiagnostics');
  const admin = await import('@/lib/admin/api');
  return { ...testing, envolver, hooks, admin };
}

describe('useDiagnostics / useDiagnosticDetail', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); from.mockClear(); rpc.mockClear(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('com a API, a lista vai para /api/admin/diagnosticos-crescimento com os filtros da RPC', async () => {
    const { envolver, renderHook, waitFor, hooks } = await ambiente(true);
    const lista = { items: [], total: 0, metrics: {}, sources: [], dropoff: [], source_quality: [] };
    fetchMock.mockResolvedValue(json(lista));
    const { result } = renderHook(() => hooks.useDiagnostics(FILTROS), { wrapper: envolver });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(lista);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/admin/diagnosticos-crescimento?busca=Ana&status=completed&temperatura=HOT&origem=instagram&offset=50&limite=25`);
    expect(((fetchMock.mock.calls[0][1] ?? {}) as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('com a API, o detalhe vem numa rota só e no formato da tela', async () => {
    const { envolver, renderHook, waitFor, hooks } = await ambiente(true);
    const detalhe = { session: { id: SESSAO, lead: null }, answers: [], events: [], summary: null, notifications: [] };
    fetchMock.mockResolvedValue(json(detalhe));
    const { result } = renderHook(() => hooks.useDiagnosticDetail(SESSAO), { wrapper: envolver });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(detalhe);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/admin/diagnosticos-crescimento/${SESSAO}`);
    expect(from).not.toHaveBeenCalled();
  });

  it('com a API, 403 vira AcessoNegadoError e o resto a mensagem de sempre', async () => {
    const { envolver, renderHook, waitFor, hooks, admin } = await ambiente(true);
    fetchMock.mockResolvedValueOnce(json({ codigo: 'sem_permissao', message: 'Você não tem permissão para esta ação.' }, 403));
    const negado = renderHook(() => hooks.useDiagnosticDetail(SESSAO), { wrapper: envolver });
    await waitFor(() => expect(negado.result.current.isError).toBe(true));
    expect(negado.result.current.error).toBeInstanceOf(admin.AcessoNegadoError);

    fetchMock.mockResolvedValueOnce(json({ codigo: 'diagnostico_nao_encontrado', message: 'Diagnóstico não encontrado.' }, 404));
    const sumido = renderHook(() => hooks.useDiagnosticDetail('88888888-8888-4888-8888-888888888888'), { wrapper: envolver });
    await waitFor(() => expect(sumido.result.current.isError).toBe(true));
    expect((sumido.result.current.error as Error).message).toBe('Não foi possível carregar este diagnóstico. Confira seu acesso e a instalação do módulo.');
  });

  it('sem VITE_API_URL a lista segue na RPC e o detalhe nas tabelas do Supabase', async () => {
    const { envolver, renderHook, waitFor, hooks } = await ambiente(false);
    const lista = renderHook(() => hooks.useDiagnostics(FILTROS), { wrapper: envolver });
    await waitFor(() => expect(lista.result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('diagnostic_admin_list', {
      _search: 'Ana', _status: 'completed', _temperature: 'HOT', _segment: null, _source: 'instagram', _offset: 50, _limit: 25,
    });
    const detalhe = renderHook(() => hooks.useDiagnosticDetail(SESSAO), { wrapper: envolver });
    await waitFor(() => expect(detalhe.result.current.isSuccess).toBe(true));
    expect(from.mock.calls.map((c) => c[0])).toEqual([
      'diagnostic_sessions', 'diagnostic_answers', 'diagnostic_events', 'diagnostic_summaries', 'diagnostic_notifications',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
