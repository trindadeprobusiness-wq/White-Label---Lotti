/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Com VITE_API_URL o Bearer é o do login próprio (clienteAuth); sem ela, a sessão do Supabase.
const getSession = vi.fn(async () => ({ data: { session: { access_token: 'token-supabase' } } }));
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: async () => 'token-proprio', renovarAposRecusa: async () => null } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: () => getSession() } } }));

const API = 'https://api.exemplo.com';
const SUPABASE = 'https://projeto.supabase.co';
const SESSAO = '77777777-7777-4777-8777-777777777777';
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

async function carregar(comApi: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', comApi ? API : '');
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'chave-publica');
  return import('./admin-api');
}

describe('diagnosticAdminRequest', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); getSession.mockClear(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const chamada = (i = 0) => {
    const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit & { headers: Record<string, string> };
    return { url: fetchMock.mock.calls[i][0] as string, method: init.method, headers: init.headers, corpo: JSON.parse(String(init.body)) };
  };

  it('com a API: POST na rota do admin, mesmo corpo da Edge, token do login próprio e sem apikey', async () => {
    const { diagnosticAdminRequest } = await carregar(true);
    const lista = { items: [], total: 0 };
    fetchMock.mockResolvedValueOnce(json(lista));
    const filtros = { search: 'Ana', status: '', temperature: 'HOT', segment: '', source: '', page: 2 };
    await expect(diagnosticAdminRequest({ action: 'list', filters: filtros })).resolves.toEqual(lista);
    const c = chamada();
    expect(c.url).toBe(`${API}/api/admin/diagnosticos-crescimento`);
    expect(c.method).toBe('POST');
    expect(c.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer token-proprio' });
    expect(c.corpo).toEqual({ action: 'list', filters: filtros });
    expect(getSession).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json({ id: 'lead', follow_up_status: 'contacted' }));
    await diagnosticAdminRequest({ action: 'follow_up', session_id: SESSAO, status: 'contacted', notes: 'liguei' });
    expect(chamada(1).corpo).toEqual({ action: 'follow_up', session_id: SESSAO, status: 'contacted', notes: 'liguei' });
  });

  it('com a API: o erro da rota ({ error }) chega na tela; 401 sem corpo pede login', async () => {
    const { diagnosticAdminRequest } = await carregar(true);
    fetchMock.mockResolvedValueOnce(json({ error: 'Acesso administrativo necessário.' }, 403));
    await expect(diagnosticAdminRequest({ action: 'list' })).rejects.toThrow('Acesso administrativo necessário.');
    fetchMock.mockResolvedValueOnce(json({ error: 'Diagnóstico não encontrado.' }, 404));
    await expect(diagnosticAdminRequest({ action: 'detail', session_id: SESSAO })).rejects.toThrow('Diagnóstico não encontrado.');
    fetchMock.mockResolvedValueOnce(json({ statusCode: 401, message: 'Unauthorized' }, 401));
    await expect(diagnosticAdminRequest({ action: 'list' })).rejects.toThrow('Entre novamente na Lotti.');
    fetchMock.mockResolvedValueOnce(new Response('falhou', { status: 502 }));
    await expect(diagnosticAdminRequest({ action: 'list' })).rejects.toThrow('Não foi possível acessar os diagnósticos. Tente novamente.');
  });

  it('sem VITE_API_URL segue na Edge diagnostic-admin com a sessão do Supabase', async () => {
    const { diagnosticAdminRequest } = await carregar(false);
    fetchMock.mockResolvedValueOnce(json({ session: { id: SESSAO } }));
    await diagnosticAdminRequest({ action: 'detail', session_id: SESSAO });
    const c = chamada();
    expect(c.url).toBe(`${SUPABASE}/functions/v1/diagnostic-admin`);
    expect(c.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer token-supabase', apikey: 'chave-publica' });
    expect(c.corpo).toEqual({ action: 'detail', session_id: SESSAO });
  });
});
