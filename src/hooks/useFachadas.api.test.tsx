// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ api: true }));
const sb = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

/** Qualquer encadeamento de `.from(...)` termina em { data: [], error: null }. */
function consulta(): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok, erro),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => consulta()) });
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...a: unknown[]) => { sb.from(...a); return consulta(); },
    rpc: (...a: unknown[]) => { sb.rpc(...a); return Promise.resolve({ data: 'corretor-1', error: null }); },
  },
}));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => estado.api, chamarApi: vi.fn() }));
vi.mock('@/lib/api/fachadas', async () => {
  const real = await vi.importActual<typeof import('@/lib/api/fachadas')>('@/lib/api/fachadas');
  return {
    CHAVES_CRIAR_FACHADA: real.CHAVES_CRIAR_FACHADA,
    CHAVES_EDITAR_FACHADA: real.CHAVES_EDITAR_FACHADA,
    listarFachadasApi: vi.fn(), criarFachadaApi: vi.fn(), editarFachadaApi: vi.fn(),
    excluirFachadaApi: vi.fn(), listarLeadsApi: vi.fn(), excluirLeadApi: vi.fn(),
    obterMetricasApi: vi.fn(),
  };
});

const toast = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => toast);

import * as fachadasApi from '@/lib/api/fachadas';
import { useFachadas } from './useFachadas';

const api = vi.mocked(fachadasApi);
const FACHADA = '11111111-1111-4111-8111-111111111111';
const IMOVEL = '44444444-4444-4444-8444-444444444444';
const OUTRO_IMOVEL = '66666666-6666-4666-8666-666666666666';

const novaFachada = {
  imovel_id: IMOVEL, tipo_negocio: 'VENDA' as const, template_id: 'venda-classica',
  cta_principal: 'WHATSAPP' as const, modo_conversao: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  estado.api = true;
  api.listarFachadasApi.mockResolvedValue([]);
  api.listarLeadsApi.mockResolvedValue([]);
});

