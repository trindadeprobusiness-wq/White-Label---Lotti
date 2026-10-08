import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../../auth/claims.decorator';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { SupabaseClaims } from '../../prisma/tenant-db';
import {
  CancelarLoteDto, CriarLinkDto, CriarParceiroDto, DefinirPercentualDto, DefinirStatusCorretorDto, EditarParceiroDto,
  ElegiveisRepasseDto, EstornarReceitaDto, FORMATO_CHAVE_CONFIG, GerarLoteDto, ListarAcessosDto, ListarAssinaturasDto,
  ListarAtendimentoDto, ListarAuditoriaDto, ListarCancelamentosDto, ListarComissoesDto, ListarDiagnosticosCrescimentoDto,
  ListarDiagnosticosDto,
  ListarLotesDto, ListarOrganizacoesDto, ListarPagamentosDto, ListarParceirosDto, ListarReceitaDto, ListarUsuariosDto,
  MarcarLotePagoDto, PeriodoDto, RegistrarAuditoriaDto, RegistrarCancelamentoDto, RegistrarPagamentoDto,
  RegistrarReceitaDto, SalvarConfigDto, StatusDiagnosticoDto, TransicionarComissaoDto,
} from '../parceiros.dto';
import { ERROS } from '../parceiros.erros';
import { AdminService, Linha } from './admin.service';

const ID_DA_ROTA = new ParseUUIDPipe({ exceptionFactory: () => ERROS.idInvalido() });

function chaveValida(chave: string): string {
  if (!FORMATO_CHAVE_CONFIG.test(chave)) throw ERROS.chaveInvalida();
  return chave;
}

