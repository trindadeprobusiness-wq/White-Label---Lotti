import { PassThrough, Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { ArquivosController } from './arquivos.controller';
import type { ArquivosRepo } from './arquivos.repo';
import type { StorageService } from '../storage/storage.service';
import type { ObjetoLido } from '../storage/storage.service';
import type { SupabaseClaims } from '../prisma/tenant-db';

const claims = { sub: 'u', role: 'authenticated' } as SupabaseClaims;

function objeto(parcial: Partial<ObjetoLido> = {}): ObjetoLido {
  return {
    corpo: Readable.from('conteudo'),
    contentType: 'application/pdf',
    contentLength: 8,
    etag: '"abc"',
    statusCode: 200,
    ...parcial,
  };
}

interface FakeRes extends PassThrough {
  headers: Record<string, string>;
  codigo: number;
  setHeader(k: string, v: string): void;
  status(c: number): FakeRes;
}

function fakeRes(): FakeRes {
  const res = new PassThrough() as unknown as FakeRes;
  res.headers = {};
  res.codigo = 200;
  res.setHeader = (k: string, v: string) => {
    res.headers[k.toLowerCase()] = String(v);
  };
  res.status = (c: number) => {
    res.codigo = c;
    return res;
  };
  return res;
}

function fakeReq(body: string | Buffer, headers: Record<string, string> = {}): Request {
  const pt = new PassThrough();
  (pt as unknown as { headers: Record<string, string> }).headers = headers;
  process.nextTick(() => pt.end(body));
  return pt as unknown as Request;
}

async function coletar(stream: Readable): Promise<string> {
  let texto = '';
  for await (const p of stream) texto += Buffer.from(p).toString();
  return texto;
}

describe('ArquivosController', () => {
  let storage: jest.Mocked<Pick<StorageService, 'obter' | 'enviar' | 'apagar'>>;
  let repo: jest.Mocked<Pick<ArquivosRepo, 'corretorId' | 'donoDocumento' | 'donoAnexoIa' | 'donoInbox' | 'donoFoto'>>;
  let ctrl: ArquivosController;

  beforeEach(() => {
    storage = { obter: jest.fn(), enviar: jest.fn(), apagar: jest.fn() };
    repo = {
      corretorId: jest.fn(),
      donoDocumento: jest.fn(),
      donoAnexoIa: jest.fn(),
      donoInbox: jest.fn(),
      donoFoto: jest.fn(),
    };
    ctrl = new ArquivosController(storage as unknown as StorageService, repo as unknown as ArquivosRepo);
  });

  it('foto pública serve sem guard, com Cache-Control public e ETag', async () => {
    storage.obter.mockResolvedValueOnce(objeto());
    const res = fakeRes();
    await ctrl.fotoPublica({ '0': 'imovel/1/foto.jpg' }, undefined, res as unknown as Response);
    expect(storage.obter).toHaveBeenCalledWith('imoveis-fotos', 'imovel/1/foto.jpg');
    expect(res.headers['cache-control']).toContain('public');
    expect(res.headers['etag']).toBe('"abc"');
    expect(res.codigo).toBe(200);
  });

  it('foto pública responde 304 quando o ETag bate', async () => {
    storage.obter.mockResolvedValueOnce(objeto());
    const res = fakeRes();
    await ctrl.fotoPublica({ '0': 'f.jpg' }, '"abc"', res as unknown as Response);
    expect(res.codigo).toBe(304);
  });

  it('vídeo público honra Range e devolve 206 com Content-Range', async () => {
    storage.obter.mockResolvedValueOnce(objeto({ statusCode: 206, contentRange: 'bytes 0-1/500', contentType: 'video/mp4' }));
    const res = fakeRes();
    await ctrl.videoPublico({ '0': 'v.mp4' }, 'bytes=0-1', res as unknown as Response);
    expect(storage.obter).toHaveBeenCalledWith('videos', 'v.mp4', 'bytes=0-1');
    expect(res.codigo).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-1/500');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('download privado confere o dono ANTES de tocar no S3; vazio → 403', async () => {
    repo.donoDocumento.mockResolvedValueOnce(false);
    const res = fakeRes();
    await expect(ctrl.baixarDocumento(claims, { '0': 'outro/x.pdf' }, undefined, res as unknown as Response)).rejects.toMatchObject({
      status: 403,
      response: { codigo: 'arquivo_de_outra_conta' },
    });
    expect(storage.obter).not.toHaveBeenCalled();
  });

  it('download privado do dono faz stream com Cache-Control private', async () => {
    repo.donoDocumento.mockResolvedValueOnce(true);
    storage.obter.mockResolvedValueOnce(objeto());
    const res = fakeRes();
    await ctrl.baixarDocumento(claims, { '0': 'meu/x.pdf' }, undefined, res as unknown as Response);
    expect(storage.obter).toHaveBeenCalledWith('documentos', 'meu/x.pdf', undefined);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('splat entrega a key inteira com barras (a/b/c.pdf)', async () => {
    repo.donoAnexoIa.mockResolvedValueOnce(true);
    storage.obter.mockResolvedValueOnce(objeto());
    const res = fakeRes();
    await ctrl.baixarAnexoIa(claims, { '0': 'a/b/c.pdf' }, undefined, res as unknown as Response);
    expect(storage.obter).toHaveBeenCalledWith('ai-attachments', 'a/b/c.pdf', undefined);
  });

  it('upload de foto grava no bucket público e devolve a key', async () => {
    repo.donoFoto.mockResolvedValueOnce(true);
    storage.enviar.mockResolvedValueOnce(undefined);
    const req = fakeReq('bytes', { 'content-type': 'image/jpeg', 'content-length': '5' });
    const r = await ctrl.subirFoto(claims, { '0': 'imovel/1/foto.jpg' }, req);
    expect(r).toEqual({ ok: true, key: 'imovel/1/foto.jpg' });
    expect(repo.donoFoto).toHaveBeenCalledWith(claims, 'imovel/1/foto.jpg');
    expect(storage.enviar).toHaveBeenCalledWith('imoveis-fotos', 'imovel/1/foto.jpg', expect.anything(), 'image/jpeg');
  });

  it('foto de imóvel de outra conta → 403 no upload e no delete, sem tocar no S3', async () => {
    repo.donoFoto.mockResolvedValue(false);
    const req = fakeReq('bytes', { 'content-type': 'image/jpeg' });
    await expect(ctrl.subirFoto(claims, { '0': 'alheio/foto.jpg' }, req)).rejects.toMatchObject({
      status: 403,
      response: { codigo: 'arquivo_de_outra_conta' },
    });
    await expect(ctrl.apagarFoto(claims, { '0': 'alheio/foto.jpg' })).rejects.toMatchObject({ status: 403 });
    expect(storage.enviar).not.toHaveBeenCalled();
    expect(storage.apagar).not.toHaveBeenCalled();
  });

  it('foto só aceita imagem raster: HTML/SVG → 415', async () => {
    repo.donoFoto.mockResolvedValue(true);
    for (const tipo of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
      const req = fakeReq('<x>', { 'content-type': tipo });
      await expect(ctrl.subirFoto(claims, { '0': 'meu/f.jpg' }, req)).rejects.toMatchObject({ status: 415 });
    }
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('download sai com nosniff', async () => {
    storage.obter.mockResolvedValueOnce(objeto());
    const res = fakeRes();
    await ctrl.fotoPublica({ '0': 'f.jpg' }, undefined, res as unknown as Response);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('upload com Content-Length acima do teto → 413 sem tocar no S3', async () => {
    const req = fakeReq('x', { 'content-type': 'image/jpeg', 'content-length': String(6 * 1024 * 1024) });
    repo.donoFoto.mockResolvedValueOnce(true);
    await expect(ctrl.subirFoto(claims, { '0': 'f.jpg' }, req)).rejects.toMatchObject({
      status: 413,
      response: { codigo: 'arquivo_grande_demais' },
    });
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('documento fora do prefixo do corretor → 403', async () => {
    repo.corretorId.mockResolvedValueOnce('owner');
    const req = fakeReq('x', { 'content-type': 'application/pdf' });
    await expect(ctrl.subirDocumento(claims, { '0': 'outro/contratos/a.pdf' }, req)).rejects.toMatchObject({ status: 403 });
    expect(storage.enviar).not.toHaveBeenCalled();
  });

  it('documento no prefixo do corretor sobe por streaming íntegro (§0.6)', async () => {
    repo.corretorId.mockResolvedValueOnce('owner');
    let recebido = '';
    storage.enviar.mockImplementationOnce(async (_b, _k, corpo) => {
      recebido = await coletar(corpo as Readable);
    });
    const req = fakeReq(Buffer.from('conteudo-binario'), { 'content-type': 'application/pdf' });
    const r = await ctrl.subirDocumento(claims, { '0': 'owner/contratos/a.pdf' }, req);
    expect(r.key).toBe('owner/contratos/a.pdf');
    expect(recebido).toBe('conteudo-binario');
  });

  it('upload do inbox exige bucket conhecido e o prefixo do corretor', async () => {
    const req = fakeReq('x', { 'content-type': 'audio/ogg' });
    await expect(ctrl.subirInbox(claims, 'bucket-errado', { '0': 'owner/r/a.ogg' }, req)).rejects.toMatchObject({ status: 400 });
  });

  it('preparar inbox espelha o buildAttachmentPath: corretor/request_id/nome', async () => {
    repo.corretorId.mockResolvedValueOnce('owner');
    const r = await ctrl.prepararInbox(claims, { request_id: 'request', name: 'contrato.pdf', mime: 'application/pdf', size: 10 });
    expect(r).toEqual({ storage_path: 'owner/request/contrato.pdf' });
  });

  it('apagar documento confere o dono antes; idempotente (204)', async () => {
    repo.donoDocumento.mockResolvedValueOnce(true);
    storage.apagar.mockResolvedValueOnce(undefined);
    await ctrl.apagarDocumento(claims, { '0': 'meu/x.pdf' });
    expect(storage.apagar).toHaveBeenCalledWith('documentos', 'meu/x.pdf');
  });

  describe('H1: vídeo/foto na origem da API nunca vira HTML ativo', () => {
    it('upload de vídeo recusa tipo fora da allowlist (HTML com nome .mp4, SVG, XHTML, octet-stream) → 415 sem tocar no S3', async () => {
      repo.corretorId.mockResolvedValue('owner');
      for (const tipo of ['text/html', 'text/html; charset=utf-8', 'image/svg+xml', 'application/xhtml+xml', 'application/octet-stream', 'video/html']) {
        const req = fakeReq('<script>alert(1)</script>', { 'content-type': tipo });
        await expect(ctrl.subirVideo(claims, { '0': 'owner/geral/tour.mp4' }, req)).rejects.toMatchObject({
          status: 415,
          response: { codigo: 'tipo_nao_permitido' },
        });
      }
      const semTipo = fakeReq('<script>alert(1)</script>');
      await expect(ctrl.subirVideo(claims, { '0': 'owner/geral/tour.mp4' }, semTipo)).rejects.toMatchObject({ status: 415 });
      expect(storage.enviar).not.toHaveBeenCalled();
    });

    it('upload de vídeo aceita os tipos que o front envia e grava o tipo normalizado', async () => {
      repo.corretorId.mockResolvedValue('owner');
      storage.enviar.mockResolvedValue(undefined);
      for (const tipo of ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo']) {
        await ctrl.subirVideo(claims, { '0': 'owner/geral/v' }, fakeReq('x', { 'content-type': tipo }));
        expect(storage.enviar).toHaveBeenLastCalledWith('videos', 'owner/geral/v', expect.anything(), tipo);
      }
      await ctrl.subirVideo(claims, { '0': 'owner/geral/v' }, fakeReq('x', { 'content-type': 'Video/MP4; codecs=avc1' }));
      expect(storage.enviar).toHaveBeenLastCalledWith('videos', 'owner/geral/v', expect.anything(), 'video/mp4');
    });

    it('vídeo público legado com metadata text/html sai como download inerte (octet-stream + attachment + CSP sandbox)', async () => {
      storage.obter.mockResolvedValueOnce(objeto({ contentType: 'text/html' }));
      const res = fakeRes();
      await ctrl.videoPublico({ '0': 'owner/geral/x.mp4' }, undefined, res as unknown as Response);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-disposition']).toBe('attachment');
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('vídeo público com tipo permitido segue tocável, com Range e CSP, sem attachment', async () => {
      storage.obter.mockResolvedValueOnce(objeto({ statusCode: 206, contentRange: 'bytes 0-1/500', contentType: 'video/webm' }));
      const res = fakeRes();
      await ctrl.videoPublico({ '0': 'v.webm' }, 'bytes=0-1', res as unknown as Response);
      expect(res.codigo).toBe(206);
      expect(res.headers['content-type']).toBe('video/webm');
      expect(res.headers['content-range']).toBe('bytes 0-1/500');
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    });

    it('foto pública legada com metadata text/html ou SVG sai como download inerte', async () => {
      for (const tipo of ['text/html', 'image/svg+xml']) {
        storage.obter.mockResolvedValueOnce(objeto({ contentType: tipo }));
        const res = fakeRes();
        await ctrl.fotoPublica({ '0': 'imovel/1/f.jpg' }, undefined, res as unknown as Response);
        expect(res.headers['content-type']).toBe('application/octet-stream');
        expect(res.headers['content-disposition']).toBe('attachment');
      }
    });

    it('download privado também sai com CSP sandbox', async () => {
      repo.donoDocumento.mockResolvedValueOnce(true);
      storage.obter.mockResolvedValueOnce(objeto({ contentType: 'text/html' }));
      const res = fakeRes();
      await ctrl.baixarDocumento(claims, { '0': 'meu/x.html' }, undefined, res as unknown as Response);
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    });
  });

  it('key inválida no splat → 400 key_invalida', async () => {
    const res = fakeRes();
    await expect(ctrl.fotoPublica({ '0': '../segredo' }, undefined, res as unknown as Response)).rejects.toMatchObject({
      status: 400,
      response: { codigo: 'key_invalida' },
    });
  });
});
