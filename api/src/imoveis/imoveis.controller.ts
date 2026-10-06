import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { BuscaImoveisDto } from './busca-imoveis.dto';
import { erroApi } from './imoveis.erros';
import { AtualizarImovelDto, CriarImovelDto, RegistrarVendaDto } from './imoveis-gestao.dto';
import { ClienteInteressado, ImoveisGestaoService, LinhaImovel, ResultadoVenda } from './imoveis-gestao.service';
import { EventoVendaDto } from './imoveis-fotos.dto';
import { ImoveisVendaEventoService } from './imoveis-venda-evento.service';
import { ImovelResumo, ImoveisService } from './imoveis.service';

const ID = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

@Controller('imoveis')
@UseGuards(SupabaseAuthGuard)
export class ImoveisController {
  constructor(
    private readonly imoveis: ImoveisService,
    private readonly gestao: ImoveisGestaoService,
    private readonly eventoVenda: ImoveisVendaEventoService,
  ) {}

  // Rotas estáticas antes das rotas com :id.
  @Get('busca')
  buscar(@Claims() claims: SupabaseClaims, @Query() filtros: BuscaImoveisDto): Promise<ImovelResumo[]> {
    return this.imoveis.buscar(claims, filtros);
  }

  @Get()
  listar(@Claims() claims: SupabaseClaims): Promise<LinhaImovel[]> {
    return this.gestao.listar(claims);
  }

  @Post()
  criar(@Claims() claims: SupabaseClaims, @Body() dto: CriarImovelDto): Promise<LinhaImovel> {
    return this.gestao.criar(claims, dto);
  }

  @Get(':id')
  obter(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<LinhaImovel> {
    return this.gestao.obter(claims, id);
  }

  @Get(':id/clientes-interessados')
  listarClientesInteressados(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<ClienteInteressado[]> {
    return this.gestao.listarClientesInteressados(claims, id);
  }

  @Patch(':id')
  atualizar(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: AtualizarImovelDto): Promise<LinhaImovel> {
    return this.gestao.atualizar(claims, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<void> {
    return this.gestao.remover(claims, id);
  }

  @Post(':id/venda')
  @HttpCode(200)
  registrarVenda(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string, @Body() dto: RegistrarVendaDto): Promise<ResultadoVenda> {
    return this.gestao.registrarVenda(claims, id, dto);
  }

  /** Evento de conversão (UTMify) na fila webhook_logs, depois da venda registrada. */
  @Post(':id/venda/evento')
  @HttpCode(200)
  enfileirarEventoVenda(
    @Claims() claims: SupabaseClaims,
    @Param('id', ID) id: string,
    @Body() dto: EventoVendaDto,
  ): Promise<{ enfileirado: true; id: string }> {
    return this.eventoVenda.enfileirar(claims, id, dto);
  }
}
