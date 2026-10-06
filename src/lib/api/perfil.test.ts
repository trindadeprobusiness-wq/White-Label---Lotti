import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// chamarApi tira o Bearer do login próprio (clienteAuth), nunca da sessão do Supabase.
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: async () => 'tok', renovarAposRecusa: async () => null } }));

const BASE = 'https://api.exemplo.com';

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./perfil');
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('API do perfil no front', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const chamada = (i = 0) => {
    const init = fetchMock.mock.calls[i][1] as RequestInit & { headers: Record<string, string> };
    return {
      url: fetchMock.mock.calls[i][0] as string,
      method: init.method ?? 'GET',
      corpo: init.body === undefined ? undefined : JSON.parse(init.body as string),
      headers: init.headers,
    };
  };

  it('obterPerfilApi: GET /api/perfil/corretor com o Bearer', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValue(json({ corretor: { id: 'c1' }, corretor_id: 'c0' }));
    await expect(api.obterPerfilApi()).resolves.toEqual({ corretor: { id: 'c1' }, corretor_id: 'c0' });
    expect(chamada().url).toBe(`${BASE}/api/perfil/corretor`);
    expect(chamada().method).toBe('GET');
    expect(chamada().headers.Authorization).toBe('Bearer tok');
  });

  it('atualizarCorretorApi: PATCH só com as colunas do perfil', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValue(json({ id: 'c1', nome: 'Ana' }));
    await api.atualizarCorretorApi({ nome: 'Ana', foto_url: null, id: 'c1', preferencias: {}, status: 'ativo', website: undefined });
    expect(chamada().url).toBe(`${BASE}/api/perfil/corretor`);
    expect(chamada().method).toBe('PATCH');
    expect(chamada().corpo).toEqual({ nome: 'Ana', foto_url: null });
  });

  it('erro de validação chega com o texto da API', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValue(json({ message: ['Email inválido'] }, 400));
    await expect(api.atualizarCorretorApi({ email: 'x' })).rejects.toThrow('Email inválido');
  });

  it('registrarAtividadeApi: POST /api/perfil/atividade (204)', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.registrarAtividadeApi('login', '/inicio')).resolves.toBeUndefined();
    expect(chamada().url).toBe(`${BASE}/api/perfil/atividade`);
    expect(chamada().method).toBe('POST');
    expect(chamada().corpo).toEqual({ tipo: 'login', rota: '/inicio' });
  });
});
