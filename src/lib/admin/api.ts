/**
 * Ponte tipada entre o back office e o Postgres.
 *
 * Por que existe: o `Database` gerado em integrations/supabase/types.ts não
 * conhece nenhuma tabela nem função do back office, então toda chamada exigiria
 * um cast. O projeto já resolve isso espalhando `as unknown as SupabaseClient`
 * (ver useCrm.ts:35). Aqui o cast acontece UMA vez, isolado neste arquivo, e o
 * resto do código novo trabalha com tipos reais de admin-types.ts.
 *
 * A alternativa correta é regenerar o types.ts — dívida anterior, registrada em
 * docs/BACKOFFICE.md, que mexeria nos 74 erros da baseline.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/** Único ponto de escape de tipo do módulo admin. */
const cliente = () => supabase as unknown as SupabaseClient;

/** Erro de permissão devolvido pelo guard das RPCs (`ERRCODE 42501`). */
export class AcessoNegadoError extends Error {
  constructor(mensagem = 'Você não tem permissão para esta ação.') {
    super(mensagem);
    this.name = 'AcessoNegadoError';
  }
}

/**
 * As migrations do back office ainda não foram aplicadas neste banco.
 *
 * Precisa ser distinguido de "sem permissão": os dois deixam o painel
 * inacessível, mas a solução é oposta — um é conceder papel, o outro é rodar
 * as migrations. Tratar os dois como o mesmo caso manda o operador procurar
 * problema no lugar errado.
 */
export class BackOfficeNaoInstaladoError extends Error {
  constructor() {
    super('As migrations do back office ainda não foram aplicadas neste banco.');
    this.name = 'BackOfficeNaoInstaladoError';
  }
}

function ehAcessoNegado(erro: PostgrestError): boolean {
  return erro.code === '42501' || /acesso negado/i.test(erro.message ?? '');
}

/**
 * PGRST202 = o PostgREST não achou a função no schema cache.
 * 42883 = undefined_function no próprio Postgres.
 * Ambos significam a mesma coisa aqui: a migration não rodou.
 */
function ehFuncaoInexistente(erro: PostgrestError): boolean {
  return (
    erro.code === 'PGRST202' ||
    erro.code === '42883' ||
    /could not find the function|does not exist/i.test(erro.message ?? '')
  );
}

/**
 * Chama uma RPC e devolve o resultado já tipado.
 *
 * As RPCs do back office levantam exceção quando o chamador não é admin, em vez
 * de devolverem lista vazia. Silenciar isso mostraria "nenhum resultado" para
 * quem perdeu o papel — traduzimos em erro explícito para a tela poder reagir.
 */
export async function chamarRpc<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await cliente().rpc(nome, args);

  if (error) {
    if (ehFuncaoInexistente(error)) throw new BackOfficeNaoInstaladoError();
    if (ehAcessoNegado(error)) throw new AcessoNegadoError();
    throw error;
  }

  return data as T;
}

/** Acesso direto às tabelas do back office, protegidas por `is_admin()` na RLS. */
export function tabelaAdmin(nome: string) {
  return cliente().from(nome);
}

/**
 * Registra uma ação sensível na trilha append-only.
 *
 * Chamada explícita e não automática: só quem faz a ação sabe o motivo que o
 * operador digitou, e o motivo é justamente o que dá valor à auditoria.
 * Falha aqui não é silenciada — uma ação sensível sem trilha é pior que a ação
 * não ter acontecido.
 */
export async function registrarAuditoria(entrada: {
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  dadosAntes?: Record<string, unknown> | null;
  dadosDepois?: Record<string, unknown> | null;
  motivo?: string | null;
}): Promise<void> {
  await chamarRpc<number>('registrar_auditoria_admin', {
    p_acao: entrada.acao,
    p_entidade: entrada.entidade,
    p_entidade_id: entrada.entidadeId ?? null,
    p_dados_antes: entrada.dadosAntes ?? null,
    p_dados_depois: entrada.dadosDepois ?? null,
    p_motivo: entrada.motivo ?? null,
  });
}
