import { beforeEach, describe, expect, it, vi } from 'vitest';

const banco = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), filtros: [] as string[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: banco.rpc,
    from: () => ({
      update: (dados: unknown) => {
        banco.update(dados);
        const q = {
          eq: (c: string, v: unknown) => { banco.filtros.push(`${c}=${v}`); return q; },
          is: (c: string, v: unknown) => { banco.filtros.push(`${c} is ${v}`); return Promise.resolve({ error: null }); },
        };
        return q;
      },
    }),
  },
}));

import { cadastrarOuReaproveitarCliente, completarCpfDoCliente } from './cadastroCliente';

const ANA = '0b7c3c9e-4a8f-4a45-9f0e-0f3f1c2d3e4f';
const dados = { nome: 'Ana', telefone: '(62) 91111-0002', cpf: '12345678909', tipo_interesse: 'LOCACAO' };

beforeEach(() => { banco.rpc.mockReset(); banco.update.mockReset(); banco.filtros = []; });

describe('cadastrarOuReaproveitarCliente', () => {
  it('cria pela RPC do CRM', async () => {
    banco.rpc.mockResolvedValue({ data: { status: 'created', cliente_id: 'novo' }, error: null });
    await expect(cadastrarOuReaproveitarCliente(dados)).resolves.toEqual({ id: 'novo', criado: true, nome: 'Ana' });
    expect(banco.rpc).toHaveBeenCalledWith('crm_criar_cliente', { p_dados: dados });
  });
  it('telefone já cadastrado: segue com o cliente que já existe, sem criar outro', async () => {
    banco.rpc.mockResolvedValue({ data: { status: 'duplicate', candidatos: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }] }, error: null });
    await expect(cadastrarOuReaproveitarCliente(dados)).resolves.toEqual({ id: ANA, criado: false, nome: 'Ana Souza' });
  });
  it('a recusa do gatilho do banco também aponta o cliente existente', async () => {
    banco.rpc.mockResolvedValue({ data: null, error: { message: 'duplicate_client_phone', details: ANA } });
    await expect(cadastrarOuReaproveitarCliente(dados)).resolves.toEqual({ id: ANA, criado: false, nome: '' });
  });
  it('outros erros sobem para o fluxo tratar', async () => {
    banco.rpc.mockResolvedValue({ data: null, error: { message: 'invalid_name' } });
    await expect(cadastrarOuReaproveitarCliente(dados)).rejects.toMatchObject({ message: 'invalid_name' });
  });
});

describe('completarCpfDoCliente', () => {
  it('grava só dígitos e só em quem ainda não tem CPF', async () => {
    await completarCpfDoCliente(ANA, '123.456.789-09');
    expect(banco.update).toHaveBeenCalledWith({ cpf: '12345678909' });
    expect(banco.filtros).toEqual([`id=${ANA}`, 'cpf is null']);
  });
  it('documento incompleto não é gravado', async () => {
    await completarCpfDoCliente(ANA, '123.456');
    expect(banco.update).not.toHaveBeenCalled();
  });
});
