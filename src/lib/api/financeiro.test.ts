import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// chamarApi tira o Bearer do login próprio (clienteAuth), nunca da sessão do Supabase.
vi.mock('@/lib/api/auth', () => ({ clienteAuth: { obterTokenValido: async () => 'tok', renovarAposRecusa: async () => null } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } },
}));

const BASE = 'https://api.exemplo.com';
const ID = '11111111-1111-4111-8111-111111111111';
const CONTRATO = '22222222-2222-4222-8222-222222222222';

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./financeiro');
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('API do financeiro no front', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const chamada = (i = 0) => {
    const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit & { headers: Record<string, string> };
    return {
      url: fetchMock.mock.calls[i][0] as string,
      method: init.method ?? 'GET',
      corpo: init.body === undefined ? undefined : JSON.parse(init.body as string),
      headers: init.headers,
    };
  };

  it('cada função usa o método, o caminho e o corpo do contrato', async () => {
    const api = await carregar();
    const casos: Array<{ chamar: () => Promise<unknown>; url: string; method: string; corpo?: unknown; status?: number; resposta?: unknown }> = [
      { chamar: () => api.listarLancamentosApi(), url: '/api/financeiro/lancamentos', method: 'GET', resposta: [] },
      { chamar: () => api.criarLancamentoApi({ tipo: 'RECEITA', valor: 10, data: '2026-01-31', recorrente: true }), url: '/api/financeiro/lancamentos', method: 'POST', corpo: { tipo: 'RECEITA', valor: 10, data: '2026-01-31', recorrente: true }, status: 201, resposta: [] },
      { chamar: () => api.alterarLancamentoApi(ID, { valor: 5 }), url: `/api/financeiro/lancamentos/${ID}`, method: 'PATCH', corpo: { valor: 5 }, resposta: { id: ID } },
      { chamar: () => api.excluirLancamentoApi(ID), url: `/api/financeiro/lancamentos/${ID}`, method: 'DELETE', status: 204 },
      { chamar: () => api.listarContratosAtivosApi(), url: '/api/financeiro/contratos-ativos', method: 'GET', resposta: [] },
      { chamar: () => api.resumoLocacaoApi(), url: '/api/financeiro/locacao/resumo', method: 'GET', resposta: { contratos_ativos: 1, soma_valor: 2 } },
      { chamar: () => api.listarFaturasApi(), url: '/api/financeiro/faturas', method: 'GET', resposta: [] },
      {
        chamar: () => api.garantirFaturaApi({ contrato_id: CONTRATO, mes_referencia: '2026-10', data_vencimento: '2026-10-10' }),
        url: '/api/financeiro/faturas', method: 'POST', corpo: { contrato_id: CONTRATO, mes_referencia: '2026-10', data_vencimento: '2026-10-10' }, resposta: { id: ID, criada: true },
      },
      { chamar: () => api.alterarVencimentoApi(ID, '2026-10-15'), url: `/api/financeiro/faturas/${ID}/vencimento`, method: 'PATCH', corpo: { data_vencimento: '2026-10-15' }, resposta: { id: ID } },
      { chamar: () => api.darBaixaApi(ID, '2026-10-05'), url: `/api/financeiro/faturas/${ID}/baixa`, method: 'POST', corpo: { data_pagamento: '2026-10-05' }, resposta: { id: ID } },
      { chamar: () => api.estornarFaturaApi(ID), url: `/api/financeiro/faturas/${ID}/estorno`, method: 'POST', resposta: { status: 'PENDENTE' } },
      { chamar: () => api.cancelarFaturaApi(ID), url: `/api/financeiro/faturas/${ID}/cancelar`, method: 'POST', resposta: { id: ID } },
      { chamar: () => api.reativarFaturaApi(ID), url: `/api/financeiro/faturas/${ID}/reativar`, method: 'POST', resposta: { id: ID } },
      { chamar: () => api.acaoAsaasApi(ID, 'receber_em_dinheiro', { data_pagamento: '2026-10-05' }), url: `/api/financeiro/faturas/${ID}/asaas`, method: 'POST', corpo: { acao: 'receber_em_dinheiro', data_pagamento: '2026-10-05' }, resposta: { ok: true } },
      { chamar: () => api.acaoAsaasApi(ID, 'emitir_cobranca'), url: `/api/financeiro/faturas/${ID}/asaas`, method: 'POST', corpo: { acao: 'emitir_cobranca' }, resposta: { ok: true } },
      { chamar: () => api.saldoAsaasApi(), url: '/api/financeiro/asaas/saldo', method: 'GET', resposta: { balance: 10 } },
      { chamar: () => api.listarRepassesApi(), url: '/api/financeiro/repasses', method: 'GET', resposta: [] },
      { chamar: () => api.confirmarRepasseApi(ID), url: `/api/financeiro/repasses/${ID}/confirmar`, method: 'POST', resposta: { id: ID } },
      { chamar: () => api.statusConexaoAsaasApi(), url: '/api/financeiro/asaas/conexao', method: 'GET', resposta: { disponivel: true, conexao: null } },
      { chamar: () => api.conectarAsaasApi('chave', 'sandbox'), url: '/api/financeiro/asaas/conexao', method: 'POST', corpo: { api_key: 'chave', ambiente: 'sandbox' }, resposta: { ok: true } },
      { chamar: () => api.desconectarAsaasApi(), url: '/api/financeiro/asaas/conexao', method: 'DELETE', resposta: { ok: true, aviso: null } },
    ];
    for (const [i, c] of casos.entries()) {
      fetchMock.mockResolvedValueOnce(c.status === 204 ? new Response(null, { status: 204 }) : json(c.resposta, c.status ?? 200));
      const r = await c.chamar();
      const feita = chamada(i);
      expect(feita.url, c.url).toBe(`${BASE}${c.url}`);
      expect(feita.method, c.url).toBe(c.method);
      expect(feita.corpo, c.url).toEqual(c.corpo);
      expect(feita.headers.Authorization).toBe('Bearer tok');
      if (c.status !== 204) expect(r).toEqual(c.resposta);
    }
  });

  it('a query string leva só os filtros definidos', async () => {
    const api = await carregar();
    fetchMock.mockImplementation(async () => json([]));
    await api.listarLancamentosApi({ tipo: 'DESPESA', de: '2026-01-01', ate: undefined });
    expect(chamada(0).url).toBe(`${BASE}/api/financeiro/lancamentos?tipo=DESPESA&de=2026-01-01`);
    await api.listarLancamentosApi({ categoria: 'A&B', ate: '2026-12-31' });
    expect(chamada(1).url).toBe(`${BASE}/api/financeiro/lancamentos?categoria=A%26B&ate=2026-12-31`);
  });

  it('ids vão com encodeURIComponent', async () => {
    const api = await carregar();
    fetchMock.mockImplementation(async () => json({}));
    await api.cancelarFaturaApi('a/b c');
    expect(chamada(0).url).toBe(`${BASE}/api/financeiro/faturas/a%2Fb%20c/cancelar`);
  });

  it('criar e alterar lançamento descartam chaves fora do DTO', async () => {
    const api = await carregar();
    fetchMock.mockImplementation(async () => json([]));
    await api.criarLancamentoApi({ tipo: 'RECEITA', corretor_id: 'x', id: 'y', descricao: 'Aluguel', grupo_dre: undefined });
    expect(chamada(0).corpo).toEqual({ tipo: 'RECEITA', descricao: 'Aluguel' });
    await api.alterarLancamentoApi(ID, { valor: 1, status: 'pago', impacta_dre: false });
    expect(chamada(1).corpo).toEqual({ valor: 1 });
  });

  it('409 ASAAS_NAO_CONECTADO vira ErroApi com código e texto em português', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValue(json({ statusCode: 409, codigo: 'ASAAS_NAO_CONECTADO', message: 'Conecte sua conta Asaas.', nao_conectado: true }, 409));
    const erro = await api.saldoAsaasApi().catch((e) => e);
    expect(erro.name).toBe('ErroApi');
    expect(erro.status).toBe(409);
    expect(erro.codigo).toBe('ASAAS_NAO_CONECTADO');
    expect(erro.message).toBe('Conecte sua conta Asaas.');
  });

  it('erro sem corpo usa o texto padrão da função', async () => {
    const api = await carregar();
    fetchMock.mockResolvedValue(new Response('x', { status: 500 }));
    await expect(api.listarRepassesApi()).rejects.toThrow('Não foi possível carregar os repasses.');
    fetchMock.mockResolvedValue(new Response('x', { status: 500 }));
    await expect(api.conectarAsaasApi('k', 'producao')).rejects.toThrow('Não foi possível concluir a conexão com a Asaas.');
  });
});
