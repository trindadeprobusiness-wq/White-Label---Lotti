// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ api: true }));
const sb = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn();
  return { insert, from };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: sb.from } }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => estado.api, chamarApi: vi.fn() }));
vi.mock('@/lib/api/financeiro', () => ({
  listarLancamentosApi: vi.fn(), criarLancamentoApi: vi.fn(), alterarLancamentoApi: vi.fn(), excluirLancamentoApi: vi.fn(),
}));

import * as finApi from '@/lib/api/financeiro';
import { useCRMStore } from '@/stores/crmStore';
import { useFinanceiro } from './useFinanceiro';

const api = vi.mocked(finApi);
const novo = { tipo: 'DESPESA' as const, categoria: 'OUTROS' as never, descricao: 'Internet', valor: 100, data: '2026-01-31', recorrente: true };

beforeEach(() => {
  vi.clearAllMocks();
  estado.api = true;
  useCRMStore.setState({ corretor: { id: 'corretor-1' } as never });
  sb.insert.mockImplementation((linhas: Array<Record<string, unknown>>) => ({
    select: async () => ({ data: linhas.map((l, i) => ({ id: `l${i}`, ...l })), error: null }),
  }));
  sb.from.mockImplementation(() => ({ insert: sb.insert }));
});

describe('useFinanceiro', () => {
  it('com a API, lançamento recorrente é UMA chamada e nenhuma ao Supabase', async () => {
    api.criarLancamentoApi.mockResolvedValue([{ id: 'a', data: '2026-01-31' }, { id: 'b', data: '2026-02-28' }]);
    const { result } = renderHook(() => useFinanceiro());
    let primeiro: unknown;
    await act(async () => { primeiro = await result.current.addLancamento(novo); });
    expect(api.criarLancamentoApi).toHaveBeenCalledTimes(1);
    expect(api.criarLancamentoApi).toHaveBeenCalledWith(novo);
    expect(sb.from).not.toHaveBeenCalled();
    expect(primeiro).toEqual({ id: 'a', data: '2026-01-31' });
    expect(result.current.lancamentos.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('com a API, a lista usa os filtros em yyyy-MM-dd', async () => {
    api.listarLancamentosApi.mockResolvedValue([{ id: 'x' }]);
    const { result } = renderHook(() => useFinanceiro());
    await act(async () => {
      await result.current.fetchLancamentos({ tipo: 'RECEITA', dataInicio: new Date(2026, 0, 1), dataFim: new Date(2026, 0, 31) });
    });
    expect(api.listarLancamentosApi).toHaveBeenCalledWith({ tipo: 'RECEITA', categoria: undefined, de: '2026-01-01', ate: '2026-01-31' });
    expect(result.current.lancamentos).toEqual([{ id: 'x' }]);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('com a API, alterar e excluir vão pela API', async () => {
    api.alterarLancamentoApi.mockResolvedValue({ id: 'x', valor: 2 });
    api.excluirLancamentoApi.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFinanceiro());
    await act(async () => { await result.current.updateLancamento('x', { valor: 2 }); });
    await act(async () => { await result.current.deleteLancamento('x'); });
    expect(api.alterarLancamentoApi).toHaveBeenCalledWith('x', { valor: 2 });
    expect(api.excluirLancamentoApi).toHaveBeenCalledWith('x');
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('sem a API, o ramo do Supabase monta as 12 linhas como antes', async () => {
    estado.api = false;
    const { result } = renderHook(() => useFinanceiro());
    await act(async () => { await result.current.addLancamento(novo); });
    expect(api.criarLancamentoApi).not.toHaveBeenCalled();
    expect(sb.from).toHaveBeenCalledWith('lancamentos_financeiros');
    const linhas = sb.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(linhas).toHaveLength(12);
    expect(linhas[0]).toMatchObject({ corretor_id: 'corretor-1', data: '2026-01-31', status: 'pago', impacta_dre: true });
    expect(linhas[1]).toMatchObject({ data: '2026-02-28', descricao: 'Internet (2/12)' });
  });
});
