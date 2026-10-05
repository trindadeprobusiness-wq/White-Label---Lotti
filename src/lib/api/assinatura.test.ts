/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dublê do supabase-js: qualquer encadeamento de `.from(...)` termina em { data: [], error: null }.
const from = vi.fn();
const rpc = vi.fn(async (..._a: unknown[]) => ({ data: null, error: null }));
const getUser = vi.fn(async () => ({ data: { user: { id: 'u' } } }));
function consulta(): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(ok, erro),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => consulta()) });
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
      getUser: (...a: unknown[]) => getUser(...(a as [])),
    },
    from: (...a: unknown[]) => { from(...a); return consulta(); },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));

const BASE = 'https://api.exemplo.com';
const CORRETOR = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const PLANO = '33333333-3333-4333-8333-333333333333';
const ASSINATURA = '44444444-4444-4444-8444-444444444444';
const PERFIL = '55555555-5555-4555-8555-555555555555';

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
const vazio = (status: number) => new Response(null, { status });

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  from.mockClear(); rpc.mockClear(); getUser.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const chamada = (i = 0) => {
  const init = (fetchMock.mock.calls[i][1] ?? {}) as RequestInit & { headers: Record<string, string> };
  return {
    url: fetchMock.mock.calls[i][0] as string,
    method: init.method ?? 'GET',
    corpo: init.body === undefined ? undefined : JSON.parse(init.body as string),
    headers: init.headers,
  };
};

async function carregarCliente() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./assinatura');
}

// ── Cliente da API ───────────────────────────────────────────────────────

