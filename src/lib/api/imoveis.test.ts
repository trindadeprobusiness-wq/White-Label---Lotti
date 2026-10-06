import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// chamarApi tira o Bearer do login próprio (clienteAuth), nunca da sessão do Supabase.
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: async () => 'tok', renovarAposRecusa: async () => null } }));
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

  it('fotos (bloco B1): rotas, métodos e corpos exatos', async () => {
    const api = await carregar();
    const FOTO = '33333333-3333-4333-8333-333333333333';
    fetchMock.mockResolvedValueOnce(json([{ id: FOTO }]));
    expect(await api.listarFotosImovelApi(IMOVEL)).toEqual([{ id: FOTO }]);
    expect(chamada(0).url).toBe(`${BASE}/api/imoveis/${IMOVEL}/fotos`);
    expect(chamada(0).init.method).toBeUndefined();

    const nova = { arquivo_url: 'https://api/foto/x.jpg', arquivo_path: `${IMOVEL}/1_x.jpg`, principal: false };
    fetchMock.mockResolvedValueOnce(json({ id: FOTO }, 201));
    await api.criarFotoImovelApi(IMOVEL, nova);
    expect([chamada(1).url, chamada(1).init.method]).toEqual([`${BASE}/api/imoveis/${IMOVEL}/fotos`, 'POST']);
    expect(JSON.parse(chamada(1).init.body as string)).toEqual(nova);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.removerFotoImovelApi(FOTO)).resolves.toBeUndefined();
    expect([chamada(2).url, chamada(2).init.method]).toEqual([`${BASE}/api/imoveis/fotos/${FOTO}`, 'DELETE']);

    fetchMock.mockResolvedValueOnce(json({ atualizadas: 1 }));
    await api.reordenarFotosImovelApi(IMOVEL, [FOTO]);
    expect([chamada(3).url, chamada(3).init.method]).toEqual([`${BASE}/api/imoveis/${IMOVEL}/fotos/ordem`, 'PATCH']);
    expect(JSON.parse(chamada(3).init.body as string)).toEqual({ ids: [FOTO] });

    fetchMock.mockResolvedValueOnce(json({ imovel_id: IMOVEL, foto_id: FOTO }));
    await api.definirFotoPrincipalApi(IMOVEL, FOTO);
    expect([chamada(4).url, chamada(4).init.method]).toEqual([`${BASE}/api/imoveis/${IMOVEL}/fotos/${FOTO}/principal`, 'PATCH']);

    fetchMock.mockResolvedValueOnce(json({ enfileirado: true, id: FOTO }));
    await api.registrarEventoVendaApi(IMOVEL, { valor: 500000, cliente_id: null });
    expect([chamada(5).url, chamada(5).init.method]).toEqual([`${BASE}/api/imoveis/${IMOVEL}/venda/evento`, 'POST']);
    expect(JSON.parse(chamada(5).init.body as string)).toEqual({ valor: 500000, cliente_id: null });
  });

  it('miniaturas: POST /fotos/resumo em lotes de 1000 imóveis, juntando as respostas', async () => {
    const api = await carregar();
    const ids = Array.from({ length: 1001 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    fetchMock
      .mockResolvedValueOnce(json([{ imovel_id: ids[0], arquivo_url: 'a', principal: true }]))
      .mockResolvedValueOnce(json([{ imovel_id: ids[1000], arquivo_url: 'b', principal: false }]));
    expect(await api.resumoFotosImoveisApi(ids)).toEqual([
      { imovel_id: ids[0], arquivo_url: 'a', principal: true },
      { imovel_id: ids[1000], arquivo_url: 'b', principal: false },
    ]);
    expect(chamada(0).url).toBe(`${BASE}/api/imoveis/fotos/resumo`);
    expect(JSON.parse(chamada(0).init.body as string).imovel_ids).toHaveLength(1000);
    expect(JSON.parse(chamada(1).init.body as string)).toEqual({ imovel_ids: [ids[1000]] });
  });

  it('webhook de captura de lead: rota pública da API (bloco B4), sem a barra final da base e sem fetch', async () => {
    const api = await carregar();
    expect(api.urlCapturaLeadApi(IMOVEL)).toBe(`${BASE}/api/publico/leads?imovel_id=${IMOVEL}`);
    expect(api.urlCapturaLeadApi('a&b')).toBe(`${BASE}/api/publico/leads?imovel_id=a%26b`);
    expect(fetchMock).not.toHaveBeenCalled();
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
