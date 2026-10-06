import { Body, Controller, HttpException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { validarKey } from '../arquivos/arquivos.dto';
import { StorageService } from '../storage/storage.service';

const BUCKETS = new Set(['lotti-inbox-files', 'lotti-inbox-audio']);
function bucket(value: string): string {
  if (!BUCKETS.has(value)) throw new HttpException({ error: 'invalid_bucket' }, 400);
  return value;
}
function splat(params: Record<string, string>): string { return validarKey(params['0']); }

@Controller('whatsapp/runtime/storage')
@UseGuards(AgentTokenGuard)
export class WhatsappRuntimeController {
  constructor(private readonly storage: StorageService) {}

  @Post(':bucket/inspect/*')
  async inspect(@Param('bucket') bucketValue: string, @Param() params: Record<string, string>) {
    const result = await this.storage.existe(bucket(bucketValue), splat(params));
    if (!result) throw new HttpException({ error: 'file_unavailable' }, 404);
    return { size: result.contentLength, mime: result.contentType };
  }

  @Post(':bucket/sign/*')
  async sign(@Param('bucket') bucketValue: string, @Param() params: Record<string, string>, @Body() body: { expiresIn?: number }) {
    const expiresIn = Math.min(300, Math.max(30, Number(body?.expiresIn) || 300));
    return { url: await this.storage.assinarLeitura(bucket(bucketValue), splat(params), expiresIn) };
  }

  @Put(':bucket/*')
  async upload(@Param('bucket') bucketValue: string, @Param() params: Record<string, string>, @Req() req: Request) {
    const mime = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0];
    await this.storage.enviar(bucket(bucketValue), splat(params), req, mime);
    return { ok: true };
  }
}
