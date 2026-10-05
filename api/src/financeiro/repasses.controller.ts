import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { Linha } from './financeiro.erros';
import { ID_DA_ROTA } from './lancamentos.controller';
import { RepassesService } from './repasses.service';

@Controller('financeiro/repasses')
@UseGuards(SupabaseAuthGuard)
export class RepassesController {
  constructor(private readonly repasses: RepassesService) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.repasses.listar(claims);
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  confirmar(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<Linha> {
    return this.repasses.confirmar(claims, id);
  }
}
