import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { CriarFachadaDto, EditarFachadaDto } from './fachadas.dto';
import { ERROS } from './fachadas.erros';
import { FachadasService, Linha } from './fachadas.service';

/** Mesma paridade do FORMATO_UUID dos DTOs: 8-4-4-4-12 hexadecimal, sem versão. */
export const ID = new ParseUUIDPipe({ exceptionFactory: () => ERROS.idInvalido() });

// Este é o UNICO controller do módulo com rota de id: por isso ele é o ÚLTIMO do array
// `controllers` do FachadasModule, depois dos quatro prefixos literais (contrato §1.1).
@Controller('fachadas')
@UseGuards(SupabaseAuthGuard)
export class FachadasController {
  constructor(private readonly fachadas: FachadasService) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.fachadas.listar(claims);
  }

  @Post()
  criar(@Claims() claims: SupabaseClaims, @Body() dto: CriarFachadaDto): Promise<Linha> {
    return this.fachadas.criar(claims, dto);
  }

  @Patch(':id')
  editar(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: EditarFachadaDto): Promise<Linha> {
    return this.fachadas.editar(claims, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<void> {
    return this.fachadas.remover(claims, id);
  }
}
