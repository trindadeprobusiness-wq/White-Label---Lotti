import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { CentralComercialService } from './central-comercial.service';

/** Filtros vêm como ?eq.coluna=valor; ordem como ?ordem=coluna&asc=false. */
const filtrosDe = (q: Record<string, string>) =>
  Object.fromEntries(Object.entries(q).filter(([k]) => k.startsWith('eq.')).map(([k, v]) => [k.slice(3), String(v)]));

@Controller('central-comercial')
@UseGuards(SupabaseAuthGuard)
export class CentralComercialController {
  constructor(private readonly central: CentralComercialService) {}

  @Get(':tabela')
  listar(@Claims() claims: SupabaseClaims, @Param('tabela') tabela: string, @Query() q: Record<string, string>) {
    return this.central.listar(claims, tabela, { ordem: q.ordem, asc: q.asc !== 'false', filtros: filtrosDe(q) });
  }

  @Post(':tabela')
  inserir(@Claims() claims: SupabaseClaims, @Param('tabela') tabela: string, @Body() corpo: { linhas: Record<string, unknown>[]; upsert?: boolean }) {
    return this.central.inserir(claims, tabela, corpo?.linhas ?? [], corpo?.upsert === true);
  }

  @Patch(':tabela')
  atualizar(@Claims() claims: SupabaseClaims, @Param('tabela') tabela: string, @Query() q: Record<string, string>, @Body() corpo: { patch: Record<string, unknown> }) {
    return this.central.atualizar(claims, tabela, filtrosDe(q), corpo?.patch ?? {});
  }
}
