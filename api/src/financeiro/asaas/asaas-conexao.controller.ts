import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../../auth/claims.decorator';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { SupabaseClaims } from '../../prisma/tenant-db';
import { ConectarAsaasDto } from '../financeiro.dto';
import { Linha } from '../financeiro.erros';
import { AsaasConexaoService } from './asaas-conexao.service';

@Controller('financeiro/asaas/conexao')
@UseGuards(SupabaseAuthGuard)
export class AsaasConexaoController {
  constructor(private readonly conexao: AsaasConexaoService) {}

  @Get()
  status(@Claims() claims: SupabaseClaims): Promise<{ disponivel: true; conexao: Linha | null }> {
    return this.conexao.status(claims);
  }

  @Post()
  @HttpCode(200)
  conectar(@Claims() claims: SupabaseClaims, @Body() dto: ConectarAsaasDto): Promise<Record<string, unknown>> {
    return this.conexao.conectar(claims, dto);
  }

  @Delete()
  @HttpCode(200)
  desconectar(@Claims() claims: SupabaseClaims): Promise<{ ok: true; aviso: string | null }> {
    return this.conexao.desconectar(claims);
  }
}
