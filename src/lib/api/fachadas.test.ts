/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dublê do supabase-js: o teste prova que as rotas públicas NÃO tocam nele.
const getSession = vi.fn(async () => ({ data: { session: { access_token: 'tok' } } }));
const from = vi.fn();
const rpc = vi.fn();
// chamarApi tira o Bearer do login próprio (clienteAuth), nunca da sessão do Supabase.
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: async () => 'tok', renovarAposRecusa: async () => null } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession }, from, rpc },
}));

const BASE = 'https://api.exemplo.com';
const FACHADA = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';
const TEMPLATE = '33333333-3333-4333-8333-333333333333';
const IMOVEL = '44444444-4444-4444-8444-444444444444';

const json = (corpo: unknown, status = 200) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const vazio = () => new Response(null, { status: 204 });

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  getSession.mockClear(); from.mockClear(); rpc.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const chamada = (i = 0) => {
  const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit & { headers?: Record<string, string> };
  return {
    url: fetchMock.mock.calls[i][0] as string,
    method: init.method ?? 'GET',
    corpo: init.body === undefined || init.body === null ? undefined : JSON.parse(init.body as string),
    headers: (init.headers ?? {}) as Record<string, string>,
  };
};

async function carregarCliente() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./fachadas');
}

describe('cliente da API de fachadas — rotas autenticadas', () => {
  it('F1 lista as fachadas', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json([{ id: FACHADA }]));
    await expect(api.listarFachadasApi()).resolves.toEqual([{ id: FACHADA }]);
    expect(chamada().url).toBe(`${BASE}/api/fachadas`);
    expect(chamada().method).toBe('GET');
    expect(chamada().headers.Authorization).toBe('Bearer tok');
  });

  it('F2 cria mandando só as chaves aceitas', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json({ id: FACHADA }));
    const r = await api.criarFachadaApi({
      imovel_id: IMOVEL, tipo_negocio: 'VENDA', template_id: 'venda-classica',
      cta_principal: 'WHATSAPP', modo_conversao: false, mensagem_whatsapp: undefined,
      id: 'nao-vai', corretor_id: 'nao-vai', total_leads: 9, created_at: 'x',
    });
    expect(r).toEqual({ id: FACHADA });
    expect(chamada().url).toBe(`${BASE}/api/fachadas`);
    expect(chamada().method).toBe('POST');
    expect(chamada().headers['Content-Type']).toBe('application/json');
    expect(chamada().corpo).toEqual({
      imovel_id: IMOVEL, tipo_negocio: 'VENDA', template_id: 'venda-classica',
      cta_principal: 'WHATSAPP', modo_conversao: false,
    });
  });

  it('F3 edita com escolher(CHAVES_EDITAR_FACHADA): nada de imovel_id, id nem contadores', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json({ id: FACHADA }));
    const linhaInteira = {
      id: FACHADA, corretor_id: 'c1', imovel_id: IMOVEL, tipo_negocio: 'ALUGUEL',
      template_id: 'x', cta_principal: 'AGENDAR_VISITA', modo_conversao: true,
      mensagem_whatsapp: 'oi', mensagem_contato: 'oi 2', logo_url: null,
      foto_principal_url: null, ativo: true, total_escaneamentos: 7, total_leads: 3,
      created_at: '2026-10-05T00:00:00+00:00',
    };
    await api.editarFachadaApi(FACHADA, linhaInteira);
    expect(chamada().url).toBe(`${BASE}/api/fachadas/${FACHADA}`);
    expect(chamada().method).toBe('PATCH');
    expect(Object.keys(chamada().corpo as object).sort()).toEqual([...api.CHAVES_EDITAR_FACHADA].sort());
    expect(chamada().corpo).not.toHaveProperty('imovel_id');
    expect(chamada().corpo).not.toHaveProperty('id');
    expect(chamada().corpo).not.toHaveProperty('corretor_id');
    expect(chamada().corpo).not.toHaveProperty('total_leads');
    expect(chamada().corpo).not.toHaveProperty('created_at');
  });

  it('F4 exclui e aceita 204 sem corpo', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(vazio());
    await expect(api.excluirFachadaApi(FACHADA)).resolves.toBeUndefined();
    expect(chamada().url).toBe(`${BASE}/api/fachadas/${FACHADA}`);
    expect(chamada().method).toBe('DELETE');
  });

  it('F5 lista leads com e sem fachada_id', async () => {
    const api = await carregarCliente();
    fetchMock.mockImplementation(async () => json([]));
    await api.listarLeadsApi(FACHADA);
    expect(chamada(0).url).toBe(`${BASE}/api/fachadas/leads?fachada_id=${FACHADA}`);
    await api.listarLeadsApi();
    expect(chamada(1).url).toBe(`${BASE}/api/fachadas/leads`);
    // Leads pendentes do CRM: o mesmo F5 filtrado por convertido=false.
    await api.listarLeadsPendentesApi();
    expect(chamada(2).url).toBe(`${BASE}/api/fachadas/leads?convertido=false`);
  });

  it('F6 exclui o lead', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(vazio());
    await api.excluirLeadApi(LEAD);
    expect(chamada().url).toBe(`${BASE}/api/fachadas/leads/${LEAD}`);
    expect(chamada().method).toBe('DELETE');
  });

  it('F7 pede as métricas com dias na query', async () => {
    const api = await carregarCliente();
    const metricas = {
      totalFachadas: 3, totalEscaneamentos: 42, totalLeads: 7, taxaConversao: 17,
      fachadasMaisAcessadas: [], leadsPorDia: [{ data: '2026-09-20', leads: 1, escaneamentos: 5 }],
    };
    fetchMock.mockResolvedValue(json(metricas));
    await expect(api.obterMetricasApi(90)).resolves.toEqual(metricas);
    expect(chamada().url).toBe(`${BASE}/api/fachadas/metricas?dias=90`);
  });

  it('F8 lista templates por escopo', async () => {
    const api = await carregarCliente();
    fetchMock.mockImplementation(async () => json([]));
    await api.listarTemplatesApi('meus');
    expect(chamada(0).url).toBe(`${BASE}/api/fachadas/templates?escopo=meus`);
    await api.listarTemplatesApi();
    expect(chamada(1).url).toBe(`${BASE}/api/fachadas/templates`);
  });

  it('F9 cria template só com nome, categoria, config e padrao', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json({ id: TEMPLATE, created_at: '2026-10-05T00:00:00+00:00' }));
    await api.criarTemplateApi({
      nome: 'Arte', categoria: 'VENDA', padrao: false,
      config: { imagem_url: 'https://x/y.png' }, corretor_id: 'nao-vai',
    });
    expect(chamada().url).toBe(`${BASE}/api/fachadas/templates`);
    expect(chamada().corpo).toEqual({
      nome: 'Arte', categoria: 'VENDA', padrao: false, config: { imagem_url: 'https://x/y.png' },
    });
  });

  it('F10 exclui o template', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(vazio());
    await api.excluirTemplateApi(TEMPLATE);
    expect(chamada().url).toBe(`${BASE}/api/fachadas/templates/${TEMPLATE}`);
    expect(chamada().method).toBe('DELETE');
  });

  it('F11 passa imagem_url por URLSearchParams e devolve null sem lançar', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json(null));
    await expect(api.obterTemplatePorImagemApi('https://x/arte 1.png?a=b')).resolves.toBeNull();
    expect(chamada().url).toBe(
      `${BASE}/api/fachadas/templates/por-imagem?imagem_url=${encodeURIComponent('https://x/arte 1.png?a=b').replace(/%20/g, '+')}`,
    );
  });

  it('F12 pede as mídias do imóvel', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json({ foto_principal_url: 'https://x/f.jpg', fotos: 8, videos: 2 }));
    await expect(api.obterMidiasImovelApi(IMOVEL)).resolves.toEqual({
      foto_principal_url: 'https://x/f.jpg', fotos: 8, videos: 2,
    });
    expect(chamada().url).toBe(`${BASE}/api/fachadas/midias/${IMOVEL}`);
  });

  it('o id entra por encodeURIComponent', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(vazio());
    await api.excluirFachadaApi('a/b c#d');
    expect(chamada().url).toBe(`${BASE}/api/fachadas/a%2Fb%20c%23d`);
  });
});

