/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dublê do supabase-js: qualquer encadeamento de `.from(...)` termina em
// { data: [], error: null }, e `rpc`/`functions.invoke` são espiões.
const from = vi.fn();
const rpc = vi.fn(async (..._a: unknown[]) => ({ data: [], error: null }));
const invoke = vi.fn(async (..._a: unknown[]) => ({ data: { ok: true }, error: null }));
function encadeada(): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok, erro),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => encadeada()) });
}

// chamarApi tira o Bearer do login próprio (clienteAuth), nunca da sessão do Supabase.
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: async () => 'tok', renovarAposRecusa: async () => null } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
    from: (...a: unknown[]) => { from(...a); return encadeada(); },
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('sonner', () => ({ toast, Toaster: () => null }));

const USUARIO = '99999999-9999-4999-8999-999999999999';
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: USUARIO }, isAuthenticated: true, loading: false, signOut: vi.fn() }),
}));

const BASE = 'https://api.exemplo.com';
const PARCEIRO = '11111111-1111-4111-8111-111111111111';
const LINK = '22222222-2222-4222-8222-222222222222';
const COMISSAO = '33333333-3333-4333-8333-333333333333';
const RECEITA = '44444444-4444-4444-8444-444444444444';
const LOTE = '55555555-5555-4555-8555-555555555555';
const CORRETOR = '66666666-6666-4666-8666-666666666666';
const DIAG = '77777777-7777-4777-8777-777777777777';
const VISITANTE = '88888888-8888-4888-8888-888888888888';

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./parceiros');
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('cliente da API de parceiros', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const chamada = (i = 0) => {
    const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit & { headers?: Record<string, string> };
    return {
      url: fetchMock.mock.calls[i][0] as string,
      method: init.method ?? 'GET',
      corpo: init.body === undefined ? undefined : JSON.parse(init.body as string),
      headers: init.headers ?? {},
    };
  };

  it('cada função chama o caminho e o método fixos, com o corpo esperado', async () => {
    const api = await carregar();
    const casos: Array<{
      chamar: () => Promise<unknown>; url: string; method: string; corpo?: unknown; status?: number; resposta?: unknown;
    }> = [
      // Público, atribuição, portal e convite
      {
        chamar: () => api.registrarCliqueApi({ slug: 'ana', visitante_id: VISITANTE, utm: { utm_source: 'ig' } }),
        url: '/api/parceiros/clique', method: 'POST',
        corpo: { slug: 'ana', visitante_id: VISITANTE, utm: { utm_source: 'ig' } }, resposta: { ok: true, parceiro_nome: 'Ana' },
      },
      {
        chamar: () => api.reivindicarAtribuicaoApi(VISITANTE), url: '/api/parceiros/atribuicao', method: 'POST',
        corpo: { visitante_id: VISITANTE }, resposta: { ok: true },
      },
      { chamar: () => api.portalParceiroApi(), url: '/api/parceiros/portal', method: 'GET', resposta: { teto_renovacoes: 3 } },
      {
        chamar: () => api.salvarRepasseApi({ documento: '12345678909', tipo_chave: 'cpf', chave: '12345678909' }),
        url: '/api/parceiros/portal/repasse', method: 'PUT',
        corpo: { documento: '12345678909', tipo_chave: 'cpf', chave: '12345678909' }, resposta: { salvo: true },
      },
      {
        chamar: () => api.convidarParceiroApi({ parceiro_id: PARCEIRO }), url: '/api/parceiros/convites', method: 'POST',
        corpo: { parceiro_id: PARCEIRO }, resposta: { ok: true, email: 'ana@exemplo.com' },
      },
      {
        chamar: () => api.convidarParceiroApi({ acao: 'criar', dados: { nome: 'Ana' } }),
        url: '/api/parceiros/convites', method: 'POST', corpo: { acao: 'criar', dados: { nome: 'Ana' } },
        resposta: { ok: false, parceiro_id: PARCEIRO, email_enviado: false },
      },

      // Papéis e auditoria
      { chamar: () => api.meusPapeisApi(), url: '/api/admin/papeis', method: 'GET', resposta: ['admin'] },
      {
        chamar: () => api.listarAuditoriaApi({ entidade: 'parceiros', pagina: 2, por_pagina: 50 }),
        url: '/api/admin/auditoria?entidade=parceiros&pagina=2&por_pagina=50', method: 'GET', resposta: { itens: [] },
      },
      {
        chamar: () => api.registrarAuditoriaApi({ acao: 'editar', entidade: 'parceiros', motivo: null }),
        url: '/api/admin/auditoria', method: 'POST', corpo: { acao: 'editar', entidade: 'parceiros', motivo: null },
        status: 201, resposta: { id: 7 },
      },

      // Parceiros, percentuais e links
      {
        chamar: () => api.listarParceirosApi({ busca: 'ana', status: 'ativo', pagina: 1, por_pagina: 25 }),
        url: '/api/admin/parceiros?busca=ana&status=ativo&pagina=1&por_pagina=25', method: 'GET', resposta: { itens: [], total: 0 },
      },
      { chamar: () => api.opcoesParceirosApi(), url: '/api/admin/parceiros/opcoes', method: 'GET', resposta: [] },
      {
        chamar: () => api.parceiroApi(PARCEIRO), url: `/api/admin/parceiros/${PARCEIRO}`, method: 'GET',
        resposta: { parceiro: { id: PARCEIRO }, percentuais: [], links: [], atribuicoes: [] },
      },
      {
        chamar: () => api.criarParceiroApi({ nome: 'Ana', email: 'a@b.com', status: 'ativo' }),
        url: '/api/admin/parceiros', method: 'POST', corpo: { nome: 'Ana', email: 'a@b.com', status: 'ativo' },
        status: 201, resposta: { id: PARCEIRO },
      },
      {
        chamar: () => api.editarParceiroApi(PARCEIRO, { status: 'inativo' }),
        url: `/api/admin/parceiros/${PARCEIRO}`, method: 'PATCH', corpo: { status: 'inativo' }, resposta: { id: PARCEIRO },
      },
      {
        chamar: () => api.definirPercentualApi(PARCEIRO, { percentual: 10, base_calculo: 'receita_bruta', valor_fixo: null, vigencia_inicio: null, motivo: null }),
        url: `/api/admin/parceiros/${PARCEIRO}/percentuais`, method: 'POST',
        corpo: { percentual: 10, base_calculo: 'receita_bruta', valor_fixo: null, vigencia_inicio: null, motivo: null },
        status: 201, resposta: { id: 'v' },
      },
      {
        chamar: () => api.criarLinkApi(PARCEIRO, { slug: 'ana', campanha: null, principal: true }),
        url: `/api/admin/parceiros/${PARCEIRO}/links`, method: 'POST',
        corpo: { slug: 'ana', campanha: null, principal: true }, status: 201, resposta: { id: LINK, slug: 'ana' },
      },
      {
        chamar: () => api.revogarLinkApi(LINK), url: `/api/admin/links/${LINK}/revogar`, method: 'POST',
        resposta: { revogado: true },
      },

      // Comissões, pagamentos e receita
      {
        chamar: () => api.listarComissoesApi({ parceiro_id: PARCEIRO, status: 'aprovada' }),
        url: `/api/admin/comissoes?parceiro_id=${PARCEIRO}&status=aprovada`, method: 'GET', resposta: { itens: [] },
      },
      {
        chamar: () => api.transicionarComissaoApi(COMISSAO, { novo_status: 'aprovada', motivo: null }),
        url: `/api/admin/comissoes/${COMISSAO}/status`, method: 'POST', corpo: { novo_status: 'aprovada', motivo: null },
        resposta: { status: 'aprovada' },
      },
      {
        chamar: () => api.registrarPagamentoApi({ parceiro_id: PARCEIRO, comissao_ids: [COMISSAO] }),
        url: '/api/admin/pagamentos-parceiro', method: 'POST', corpo: { parceiro_id: PARCEIRO, comissao_ids: [COMISSAO] },
        status: 201, resposta: { id: 'p' },
      },
      {
        chamar: () => api.listarReceitaApi({ corretor_id: CORRETOR }),
        url: `/api/admin/receita?corretor_id=${CORRETOR}`, method: 'GET', resposta: { itens: [] },
      },
      {
        chamar: () => api.registrarReceitaApi({ corretor_id: CORRETOR, valor_bruto: 99.9, confirmado_em: '2026-01-10', motivo: 'ajuste manual do mês' }),
        url: '/api/admin/receita', method: 'POST',
        corpo: { corretor_id: CORRETOR, valor_bruto: 99.9, confirmado_em: '2026-01-10', motivo: 'ajuste manual do mês' },
        status: 201, resposta: { id: RECEITA },
      },
      {
        chamar: () => api.estornarReceitaApi(RECEITA, 'cobrança duplicada'),
        url: `/api/admin/receita/${RECEITA}/estornar`, method: 'POST', corpo: { motivo: 'cobrança duplicada' },
        resposta: { id: RECEITA },
      },

      // Repasses em lote
      {
        chamar: () => api.elegiveisRepasseApi(50), url: '/api/admin/repasses/elegiveis?saldo_minimo=50', method: 'GET',
        resposta: { itens: [] },
      },
      { chamar: () => api.elegiveisRepasseApi(null), url: '/api/admin/repasses/elegiveis', method: 'GET', resposta: { itens: [] } },
      { chamar: () => api.listarLotesApi({ status: 'rascunho' }), url: '/api/admin/lotes?status=rascunho', method: 'GET', resposta: { itens: [] } },
      { chamar: () => api.loteApi(LOTE), url: `/api/admin/lotes/${LOTE}`, method: 'GET', resposta: { lote: {} } },
      {
        chamar: () => api.gerarLoteApi({ parceiro_ids: [PARCEIRO], saldo_minimo: null, observacoes: null }),
        url: '/api/admin/lotes', method: 'POST', corpo: { parceiro_ids: [PARCEIRO], saldo_minimo: null, observacoes: null },
        status: 201, resposta: { id: LOTE },
      },
      {
        chamar: () => api.marcarLoteExportadoApi(LOTE), url: `/api/admin/lotes/${LOTE}/exportado`, method: 'POST',
        resposta: { status: 'exportado' },
      },
      {
        chamar: () => api.marcarLotePagoApi(LOTE, { pago_em: '2026-02-01', referencia: 'TED 9', comprovante_url: null }),
        url: `/api/admin/lotes/${LOTE}/pago`, method: 'POST',
        corpo: { pago_em: '2026-02-01', referencia: 'TED 9', comprovante_url: null }, resposta: { status: 'pago' },
      },
      {
        chamar: () => api.cancelarLoteApi(LOTE, 'lote gerado por engano'),
        url: `/api/admin/lotes/${LOTE}/cancelar`, method: 'POST', corpo: { motivo: 'lote gerado por engano' },
        resposta: { status: 'cancelado' },
      },

      // Contas, atendimento e operação
      {
        chamar: () => api.listarUsuariosApi({ busca: 'ana', ordenar: 'nome', direcao: 'asc' }),
        url: '/api/admin/usuarios?busca=ana&ordenar=nome&direcao=asc', method: 'GET', resposta: { itens: [] },
      },
      { chamar: () => api.usuarioApi(CORRETOR), url: `/api/admin/usuarios/${CORRETOR}`, method: 'GET', resposta: {} },
      {
        chamar: () => api.definirStatusCorretorApi(CORRETOR, { status: 'suspenso', motivo: 'inadimplência longa' }),
        url: `/api/admin/usuarios/${CORRETOR}/status`, method: 'POST',
        corpo: { status: 'suspenso', motivo: 'inadimplência longa' }, resposta: { alterado: true },
      },
      {
        chamar: () => api.listarAtendimentoApi({ origem_direta: true }), url: '/api/admin/atendimento?origem_direta=true',
        method: 'GET', resposta: { itens: [] },
      },
      { chamar: () => api.listarAssinaturasApi({ plano: 'pro' }), url: '/api/admin/assinaturas?plano=pro', method: 'GET', resposta: { itens: [] } },
      {
        chamar: () => api.listarPagamentosApi({ inicio: '2026-01-01', fim: '2026-01-31' }),
        url: '/api/admin/pagamentos?inicio=2026-01-01&fim=2026-01-31', method: 'GET', resposta: { itens: [] },
      },
      { chamar: () => api.listarCancelamentosApi({ motivo: 'preco' }), url: '/api/admin/cancelamentos?motivo=preco', method: 'GET', resposta: { itens: [] } },
      {
        chamar: () => api.registrarCancelamentoApi({ motivo: 'preco', origem: 'suporte' }),
        url: '/api/admin/cancelamentos', method: 'POST', corpo: { motivo: 'preco', origem: 'suporte' },
        status: 201, resposta: { id: 'c' },
      },
      { chamar: () => api.listarOrganizacoesApi({ busca: 'x' }), url: '/api/admin/organizacoes?busca=x', method: 'GET', resposta: { itens: [] } },
      { chamar: () => api.organizacaoApi(PARCEIRO), url: `/api/admin/organizacoes/${PARCEIRO}`, method: 'GET', resposta: {} },
      { chamar: () => api.listarAcessosApi({ busca: 'x' }), url: '/api/admin/acessos?busca=x', method: 'GET', resposta: { itens: [] } },

      // Métricas, integrações e configuração
      {
        chamar: () => api.metricasApi({ inicio: '2026-01-01', fim: '2026-01-31' }),
        url: '/api/admin/metricas?inicio=2026-01-01&fim=2026-01-31', method: 'GET', resposta: {},
      },
      {
        chamar: () => api.metricasSaasApi({ inicio: '2026-01-01', fim: '2026-01-31' }),
        url: '/api/admin/metricas/saas?inicio=2026-01-01&fim=2026-01-31', method: 'GET', resposta: {},
      },
      {
        chamar: () => api.metricasCancelamentoApi({ inicio: '2026-01-01', fim: '2026-01-31' }),
        url: '/api/admin/metricas/cancelamento?inicio=2026-01-01&fim=2026-01-31', method: 'GET', resposta: {},
      },
      {
        chamar: () => api.metricasOnboardingApi({ inicio: '2026-01-01T00:00:00', fim: '2026-02-01T00:00:00' }),
        url: '/api/admin/metricas/onboarding?inicio=2026-01-01T00%3A00%3A00&fim=2026-02-01T00%3A00%3A00',
        method: 'GET', resposta: {},
      },
      { chamar: () => api.statusIntegracoesApi(), url: '/api/admin/integracoes', method: 'GET', resposta: {} },
      { chamar: () => api.listarConfigApi(), url: '/api/admin/config', method: 'GET', resposta: [] },
      { chamar: () => api.listarLinhasConfigApi(), url: '/api/admin/config/linhas', method: 'GET', resposta: [] },
      {
        chamar: () => api.atualizarConfigApi('janela_atividade_dias', 30), url: '/api/admin/config/janela_atividade_dias',
        method: 'PUT', corpo: { valor: 30 }, resposta: { chave: 'janela_atividade_dias' },
      },
      {
        chamar: () => api.salvarConfigApi('atribuicao_modelo', 'primeiro_clique'), url: '/api/admin/config/atribuicao_modelo',
        method: 'POST', corpo: { valor: 'primeiro_clique' }, resposta: { chave: 'atribuicao_modelo' },
      },
      {
        chamar: () => api.listarDiagnosticosApi({ por_pagina: 200 }), url: '/api/admin/diagnosticos?por_pagina=200',
        method: 'GET', resposta: [],
      },
      {
        chamar: () => api.atualizarStatusDiagnosticoApi(DIAG, 'em_contato'), url: `/api/admin/diagnosticos/${DIAG}`,
        method: 'PATCH', corpo: { status: 'em_contato' }, resposta: { id: DIAG, status: 'em_contato' },
      },
    ];

    for (const [i, caso] of casos.entries()) {
      fetchMock.mockResolvedValueOnce(json(caso.resposta ?? null, caso.status ?? 200));
      await caso.chamar();
      const feita = chamada(i);
      expect(feita.url, caso.url).toBe(`${BASE}${caso.url}`);
      expect(feita.method, caso.url).toBe(caso.method);
      expect(feita.corpo, caso.url).toEqual(caso.corpo);
    }
    expect(fetchMock).toHaveBeenCalledTimes(casos.length);
  });

  it('as rotas autenticadas levam o token; a rota pública do clique não', async () => {
    const api = await carregar();

    fetchMock.mockResolvedValueOnce(json(['admin']));
    await api.meusPapeisApi();
    expect(chamada(0).headers.Authorization).toBe('Bearer tok');

    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await api.registrarCliqueApi({ slug: 'ana', visitante_id: VISITANTE });
    expect(chamada(1).headers.Authorization).toBeUndefined();
  });

  it('a query das listas só leva os filtros presentes', async () => {
    const api = await carregar();
    fetchMock.mockImplementation(async () => json({ itens: [] }));

    await api.listarParceirosApi({ busca: '', status: null, pagina: 1 });
    expect(chamada(0).url).toBe(`${BASE}/api/admin/parceiros?pagina=1`);

    await api.listarComissoesApi({});
    expect(chamada(1).url).toBe(`${BASE}/api/admin/comissoes`);

    await api.listarAtendimentoApi({ busca: '  ', origem_direta: undefined });
    expect(chamada(2).url).toBe(`${BASE}/api/admin/atendimento?busca=++`);
  });

  it('chaves fora do DTO não são enviadas', async () => {
    const api = await carregar();
    fetchMock.mockImplementation(async () => json({ id: PARCEIRO }, 201));
    await api.criarParceiroApi({ nome: 'Ana', email: 'a@b.com', status: 'ativo', criado_por: 'x', user_id: 'y', id: 'z' });
    expect(chamada(0).corpo).toEqual({ nome: 'Ana', email: 'a@b.com', status: 'ativo' });
  });

  it('traduz os erros nas classes que o painel distingue', async () => {
    const api = await carregar();
    const { AcessoNegadoError, BackOfficeNaoInstaladoError } = await import('@/lib/admin/api');
    const { ErroApi } = await import('./http');

    fetchMock.mockResolvedValueOnce(json({ codigo: 'sem_permissao', message: 'Você não tem permissão para esta ação.' }, 403));
    await expect(api.listarParceirosApi()).rejects.toBeInstanceOf(AcessoNegadoError);

    fetchMock.mockResolvedValueOnce(json({ codigo: 'backoffice_nao_instalado', message: 'As migrations do back office ainda não foram aplicadas neste banco.' }, 503));
    await expect(api.meusPapeisApi()).rejects.toBeInstanceOf(BackOfficeNaoInstaladoError);

    fetchMock.mockResolvedValueOnce(json({ codigo: 'parceiro_nao_vinculado', message: 'Este e-mail ainda não está vinculado a um parceiro ativo.' }, 403));
    const erro = await api.portalParceiroApi().catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect((erro as InstanceType<typeof ErroApi>).codigo).toBe('parceiro_nao_vinculado');
    expect((erro as Error).message).toBe('Este e-mail ainda não está vinculado a um parceiro ativo.');

    fetchMock.mockResolvedValueOnce(json({ codigo: 'provedor_de_email_nao_configurado', message: 'O envio de convites por e-mail ainda não está configurado no servidor.' }, 503));
    await expect(api.convidarParceiroApi({ parceiro_id: PARCEIRO })).rejects.toThrow(
      'O envio de convites por e-mail ainda não está configurado no servidor.',
    );
  });
});

