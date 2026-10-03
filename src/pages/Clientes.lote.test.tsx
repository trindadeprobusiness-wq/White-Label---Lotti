// @vitest-environment jsdom
// Marcar linhas e usar a barra de ações em lote: mover de etapa e excluir.
// O corretor relatou que selecionar não levava a nada — este arquivo prende o
// caminho inteiro, do clique até a chamada que vai ao banco.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: avisos.toast }) }));

// Contratos por cliente, como o banco devolveria. `erro` simula a consulta falhando.
const banco = vi.hoisted(() => ({
  contratos: [] as { id: string; cliente_id: string; tipo: string; status: string; imoveis: { titulo: string } | null }[],
  erro: null as null | { message: string },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: (_coluna: string, ids: string[]) => Promise.resolve(banco.erro
          ? { data: null, error: banco.erro }
          : { data: banco.contratos.filter((c) => ids.includes(c.cliente_id)), error: null }),
      }),
    }),
  },
}));

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
  banco.contratos = [];
  banco.erro = null;
  avisos.toast.mockReset();
});
afterEach(cleanup);

function abrir() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TooltipProvider><MemoryRouter><Clientes /></MemoryRouter></TooltipProvider></QueryClientProvider>);
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
  // O botão só libera depois de a tela conferir se há contrato vinculado.
  const botao = within(dialogo).getByRole('button', { name: /Excluir/ });
  await waitFor(() => expect(botao.hasAttribute('disabled')).toBe(false));
  fireEvent.click(botao);

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

it('diz quem tem contrato, pelo nome, e não deixa excluir enquanto estiver marcado', async () => {
  // O caso real: proprietários cadastrados como clientes, com telefone de
  // preenchimento, foram excluídos em lote e levaram contratos ativos.
  banco.contratos = [{ id: 'k1', cliente_id: '1', tipo: 'LOCACAO_RESIDENCIAL', status: 'ATIVO', imoveis: { titulo: 'Apartamento 603 - Jardins do Éden' } }];
  abrir();
  selecionar('Hélio Ferreira Neves');
  fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));

  const dialogo = await screen.findByRole('alertdialog');
  const aviso = await within(dialogo).findByTestId('contratos-em-risco');
  expect(aviso.textContent).toContain('Hélio Ferreira Neves tem contrato e não pode ser excluído');
  expect(aviso.textContent).toContain('Locação residencial');
  expect(aviso.textContent).toContain('Apartamento 603 - Jardins do Éden');
  expect(aviso.textContent).toContain('ATIVO');
  expect(within(dialogo).getByRole('button', { name: 'Excluir' }).hasAttribute('disabled')).toBe(true);
});

it('desmarcar ali mesmo libera a exclusão dos demais', async () => {
  banco.contratos = [{ id: 'k1', cliente_id: '1', tipo: 'LOCACAO_RESIDENCIAL', status: 'ATIVO', imoveis: { titulo: 'Apartamento 603' } }];
  abrir();
  selecionar('Hélio Ferreira Neves');
  selecionar('Shirley Pereira de Figueiredo');
  fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
  const dialogo = await screen.findByRole('alertdialog');
  fireEvent.click(await within(dialogo).findByRole('button', { name: 'Desmarcar' }));

  // Sobrou só a Shirley, sem contrato: o aviso some e o botão libera.
  await waitFor(() => expect(within(dialogo).queryByTestId('contratos-em-risco')).toBeNull());
  const botao = within(dialogo).getByRole('button', { name: 'Excluir' });
  await waitFor(() => expect(botao.hasAttribute('disabled')).toBe(false));
  fireEvent.click(botao);
  await waitFor(() => expect(loja.removeCliente).toHaveBeenCalledTimes(1));
  expect(loja.removeCliente).toHaveBeenCalledWith('2');
});

it('"Mostrar na lista" fecha a caixa e destaca a linha do cliente', async () => {
  banco.contratos = [{ id: 'k1', cliente_id: '1', tipo: 'LOCACAO_RESIDENCIAL', status: 'ATIVO', imoveis: { titulo: 'Apartamento 603' } }];
  abrir();
  selecionar('Hélio Ferreira Neves');
  fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
  const dialogo = await screen.findByRole('alertdialog');
  fireEvent.click(await within(dialogo).findByRole('button', { name: 'Mostrar na lista' }));

  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  const linha = document.querySelector('[data-cliente-id="1"]');
  expect(linha?.className).toContain('ring-amber-400');
  // Continua marcado: é ali que o corretor desmarca, vendo a linha.
  expect((screen.getByRole('checkbox', { name: 'Selecionar Hélio Ferreira Neves' }) as HTMLElement).getAttribute('data-state')).toBe('checked');
});

it('se um contrato surgir entre a conferência e o clique, a mensagem diz isso', async () => {
  // O banco recusa (23503, chave RESTRICT); a tela não pode mostrar só "erro".
  loja.removeCliente.mockResolvedValue({ success: false, error: { code: '23503', message: 'update or delete on table "clientes" violates RESTRICT setting of foreign key constraint "contratos_cliente_id_fkey" on table "contratos"' } });
  abrir();
  selecionar('Shirley Pereira de Figueiredo');
  fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
  const dialogo = await screen.findByRole('alertdialog');
  const botao = within(dialogo).getByRole('button', { name: 'Excluir' });
  await waitFor(() => expect(botao.hasAttribute('disabled')).toBe(false));
  fireEvent.click(botao);
  await waitFor(() => expect(avisos.toast).toHaveBeenCalled());
  expect(avisos.toast.mock.calls.at(-1)?.[0].description).toContain('contrato');
});

it('sem contrato, não assusta: o botão continua só "Excluir"', async () => {
  abrir();
  selecionar('Shirley Pereira de Figueiredo');
  fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
  const dialogo = await screen.findByRole('alertdialog');
  await waitFor(() => expect(within(dialogo).getByRole('button', { name: 'Excluir' }).hasAttribute('disabled')).toBe(false));
  expect(within(dialogo).queryByTestId('contratos-em-risco')).toBeNull();
});

it('se não der para conferir os contratos, não deixa excluir', async () => {
  // Falha fechada: excluir "sem saber" foi o que apagou contratos ativos.
  banco.erro = { message: 'rede caiu' };
  abrir();
  selecionar('Hélio Ferreira Neves');
  fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
  const dialogo = await screen.findByRole('alertdialog');
  expect((await within(dialogo).findByRole('alert')).textContent).toContain('exclusão fica bloqueada');

  const botao = within(dialogo).getByRole('button', { name: 'Excluir' });
  expect(botao.hasAttribute('disabled')).toBe(true);
  fireEvent.click(botao);
  expect(loja.removeCliente).not.toHaveBeenCalled();
});