describe('cliente da API de fachadas — rotas públicas', () => {
  it('P1 busca a fachada pública sem Authorization e sem tocar o Supabase', async () => {
    const api = await carregarCliente();
    const resposta = { fachada: { id: FACHADA }, fotos: [{ id: 'f1', arquivo_url: 'u', principal: true }] };
    fetchMock.mockResolvedValue(json(resposta));
    await expect(api.obterFachadaPublicaApi(FACHADA)).resolves.toEqual(resposta);
    expect(chamada().url).toBe(`${BASE}/api/publico/fachadas/${FACHADA}`);
    expect(chamada().headers.Authorization).toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('P2 manda POST sem corpo e sem Authorization', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(vazio());
    await expect(api.registrarEscaneamentoApi(FACHADA)).resolves.toBeUndefined();
    expect(chamada().url).toBe(`${BASE}/api/publico/fachadas/${FACHADA}/escaneamentos`);
    expect(chamada().method).toBe('POST');
    expect(chamada().corpo).toBeUndefined();
    expect(chamada().headers.Authorization).toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('P3 manda o lead sem Authorization; email vazio não é enviado', async () => {
    const api = await carregarCliente();
    fetchMock.mockImplementation(async () => json({ registrado: true }));
    await expect(
      api.enviarLeadPublicoApi(FACHADA, { nome: 'Ana', telefone: '(11) 99999-8888' }),
    ).resolves.toEqual({ registrado: true });
    expect(chamada().url).toBe(`${BASE}/api/publico/fachadas/${FACHADA}/leads`);
    expect(chamada().method).toBe('POST');
    expect(chamada().corpo).toEqual({ nome: 'Ana', telefone: '(11) 99999-8888' });
    expect(chamada().corpo).not.toHaveProperty('email');
    expect(chamada().headers.Authorization).toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();

    await api.enviarLeadPublicoApi(FACHADA, { nome: 'Ana', telefone: '11999998888', email: 'a@b.com' });
    expect(chamada(1).corpo).toEqual({ nome: 'Ana', telefone: '11999998888', email: 'a@b.com' });
  });

  it('sem VITE_API_URL as públicas lançam e nenhum fetch acontece', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '');
    const api = await import('./fachadas');
    await expect(api.obterFachadaPublicaApi(FACHADA)).rejects.toThrow('API Lotti indisponível no momento.');
    await expect(api.registrarEscaneamentoApi(FACHADA)).rejects.toThrow('API Lotti indisponível no momento.');
    await expect(api.enviarLeadPublicoApi(FACHADA, { nome: 'A', telefone: '1' }))
      .rejects.toThrow('API Lotti indisponível no momento.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('erros da API de fachadas', () => {
  it('404 vira ErroApi com codigo e message da API', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json({ codigo: 'nao_encontrado', message: 'Fachada não encontrada.' }, 404));
    await expect(api.editarFachadaApi(FACHADA, { ativo: true })).rejects.toMatchObject({
      name: 'ErroApi', status: 404, codigo: 'nao_encontrado', message: 'Fachada não encontrada.',
    });
  });

  it('402 PLAN_LIMIT_REACHED chega legível', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json({
      codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_fachadas',
      message: 'Limite de Fachadas Inteligentes atingido. Acesse Plano e Assinatura para liberar mais fachadas.',
    }, 402));
    await expect(api.criarFachadaApi({ imovel_id: IMOVEL })).rejects.toMatchObject({
      status: 402, codigo: 'PLAN_LIMIT_REACHED',
      message: 'Limite de Fachadas Inteligentes atingido. Acesse Plano e Assinatura para liberar mais fachadas.',
    });
  });

  it('429 muitas_tentativas chega legível na rota pública', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json({
      codigo: 'muitas_tentativas', message: 'Muitas tentativas. Aguarde alguns minutos.',
    }, 429));
    await expect(api.enviarLeadPublicoApi(FACHADA, { nome: 'Ana', telefone: '11999998888' }))
      .rejects.toMatchObject({ status: 429, codigo: 'muitas_tentativas', message: 'Muitas tentativas. Aguarde alguns minutos.' });
  });

  it('500 cai no texto padrão da função', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(json({ message: 'Internal server error' }, 500));
    await expect(api.obterFachadaPublicaApi(FACHADA)).rejects.toMatchObject({
      status: 500, message: 'Não foi possível carregar os dados. Tente novamente.',
    });
  });
});
