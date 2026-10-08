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
import { apiDisponivel } from '@/lib/api';
import * as parceirosApi from '@/lib/api/parceiros';

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
type ArgsRpc = Record<string, unknown>;

const txt = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
const nmr = (v: unknown) => (typeof v === 'number' ? v : null);

/**
 * Página aceita pela API a partir dos argumentos da RPC.
 *
 * As RPCs do back office se dividem em duas convenções — `p_limite`/`p_offset`
 * e `p_pagina`/`p_por_pagina`. A API só conhece `pagina`/`por_pagina`, e o
 * offset sempre foi `(pagina - 1) * limite`, então a conversão é exata.
 */
function paginaDe(a: ArgsRpc): { pagina?: number; por_pagina?: number } {
  const limite = nmr(a.p_limite);
  if (limite) return { pagina: Math.floor((nmr(a.p_offset) ?? 0) / limite) + 1, por_pagina: limite };
  return { pagina: nmr(a.p_pagina) ?? undefined, por_pagina: nmr(a.p_por_pagina) ?? undefined };
}

const periodoDe = (a: ArgsRpc) => ({ inicio: String(a.p_inicio), fim: String(a.p_fim) });

/**
 * RPC do back office → função da API Lotti.
 *
 * Mapa explícito de propósito: uma RPC nova sem rota correspondente continua
 * indo para o Supabase, em vez de virar um 404 numa tela que ninguém mexeu.
 */
