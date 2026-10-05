import { Readable } from 'node:stream';

const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation((cfg: unknown) => ({ cfg, send })),
  GetObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ tipo: 'get', input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ tipo: 'delete', input })),
  HeadObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ tipo: 'head', input })),
}));

const uploadDone = jest.fn();
const UploadMock = jest.fn().mockImplementation(() => ({ done: uploadDone }));
jest.mock('@aws-sdk/lib-storage', () => ({ Upload: UploadMock }));

// eslint-disable-next-line import/first
import { S3Client } from '@aws-sdk/client-s3';
// eslint-disable-next-line import/first
import { StorageService } from './storage.service';

const SECRET = 'segredo-super-secreto-123';

function erro(nome: string, status?: number): Error & { name: string; $metadata?: { httpStatusCode: number } } {
  const e = new Error(nome) as Error & { name: string; $metadata?: { httpStatusCode: number } };
  e.name = nome;
  if (status) e.$metadata = { httpStatusCode: status };
  return e;
}

describe('StorageService', () => {
  const envOriginal = { ...process.env };
  let service: StorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.S3_ENDPOINT = 'http://garage.railway.internal:3900';
    process.env.S3_REGION = 'garage';
    process.env.S3_ACCESS_KEY_ID = 'chave-de-acesso';
    process.env.S3_SECRET_ACCESS_KEY = SECRET;
    process.env.S3_FORCE_PATH_STYLE = 'true';
    service = new StorageService();
  });

  afterEach(() => {
    process.env = { ...envOriginal };
  });

  it('disponivel reflete a presença das variáveis S3_*', () => {
    expect(service.disponivel()).toBe(true);
    delete process.env.S3_ACCESS_KEY_ID;
    expect(service.disponivel()).toBe(false);
  });

  it('config ausente → 503 storage_indisponivel, sem tocar no S3', async () => {
    delete process.env.S3_SECRET_ACCESS_KEY;
    await expect(service.obter('documentos', 'a/b.pdf')).rejects.toMatchObject({
      status: 503,
      response: { codigo: 'storage_indisponivel' },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('obter sem range devolve 200 com os metadados', async () => {
    send.mockResolvedValueOnce({
      Body: Readable.from('conteudo'),
      ContentType: 'application/pdf',
      ContentLength: 8,
      ETag: '"abc"',
    });
    const obj = await service.obter('documentos', 'a/b.pdf');
    expect(obj.statusCode).toBe(200);
    expect(obj.contentType).toBe('application/pdf');
    expect(obj.contentLength).toBe(8);
    expect(obj.etag).toBe('"abc"');
  });

  it('obter com Range devolve 206 e o Content-Range do S3', async () => {
    send.mockResolvedValueOnce({
      Body: Readable.from('x'),
      ContentType: 'video/mp4',
      ContentLength: 2,
      ContentRange: 'bytes 0-1/500',
    });
    const obj = await service.obter('videos', 'v.mp4', 'bytes=0-1');
    expect(obj.statusCode).toBe(206);
    expect(obj.contentRange).toBe('bytes 0-1/500');
  });

  it('NoSuchKey vira 404 arquivo_nao_encontrado', async () => {
    send.mockRejectedValueOnce(erro('NoSuchKey'));
    await expect(service.obter('documentos', 'x.pdf')).rejects.toMatchObject({
      status: 404,
      response: { codigo: 'arquivo_nao_encontrado' },
    });
  });

  it('404 pelo $metadata vira 404', async () => {
    send.mockRejectedValueOnce(erro('SomethingElse', 404));
    await expect(service.obter('documentos', 'x.pdf')).rejects.toMatchObject({ status: 404 });
  });

  it('enviar usa o Upload multipart e chama done (stream, sem bufferizar)', async () => {
    uploadDone.mockResolvedValueOnce(undefined);
    const corpo = Readable.from('dados');
    await service.enviar('documentos', 'a/b.pdf', corpo, 'application/pdf');
    expect(UploadMock).toHaveBeenCalledTimes(1);
    const params = UploadMock.mock.calls[0][0].params;
    expect(params).toMatchObject({ Bucket: 'documentos', Key: 'a/b.pdf', ContentType: 'application/pdf' });
    expect(params.Body).toBe(corpo);
    expect(uploadDone).toHaveBeenCalledTimes(1);
  });

  it('existe devolve null quando o objeto não existe', async () => {
    send.mockRejectedValueOnce(erro('NotFound', 404));
    expect(await service.existe('documentos', 'x.pdf')).toBeNull();
  });

  it('reaproveita o mesmo S3Client enquanto a config não muda', async () => {
    send.mockResolvedValue({ Body: Readable.from('a') });
    await service.obter('documentos', 'a.pdf');
    await service.obter('documentos', 'b.pdf');
    expect(S3Client).toHaveBeenCalledTimes(1);
  });

  it('nunca registra a credencial em log', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    send.mockResolvedValueOnce({ Body: Readable.from('a') });
    uploadDone.mockResolvedValueOnce(undefined);
    await service.obter('documentos', 'a.pdf');
    await service.enviar('documentos', 'a.pdf', Readable.from('a'), 'text/plain');
    for (const espiao of espioes) {
      for (const chamada of espiao.mock.calls) {
        expect(JSON.stringify(chamada)).not.toContain(SECRET);
      }
      espiao.mockRestore();
    }
  });
});
