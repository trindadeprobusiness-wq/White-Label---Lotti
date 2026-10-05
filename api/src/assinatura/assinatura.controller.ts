import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { AssinaturaService } from './assinatura.service';
import { CHAVES_COTA, Linha, RespostaCota, UsoAssinatura } from './assinatura.dto';
import { erroApi } from './assinatura.erros';

const CHAVES = new Set<string>(CHAVES_COTA);

@Controller('assinatura')
@UseGuards(SupabaseAuthGuard)
export class AssinaturaController {
  constructor(private readonly assinatura: AssinaturaService) {}

  @Get()
  atual(@Claims() claims: SupabaseClaims): Promise<Linha | null> {
    return this.assinatura.atual(claims);
  }

  @Get('uso')
  uso(@Claims() claims: SupabaseClaims): Promise<UsoAssinatura> {
    return this.assinatura.uso(claims);
  }

  @Get('addons')
  addons(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.assinatura.addons(claims);
  }

  @Get('conta-antiga')
  contaAntiga(@Claims() claims: SupabaseClaims): Promise<{ sem_limite: boolean }> {
    return this.assinatura.contaAntiga(claims);
  }

  @Get('cota/:chave')
  cota(@Claims() claims: SupabaseClaims, @Param('chave') chave: string): Promise<RespostaCota> {
    if (!CHAVES.has(chave)) throw erroApi(400, 'recurso_invalido', 'Recurso de cota desconhecido.');
    return this.assinatura.cota(claims, chave);
  }
}
