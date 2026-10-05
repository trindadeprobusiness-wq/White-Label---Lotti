import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { AlterarLancamentoDto, CriarLancamentoDto, FiltroLancamentosDto } from './financeiro.dto';
import { erroApi, Linha } from './financeiro.erros';
import { LancamentosService } from './lancamentos.service';

export const ID_DA_ROTA = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

@Controller('financeiro/lancamentos')
@UseGuards(SupabaseAuthGuard)
export class LancamentosController {
  constructor(private readonly lancamentos: LancamentosService) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims, @Query() filtro: FiltroLancamentosDto): Promise<Linha[]> {
    return this.lancamentos.listar(claims, filtro);
  }

  @Post()
  criar(@Claims() claims: SupabaseClaims, @Body() dto: CriarLancamentoDto): Promise<Linha[]> {
    return this.lancamentos.criar(claims, dto);
  }

  @Patch(':id')
  alterar(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: AlterarLancamentoDto): Promise<Linha> {
    return this.lancamentos.alterar(claims, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  excluir(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<void> {
    return this.lancamentos.excluir(claims, id);
  }
}
