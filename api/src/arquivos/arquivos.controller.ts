import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PassThrough, type Readable } from 'node:stream';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { StorageService, type ObjetoLido } from '../storage/storage.service';
import { ERROS_ARQUIVO } from '../storage/storage.erros';
import { ArquivosRepo, type BucketInbox } from './arquivos.repo';
import { PrepararInboxDto, validarKey } from './arquivos.dto';

const MB = 1024 * 1024;
const MAX_FOTO = 5 * MB;
const MAX_VIDEO = 500 * MB;
const MAX_DOCUMENTO = 25 * MB;
const MAX_INBOX = 100 * MB;

const BUCKET_FOTOS = 'imoveis-fotos';
const BUCKET_VIDEOS = 'videos';
const BUCKET_DOCUMENTOS = 'documentos';
const BUCKET_AI = 'ai-attachments';
const BUCKETS_INBOX: ReadonlyArray<BucketInbox> = ['lotti-inbox-files', 'lotti-inbox-audio'];

/** O splat `*key` chega no Express sob o parâmetro '0'. */
function splat(params: Record<string, string>): string {
  return validarKey(params['0']);
}

function bucketInbox(valor: string): BucketInbox {
  const bucket = BUCKETS_INBOX.find((b) => b === valor);
  if (!bucket) throw ERROS_ARQUIVO.keyInvalida();
  return bucket;
}

/** Content-Type cru da requisição, sem o `; charset=...`, ou octet-stream. */
function tipoDoUpload(req: Request): string {
  const bruto = req.headers['content-type'];
  const valor = (Array.isArray(bruto) ? bruto[0] : bruto)?.split(';')[0]?.trim();
  return valor || 'application/octet-stream';
}

/**
 * Limita o corpo recebido ao teto do grupo. O teto é conferido primeiro pelo Content-Length (413
 * antes de ler um byte) e depois pelo próprio stream, para um Content-Length mentiroso não furar o
 * limite. O corpo nunca é bufferizado inteiro — vai direto para o Upload multipart do S3.
 */
function corpoLimitado(req: Request, max: number): Readable {
  const declarado = Number(req.headers['content-length']);
  if (Number.isFinite(declarado) && declarado > max) throw ERROS_ARQUIVO.grandeDemais();
  let total = 0;
  let estourou = false;
  const saida = new PassThrough();
  req.on('data', (pedaco: Buffer) => {
    if (estourou) return;
    total += pedaco.length;
    if (total > max) {
      estourou = true;
      req.destroy();
      saida.destroy(ERROS_ARQUIVO.grandeDemais());
      return;
    }
    saida.write(pedaco);
  });
  req.on('end', () => {
    if (!estourou) saida.end();
  });
  req.on('error', (e) => saida.destroy(e));
  return saida;
}

@Controller('arquivos')
export class ArquivosController {
  constructor(
    private readonly storage: StorageService,
    private readonly repo: ArquivosRepo,
  ) {}

  // ------------------------------------------------------------ públicas (sem guard, só GET)

  @Get('publico/foto/*')
  async fotoPublica(
    @Param() params: Record<string, string>,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const key = splat(params);
    const obj = await this.storage.obter(BUCKET_FOTOS, key);
    res.setHeader('Cache-Control', 'public, max-age=300');
    this.servir(res, obj, ifNoneMatch);
  }

  @Get('publico/video/*')
  async videoPublico(
    @Param() params: Record<string, string>,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const key = splat(params);
    const obj = await this.storage.obter(BUCKET_VIDEOS, key, range);
    res.setHeader('Cache-Control', 'public, max-age=300');
    this.servir(res, obj);
  }

  // ------------------------------------------------------------ upload (guard, binário cru)

  @Put('foto/*')
  @UseGuards(SupabaseAuthGuard)
  async subirFoto(@Param() params: Record<string, string>, @Req() req: Request): Promise<{ ok: true; key: string }> {
    const key = splat(params);
    await this.storage.enviar(BUCKET_FOTOS, key, corpoLimitado(req, MAX_FOTO), tipoDoUpload(req));
    return { ok: true, key };
  }

  @Put('video/*')
  @UseGuards(SupabaseAuthGuard)
  async subirVideo(
    @Claims() claims: SupabaseClaims,
    @Param() params: Record<string, string>,
    @Req() req: Request,
  ): Promise<{ ok: true; key: string }> {
    const key = splat(params);
    await this.exigirPrefixo(claims, key);
    await this.storage.enviar(BUCKET_VIDEOS, key, corpoLimitado(req, MAX_VIDEO), tipoDoUpload(req));
    return { ok: true, key };
  }

  @Put('documento/*')
  @UseGuards(SupabaseAuthGuard)
  async subirDocumento(
    @Claims() claims: SupabaseClaims,
    @Param() params: Record<string, string>,
    @Req() req: Request,
  ): Promise<{ ok: true; key: string }> {
    const key = splat(params);
    await this.exigirPrefixo(claims, key);
    await this.storage.enviar(BUCKET_DOCUMENTOS, key, corpoLimitado(req, MAX_DOCUMENTO), tipoDoUpload(req));
    return { ok: true, key };
  }