describe('cliente da API de assinatura e onboarding', () => {
  it('cada função chama o caminho e o método fixos, com o corpo esperado e o token', async () => {
    const api = await carregarCliente();
    const casos: Array<{
      chamar: () => Promise<unknown>; url: string; method: string;
      corpo?: unknown; status?: number; resposta?: unknown; espera?: unknown;
    }> = [
      { chamar: () => api.listarPlanosApi(), url: '/api/planos', method: 'GET', resposta: [{ id: PLANO }] },
      { chamar: () => api.listarEntitlementsApi(), url: '/api/planos/entitlements', method: 'GET', resposta: [] },
      { chamar: () => api.campanhaAtivaApi(), url: '/api/planos/campanha', method: 'GET', resposta: { id: 'c1' } },
      { chamar: () => api.assinaturaAtualApi(), url: '/api/assinatura', method: 'GET', resposta: { id: ASSINATURA } },
      {
        chamar: () => api.usoAssinaturaApi(), url: '/api/assinatura/uso', method: 'GET',
        resposta: {
          period_start: '2026-10-01', period_end: '2026-10-31', contadores: [],
          ativos: { max_imoveis: 0, max_contratos_locacao: 0, max_fachadas: 0 },
        },
      },
      { chamar: () => api.addonsApi(), url: '/api/assinatura/addons', method: 'GET', resposta: [] },
      {
        chamar: () => api.contaAntigaSemLimiteApi(), url: '/api/assinatura/conta-antiga', method: 'GET',
        resposta: { sem_limite: true }, espera: true,
      },
      {
        chamar: () => api.cotaApi('max_imoveis'), url: '/api/assinatura/cota/max_imoveis', method: 'GET',
        resposta: { permitido: true, usado: 1, limite: 10, ilimitado: false, habilitado: true },
      },
      { chamar: () => api.contextoOnboardingApi(), url: '/api/onboarding/contexto', method: 'GET', resposta: { profile: {} } },
      {
        chamar: () => api.salvarOnboardingApi({ profile: { persona: 'autonomo' }, stepKey: 'persona', stepStatus: 'concluido' }),
        url: '/api/onboarding/salvar', method: 'POST',
        corpo: { profile: { persona: 'autonomo' }, stepKey: 'persona', stepStatus: 'concluido' }, resposta: { profile: {} },
      },
      {
        chamar: () => api.executarAcaoOnboardingApi('sample_client'), url: '/api/onboarding/acoes', method: 'POST',
        corpo: { action: 'sample_client', payload: {} }, resposta: { id: PERFIL, reused: true },
      },
      {
        chamar: () => api.registrarEventoOnboardingApi('persona_selected', 'persona', { persona: 'autonomo' }),
        url: '/api/onboarding/eventos', method: 'POST',
        corpo: { eventName: 'persona_selected', stepKey: 'persona', metadata: { persona: 'autonomo' } },
        status: 204, espera: undefined,
      },
      {
        chamar: () => api.salvarTourOnboardingApi('dashboard', 'concluido', 3), url: '/api/onboarding/tours', method: 'PUT',
        corpo: { tourKey: 'dashboard', status: 'concluido', currentStep: 3 }, status: 204, espera: undefined,
      },
      {
        chamar: () => api.salvarChecklistOnboardingApi({ minimized: true }), url: '/api/onboarding/checklist', method: 'PATCH',
        corpo: { minimized: true }, status: 204, espera: undefined,
      },
      {
        chamar: () => api.atualizarPerfilOnboardingApi({ nome: 'Ana', cidade: 'Porto Alegre' }),
        url: '/api/onboarding/perfil', method: 'PATCH', corpo: { nome: 'Ana', cidade: 'Porto Alegre' },
        status: 204, espera: undefined,
      },
      {
        chamar: () => api.atualizarOrganizacaoOnboardingApi(ORG, { nome: 'Imob' }),
        url: `/api/onboarding/organizacoes/${ORG}`, method: 'PATCH', corpo: { nome: 'Imob' },
        status: 204, espera: undefined,
      },
      {
        chamar: () => api.criarConviteApi({ email: 'a@b.com', papel: 'gestor' }), url: '/api/onboarding/convites', method: 'POST',
        corpo: { email: 'a@b.com', papel: 'gestor' }, resposta: { id: PERFIL, token: 'tk', expires_in_days: 7 },
      },
      {
        chamar: () => api.aceitarConviteApi('tk'), url: '/api/onboarding/convites/aceitar', method: 'POST',
        corpo: { token: 'tk' }, resposta: { organization_id: ORG, papel: 'corretor' },
      },
    ];
    for (const [i, c] of casos.entries()) {
      fetchMock.mockResolvedValueOnce(
        (c.status ?? 200) === 204 ? vazio(204) : json('resposta' in c ? c.resposta : {}, c.status ?? 200),
      );
      const r = await c.chamar();
      const feita = chamada(i);
      expect(feita.url, c.url).toBe(`${BASE}${c.url}`);
      expect(feita.method, c.url).toBe(c.method);
      expect(feita.corpo, c.url).toEqual(c.corpo);
      expect(feita.headers.Authorization).toBe('Bearer tok');
      expect(r, c.url).toEqual('espera' in c ? c.espera : c.resposta);
    }
    expect(fetchMock).toHaveBeenCalledTimes(casos.length);
  });

  it('o id da organização e a chave de cota vão com encodeURIComponent', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(vazio(204));
    await api.atualizarOrganizacaoOnboardingApi('a/b c', { nome: 'x' });
    expect(chamada(0).url).toBe(`${BASE}/api/onboarding/organizacoes/a%2Fb%20c`);
    fetchMock.mockResolvedValue(json({ permitido: false, usado: 0, limite: 0, ilimitado: false, habilitado: false }));
    await api.cotaApi('a/b');
    expect(chamada(1).url).toBe(`${BASE}/api/assinatura/cota/a%2Fb`);
  });

  it('contexto do onboarding com 503 vira null, e 500 vira ErroApi', async () => {
    const api = await carregarCliente();
    const { ErroApi } = await import('./http');
    fetchMock.mockResolvedValueOnce(json({ codigo: 'onboarding_indisponivel', message: 'Onboarding temporariamente indisponível.' }, 503));
    await expect(api.contextoOnboardingApi()).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(api.contextoOnboardingApi()).rejects.toBeInstanceOf(ErroApi);
  });

  it('registrar evento com 503 resolve calado, e 400 vira ErroApi com o texto do corpo', async () => {
    const api = await carregarCliente();
    const { ErroApi } = await import('./http');
    fetchMock.mockResolvedValueOnce(json({ codigo: 'onboarding_indisponivel' }, 503));
    await expect(api.registrarEventoOnboardingApi('persona_selected')).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(json({ codigo: 'evento_invalido', message: 'Este evento de onboarding não existe.' }, 400));
    const erro = await api.registrarEventoOnboardingApi('x').catch((e) => e as InstanceType<typeof ErroApi>);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro!.status).toBe(400);
    expect(erro!.message).toBe('Este evento de onboarding não existe.');
  });

  it('perfil e organização mandam só as chaves da allowlist', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValue(vazio(204));
    await api.atualizarPerfilOnboardingApi({ nome: 'Ana', corretor_id: CORRETOR, user_id: 'x', creci_status: 'validado' });
    expect(chamada(0).corpo).toEqual({ nome: 'Ana', creci_status: 'validado' });
    await api.atualizarOrganizacaoOnboardingApi(ORG, { nome: 'Imob', name: 'Imob', id: ORG, tipo_operacao: ['venda'] });
    expect(chamada(1).corpo).toEqual({ nome: 'Imob', tipo_operacao: ['venda'] });
  });

  it('conta antiga devolve o booleano do corpo', async () => {
    const api = await carregarCliente();
    fetchMock.mockResolvedValueOnce(json({ sem_limite: false }));
    await expect(api.contaAntigaSemLimiteApi()).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(json({ sem_limite: true }));
    await expect(api.contaAntigaSemLimiteApi()).resolves.toBe(true);
  });

  it('campanha devolve null com corpo null e lança campanha_ambigua no 409', async () => {
    const api = await carregarCliente();
    const { ErroApi } = await import('./http');
    fetchMock.mockResolvedValueOnce(json(null));
    await expect(api.campanhaAtivaApi()).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(json({ codigo: 'campanha_ambigua', message: 'Há mais de uma campanha ativa. Avise o suporte.' }, 409));
    const erro = await api.campanhaAtivaApi().catch((e) => e as InstanceType<typeof ErroApi>);
    expect(erro).toBeInstanceOf(ErroApi);
    expect((erro as InstanceType<typeof ErroApi>).codigo).toBe('campanha_ambigua');
    expect((erro as InstanceType<typeof ErroApi>).status).toBe(409);
  });
});