describe('despachante de RPC do back office', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function carregarAdmin(comApi: boolean) {
    vi.resetModules();
    if (comApi) vi.stubEnv('VITE_API_URL', BASE);
    else vi.stubEnv('VITE_API_URL', '');
    return import('@/lib/admin/api');
  }

  const url = (i = 0) => fetchMock.mock.calls[i][0] as string;
  const corpo = (i = 0) => {
    const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit;
    return init.body === undefined ? undefined : JSON.parse(init.body as string);
  };

  it('converte p_limite/p_offset em pagina/por_pagina', async () => {
    const { chamarRpc } = await carregarAdmin(true);
    fetchMock.mockImplementation(async () => json({ itens: [], total: 0 }));

    await chamarRpc('admin_listar_parceiros', { p_busca: null, p_status: null, p_limite: 25, p_offset: 50 });
    expect(url(0)).toBe(`${BASE}/api/admin/parceiros?pagina=3&por_pagina=25`);

    await chamarRpc('admin_listar_auditoria', { p_entidade: null, p_acao: null, p_de: null, p_ate: null, p_limite: 50, p_offset: 0 });
    expect(url(1)).toBe(`${BASE}/api/admin/auditoria?pagina=1&por_pagina=50`);
  });

  it('mantém pagina/por_pagina das RPCs que já paginam assim', async () => {
    const { chamarRpc } = await carregarAdmin(true);
    fetchMock.mockImplementation(async () => json({ itens: [] }));
    await chamarRpc('admin_listar_assinaturas', { p_busca: null, p_status: 'ativa', p_pagina: 2, p_por_pagina: 25 });
    expect(url(0)).toBe(`${BASE}/api/admin/assinaturas?status=ativa&pagina=2&por_pagina=25`);
  });

  it('p_origem_direta vai na query como booleano, inclusive quando é falso', async () => {
    const { chamarRpc } = await carregarAdmin(true);
    fetchMock.mockImplementation(async () => json({ itens: [] }));

    await chamarRpc('admin_listar_atendimento', {
      p_busca: null, p_status: null, p_parceiro_id: null, p_origem_direta: false, p_campanha: null, p_limite: 25, p_offset: 0,
    });
    expect(url(0)).toBe(`${BASE}/api/admin/atendimento?origem_direta=false&pagina=1&por_pagina=25`);

    await chamarRpc('admin_listar_atendimento', {
      p_busca: null, p_status: null, p_parceiro_id: null, p_origem_direta: true, p_campanha: null, p_limite: 25, p_offset: 0,
    });
    expect(url(1)).toBe(`${BASE}/api/admin/atendimento?origem_direta=true&pagina=1&por_pagina=25`);
  });

  it('traduz os argumentos p_* em corpo das rotas de escrita', async () => {
    const { chamarRpc } = await carregarAdmin(true);
    fetchMock.mockImplementation(async () => json({ id: 'x' }, 201));

    await chamarRpc('admin_registrar_receita', {
      p_corretor_id: CORRETOR, p_valor_bruto: 120, p_confirmado_em: '2026-01-10', p_tipo: 'assinatura',
      p_valor_liquido: null, p_competencia: null, p_motivo: 'conferido no extrato',
    });
    expect(url(0)).toBe(`${BASE}/api/admin/receita`);
    expect(corpo(0)).toEqual({
      corretor_id: CORRETOR, valor_bruto: 120, confirmado_em: '2026-01-10', tipo: 'assinatura',
      valor_liquido: null, competencia: null, motivo: 'conferido no extrato',
    });

    await chamarRpc('registrar_auditoria_admin', {
      p_acao: 'suspender', p_entidade: 'corretores', p_entidade_id: CORRETOR,
      p_dados_antes: null, p_dados_depois: { status: 'suspenso' }, p_motivo: 'pedido do titular',
    });
    expect(url(1)).toBe(`${BASE}/api/admin/auditoria`);
    expect(corpo(1)).toEqual({
      acao: 'suspender', entidade: 'corretores', entidade_id: CORRETOR,
      dados_antes: null, dados_depois: { status: 'suspenso' }, motivo: 'pedido do titular',
    });
  });

  it('RPC fora do mapa continua indo para o Supabase, mesmo com a API ligada', async () => {
    const { chamarRpc } = await carregarAdmin(true);
    rpc.mockResolvedValueOnce({ data: 'do banco' as unknown as [], error: null });

    await expect(chamarRpc('parceiro_portal_resumo')).resolves.toBe('do banco');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem VITE_API_URL nenhuma RPC do mapa toca a API', async () => {
    const { chamarRpc, RPCS_NA_API } = await carregarAdmin(false);
    rpc.mockClear();

    for (const nome of RPCS_NA_API) await chamarRpc(nome, {});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(RPCS_NA_API.length);
  });
});

