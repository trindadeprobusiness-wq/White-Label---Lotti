// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({ rpc: vi.fn(), inserts: [] as { tabela: string; dados: Record<string, unknown> }[], updates: [] as unknown[] }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(() => 't') }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/services/contractExtractionService', () => ({
  analisarContratoCentral: vi.fn(async () => ({
    tipo: 'LOCACAO_RESIDENCIAL',
    partes: {
      comprador_cliente: { nome: 'Ana Souza', cpf_cnpj: '123.456.789-09', telefone: '(62) 91111-0002 / (62) 3333-4444', email: null },
      vendedor_proprietario: { nome: 'Dono', cpf_cnpj: null, telefone: null, email: null },
      corretor: null,
    },
    imovel: { endereco: null, bairro: null, cidade: null, tipo: null },
    valor: 1500, comissao_percentual: null, data_inicio: '2026-09-01', data_fim: '2027-09-01', observacoes: null,
  })),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (nome: string, args: unknown) => (nome === 'get_corretor_id' ? Promise.resolve({ data: 'corretor-1', error: null }) : banco.rpc(nome, args)),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
    from: (tabela: string) => ({
      insert: (dados: Record<string, unknown>) => { banco.inserts.push({ tabela, dados }); return Promise.resolve({ error: null }); },
      update: (dados: unknown) => {
        banco.updates.push(dados);
        const q = { eq: () => q, is: () => Promise.resolve({ error: null }) };
        return q;
      },
    }),
  },
}));

import { AnalisarContratoDialog } from './AnalisarContratoDialog';

const ANA = { id: '0b7c3c9e-4a8f-4a45-9f0e-0f3f1c2d3e4f', nome: 'Ana Souza (CRM)', motivo: 'telefone' };

beforeEach(() => { banco.rpc.mockReset(); banco.inserts = []; banco.updates = []; Object.values(toast).forEach((f) => typeof f === 'function' && 'mockClear' in f && f.mockClear()); });
afterEach(cleanup);

async function analisar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={client}>
    <AnalisarContratoDialog open onOpenChange={() => undefined} imoveis={[]} clientes={[{ id: 'homonimo', nome: 'Ana Souza' }]} onSaved={() => undefined} />
  </QueryClientProvider>);
  const input = document.body.querySelector('input[type=file]') ?? container.querySelector('input[type=file]');
  fireEvent.change(input!, { target: { files: [new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' })] } });
  fireEvent.click(screen.getByRole('button', { name: /Analisar com IA/ }));
}

it('acha a parte pelo primeiro telefone do contrato e vincula sem criar outro cliente', async () => {
  banco.rpc.mockImplementation(async (nome: string) => nome === 'crm_clientes_por_telefone' ? { data: [ANA], error: null } : { data: null, error: null });
  await analisar();
  expect(await screen.findByText(/Encontrado pelo telefone/)).toBeTruthy();
  expect(banco.rpc).toHaveBeenCalledWith('crm_clientes_por_telefone', { p_telefone: '62911110002', p_email: null, p_cpf: '12345678909' });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar Contrato' }));
  await waitFor(() => expect(banco.inserts.find((i) => i.tabela === 'contratos')).toBeTruthy());
  expect(banco.inserts.find((i) => i.tabela === 'contratos')!.dados.cliente_id).toBe(ANA.id);
  expect(banco.inserts.some((i) => i.tabela === 'clientes')).toBe(false);
  expect(banco.rpc).not.toHaveBeenCalledWith('crm_criar_cliente', expect.anything());
  expect(banco.updates).toContainEqual({ cpf: '12345678909' });
});

it('sem ninguém com o telefone ou o CPF, o nome é só sugestão e a parte é cadastrada com o CPF', async () => {
  banco.rpc.mockImplementation(async (nome: string) => nome === 'crm_criar_cliente'
    ? { data: { status: 'created', cliente_id: 'novo' }, error: null }
    : { data: [], error: null });
  await analisar();
  expect(await screen.findByText(/Cliente com nome parecido/)).toBeTruthy();
  expect(screen.getByText(/Cadastrar "Ana Souza"/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Salvar Contrato' }));
  await waitFor(() => expect(banco.inserts.find((i) => i.tabela === 'contratos')).toBeTruthy());
  expect(banco.rpc).toHaveBeenCalledWith('crm_criar_cliente', { p_dados: expect.objectContaining({ nome: 'Ana Souza', telefone: '(62) 91111-0002', cpf: '12345678909' }) });
  expect(banco.inserts.find((i) => i.tabela === 'contratos')!.dados.cliente_id).toBe('novo');
});
