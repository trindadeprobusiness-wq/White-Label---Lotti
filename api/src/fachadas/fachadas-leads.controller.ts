import { Controller, Delete, Get, HttpCode, Param, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { FachadasLeadsService } from './fachadas-leads.service';
import { ID } from './fachadas.controller';
import { ListarLeadsDto } from './fachadas.dto';
import { Linha } from './fachadas.service';

@Controller('fachadas/leads')
@UseGuards(SupabaseAuthGuard)
export class FachadasLeadsController {
  constructor(private readonly leads: FachadasLeadsService) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims, @Query() q: ListarLeadsDto): Promise<Linha[]> {
    return this.leads.listar(claims, q);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@Claims() claims: SupabaseClaims, @Param('id', ID) id: string): Promise<void> {
    return this.leads.remover(claims, id);
  }
}
