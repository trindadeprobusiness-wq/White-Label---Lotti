import {
  ArgumentsHost, BadRequestException, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, Param, Patch, PayloadTooLargeException,
  Post, Req, Res, UploadedFile, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { AcaoIaService, RespostaAcao } from './acao.service';
import { AnexosIaService, ArquivoRecebido, MAX_ANEXO_IA, RespostaAnexo } from './anexos.service';
import { AssistenteService, EventoAssistente } from './assistente.service';
import { FotosIaService } from './fotos.service';
import { ID_IA } from './ia-conversas.controller';
import {
  AnalisarFotoDto, AnalisarFotosImovelDto, AssistenteDto, DecisaoAcaoDto, DescricaoImovelDto, MensagemWhatsappDto, SugestaoInboxDto,
} from './ia.dto';
import { MensagensIaService } from './mensagens.service';

/** Os mesmos cabeçalhos do @Sse do Nest (que só existe para GET); o assistente é POST com corpo. */
export const CABECALHOS_SSE = {
  'Content-Type': 'text/event-stream',
  Connection: 'keep-alive',
  'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0, no-transform',
  Pragma: 'no-cache',
  Expire: '0',
  'X-Accel-Buffering': 'no',
} as const;

/** Erros do multer no upload do anexo, em português e no formato da API. */
@Catch(PayloadTooLargeException, BadRequestException)
export class FiltroAnexoIa implements ExceptionFilter {
  catch(e: PayloadTooLargeException | BadRequestException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof PayloadTooLargeException) {
      res.status(413).json({ statusCode: 413, codigo: 'arquivo_grande_demais', message: 'Arquivo muito grande (máx. 50 MB).' });
      return;
    }
    res.status(400).json({ statusCode: 400, codigo: 'arquivo_invalido', message: 'Envie um único arquivo no campo "file".' });
  }
}

@Controller('ia')
@UseGuards(SupabaseAuthGuard)
export class IaController {
  constructor(
    private readonly assistente: AssistenteService,
    private readonly acao: AcaoIaService,
    private readonly anexos: AnexosIaService,
    private readonly fotos: FotosIaService,
    private readonly mensagens: MensagensIaService,
  ) {}

  /**
   * ai-assistant. Sessão, limite, cota, corpo e conversa são conferidos antes do primeiro byte: aí o
   * erro sai como JSON com status. Depois disso é text/event-stream com os eventos da função.
   * O navegador abre com fetch + Authorization (o token nunca vai na URL).
   */
  @Post('assistente')
  async conversar(
    @Claims() claims: SupabaseClaims,
    @Body() dto: AssistenteDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const sessao = await this.assistente.preparar(claims, dto);
    const controle = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controle.abort();
    });
    req.socket?.setKeepAlive(true);
    req.socket?.setNoDelay(true);
    req.socket?.setTimeout(0);
    res.writeHead(200, CABECALHOS_SSE);
    res.flushHeaders();
    const emitir = (evento: EventoAssistente) => {
      if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(evento)}\n\n`);
    };
    await this.assistente.transmitir(sessao, emitir, controle.signal);
    if (!res.writableEnded) res.end();
  }

  /** ai-action: confirmar ou recusar uma proposta do assistente. */
  @Post('acao')
  @HttpCode(200)
  decidir(@Claims() claims: SupabaseClaims, @Body() dto: DecisaoAcaoDto): Promise<RespostaAcao> {
    return this.acao.decidir(claims, dto);
  }

  /** ai-process-file: multipart com `file` (e `message_id` opcional), como a função. */
  @Post('anexos')
  @HttpCode(200)
  @UseFilters(new FiltroAnexoIa())
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ANEXO_IA, files: 1, fields: 5 } }))
  processarAnexo(
    @Claims() claims: SupabaseClaims,
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
    @Body('message_id') messageId?: string,
  ): Promise<RespostaAnexo> {
    return this.anexos.processar(claims, arquivo, messageId);
  }

  @Post('analisar-foto')
  @HttpCode(200)
  analisarFoto(@Body() dto: AnalisarFotoDto) {
    return this.fotos.analisarFoto(dto);
  }

  @Post('analisar-fotos-imovel')
  @HttpCode(200)
  analisarFotosImovel(@Body() dto: AnalisarFotosImovelDto) {
    return this.fotos.analisarFotosImovel(dto);
  }

  @Patch('imoveis/:id/descricao')
  salvarDescricao(@Claims() claims: SupabaseClaims, @Param('id', ID_IA) id: string, @Body() dto: DescricaoImovelDto) {
    return this.fotos.salvarDescricao(claims, id, dto.descricao);
  }

  @Post('mensagem-whatsapp')
  @HttpCode(200)
  gerarWhatsapp(@Body() dto: MensagemWhatsappDto) {
    return this.mensagens.gerarWhatsapp(dto);
  }

  @Get('sugestao-inbox/imoveis')
  imoveisParaSugestao(@Claims() claims: SupabaseClaims) {
    return this.mensagens.imoveisParaSugestao(claims);
  }

  @Post('sugestao-inbox')
  @HttpCode(200)
  sugerirResposta(@Claims() claims: SupabaseClaims, @Body() dto: SugestaoInboxDto) {
    return this.mensagens.sugerirResposta(claims, dto);
  }
}
