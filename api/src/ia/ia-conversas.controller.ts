import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { ConversasService, Linha } from './conversas.service';
import { AlterarConversaDto } from './ia.dto';
import { erroApi } from './ia.erros';

export const ID_IA = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

/** Histórico do Assistente: o que useAIChat e AIConversationList liam/gravavam direto no Supabase. */
@Controller('ia/conversas')
@UseGuards(SupabaseAuthGuard)
export class IaConversasController {
  constructor(private readonly conversas: ConversasService) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.conversas.listar(claims);
  }

  @Get(':id/mensagens')
  mensagens(@Claims() claims: SupabaseClaims, @Param('id', ID_IA) id: string): Promise<Linha[]> {
    return this.conversas.mensagens(claims, id);
  }

  @Patch(':id')
  alterar(@Claims() claims: SupabaseClaims, @Param('id', ID_IA) id: string, @Body() dto: AlterarConversaDto): Promise<Linha> {
    return this.conversas.alterar(claims, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  apagar(@Claims() claims: SupabaseClaims, @Param('id', ID_IA) id: string): Promise<void> {
    return this.conversas.apagar(claims, id);
  }
}