  @Post('inbox/preparar')
  @UseGuards(SupabaseAuthGuard)
  async prepararInbox(
    @Claims() claims: SupabaseClaims,
    @Body() dto: PrepararInboxDto,
  ): Promise<{ storage_path: string }> {
    const corretor = await this.repo.corretorId(claims);
    if (!corretor) throw ERROS_ARQUIVO.deOutraConta();
    const nome = dto.name.replace(/[\\/]/g, '_');
    return { storage_path: `${corretor}/${dto.request_id}/${nome}` };
  }

  @Put('inbox/:bucket/*')
  @UseGuards(SupabaseAuthGuard)
  async subirInbox(
    @Claims() claims: SupabaseClaims,
    @Param('bucket') bucketBruto: string,
    @Param() params: Record<string, string>,
    @Req() req: Request,
  ): Promise<{ ok: true; key: string }> {
    const bucket = bucketInbox(bucketBruto);
    const key = splat(params);
    await this.exigirPrefixo(claims, key);
    await this.storage.enviar(bucket, key, corpoLimitado(req, MAX_INBOX), tipoDoUpload(req));
    return { ok: true, key };
  }

  // ------------------------------------------------------------ download privado (guard + dono §3)

  @Get('documento/*')
  @UseGuards(SupabaseAuthGuard)
  async baixarDocumento(
    @Claims() claims: SupabaseClaims,
    @Param() params: Record<string, string>,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const key = splat(params);
    if (!(await this.repo.donoDocumento(claims, key))) throw ERROS_ARQUIVO.deOutraConta();
    const obj = await this.storage.obter(BUCKET_DOCUMENTOS, key, range);
    res.setHeader('Cache-Control', 'private, no-store');
    this.servir(res, obj);
  }

  @Get('anexo-ia/*')
  @UseGuards(SupabaseAuthGuard)
  async baixarAnexoIa(
    @Claims() claims: SupabaseClaims,
    @Param() params: Record<string, string>,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const key = splat(params);
    if (!(await this.repo.donoAnexoIa(claims, key))) throw ERROS_ARQUIVO.deOutraConta();
    const obj = await this.storage.obter(BUCKET_AI, key, range);
    res.setHeader('Cache-Control', 'private, no-store');
    this.servir(res, obj);
  }

  @Get('inbox/:bucket/*')
  @UseGuards(SupabaseAuthGuard)
  async baixarInbox(
    @Claims() claims: SupabaseClaims,
    @Param('bucket') bucketBruto: string,
    @Param() params: Record<string, string>,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const bucket = bucketInbox(bucketBruto);
    const key = splat(params);
    if (!(await this.repo.donoInbox(claims, key))) throw ERROS_ARQUIVO.deOutraConta();
    const obj = await this.storage.obter(bucket, key, range);
    res.setHeader('Cache-Control', 'private, no-store');
    this.servir(res, obj);
  }

  // ------------------------------------------------------------ delete (guard, idempotente)

  @Delete('foto/*')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(204)
  async apagarFoto(@Param() params: Record<string, string>): Promise<void> {
    await this.storage.apagar(BUCKET_FOTOS, splat(params));
  }

  @Delete('video/*')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(204)
  async apagarVideo(@Claims() claims: SupabaseClaims, @Param() params: Record<string, string>): Promise<void> {
    const key = splat(params);
    await this.exigirPrefixo(claims, key);
    await this.storage.apagar(BUCKET_VIDEOS, key);
  }

  @Delete('documento/*')
  @UseGuards(SupabaseAuthGuard)
  @HttpCode(204)
  async apagarDocumento(@Claims() claims: SupabaseClaims, @Param() params: Record<string, string>): Promise<void> {
    const key = splat(params);
    if (!(await this.repo.donoDocumento(claims, key))) throw ERROS_ARQUIVO.deOutraConta();
    await this.storage.apagar(BUCKET_DOCUMENTOS, key);
  }

  // ------------------------------------------------------------ auxiliares

  /** Upload de bucket privado só na própria pasta do corretor (ainda não há linha para conferir dono). */
  private async exigirPrefixo(claims: SupabaseClaims, key: string): Promise<void> {
    const corretor = await this.repo.corretorId(claims);
    if (!corretor || !key.startsWith(`${corretor}/`)) throw ERROS_ARQUIVO.deOutraConta();
  }

  /** Escreve cabeçalhos antes do primeiro byte e faz pipe do stream do S3 para a resposta. */
  private servir(res: Response, obj: ObjetoLido, ifNoneMatch?: string): void {
    if (obj.etag) res.setHeader('ETag', obj.etag);
    res.setHeader('Content-Type', obj.contentType ?? 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    if (ifNoneMatch && obj.etag && ifNoneMatch === obj.etag) {
      obj.corpo.destroy();
      res.status(304).end();
      return;
    }
    if (obj.contentRange) res.setHeader('Content-Range', obj.contentRange);
    if (typeof obj.contentLength === 'number') res.setHeader('Content-Length', String(obj.contentLength));
    res.status(obj.statusCode);
    obj.corpo.on('error', () => res.destroy());
    obj.corpo.pipe(res);
  }
}
