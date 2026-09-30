// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  addCliente: vi.fn(), updateCliente: vi.fn(), vincularClienteImovel: vi.fn(), fetchImoveis: vi.fn(),
  imoveis: [], corretor: null,
}));
vi.mock('@/stores/crmStore', () => ({ useCRMStore: () => store }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/hooks/useUTMTracker', () => ({ getTrackingData: () => null }));

import { NovoClienteDialog } from './NovoClienteDialog';

const ANA = { id: 'cliente-ana', nome: 'Ana Souza', motivo: 'telefone' as const };
const onOpenChange = vi.fn();

beforeEach(() => { Object.values(store).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockReset()); onOpenChange.mockReset(); });
afterEach(cleanup);

function preencherECadastrar(props: Partial<Parameters<typeof NovoClienteDialog>[0]> = {}) {
  render(<MemoryRouter initialEntries={['/clientes']}><Routes>
    <Route path="/clientes" element={<NovoClienteDialog open onOpenChange={onOpenChange} {...props} />} />
    <Route path="/clientes/:id" element={<p>Cadastro aberto</p>} />
  </Routes></MemoryRouter>);
  const [nome, telefone] = screen.getAllByRole('textbox');
  fireEvent.change(nome, { target: { value: 'Ana' } });
  fireEvent.change(telefone, { target: { value: '62911110002' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
}

it('telefone de outro cliente: mostra quem é e abre o cadastro, sem "criar mesmo assim"', async () => {
  store.addCliente.mockResolvedValue({ status: 'duplicate', candidatos: [ANA] });
  preencherECadastrar();
  expect((await screen.findByRole('alert')).textContent).toContain('Este telefone já é do cliente Ana Souza');
  expect(screen.queryByRole('button', { name: /mesmo assim/i })).toBeNull();
  expect((screen.getByRole('button', { name: 'Cadastrar' }) as HTMLButtonElement).disabled).toBe(true);
  expect(store.vincularClienteImovel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
  expect(await screen.findByText('Cadastro aberto')).toBeTruthy();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('corrigir o telefone libera o cadastro de novo', async () => {
  store.addCliente.mockResolvedValue({ status: 'duplicate', candidatos: [ANA] });
  preencherECadastrar();
  await screen.findByRole('alert');
  fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: '62922220003' } });
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByRole('button', { name: 'Cadastrar' }) as HTMLButtonElement).disabled).toBe(false);
});

it('dentro de outro fluxo, oferece usar o cliente existente', async () => {
  const usar = vi.fn();
  store.addCliente.mockResolvedValue({ status: 'duplicate', candidatos: [ANA] });
  preencherECadastrar({ onUsarExistente: usar });
  fireEvent.click(await screen.findByRole('button', { name: 'Usar este cliente' }));
  expect(usar).toHaveBeenCalledWith('cliente-ana');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('cadastro novo fecha o diálogo', async () => {
  store.addCliente.mockResolvedValue({ status: 'created', id: 'novo' });
  preencherECadastrar();
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(store.addCliente).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Ana', telefone: '(62) 91111-0002' }));
});
