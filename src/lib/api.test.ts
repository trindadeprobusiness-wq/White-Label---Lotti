import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O Bearer vem do login próprio (clienteAuth). A sessão do Supabase não pode ser usada:
// o mock abaixo existe só para provar que ninguém a consulta.
const auth = vi.hoisted(() => ({
  obterTokenValido: vi.fn(async (): Promise<string | null> => 'tok'),
  renovarAposRecusa: vi.fn(async (_usado: string): Promise<string | null> => null),
}));
vi.mock('@/lib/api/auth', () => ({ clienteAuth: auth }));
const getSession = vi.hoisted(() => vi.fn(async () => ({ data: { session: { access_token: 'token-do-supabase' } } })));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession } } }));

async function carregar(url?: string) {
  vi.resetModules();
  if (url) vi.stubEnv('VITE_API_URL', url);
  else vi.stubEnv('VITE_API_URL', '');
  return import('./api');
}

describe('API Lotti no front', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    auth.obterTokenValido.mockReset().mockResolvedValue('tok');
    auth.renovarAposRecusa.mockReset().mockResolvedValue(null);
    getSession.mockClear();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('sem VITE_API_URL fica desligada (o front segue com o Supabase)', async () => {
    const api = await carregar();
    expect(api.apiDisponivel()).toBe(false);
    await expect(api.listarAlertasApi()).rejects.toThrow('indisponível');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista e marca alertas com o token no cabeçalho, nunca na URL', async () => {
    const api = await carregar('https://api.exemplo.com/');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'a1' }]), { status: 200 }));
    expect(await api.listarAlertasApi()).toEqual([{ id: 'a1' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.exemplo.com/api/notificacoes?limite=500');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ marcadas: 2 }), { status: 200 }));
    expect(await api.marcarAlertasLidosApi(['x'])).toBe(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.exemplo.com/api/notificacoes/lidas');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ids: ['x'] });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ marcadas: 5 }), { status: 200 }));
    await api.marcarAlertasLidosApi();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({});
  });

  it('lê eventos SSE mesmo quando chegam quebrados em pedaços', async () => {
    const { lerEventosSse } = await carregar('https://api.exemplo.com');
    const a = lerEventosSse('data: {"tipo":"ping"}\n\ndata: {"tipo":"al');
    expect(a.eventos).toEqual(['{"tipo":"ping"}']);
    const b = lerEventosSse(a.resto + 'ertas"}\n\n');
    expect(b).toEqual({ eventos: ['{"tipo":"alertas"}'], resto: '' });
  });

  it('o sino ao vivo chama aoMudar só para eventos de alertas', async () => {
    const api = await carregar('https://api.exemplo.com');
    const corpo = new ReadableStream({
      start(c) {
        const e = new TextEncoder();
        c.enqueue(e.encode('data: {"tipo":"ping"}\n\n'));
        c.enqueue(e.encode('data: {"tipo":"alertas"}\n\ndata: {"tipo":"aler'));
        c.enqueue(e.encode('tas"}\n\n'));
        c.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(corpo, { status: 200 }));
    const aoMudar = vi.fn();
    await api.escutarSino(aoMudar, new AbortController().signal);
    expect(aoMudar).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('text/event-stream');
  });
  it('chamarApi usa o token do login próprio e nunca a sessão do Supabase', async () => {
    const api = await carregar('https://api.exemplo.com');
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    await api.chamarApi('/api/clientes');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('sem sessão nenhuma (nem pelo cookie) lança "Sua sessão expirou" sem chamar a API', async () => {
    const api = await carregar('https://api.exemplo.com');
    auth.obterTokenValido.mockResolvedValue(null);
    await expect(api.chamarApi('/api/clientes')).rejects.toThrow('Sua sessão expirou. Entre de novo.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('401 renova uma vez e repete a chamada com o token novo (mesmo corpo)', async () => {
    const api = await carregar('https://api.exemplo.com');
    auth.renovarAposRecusa.mockResolvedValue('tok-novo');
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const res = await api.chamarApi('/api/perfil/corretor', { method: 'PATCH', body: '{"nome":"Ana"}' });
    expect(res.status).toBe(200);
    expect(auth.renovarAposRecusa).toHaveBeenCalledWith('tok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-novo');
    expect(fetchMock.mock.calls[1][1].body).toBe('{"nome":"Ana"}');
  });

  it('401 sem como renovar devolve o 401 para quem chamou (uma tentativa só)', async () => {
    const api = await carregar('https://api.exemplo.com');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const res = await api.chamarApi('/api/clientes');
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(auth.renovarAposRecusa).toHaveBeenCalledTimes(1);
  });
});
