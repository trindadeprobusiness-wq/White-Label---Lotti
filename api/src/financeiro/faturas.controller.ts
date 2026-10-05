import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { AsaasCobrancaService } from './asaas/asaas-cobranca.service';
import { FaturasService } from './faturas.service';
import { AcaoAsaasDto, BaixaDto, CriarFaturaDto, VencimentoDto } from './financeiro.dto';
import { Linha } from './financeiro.erros';
import { ID_DA_ROTA } from './lancamentos.controller';

/** Faturas, locação e ações Asaas (contrato §1.3.B e §1.3.C). Rotas estáticas antes das com :id. */
@Controller('financeiro')
@UseGuards(SupabaseAuthGuard)
export class FaturasController {
  constructor(private readonly faturas: FaturasService, private readonly cobranca: AsaasCobrancaService) {}

  @Get('contratos-ativos')
  contratosAtivos(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.faturas.contratosAtivos(claims);
  }

  @Get('locacao/resumo')
  resumo(@Claims() claims: SupabaseClaims): Promise<{ contratos_ativos: number; soma_valor: number }> {
    return this.faturas.resumoLocacao(claims);
  }

  @Get('asaas/saldo')
  saldo(@Claims() claims: SupabaseClaims): Promise<{ balance: number | null; unavailable?: boolean; message?: string }> {
    return this.cobranca.saldo(claims);
  }

  @Get('faturas')
  listar(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.faturas.listarFaturas(claims);
  }

  @Post('faturas')
  @HttpCode(200)
  garantir(@Claims() claims: SupabaseClaims, @Body() dto: CriarFaturaDto): Promise<{ id: string; criada: boolean }> {
    return this.faturas.garantirFatura(claims, dto);
  }

  @Patch('faturas/:id/vencimento')
  vencimento(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: VencimentoDto): Promise<Linha> {
    return this.faturas.alterarVencimento(claims, id, dto);
  }

  @Post('faturas/:id/baixa')
  @HttpCode(200)
  baixa(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: BaixaDto): Promise<Linha> {
    return this.faturas.darBaixa(claims, id, dto);
  }

  @Post('faturas/:id/estorno')
  @HttpCode(200)
  estorno(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<{ status: string }> {
    return this.faturas.estornar(claims, id);
  }

  @Post('faturas/:id/cancelar')
  @HttpCode(200)
  cancelar(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<Linha> {
    return this.faturas.cancelar(claims, id);
  }

  @Post('faturas/:id/reativar')
  @HttpCode(200)
  reativar(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<Linha> {
    return this.faturas.reativar(claims, id);
  }

  @Post('faturas/:id/asaas')
  @HttpCode(200)
  acaoAsaas(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: AcaoAsaasDto): Promise<Record<string, unknown>> {
    return this.cobranca.acao(claims, id, dto);
  }
}
