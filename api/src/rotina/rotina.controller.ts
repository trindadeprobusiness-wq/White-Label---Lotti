import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { RotinaComandoService } from './comando/rotina-comando.service';
import { ContextoRotina } from './rotina.contexto';
import {
  ComandoDto, ConflitosDto, CriarEventoDto, CriarInboxDto, CriarTarefaDto, EditarEventoDto, EditarTarefaDto, ListarEventosDto,
  ListarTarefasDto,
} from './rotina.dto';
import { erroApi } from './rotina.erros';
import { Linha, RotinaService } from './rotina.service';

const ID_DA_ROTA = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

@Controller('rotina')
@UseGuards(SupabaseAuthGuard)
export class RotinaController {
  constructor(private readonly rotina: RotinaService, private readonly comando: RotinaComandoService) {}

  @Get('contexto')
  contexto(@Claims() claims: SupabaseClaims): Promise<ContextoRotina | null> {
    return this.rotina.contexto(claims);
  }

  @Get('membros')
  membros(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.rotina.listarMembros(claims);
  }

  @Get('eventos')
  eventos(@Claims() claims: SupabaseClaims, @Query() q: ListarEventosDto): Promise<Linha[]> {
    return this.rotina.listarEventos(claims, q);
  }

  @Get('tarefas')
  tarefas(@Claims() claims: SupabaseClaims, @Query() q: ListarTarefasDto): Promise<Linha[]> {
    return this.rotina.listarTarefas(claims, q);
  }

  @Get('atividade')
  atividade(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.rotina.listarAtividade(claims);
  }

  @Get('inbox')
  inbox(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.rotina.listarInbox(claims);
  }

  @Post('inbox')
  criarInbox(@Claims() claims: SupabaseClaims, @Body() dto: CriarInboxDto): Promise<Linha> {
    return this.rotina.criarInbox(claims, dto);
  }

  @Post('inbox/:id/arquivar')
  @HttpCode(200)
  arquivarInbox(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<{ arquivado: true }> {
    return this.rotina.arquivarInbox(claims, id);
  }

  @Post('conflitos')
  @HttpCode(200)
  conflitos(@Claims() claims: SupabaseClaims, @Body() dto: ConflitosDto): Promise<Linha[]> {
    return this.rotina.detectarConflitos(claims, dto);
  }

  @Post('eventos')
  criarEvento(@Claims() claims: SupabaseClaims, @Body() dto: CriarEventoDto): Promise<{ evento: Linha; lembrete_criado: boolean }> {
    return this.rotina.criarEvento(claims, dto);
  }

  @Post('tarefas')
  criarTarefa(@Claims() claims: SupabaseClaims, @Body() dto: CriarTarefaDto): Promise<Linha> {
    return this.rotina.criarTarefa(claims, dto);
  }

  @Patch('eventos/:id')
  editarEvento(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: EditarEventoDto): Promise<Linha> {
    return this.rotina.editarEvento(claims, id, dto);
  }

  @Patch('tarefas/:id')
  editarTarefa(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: EditarTarefaDto): Promise<Linha> {
    return this.rotina.editarTarefa(claims, id, dto);
  }

  @Post('eventos/:id/concluir')
  @HttpCode(200)
  concluirEvento(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<{ item: Linha; registrado_no_crm: boolean }> {
    return this.rotina.concluir(claims, 'evento', id);
  }

  @Post('tarefas/:id/concluir')
  @HttpCode(200)
  concluirTarefa(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<{ item: Linha; registrado_no_crm: boolean }> {
    return this.rotina.concluir(claims, 'tarefa', id);
  }

  @Delete('eventos/:id')
  removerEvento(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<{ removido: true }> {
    return this.rotina.remover(claims, 'evento', id);
  }

  @Delete('tarefas/:id')
  removerTarefa(@Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string): Promise<{ removido: true }> {
    return this.rotina.remover(claims, 'tarefa', id);
  }

  @Post('comando')
  @HttpCode(200)
  interpretar(@Claims() claims: SupabaseClaims, @Body() dto: ComandoDto): Promise<{ proposal: Record<string, unknown> }> {
    return this.comando.interpretar(claims, dto);
  }
}