// ── Adaptadores das telas ────────────────────────────────────────────────

const USO = {
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  contadores: [
    {
      id: 'u1', corretor_id: CORRETOR, feature_key: 'max_imoveis', used_quantity: 99,
      period_start: '2026-10-01', period_end: '2026-10-31', created_at: 'x', updated_at: 'x',
    },
    {
      id: 'u2', corretor_id: CORRETOR, feature_key: 'leads_qualificados_monthly', used_quantity: 7,
      period_start: '2026-10-01', period_end: '2026-10-31', created_at: 'x', updated_at: 'x',
    },
  ],
  ativos: { max_imoveis: 2, max_contratos_locacao: 1, max_fachadas: 0 },
};

/** Responde por caminho; qualquer rota não listada volta `null`. */
function roteador(rotas: Record<string, { corpo?: unknown; status?: number }>) {
  return vi.fn(async (url: string) => {
    const caminho = url.replace(BASE, '');
    const r = rotas[caminho];
    if (!r) return json(null);
    return (r.status ?? 200) === 204 ? vazio(204) : json(r.corpo ?? null, r.status ?? 200);
  });
}

async function carregarHooks(comApi: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', comApi ? BASE : '');
  const store = await import('@/stores/crmStore');
  const assinatura = await import('@/hooks/useSubscription');
  const onboarding = await import('@/hooks/useOnboarding');
  store.useCRMStore.setState({ corretor: { id: CORRETOR } as never });
  return { ...assinatura, ...onboarding };
}

function montar<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(hook, { wrapper }).result;
}

