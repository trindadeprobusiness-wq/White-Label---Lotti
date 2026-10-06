// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAVE_SUPORTE } from '@/lib/admin/suporte';

// Modo API numa aba de atendimento: o usuário efetivo é o titular, e encerrar vai pela rota da API
// (com o token do administrador), nunca pela Edge nem pelo logout do administrador.
const cliente = vi.hoisted(() => ({
  ouvinte: null as ((s: unknown) => void) | null,
  logout: vi.fn(async () => {}),
}));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true }));
vi.mock('@/lib/api/auth', () => ({
  clienteAuth: {
    aoMudar: (cb: (s: unknown) => void) => { cliente.ouvinte = cb; return () => { cliente.ouvinte = null; }; },
    restaurar: async () => null,
    logout: () => cliente.logout(),
  },
}));
const encerrarSuporteApi = vi.hoisted(() => vi.fn(async (_id: string) => undefined));
vi.mock('@/lib/api/suporte', () => ({ encerrarSuporteApi }));
vi.mock('@/lib/api/perfil', () => ({ registrarAtividadeApi: vi.fn() }));
vi.mock('@/lib/api/parceiros', () => ({ reivindicarAtribuicaoApi: vi.fn() }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: {}, rpc: vi.fn(), functions: { invoke } } }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { AuthProvider, useAuth } from './useAuth';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, createElement(AuthProvider, null, children));
}

const atendimento = {
  id: 'sessao-1', corretor_id: 'corretor-1', nome: 'Conta Atendida', token: 'tok-atendimento',
  expira_em: new Date(Date.now() + 30 * 60_000).toISOString(), user: { id: 'titular-1', email: 'titular@x.com' },
};
const replace = vi.fn();
const locationOriginal = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  sessionStorage.setItem(CHAVE_SUPORTE, JSON.stringify(atendimento));
  Object.defineProperty(window, 'location', { configurable: true, value: { ...locationOriginal, replace } });
});
afterEach(() => { Object.defineProperty(window, 'location', { configurable: true, value: locationOriginal }); });

async function montar() {
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(cliente.ouvinte).toBeTypeOf('function'));
  await act(async () => { cliente.ouvinte!({ access_token: 'tok-admin', user: { id: 'admin-1' } }); });
  return hook;
}

describe('useAuth com a API — atendimento do backoffice', () => {
  it('o usuário efetivo é o titular; encerrar chama a rota da API e volta ao backoffice', async () => {
    const { result } = await montar();
    expect(result.current.user?.id).toBe('titular-1');
    await act(async () => { await result.current.signOut(); });
    expect(encerrarSuporteApi).toHaveBeenCalledWith('sessao-1');
    expect(invoke).not.toHaveBeenCalled();
    expect(cliente.logout).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHAVE_SUPORTE)).toBeNull();
    expect(replace).toHaveBeenCalledWith('/admin/onboarding');
  });

  it('falha ao encerrar com o atendimento ainda válido: avisa e mantém a sessão (como hoje)', async () => {
    encerrarSuporteApi.mockRejectedValueOnce(new Error('rede'));
    const { result } = await montar();
    await act(async () => { await result.current.signOut(); });
    expect(toast.error).toHaveBeenCalledWith('Não foi possível encerrar o atendimento. Tente novamente.');
    expect(sessionStorage.getItem(CHAVE_SUPORTE)).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });
});
