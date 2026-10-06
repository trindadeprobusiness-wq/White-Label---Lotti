// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Login próprio: sem sessão do Supabase, a assinatura da mensagem vem do perfil
// carregado no crmStore. O Supabase não pode ser tocado.
const sb = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: sb }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const store = vi.hoisted(() => ({
  estado: { corretor: null as null | Record<string, string>, fetchCorretor: vi.fn() },
}));
vi.mock('@/stores/crmStore', () => ({ useCRMStore: { getState: () => store.estado } }));

import { CompartilharVideoDialog } from './CompartilharVideoDialog';

const video = {
  id: 'v1', corretor_id: 'c1', imovel_id: null, titulo: 'Tour da casa', descricao: null, video_url: 'u', video_path: 'c1/geral/v.mp4',
  thumbnail_url: null, duracao_segundos: null, tipo: 'TOUR_VIRTUAL' as const, visualizacoes: 0, created_at: '', updated_at: '',
};
const ANA = { nome: 'Ana Souza', telefone: '(62) 99999-0000', creci: '12345', creci_estado: 'GO' };

beforeEach(() => {
  vi.clearAllMocks();
  store.estado.corretor = null;
});

describe('CompartilharVideoDialog com a API', () => {
  it('assina a mensagem com o perfil do crmStore, sem rpc nem select no Supabase', async () => {
    store.estado.corretor = ANA;
    render(<CompartilharVideoDialog video={video} open onOpenChange={() => {}} getTemporaryShareUrl={async () => 'x'} />);
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Ana Souza'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('CRECI: 12345/GO');
    expect(store.estado.fetchCorretor).not.toHaveBeenCalled();
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('perfil ainda não carregado: pede ao crmStore uma vez', async () => {
    store.estado.fetchCorretor.mockImplementation(async () => { store.estado.corretor = ANA; });
    render(<CompartilharVideoDialog video={video} open onOpenChange={() => {}} getTemporaryShareUrl={async () => 'x'} />);
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('Ana Souza'));
    expect(store.estado.fetchCorretor).toHaveBeenCalledTimes(1);
    expect(sb.rpc).not.toHaveBeenCalled();
  });
});
