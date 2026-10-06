import { SetMetadata } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SuporteDoToken } from './token-suporte';

/**
 * Rotas que NUNCA aceitam o token de atendimento (403 mesmo com a sessão ativa): Auth continua
 * sendo do administrador (como no proxy da Edge, que só repassava rest/storage/functions), o
 * sino ao vivo (SSE de longa duração escaparia da conferência por requisição — o Realtime já
 * ficava desligado no atendimento), a telemetria de presença do titular e a própria abertura e
 * encerramento do atendimento (sem atendimento dentro de atendimento).
 */
export const RECUSA_SUPORTE = 'lotti:recusaTokenSuporte';
export const RecusaTokenSuporte = (): MethodDecorator & ClassDecorator => SetMetadata(RECUSA_SUPORTE, true);

/** O pedaço do Prisma usado aqui (o PrismaService, na conexão dona: fora do RLS). */
type ClienteSql = Pick<Prisma.TransactionClient, '$queryRaw'>;

export interface ConferenciaSuporte extends SuporteDoToken {
  /** claims.sub do token: tem de ser o titular gravado na sessão. */
  userId: string;
  /** Requisição que escreve (fora de GET/HEAD/OPTIONS): grava a linha `suporte_requisicao`. */
  escrita: boolean;
  metodo: string;
  /** Padrão da rota (ex.: /api/imoveis/:id), nunca o caminho com ids ou query. */
  recurso: string;
}

/**
 * Confere a sessão de atendimento a cada requisição e, se ela escreve, registra a auditoria — no
 * MESMO comando, então não existe escrita autorizada sem a linha de auditoria.
 *
 * As condições são as de suporte_obter_credenciais(), que o proxy da Edge chamava a cada pedido:
 * sessão do ator e do titular, não encerrada e não vencida; o ator ainda é admin/super_admin; a
 * conta atendida segue ativa e o titular não virou administrador. A linha `suporte_requisicao`
 * é a mesma que o proxy gravava para functions/storage (serviço 'api', recurso = padrão da rota);
 * as escritas no banco continuam auditadas campo a campo por auditar_mutacao_suporte().
 *
 * Devolve o corretor_id da conta atendida, ou null quando a sessão não vale mais.
 */
export async function conferirSessaoSuporte(db: ClienteSql, c: ConferenciaSuporte): Promise<string | null> {
  const linhas = await db.$queryRaw<Array<{ corretor_id: string }>>(Prisma.sql`
    with sessao as (
      select s.id, s.ator_user_id, s.corretor_id
        from public.admin_sessoes_suporte s
       where s.id = ${c.sessaoId}::uuid
         and s.auth_session_id = ${c.authSessionId}::uuid
         and s.ator_user_id = ${c.atorUserId}::uuid
         and s.user_id = ${c.userId}::uuid
         and s.encerrado_em is null
         and s.expira_em > now()
         and exists (select 1 from public.user_roles r
                      where r.user_id = s.ator_user_id and r.role in ('admin', 'super_admin') and r.revogado_em is null)
         and exists (select 1 from public.corretores co
                      where co.id = s.corretor_id and co.user_id = s.user_id and co.status = 'ativo')
         and not exists (select 1 from public.user_roles r
                          where r.user_id = s.user_id and r.role in ('admin', 'super_admin') and r.revogado_em is null)
    ), auditoria as (
      insert into public.admin_auditoria (ator_user_id, acao, entidade, entidade_id, dados_depois)
      select sessao.ator_user_id, 'suporte_requisicao', 'corretores', sessao.corretor_id::text,
             jsonb_build_object('sessao_id', sessao.id, 'servico', 'api', 'recurso', ${c.recurso}::text,
                                'metodo', ${c.metodo}::text)
        from sessao
       where ${c.escrita}::boolean
      returning id
    )
    select sessao.corretor_id::text as corretor_id from sessao`);
  return linhas[0]?.corretor_id ?? null;
}
