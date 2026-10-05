import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { ConviteService, RespostaConvite } from './convite/convite.service';
import { PortalData, PortalService } from './portal/portal.service';
import { AtribuirDto, ConviteDto, SalvarRepasseDto } from './parceiros.dto';
import { ParceirosPublicoService, RespostaAtribuicao } from './publico/parceiros-publico.service';

/** Atribuição, portal do parceiro e convites. Dois controllers com o prefixo `parceiros`: este tem guard. */
@Controller('parceiros')
@UseGuards(SupabaseAuthGuard)
export class ParceirosController {
  constructor(
    private readonly publico: ParceirosPublicoService,
    private readonly portal: PortalService,
    private readonly convite: ConviteService,
  ) {}

  /** T1: o user_id vem SEMPRE de claims.sub; o corpo só traz o visitante_id, opaco. */
  @Post('atribuicao')
  @HttpCode(200)
  atribuicao(@Claims() claims: SupabaseClaims, @Body() dto: AtribuirDto): Promise<RespostaAtribuicao> {
    return this.publico.reivindicarAtribuicao(claims, dto);
  }

  @Get('portal')
  painel(@Claims() claims: SupabaseClaims): Promise<PortalData> {
    return this.portal.painel(claims);
  }

  @Put('portal/repasse')
  @HttpCode(200)
  repasse(@Claims() claims: SupabaseClaims, @Body() dto: SalvarRepasseDto): Promise<{ salvo: true }> {
    return this.portal.salvarRepasse(claims, dto);
  }

  @Post('convites')
  @HttpCode(200)
  convidar(@Claims() claims: SupabaseClaims, @Body() dto: ConviteDto): Promise<RespostaConvite> {
    return this.convite.convidar(claims, dto);
  }
}
