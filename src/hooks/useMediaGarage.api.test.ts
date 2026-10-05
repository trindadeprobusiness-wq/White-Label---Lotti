// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Storage do Supabase: todo encadeamento .from(...).upload/getPublicUrl/remove/createSignedUrl.
const storage = vi.hoisted(() => ({
  upload: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
  getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://supabase/publico.jpg' } })),
  createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://supabase/assinada' }, error: null })),
}));
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: 'corretor-1', error: null })));
function consulta(): unknown {
  const alvo = {
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok, erro),
    single: async () => ({ data: { id: 'row-1' }, error: null }),
  };
  return new Proxy(alvo, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => consulta()) });
}
const from = vi.hoisted(() => vi.fn(() => consulta()));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from, rpc, storage: { from: () => storage } },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// A API fica atrás de apiDisponivel(), controlado por variável em cada bloco.
let apiLigada = false;
vi.mock('@/lib/api', () => ({ apiDisponivel: () => apiLigada }));
const arquivos = vi.hoisted(() => ({
  enviarArquivoApi: vi.fn(async () => 'key'),
  apagarArquivoApi: vi.fn(async () => undefined),
  urlPublicaFoto: vi.fn((k: string) => `https://api/foto/${k}`),
  urlPublicaVideo: vi.fn((k: string) => `https://api/video/${k}`),
}));
vi.mock('@/lib/api/arquivos', () => arquivos);

import { useImovelFotos } from './useImovelFotos';
import { useVideos } from './useVideos';

beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: 'corretor-1', error: null }); });
afterEach(() => { apiLigada = false; });

describe('useImovelFotos — Garage atrás de apiDisponivel()', () => {
  it('sem API: usa o Storage do Supabase, nenhuma chamada à API', async () => {
    apiLigada = false;
    const { result } = renderHook(() => useImovelFotos('imovel-1'));
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await act(async () => { await result.current.uploadFoto('imovel-1', file); });
    expect(storage.upload).toHaveBeenCalled();
    expect(arquivos.enviarArquivoApi).not.toHaveBeenCalled();
    const inserido = (from.mock.results.find(() => true));
    void inserido;
  });

  it('com API: sobe pela API e grava a URL pública da API; a key é a mesma', async () => {
    apiLigada = true;
    const { result } = renderHook(() => useImovelFotos('imovel-1'));
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await act(async () => { await result.current.uploadFoto('imovel-1', file); });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(arquivos.enviarArquivoApi).toHaveBeenCalledTimes(1);
    const [grupo, key, enviado] = arquivos.enviarArquivoApi.mock.calls[0];
    expect(grupo).toBe('foto');
    expect(String(key).startsWith('imovel-1/')).toBe(true);
    expect(enviado).toBe(file);
    expect(arquivos.urlPublicaFoto).toHaveBeenCalledWith(key);
  });

  it('com API: apagar usa a API, não o Storage', async () => {
    apiLigada = true;
    const { result } = renderHook(() => useImovelFotos('imovel-1'));
    await act(async () => { await result.current.deleteFoto('row-1', 'imovel-1/a.jpg'); });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(arquivos.apagarArquivoApi).toHaveBeenCalledWith('foto', 'imovel-1/a.jpg');
  });
});

describe('useVideos — Garage atrás de apiDisponivel()', () => {
  async function montar() {
    const r = renderHook(() => useVideos());
    await waitFor(() => expect(r.result.current.loading).toBe(false));
    return r;
  }

  it('sem API: Storage do Supabase', async () => {
    apiLigada = false;
    const { result } = await montar();
    const file = new File(['x'], 'v.mp4', { type: 'video/mp4' });
    await act(async () => { await result.current.uploadVideo(file, 'Tour', 'OUTRO', 'imovel-1'); });
    expect(storage.upload).toHaveBeenCalled();
    expect(arquivos.enviarArquivoApi).not.toHaveBeenCalled();
  });

  it('com API: vídeo sobe pela API (streaming do File) e URL pública da API', async () => {
    apiLigada = true;
    const { result } = await montar();
    const file = new File([new Uint8Array(2048)], 'v.mp4', { type: 'video/mp4' });
    await act(async () => { await result.current.uploadVideo(file, 'Tour', 'OUTRO', 'imovel-1'); });
    expect(storage.upload).not.toHaveBeenCalled();
    const [grupo, key, enviado] = arquivos.enviarArquivoApi.mock.calls[0];
    expect(grupo).toBe('video');
    expect(String(key).startsWith('corretor-1/imovel-1/')).toBe(true);
    expect(enviado).toBe(file);
    expect(arquivos.urlPublicaVideo).toHaveBeenCalledWith(key);
  });

  it('com API: getTemporaryShareUrl devolve a rota pública (sem signed url)', async () => {
    apiLigada = true;
    const { result } = await montar();
    const url = await result.current.getTemporaryShareUrl('corretor-1/geral/v.mp4');
    expect(url).toBe('https://api/video/corretor-1/geral/v.mp4');
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it('sem API: getTemporaryShareUrl usa signed url do Supabase', async () => {
    apiLigada = false;
    const { result } = await montar();
    const url = await result.current.getTemporaryShareUrl('corretor-1/geral/v.mp4');
    expect(url).toBe('https://supabase/assinada');
    expect(arquivos.urlPublicaVideo).not.toHaveBeenCalled();
  });
});
