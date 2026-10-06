import { Body, Controller, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { RecusaTokenSuporte } from '../auth/sessao-suporte';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { AbrirSuporteDto, EncerrarSuporteDto } from './suporte.dto';
import { SessaoSuporteAberta, SuporteService } from './suporte.service';

/**
 * Atendimento pelo backoffice (no lugar da Edge `admin-suporte`). As duas rotas são do
 * ADMINISTRADOR logado: o token de atendimento é recusado aqui (sem atendimento dentro de
 * atendimento; encerrar exige o próprio ator).
 */
@Controller('admin/suporte')
@UseGuards(SupabaseAuthGuard)
@RecusaTokenSuporte()
export class SuporteController {
  constructor(private readonly suporte: SuporteService) {}

  @Post('abrir')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  abrir(@Claims() claims: SupabaseClaims, @Body() dto: AbrirSuporteDto): Promise<SessaoSuporteAberta> {
    return this.suporte.abrir(claims, dto);
  }

  @Post('encerrar')
  @HttpCode(200)
  encerrar(@Claims() claims: SupabaseClaims, @Body() dto: EncerrarSuporteDto): Promise<{ ok: true }> {
    return this.suporte.encerrar(claims, dto.sessao_id);
  }
}
