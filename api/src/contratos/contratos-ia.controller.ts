import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { AnalisarContratoIaDto, GerarContratoIaDto } from './contratos-ia.dto';
import { ContratosIaService, RespostaGeracao } from './contratos-ia.service';

@Controller('contratos/ia')
@UseGuards(SupabaseAuthGuard)
export class ContratosIaController {
  constructor(private readonly ia: ContratosIaService) {}

  @Post('gerar')
  @HttpCode(200)
  gerar(@Claims() claims: SupabaseClaims, @Body() dto: GerarContratoIaDto): Promise<RespostaGeracao> {
    return this.ia.gerar(claims, dto);
  }

  @Post('analisar')
  @HttpCode(200)
  analisar(@Claims() claims: SupabaseClaims, @Body() dto: AnalisarContratoIaDto): Promise<{ dados: unknown }> {
    return this.ia.analisar(claims, dto);
  }
}
