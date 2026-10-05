import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } },
}));

const BASE = 'https://api.exemplo.com';
const IMOVEL = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', `${BASE}/`);
  return import('./imoveis');
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('API de imóveis no front', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const chamada = (i = 0) => ({
    url: fetchMock.mock.calls[i][0] as string,
    init: fetchMock.mock.calls[i][1] as RequestInit & { headers: Record<string, string> },
  });

  it('lista, obtém e lê os interessados com o token no cabeçalho', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json([{ id: IMOVEL, proprietario_nome: 'Joana' }]));
    expect(await api.listarImoveisApi()).toEqual([{ id: IMOVEL, proprietario_nome: 'Joana' }]);
    expect(chamada(0).url).toBe(`${BASE}/api/imoveis`);
    expect(chamada(0).init.headers.Authorization).toBe('Bearer tok');
    expect(chamada(0).init.method).toBeUndefined();

    fetchMock.mockResolvedValueOnce(json({ id: IMOVEL }));
    await api.obterImovelApi(IMOVEL);
    expect(chamada(1).url).toBe(`${BASE}/api/imoveis/${IMOVEL}`);

    fetchMock.mockResolvedValueOnce(json([{ id: CLIENTE, nome: 'Ana', telefone: '', status_funil: 'QUALIFICACAO' }]));
    expect(await api.listarClientesInteressadosApi(IMOVEL)).toHaveLength(1);
    expect(chamada(2).url).toBe(`${BASE}/api/imoveis/${IMOVEL}/clientes-interessados`);
  });

  it('cria, atualiza, remove e registra a venda com método e corpo exatos', async () => {
    const api = await carregar();
    const dados = { titulo: 'Casa', tipo: 'CASA', valor: 100, endereco: 'Rua A', cidade: 'Anápolis', proprietario_nome: 'A definir', ativo: true };
    fetchMock.mockResolvedValueOnce(json({ id: IMOVEL }, 201));
    expect(await api.criarImovelApi(dados)).toEqual({ id: IMOVEL });
    expect(chamada(0).url).toBe(`${BASE}/api/imoveis`);
    expect(chamada(0).init.method).toBe('POST');
    expect(chamada(0).init.headers['Content-Type']).toBe('application/json');
    expect(chamada(0).init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(chamada(0).init.body as string)).toEqual(dados);

    fetchMock.mockResolvedValueOnce(json({ id: IMOVEL, anunciado: true }));
    await api.atualizarImovelApi(IMOVEL, { anunciado: true });
    expect(chamada(1).url).toBe(`${BASE}/api/imoveis/${IMOVEL}`);
    expect(chamada(1).init.method).toBe('PATCH');
    expect(JSON.parse(chamada(1).init.body as string)).toEqual({ anunciado: true });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.removerImovelApi(IMOVEL)).resolves.toBeUndefined();
    expect(chamada(2).init.method).toBe('DELETE');
    expect(chamada(2).url).toBe(`${BASE}/api/imoveis/${IMOVEL}`);

    fetchMock.mockResolvedValueOnce(json({ imovel_id: IMOVEL, status_venda: 'VENDIDO', cliente_atualizado: false }));
    expect(await api.registrarVendaImovelApi(IMOVEL, CLIENTE)).toEqual({ imovel_id: IMOVEL, status_venda: 'VENDIDO', cliente_atualizado: false });
    expect(chamada(3).url).toBe(`${BASE}/api/imoveis/${IMOVEL}/venda`);
    expect(chamada(3).init.method).toBe('POST');
    expect(JSON.parse(chamada(3).init.body as string)).toEqual({ cliente_id: CLIENTE });

    fetchMock.mockResolvedValueOnce(json({ imovel_id: IMOVEL, status_venda: 'VENDIDO', cliente_atualizado: false }));
    await api.registrarVendaImovelApi(IMOVEL, null);
    expect(JSON.parse(chamada(4).init.body as string)).toEqual({ cliente_id: null });
  });

  it('codifica o id na URL', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ id: 'a/b' }));
    await api.obterImovelApi('a/b?x');
    expect(chamada(0).url).toBe(`${BASE}/api/imoveis/a%2Fb%3Fx`);
  });

  it('erro vira ErroApi: 402 da cota, 409 de contrato e texto padrão no 500', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({
      statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_imoveis',
      message: 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.',
    }, 402));
    await expect(api.criarImovelApi({ titulo: 'x', tipo: 'CASA', valor: 0, endereco: '', cidade: '', proprietario_nome: '' }))
      .rejects.toMatchObject({ name: 'ErroApi', status: 402, message: 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.' });

    fetchMock.mockResolvedValueOnce(json({
      statusCode: 409, codigo: 'imovel_com_contrato', sqlstate: '23503', message: 'Existem contratos vinculados a este imóvel.',
    }, 409));
    await expect(api.removerImovelApi(IMOVEL)).rejects.toMatchObject({ code: '23503', message: 'Existem contratos vinculados a este imóvel.' });

    fetchMock.mockResolvedValueOnce(json({ statusCode: 500, message: 'Internal server error' }, 500));
    await expect(api.listarImoveisApi()).rejects.toMatchObject({ message: 'Não foi possível carregar os imóveis.' });

    fetchMock.mockResolvedValueOnce(json({ statusCode: 500 }, 500));
    await expect(api.registrarVendaImovelApi(IMOVEL, null)).rejects.toMatchObject({ message: 'Não foi possível registrar a venda.' });
  });
});
