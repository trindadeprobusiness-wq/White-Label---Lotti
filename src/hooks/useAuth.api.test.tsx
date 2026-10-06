// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Com VITE_API_URL o login é o próprio da API e não existe sessão do Supabase:
// os efeitos pós-login e o cadastro precisam ir pela API.
const cliente = vi.hoisted(() => ({
  ouvinte: null as ((s: unknown) => void) | null,
  restaurar: vi.fn(async () => null),
  cadastrar: vi.fn(async (_dados: unknown): Promise<{ ok: boolean; erro?: string }> => ({ ok: true })),
}));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true }));
vi.mock('@/lib/api/auth', () => ({
  clienteAuth: {
    aoMudar: (cb: (s: unknown) => void) => { cliente.ouvinte = cb; return () => { cliente.ouvinte = null; }; },
    restaurar: () => cliente.restaurar(),
    cadastrar: (d: unknown) => cliente.cadastrar(d),
  },
}));
const registrarAtividadeApi = vi.hoisted(() => vi.fn(async () => undefined));
const reivindicarAtribuicaoApi = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/lib/api/perfil', () => ({ registrarAtividadeApi }));
vi.mock('@/lib/api/parceiros', () => ({ reivindicarAtribuicaoApi }));
const atribuicao = vi.hoisted(() => ({
  deveRegistrarAtividade: vi.fn(() => true),
  marcarAtividadeRegistrada: vi.fn(),
  obterVisitanteId: vi.fn(() => 'visitante-1'),
  temAtribuicaoPendente: vi.fn(() => true),
  limparAtribuicaoPendente: vi.fn(),
}));
vi.mock('@/lib/admin/atribuicao', () => atribuicao);
const supa = vi.hoisted(() => ({
  rpc: vi.fn(), invoke: vi.fn(), signUp: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { signUp: supa.signUp }, rpc: supa.rpc, functions: { invoke: supa.invoke } },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AuthProvider, useAuth } from './useAuth';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, createElement(AuthProvider, null, children));
}

const sessao = (id: string) => ({ access_token: 'acc', user: { id, email: `${id}@x.com` } });

beforeEach(() => {
  vi.clearAllMocks();
  cliente.ouvinte = null;
  atribuicao.deveRegistrarAtividade.mockReturnValue(true);
  atribuicao.temAtribuicaoPendente.mockReturnValue(true);
});

describe('useAuth com a API — efeitos pós-login', () => {
  it('quando alguém entra: registra atividade e reivindica a indicação pela API, uma vez', async () => {
    renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(cliente.ouvinte).toBeTypeOf('function'));

    await act(async () => { cliente.ouvinte!(sessao('u1')); });
    await waitFor(() => expect(registrarAtividadeApi).toHaveBeenCalledWith('login', window.location.pathname));
    await waitFor(() => expect(reivindicarAtribuicaoApi).toHaveBeenCalledWith('visitante-1'));
    await waitFor(() => expect(atribuicao.limparAtribuicaoPendente).toHaveBeenCalled());
    expect(atribuicao.marcarAtividadeRegistrada).toHaveBeenCalled();

    // Refresh do token (mesmo usuário) não repete os efeitos.
    await act(async () => { cliente.ouvinte!(sessao('u1')); });
    expect(registrarAtividadeApi).toHaveBeenCalledTimes(1);
    expect(reivindicarAtribuicaoApi).toHaveBeenCalledTimes(1);
    // Nada pelo Supabase: sem sessão dele, o rpc e a Edge Function falhariam.
    expect(supa.rpc).not.toHaveBeenCalled();
    expect(supa.invoke).not.toHaveBeenCalled();
  });

  it('saiu e entrou outra pessoa: os efeitos rodam de novo', async () => {
    renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(cliente.ouvinte).toBeTypeOf('function'));
    await act(async () => { cliente.ouvinte!(sessao('u1')); });
    await act(async () => { cliente.ouvinte!(null); });
    await act(async () => { cliente.ouvinte!(sessao('u2')); });
    await waitFor(() => expect(registrarAtividadeApi).toHaveBeenCalledTimes(2));
  });

  it('falha da telemetria não derruba a sessão', async () => {
    registrarAtividadeApi.mockRejectedValueOnce(new Error('rede'));
    reivindicarAtribuicaoApi.mockRejectedValueOnce(new Error('rede'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(cliente.ouvinte).toBeTypeOf('function'));
    await act(async () => { cliente.ouvinte!(sessao('u1')); });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(atribuicao.limparAtribuicaoPendente).not.toHaveBeenCalled();
  });
});

describe('useAuth com a API — cadastro', () => {
  it('signUp vai para /api/auth/cadastro e já entra (sem confirmar e-mail)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    let r: Awaited<ReturnType<typeof result.current.signUp>> | undefined;
    await act(async () => {
      r = await result.current.signUp('nova@x.com', 'segredo1', { nome: 'Nova', cnpj: '11.222.333/0001-81', telefone: '(62) 99999-0000' });
    });
    expect(cliente.cadastrar).toHaveBeenCalledWith({
      email: 'nova@x.com', senha: 'segredo1', nome: 'Nova', cnpj: '11.222.333/0001-81', telefone: '(62) 99999-0000',
    });
    expect(r).toEqual({ ok: true, precisaConfirmarEmail: false });
    expect(supa.signUp).not.toHaveBeenCalled();
  });

  it('erro do cadastro chega com o texto da API', async () => {
    cliente.cadastrar.mockResolvedValueOnce({ ok: false, erro: 'Não foi possível criar a conta com este e-mail.' });
    const { result } = renderHook(() => useAuth(), { wrapper });
    let r: Awaited<ReturnType<typeof result.current.signUp>> | undefined;
    await act(async () => { r = await result.current.signUp('a@x.com', 'segredo1', { nome: 'A', cnpj: 'x', telefone: 'y' }); });
    expect(r).toEqual({ ok: false, erro: 'Não foi possível criar a conta com este e-mail.', precisaConfirmarEmail: false });
  });
});

describe('useAuth com a API — login social', () => {
  it('entrarCom não abre o OAuth do Supabase (sessão que o app não veria) e explica', async () => {
    const signInWithOAuth = vi.fn();
    const { supabase } = await import('@/integrations/supabase/client');
    (supabase.auth as unknown as Record<string, unknown>).signInWithOAuth = signInWithOAuth;
    const { result } = renderHook(() => useAuth(), { wrapper });
    let r: Awaited<ReturnType<typeof result.current.entrarCom>> | undefined;
    await act(async () => { r = await result.current.entrarCom('google'); });
    expect(r?.ok).toBe(false);
    expect(r?.erro).toMatch(/e-mail e senha/);
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
});
