import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../../auth/claims.decorator';
import { SupabaseAuthGuard } from '../../auth/supabase-auth.guard';
import { SupabaseClaims } from '../../prisma/tenant-db';
import {
  ConcluirTarefaDto, CriarOportunidadeDto, CriarTarefaDto, ExcluirOportunidadesDto, MoverOportunidadeDto, SalvarEtapasDto,
} from './crm-funil.dto';
import { erroApi } from './crm-funil.erros';
import { CrmFunilService, Linha } from './crm-funil.service';

const ID_DA_ROTA = new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') });

@Controller('crm')
@UseGuards(SupabaseAuthGuard)
export class CrmFunilController {
  constructor(private readonly funil: CrmFunilService) {}

  @Get('etapas')
  listarEtapas(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.funil.listarEtapas(claims);
  }

  @Patch('etapas')
  salvarEtapas(@Claims() claims: SupabaseClaims, @Body() dto: SalvarEtapasDto): Promise<{ atualizadas: number }> {
    return this.funil.salvarEtapas(claims, dto);
  }

  @Get('oportunidades')
  listarOportunidades(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.funil.listarOportunidades(claims);
  }

  @Post('oportunidades')
  criarOportunidade(@Claims() claims: SupabaseClaims, @Body() dto: CriarOportunidadeDto): Promise<{ id: string }> {
    return this.funil.criarOportunidade(claims, dto);
  }

  @Post('oportunidades/excluir')
  @HttpCode(200)
  excluirOportunidades(@Claims() claims: SupabaseClaims, @Body() dto: ExcluirOportunidadesDto): Promise<{ excluidas: number }> {
    return this.funil.excluirOportunidades(claims, dto);
  }

  @Patch('oportunidades/:id/mover')
  moverOportunidade(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: MoverOportunidadeDto,
  ): Promise<{ id: string }> {
    return this.funil.moverOportunidade(claims, id, dto);
  }

  @Get('tarefas')
  listarTarefas(@Claims() claims: SupabaseClaims): Promise<Linha[]> {
    return this.funil.listarTarefas(claims);
  }

  @Post('tarefas')
  criarTarefa(@Claims() claims: SupabaseClaims, @Body() dto: CriarTarefaDto): Promise<Linha> {
    return this.funil.criarTarefa(claims, dto);
  }

  @Patch('tarefas/:id/concluir')
  concluirTarefa(
    @Claims() claims: SupabaseClaims, @Param('id', ID_DA_ROTA) id: string, @Body() dto: ConcluirTarefaDto,
  ): Promise<Linha> {
    return this.funil.concluirTarefa(claims, id, dto);
  }
}
