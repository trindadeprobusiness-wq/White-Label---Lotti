// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dublê do supabase-js só para o chamarApi pegar o token da sessão.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
  },
}));

const BASE = 'https://api.exemplo.com';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // jsdom não implementa createObjectURL; registramos um dublê previsível.
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:objeto'),
    revokeObjectURL: vi.fn(),
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

const bin = (corpo: BodyInit, status = 200, type = 'application/octet-stream') =>
  new Response(corpo, { status, headers: { 'Content-Type': type } });
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', BASE);
  return import('./arquivos');
}

const chamada = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit & { headers: Record<string, string> }];
  return { url, method: init?.method ?? 'GET', body: init?.body, headers: init?.headers ?? {} };
};

describe('cliente de arquivos da API Lotti', () => {
  it('urlPublicaFoto/Video preservam as barras e codificam cada segmento', async () => {
    const { urlPublicaFoto, urlPublicaVideo, encodeKey } = await carregar();
    expect(urlPublicaFoto('imovel 1/2024_foto a.jpg'))
      .toBe(`${BASE}/api/arquivos/publico/foto/imovel%201/2024_foto%20a.jpg`);
    expect(urlPublicaVideo('corretor/geral/tour.mp4'))
      .toBe(`${BASE}/api/arquivos/publico/video/corretor/geral/tour.mp4`);
    // A key com subpastas mantém as barras (não vira %2F).
    expect(encodeKey('a/b/c.pdf')).toBe('a/b/c.pdf');
    expect(encodeKey('a b/c#d.pdf')).toBe('a%20b/c%23d.pdf');
  });

  it('enviarArquivoApi: PUT com o File cru e Content-Type do arquivo, nunca base64/JSON', async () => {
    const { enviarArquivoApi } = await carregar();
    const file = new File(['conteudo'], 'foto.jpg', { type: 'image/jpeg' });
    fetchMock.mockResolvedValue(json({ ok: true, key: 'imovel/1_foto.jpg' }));
    const key = await enviarArquivoApi('foto', 'imovel/1_foto.jpg', file);
    expect(key).toBe('imovel/1_foto.jpg');
    const c = chamada();
    expect(c.url).toBe(`${BASE}/api/arquivos/foto/imovel/1_foto.jpg`);
    expect(c.method).toBe('PUT');
    expect(c.headers['Content-Type']).toBe('image/jpeg');
    // O corpo é o próprio File — nada de JSON nem base64.
    expect(c.body).toBe(file);
    expect(typeof c.body).not.toBe('string');
    // O token vai no cabeçalho, não na URL.
    expect(c.headers.Authorization).toBe('Bearer tok');
    expect(c.url).not.toContain('tok');
  });

  it('enviarArquivoApi: vídeo grande vai como File (stream), não string', async () => {
    const { enviarArquivoApi } = await carregar();
    const file = new File([new Uint8Array(1024)], 'tour.mp4', { type: 'video/mp4' });
    fetchMock.mockResolvedValue(json({ ok: true }));
    const key = await enviarArquivoApi('video', 'c/g/tour.mp4', file);
    expect(key).toBe('c/g/tour.mp4'); // sem key na resposta, devolve a enviada
    const c = chamada();
    expect(c.body).toBe(file);
    expect(c.headers['Content-Type']).toBe('video/mp4');
  });

  it('enviarInboxApi: PUT no bucket do Inbox com o corpo binário', async () => {
    const { enviarInboxApi } = await carregar();
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    fetchMock.mockResolvedValue(json({ ok: true, key: 'c/req/a.pdf' }));
    await enviarInboxApi('lotti-inbox-files', 'c/req/a.pdf', file);
    const c = chamada();
    expect(c.url).toBe(`${BASE}/api/arquivos/inbox/lotti-inbox-files/c/req/a.pdf`);
    expect(c.method).toBe('PUT');
    expect(c.body).toBe(file);
  });

  it('prepararInboxApi: POST JSON e devolve o storage_path', async () => {
    const { prepararInboxApi } = await carregar();
    fetchMock.mockResolvedValue(json({ storage_path: 'corretor/req/arquivo.pdf' }));
    const r = await prepararInboxApi({ request_id: 'req', name: 'arquivo.pdf', mime: 'application/pdf', size: 10 });
    expect(r.storage_path).toBe('corretor/req/arquivo.pdf');
    const c = chamada();
    expect(c.url).toBe(`${BASE}/api/arquivos/inbox/preparar`);
    expect(c.method).toBe('POST');
    expect(JSON.parse(c.body as string)).toEqual({ request_id: 'req', name: 'arquivo.pdf', mime: 'application/pdf', size: 10 });
  });

  it('baixarPrivadoApi: token no cabeçalho, blob vira object URL', async () => {
    const { baixarPrivadoApi } = await carregar();
    fetchMock.mockResolvedValue(bin('dados', 200));
    const url = await baixarPrivadoApi('documento', 'corretor/contratos/x.pdf');
    expect(url).toBe('blob:objeto');
    const c = chamada();
    expect(c.url).toBe(`${BASE}/api/arquivos/documento/corretor/contratos/x.pdf`);
    expect(c.method).toBe('GET');
    expect(c.headers.Authorization).toBe('Bearer tok');
    expect(c.url).not.toContain('tok');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('baixarPrivadoApi: anexo-ia usa a rota de anexo', async () => {
    const { baixarPrivadoApi } = await carregar();
    fetchMock.mockResolvedValue(bin('dados', 200));
    await baixarPrivadoApi('anexo-ia', 'conta/anexo.png');
    expect(chamada().url).toBe(`${BASE}/api/arquivos/anexo-ia/conta/anexo.png`);
  });

  it('baixarInboxApi: rota do bucket, blob vira object URL', async () => {
    const { baixarInboxApi } = await carregar();
    fetchMock.mockResolvedValue(bin('audio', 200));
    const url = await baixarInboxApi('lotti-inbox-audio', 'c/req/audio.ogg');
    expect(url).toBe('blob:objeto');
    expect(chamada().url).toBe(`${BASE}/api/arquivos/inbox/lotti-inbox-audio/c/req/audio.ogg`);
  });

  it('baixar* lançam quando a API nega (403)', async () => {
    const { baixarPrivadoApi, baixarInboxApi } = await carregar();
    fetchMock.mockResolvedValue(json({ codigo: 'arquivo_de_outra_conta' }, 403));
    await expect(baixarPrivadoApi('documento', 'x')).rejects.toThrow();
    fetchMock.mockResolvedValue(json({ codigo: 'arquivo_de_outra_conta' }, 403));
    await expect(baixarInboxApi('lotti-inbox-files', 'x')).rejects.toThrow();
    // Nenhuma object URL criada quando houve erro.
  });

  it('apagarArquivoApi: DELETE na rota do grupo; 404 é idempotente (não lança)', async () => {
    const { apagarArquivoApi } = await carregar();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await apagarArquivoApi('foto', 'imovel/1.jpg');
    const c = chamada();
    expect(c.url).toBe(`${BASE}/api/arquivos/foto/imovel/1.jpg`);
    expect(c.method).toBe('DELETE');
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(apagarArquivoApi('documento', 'sumiu.pdf')).resolves.toBeUndefined();
  });
});
