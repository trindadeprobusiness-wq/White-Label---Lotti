import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
import { ConfigStorage, lerConfigStorage } from './storage.config';
import { ERROS_ARQUIVO } from './storage.erros';

/** Resposta de um download: o corpo é um stream, nunca bufferizado inteiro na memória. */
export interface ObjetoLido {
  corpo: Readable;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  contentRange?: string;
  statusCode: 200 | 206;
}

export interface InfoObjeto {
  contentLength?: number;
  contentType?: string;
  etag?: string;
}

/**
 * Cliente S3 único para o Garage. Recebe (bucket, key) já validados; nunca monta SQL/shell. Config
 * ausente vira 503; NoSuchKey/404 vira 404. Nunca registra credencial em log. O download devolve o
 * stream do S3 (com Range → 206) e o upload usa o Upload multipart do lib-storage, que consome o
 * corpo como stream — vídeo de 500 MB não é bufferizado.
 */
@Injectable()
export class StorageService {
  private cliente: S3Client | null = null;
  private assinatura = '';

  /** true quando as variáveis S3_* obrigatórias estão presentes. */
  disponivel(): boolean {
    return lerConfigStorage() !== null;
  }

  private cfg(): ConfigStorage {
    const cfg = lerConfigStorage();
    if (!cfg) throw ERROS_ARQUIVO.indisponivel();
    return cfg;
  }

  /** Reaproveita o S3Client enquanto a config não muda (os testes trocam env e forçam novo cliente). */
  private s3(): S3Client {
    const cfg = this.cfg();
    const assinatura = `${cfg.endpoint}|${cfg.region}|${cfg.accessKeyId}|${cfg.forcePathStyle}`;
    if (!this.cliente || this.assinatura !== assinatura) {
      this.cliente = new S3Client({
        endpoint: cfg.endpoint,
        region: cfg.region,
        forcePathStyle: cfg.forcePathStyle,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      });
      this.assinatura = assinatura;
    }
    return this.cliente;
  }

  /** Verdadeiro 404 do S3: NoSuchKey/NotFound ou httpStatusCode 404. Qualquer outro erro sobe como veio. */
  private traduzir(e: unknown): never {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      throw ERROS_ARQUIVO.naoEncontrado();
    }
    throw e;
  }

  async obter(bucket: string, key: string, range?: string): Promise<ObjetoLido> {
    const s3 = this.s3();
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }));
      const statusCode: 200 | 206 = range && r.ContentRange ? 206 : 200;
      return {
        corpo: r.Body as unknown as Readable,
        contentType: r.ContentType,
        contentLength: typeof r.ContentLength === 'number' ? r.ContentLength : undefined,
        etag: r.ETag,
        contentRange: r.ContentRange,
        statusCode,
      };
    } catch (e) {
      this.traduzir(e);
    }
  }

  async enviar(bucket: string, key: string, corpo: Readable, contentType?: string): Promise<void> {
    const s3 = this.s3();
    const upload = new Upload({
      client: s3,
      params: { Bucket: bucket, Key: key, Body: corpo, ContentType: contentType },
    });
    await upload.done();
  }

  async apagar(bucket: string, key: string): Promise<void> {
    const s3 = this.s3();
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /** HEAD: devolve metadados ou null quando o objeto não existe. */
  async existe(bucket: string, key: string): Promise<InfoObjeto | null> {
    const s3 = this.s3();
    try {
      const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        contentLength: typeof r.ContentLength === 'number' ? r.ContentLength : undefined,
        contentType: r.ContentType,
        etag: r.ETag,
      };
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw e;
    }
  }
}
