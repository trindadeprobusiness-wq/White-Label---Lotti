import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import {
  AlterarContratoDto, ContratosDosClientesDto, CriarContratoDto, CriarLocacaoDto, EditarLocacaoDto, ListarLocacaoDto,
} from './contratos.dto';
import { erroApi } from './contratos.erros';
import { ContratosService, Linha } from './contratos.service';

export const ID = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

// Rotas estáticas antes das rotas com :id.
@Controller('contratos')
@UseGuards(SupabaseAuthGuard)
export class ContratosController {
  constructor(private readonly contratos: ContratosService) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.contratos.listar(claims);
  }

  @Get('central')
  listarCentral(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.contratos.listarCentral(claims);
  }

  @Get('locacao')
  listarLocacao(@Claims() claims: SupabaseClaims, @Query() q: ListarLocacaoDto): Promise<Linha[]> {
    return this.contratos.listarLocacao(claims, q);
  }

  @Post('por-clientes')
  @HttpCode(200)
  listarDosClientes(@Claims() claims: SupabaseClaims, @Body() dto: ContratosDosClientesDto): Promise<Linha[]> {
    return this.contratos.listarDosClientes(claims, dto);
  }

  @Post('locacao')
  criarLocacao(@Claims() claims: SupabaseClaims, @Body() dto: CriarLocacaoDto): Promise<{ contrato: Linha; fatura: Linha }> {
    return this.contratos.criarLocacao(claims, dto);
  }

  @Post()
  criar(@Claims() claims: SupabaseClaims, @Body() dto: CriarContratoDto): Promise<Linha> {
    return this.contratos.criar(claims, dto);
  }

  @Patch(':id/locacao')
  editarLocacao(
    @Claims() claims: SupabaseClaims,
    @Param('id', ID) id: string,
    @Body() dto: EditarLocacaoDto,
  ): Promise<{ contrato: Linha; faturas_emitidas: string[] }> {
    return this.contratos.editarLocacao(claims, id, dto);
  }

  @Patch(':id')
  alterar(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: AlterarContratoDto): Promise<Linha> {
    return this.contratos.alterar(claims, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<void> {
    return this.contratos.remover(claims, id);
  }
}
