import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { BuscaImoveisDto } from './busca-imoveis.dto';
import { ImovelResumo, ImoveisService } from './imoveis.service';

@Controller('imoveis')
@UseGuards(SupabaseAuthGuard)
export class ImoveisController {
  constructor(private readonly imoveis: ImoveisService) {}

  @Get('busca')
  buscar(@Claims() claims: SupabaseClaims, @Query() filtros: BuscaImoveisDto): Promise<ImovelResumo[]> {
    return this.imoveis.buscar(claims, filtros);
  }
}
