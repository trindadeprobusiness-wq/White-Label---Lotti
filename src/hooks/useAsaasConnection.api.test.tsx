// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sb = vi.hoisted(() => ({ from: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: sb.from, functions: { invoke: sb.invoke } } }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn() }));
vi.mock('@/lib/api/financeiro', () => ({ statusConexaoAsaasApi: vi.fn(), conectarAsaasApi: vi.fn(), desconectarAsaasApi: vi.fn() }));

import * as finApi from '@/lib/api/financeiro';
import { ErroApi } from '@/lib/api/http';
import { useAsaasConnection } from './useAsaasConnection';

const api = vi.mocked(finApi);

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useAsaasConnection(), { wrapper }).result;
}

beforeEach(() => vi.clearAllMocks());

describe('useAsaasConnection com a API', () => {
  it('status, conectar e desconectar vão pela API, sem Supabase', async () => {
    api.statusConexaoAsaasApi.mockResolvedValue({ disponivel: true, conexao: { id: 'cx', status: 'conectada' } });
    api.conectarAsaasApi.mockResolvedValue({ ok: true, balance: 1, aviso: null, conexao: {} });
    api.desconectarAsaasApi.mockResolvedValue({ ok: true, aviso: null });
    const r = montar();
    await waitFor(() => expect(r.current.conexao?.id).toBe('cx'));
    await act(async () => { await r.current.conectar.mutateAsync({ apiKey: 'k', ambiente: 'sandbox' }); });
    await act(async () => { await r.current.desconectar.mutateAsync(); });
    expect(api.conectarAsaasApi).toHaveBeenCalledWith('k', 'sandbox');
    expect(api.desconectarAsaasApi).toHaveBeenCalledTimes(1);
    expect(sb.from).not.toHaveBeenCalled();
    expect(sb.invoke).not.toHaveBeenCalled();
  });

  it('erro da API chega como Error com o texto em português', async () => {
    api.statusConexaoAsaasApi.mockResolvedValue({ disponivel: true, conexao: null });
    api.conectarAsaasApi.mockRejectedValue(new ErroApi(400, 'ASAAS_CHAVE_INVALIDA', 'A chave informada não é válida.'));
    const r = montar();
    await waitFor(() => expect(r.current.carregando).toBe(false));
    const erro = await r.current.conectar.mutateAsync({ apiKey: 'k', ambiente: 'producao' }).catch((e) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe('A chave informada não é válida.');
  });
});
