import { describe, expect, it } from 'vitest';
import { candidatosValidos, clienteDoTelefone, codigoDoErro, registroDoErro } from './duplicidade';

const ID = '0b7c3c9e-4a8f-4a45-9f0e-0f3f1c2d3e4f';

describe('erros de duplicidade do banco', () => {
  it('lê o cliente que já tem o telefone no details do PostgREST', () => {
    expect(clienteDoTelefone({ message: 'duplicate_client_phone', details: ID, code: 'P0001' })).toBe(ID);
  });
  it('ignora outro código, details vazio ou que não é id', () => {
    expect(clienteDoTelefone({ message: 'forbidden', details: ID })).toBeNull();
    expect(clienteDoTelefone({ message: 'duplicate_client_phone', details: null })).toBeNull();
    expect(clienteDoTelefone({ message: 'duplicate_client_phone', details: 'Key (id)=(x)' })).toBeNull();
    expect(clienteDoTelefone(new Error('duplicate_client_phone'))).toBeNull();
    expect(clienteDoTelefone(null)).toBeNull();
  });
  it('lê a outra conversa do mesmo telefone', () => {
    expect(registroDoErro({ message: 'phone_in_other_conversation', details: ID }, 'phone_in_other_conversation')).toBe(ID);
    expect(codigoDoErro('texto')).toBe('');
  });
});

describe('candidatosValidos', () => {
  it('mantém só itens com id, nome e motivo conhecido', () => {
    expect(candidatosValidos([
      { id: ID, nome: 'Ana', motivo: 'telefone' },
      { id: ID, nome: 'Ana', motivo: 'outro' },
      { nome: 'Sem id', motivo: 'email' },
      null,
    ])).toEqual([{ id: ID, nome: 'Ana', motivo: 'telefone' }]);
    expect(candidatosValidos(null)).toEqual([]);
  });
});
