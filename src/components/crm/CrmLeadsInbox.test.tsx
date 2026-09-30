// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CandidatoCliente } from '@/lib/crm/duplicidade';

const estado = vi.hoisted(() => ({
  candidatos: [] as CandidatoCliente[],
  carregando: false,
  resposta: { status: 'converted', cliente_id: 'novo', created: true, oportunidade_id: 'op' } as Record<string, unknown>,
  mutate: vi.fn(),
  parecidos: vi.fn(),
}));
vi.mock('@/hooks/crm/useCrm', () => ({
  useLeadsPendentes: () => ({ isLoading: false, data: [{ id: 'lead-1', nome: 'Maria Lead', telefone: '(62) 91111-0002', email: 'maria@example.test', created_at: '2026-09-28T12:00:00Z' }] }),
  useEtapas: () => ({ data: [{ id: 'etapa-1', nome: 'Qualificação' }] }),
  useClientesParecidos: (...args: unknown[]) => { estado.parecidos(...args); return { data: estado.candidatos, isLoading: estado.carregando }; },
  useConverterLead: () => ({
    isPending: false, reset: vi.fn(),
    mutate: (vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => { estado.mutate(vars); opts?.onSuccess?.(estado.resposta); },
  }),
}));

import { CrmLeadsInbox } from './CrmLeadsInbox';

const ANA: CandidatoCliente = { id: 'cliente-ana', nome: 'Ana Souza', motivo: 'telefone' };

beforeEach(() => {
  estado.candidatos = []; estado.carregando = false; estado.mutate.mockReset(); estado.parecidos.mockReset();
  estado.resposta = { status: 'converted', cliente_id: 'novo', created: true, oportunidade_id: 'op' };
});
afterEach(cleanup);

function abrir() {
  render(<CrmLeadsInbox />);
  fireEvent.click(screen.getByRole('button', { name: /Converter/ }));
  return screen.getByRole('dialog');
}

it('procura no servidor pelo telefone e e-mail do lead', () => {
  abrir();
  expect(estado.parecidos).toHaveBeenLastCalledWith({ telefone: '(62) 91111-0002', email: 'maria@example.test' }, true);
});

it('telefone que já é de um cliente: só vincular, sem converter nem "criar mesmo assim"', () => {
  estado.candidatos = [ANA];
  const dialogo = abrir();
  expect(within(dialogo).getByText('Este lead já é o cliente Ana Souza')).toBeTruthy();
  expect(within(dialogo).queryByRole('button', { name: /Converter|Criar mesmo assim/ })).toBeNull();
  fireEvent.click(within(dialogo).getByRole('button', { name: /Vincular a Ana Souza/ }));
  expect(estado.mutate).toHaveBeenCalledWith(expect.objectContaining({ etapaId: 'etapa-1', clienteExistente: 'cliente-ana' }));
});

it('sem cliente parecido converte; se o servidor achar um no meio tempo, mostra para vincular', () => {
  estado.resposta = { status: 'duplicate', candidatos: [ANA] };
  const dialogo = abrir();
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Converter' }));
  expect(estado.mutate).toHaveBeenCalledWith(expect.objectContaining({ clienteExistente: null }));
  expect(within(dialogo).getByRole('button', { name: /Vincular a Ana Souza/ })).toBeTruthy();
  expect(within(dialogo).queryByRole('button', { name: 'Converter' })).toBeNull();
});

it('não converte antes de saber se o lead já é cliente', () => {
  estado.carregando = true;
  const dialogo = abrir();
  expect(within(dialogo).getByRole('status').textContent).toContain('Procurando cliente');
  expect((within(dialogo).getByRole('button', { name: 'Converter' }) as HTMLButtonElement).disabled).toBe(true);
});

it('conversão concluída fecha o diálogo', () => {
  abrir();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Converter' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
