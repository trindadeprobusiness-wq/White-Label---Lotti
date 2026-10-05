// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn(), listarAlertasApi: vi.fn(), marcarAlertasLidosApi: vi.fn() }));
vi.mock('@/lib/api/crm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/crm')>()), // mantém CHAVES_*
  listarEtapasApi: vi.fn(), listarOportunidadesApi: vi.fn(), listarTarefasApi: vi.fn(),
  moverOportunidadeApi: vi.fn(), excluirOportunidadesApi: vi.fn(), criarOportunidadeApi: vi.fn(),
  buscarCandidatosApi: vi.fn(), registrarHistoricoApi: vi.fn(), atualizarClienteApi: vi.fn(),
  concluirTarefaApi: vi.fn(), criarTarefaApi: vi.fn(), converterLeadApi: vi.fn(),
  listarClientesApi: vi.fn().mockResolvedValue([]),
}));

import { chamarApi } from '@/lib/api';
import * as crmApi from '@/lib/api/crm';
import { ErroApi } from '@/lib/api/http';
import { useCRMStore } from '@/stores/crmStore';
import {
  useClientesParecidos, useConverterLead, useCriarOportunidade, useCriarTarefa, useEtapas, useExcluirOportunidades,
  useModoCrm, useMoverOportunidade, useRegistrarContatoWhatsApp,
} from './useCrm';

const api = vi.mocked(crmApi);
const ETAPA = '11111111-1111-4111-8111-111111111111';
const NEGOCIO = '22222222-2222-4222-8222-222222222222';
const CLIENTE = '33333333-3333-4333-8333-333333333333';
const LEAD = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  useCRMStore.setState({ fetchClientes: vi.fn(async () => undefined) });
});

function montar<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(hook, { wrapper }).result;
}

