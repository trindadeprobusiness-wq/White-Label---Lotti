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
  enviarArquivoApi: vi.fn(async (_grupo: string, _key: string, _file: File) => 'key'),
  apagarArquivoApi: vi.fn(async () => undefined),
  urlPublicaFoto: vi.fn((k: string) => `https://api/foto/${k}`),
  urlPublicaVideo: vi.fn((k: string) => `https://api/video/${k}`),
}));
vi.mock('@/lib/api/arquivos', () => arquivos);
// Com a API, o corretor da conta vem do perfil (crmStore), nunca do rpc do Supabase.
const corretorIdDaContaApi = vi.hoisted(() => vi.fn(async () => 'corretor-1'));
vi.mock('@/stores/crmStore', () => ({ corretorIdDaContaApi }));
// Linhas de imovel_fotos pela API (bloco B1).
const fotosApi = vi.hoisted(() => ({
  listarFotosImovelApi: vi.fn(async () => [] as Array<Record<string, unknown>>),
  criarFotoImovelApi: vi.fn(async (imovel_id: string, d: Record<string, unknown>) => ({ id: 'foto-api', imovel_id, ...d })),
  removerFotoImovelApi: vi.fn(async () => undefined),
  reordenarFotosImovelApi: vi.fn(async () => ({ atualizadas: 2 })),
  definirFotoPrincipalApi: vi.fn(async () => ({ imovel_id: 'imovel-1', foto_id: 'f2' })),
}));
vi.mock('@/lib/api/imoveis', () => fotosApi);

import { toast } from 'sonner';
import { useImovelFotos } from './useImovelFotos';
import { MSG_VIDEOS_INDISPONIVEIS, useVideos } from './useVideos';

beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: 'corretor-1', error: null }); });
afterEach(() => { apiLigada = false; });

describe('useImovelFotos — linhas pela API (bloco B1), nenhuma chamada ao Supabase', () => {
  const F1 = { id: 'f1', imovel_id: 'imovel-1', arquivo_url: 'u1', arquivo_path: 'imovel-1/1', principal: true, ordem: 0, created_at: null };
  const F2 = { ...F1, id: 'f2', arquivo_url: 'u2', arquivo_path: 'imovel-1/2', principal: false, ordem: 1 };

  it('fetchFotos lista pela API', async () => {
    apiLigada = true;
    fotosApi.listarFotosImovelApi.mockResolvedValueOnce([F1, F2]);
    const { result } = renderHook(() => useImovelFotos('imovel-1'));
    await act(async () => { await result.current.fetchFotos(); });
    expect(fotosApi.listarFotosImovelApi).toHaveBeenCalledWith('imovel-1');
    expect(result.current.fotos.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(from).not.toHaveBeenCalled();
  });

  it('upload grava a linha pela API com a key e a URL pública; o servidor decide ordem e principal', async () => {
    apiLigada = true;
    const { result } = renderHook(() => useImovelFotos('imovel-1'));
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    let foto: unknown;
    await act(async () => { foto = await result.current.uploadFoto('imovel-1', file, true); });
    const [, key] = arquivos.enviarArquivoApi.mock.calls[0];
    expect(fotosApi.criarFotoImovelApi).toHaveBeenCalledWith('imovel-1', {
      arquivo_url: `https://api/foto/${key}`, arquivo_path: key, principal: true,
    });
    expect((foto as { id: string }).id).toBe('foto-api');
    expect(from).not.toHaveBeenCalled();
  });

  it('apagar, reordenar e definir principal usam as rotas da API', async () => {
    apiLigada = true;
    fotosApi.listarFotosImovelApi.mockResolvedValue([F1, F2]);
    const { result } = renderHook(() => useImovelFotos('imovel-1'));
    await act(async () => { await result.current.fetchFotos(); });
    await act(async () => { await result.current.reordenarFotos('imovel-1', ['f2', 'f1']); });
    expect(fotosApi.reordenarFotosImovelApi).toHaveBeenCalledWith('imovel-1', ['f2', 'f1']);
    await act(async () => { await result.current.setFotoPrincipal('f2', 'imovel-1'); });
    expect(fotosApi.definirFotoPrincipalApi).toHaveBeenCalledWith('imovel-1', 'f2');
    await act(async () => { await result.current.deleteFoto('f1', 'imovel-1/1'); });
    expect(fotosApi.removerFotoImovelApi).toHaveBeenCalledWith('f1');
    expect(from).not.toHaveBeenCalled();
    fotosApi.listarFotosImovelApi.mockResolvedValue([]);
  });

  it('getFotoPrincipal: a principal única, senão a primeira pela ordem', async () => {
    apiLigada = true;
    const { result } = renderHook(() => useImovelFotos('imovel-1'));
    fotosApi.listarFotosImovelApi.mockResolvedValueOnce([F1, { ...F2, principal: true }]);
    expect(await result.current.getFotoPrincipal('imovel-1')).toBe('u1');
    fotosApi.listarFotosImovelApi.mockResolvedValueOnce([{ ...F1, principal: false }, F2]);
    expect(await result.current.getFotoPrincipal('imovel-1')).toBe('u1');
    fotosApi.listarFotosImovelApi.mockResolvedValueOnce([{ ...F1, principal: false }, { ...F2, principal: true }]);
    expect(await result.current.getFotoPrincipal('imovel-1')).toBe('u2');
    expect(from).not.toHaveBeenCalled();
  });
});

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

  it('com API: a tabela videos não existe — lista vazia, sem Supabase', async () => {
    apiLigada = true;
    const { result } = await montar();
    expect(result.current.videos).toEqual([]);
    await act(async () => { await result.current.fetchVideos(); });
    expect(from).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('com API: criar, editar e apagar avisam "Vídeos indisponíveis no momento" sem subir arquivo nem chamar o Supabase', async () => {
    apiLigada = true;
    const { result } = await montar();
    const file = new File([new Uint8Array(2048)], 'v.mp4', { type: 'video/mp4' });
    await expect(result.current.uploadVideo(file, 'Tour', 'OUTRO', 'imovel-1')).rejects.toThrow(MSG_VIDEOS_INDISPONIVEIS);
    await expect(result.current.updateVideo('v1', { titulo: 'X' })).rejects.toThrow(MSG_VIDEOS_INDISPONIVEIS);
    await expect(result.current.deleteVideo('v1', 'corretor-1/geral/v.mp4')).rejects.toThrow(MSG_VIDEOS_INDISPONIVEIS);
    await act(async () => { await result.current.incrementVisualizacoes('v1'); });
    expect(toast.error).toHaveBeenCalledTimes(3);
    expect(toast.error).toHaveBeenCalledWith(MSG_VIDEOS_INDISPONIVEIS);
    expect(arquivos.enviarArquivoApi).not.toHaveBeenCalled();
    expect(arquivos.apagarArquivoApi).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    // Sem sessão do Supabase no login próprio: nada de rpc('get_corretor_id').
    expect(rpc).not.toHaveBeenCalled();
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
