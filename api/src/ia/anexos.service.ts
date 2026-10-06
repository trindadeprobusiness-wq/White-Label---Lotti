import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Readable } from 'node:stream';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { StorageService } from '../storage/storage.service';
import { FORMATO_UUID } from './acoes';
import { extrair } from './extracao';
import { codigoDe, erroApi } from './ia.erros';

/** Mesmo bucket e mesmo layout de key da Edge Function: ai-attachments/<user_id>/<epoch ms>.<ext>. */
export const BUCKET_ANEXOS_IA = 'ai-attachments';
/** 50 MB por causa do vídeo. */
export const MAX_ANEXO_IA = 50 * 1024 * 1024;
export const MIMES_ANEXO_IA = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
]);

/** O arquivo como o multer (memória) entrega. */
export interface ArquivoRecebido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface RespostaAnexo {
  storage_path: string;
  extracted_text: string;
  metadata: Record<string, unknown>;
  file_name: string;
  file_type: string;
  file_size: number;
}

/** O busboy lê o filename do multipart como latin1; o navegador manda UTF-8. Desfaz quando é UTF-8 válido. */
export function nomeOriginal(bruto: string): string {
  const utf8 = Buffer.from(bruto, 'latin1').toString('utf8');
  return utf8.includes('�') ? bruto : utf8;
}

/**
 * Porte do ai-process-file: sobe o anexo no Garage (StorageService) e extrai o texto. Sem cota, como a
 * função. Com message_id, grava ai_attachments no TenantDb (RLS: só em mensagem de conversa da conta);
 * a função ignorava a falha desse insert, aqui também (vira log).
 */
@Injectable()
export class AnexosIaService {
  private readonly log = new Logger('IaAnexos');
  /** Relógio injetável para os testes conferirem a key. */
  agora: () => number = () => Date.now();

  constructor(private readonly db: TenantDb, private readonly storage: StorageService) {}

  async processar(claims: SupabaseClaims, arquivo: ArquivoRecebido | undefined, messageId?: unknown): Promise<RespostaAnexo> {
    if (!arquivo) throw erroApi(400, 'arquivo_ausente', 'Nenhum arquivo enviado.');
    if (arquivo.size > MAX_ANEXO_IA) throw erroApi(400, 'arquivo_grande_demais', 'Arquivo muito grande (máx. 50 MB).');
    if (!MIMES_ANEXO_IA.has(arquivo.mimetype)) throw erroApi(400, 'tipo_nao_permitido', 'Tipo de arquivo não permitido.');

    const nome = nomeOriginal(arquivo.originalname);
    const extensao = (nome.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'bin';
    const storagePath = `${claims.sub}/${this.agora()}.${extensao}`;

    try {
      await this.storage.enviar(BUCKET_ANEXOS_IA, storagePath, Readable.from(arquivo.buffer), arquivo.mimetype);
    } catch (e) {
      if (e instanceof HttpException) throw e; // 503 storage_indisponivel
      this.log.error(`anexo de IA não enviado ${codigoDe(e)}`);
      throw erroApi(500, 'envio_falhou', 'Não foi possível enviar o arquivo.');
    }

    const bytes = new Uint8Array(arquivo.buffer.buffer, arquivo.buffer.byteOffset, arquivo.buffer.byteLength);
    const { texto, metadata } = extrair(bytes, arquivo.mimetype, nome, extensao, storagePath);

    if (typeof messageId === 'string' && FORMATO_UUID.test(messageId)) {
      try {
        await this.db.run(claims, (tx) => tx.$executeRaw(Prisma.sql`
          insert into public.ai_attachments (message_id, file_name, file_type, file_size, storage_path, extracted_text, metadata)
          values (${messageId}::uuid, ${nome}::text, ${arquivo.mimetype}::text, ${arquivo.size}::int, ${storagePath}::text,
            ${texto}::text, ${JSON.stringify(metadata)}::jsonb)`));
      } catch (e) {
        this.log.warn(`ai_attachments não gravado ${codigoDe(e)}`);
      }
    }

    return {
      storage_path: storagePath,
      extracted_text: texto,
      metadata,
      file_name: nome,
      file_type: arquivo.mimetype,
      file_size: arquivo.size,
    };
  }
}
