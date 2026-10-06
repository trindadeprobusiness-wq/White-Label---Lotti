import { Body, Controller, Get, HttpCode, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { EMPTY, from, Observable, switchMap } from 'rxjs';
import { Claims } from '../auth/claims.decorator';
import { RecusaTokenSuporte } from '../auth/sessao-suporte';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { AlertasHub, EventoSino } from './alertas-hub';
import { AlertaSino, NotificacoesService } from './notificacoes.service';

export class ListarNotificacoesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limite?: number;
}

export class MarcarLidasDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) ids?: string[];
}

@Controller('notificacoes')
@UseGuards(SupabaseAuthGuard)
export class NotificacoesController {
  constructor(private readonly servico: NotificacoesService, private readonly hub: AlertasHub) {}

  @Get()
  listar(@Claims() claims: SupabaseClaims, @Query() q: ListarNotificacoesDto): Promise<AlertaSino[]> {
    return this.servico.listar(claims, q.limite);
  }

  @Post('lidas')
  @HttpCode(200)
  async lidas(@Claims() claims: SupabaseClaims, @Body() corpo: MarcarLidasDto): Promise<{ marcadas: number }> {
    return { marcadas: await this.servico.marcarLidas(claims, corpo.ids) };
  }

  /**
   * Sino ao vivo (SSE). O front abre com fetch + Authorization: token fora da URL. Fora do
   * atendimento: a conexão longa escaparia da conferência da sessão a cada requisição.
   */
  @Sse('eventos')
  @RecusaTokenSuporte()
  eventos(@Claims() claims: SupabaseClaims): Observable<EventoSino> {
    return from(this.servico.corretorId(claims)).pipe(switchMap((id) => (id ? this.hub.observar(id) : EMPTY)));
  }
}