describe('adaptadores de useSubscription com a API', () => {
  it('useAllPlans junta planos e entitlements das duas rotas', async () => {
    const hooks = await carregarHooks(true);
    vi.stubGlobal('fetch', roteador({
      '/api/planos': { corpo: [{ id: PLANO, code: 'essencial', display_order: 1 }] },
      '/api/planos/entitlements': {
        corpo: [{ id: 'e1', plan_id: PLANO, feature_key: 'max_imoveis' }, { id: 'e2', plan_id: 'outro', feature_key: 'max_users' }],
      },
    }));
    const r = montar(() => hooks.useAllPlans());
    await waitFor(() => expect(r.current.data).toBeTruthy());
    expect(r.current.data).toHaveLength(1);
    expect(r.current.data![0].entitlements.map((e) => e.id)).toEqual(['e1']);
    expect(from).not.toHaveBeenCalled();
  });

  it('useUsage monta os três ativos sobre os contadores da rota', async () => {
    const hooks = await carregarHooks(true);
    vi.stubGlobal('fetch', roteador({ '/api/assinatura/uso': { corpo: USO } }));
    const r = montar(() => hooks.useUsage());
    await waitFor(() => expect(r.current.data).toBeTruthy());
    const porChave = Object.fromEntries(r.current.data!.map((c) => [c.feature_key, c]));
    // contador que já existia é sobrescrito pela contagem viva, sem id sintético
    expect(porChave.max_imoveis.used_quantity).toBe(2);
    expect(porChave.max_imoveis.id).toBe('u1');
    // os que não existiam entram como sintéticos, com o período do servidor
    expect(porChave.max_contratos_locacao).toMatchObject({
      id: 'active:max_contratos_locacao', used_quantity: 1, corretor_id: CORRETOR,
      period_start: '2026-10-01', period_end: '2026-10-31',
    });
    expect(porChave.max_fachadas).toMatchObject({ id: 'active:max_fachadas', used_quantity: 0 });
    // contador mensal que não é dos três ativos fica como veio
    expect(porChave.leads_qualificados_monthly.used_quantity).toBe(7);
    expect(from).not.toHaveBeenCalled();
  });

  it('assinatura, adicionais, campanha e conta antiga vêm das rotas, sem Supabase', async () => {
    const hooks = await carregarHooks(true);
    vi.stubGlobal('fetch', roteador({
      '/api/assinatura': { corpo: { id: ASSINATURA, plan_id: PLANO, status: 'active' } },
      '/api/assinatura/addons': { corpo: [{ id: 'a1', addon_code: 'extra_user', quantity: 2, status: 'active' }] },
      '/api/planos/campanha': { corpo: { id: 'camp', active: true } },
      '/api/assinatura/conta-antiga': { corpo: { sem_limite: true } },
    }));
    const assinaturaR = montar(() => hooks.useCurrentSubscription());
    const addonsR = montar(() => hooks.useAddons());
    const campanhaR = montar(() => hooks.useActiveCampaign());
    const antigaR = montar(() => hooks.useContaAntigaSemLimite());
    await waitFor(() => expect(assinaturaR.current.data?.id).toBe(ASSINATURA));
    await waitFor(() => expect(addonsR.current.data?.[0]?.addon_code).toBe('extra_user'));
    await waitFor(() => expect(campanhaR.current.data?.id).toBe('camp'));
    await waitFor(() => expect(antigaR.current.data).toBe(true));
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('adaptadores de useOnboarding com a API', () => {
  it('o contexto vem da rota e passa pelo normalizador', async () => {
    const hooks = await carregarHooks(true);
    vi.stubGlobal('fetch', roteador({
      '/api/onboarding/contexto': { corpo: { profile: { id: PERFIL, persona: 'autonomo' }, progress: {}, evidence: {} } },
    }));
    const r = montar(() => hooks.useOnboarding());
    await waitFor(() => expect(r.current.contexto).toBeTruthy());
    expect(r.current.contexto!.profileId).toBe(PERFIL);
    expect(r.current.disponivel).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('503 no contexto mantém o silêncio de hoje: contexto null e sem erro', async () => {
    const hooks = await carregarHooks(true);
    vi.stubGlobal('fetch', roteador({ '/api/onboarding/contexto': { corpo: { codigo: 'onboarding_indisponivel' }, status: 503 } }));
    const r = montar(() => hooks.useOnboarding());
    await waitFor(() => expect(r.current.carregando).toBe(false));
    expect(r.current.contexto).toBeNull();
    expect(r.current.erro).toBeNull();
  });

  it('as mutações chamam as rotas; o perfil não pede mais auth.getUser()', async () => {
    const hooks = await carregarHooks(true);
    const fetchRota = roteador({
      '/api/onboarding/contexto': { corpo: { profile: { id: PERFIL }, progress: {}, evidence: {} } },
      '/api/onboarding/acoes': { corpo: { id: 'imovel-1' } },
      '/api/onboarding/perfil': { status: 204 },
      [`/api/onboarding/organizacoes/${ORG}`]: { status: 204 },
      '/api/onboarding/eventos': { status: 204 },
      '/api/onboarding/tours': { status: 204 },
      '/api/onboarding/checklist': { status: 204 },
      '/api/onboarding/convites': { corpo: { id: 'cv', token: 'tk', expires_in_days: 7 } },
      '/api/onboarding/convites/aceitar': { corpo: { organization_id: ORG, papel: 'corretor' } },
    });
    vi.stubGlobal('fetch', fetchRota);
    const r = montar(() => hooks.useOnboarding());
    await waitFor(() => expect(r.current.contexto).toBeTruthy());

    await expect(r.current.executarAcao.mutateAsync({ action: 'sample_client' })).resolves.toEqual({ id: 'imovel-1' });
    await r.current.atualizarPerfilProfissional.mutateAsync({ nome: 'Ana' });
    await r.current.atualizarOrganizacao.mutateAsync({ id: ORG, nome: 'Imob' });
    await r.current.registrarEvento('persona_selected', 'persona', { persona: 'autonomo' });
    await r.current.salvarTour('dashboard', 'concluido', 1);
    await r.current.salvarChecklist.mutateAsync({ minimized: true });
    await expect(r.current.criarConvite.mutateAsync({ email: 'a@b.com', papel: 'gestor' })).resolves.toMatchObject({ token: 'tk' });
    await expect(r.current.aceitarConvite.mutateAsync('tk')).resolves.toMatchObject({ organization_id: ORG });

    const caminhos = fetchRota.mock.calls.map((c) => (c[0] as string).replace(BASE, ''));
    for (const esperado of [
      '/api/onboarding/acoes', '/api/onboarding/perfil', `/api/onboarding/organizacoes/${ORG}`,
      '/api/onboarding/eventos', '/api/onboarding/tours', '/api/onboarding/checklist',
      '/api/onboarding/convites', '/api/onboarding/convites/aceitar',
    ]) expect(caminhos, esperado).toContain(esperado);
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});

describe('sem VITE_API_URL nada muda', () => {
  it('useSubscription e useOnboarding seguem no Supabase, sem nenhum fetch', async () => {
    const hooks = await carregarHooks(false);
    const fetchRota = vi.fn(async () => json(null));
    vi.stubGlobal('fetch', fetchRota);
    const planos = montar(() => hooks.useAllPlans());
    const uso = montar(() => hooks.useUsage());
    const assinaturaR = montar(() => hooks.useCurrentSubscription());
    const antigaR = montar(() => hooks.useContaAntigaSemLimite());
    const onboardingR = montar(() => hooks.useOnboarding());
    await waitFor(() => expect(planos.current.data).toBeTruthy());
    await waitFor(() => expect(uso.current.data).toBeTruthy());
    await waitFor(() => expect(assinaturaR.current.isLoading).toBe(false));
    await waitFor(() => expect(antigaR.current.isLoading).toBe(false));
    await waitFor(() => expect(onboardingR.current.carregando).toBe(false));
    expect(fetchRota).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalled();
  });
});
