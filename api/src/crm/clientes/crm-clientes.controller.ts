import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../../auth/claims.decorator';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { SupabaseClaims } from '../../prisma/tenant-db';
import {
  AtualizarClienteDto,
  BuscarCandidatosDto,
  CompletarCpfDto,
  ConverterLeadDto,
  CriarClienteDto,
  DefinirImovelInteresseDto,
  MoverClienteDto,
  RegistrarHistoricoDto,
} from './crm-clientes.dto';
import { erroApi } from './crm-clientes.erros';
import { CrmClientesService, LinhaCliente, LinhaHistorico } from './crm-clientes.service';

const ID = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

// Rotas estáticas antes das rotas com :id.
@Controller('clientes')
@UseGuards(SupabaseAuthGuard)
export class CrmClientesController {
  constructor(private readonly clientes: CrmClientesService) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims): Promise<LinhaCliente[]> {
    return this.clientes.listar(claims);
  }

  @Get('candidatos')
  candidatos(@Claims() claims: SupabaseClaims, @Query() q: BuscarCandidatosDto): Promise<unknown> {
    return this.clientes.buscarCandidatos(claims, q);
  }

  @Post()
  @HttpCode(200)
  criar(@Claims() claims: SupabaseClaims, @Body() dto: CriarClienteDto): Promise<unknown> {
    return this.clientes.criar(claims, dto);
  }

  @Post('converter-lead')
  @HttpCode(200)
  converterLead(@Claims() claims: SupabaseClaims, @Body() dto: ConverterLeadDto): Promise<unknown> {
    return this.clientes.converterLead(claims, dto);
  }

  @Get(':id')
  obter(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<LinhaCliente> {
    return this.clientes.obter(claims, id);
  }

  @Patch(':id')
  atualizar(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: AtualizarClienteDto): Promise<LinhaCliente> {
    return this.clientes.atualizar(claims, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<void> {
    return this.clientes.remover(claims, id);
  }

  @Patch(':id/status')
  moverNoFunil(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: MoverClienteDto): Promise<{ id: string }> {
    return this.clientes.moverNoFunil(claims, id, dto);
  }

  @Put(':id/imovel-interesse')
  definirImovelInteresse(
    @Claims() claims: SupabaseClaims,
    @Param('id', ID) id: string,
    @Body() dto: DefinirImovelInteresseDto,
  ): Promise<{ cliente_id: string; imovel_id: string | null }> {
    return this.clientes.definirImovelInteresse(claims, id, dto);
  }

  @Post(':id/completar-cpf')
  @HttpCode(200)
  completarCpf(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: CompletarCpfDto): Promise<{ atualizado: boolean }> {
    return this.clientes.completarCpf(claims, id, dto);
  }

  @Get(':id/historico')
  listarHistorico(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<LinhaHistorico[]> {
    return this.clientes.listarHistorico(claims, id);
  }

  @Post(':id/historico')
  registrarHistorico(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: RegistrarHistoricoDto): Promise<LinhaHistorico> {
    return this.clientes.registrarHistorico(claims, id, dto);
  }
}
