// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CARDS_POR_LOTE, CrmPipeline } from './CrmPipeline';

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...original,
    DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DragOverlay: () => null,
    useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false }),
    useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
    useSensor: vi.fn(),
    useSensors: vi.fn(() => []),
  };
});

const TOTAL = 75;
const oportunidades = Array.from({ length: TOTAL }, (_, i) => ({
  id: `op-${i}`, corretor_id: 'c1', cliente_id: null, imovel_id: null, etapa_id: 'novo', titulo: `Lead ${i + 1}`,
  valor_estimado: 0, probabilidade: 0, data_prevista_fechamento: null, motivo_perda: null, origem: null, ordem: i,
  observacoes: null, fechada_em: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
}));

vi.mock('@/hooks/crm/useCrm', () => ({
  useModoCrm: () => ({ data: 'completo' }),
  useEtapas: () => ({ data: [{ id: 'novo', corretor_id: 'c1', nome: 'Novos', ordem: 0, cor: 'sky', tipo: 'ABERTA', ativo: true }], isLoading: false }),
  useOportunidades: () => ({ data: oportunidades, isLoading: false }),
  useMoverOportunidade: () => ({ mutate: vi.fn(), isPending: false }),
  useExcluirOportunidades: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('./WhatsAppDialog', () => ({ WhatsAppDialog: () => null }));
vi.mock('@/pages/FunilVendas', () => ({ default: () => null }));
vi.mock('@/components/ui/dado-sensivel', () => ({ DadoSensivel: ({ valor }: { valor: string }) => <span>{valor}</span> }));

describe('CrmPipeline com muitos leads', () => {
  it('monta a coluna em lotes, mas a contagem mostra todos', () => {
    render(<MemoryRouter><CrmPipeline /></MemoryRouter>);
    expect(screen.getAllByText(/^Lead \d+$/)).toHaveLength(CARDS_POR_LOTE);
    expect(screen.getByText(String(TOTAL))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: `Mostrar mais ${CARDS_POR_LOTE} de ${TOTAL - CARDS_POR_LOTE}` }));
    expect(screen.getAllByText(/^Lead \d+$/)).toHaveLength(CARDS_POR_LOTE * 2);

    fireEvent.click(screen.getByRole('button', { name: `Mostrar mais ${TOTAL - CARDS_POR_LOTE * 2} de ${TOTAL - CARDS_POR_LOTE * 2}` }));
    expect(screen.getAllByText(/^Lead \d+$/)).toHaveLength(TOTAL);
    expect(screen.queryByRole('button', { name: /Mostrar mais/ })).toBeNull();
  });
});
