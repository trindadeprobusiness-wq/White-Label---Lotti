import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import { useCRMStore } from '@/stores/crmStore';
import { isolarTrocaDeSessao } from './isolamentoSessao';

describe('isolamento de cache entre sessões', () => {
  beforeEach(() => {
    useCRMStore.getState().limparDadosDaSessao();
  });

  it('apaga indicadores e dados em memória ao trocar de usuário', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['rental-kpis'], { totalReceivable: 30_980 });
    useCRMStore.setState({
      corretor: { id: 'corretor-a', nome: 'Conta A' } as never,
      contratos: [{ id: 'contrato-a', valor: 30_980 }] as never,
    });

    expect(isolarTrocaDeSessao('usuario-a', 'usuario-b', queryClient)).toBe(true);
    expect(queryClient.getQueryData(['rental-kpis'])).toBeUndefined();
    expect(useCRMStore.getState().corretor).toBeNull();
    expect(useCRMStore.getState().contratos).toEqual([]);
  });

  it('não limpa no refresh de token do mesmo usuário nem na descoberta inicial', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['rental-kpis'], { totalReceivable: 100 });

    expect(isolarTrocaDeSessao(undefined, 'usuario-a', queryClient)).toBe(false);
    expect(isolarTrocaDeSessao('usuario-a', 'usuario-a', queryClient)).toBe(false);
    expect(queryClient.getQueryData(['rental-kpis'])).toEqual({ totalReceivable: 100 });
  });

  it('limpa também no logout', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['asaas-connection'], { conta: 'conta-a' });

    expect(isolarTrocaDeSessao('usuario-a', null, queryClient)).toBe(true);
    expect(queryClient.getQueryData(['asaas-connection'])).toBeUndefined();
  });
});
