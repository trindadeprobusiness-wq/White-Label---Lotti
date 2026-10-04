// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Parceiro } from '@/integrations/supabase/admin-types';
import { FormularioParceiro } from './FormularioParceiro';

const mocks = vi.hoisted(() => ({ criar: vi.fn(), salvar: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock('@/hooks/admin/useAdminDados', () => ({
  useCriarParceiroConvidar: () => ({ mutateAsync: mocks.criar }),
  useSalvarParceiro: () => ({ mutateAsync: mocks.salvar }),
}));
vi.mock('sonner', () => ({ toast: { warning: mocks.warning, success: mocks.success } }));

function preencher() {
  fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'Parceiro Teste' } });
  fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: 'teste@example.com' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.criar.mockResolvedValue({ ok: true, parceiro_id: 'partner-1' });
  mocks.salvar.mockResolvedValue({});
});
afterEach(cleanup);

describe('FormularioParceiro', () => {
  it('cria cadastro, regra e link em uma unica operacao com renovacoes sem limite', async () => {
    const fechar = vi.fn();
    render(<FormularioParceiro aberto aoFechar={fechar} />);
    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Criar parceiro e enviar convite' }));
    await waitFor(() => expect(fechar).toHaveBeenCalledOnce());
    expect(mocks.criar).toHaveBeenCalledOnce();
    expect(mocks.criar).toHaveBeenCalledWith(expect.objectContaining({
      parceiro: expect.objectContaining({ nome: 'Parceiro Teste', email: 'teste@example.com' }),
      comissao: { percentual: 10, base_calculo: 'receita_bruta', teto_renovacoes: null },
      link: { slug: 'parceiro-teste', campanha: null },
    }));
    expect(mocks.salvar).not.toHaveBeenCalled();
  });

  it('preserva o identificador personalizado quando o nome muda', () => {
    render(<FormularioParceiro aberto aoFechar={vi.fn()} />);
    preencher();
    fireEvent.change(screen.getByLabelText('Identificador do link'), { target: { value: 'meu-link' } });
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'Outro Nome' } });
    expect((screen.getByLabelText('Identificador do link') as HTMLInputElement).value).toBe('meu-link');
  });

  it('mantem o formulario aberto e mostra erro do servidor', async () => {
    const fechar = vi.fn();
    mocks.criar.mockRejectedValue(new Error('Identificador ja cadastrado'));
    render(<FormularioParceiro aberto aoFechar={fechar} />);
    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Criar parceiro e enviar convite' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Identificador ja cadastrado');
    expect(fechar).not.toHaveBeenCalled();
  });

  it('informa falha de entrega sem criar o cadastro novamente', async () => {
    const fechar = vi.fn();
    mocks.criar.mockResolvedValue({ ok: false, parceiro_id: 'partner-1', email_enviado: false, error: 'Reenvie pelo cadastro' });
    render(<FormularioParceiro aberto aoFechar={fechar} />);
    preencher();
    fireEvent.click(screen.getByRole('button', { name: 'Criar parceiro e enviar convite' }));
    await waitFor(() => expect(fechar).toHaveBeenCalledOnce());
    expect(mocks.warning).toHaveBeenCalledWith('Reenvie pelo cadastro');
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.criar).toHaveBeenCalledOnce();
  });

  it('edita parceiro de nome curto sem validar um link oculto nem reenviar convite', async () => {
    const fechar = vi.fn();
    const parceiro = { id: 'partner-1', nome: 'Li', email: 'teste@example.com', status: 'ativo', janela_atribuicao_dias: 90 } as Parceiro;
    render(<FormularioParceiro aberto aoFechar={fechar} parceiro={parceiro} />);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(fechar).toHaveBeenCalledOnce());
    expect(mocks.salvar).toHaveBeenCalledWith(expect.objectContaining({ id: 'partner-1', nome: 'Li' }));
    expect(mocks.criar).not.toHaveBeenCalled();
  });
});
