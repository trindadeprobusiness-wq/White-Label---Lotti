import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../../auth/claims.decorator';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { SupabaseClaims } from '../../prisma/tenant-db';
import { ConfigurarCalendarioDto, ConfigurarPrivacidadeDto, SincronizarDto } from '../rotina.dto';
import { erroApi } from '../rotina.erros';
import { Linha } from './rotina-google.repo';
import { RotinaGoogleService } from './rotina-google.service';

const ID_DA_ROTA = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

@Controller('rotina/google')
@UseGuards(SupabaseAuthGuard)
export class RotinaGoogleController {
  constructor(private readonly google: RotinaGoogleService) {}

  @Get('status')
  status(@Claims() claims: SupabaseClaims): Promise<Record<string, unknown>> {
    return this.google.status(claims);
  }

  @Post('conectar')
  @HttpCode(200)
  conectar(@Claims() claims: SupabaseClaims): Promise<{ authorization_url: string }> {
    return this.google.conectar(claims);
  }

  @Post('desconectar')
  @HttpCode(200)
  desconectar(@Claims() claims: SupabaseClaims): Promise<{ disconnected: true; idempotent?: true }> {
    return this.google.desconectar(claims);
  }

  @Patch('privacidade')
  privacidade(@Claims() claims: SupabaseClaims, @Body() dto: ConfigurarPrivacidadeDto): Promise<{ configured: true; privacy_mode: string }> {
    return this.google.configurarPrivacidade(claims, dto);
  }

  @Get('calendarios')
  calendarios(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.google.listarCalendarios(claims);
  }

  @Patch('calendarios/:id')
  configurarCalendario(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: ConfigurarCalendarioDto,
  ): Promise<Linha> {
    return this.google.configurarCalendario(claims, id, dto);
  }

  @Post('sincronizar')
  @HttpCode(200)
  sincronizar(@Claims() claims: SupabaseClaims, @Body() dto: SincronizarDto): Promise<Record<string, unknown>> {
    return this.google.sincronizar(claims, dto);
  }
}
