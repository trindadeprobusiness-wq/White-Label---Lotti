import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { filtrarOportunidades } from '@/lib/crm/pipeline';
import { CrmPipeline } from './CrmPipeline';

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...original,
    DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DragOverlay: ({ children }: { children: React.ReactNode }) => <div data-drag-overlay>{children}</div>,
    useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false }),
    useDroppable: () => ({ setNodeRef: vi.fn(), isOver: true }),
    useSensor: vi.fn(),
    useSensors: vi.fn(() => []),
  };
});

vi.mock('@/hooks/crm/useCrm', () => ({
  useModoCrm: () => ({ data: 'nativo' }),
  useEtapas: () => ({ data: [{ id: 'novo', corretor_id: 'c1', nome: 'Novos', ordem: 0, cor: 'sky', tipo: 'ABERTA', ativo: true }], isLoading: false }),
  useOportunidades: () => ({ data: [], isLoading: false }),
  useMoverOportunidade: () => ({ mutate: vi.fn(), isPending: false }),
  useExcluirOportunidades: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('./WhatsAppDialog', () => ({ WhatsAppDialog: () => null }));
vi.mock('@/pages/FunilVendas', () => ({ default: () => null }));
vi.mock('@/components/ui/dado-sensivel', () => ({ DadoSensivel: ({ valor }: { valor: string }) => <span>{valor}</span> }));

describe('CrmPipeline', () => {
  it('encontra o negócio pelo lead, cliente ou imóvel sem alterar as outras etapas', () => {
    const oportunidades = [
      { id: '1', titulo: 'Locação centro', etapa_id: 'novo', clientes: { nome: 'Ana Lima' }, imoveis: { titulo: 'Sala 101' } },
      { id: '2', titulo: 'Venda jardim', etapa_id: 'qualificacao', clientes: { nome: 'Bruno Souza' }, imoveis: { titulo: 'Casa Azul' } },
    ] as never[];

    expect(filtrarOportunidades(oportunidades, 'sala')).toHaveLength(1);
    expect(filtrarOportunidades(oportunidades, 'ana')[0]?.id).toBe('1');
    expect(filtrarOportunidades(oportunidades, 'venda')[0]?.id).toBe('2');
  });

  it('mostra contorno interno uniforme na coluna de destino e monta o overlay de arraste', () => {
    const html = renderToStaticMarkup(<StaticRouter location="/crm"><CrmPipeline /></StaticRouter>);

    expect(html).toContain('outline-2');
    expect(html).toContain('-outline-offset-2');
    expect(html).toContain('data-drag-overlay');
  });

  it('substitui o filtro pelo menu de ações do funil', () => {
    const html = renderToStaticMarkup(<StaticRouter location="/crm"><CrmPipeline /></StaticRouter>);

    expect(html).toContain('Mais opções do funil');
    expect(html).not.toContain('>Filtros<');
  });

  it('prepara a barra de ações em lote sem exibir um aviso no quadro', () => {
    const html = renderToStaticMarkup(<StaticRouter location="/crm"><CrmPipeline /></StaticRouter>);

    expect(html).not.toContain('Seleção ativada');
    expect(html).not.toContain('Selecionar cards no quadro');
  });
});
