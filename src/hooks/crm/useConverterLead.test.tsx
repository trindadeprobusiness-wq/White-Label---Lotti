// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn(), legado: false }));
const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: banco.rpc,
    from: () => {
      const consulta = {
        select: () => consulta, order: () => consulta, eq: () => consulta,
        limit: () => Promise.resolve(banco.legado ? { data: null, error: { code: '42P01' } } : { data: [], error: null }),
        insert: banco.insert,
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return consulta;
    },
  },
}));

import { useConverterLead, useModoCrm } from './useCrm';
import { useCRMStore } from '@/stores/crmStore';

const lead = { id: 'lead-1', nome: '  Maria   Lead ', telefone: '62911110002', email: 'Maria@Example.test' };
const fetchClientes = vi.fn(async () => undefined);

beforeEach(() => {
  banco.rpc.mockReset(); banco.insert.mockReset(); banco.legado = false; fetchClientes.mockClear();
  Object.values(toast).forEach((f) => f.mockReset());
  useCRMStore.setState({ fetchClientes });
});

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({ modo: useModoCrm(), converter: useConverterLead() }), { wrapper });
  return { result, invalidate };
}

it('converte só pela RPC transacional, com os dados limpos e sem insert direto', async () => {
  banco.rpc.mockResolvedValue({ data: { status: 'converted', cliente_id: 'c1', created: true, oportunidade_id: 'o1' }, error: null });
  const { result, invalidate } = montar();
  await waitFor(() => expect(result.current.modo.data).toBe('completo'));
  await act(() => result.current.converter.mutateAsync({ lead, etapaId: 'etapa-uuid' }));
  expect(banco.rpc).toHaveBeenCalledWith('crm_converter_lead', {
    p_lead: 'lead-1', p_etapa: 'etapa-uuid', p_cliente: null,
    p_dados: { nome: 'Maria Lead', telefone: '(62) 91111-0002', email: 'maria@example.test' },
  });
  expect(banco.insert).not.toHaveBeenCalled();
  expect(fetchClientes).toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crm'] });
  expect(toast.success).toHaveBeenCalledWith('Lead convertido em cliente e oportunidade.');
});

it('no modo legado não manda a etapa sintética, que não é uuid', async () => {
  banco.legado = true;
  banco.rpc.mockResolvedValue({ data: { status: 'converted', cliente_id: 'c1', created: true, oportunidade_id: null }, error: null });
  const { result } = montar();
  await waitFor(() => expect(result.current.modo.data).toBe('legado'));
  await act(() => result.current.converter.mutateAsync({ lead, etapaId: 'QUALIFICACAO' }));
  expect(banco.rpc).toHaveBeenCalledWith('crm_converter_lead', expect.objectContaining({ p_etapa: null }));
  expect(toast.success).toHaveBeenCalledWith('Lead convertido em cliente.');
});

it('vincular ao cliente existente e repetir a conversão não duplicam nada na tela', async () => {
  const { result } = montar();
  await waitFor(() => expect(result.current.modo.data).toBe('completo'));
  banco.rpc.mockResolvedValueOnce({ data: { status: 'converted', cliente_id: 'ana', created: false, oportunidade_id: 'o1' }, error: null });
  await act(() => result.current.converter.mutateAsync({ lead, etapaId: 'e', clienteExistente: 'ana' }));
  expect(banco.rpc).toHaveBeenLastCalledWith('crm_converter_lead', expect.objectContaining({ p_cliente: 'ana' }));
  expect(toast.success).toHaveBeenLastCalledWith('Lead vinculado ao cliente que já existia.');
  banco.rpc.mockResolvedValueOnce({ data: { status: 'ja_convertido', cliente_id: 'ana' }, error: null });
  await act(() => result.current.converter.mutateAsync({ lead, etapaId: 'e' }));
  expect(toast.info).toHaveBeenCalledWith('Este lead já tinha sido convertido.');
});

it('telefone já cadastrado: devolve os candidatos sem gravar nem avisar sucesso', async () => {
  banco.rpc.mockResolvedValue({ data: { status: 'duplicate', candidatos: [{ id: 'ana', nome: 'Ana', motivo: 'telefone' }] }, error: null });
  const { result } = montar();
  await waitFor(() => expect(result.current.modo.data).toBe('completo'));
  let resposta: unknown;
  await act(async () => { resposta = await result.current.converter.mutateAsync({ lead, etapaId: 'e' }); });
  expect(resposta).toEqual({ status: 'duplicate', candidatos: [{ id: 'ana', nome: 'Ana', motivo: 'telefone' }] });
  expect(toast.success).not.toHaveBeenCalled();
  expect(fetchClientes).not.toHaveBeenCalled();
});

it('explica em português quando o lead não é de uma fachada da conta', async () => {
  banco.rpc.mockResolvedValue({ data: null, error: { message: 'forbidden', code: 'P0001' } });
  const { result } = montar();
  await waitFor(() => expect(result.current.modo.data).toBe('completo'));
  await act(async () => { await result.current.converter.mutateAsync({ lead, etapaId: 'e' }).catch(() => undefined); });
  expect(toast.error).toHaveBeenCalledWith('Este lead não é de uma fachada sua, ou o cliente escolhido é de outra conta.');
});
