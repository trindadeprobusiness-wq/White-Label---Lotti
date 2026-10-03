// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ hook: {} as Record<string, unknown>, fetchLeads: vi.fn() }));

vi.mock('@/hooks/useFachadas', () => ({ useFachadas: () => estado.hook }));
vi.mock('@/hooks/useFileUpload', () => ({ useFileUpload: () => ({ upload: vi.fn(), uploading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}));
vi.mock('@/components/fachadas/FachadaCard', () => ({
  FachadaCard: ({ fachada, onViewLeads }: { fachada: { imovel?: { titulo?: string } }; onViewLeads: () => void }) => (
    <button type="button" onClick={onViewLeads}>Ver leads de {fachada.imovel?.titulo}</button>
  ),
}));
vi.mock('@/components/fachadas/LeadsTable', () => ({
  LeadsTable: ({ fachadaSelecionadaId }: { fachadaSelecionadaId?: string | null }) => (
    <div data-testid="fachada-selecionada">{fachadaSelecionadaId ?? 'todas'}</div>
  ),
}));
vi.mock('@/components/fachadas/FachadaDashboard', () => ({ FachadaDashboard: () => null }));
vi.mock('@/components/fachadas/FachadaPreview', () => ({ FachadaPreview: () => null }));
vi.mock('@/components/fachadas/CriarFachadaDialog', () => ({ CriarFachadaDialog: () => null }));
vi.mock('@/components/fachadas/AssistenteTemplateDialog', () => ({ AssistenteTemplateDialog: () => null }));
vi.mock('@/components/subscription/LimitGuard', () => ({
  LimitGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/shell/PageHeader', () => ({ PageHeader: ({ titulo }: { titulo: string }) => <h1>{titulo}</h1> }));
vi.mock('@/components/shell/primitivos', () => ({
  MetricStrip: () => null, SectionCard: () => null, abasSublinhadas: { lista: '', gatilho: '' },
}));

import FachadasInteligentes from './FachadasInteligentes';

const fachada = {
  id: 'fachada-casa-a', corretor_id: 'corretor-1', imovel_id: 'imovel-1',
  tipo_negocio: 'VENDA', template_id: 'template-1', cta_principal: 'WHATSAPP',
  modo_conversao: true, ativo: true, total_escaneamentos: 12, total_leads: 4,
  created_at: '2026-10-03T12:00:00.000Z', imovel: { titulo: 'Casa A' },
};

beforeEach(() => {
  estado.fetchLeads.mockReset().mockResolvedValue(undefined);
  estado.hook = {
    fachadas: [fachada], leads: [], leadsLoading: false, metricas: null, loading: false,
    fetchFachadas: vi.fn(), createFachada: vi.fn(), updateFachada: vi.fn(),
    deleteFachada: vi.fn(), fetchLeads: estado.fetchLeads, fetchMetricas: vi.fn(), deleteLead: vi.fn(),
  };
});

afterEach(() => cleanup());

describe('Fachadas Inteligentes — escopo dos leads', () => {
  it('abre somente os leads da fachada clicada e mantém a aba geral sem filtro', async () => {
    render(<FachadasInteligentes />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver leads de Casa A' }));
    await waitFor(() => expect(estado.fetchLeads).toHaveBeenCalledWith('fachada-casa-a'));
    expect(screen.getByTestId('fachada-selecionada').textContent).toBe('fachada-casa-a');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Fachadas' }), { button: 0, ctrlKey: false });
    await screen.findByRole('button', { name: 'Ver leads de Casa A' });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Leads' }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(estado.fetchLeads).toHaveBeenLastCalledWith(undefined));
    expect(screen.getByTestId('fachada-selecionada').textContent).toBe('todas');
  });
});
