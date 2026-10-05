import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { FachadasMetricasService, Metricas } from './fachadas-metricas.service';
import { MetricasDto } from './fachadas.dto';

@Controller('fachadas/metricas')
@UseGuards(SupabaseAuthGuard)
export class FachadasMetricasController {
  constructor(private readonly metricas: FachadasMetricasService) {}

  @Get()
  obter(@Claims() claims: SupabaseClaims, @Query() q: MetricasDto): Promise<Metricas> {
    return this.metricas.obter(claims, q);
  }
}
