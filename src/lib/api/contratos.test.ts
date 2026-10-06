import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// chamarApi tira o Bearer do login próprio (clienteAuth), nunca da sessão do Supabase.
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: async () => 'tok', renovarAposRecusa: async () => null } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } },
}));

const BASE = 'https://api.exemplo.com';
const ID = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const IMOVEL = '33333333-3333-4333-8333-333333333333';
const ESTRANHO = 'a/b?c';

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', `${BASE}/`);
  return import('./contratos');
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('API de contratos no front', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const chamada = (i = 0) => ({
    url: fetchMock.mock.calls[i][0] as string,
    init: fetchMock.mock.calls[i][1] as RequestInit & { headers: Record<string, string> },
    corpo: () => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string),
  });

  it('listagens usam GET nos caminhos do contrato', async () => {
    const api = await carregar();
    fetchMock.mockImplementation(async () => json([{ id: ID }]));
    expect(await api.listarContratosApi()).toEqual([{ id: ID }]);
    await api.listarContratosCentralApi();
    await api.listarContratosLocacaoApi();
    await api.listarContratosLocacaoApi('LOCACAO COMERCIAL');
    await api.listarDocumentosApi();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/api/contratos`,
      `${BASE}/api/contratos/central`,
      `${BASE}/api/contratos/locacao?tipo=LOCACAO_RESIDENCIAL`,
      `${BASE}/api/contratos/locacao?tipo=LOCACAO%20COMERCIAL`,
      `${BASE}/api/documentos`,
    ]);
    expect(chamada(0).init.method).toBeUndefined();
    expect(chamada(0).init.headers.Authorization).toBe('Bearer tok');
  });

  it('contratos dos clientes: vazio não chama a rede; senão POST com cliente_ids', async () => {
    const api = await carregar();
    expect(await api.listarContratosDosClientesApi([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json([]));
    await api.listarContratosDosClientesApi([CLIENTE]);
    expect(chamada(0).url).toBe(`${BASE}/api/contratos/por-clientes`);
    expect(chamada(0).init.method).toBe('POST');
    expect(chamada(0).corpo()).toEqual({ cliente_ids: [CLIENTE] });
  });

  it('criarContratoApi descarta corretor_id, versao, modelo_ia e tempo_geracao_ms', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ id: ID }, 201));
    const r = await api.criarContratoApi({
      tipo: 'COMPRA_VENDA', valor: 10, data_inicio: '2026-01-01', conteudo: 'x', status: 'RASCUNHO',
      corretor_id: 'c', versao: 1, modelo_ia: 'm', tempo_geracao_ms: 5, cliente_id: undefined,
    });
    expect(r).toEqual({ id: ID });
    expect(chamada(0).url).toBe(`${BASE}/api/contratos`);
    expect(chamada(0).init.method).toBe('POST');
    expect(chamada(0).corpo()).toEqual({ tipo: 'COMPRA_VENDA', valor: 10, data_inicio: '2026-01-01', conteudo: 'x', status: 'RASCUNHO' });
  });

  it('criarLocacaoApi manda só CHAVES_LOCACAO e a primeira_fatura', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ contrato: { id: ID }, fatura: { id: 'f' } }, 201));
    const primeira = { data_vencimento: '2026-11-10', mes_referencia: '11/2026' };
    const r = await api.criarLocacaoApi({
      tipo: 'LOCACAO_RESIDENCIAL', cliente_id: CLIENTE, imovel_id: IMOVEL, valor: 1500, data_inicio: '2026-10-01',
      dia_vencimento: 10, conteudo: '{}', status: 'ATIVO', corretor_id: 'c', arquivo_url: null,
    }, primeira);
    expect(r.contrato).toEqual({ id: ID });
    expect(chamada(0).url).toBe(`${BASE}/api/contratos/locacao`);
    expect(chamada(0).corpo()).toEqual({
      tipo: 'LOCACAO_RESIDENCIAL', cliente_id: CLIENTE, imovel_id: IMOVEL, valor: 1500, data_inicio: '2026-10-01',
      dia_vencimento: 10, conteudo: '{}', arquivo_url: null, primeira_fatura: primeira,
    });
  });

  it('editar, alterar e remover usam o id codificado', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ contrato: { id: ID }, faturas_emitidas: ['f1'] }));
    expect((await api.editarLocacaoApi(ESTRANHO, { valor: 1, status: 'ATIVO' })).faturas_emitidas).toEqual(['f1']);
    expect(chamada(0).url).toBe(`${BASE}/api/contratos/a%2Fb%3Fc/locacao`);
    expect(chamada(0).init.method).toBe('PATCH');
    expect(chamada(0).corpo()).toEqual({ valor: 1 });

    fetchMock.mockResolvedValueOnce(json({ id: ID }));
    await api.alterarContratoApi(ID, { status: 'ENCERRADO', tipo: 'X' });
    expect(chamada(1).url).toBe(`${BASE}/api/contratos/${ID}`);
    expect(chamada(1).init.method).toBe('PATCH');
    expect(chamada(1).corpo()).toEqual({ status: 'ENCERRADO' });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await api.removerContratoApi(ESTRANHO)).toBeUndefined();
    expect(chamada(2).url).toBe(`${BASE}/api/contratos/a%2Fb%3Fc`);
    expect(chamada(2).init.method).toBe('DELETE');
  });

  it('documentos: criar, alterar (sem updated_at) e remover', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ id: ID }, 201));
    await api.criarDocumentoApi({ nome: 'RG', tipo: 'RG', arquivo_path: 'c/x.pdf', corretor_id: 'c', validado: false });
    expect(chamada(0).url).toBe(`${BASE}/api/documentos`);
    expect(chamada(0).corpo()).toEqual({ nome: 'RG', tipo: 'RG', arquivo_path: 'c/x.pdf' });

    fetchMock.mockResolvedValueOnce(json({ id: ID }));
    await api.alterarDocumentoApi(ESTRANHO, { validado: true, updated_at: 'agora' });
    expect(chamada(1).url).toBe(`${BASE}/api/documentos/a%2Fb%3Fc`);
    expect(chamada(1).init.method).toBe('PATCH');
    expect(chamada(1).corpo()).toEqual({ validado: true });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.removerDocumentoApi(ID);
    expect(chamada(2).url).toBe(`${BASE}/api/documentos/${ID}`);
    expect(chamada(2).init.method).toBe('DELETE');
  });

  it('opções de imóveis e clientes: só as colunas pedidas, filtro de ativos e ordem pt-BR', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json([
      { id: '1', titulo: 'Zé', endereco: 'R1', ativo: true, valor: 1 },
      { id: '2', titulo: 'Ágata', endereco: 'R2', ativo: true },
      { id: '3', titulo: 'Bela', endereco: 'R3', ativo: false },
    ]));
    expect(await api.opcoesImoveisApi(['id', 'titulo'], true)).toEqual([{ id: '2', titulo: 'Ágata' }, { id: '1', titulo: 'Zé' }]);
    expect(chamada(0).url).toBe(`${BASE}/api/imoveis`);

    fetchMock.mockResolvedValueOnce(json([{ id: 'a', nome: 'Érica', cpf: null }, { id: 'b', nome: 'Davi', cpf: '1' }]));
    expect(await api.opcoesClientesApi(['id', 'nome', 'cpf'])).toEqual([{ id: 'b', nome: 'Davi', cpf: '1' }, { id: 'a', nome: 'Érica', cpf: null }]);
    expect(chamada(1).url).toBe(`${BASE}/api/clientes`);
  });

  it('IA: gerar devolve o corpo e analisar devolve só dados', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ contrato: 'texto', modelo_ia: 'g', prompt_version: 'v', tempo_geracao_ms: 3 }));
    expect((await api.gerarContratoIaApi({ tipo: 'COMPRA_VENDA' })).contrato).toBe('texto');
    expect(chamada(0).url).toBe(`${BASE}/api/contratos/ia/gerar`);
    expect(chamada(0).corpo()).toEqual({ tipo: 'COMPRA_VENDA' });

    fetchMock.mockResolvedValueOnce(json({ dados: { valor: 1 } }));
    expect(await api.analisarContratoIaApi({ fileBase64: 'AA', mimeType: 'application/pdf', modo: 'central' })).toEqual({ valor: 1 });
    expect(chamada(1).url).toBe(`${BASE}/api/contratos/ia/analisar`);
    expect(chamada(1).corpo()).toEqual({ fileBase64: 'AA', mimeType: 'application/pdf', modo: 'central' });
  });

  it('402 vira ErroApi com a mensagem da API; 500 vira o texto padrão', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ statusCode: 402, codigo: 'PLAN_LIMIT_REACHED', message: 'Limite de contratos de locação atingido.', recurso: 'max_contratos_locacao' }, 402));
    await expect(api.criarLocacaoApi({}, { data_vencimento: '2026-01-01', mes_referencia: '01/2026' }))
      .rejects.toMatchObject({ name: 'ErroApi', status: 402, codigo: 'PLAN_LIMIT_REACHED', message: 'Limite de contratos de locação atingido.' });

    fetchMock.mockResolvedValueOnce(json({ statusCode: 500, message: 'Internal server error' }, 500));
    await expect(api.criarContratoApi({})).rejects.toMatchObject({ status: 500, message: 'Erro ao salvar contrato.' });

    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(api.analisarContratoIaApi({ fileBase64: 'A', mimeType: 'image/png' })).rejects.toMatchObject({ message: 'Erro interno ao analisar contrato' });
  });
});

describe('apoio das telas', () => {
  it('primeiraFaturaLocacao formata a data local sem passar por UTC', async () => {
    const api = await carregar();
    // Date local à meia-noite: o formato local nunca desloca o dia, qualquer que seja o fuso.
    expect(api.primeiraFaturaLocacao(new Date(2026, 9, 31))).toEqual({ data_vencimento: '2026-10-31', mes_referencia: '10/2026' });
    expect(api.primeiraFaturaLocacao(new Date(2027, 0, 1))).toEqual({ data_vencimento: '2027-01-01', mes_referencia: '01/2027' });
  });

  it('somenteData corta a hora e preserva o resto', async () => {
    const api = await carregar();
    expect(api.somenteData('2026-10-05T23:10:00.000Z')).toBe('2026-10-05');
    expect(api.somenteData('2026-10-05')).toBe('2026-10-05');
    expect(api.somenteData(null)).toBeNull();
  });
});
