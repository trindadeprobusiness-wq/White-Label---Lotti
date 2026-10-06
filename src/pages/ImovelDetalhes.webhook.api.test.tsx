// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Bloco B4: no modo API o "webhook do imóvel" (captura de lead) mostrado e copiado é a rota pública
// da API, não mais /functions/v1/lead-capture do Supabase.
const IMOVEL = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://api.exemplo.com';

const modoApi = { ligado: true };
vi.mock('@/lib/api', () => ({ apiDisponivel: () => modoApi.ligado, chamarApi: vi.fn() }));
vi.mock('@/lib/api/imoveis', async (original) => ({
  ...(await original<typeof import('@/lib/api/imoveis')>()),
  obterImovelApi: vi.fn(async () => ({
    id: IMOVEL, titulo: 'Casa', tipo: 'CASA', valor: 1, endereco: 'Rua', cidade: 'Anápolis', proprietario_nome: 'Dono',
    anunciado: true, ativo: true, status_venda: 'DISPONIVEL',
  })),
  listarClientesInteressadosApi: vi.fn(async () => []),
}));
const supabaseSingle = vi.fn(async () => ({
  data: { id: IMOVEL, titulo: 'Casa', tipo: 'CASA', valor: 1, endereco: 'Rua', cidade: 'Anápolis', proprietario_nome: 'Dono', anunciado: true },
  error: null,
}));
vi.mock('@/integrations/supabase/client', () => {
  const consulta = { select: () => consulta, eq: () => consulta, single: () => supabaseSingle(), then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) };
  return { supabase: { from: () => consulta } };
});
// Referências ESTÁVEIS: a página tem useEffect com [id, fetchFotos]; uma função nova a cada render
// faria o efeito rodar sem parar.
vi.mock('@/hooks/useImovelFotos', () => {
  const estado = { fotos: [], loading: false, uploading: false, fetchFotos: vi.fn(), uploadMultipleFotos: vi.fn(), deleteFoto: vi.fn(), setFotoPrincipal: vi.fn() };
  return { useImovelFotos: () => estado };
});
vi.mock('@/hooks/useVideos', () => {
  const estado = { videos: [], loading: false, uploadVideo: vi.fn(), deleteVideo: vi.fn(), updateVideo: vi.fn(), uploading: false, uploadProgress: 0, incrementVisualizacoes: vi.fn() };
  return { useVideos: () => estado };
});
vi.mock('@/stores/crmStore', () => {
  const estado = { clientes: [] };
  return { useCRMStore: () => estado };
});
vi.mock('@/hooks/use-toast', () => {
  const estado = { toast: vi.fn() };
  return { useToast: () => estado };
});
vi.mock('@/components/imoveis/ImovelGaleria', () => ({ ImovelGaleria: () => null }));
vi.mock('@/components/imoveis/ImovelFotosUpload', () => ({ ImovelFotosUpload: () => null }));
vi.mock('@/components/imoveis/VendaImovelDialog', () => ({ VendaImovelDialog: () => null }));
vi.mock('@/components/midias/VideoCard', () => ({ VideoCard: () => null }));
vi.mock('@/components/midias/VideoUploadArea', () => ({ VideoUploadArea: () => null }));
vi.mock('@/components/midias/VideoPlayerDialog', () => ({ VideoPlayerDialog: () => null }));

const writeText = vi.fn(async () => undefined);

async function abrir() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', `${BASE}/`);
  vi.stubEnv('VITE_SUPABASE_URL', 'https://projeto.supabase.co');
  const Pagina = (await import('./ImovelDetalhes')).default;
  render(
    <MemoryRouter initialEntries={[`/imoveis/${IMOVEL}`]}>
      <Routes><Route path="/imoveis/:id" element={<Pagina />} /></Routes>
    </MemoryRouter>,
  );
  return screen.findByDisplayValue(/lead/);
}

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); modoApi.ligado = true; });

describe('ImovelDetalhes: webhook de captura de lead', () => {
  it('modo API: mostra e copia a rota pública da API', async () => {
    const campo = await abrir();
    const esperado = `${BASE}/api/publico/leads?imovel_id=${IMOVEL}`;
    expect(campo).toHaveProperty('value', esperado);
    expect(document.body.textContent).not.toContain('functions/v1');
    const copiar = campo.parentElement!.querySelector('button')!;
    fireEvent.click(copiar);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(esperado));
  });

  it('sem a API segue a Edge Function, e o valor mostrado é o mesmo copiado', async () => {
    modoApi.ligado = false;
    const campo = await abrir();
    const esperado = `https://projeto.supabase.co/functions/v1/lead-capture?imovel_id=${IMOVEL}`;
    expect(campo).toHaveProperty('value', esperado);
    fireEvent.click(campo.parentElement!.querySelector('button')!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(esperado));
  });
});
