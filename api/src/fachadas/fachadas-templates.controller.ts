import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { FachadasTemplatesService } from './fachadas-templates.service';
import { ID } from './fachadas.controller';
import { CriarTemplateDto, ListarTemplatesDto, PorImagemDto } from './fachadas.dto';
import { Linha } from './fachadas.service';

// A rota estática por-imagem é declarada ANTES da rota de id (contrato §1.1).
@Controller('fachadas/templates')
@UseGuards(SupabaseAuthGuard)
export class FachadasTemplatesController {
  constructor(private readonly templates: FachadasTemplatesService) {}

  @Get('por-imagem')
  porImagem(@Claims() claims: SupabaseClaims, @Query() q: PorImagemDto): Promise<Linha | null> {
    return this.templates.porImagem(claims, q);
  }

  @Get()
  listar(@Claims() claims: SupabaseClaims, @Query() q: ListarTemplatesDto): Promise<Linha[]> {
    return this.templates.listar(claims, q);
  }

  @Post()
  criar(@Claims() claims: SupabaseClaims, @Body() dto: CriarTemplateDto): Promise<Linha> {
    return this.templates.criar(claims, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<void> {
    return this.templates.remover(claims, id);
  }
}
