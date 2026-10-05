// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const etapas = vi.hoisted(() => ({ lista: [] as unknown[] }));
const refetch = vi.hoisted(() => ({ etapas: vi.fn(async () => undefined), oportunidades: vi.fn(async () => undefined) }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn() }));
vi.mock('@/lib/api/crm', () => ({ salvarEtapasApi: vi.fn() }));

vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@dnd-kit/core')>()),
  DndContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));
vi.mock('@/hooks/crm/useCrm', () => ({
  useModoCrm: () => ({ data: 'completo' }),
  useEtapas: () => ({ data: etapas.lista, isLoading: false, refetch: refetch.etapas }),
  useOportunidades: () => ({ data: [], isLoading: false, refetch: refetch.oportunidades }),
  useMoverOportunidade: () => ({ mutate: vi.fn(), isPending: false }),
  useExcluirOportunidades: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => <button type="button" onClick={() => onSelect?.()}>{children}</button>,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('./WhatsAppDialog', () => ({ WhatsAppDialog: () => null }));
vi.mock('@/pages/FunilVendas', () => ({ default: () => null }));
vi.mock('@/components/ui/dado-sensivel', () => ({ DadoSensivel: ({ valor }: { valor: string }) => <span>{valor}</span> }));

import { salvarEtapasApi } from '@/lib/api/crm';
import { ErroApi } from '@/lib/api/http';
import { CrmPipeline } from './CrmPipeline';

const NOVO = '11111111-1111-4111-8111-111111111111';
const GANHO = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  etapas.lista = [
    { id: NOVO, corretor_id: 'c1', nome: 'Novo lead', ordem: 1, cor: 'slate', tipo: 'ABERTA', ativo: true },
    { id: GANHO, corretor_id: 'c1', nome: 'Fechado — ganho', ordem: 2, cor: 'green', tipo: 'GANHO', ativo: true },
  ];
});
afterEach(() => cleanup());

function abrirEtapas() {
  render(<MemoryRouter><CrmPipeline /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /Gerenciar etapas/ }));
  return screen.getByRole('dialog');
}

describe('Gerenciar etapas com a API Lotti', () => {
  it('salva só as etapas com uuid, só os campos do DTO, e recarrega ao fechar', async () => {
    const dialogo = abrirEtapas();
    fireEvent.click(within(dialogo).getByRole('button', { name: '+ Adicionar quadro' }));
    vi.mocked(salvarEtapasApi).mockResolvedValue({ atualizadas: 2 });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(salvarEtapasApi).toHaveBeenCalledWith([
      { id: NOVO, nome: 'Novo lead', cor: 'slate', tipo: 'ABERTA', ordem: 1 },
      { id: GANHO, nome: 'Fechado — ganho', cor: 'green', tipo: 'GANHO', ordem: 2 },
    ]);
    expect(refetch.etapas).toHaveBeenCalled();
    expect(refetch.oportunidades).toHaveBeenCalled();
  });

  it('em erro mostra o texto da API e mantém o diálogo aberto, sem recarregar', async () => {
    vi.mocked(salvarEtapasApi).mockRejectedValue(new ErroApi(409, 'registro_repetido', 'Já existe uma etapa com este nome.'));
    const dialogo = abrirEtapas();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Já existe uma etapa com este nome.'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(refetch.etapas).not.toHaveBeenCalled();
  });

  it('sem etapa válida não chama a API, mas recarrega e fecha como hoje', async () => {
    etapas.lista = [];
    const dialogo = abrirEtapas();
    fireEvent.click(within(dialogo).getByRole('button', { name: '+ Adicionar quadro' }));
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(salvarEtapasApi).not.toHaveBeenCalled();
    expect(refetch.etapas).toHaveBeenCalled();
  });
});
