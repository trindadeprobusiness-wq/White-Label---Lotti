import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, update, toast } = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), toast: vi.fn() }));
const lista = { select: () => lista, order: () => Promise.resolve({ data: [], error: null }) };
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    from: (tabela: string) => tabela === 'clientes'
      ? { ...lista, update: (dados: unknown) => ({ eq: () => update(dados) }) }
      : lista,
  },
}));

import { useCRMStore } from './crmStore';

const ANA = '0b7c3c9e-4a8f-4a45-9f0e-0f3f1c2d3e4f';
const novo = {
  nome: 'Ana', telefone: '(62) 91111-0002', email: '', tipo_interesse: 'COMPRA' as const,
  status_funil: 'QUALIFICACAO' as const, ultimo_contato: '2026-09-28T12:00:00Z', observacoes: '',
};

beforeEach(() => { rpc.mockReset(); update.mockReset(); toast.mockReset(); });

describe('cadastro de cliente sem telefone repetido', () => {
  it('cria pela RPC, sem insert direto e sem mandar o corretor pelo navegador', async () => {
    rpc.mockResolvedValue({ data: { status: 'created', cliente_id: 'novo-id' }, error: null });
    await expect(useCRMStore.getState().addCliente(novo)).resolves.toEqual({ status: 'created', id: 'novo-id' });
    expect(rpc).toHaveBeenCalledWith('crm_criar_cliente', { p_dados: novo });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('corretor_id');
  });

  it('devolve quem já tem o telefone em vez de criar outro', async () => {
    rpc.mockResolvedValue({ data: { status: 'duplicate', candidatos: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }] }, error: null });
    await expect(useCRMStore.getState().addCliente(novo))
      .resolves.toEqual({ status: 'duplicate', candidatos: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }] });
    expect(toast).not.toHaveBeenCalled();
  });

  it('editar para o telefone de outro cliente mostra esse cliente, não um erro genérico', async () => {
    update.mockResolvedValue({ error: { message: 'duplicate_client_phone', details: ANA, code: 'P0001' } });
    rpc.mockResolvedValue({ data: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }], error: null });
    const resultado = await useCRMStore.getState().updateCliente('editado', { telefone: '(62) 91111-0002' });
    expect(resultado).toEqual({ status: 'duplicate', candidatos: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }] });
    expect(rpc).toHaveBeenCalledWith('crm_clientes_por_telefone', { p_telefone: '(62) 91111-0002' });
    expect(toast).not.toHaveBeenCalled();
  });

  it('sem o nome do outro cliente, o id do erro ainda permite abrir o cadastro', async () => {
    update.mockResolvedValue({ error: { message: 'duplicate_client_phone', details: ANA } });
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(useCRMStore.getState().updateCliente('editado', { telefone: '62911110002' }))
      .resolves.toEqual({ status: 'duplicate', candidatos: [{ id: ANA, nome: '', motivo: 'telefone' }] });
  });

  it('erro comum continua avisando o usuário', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'invalid_name' } });
    await expect(useCRMStore.getState().addCliente(novo)).resolves.toEqual({ status: 'error' });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Informe o nome do cliente.' }));
  });
});
