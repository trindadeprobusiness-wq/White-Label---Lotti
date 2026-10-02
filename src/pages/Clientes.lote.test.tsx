// @vitest-environment jsdom
// Marcar linhas e usar a barra de ações em lote: mover de etapa e excluir.
// O corretor relatou que selecionar não levava a nada — este arquivo prende o
// caminho inteiro, do clique até a chamada que vai ao banco.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Cliente } from '@/types/crm';

const loja = vi.hoisted(() => ({
  clientes: [] as Cliente[],
  removeCliente: vi.fn(),
  updateClienteStatus: vi.fn(),
  fetchImoveis: vi.fn(),
}));
vi.mock('@/stores/crmStore', () => ({ useCRMStore: () => loja }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import Clientes from './Clientes';

function cliente(id: string, nome: string): Cliente {
  return {
    id, nome, telefone: `(62) 99999-000${id}`, email: `${id}@exemplo.test`,
    status_funil: 'QUALIFICACAO', created_at: '2026-01-30T12:00:00Z',
    ultimo_contato: '2026-01-30T12:00:00Z', corretor_id: 'c1',
  } as Cliente;
}

beforeEach(() => {
  // jsdom não implementa; o Radix Select chama ao abrir a lista.
  Element.prototype.scrollIntoView ??= vi.fn();
  loja.clientes = [cliente('1', 'Hélio Ferreira Neves'), cliente('2', 'Shirley Pereira de Figueiredo')];
  loja.removeCliente.mockReset().mockResolvedValue({ success: true });
  loja.updateClienteStatus.mockReset().mockResolvedValue(undefined);
  loja.fetchImoveis.mockReset();
});
afterEach(cleanup);

function abrir() {
  render(<TooltipProvider><MemoryRouter><Clientes /></MemoryRouter></TooltipProvider>);
}

function selecionar(nome: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: `Selecionar ${nome}` }));
}

it('a barra em lote só aparece depois de marcar alguém', () => {
  abrir();
  expect(screen.queryByText(/selecionado/)).toBeNull();
  selecionar('Hélio Ferreira Neves');
  expect(screen.getByText('1 selecionado')).toBeTruthy();
});

it('excluir em lote chega a apagar cada selecionado', async () => {
  abrir();
  selecionar('Hélio Ferreira Neves');
  selecionar('Shirley Pereira de Figueiredo');
  fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));

  const dialogo = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialogo).getByRole('button', { name: /Excluir/ }));

  await waitFor(() => expect(loja.removeCliente).toHaveBeenCalledTimes(2));
  expect(loja.removeCliente.mock.calls.map(([id]) => id).sort()).toEqual(['1', '2']);
});

it('mover em lote grava a etapa escolhida em cada selecionado', async () => {
  abrir();
  selecionar('Hélio Ferreira Neves');
  fireEvent.click(screen.getByText('Mover para etapa...'));
  fireEvent.click(await screen.findByRole('option', { name: 'Documentação' }));

  await waitFor(() => expect(loja.updateClienteStatus).toHaveBeenCalledWith('1', 'DOCUMENTACAO'));
});

