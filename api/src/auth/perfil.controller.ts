import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { SupabaseClaims } from '../prisma/tenant-db';
import { Claims } from './claims.decorator';
import { AtualizarCorretorDto, RegistrarAtividadeDto } from './perfil.dto';
import { PerfilCorretor, PerfilService } from './perfil.service';
import { RecusaTokenSuporte } from './sessao-suporte';
import { SupabaseAuthGuard } from './supabase-auth.guard';

/**
 * Perfil de quem está logado: o que o front lia direto em public.corretores e no
 * rpc('get_corretor_id'), e a telemetria do login (registrar_atividade). Mora no módulo de
 * auth porque é "quem sou eu"; tudo roda no TenantDb, com o RLS de sempre.
 */
@Controller('perfil')
@UseGuards(SupabaseAuthGuard)
export class PerfilController {
  constructor(private readonly perfil: PerfilService) {}

  @Get('corretor')
  obter(@Claims() claims: SupabaseClaims): Promise<PerfilCorretor> {
    return this.perfil.obter(claims);
  }

  @Patch('corretor')
  atualizar(@Claims() claims: SupabaseClaims, @Body() dto: AtualizarCorretorDto): Promise<Record<string, unknown>> {
    return this.perfil.atualizar(claims, dto);
  }

  /** Presença do titular: o atendimento não conta como acesso dele (o front já não chama). */
  @Post('atividade')
  @HttpCode(204)
  @RecusaTokenSuporte()
  registrarAtividade(@Claims() claims: SupabaseClaims, @Body() dto: RegistrarAtividadeDto): Promise<void> {
    return this.perfil.registrarAtividade(claims, dto);
  }
}