describe('useCrm com a API Lotti', () => {
  it("modo é 'completo' sem nenhuma chamada de rede", async () => {
    const r = montar(() => useModoCrm());
    await waitFor(() => expect(r.current.data).toBe('completo'));
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('etapas vêm da API', async () => {
    api.listarEtapasApi.mockResolvedValue([{ id: ETAPA, corretor_id: 'c', nome: 'Novo', ordem: 1, cor: 'blue', tipo: 'ABERTA', ativo: true }]);
    const r = montar(() => useEtapas());
    await waitFor(() => expect(r.current.data?.[0]?.id).toBe(ETAPA));
  });

  it('mover com 409 CONFLITO avisa com toast.warning', async () => {
    api.moverOportunidadeApi.mockRejectedValue(new ErroApi(409, 'CONFLITO', 'CONFLITO'));
    const r = montar(() => ({ modo: useModoCrm(), mover: useMoverOportunidade() }));
    await waitFor(() => expect(r.current.modo.data).toBe('completo'));
    const args = { id: NEGOCIO, etapaId: ETAPA, ordem: 2, updatedAt: '2026-10-04T12:34:56.123456+00:00' };
    await act(async () => { await r.current.mover.mutateAsync(args).catch(() => undefined); });
    expect(api.moverOportunidadeApi).toHaveBeenCalledWith(args);
    expect(toast.warning).toHaveBeenCalledWith('Este negócio foi movido em outro lugar. Recarreguei para você ver a posição atual.');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('excluir negócios vai pela API', async () => {
    api.excluirOportunidadesApi.mockResolvedValue({ excluidas: 1 });
    const r = montar(() => ({ modo: useModoCrm(), excluir: useExcluirOportunidades() }));
    await waitFor(() => expect(r.current.modo.data).toBe('completo'));
    await act(async () => { await r.current.excluir.mutateAsync([NEGOCIO]); });
    expect(api.excluirOportunidadesApi).toHaveBeenCalledWith([NEGOCIO]);
  });

  it('criar oportunidade e tarefa mandam só as chaves do DTO, sem corretor_id', async () => {
    api.criarOportunidadeApi.mockResolvedValue({ id: NEGOCIO });
    api.criarTarefaApi.mockResolvedValue({});
    const r = montar(() => ({ op: useCriarOportunidade(), tarefa: useCriarTarefa() }));
    await act(async () => {
      await r.current.op.mutateAsync({ id: 'x', corretor_id: 'y', etapa_id: ETAPA, titulo: 'Venda', updated_at: 't' } as never);
      await r.current.tarefa.mutateAsync({ id: 'x', corretor_id: 'y', titulo: 'Ligar', concluida: false } as never);
    });
    expect(api.criarOportunidadeApi).toHaveBeenCalledWith({ etapa_id: ETAPA, titulo: 'Venda' });
    expect(api.criarTarefaApi).toHaveBeenCalledWith({ titulo: 'Ligar' });
  });

  it('registrar contato por WhatsApp grava o histórico e atualiza o último contato em melhor esforço', async () => {
    api.registrarHistoricoApi.mockResolvedValue({});
    api.atualizarClienteApi.mockRejectedValue(new ErroApi(404, 'cliente_nao_encontrado', 'Cliente não encontrado.'));
    const r = montar(() => useRegistrarContatoWhatsApp());
    await act(async () => { await r.current.mutateAsync({ clienteId: CLIENTE, mensagem: 'x'.repeat(600) }); });
    expect(api.registrarHistoricoApi).toHaveBeenCalledWith(CLIENTE, {
      tipo: 'WHATSAPP', direcao: 'OUT', conteudo: 'x'.repeat(500), metadata: { tipo_ui: 'WHATSAPP', via: 'wa.me' },
    });
    expect(api.atualizarClienteApi).toHaveBeenCalledWith(CLIENTE, { ultimo_contato: expect.any(String) });
    expect(toast.success).toHaveBeenCalledWith('Contato registrado no histórico.');
  });

  it('candidatos parecidos vêm da API, filtrados por candidatosValidos', async () => {
    api.buscarCandidatosApi.mockResolvedValue([{ id: CLIENTE, nome: 'Ana', motivo: 'telefone' }, { id: 1 }]);
    const r = montar(() => useClientesParecidos({ telefone: '(62) 91111-0002', email: 'x', cpf: '' }));
    await waitFor(() => expect(r.current.data).toEqual([{ id: CLIENTE, nome: 'Ana', motivo: 'telefone' }]));
    expect(api.buscarCandidatosApi).toHaveBeenCalledWith({ telefone: '62911110002', email: null, cpf: null });
  });

  it('converter lead vai pela API com a etapa e mostra o texto do forbidden', async () => {
    api.converterLeadApi.mockRejectedValueOnce(new ErroApi(403, 'forbidden', 'forbidden'));
    const r = montar(() => ({ modo: useModoCrm(), converter: useConverterLead() }));
    await waitFor(() => expect(r.current.modo.data).toBe('completo'));
    const lead = { id: LEAD, nome: '  Maria   Lead ', telefone: '62911110002', email: 'Maria@Example.test' };
    await act(async () => { await r.current.converter.mutateAsync({ lead, etapaId: ETAPA }).catch(() => undefined); });
    expect(api.converterLeadApi).toHaveBeenCalledWith({
      lead_id: LEAD, etapa_id: ETAPA, nome: 'Maria Lead', telefone: '(62) 91111-0002', email: 'maria@example.test', cliente_id: null,
    });
    expect(toast.error).toHaveBeenCalledWith('Este lead não é de uma fachada sua, ou o cliente escolhido é de outra conta.');

    api.converterLeadApi.mockResolvedValueOnce({ status: 'converted', cliente_id: CLIENTE, created: true, oportunidade_id: NEGOCIO });
    await act(async () => { await r.current.converter.mutateAsync({ lead, etapaId: ETAPA, clienteExistente: CLIENTE }); });
    expect(api.converterLeadApi).toHaveBeenLastCalledWith(expect.objectContaining({ cliente_id: CLIENTE }));
    expect(toast.success).toHaveBeenCalledWith('Lead convertido em cliente e oportunidade.');
  });
});
