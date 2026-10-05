import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { ID } from './contratos.controller';
import { Linha } from './contratos.service';
import { AlterarDocumentoDto, CriarDocumentoDto } from './documentos.dto';
import { DocumentosService } from './documentos.service';

@Controller('documentos')
@UseGuards(SupabaseAuthGuard)
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.documentos.listar(claims);
  }

  @Post()
  criar(@Claims() claims: SupabaseClaims, @Body() dto: CriarDocumentoDto): Promise<Linha> {
    return this.documentos.criar(claims, dto);
  }

  @Patch(':id')
  alterar(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: AlterarDocumentoDto): Promise<Linha> {
    return this.documentos.alterar(claims, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<void> {
    return this.documentos.remover(claims, id);
  }
}
