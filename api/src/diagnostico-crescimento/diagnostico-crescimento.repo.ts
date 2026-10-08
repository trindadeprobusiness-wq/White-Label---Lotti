import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { erroPg } from '../parceiros/parceiros.erros';
import { ErroPublico, type Snapshot } from './contratos';

export type AcaoBanco = 'start' | 'read' | 'resume' | 'answer' | 'complete' | 'cta';

export interface Notificacao {
  id: string;
  session_id: string;
  kind: 'started' | 'completed';
  lease_id: string;
  payload: Snapshot;
}

/**
 * As funções SECURITY DEFINER da migration 20261008120000_diagnostico_conversacional, chamadas
 * pela conexão da API (dona do banco), no lugar do service_role da Edge Function. Cada chamada é
 * uma instrução própria, fora de transação, como cada `rpc()` do PostgREST era.
 *
 * Os erros seguem o `rpc()` da Edge: invalid_session → 404, version_conflict e session_completed →
 * 409; qualquer outro erro do banco vira `diagnostic_database_error` (503 no service). O texto do
 * Postgres nunca chega ao visitante.
 */
@Injectable()
export class DiagnosticoCrescimentoRepo {
  constructor(private readonly prisma: PrismaService) {}

  consumirLimite(ipHash: string, sessao: string, inicio: boolean): Promise<unknown> {
    return this.valor(Prisma.sql`select public.diagnostic_consume_limit(
      p_ip_hash => ${ipHash}::text, p_session => ${sessao}::uuid, p_start => ${inicio}::boolean) as valor`);
  }

  async mutar(sessao: string, tokenHash: string, acao: AcaoBanco, versao: number | null, payload: Record<string, unknown> = {}): Promise<Snapshot> {
    return await this.valor(Prisma.sql`select public.diagnostic_mutate(
      p_session => ${sessao}::uuid, p_token_hash => ${tokenHash}::text, p_action => ${acao}::text,
      p_version => ${versao}::int, p_payload => ${JSON.stringify(payload)}::jsonb) as valor`) as Snapshot;
  }

  reservarIa(sessao: string, limiteDiario: number): Promise<unknown> {
    return this.valor(Prisma.sql`select public.diagnostic_reserve_ai(
      p_session => ${sessao}::uuid, p_daily_limit => ${limiteDiario}::int) as valor`);
  }

  async reivindicarNotificacoes(sessao: string | null, limite: number): Promise<Notificacao[]> {
    const linhas = await this.consultar<{ linha: Notificacao }>(Prisma.sql`select to_jsonb(n) as linha
      from public.diagnostic_claim_notifications(p_session => ${sessao}::uuid, p_limit => ${limite}::int) n`);
    return linhas.map((l) => l.linha);
  }

  concluirNotificacao(id: string, lease: string, sucesso: boolean, erro: string | null): Promise<unknown> {
    return this.valor(Prisma.sql`select public.diagnostic_finish_notification(
      p_id => ${id}::uuid, p_lease => ${lease}::uuid, p_success => ${sucesso}::boolean, p_error => ${erro}::text) as valor`);
  }

  async manutencao(): Promise<number> {
    return Number(await this.valor(Prisma.sql`select public.diagnostic_maintenance() as valor`));
  }

  private async valor(consulta: Prisma.Sql): Promise<unknown> {
    const linhas = await this.consultar<{ valor: unknown }>(consulta);
    return linhas[0]?.valor ?? null;
  }

  private async consultar<T>(consulta: Prisma.Sql): Promise<T[]> {
    try {
      return await this.prisma.$queryRaw<T[]>(consulta);
    } catch (e) {
      const motivo = erroPg(e)?.mensagem ?? '';
      if (motivo.includes('invalid_session')) throw new ErroPublico(404, 'Sessão não encontrada.');
      if (motivo.includes('version_conflict')) throw new ErroPublico(409, 'Sua conversa foi atualizada. Retome a sessão e tente novamente.');
      if (motivo.includes('session_completed')) throw new ErroPublico(409, 'Este diagnóstico já foi concluído.');
      throw new Error('diagnostic_database_error');
    }
  }
}
