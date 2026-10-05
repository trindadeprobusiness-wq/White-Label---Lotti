// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ api: true }));
const sb = vi.hoisted(() => ({ from: vi.fn() }));

function consulta(): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(ok, erro),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => consulta()) });
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...a: unknown[]) => { sb.from(...a); return consulta(); } },
}));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => estado.api, chamarApi: vi.fn() }));
vi.mock('@/lib/api/fachadas', () => ({
  obterMidiasImovelApi: vi.fn(), obterTemplatePorImagemApi: vi.fn(),
}));
vi.mock('./QRCodeGenerator', () => ({ QRCodeGenerator: () => null }));

import * as fachadasApi from '@/lib/api/fachadas';
import { FachadaPreview } from './FachadaPreview';

const api = vi.mocked(fachadasApi);
const IMOVEL = '44444444-4444-4444-8444-444444444444';

const base = {
  id: '11111111-1111-4111-8111-111111111111',
  corretor_id: 'corretor-1',
  imovel_id: IMOVEL,
  tipo_negocio: 'VENDA' as const,
  cta_principal: 'WHATSAPP' as const,
  modo_conversao: true,
  ativo: true,
  total_escaneamentos: 10,
  total_leads: 2,
  foto_principal_url: 'https://cache/antiga.jpg',
  created_at: '2026-08-20T12:00:00.000Z',
  imovel: {
    titulo: 'Casa Jardim América', tipo: 'Casa', valor: 650000, area_m2: 180,
    dormitorios: 3, garagem: 2, endereco: 'Rua das Flores, 123',
    bairro: 'Jardim América', cidade: 'Goiânia', descricao: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  estado.api = true;
  api.obterMidiasImovelApi.mockResolvedValue({
    foto_principal_url: 'https://viva/agora.jpg', fotos: 3, videos: 0,
  });
  api.obterTemplatePorImagemApi.mockResolvedValue({ config: { qrPosition: { x: 10, y: 20 }, qrSize: 30 } });
});

describe('FachadaPreview', () => {
  it('com a API, a foto vem de F12 e nada vai ao Supabase', async () => {
    render(<FachadaPreview fachada={{ ...base, template_id: 'venda-classica' }} open onOpenChange={() => {}} />);
    await waitFor(() => expect(api.obterMidiasImovelApi).toHaveBeenCalledWith(IMOVEL));
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('F11 só é pedida quando template_id começa com http', async () => {
    const { unmount } = render(
      <FachadaPreview fachada={{ ...base, template_id: 'venda-classica' }} open onOpenChange={() => {}} />,
    );
    await waitFor(() => expect(api.obterMidiasImovelApi).toHaveBeenCalled());
    expect(api.obterTemplatePorImagemApi).not.toHaveBeenCalled();
    unmount();

    render(
      <FachadaPreview fachada={{ ...base, template_id: 'https://storage/arte.png' }} open onOpenChange={() => {}} />,
    );
    await waitFor(() => expect(api.obterTemplatePorImagemApi).toHaveBeenCalledWith('https://storage/arte.png'));
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('sem VITE_API_URL volta ao Supabase e não chama a API', async () => {
    estado.api = false;
    render(
      <FachadaPreview fachada={{ ...base, template_id: 'https://storage/arte.png' }} open onOpenChange={() => {}} />,
    );
    await waitFor(() => expect(sb.from).toHaveBeenCalledWith('fachada_templates'));
    expect(sb.from).toHaveBeenCalledWith('imovel_fotos');
    expect(api.obterMidiasImovelApi).not.toHaveBeenCalled();
    expect(api.obterTemplatePorImagemApi).not.toHaveBeenCalled();
  });
});
