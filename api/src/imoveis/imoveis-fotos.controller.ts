import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { erroApi } from './imoveis.erros';
import { CriarFotoDto, OrdemFotosDto, ResumoFotosDto } from './imoveis-fotos.dto';
import { FotoResumo, ImoveisFotosService, LinhaFoto } from './imoveis-fotos.service';

const ID = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

/**
 * Linhas de imovel_fotos (bloco B1). Nenhuma rota aqui tem um segmento só depois de /imoveis, então
 * nada colide com GET/PATCH/DELETE /imoveis/:id do ImoveisController.
 */
@Controller('imoveis')
@UseGuards(SupabaseAuthGuard)
export class ImoveisFotosController {
  constructor(private readonly fotos: ImoveisFotosService) {}

  /** Miniaturas da lista de imóveis. POST porque a lista de ids não cabe numa URL. */
  @Post('fotos/resumo')
  @HttpCode(200)
  resumo(@Claims() claims: SupabaseClaims, @Body() dto: ResumoFotosDto): Promise<FotoResumo[]> {
    return this.fotos.resumo(claims, dto);
  }

  @Delete('fotos/:fotoId')
  @HttpCode(204)
  remover(@Claims() claims: SupabaseClaims, @Param('fotoId', ID) fotoId: string): Promise<void> {
    return this.fotos.remover(claims, fotoId);
  }

  @Get(':id/fotos')
  listar(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<LinhaFoto[]> {
    return this.fotos.listar(claims, id);
  }

  @Post(':id/fotos')
  criar(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: CriarFotoDto): Promise<LinhaFoto> {
    return this.fotos.criar(claims, id, dto);
  }

  @Patch(':id/fotos/ordem')
  reordenar(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: OrdemFotosDto): Promise<{ atualizadas: number }> {
    return this.fotos.reordenar(claims, id, dto);
  }

  @Patch(':id/fotos/:fotoId/principal')
  definirPrincipal(
    @Claims() claims: SupabaseClaims,
    @Param('id', ID) id: string,
    @Param('fotoId', ID) fotoId: string,
  ): Promise<{ imovel_id: string; foto_id: string }> {
    return this.fotos.definirPrincipal(claims, id, fotoId);
  }
}