describe('adaptadores das telas e dos hooks', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    from.mockClear(); rpc.mockClear(); invoke.mockClear();
    toast.success.mockClear(); toast.error.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const url = (i = 0) => fetchMock.mock.calls[i][0] as string;
  const metodo = (i = 0) => ((fetchMock.mock.calls[i][1] ?? {}) as RequestInit).method ?? 'GET';
  const corpo = (i = 0) => {
    const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit;
    return init.body === undefined ? undefined : JSON.parse(init.body as string);
  };

  async function ambiente(comApi: boolean) {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', comApi ? BASE : '');
    const { createElement } = await import('react');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { MemoryRouter } = await import('react-router-dom');
    const testing = await import('@testing-library/react');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const envolver = ({ children }: { children: React.ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, children));
    return { ...testing, envolver, createElement };
  }

  it('useParceiro lê o detalhe pela API', async () => {
    const { envolver, renderHook, waitFor } = await ambiente(true);
    fetchMock.mockImplementation(async () => json({ parceiro: { id: PARCEIRO }, percentuais: [], links: [], atribuicoes: [] }));
    const { useParceiro } = await import('@/hooks/admin/useAdminDados');

    const { result } = renderHook(() => useParceiro(PARCEIRO), { wrapper: envolver });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(url(0)).toBe(`${BASE}/api/admin/parceiros/${PARCEIRO}`);
    expect(from).not.toHaveBeenCalled();
  });

  it('useSalvarParceiro cria com POST e edita com PATCH', async () => {
    const { envolver, renderHook, waitFor } = await ambiente(true);
    fetchMock.mockImplementation(async () => json({ id: PARCEIRO }, 201));
    const { useSalvarParceiro } = await import('@/hooks/admin/useAdminDados');

    const { result } = renderHook(() => useSalvarParceiro(), { wrapper: envolver });
    result.current.mutate({ nome: 'Ana', email: 'a@b.com', status: 'ativo' } as never);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(url(0)).toBe(`${BASE}/api/admin/parceiros`);
    expect(metodo(0)).toBe('POST');
    expect(corpo(0)).toEqual({ nome: 'Ana', email: 'a@b.com', status: 'ativo' });

    result.current.mutate({ id: PARCEIRO, status: 'inativo' } as never);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(url(1)).toBe(`${BASE}/api/admin/parceiros/${PARCEIRO}`);
    expect(metodo(1)).toBe('PATCH');
    expect(corpo(1)).toEqual({ status: 'inativo' });
    expect(from).not.toHaveBeenCalled();
  });

  it('useCriarParceiroConvidar chama o convite da API com acao criar', async () => {
    const { envolver, renderHook, waitFor } = await ambiente(true);
    fetchMock.mockImplementation(async () => json({ ok: false, parceiro_id: PARCEIRO, email_enviado: false }));
    const { useCriarParceiroConvidar } = await import('@/hooks/admin/useAdminDados');

    const { result } = renderHook(() => useCriarParceiroConvidar(), { wrapper: envolver });
    result.current.mutate({ nome: 'Ana', email: 'a@b.com' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(url(0)).toBe(`${BASE}/api/parceiros/convites`);
    expect(corpo(0)).toEqual({ acao: 'criar', dados: { nome: 'Ana', email: 'a@b.com' } });
    // Cadastro salvo mesmo sem o e-mail sair: o hook só exige parceiro_id.
    expect((result.current.data as { parceiro_id?: string }).parceiro_id).toBe(PARCEIRO);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('useCriarLink e useRevogarLink usam as rotas de link', async () => {
    const { envolver, renderHook, waitFor } = await ambiente(true);
    fetchMock.mockImplementation(async () => json({ id: LINK, slug: 'ana' }, 201));
    const { useCriarLink, useRevogarLink } = await import('@/hooks/admin/useAdminDados');

    const criar = renderHook(() => useCriarLink(), { wrapper: envolver });
    criar.result.current.mutate({ parceiroId: PARCEIRO, slug: 'ana', campanha: null, principal: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(url(0)).toBe(`${BASE}/api/admin/parceiros/${PARCEIRO}/links`);
    expect(corpo(0)).toEqual({ slug: 'ana', campanha: null, principal: true });

    fetchMock.mockImplementation(async () => json({ revogado: true }));
    const revogar = renderHook(() => useRevogarLink(), { wrapper: envolver });
    revogar.result.current.mutate(LINK);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(url(1)).toBe(`${BASE}/api/admin/links/${LINK}/revogar`);
    expect(metodo(1)).toBe('POST');
    expect(from).not.toHaveBeenCalled();
  });

  it('AdminDiagnosticos lê e atualiza pela API', async () => {
    const { envolver, render, waitFor, screen, createElement, fireEvent } = await ambiente(true);
    fetchMock.mockImplementation(async () => json([{
      id: DIAG, created_at: '2026-01-10T12:00:00+00:00', name: 'Ana', phone: '5511999999999', email: null,
      city: null, company: null, profile_label: 'Corretor', dominant_problem: 'Leads', secondary_problems: [],
      urgency_label: 'Agora', recommended_next_step: 'demo', status: 'novo', answers: {}, attribution: {}, scores: {},
    }]));
    const AdminDiagnosticos = (await import('@/pages/admin/AdminDiagnosticos')).default;

    render(createElement(AdminDiagnosticos), { wrapper: envolver });
    await waitFor(() => expect(screen.getByText('Ana')).toBeTruthy());
    expect(url(0)).toBe(`${BASE}/api/admin/diagnosticos?por_pagina=200`);

    fetchMock.mockImplementation(async () => json({ id: DIAG, status: 'em_contato' }));
    fireEvent.change(screen.getByLabelText('Status de Ana'), { target: { value: 'em_contato' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(url(1)).toBe(`${BASE}/api/admin/diagnosticos/${DIAG}`);
    expect(metodo(1)).toBe('PATCH');
    expect(corpo(1)).toEqual({ status: 'em_contato' });
    expect(from).not.toHaveBeenCalled();
  });

  /** A tela lê o slug da rota: sem `/r/:slug` ela só redireciona para /auth. */
  async function renderRedirect(comApi: boolean) {
    const amb = await ambiente(comApi);
    const { createElement } = amb;
    const { MemoryRouter, Route, Routes } = await import('react-router-dom');
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const RedirectParceiro = (await import('@/pages/RedirectParceiro')).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    amb.render(createElement(QueryClientProvider, { client: qc },
      createElement(MemoryRouter, { initialEntries: ['/r/ana?utm_source=ig'] },
        createElement(Routes, null, createElement(Route, { path: '/r/:slug', element: createElement(RedirectParceiro) })))));
    return amb;
  }

  it('RedirectParceiro registra o clique na rota pública, sem token', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true, parceiro_nome: 'Ana' }));
    const { waitFor } = await renderRedirect(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(url(0)).toBe(`${BASE}/api/parceiros/clique`);
    expect(corpo(0)).toMatchObject({ slug: 'ana' });
    expect(((fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Authorization).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sem VITE_API_URL os mesmos adaptadores seguem no Supabase', async () => {
    const { envolver, renderHook, waitFor } = await ambiente(false);
    const { useParceiro, useSalvarParceiro, useCriarParceiroConvidar, useRevogarLink } =
      await import('@/hooks/admin/useAdminDados');
    const { usePapeis } = await import('@/hooks/admin/usePapeis');

    renderHook(() => useParceiro(PARCEIRO), { wrapper: envolver });
    await waitFor(() => expect(from).toHaveBeenCalledWith('parceiros'));

    renderHook(() => usePapeis(), { wrapper: envolver });

    const salvar = renderHook(() => useSalvarParceiro(), { wrapper: envolver });
    salvar.result.current.mutate({ nome: 'Ana' } as never);

    const convidar = renderHook(() => useCriarParceiroConvidar(), { wrapper: envolver });
    convidar.result.current.mutate({ nome: 'Ana' });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('parceiro-convidar', { body: { acao: 'criar', dados: { nome: 'Ana' } } }));

    const revogar = renderHook(() => useRevogarLink(), { wrapper: envolver });
    revogar.result.current.mutate(LINK);
    await waitFor(() => expect(from).toHaveBeenCalledWith('parceiro_links'));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem VITE_API_URL o clique segue na Edge Function', async () => {
    const { waitFor } = await renderRedirect(false);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('parceiro-clique', expect.anything()));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
