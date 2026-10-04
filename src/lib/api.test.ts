import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } },
}));

async function carregar(url?: string) {
  vi.resetModules();
  if (url) vi.stubEnv('VITE_API_URL', url);
  else vi.stubEnv('VITE_API_URL', '');
  return import('./api');
}

describe('API Lotti no front', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
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
});