/** Backoffice. As rotas estáticas vêm antes das rotas com :id. */
@Controller('admin')
@UseGuards(SupabaseAuthGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // B1–B3
  @Get('papeis')
  papeis(@Claims() claims: SupabaseClaims): Promise<string[]> {
    return this.admin.papeis(claims);
  }

  @Get('auditoria')
  listarAuditoria(@Claims() claims: SupabaseClaims, @Query() q: ListarAuditoriaDto): Promise<unknown> {
    return this.admin.listarAuditoria(claims, q);
  }

  @Post('auditoria')
  registrarAuditoria(@Claims() claims: SupabaseClaims, @Body() dto: RegistrarAuditoriaDto): Promise<{ id: number }> {
    return this.admin.registrarAuditoria(claims, dto);
  }

  // B4–B11
  @Get('parceiros/opcoes')
  opcoesParceiros(@Claims() claims: SupabaseClaims): Promise<unknown> {
    return this.admin.opcoesParceiros(claims);
  }

  @Get('parceiros')
  listarParceiros(@Claims() claims: SupabaseClaims, @Query() q: ListarParceirosDto): Promise<unknown> {
    return this.admin.listarParceiros(claims, q);
  }

  @Post('parceiros')
  criarParceiro(@Claims() claims: SupabaseClaims, @Body() dto: CriarParceiroDto): Promise<{ id: string }> {
    return this.admin.criarParceiro(claims, dto);
  }

  @Get('parceiros/:id')
  parceiro(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<unknown> {
    return this.admin.parceiro(claims, id);
  }

  @Patch('parceiros/:id')
  editarParceiro(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: EditarParceiroDto,
  ): Promise<{ id: string }> {
    return this.admin.editarParceiro(claims, id, dto);
  }

  @Post('parceiros/:id/percentuais')
  definirPercentual(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: DefinirPercentualDto,
  ): Promise<unknown> {
    return this.admin.definirPercentual(claims, id, dto);
  }

  @Post('parceiros/:id/links')
  criarLink(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: CriarLinkDto,
  ): Promise<{ id: string; slug: string }> {
    return this.admin.criarLink(claims, id, dto);
  }

  @Post('links/:id/revogar')
  @HttpCode(200)
  revogarLink(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<{ revogado: true }> {
    return this.admin.revogarLink(claims, id);
  }

  // B12–B17
  @Get('comissoes')
  listarComissoes(@Claims() claims: SupabaseClaims, @Query() q: ListarComissoesDto): Promise<unknown> {
    return this.admin.listarComissoes(claims, q);
  }

  @Post('comissoes/:id/status')
  @HttpCode(200)
  transicionarComissao(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: TransicionarComissaoDto,
  ): Promise<unknown> {
    return this.admin.transicionarComissao(claims, id, dto);
  }

  @Post('pagamentos-parceiro')
  registrarPagamento(@Claims() claims: SupabaseClaims, @Body() dto: RegistrarPagamentoDto): Promise<unknown> {
    return this.admin.registrarPagamento(claims, dto);
  }

  @Get('receita')
  listarReceita(@Claims() claims: SupabaseClaims, @Query() q: ListarReceitaDto): Promise<unknown> {
    return this.admin.listarReceita(claims, q);
  }

  @Post('receita')
  registrarReceita(@Claims() claims: SupabaseClaims, @Body() dto: RegistrarReceitaDto): Promise<unknown> {
    return this.admin.registrarReceita(claims, dto);
  }

  @Post('receita/:id/estornar')
  @HttpCode(200)
  estornarReceita(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: EstornarReceitaDto,
  ): Promise<unknown> {
    return this.admin.estornarReceita(claims, id, dto);
  }

  // B18–B24
  @Get('repasses/elegiveis')
  elegiveisRepasse(@Claims() claims: SupabaseClaims, @Query() q: ElegiveisRepasseDto): Promise<unknown> {
    return this.admin.elegiveisRepasse(claims, q.saldo_minimo ?? null);
  }

  @Get('lotes')
  listarLotes(@Claims() claims: SupabaseClaims, @Query() q: ListarLotesDto): Promise<unknown> {
    return this.admin.listarLotes(claims, q);
  }

  @Post('lotes')
  gerarLote(@Claims() claims: SupabaseClaims, @Body() dto: GerarLoteDto): Promise<unknown> {
    return this.admin.gerarLote(claims, dto);
  }

  @Get('lotes/:id')
  lote(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<unknown> {
    return this.admin.lote(claims, id);
  }

  @Post('lotes/:id/exportado')
  @HttpCode(200)
  marcarLoteExportado(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<unknown> {
    return this.admin.marcarLoteExportado(claims, id);
  }

  @Post('lotes/:id/pago')
  @HttpCode(200)
  marcarLotePago(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: MarcarLotePagoDto,
  ): Promise<unknown> {
    return this.admin.marcarLotePago(claims, id, dto);
  }

  @Post('lotes/:id/cancelar')
  @HttpCode(200)
  cancelarLote(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: CancelarLoteDto,
  ): Promise<unknown> {
    return this.admin.cancelarLote(claims, id, dto);
  }

  // B25–B34
  @Get('usuarios')
  listarUsuarios(@Claims() claims: SupabaseClaims, @Query() q: ListarUsuariosDto): Promise<unknown> {
    return this.admin.listarUsuarios(claims, q);
  }

  @Get('usuarios/:corretorId')
  usuario(@Claims() claims: SupabaseClaims, @Param('corretorId', ID_DA_ROTA) corretorId: string): Promise<unknown> {
    return this.admin.usuario(claims, corretorId);
  }

  @Post('usuarios/:corretorId/status')
  @HttpCode(200)
  definirStatusCorretor(
    @Claims() claims: SupabaseClaims, @Param('corretorId', ID_DA_ROTA) corretorId: string, @Body() dto: DefinirStatusCorretorDto,
  ): Promise<unknown> {
    return this.admin.definirStatusCorretor(claims, corretorId, dto);
  }

  @Get('atendimento')
  listarAtendimento(@Claims() claims: SupabaseClaims, @Query() q: ListarAtendimentoDto): Promise<unknown> {
    return this.admin.listarAtendimento(claims, q);
  }

  @Get('assinaturas')
  listarAssinaturas(@Claims() claims: SupabaseClaims, @Query() q: ListarAssinaturasDto): Promise<unknown> {
    return this.admin.listarAssinaturas(claims, q);
  }

  @Get('pagamentos')
  listarPagamentos(@Claims() claims: SupabaseClaims, @Query() q: ListarPagamentosDto): Promise<unknown> {
    return this.admin.listarPagamentos(claims, q);
  }

  @Get('cancelamentos')
  listarCancelamentos(@Claims() claims: SupabaseClaims, @Query() q: ListarCancelamentosDto): Promise<unknown> {
    return this.admin.listarCancelamentos(claims, q);
  }

  @Post('cancelamentos')
  registrarCancelamento(@Claims() claims: SupabaseClaims, @Body() dto: RegistrarCancelamentoDto): Promise<unknown> {
    return this.admin.registrarCancelamento(claims, dto);
  }

  @Get('organizacoes')
  listarOrganizacoes(@Claims() claims: SupabaseClaims, @Query() q: ListarOrganizacoesDto): Promise<unknown> {
    return this.admin.listarOrganizacoes(claims, q);
  }

  @Get('organizacoes/:id')
  organizacao(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<unknown> {
    return this.admin.organizacao(claims, id);
  }

  @Get('acessos')
  listarAcessos(@Claims() claims: SupabaseClaims, @Query() q: ListarAcessosDto): Promise<unknown> {
    return this.admin.listarAcessos(claims, q);
  }

  // B35–B39
  @Get('metricas/saas')
  metricasSaas(@Claims() claims: SupabaseClaims, @Query() q: PeriodoDto): Promise<unknown> {
    return this.admin.metricasSaas(claims, q);
  }

  @Get('metricas/cancelamento')
  metricasCancelamento(@Claims() claims: SupabaseClaims, @Query() q: PeriodoDto): Promise<unknown> {
    return this.admin.metricasCancelamento(claims, q);
  }

  @Get('metricas/onboarding')
  metricasOnboarding(@Claims() claims: SupabaseClaims, @Query() q: PeriodoDto): Promise<unknown> {
    return this.admin.metricasOnboarding(claims, q);
  }

  @Get('metricas')
  metricas(@Claims() claims: SupabaseClaims, @Query() q: PeriodoDto): Promise<unknown> {
    return this.admin.metricas(claims, q);
  }

  @Get('integracoes')
  statusIntegracoes(@Claims() claims: SupabaseClaims): Promise<unknown> {
    return this.admin.statusIntegracoes(claims);
  }

  // B40–B44
  @Get('config/linhas')
  listarLinhasConfig(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.admin.listarLinhasConfig(claims);
  }

  @Get('config')
  listarConfig(@Claims() claims: SupabaseClaims): Promise<unknown> {
    return this.admin.listarConfig(claims);
  }

  @Put('config/:chave')
  @HttpCode(200)
  atualizarConfig(
    @Claims() claims: SupabaseClaims, @Param('chave') chave: string, @Body() dto: SalvarConfigDto,
  ): Promise<Linha> {
    return this.admin.atualizarConfig(claims, chaveValida(chave), dto);
  }

  @Post('config/:chave')
  @HttpCode(200)
  salvarConfig(
    @Claims() claims: SupabaseClaims, @Param('chave') chave: string, @Body() dto: SalvarConfigDto,
  ): Promise<unknown> {
    return this.admin.salvarConfig(claims, chaveValida(chave), dto);
  }

  // Diagnóstico de Crescimento (/admin/diagnosticos do painel): is_admin() na RPC e nas policies.
  @Get('diagnosticos-crescimento')
  listarDiagnosticosCrescimento(@Claims() claims: SupabaseClaims, @Query() q: ListarDiagnosticosCrescimentoDto): Promise<unknown> {
    return this.admin.listarDiagnosticosCrescimento(claims, q);
  }

  @Get('diagnosticos-crescimento/:id')
  diagnosticoCrescimento(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<unknown> {
    return this.admin.diagnosticoCrescimento(claims, id);
  }

  @Get('diagnosticos')
  listarDiagnosticos(@Claims() claims: SupabaseClaims, @Query() q: ListarDiagnosticosDto): Promise<Linha[]> {
    return this.admin.listarDiagnosticos(claims, q);
  }

  @Patch('diagnosticos/:id')
  atualizarStatusDiagnostico(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: StatusDiagnosticoDto,
  ): Promise<Linha> {
    return this.admin.atualizarStatusDiagnostico(claims, id, dto);
  }
}