describe('useFachadas com a API ligada', () => {
  it('fetchFachadas usa F1 e troca null por undefined, sem tocar o Supabase', async () => {
    api.listarFachadasApi.mockResolvedValue([
      { id: FACHADA, imovel: null, corretor: { nome: 'Ana' } },
    ]);
    const { result } = renderHook(() => useFachadas());
    await act(async () => { await result.current.fetchFachadas(); });
    expect(api.listarFachadasApi).toHaveBeenCalledTimes(1);
    expect(result.current.fachadas[0]).toMatchObject({ id: FACHADA, corretor: { nome: 'Ana' } });
    expect(result.current.fachadas[0].imovel).toBeUndefined();
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('createFachada manda só as chaves aceitas, devolve o id e refaz a lista', async () => {
    api.criarFachadaApi.mockResolvedValue({ id: FACHADA });
    const { result } = renderHook(() => useFachadas());
    let id: string | null = null;
    await act(async () => { id = await result.current.createFachada(novaFachada); });
    expect(id).toBe(FACHADA);
    expect(api.criarFachadaApi).toHaveBeenCalledWith(novaFachada);
    expect(api.listarFachadasApi).toHaveBeenCalledTimes(1);
    // As três consultas do ramo antigo (get_corretor_id + imovel_fotos) somem.
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(sb.from).not.toHaveBeenCalled();
    expect(toast.toast).toHaveBeenCalledWith({ title: 'Fachada criada com sucesso!' });
  });

  it('createFachada mostra o message da API no toast de erro', async () => {
    api.criarFachadaApi.mockRejectedValue(Object.assign(new Error(
      'Limite de Fachadas Inteligentes atingido. Acesse Plano e Assinatura para liberar mais fachadas.',
    ), { codigo: 'PLAN_LIMIT_REACHED' }));
    const { result } = renderHook(() => useFachadas());
    let id: string | null = FACHADA;
    await act(async () => { id = await result.current.createFachada(novaFachada); });
    expect(id).toBeNull();
    expect(toast.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive',
      description: 'Limite de Fachadas Inteligentes atingido. Acesse Plano e Assinatura para liberar mais fachadas.',
    }));
  });

  it('updateFachada descarta as chaves que a rota não aceita', async () => {
    api.editarFachadaApi.mockResolvedValue({ id: FACHADA });
    const { result } = renderHook(() => useFachadas());
    await act(async () => {
      await result.current.updateFachada(FACHADA, {
        id: FACHADA, corretor_id: 'c1', imovel_id: IMOVEL, ativo: false,
        total_leads: 3, created_at: 'x', cta_principal: 'WHATSAPP',
      } as never);
    });
    expect(api.editarFachadaApi).toHaveBeenCalledWith(FACHADA, { ativo: false, cta_principal: 'WHATSAPP' });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('trocar o imóvel de uma fachada já criada falha com texto claro, não em silêncio', async () => {
    // O diálogo de edição manda imovel_id sempre, e F3 não aceita a coluna. Sem este aviso a troca
    // era descartada e a tela dizia "Fachada atualizada!" — enquanto o ramo antigo trocava de verdade.
    api.listarFachadasApi.mockResolvedValue([{ id: FACHADA, imovel_id: IMOVEL }]);
    api.editarFachadaApi.mockResolvedValue({ id: FACHADA });
    const { result } = renderHook(() => useFachadas());
    await act(async () => { await result.current.fetchFachadas(); });

    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.updateFachada(FACHADA, { imovel_id: OUTRO_IMOVEL } as never); });
    expect(ok).toBe(false);
    expect(api.editarFachadaApi).not.toHaveBeenCalled();
    expect(toast.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive', title: 'O imóvel desta fachada não pode ser trocado',
    }));

    // Mandar o MESMO imovel_id (o caso normal do diálogo) segue passando.
    await act(async () => { ok = await result.current.updateFachada(FACHADA, { imovel_id: IMOVEL, ativo: false } as never); });
    expect(ok).toBe(true);
    expect(api.editarFachadaApi).toHaveBeenCalledWith(FACHADA, { ativo: false });
  });

  it('deleteFachada usa F4', async () => {
    api.excluirFachadaApi.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFachadas());
    await act(async () => { await result.current.deleteFachada(FACHADA); });
    expect(api.excluirFachadaApi).toHaveBeenCalledWith(FACHADA);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('fetchLeads e deleteLead usam F5 e F6', async () => {
    api.listarLeadsApi.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]);
    api.excluirLeadApi.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFachadas());
    await act(async () => { await result.current.fetchLeads(FACHADA); });
    expect(api.listarLeadsApi).toHaveBeenCalledWith(FACHADA);
    expect(result.current.leads.map((l) => l.id)).toEqual(['l1', 'l2']);
    await act(async () => { await result.current.deleteLead('l1'); });
    expect(api.excluirLeadApi).toHaveBeenCalledWith('l1');
    expect(result.current.leads.map((l) => l.id)).toEqual(['l2']);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('fetchMetricas põe no estado exatamente o objeto que F7 devolveu', async () => {
    const metricas = {
      totalFachadas: 3, totalEscaneamentos: 42, totalLeads: 7, taxaConversao: 17,
      fachadasMaisAcessadas: [], leadsPorDia: [{ data: '2026-09-20', leads: 1, escaneamentos: 5 }],
    };
    api.obterMetricasApi.mockResolvedValue(metricas);
    const { result } = renderHook(() => useFachadas());
    await act(async () => { await result.current.fetchMetricas(90); });
    expect(api.obterMetricasApi).toHaveBeenCalledWith(90);
    expect(result.current.metricas).toEqual(metricas);
    expect(sb.from).not.toHaveBeenCalled();
  });
});

describe('useFachadas sem VITE_API_URL: igual a hoje', () => {
  beforeEach(() => { estado.api = false; });

  it('todas as operações voltam ao Supabase e nenhuma chamada à API acontece', async () => {
    const { result } = renderHook(() => useFachadas());
    await act(async () => { await result.current.fetchFachadas(); });
    expect(sb.from).toHaveBeenCalledWith('fachadas');

    await act(async () => { await result.current.fetchLeads(FACHADA); });
    expect(sb.from).toHaveBeenCalledWith('fachada_leads');

    await act(async () => { await result.current.deleteLead('l1'); });
    await act(async () => { await result.current.deleteFachada(FACHADA); });
    await act(async () => { await result.current.updateFachada(FACHADA, { ativo: false }); });
    await act(async () => { await result.current.fetchMetricas(30); });
    expect(sb.from).toHaveBeenCalledWith('fachada_escaneamentos');

    await act(async () => { await result.current.createFachada(novaFachada); });
    expect(sb.rpc).toHaveBeenCalledWith('get_corretor_id');
    expect(sb.from).toHaveBeenCalledWith('imovel_fotos');

    for (const fn of [
      api.listarFachadasApi, api.criarFachadaApi, api.editarFachadaApi, api.excluirFachadaApi,
      api.listarLeadsApi, api.excluirLeadApi, api.obterMetricasApi,
    ]) expect(fn).not.toHaveBeenCalled();
  });
});
