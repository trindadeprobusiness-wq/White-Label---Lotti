// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({ rpc: vi.fn(), inserts: [] as { tabela: string; dados: Record<string, unknown> }[], updates: [] as unknown[] }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/hooks/useSubscription', () => ({ useCheckLimit: () => () => ({}) }));
vi.mock('@/lib/planos', () => ({ podeCriarRecurso: () => true }));
vi.mock('./ContractUpload', () => ({
  ContractUpload: ({ onFileSelect }: { onFileSelect: (f: File) => void }) =>
    <button type="button" onClick={() => onFileSelect(new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' }))}>Escolher arquivo</button>,
}));
vi.mock('@/services/contractExtractionService', () => ({
  extractContractData: vi.fn(async () => ({
    inquilino: { nome: 'Ana S.', cpf: '123.456.789-09', telefone: '(62) 91111-0002 / (62) 3333-4444', email: null },
    proprietario_nome: 'Dono', imovel: { endereco: 'Rua 1, 100', bairro: 'Centro', cidade: 'Goiânia', tipo: 'CASA' },
    valor_aluguel: 1500, data_inicio: '2026-09-01', prazo_meses: 30, dia_vencimento: 10, taxa_administracao: 10, observacoes: null,
  })),
}));
vi.mock('@/integrations/supabase/client', () => {
  const consulta = (tabela: string) => {
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, order: () => Promise.resolve({ data: tabela === 'imoveis' ? [] : [{ id: 'homonimo', nome: 'Ana S.' }], error: null }),
      single: () => Promise.resolve({ data: { id: `${tabela}-novo` }, error: null }),
      insert: (dados: Record<string, unknown>) => { banco.inserts.push({ tabela, dados }); return q; },
      update: (dados: unknown) => { banco.updates.push(dados); return q; },
      is: () => Promise.resolve({ error: null }),
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
    };
    return q;
  };
  return {
    supabase: {
      rpc: (nome: string, args: unknown) => (nome === 'get_corretor_id' ? Promise.resolve({ data: 'corretor-1', error: null }) : banco.rpc(nome, args)),
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
      from: consulta,
    },
  };
});

import { AutoContractDialog } from './AutoContractDialog';

const ANA = { id: '0b7c3c9e-4a8f-4a45-9f0e-0f3f1c2d3e4f', nome: 'Ana Souza', motivo: 'cpf' };

beforeEach(() => { banco.rpc.mockReset(); banco.inserts = []; banco.updates = []; });
afterEach(cleanup);

async function revisar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AutoContractDialog open onOpenChange={() => undefined} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Escolher arquivo' }));
  fireEvent.click(screen.getByRole('button', { name: /Analisar Contrato/ }));
  await screen.findByRole('button', { name: 'Criar Contrato' });
}

it('inquilino encontrado pelo CPF recebe o contrato; o nome parecido não decide', async () => {
  banco.rpc.mockResolvedValue({ data: [ANA], error: null });
  await revisar();
  expect(await screen.findByText(/Encontrado pelo CPF\/CNPJ/)).toBeTruthy();
  expect(screen.queryByText(/nome parecido/)).toBeNull();
  expect(banco.rpc).toHaveBeenCalledWith('crm_clientes_por_telefone', { p_telefone: '62911110002', p_email: null, p_cpf: '12345678909' });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Criar Contrato' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Criar Contrato' }));
  await waitFor(() => expect(banco.inserts.find((i) => i.tabela === 'contratos')).toBeTruthy());
  expect(banco.inserts.find((i) => i.tabela === 'contratos')!.dados.cliente_id).toBe(ANA.id);
  expect(banco.inserts.some((i) => i.tabela === 'clientes')).toBe(false);
  expect(banco.rpc).not.toHaveBeenCalledWith('crm_criar_cliente', expect.anything());
  expect(banco.updates).toContainEqual({ cpf: '12345678909' });
});

it('inquilino novo é criado pela RPC com o CPF na coluna e o primeiro telefone', async () => {
  banco.rpc.mockImplementation(async (nome: string) => nome === 'crm_criar_cliente'
    ? { data: { status: 'created', cliente_id: 'cliente-novo' }, error: null }
    : { data: [], error: null });
  await revisar();
  expect(await screen.findByText(/nome parecido/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Criar Contrato' }));
  await waitFor(() => expect(banco.inserts.find((i) => i.tabela === 'contratos')).toBeTruthy());
  expect(banco.rpc).toHaveBeenCalledWith('crm_criar_cliente', { p_dados: expect.objectContaining({ telefone: '(62) 91111-0002', cpf: '12345678909', tipo_interesse: 'LOCACAO' }) });
  expect(banco.inserts.find((i) => i.tabela === 'contratos')!.dados.cliente_id).toBe('cliente-novo');
});
