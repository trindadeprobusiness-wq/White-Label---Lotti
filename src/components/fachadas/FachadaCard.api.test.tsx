// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ api: true }));
const sb = vi.hoisted(() => ({ from: vi.fn() }));

/** Qualquer encadeamento de `.from(...)` termina em { data: [], error: null, count: 0 }. */
function consulta(): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(ok, erro),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => consulta()) });
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...a: unknown[]) => { sb.from(...a); return consulta(); } },
}));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => estado.api, chamarApi: vi.fn() }));
vi.mock('@/lib/api/fachadas', () => ({ obterMidiasImovelApi: vi.fn() }));
vi.mock('./QRCodeGenerator', () => ({ QRCodeGenerator: () => null }));

import * as fachadasApi from '@/lib/api/fachadas';
import { FachadaCard } from './FachadaCard';

const api = vi.mocked(fachadasApi);

const fachada = {
  id: '11111111-1111-4111-8111-111111111111',
  corretor_id: 'corretor-1',
  imovel_id: '44444444-4444-4444-8444-444444444444',
  tipo_negocio: 'VENDA' as const,
  template_id: 'venda-classica',
  cta_principal: 'WHATSAPP' as const,
  modo_conversao: true,
  ativo: true,
  total_escaneamentos: 10,
  total_leads: 2,
  foto_principal_url: 'https://cache/antiga.jpg',
  created_at: '2026-08-20T12:00:00.000Z',
};

const props = {
  fachada, onPreview: vi.fn(), onEdit: vi.fn(), onDeactivate: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  estado.api = true;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('FachadaCard', () => {
  it('com a API, uma chamada a F12 no lugar das três consultas', async () => {
    api.obterMidiasImovelApi.mockResolvedValue({
      foto_principal_url: 'https://viva/agora.jpg', fotos: 8, videos: 2,
    });
    const { container } = render(<FachadaCard {...props} />);
    await waitFor(() => expect(api.obterMidiasImovelApi).toHaveBeenCalledTimes(1));
    expect(api.obterMidiasImovelApi).toHaveBeenCalledWith(fachada.imovel_id);
    expect(sb.from).not.toHaveBeenCalled();
    await waitFor(() => expect(container.innerHTML).toContain('https://viva/agora.jpg'));
  });

  it('com F12 devolvendo null, a foto cai no cache fachada.foto_principal_url', async () => {
    api.obterMidiasImovelApi.mockResolvedValue({ foto_principal_url: null, fotos: 0, videos: 0 });
    const { container } = render(<FachadaCard {...props} />);
    await waitFor(() => expect(api.obterMidiasImovelApi).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toContain('https://cache/antiga.jpg'));
  });

  it('sem VITE_API_URL volta às três consultas do Supabase e não chama a API', async () => {
    estado.api = false;
    render(<FachadaCard {...props} />);
    await waitFor(() => expect(sb.from).toHaveBeenCalledWith('videos'));
    expect(sb.from).toHaveBeenCalledWith('imovel_fotos');
    expect(api.obterMidiasImovelApi).not.toHaveBeenCalled();
  });
});
