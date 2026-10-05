import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Claims } from '../../auth/claims.decorator';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { SupabaseClaims } from '../../prisma/tenant-db';
import { Linha } from '../assinatura.dto';
import { erroApi } from '../assinatura.erros';
import {
  AceitarConviteDto, AcaoOnboardingDto, ChecklistOnboardingDto, ConviteDto, EventoOnboardingDto, OrganizacaoDto,
  PerfilProfissionalDto, SalvarOnboardingDto, TourOnboardingDto,
} from './onboarding.dto';
import { OnboardingService, RespostaAceite, RespostaAcao, RespostaConvite } from './onboarding.service';

const ID_DA_ROTA = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

@Controller('onboarding')
@UseGuards(SupabaseAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('contexto')
  contexto(@Claims() claims: SupabaseClaims): Promise<Linha | null> {
    return this.onboarding.contexto(claims);
  }

  @Post('salvar')
  @HttpCode(200)
  salvar(@Claims() claims: SupabaseClaims, @Body() dto: SalvarOnboardingDto): Promise<Linha | null> {
    return this.onboarding.salvar(claims, dto);
  }

  @Post('acoes')
  @HttpCode(200)
  acoes(@Claims() claims: SupabaseClaims, @Body() dto: AcaoOnboardingDto): Promise<RespostaAcao> {
    return this.onboarding.executarAcao(claims, dto);
  }

  @Post('eventos')
  @HttpCode(204)
  eventos(@Claims() claims: SupabaseClaims, @Body() dto: EventoOnboardingDto): Promise<void> {
    return this.onboarding.registrarEvento(claims, dto);
  }

  @Put('tours')
  @HttpCode(204)
  tours(@Claims() claims: SupabaseClaims, @Body() dto: TourOnboardingDto): Promise<void> {
    return this.onboarding.salvarTour(claims, dto);
  }

  @Patch('checklist')
  @HttpCode(204)
  checklist(@Claims() claims: SupabaseClaims, @Body() dto: ChecklistOnboardingDto): Promise<void> {
    return this.onboarding.salvarChecklist(claims, dto);
  }

  @Patch('perfil')
  @HttpCode(204)
  perfil(@Claims() claims: SupabaseClaims, @Body() dto: PerfilProfissionalDto): Promise<void> {
    return this.onboarding.atualizarPerfil(claims, dto);
  }

  @Post('convites')
  @HttpCode(200)
  convites(@Claims() claims: SupabaseClaims, @Body() dto: ConviteDto): Promise<RespostaConvite> {
    return this.onboarding.criarConvite(claims, dto);
  }

  @Post('convites/aceitar')
  @HttpCode(200)
  aceitar(@Claims() claims: SupabaseClaims, @Body() dto: AceitarConviteDto): Promise<RespostaAceite> {
    return this.onboarding.aceitarConvite(claims, dto);
  }

  @Patch('organizacoes/:id')
  @HttpCode(204)
  organizacoes(
    @Claims() claims: SupabaseClaims,
    @Param('id', ID_DA_ROTA) id: string,
    @Body() dto: OrganizacaoDto,
  ): Promise<void> {
    return this.onboarding.atualizarOrganizacao(claims, id, dto);
  }
}
