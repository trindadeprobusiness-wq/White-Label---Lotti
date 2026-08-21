import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Midias from './Midias';

vi.mock('@/hooks/useVideos', () => ({
  useVideos: () => ({
    videos: [], loading: false, uploading: false, uploadProgress: 0,
    uploadVideo: vi.fn(), deleteVideo: vi.fn(), updateVideo: vi.fn(),
    incrementVisualizacoes: vi.fn(), getTemporaryShareUrl: vi.fn(),
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {},
}));

vi.mock('@/components/shell/PageHeader', () => ({
  PageHeader: ({ mostrarPrivacidade = true }: { mostrarPrivacidade?: boolean }) => (
    <output>{mostrarPrivacidade ? 'controle de privacidade' : 'sem controle de privacidade'}</output>
  ),
}));

describe('Mídias', () => {
  it('mantém os utilitários sem oferecer a opção de ocultar dados', () => {
    const html = renderToStaticMarkup(<Midias />);

    expect(html).toContain('sem controle de privacidade');
  });
});