const ROTAS_DA_API: Record<string, (a: ArgsRpc) => Promise<unknown>> = {
  // Auditoria
  admin_listar_auditoria: (a) => parceirosApi.listarAuditoriaApi({
    entidade: txt(a.p_entidade), acao: txt(a.p_acao), de: txt(a.p_de), ate: txt(a.p_ate), ...paginaDe(a),
  }),
  registrar_auditoria_admin: (a) => parceirosApi.registrarAuditoriaApi({
    acao: String(a.p_acao), entidade: String(a.p_entidade), entidade_id: txt(a.p_entidade_id),
    dados_antes: (a.p_dados_antes ?? null) as Record<string, unknown> | null,
    dados_depois: (a.p_dados_depois ?? null) as Record<string, unknown> | null,
    motivo: txt(a.p_motivo),
  }),

  // Parceiros, percentuais e links
  admin_listar_parceiros: (a) => parceirosApi.listarParceirosApi({
    busca: txt(a.p_busca), status: txt(a.p_status), ...paginaDe(a),
  }),
  admin_opcoes_parceiros: () => parceirosApi.opcoesParceirosApi(),
  admin_definir_percentual: (a) => parceirosApi.definirPercentualApi(String(a.p_parceiro_id), {
    percentual: Number(a.p_percentual), base_calculo: String(a.p_base_calculo),
    valor_fixo: nmr(a.p_valor_fixo), vigencia_inicio: txt(a.p_vigencia_inicio), motivo: txt(a.p_motivo),
  }),

  // Comissões, pagamentos e receita
  admin_listar_comissoes: (a) => parceirosApi.listarComissoesApi({
    parceiro_id: txt(a.p_parceiro_id), status: txt(a.p_status), de: txt(a.p_de), ate: txt(a.p_ate), ...paginaDe(a),
  }),
  admin_transicionar_comissao: (a) => parceirosApi.transicionarComissaoApi(String(a.p_comissao_id), {
    novo_status: String(a.p_novo_status), motivo: txt(a.p_motivo),
  }),
  admin_registrar_pagamento: (a) => parceirosApi.registrarPagamentoApi({
    parceiro_id: String(a.p_parceiro_id), comissao_ids: (a.p_comissao_ids ?? []) as string[],
    metodo: txt(a.p_metodo), referencia: txt(a.p_referencia), observacoes: txt(a.p_observacoes), pago_em: txt(a.p_pago_em),
  }),
  admin_listar_receita: (a) => parceirosApi.listarReceitaApi({
    corretor_id: txt(a.p_corretor_id), status: txt(a.p_status), de: txt(a.p_de), ate: txt(a.p_ate), ...paginaDe(a),
  }),
  admin_registrar_receita: (a) => parceirosApi.registrarReceitaApi({
    corretor_id: String(a.p_corretor_id), valor_bruto: Number(a.p_valor_bruto), confirmado_em: String(a.p_confirmado_em),
    tipo: txt(a.p_tipo) ?? undefined, valor_liquido: nmr(a.p_valor_liquido), competencia: txt(a.p_competencia),
    motivo: String(a.p_motivo),
  }),
  admin_estornar_receita: (a) => parceirosApi.estornarReceitaApi(String(a.p_receita_id), String(a.p_motivo)),

  // Repasses em lote
  admin_parceiros_elegiveis_repasse: (a) => parceirosApi.elegiveisRepasseApi(nmr(a.p_saldo_minimo)),
  admin_listar_lotes: (a) => parceirosApi.listarLotesApi({ status: txt(a.p_status), ...paginaDe(a) }),
  admin_detalhe_lote: (a) => parceirosApi.loteApi(String(a.p_lote_id)),
  admin_gerar_lote_repasse: (a) => parceirosApi.gerarLoteApi({
    parceiro_ids: (a.p_parceiro_ids ?? []) as string[], saldo_minimo: nmr(a.p_saldo_minimo), observacoes: txt(a.p_observacoes),
  }),
  admin_marcar_lote_exportado: (a) => parceirosApi.marcarLoteExportadoApi(String(a.p_lote_id)),
  admin_marcar_lote_pago: (a) => parceirosApi.marcarLotePagoApi(String(a.p_lote_id), {
    pago_em: String(a.p_pago_em), referencia: String(a.p_referencia), comprovante_url: txt(a.p_comprovante_url),
  }),
  admin_cancelar_lote: (a) => parceirosApi.cancelarLoteApi(String(a.p_lote_id), String(a.p_motivo)),

  // Contas, atendimento e operação do SaaS
  admin_listar_usuarios: (a) => parceirosApi.listarUsuariosApi({
    busca: txt(a.p_busca), status: txt(a.p_status), atividade: txt(a.p_atividade), parceiro_id: txt(a.p_parceiro_id),
    criado_de: txt(a.p_criado_de), criado_ate: txt(a.p_criado_ate), ordenar: txt(a.p_ordenar), direcao: txt(a.p_direcao),
    ...paginaDe(a),
  }),
  admin_detalhe_usuario: (a) => parceirosApi.usuarioApi(String(a.p_corretor_id)),
  admin_definir_status_corretor: (a) => parceirosApi.definirStatusCorretorApi(String(a.p_corretor_id), {
    status: String(a.p_status), motivo: String(a.p_motivo),
  }),
  admin_listar_atendimento: (a) => parceirosApi.listarAtendimentoApi({
    busca: txt(a.p_busca), status: txt(a.p_status), campanha: txt(a.p_campanha), parceiro_id: txt(a.p_parceiro_id),
    origem_direta: typeof a.p_origem_direta === 'boolean' ? a.p_origem_direta : undefined,
    ...paginaDe(a),
  }),
  admin_listar_assinaturas: (a) => parceirosApi.listarAssinaturasApi({
    busca: txt(a.p_busca), status: txt(a.p_status), plano: txt(a.p_plano), ciclo: txt(a.p_ciclo), ...paginaDe(a),
  }),
  admin_listar_pagamentos: (a) => parceirosApi.listarPagamentosApi({
    busca: txt(a.p_busca), status: txt(a.p_status), metodo: txt(a.p_metodo), plano: txt(a.p_plano),
    inicio: txt(a.p_inicio), fim: txt(a.p_fim), ...paginaDe(a),
  }),
  admin_listar_cancelamentos: (a) => parceirosApi.listarCancelamentosApi({
    motivo: txt(a.p_motivo), origem: txt(a.p_origem), plano: txt(a.p_plano),
    inicio: txt(a.p_inicio), fim: txt(a.p_fim), ...paginaDe(a),
  }),
  admin_registrar_cancelamento: (a) => parceirosApi.registrarCancelamentoApi({
    motivo: String(a.p_motivo), corretor_id: txt(a.p_corretor_id), contato_nome: txt(a.p_contato_nome),
    contato_email: txt(a.p_contato_email), contato_telefone: txt(a.p_contato_telefone),
    plano_anterior: txt(a.p_plano_anterior), comentario: txt(a.p_comentario),
    origem: txt(a.p_origem) ?? undefined, data: txt(a.p_data),
  }),
  admin_listar_organizacoes: (a) => parceirosApi.listarOrganizacoesApi({
    busca: txt(a.p_busca), status: txt(a.p_status), plano: txt(a.p_plano), ...paginaDe(a),
  }),
  admin_detalhe_organizacao: (a) => parceirosApi.organizacaoApi(String(a.p_organizacao_id ?? a.p_id)),
  admin_listar_acessos: (a) => parceirosApi.listarAcessosApi({ busca: txt(a.p_busca), ...paginaDe(a) }),

  // Métricas, integrações e configuração
  admin_metricas_visao_geral: (a) => parceirosApi.metricasApi(periodoDe(a)),
  admin_metricas_saas: (a) => parceirosApi.metricasSaasApi(periodoDe(a)),
  admin_metricas_cancelamento: (a) => parceirosApi.metricasCancelamentoApi(periodoDe(a)),
  admin_onboarding_metricas: (a) => parceirosApi.metricasOnboardingApi(periodoDe(a)),
  admin_status_integracoes: () => parceirosApi.statusIntegracoesApi(),
  admin_listar_config: () => parceirosApi.listarConfigApi(),
  admin_salvar_config: (a) => parceirosApi.salvarConfigApi(String(a.p_chave), a.p_valor),
};

/** Só para teste: as RPCs que a API já atende. */
export const RPCS_NA_API = Object.keys(ROTAS_DA_API);

export async function chamarRpc<T>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const rota = ROTAS_DA_API[nome];
  if (rota && apiDisponivel()) return (await rota(args)) as T;

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
