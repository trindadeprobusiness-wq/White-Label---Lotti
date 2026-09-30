import { describe, expect, it, vi } from 'vitest';
import { executeAction, type AdminClient } from './execute';
import { validateActionProposal } from '../_shared/ai/actions';

function admin(resposta: { data: unknown; error: unknown }) {
  const from = vi.fn(() => { throw new Error('a ação não pode escrever direto em tabelas'); });
  const rpc = vi.fn(async () => resposta);
  return { client: { from, rpc } as unknown as AdminClient, from, rpc };
}

const criar = (params: Record<string, unknown>) =>
  validateActionProposal({ action_type: 'create_client', params, description: 'Cadastrar cliente' });

describe('ação create_client da IA', () => {
  it('cadastra pelo helper do banco, com a conta resolvida no servidor', async () => {
    const f = admin({ data: { cliente_id: 'novo', created: true }, error: null });
    await expect(executeAction(f.client, 'corretor-1', criar({ nome: 'Ana', telefone: '(62) 91111-0002', tipo_interesse: 'LOCACAO' })))
      .resolves.toEqual({ record_id: 'novo' });
    expect(f.rpc).toHaveBeenCalledWith('lotti_find_or_create_cliente', {
      p_owner: 'corretor-1', p_phone: '(62) 91111-0002', p_name: 'Ana', p_dados: { tipo_interesse: 'LOCACAO' },
    });
    expect(f.from).not.toHaveBeenCalled();
  });

  it('telefone que já é de um cliente devolve esse cliente, marcado como existente', async () => {
    const f = admin({ data: { cliente_id: 'ana', created: false }, error: null });
    await expect(executeAction(f.client, 'corretor-1', criar({ nome: 'Ana', telefone: '5562911110002' })))
      .resolves.toEqual({ record_id: 'ana', existing: true });
    expect(f.rpc).toHaveBeenCalledWith('lotti_find_or_create_cliente', expect.objectContaining({ p_dados: { tipo_interesse: 'COMPRA' } }));
  });

  it('falha do banco vira erro genérico, sem detalhes internos', async () => {
    const f = admin({ data: null, error: { message: 'duplicate_client_phone', details: 'id' } });
    await expect(executeAction(f.client, 'corretor-1', criar({ nome: 'Ana' }))).rejects.toThrow('create_client_failed');
  });
});
