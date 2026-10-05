import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from, rpc } }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn(), listarAlertasApi: vi.fn(), marcarAlertasLidosApi: vi.fn() }));
vi.mock('@/lib/api/contratos', () => ({ listarContratosApi: vi.fn(), criarContratoApi: vi.fn() }));

import { criarContratoApi, listarContratosApi } from '@/lib/api/contratos';
import { useCRMStore } from './crmStore';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  useCRMStore.setState({ contratos: [] });
});

describe('crmStore: contratos pela API Lotti', () => {
  it('fetchContratos lê pela API e não toca no Supabase', async () => {
    vi.mocked(listarContratosApi).mockResolvedValue([{ id: ID, tipo: 'COMPRA_VENDA' }]);
    await useCRMStore.getState().fetchContratos();
    expect(useCRMStore.getState().contratos).toEqual([{ id: ID, tipo: 'COMPRA_VENDA' }]);
    expect(from).not.toHaveBeenCalled();
  });

  it('fetchContratos com erro só registra no console', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(listarContratosApi).mockRejectedValue(new Error('falhou'));
    await useCRMStore.getState().fetchContratos();
    expect(useCRMStore.getState().contratos).toEqual([]);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('addContrato cria pela API como RASCUNHO, devolve o id e não chama rpc nem from', async () => {
    vi.mocked(criarContratoApi).mockResolvedValue({ id: ID });
    vi.mocked(listarContratosApi).mockResolvedValue([]);
    const contrato = { tipo: 'COMPRA_VENDA', valor: 100, data_inicio: '2026-10-05', conteudo: 'x', status: 'VIGENTE', versao: 1, modelo_ia: 'm', tempo_geracao_ms: 2 };
    const id = await useCRMStore.getState().addContrato(contrato as never);
    expect(id).toBe(ID);
    expect(criarContratoApi).toHaveBeenCalledWith({ ...contrato, status: 'RASCUNHO' });
    expect(listarContratosApi).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('addContrato com erro devolve null', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(criarContratoApi).mockRejectedValue(new Error('400'));
    expect(await useCRMStore.getState().addContrato({} as never)).toBeNull();
    erro.mockRestore();
  });
});
