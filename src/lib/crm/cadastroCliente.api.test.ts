import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn() }));
vi.mock('@/lib/api/crm', () => ({ criarClienteApi: vi.fn(), completarCpfApi: vi.fn() }));

import { completarCpfApi, criarClienteApi } from '@/lib/api/crm';
import { ErroApi } from '@/lib/api/http';
import { cadastrarOuReaproveitarCliente, completarCpfDoCliente } from './cadastroCliente';

const ANA = '11111111-1111-4111-8111-111111111111';
const NOVO = '22222222-2222-4222-8222-222222222222';
const dados = { nome: 'Ana', telefone: '(62) 91111-0002', cpf: '12345678909', tipo_interesse: 'LOCACAO' };

beforeEach(() => { vi.clearAllMocks(); });

describe('cadastroCliente com a API Lotti', () => {
  it('cria pela API e segue com o cliente que já tem o telefone', async () => {
    vi.mocked(criarClienteApi).mockResolvedValueOnce({ status: 'created', cliente_id: NOVO });
    await expect(cadastrarOuReaproveitarCliente(dados)).resolves.toEqual({ id: NOVO, criado: true, nome: 'Ana' });
    expect(criarClienteApi).toHaveBeenCalledWith(dados);

    vi.mocked(criarClienteApi).mockResolvedValueOnce({ status: 'duplicate', candidatos: [{ id: ANA, nome: 'Ana Souza', motivo: 'telefone' }] });
    await expect(cadastrarOuReaproveitarCliente(dados)).resolves.toEqual({ id: ANA, criado: false, nome: 'Ana Souza' });
  });

  it('409 duplicate_client_phone aponta o cliente existente; outros erros sobem', async () => {
    vi.mocked(criarClienteApi).mockRejectedValueOnce(new ErroApi(409, 'duplicate_client_phone', 'duplicate_client_phone', ANA));
    await expect(cadastrarOuReaproveitarCliente(dados)).resolves.toEqual({ id: ANA, criado: false, nome: '' });

    vi.mocked(criarClienteApi).mockRejectedValueOnce(new ErroApi(422, 'invalid_name', 'invalid_name'));
    await expect(cadastrarOuReaproveitarCliente(dados)).rejects.toMatchObject({ message: 'invalid_name' });
  });

  it('completar CPF manda só dígitos e não lança', async () => {
    vi.mocked(completarCpfApi).mockRejectedValueOnce(new Error('offline'));
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(completarCpfDoCliente(ANA, '123.456.789-09')).resolves.toBeUndefined();
    expect(completarCpfApi).toHaveBeenCalledWith(ANA, '12345678909');
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();

    await completarCpfDoCliente(ANA, '123.456');
    expect(completarCpfApi).toHaveBeenCalledTimes(1);
  });
});
