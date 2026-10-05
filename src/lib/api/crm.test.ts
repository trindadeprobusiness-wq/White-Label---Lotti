import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } },
}));

const BASE = 'https://api.exemplo.com';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const IMOVEL = '22222222-2222-4222-8222-222222222222';
const ETAPA = '33333333-3333-4333-8333-333333333333';
const NEGOCIO = '44444444-4444-4444-8444-444444444444';
const LEAD = '55555555-5555-4555-8555-555555555555';
const TAREFA = '66666666-6666-4666-8666-666666666666';

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./crm');
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('API do CRM no front', () => {
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

  it('clientes: caminho, método e corpo de cada rota, com o token no cabeçalho', async () => {
    const api = await carregar();
    const casos: Array<{ chamar: () => Promise<unknown>; url: string; method: string; corpo?: unknown; status?: number; resposta?: unknown }> = [
      { chamar: () => api.listarClientesApi(), url: '/api/clientes', method: 'GET', resposta: [] },
      { chamar: () => api.obterClienteApi(CLIENTE), url: `/api/clientes/${CLIENTE}`, method: 'GET', resposta: { id: CLIENTE } },
      { chamar: () => api.criarClienteApi({ nome: 'Ana', telefone: '' }), url: '/api/clientes', method: 'POST', corpo: { nome: 'Ana', telefone: '' }, resposta: { status: 'created', cliente_id: CLIENTE } },
      { chamar: () => api.atualizarClienteApi(CLIENTE, { nome: 'Ana' }), url: `/api/clientes/${CLIENTE}`, method: 'PATCH', corpo: { nome: 'Ana' }, resposta: { id: CLIENTE } },
      { chamar: () => api.moverClienteNoFunilApi(CLIENTE, 'DOCUMENTACAO'), url: `/api/clientes/${CLIENTE}/status`, method: 'PATCH', corpo: { status_funil: 'DOCUMENTACAO' }, resposta: { id: CLIENTE } },
      { chamar: () => api.removerClienteApi(CLIENTE), url: `/api/clientes/${CLIENTE}`, method: 'DELETE', status: 204 },
      { chamar: () => api.definirImovelDeInteresseApi(CLIENTE, IMOVEL), url: `/api/clientes/${CLIENTE}/imovel-interesse`, method: 'PUT', corpo: { imovel_id: IMOVEL }, resposta: { cliente_id: CLIENTE, imovel_id: IMOVEL } },
      { chamar: () => api.definirImovelDeInteresseApi(CLIENTE, null), url: `/api/clientes/${CLIENTE}/imovel-interesse`, method: 'PUT', corpo: { imovel_id: null }, resposta: { cliente_id: CLIENTE, imovel_id: null } },
      { chamar: () => api.completarCpfApi(CLIENTE, '12345678909'), url: `/api/clientes/${CLIENTE}/completar-cpf`, method: 'POST', corpo: { cpf: '12345678909' }, resposta: { atualizado: true } },
      { chamar: () => api.listarHistoricoApi(CLIENTE), url: `/api/clientes/${CLIENTE}/historico`, method: 'GET', resposta: [] },
      {
        chamar: () => api.registrarHistoricoApi(CLIENTE, { tipo: 'WHATSAPP', direcao: 'OUT', conteudo: 'Oi', metadata: { via: 'wa.me' } }),
        url: `/api/clientes/${CLIENTE}/historico`, method: 'POST', corpo: { tipo: 'WHATSAPP', direcao: 'OUT', conteudo: 'Oi', metadata: { via: 'wa.me' } }, status: 201, resposta: { id: 'h' },
      },
      {
        chamar: () => api.converterLeadApi({ lead_id: LEAD, etapa_id: ETAPA, nome: 'Maria', telefone: '(62) 91111-0002', email: null, cliente_id: null }),
        url: '/api/clientes/converter-lead', method: 'POST',
        corpo: { lead_id: LEAD, etapa_id: ETAPA, nome: 'Maria', telefone: '(62) 91111-0002', email: null, cliente_id: null },
        resposta: { status: 'converted', cliente_id: CLIENTE, created: true, oportunidade_id: NEGOCIO },
      },
    ];
    for (const [i, caso] of casos.entries()) {
      fetchMock.mockResolvedValueOnce(caso.status === 204 ? new Response(null, { status: 204 }) : json(caso.resposta ?? {}, caso.status ?? 200));
      await caso.chamar();
      const c = chamada(i);
      expect(c.url, caso.url).toBe(`${BASE}${caso.url}`);
      expect(c.method, caso.url).toBe(caso.method);
      expect(c.corpo, caso.url).toEqual(caso.corpo);
      expect(c.headers.Authorization).toBe('Bearer tok');
    }
  });

  it('funil: etapas, negócios e tarefas com caminho, método e corpo exatos', async () => {
    const api = await carregar();
    const etapas = [{ id: ETAPA, nome: 'Novo', cor: 'blue', tipo: 'ABERTA', ordem: 1 }];
    const casos: Array<{ chamar: () => Promise<unknown>; url: string; method: string; corpo?: unknown; resposta?: unknown }> = [
      { chamar: () => api.listarEtapasApi(), url: '/api/crm/etapas', method: 'GET', resposta: [] },
      { chamar: () => api.salvarEtapasApi(etapas), url: '/api/crm/etapas', method: 'PATCH', corpo: { etapas }, resposta: { atualizadas: 1 } },
      { chamar: () => api.listarOportunidadesApi(), url: '/api/crm/oportunidades', method: 'GET', resposta: [] },
      {
        chamar: () => api.moverOportunidadeApi({ id: NEGOCIO, etapaId: ETAPA, ordem: 3, updatedAt: '2026-10-04T12:34:56.123456+00:00' }),
        url: `/api/crm/oportunidades/${NEGOCIO}/mover`, method: 'PATCH',
        corpo: { etapa_id: ETAPA, ordem: 3, updated_at: '2026-10-04T12:34:56.123456+00:00' }, resposta: { id: NEGOCIO },
      },
      { chamar: () => api.excluirOportunidadesApi([NEGOCIO]), url: '/api/crm/oportunidades/excluir', method: 'POST', corpo: { ids: [NEGOCIO] }, resposta: { excluidas: 1 } },
      { chamar: () => api.criarOportunidadeApi({ etapa_id: ETAPA, titulo: 'Venda' }), url: '/api/crm/oportunidades', method: 'POST', corpo: { etapa_id: ETAPA, titulo: 'Venda' }, resposta: { id: NEGOCIO } },
      { chamar: () => api.listarTarefasApi(), url: '/api/crm/tarefas', method: 'GET', resposta: [] },
      { chamar: () => api.concluirTarefaApi(TAREFA, true), url: `/api/crm/tarefas/${TAREFA}/concluir`, method: 'PATCH', corpo: { concluida: true }, resposta: { id: TAREFA } },
      { chamar: () => api.criarTarefaApi({ titulo: 'Ligar' }), url: '/api/crm/tarefas', method: 'POST', corpo: { titulo: 'Ligar' }, resposta: { id: TAREFA } },
    ];
    for (const [i, caso] of casos.entries()) {
      fetchMock.mockResolvedValueOnce(json(caso.resposta ?? {}));
      await caso.chamar();
      const c = chamada(i);
      expect(c.url, caso.url).toBe(`${BASE}${caso.url}`);
      expect(c.method, caso.url).toBe(caso.method);
      expect(c.corpo, caso.url).toEqual(caso.corpo);
    }
  });

  it('candidatos: só vão as chaves preenchidas; vazio vai como telefone=', async () => {
    const api = await carregar();
    fetchMock.mockImplementation(async () => json([]));
    await api.buscarCandidatosApi({ telefone: '62911110002', email: null, cpf: undefined });
    expect(chamada(0).url).toBe(`${BASE}/api/clientes/candidatos?telefone=62911110002`);
    await api.buscarCandidatosApi({ telefone: '', email: 'ana@x.com', cpf: '12345678909' });
    expect(chamada(1).url).toBe(`${BASE}/api/clientes/candidatos?telefone=&email=ana%40x.com&cpf=12345678909`);
    await api.buscarCandidatosApi({ telefone: null, email: null, cpf: null });
    expect(chamada(2).url).toBe(`${BASE}/api/clientes/candidatos`);
  });

  it('codifica o id na URL', async () => {
    const api = await carregar();
    fetchMock.mockImplementation(async () => json({}));
    await api.obterClienteApi('a/b');
    expect(chamada(0).url).toBe(`${BASE}/api/clientes/a%2Fb`);
    await api.moverOportunidadeApi({ id: 'x y', etapaId: ETAPA, ordem: 0, updatedAt: 't' });
    expect(chamada(1).url).toBe(`${BASE}/api/crm/oportunidades/x%20y/mover`);
  });

  it('erros: códigos do banco na message e texto padrão no 500', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValueOnce(json({ statusCode: 409, codigo: 'CONFLITO', message: 'Este negócio foi movido em outro lugar.' }, 409));
    await expect(api.moverOportunidadeApi({ id: NEGOCIO, etapaId: ETAPA, ordem: 0, updatedAt: 't' })).rejects.toMatchObject({ message: 'CONFLITO' });

    fetchMock.mockResolvedValueOnce(json({ statusCode: 409, codigo: 'duplicate_client_phone', message: 'x', detalhe: CLIENTE }, 409));
    await expect(api.criarClienteApi({ nome: 'Ana', telefone: '1' })).rejects.toMatchObject({ message: 'duplicate_client_phone', details: CLIENTE });

    fetchMock.mockResolvedValueOnce(json({ statusCode: 500 }, 500));
    await expect(api.listarClientesApi()).rejects.toMatchObject({ message: 'Não foi possível carregar os clientes.' });

    fetchMock.mockResolvedValueOnce(json({ statusCode: 400, message: ['etapas.0.Informe o nome da etapa.'] }, 400));
    await expect(api.salvarEtapasApi([])).rejects.toMatchObject({ message: 'Informe o nome da etapa.' });
  });

  it('as listas de chaves seguem os DTOs da API', async () => {
    const api = await carregar();
    expect(api.CHAVES_CRIAR_CLIENTE).toEqual(['nome', 'telefone', 'email', 'cpf', 'tipo_interesse', 'status_funil', 'observacoes', 'ultimo_contato', 'tracking_data']);
    expect(api.CHAVES_ALTERAR_CLIENTE).toEqual(['nome', 'telefone', 'email', 'tipo_interesse', 'observacoes', 'ultimo_contato']);
    expect(api.CHAVES_NOVA_OPORTUNIDADE).not.toContain('corretor_id');
    expect(api.CHAVES_NOVA_OPORTUNIDADE).not.toContain('id');
    expect(api.CHAVES_NOVA_TAREFA).toEqual(['titulo', 'descricao', 'tipo', 'data_prevista', 'oportunidade_id', 'cliente_id']);
  });
});
