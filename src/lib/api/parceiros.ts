import { chamarApi } from '@/lib/api';
import { AcessoNegadoError, BackOfficeNaoInstaladoError } from '@/lib/admin/api';
import type {
  AtribuicaoParceiro, ConfigAdmin, LinkParceiro, Parceiro, PercentualParceiro,
} from '@/integrations/supabase/admin-types';
import { corpoJson, ErroApi, escolher, lerJson } from './http';

// Parceiros (atribuição, comissões, portal e backoffice) pela API Lotti, última
// onda da fase 4. Só é chamado atrás de apiDisponivel(). Os nomes dos campos
// espelham os DTOs da API: chave fora deles dá 400, então o front só manda as
// aceitas e monta a query apenas com os filtros presentes.

type Linha = Record<string, unknown>;

/**
 * Relança nos dois tipos que o painel já distingue.
 *
 * `usePapeis().naoInstalado` e os `catch` das telas comparam a classe, não o
 * texto: sem esta tradução o operador sem papel e o banco sem migration
 * cairiam no mesmo erro genérico, e a solução de cada um é oposta.
 */
/**
 * Textos dos 503 deste módulo.
 *
 * `lerErroApi` descarta o corpo de qualquer 5xx — para não vazar stack trace
 * de erro interno no toast. Mas estes dois 503 são mensagens escritas para o
 * operador, e sem elas ele veria o texto genérico e não saberia que falta
 * configuração no servidor. O código vem da API; o texto é constante daqui.
 */
const TEXTO_DE_CONFIGURACAO: Record<string, string> = {
  provedor_de_email_nao_configurado: 'O envio de convites por e-mail ainda não está configurado no servidor.',
  diagnostico_nao_configurado: 'A captura do diagnóstico comercial não está configurada no servidor.',
};

function traduzir(e: unknown): never {
  if (e instanceof ErroApi) {
    if (e.codigo === 'backoffice_nao_instalado') throw new BackOfficeNaoInstaladoError();
    if (e.codigo === 'sem_permissao') throw new AcessoNegadoError(e.message);
    const texto = e.codigo ? TEXTO_DE_CONFIGURACAO[e.codigo] : undefined;
    if (texto) throw new ErroApi(e.status, e.codigo, texto, e.details, e.code);
  }
  throw e;
}

async function ler<T>(res: Response, padrao: string): Promise<T> {
  try {
    return await lerJson<T>(res, padrao);
  } catch (e) {
    return traduzir(e);
  }
}

/** Query só com os filtros presentes: `busca` vazio não vira `busca=`. */
export function consulta(filtros: object): string {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros as Record<string, unknown>)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(chave, String(valor));
  }
  const busca = params.toString();
  return busca ? `?${busca}` : '';
}

const id = (v: string) => encodeURIComponent(v);

/**
 * Chamada sem sessão, só para a rota pública do clique.
 *
 * `chamarApi` exige token e lança quando não há — e quem abre `/r/:slug` é um
 * visitante anônimo. A rota do clique não tem guard, então aqui o `fetch` vai
 * cru, sem `Authorization`.
 */
async function chamarPublico(caminho: string, init: RequestInit): Promise<Response> {
  const base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');
  if (!base) throw new Error('API Lotti indisponível no momento.');
  return fetch(`${base}${caminho}`, init);
}

export interface PaginaFiltros { pagina?: number; por_pagina?: number }

export interface PortalParceiro {
  parceiro: {
    id: string; nome: string; email: string; status: string; comissao: number; valor_fixo: number | null;
    base_calculo: string; renovacoes: string; documento: string | null; chave_pix: string | null; tipo_chave_pix: string | null;
  };
  teto_renovacoes: number | null;
  cliques_30_dias: number;
  cliques_total: number;
  cadastros: number;
  comissoes: Record<string, number>;
  pagamentos: Array<{
    id: string; valor_total: number; pago_em: string; referencia: string | null;
    competencia_inicio: string | null; competencia_fim: string | null;
  }>;
  campanhas: Array<{ campanha: string; cliques: number; indicacoes: number; assinaturas: number }>;
  link_principal: string | null;
}

export interface RespostaConvite {
  ok: boolean; parceiro_id?: string; email?: string; email_enviado?: boolean; existing_account?: boolean; error?: string;
}

export interface DetalheParceiro {
  parceiro: Parceiro;
  percentuais: PercentualParceiro[];
  links: LinkParceiro[];
  atribuicoes: AtribuicaoParceiro[];
}

// ── Público e atribuição (P1, T1) ────────────────────────────────────────

export async function registrarCliqueApi(dados: {
  slug: string; visitante_id: string; utm?: Record<string, unknown> | null; referer?: string | null;
}): Promise<{ ok: boolean; parceiro_nome?: string }> {
  return ler(
    await chamarPublico('/api/parceiros/clique',
      corpoJson('POST', escolher(dados, ['slug', 'visitante_id', 'utm', 'referer'] as const))),
    'Não foi possível registrar a visita.',
  );
}

export async function reivindicarAtribuicaoApi(visitanteId: string): Promise<{ ok?: boolean; ja_atribuido?: boolean }> {
  return ler(
    await chamarApi('/api/parceiros/atribuicao', corpoJson('POST', { visitante_id: visitanteId })),
    'Não foi possível registrar a indicação.',
  );
}

// ── Portal do parceiro (T2, T3) ──────────────────────────────────────────

export async function portalParceiroApi(): Promise<PortalParceiro> {
  return ler(await chamarApi('/api/parceiros/portal'), 'Não foi possível carregar seu painel.');
}

export async function salvarRepasseApi(dados: { documento: string; tipo_chave: string; chave: string }): Promise<void> {
  await ler(
    await chamarApi('/api/parceiros/portal/repasse',
      corpoJson('PUT', escolher(dados, ['documento', 'tipo_chave', 'chave'] as const))),
    'Confira o documento e a chave PIX do mesmo titular.',
  );
}

// ── Convite (T4) ─────────────────────────────────────────────────────────

export async function convidarParceiroApi(corpo: {
  acao?: 'criar'; parceiro_id?: string; dados?: Record<string, unknown>;
}): Promise<RespostaConvite> {
  return ler(
    await chamarApi('/api/parceiros/convites',
      corpoJson('POST', escolher(corpo, ['acao', 'parceiro_id', 'dados'] as const))),
    'Não foi possível enviar o convite.',
  );
}

// ── Papéis e auditoria (B1–B3) ───────────────────────────────────────────

export async function meusPapeisApi(): Promise<string[]> {
  return ler(await chamarApi('/api/admin/papeis'), 'Não foi possível consultar os seus papéis.');
}

export interface FiltrosAuditoriaApi extends PaginaFiltros {
  entidade?: string | null; acao?: string | null; de?: string | null; ate?: string | null;
}

export async function listarAuditoriaApi(filtros: FiltrosAuditoriaApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/auditoria${consulta(filtros)}`), 'Não foi possível carregar a auditoria.');
}

export async function registrarAuditoriaApi(entrada: {
  acao: string; entidade: string; entidade_id?: string | null;
  dados_antes?: Record<string, unknown> | null; dados_depois?: Record<string, unknown> | null; motivo?: string | null;
}): Promise<{ id: number }> {
  return ler(
    await chamarApi('/api/admin/auditoria', corpoJson('POST',
      escolher(entrada, ['acao', 'entidade', 'entidade_id', 'dados_antes', 'dados_depois', 'motivo'] as const))),
    'Não foi possível registrar a auditoria.',
  );
}

// ── Parceiros, percentuais e links (B4–B11) ──────────────────────────────

export interface FiltrosParceirosApi extends PaginaFiltros { busca?: string | null; status?: string | null }

export async function listarParceirosApi(filtros: FiltrosParceirosApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/parceiros${consulta(filtros)}`), 'Não foi possível carregar os parceiros.');
}

export async function opcoesParceirosApi(): Promise<unknown> {
  return ler(await chamarApi('/api/admin/parceiros/opcoes'), 'Não foi possível carregar os parceiros.');
}

export async function parceiroApi(parceiroId: string): Promise<DetalheParceiro> {
  return ler(await chamarApi(`/api/admin/parceiros/${id(parceiroId)}`), 'Não foi possível carregar o parceiro.');
}

/** Colunas aceitas pelo DTO; `criado_por` e os campos de convite são do servidor. */
export const CHAVES_PARCEIRO = [
  'nome', 'empresa', 'documento', 'email', 'telefone', 'responsavel', 'status', 'data_inicio',
  'janela_atribuicao_dias', 'observacoes', 'chave_pix', 'tipo_chave_pix', 'cortesia_dias', 'cortesia_expira_em', 'tipo',
] as const;

export async function criarParceiroApi(dados: Linha): Promise<{ id: string }> {
  return ler(
    await chamarApi('/api/admin/parceiros', corpoJson('POST', escolher(dados, CHAVES_PARCEIRO))),
    'Não foi possível salvar o parceiro.',
  );
}

export async function editarParceiroApi(parceiroId: string, dados: Linha): Promise<{ id: string }> {
  return ler(
    await chamarApi(`/api/admin/parceiros/${id(parceiroId)}`, corpoJson('PATCH', escolher(dados, CHAVES_PARCEIRO))),
    'Não foi possível salvar o parceiro.',
  );
}

export async function definirPercentualApi(parceiroId: string, dados: {
  percentual: number; base_calculo: string; valor_fixo?: number | null; vigencia_inicio?: string | null; motivo?: string | null;
}): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/parceiros/${id(parceiroId)}/percentuais`, corpoJson('POST',
      escolher(dados, ['percentual', 'base_calculo', 'valor_fixo', 'vigencia_inicio', 'motivo'] as const))),
    'Não foi possível alterar o percentual.',
  );
}

export async function criarLinkApi(parceiroId: string, dados: {
  slug: string; campanha?: string | null; principal?: boolean;
}): Promise<{ id: string; slug: string }> {
  return ler(
    await chamarApi(`/api/admin/parceiros/${id(parceiroId)}/links`, corpoJson('POST',
      escolher(dados, ['slug', 'campanha', 'principal'] as const))),
    'Não foi possível criar o link.',
  );
}

export async function revogarLinkApi(linkId: string): Promise<{ revogado: true }> {
  return ler(
    await chamarApi(`/api/admin/links/${id(linkId)}/revogar`, corpoJson('POST')),
    'Não foi possível revogar o link.',
  );
}

// ── Comissões, pagamentos e receita (B12–B17) ────────────────────────────

export interface FiltrosComissoesApi extends PaginaFiltros {
  parceiro_id?: string | null; status?: string | null; de?: string | null; ate?: string | null;
}

export async function listarComissoesApi(filtros: FiltrosComissoesApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/comissoes${consulta(filtros)}`), 'Não foi possível carregar as comissões.');
}

export async function transicionarComissaoApi(comissaoId: string, dados: {
  novo_status: string; motivo?: string | null;
}): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/comissoes/${id(comissaoId)}/status`, corpoJson('POST',
      escolher(dados, ['novo_status', 'motivo'] as const))),
    'Não foi possível atualizar a comissão.',
  );
}

export async function registrarPagamentoApi(dados: {
  parceiro_id: string; comissao_ids: string[]; metodo?: string | null; referencia?: string | null;
  observacoes?: string | null; pago_em?: string | null;
}): Promise<unknown> {
  return ler(
    await chamarApi('/api/admin/pagamentos-parceiro', corpoJson('POST',
      escolher(dados, ['parceiro_id', 'comissao_ids', 'metodo', 'referencia', 'observacoes', 'pago_em'] as const))),
    'Não foi possível registrar o pagamento.',
  );
}

export interface FiltrosReceitaApi extends PaginaFiltros {
  corretor_id?: string | null; status?: string | null; de?: string | null; ate?: string | null;
}

export async function listarReceitaApi(filtros: FiltrosReceitaApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/receita${consulta(filtros)}`), 'Não foi possível carregar a receita.');
}

export async function registrarReceitaApi(dados: {
  corretor_id: string; valor_bruto: number; confirmado_em: string; tipo?: string;
  valor_liquido?: number | null; competencia?: string | null; motivo: string;
}): Promise<unknown> {
  return ler(
    await chamarApi('/api/admin/receita', corpoJson('POST',
      escolher(dados, ['corretor_id', 'valor_bruto', 'confirmado_em', 'tipo', 'valor_liquido', 'competencia', 'motivo'] as const))),
    'Não foi possível registrar a receita.',
  );
}

export async function estornarReceitaApi(receitaId: string, motivo: string): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/receita/${id(receitaId)}/estornar`, corpoJson('POST', { motivo })),
    'Não foi possível estornar a receita.',
  );
}

// ── Repasses em lote (B18–B24) ───────────────────────────────────────────

export async function elegiveisRepasseApi(saldoMinimo: number | null = null): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/repasses/elegiveis${consulta({ saldo_minimo: saldoMinimo })}`),
    'Não foi possível carregar os parceiros elegíveis.',
  );
}

export async function listarLotesApi(filtros: PaginaFiltros & { status?: string | null } = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/lotes${consulta(filtros)}`), 'Não foi possível carregar os lotes.');
}

export async function loteApi(loteId: string): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/lotes/${id(loteId)}`), 'Não foi possível carregar o lote.');
}

export async function gerarLoteApi(dados: {
  parceiro_ids: string[]; saldo_minimo?: number | null; observacoes?: string | null;
}): Promise<unknown> {
  return ler(
    await chamarApi('/api/admin/lotes', corpoJson('POST',
      escolher(dados, ['parceiro_ids', 'saldo_minimo', 'observacoes'] as const))),
    'Não foi possível gerar o lote.',
  );
}

export async function marcarLoteExportadoApi(loteId: string): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/lotes/${id(loteId)}/exportado`, corpoJson('POST')),
    'Não foi possível marcar o lote como exportado.',
  );
}

export async function marcarLotePagoApi(loteId: string, dados: {
  pago_em: string; referencia: string; comprovante_url?: string | null;
}): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/lotes/${id(loteId)}/pago`, corpoJson('POST',
      escolher(dados, ['pago_em', 'referencia', 'comprovante_url'] as const))),
    'Não foi possível marcar o lote como pago.',
  );
}

export async function cancelarLoteApi(loteId: string, motivo: string): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/lotes/${id(loteId)}/cancelar`, corpoJson('POST', { motivo })),
    'Não foi possível cancelar o lote.',
  );
}

// ── Usuários, atendimento e assinaturas (B25–B34) ────────────────────────

export interface FiltrosUsuariosApi extends PaginaFiltros {
  busca?: string | null; status?: string | null; atividade?: string | null; parceiro_id?: string | null;
  criado_de?: string | null; criado_ate?: string | null; ordenar?: string | null; direcao?: string | null;
}

export async function listarUsuariosApi(filtros: FiltrosUsuariosApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/usuarios${consulta(filtros)}`), 'Não foi possível carregar as contas.');
}

export async function usuarioApi(corretorId: string): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/usuarios/${id(corretorId)}`), 'Não foi possível carregar a conta.');
}

export async function definirStatusCorretorApi(corretorId: string, dados: {
  status: string; motivo: string;
}): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/usuarios/${id(corretorId)}/status`, corpoJson('POST',
      escolher(dados, ['status', 'motivo'] as const))),
    'Não foi possível alterar o status.',
  );
}

export interface FiltrosAtendimentoApi extends PaginaFiltros {
  busca?: string | null; status?: string | null; campanha?: string | null; parceiro_id?: string | null; origem_direta?: boolean;
}

export async function listarAtendimentoApi(filtros: FiltrosAtendimentoApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/atendimento${consulta(filtros)}`), 'Não foi possível carregar o atendimento.');
}

export interface FiltrosAssinaturasApi extends PaginaFiltros {
  busca?: string | null; status?: string | null; plano?: string | null; ciclo?: string | null;
}

export async function listarAssinaturasApi(filtros: FiltrosAssinaturasApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/assinaturas${consulta(filtros)}`), 'Não foi possível carregar as assinaturas.');
}

export interface FiltrosPagamentosApi extends PaginaFiltros {
  busca?: string | null; status?: string | null; metodo?: string | null; plano?: string | null;
  inicio?: string | null; fim?: string | null;
}

export async function listarPagamentosApi(filtros: FiltrosPagamentosApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/pagamentos${consulta(filtros)}`), 'Não foi possível carregar os pagamentos.');
}

export interface FiltrosCancelamentosApi extends PaginaFiltros {
  motivo?: string | null; origem?: string | null; plano?: string | null; inicio?: string | null; fim?: string | null;
}

export async function listarCancelamentosApi(filtros: FiltrosCancelamentosApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/cancelamentos${consulta(filtros)}`), 'Não foi possível carregar os cancelamentos.');
}

export async function registrarCancelamentoApi(dados: Linha): Promise<unknown> {
  return ler(
    await chamarApi('/api/admin/cancelamentos', corpoJson('POST', escolher(dados, [
      'motivo', 'corretor_id', 'contato_nome', 'contato_email', 'contato_telefone',
      'plano_anterior', 'comentario', 'origem', 'data',
    ] as const))),
    'Não foi possível registrar o cancelamento.',
  );
}

export interface FiltrosOrganizacoesApi extends PaginaFiltros {
  busca?: string | null; status?: string | null; plano?: string | null;
}

export async function listarOrganizacoesApi(filtros: FiltrosOrganizacoesApi = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/organizacoes${consulta(filtros)}`), 'Não foi possível carregar as organizações.');
}

export async function organizacaoApi(organizacaoId: string): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/organizacoes/${id(organizacaoId)}`), 'Não foi possível carregar a organização.');
}

export async function listarAcessosApi(filtros: PaginaFiltros & { busca?: string | null } = {}): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/acessos${consulta(filtros)}`), 'Não foi possível carregar os acessos.');
}

// ── Métricas e integrações (B35–B39) ─────────────────────────────────────

export interface PeriodoApi { inicio: string; fim: string }

export async function metricasApi(periodo: PeriodoApi): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/metricas${consulta(periodo)}`), 'Não foi possível carregar as métricas.');
}

export async function metricasSaasApi(periodo: PeriodoApi): Promise<unknown> {
  return ler(await chamarApi(`/api/admin/metricas/saas${consulta(periodo)}`), 'Não foi possível carregar as métricas.');
}

export async function metricasCancelamentoApi(periodo: PeriodoApi): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/metricas/cancelamento${consulta(periodo)}`),
    'Não foi possível carregar as métricas.',
  );
}

export async function metricasOnboardingApi(periodo: PeriodoApi): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/metricas/onboarding${consulta(periodo)}`),
    'Não foi possível carregar as métricas.',
  );
}

export async function statusIntegracoesApi(): Promise<unknown> {
  return ler(await chamarApi('/api/admin/integracoes'), 'Não foi possível consultar as integrações.');
}

// ── Configuração e diagnósticos (B40–B44) ────────────────────────────────

/** B40: a RPC `admin_listar_config`, que valida a chave contra a lista interna. */
export async function listarConfigApi(): Promise<ConfigAdmin[]> {
  return ler(await chamarApi('/api/admin/config'), 'Não foi possível carregar a configuração.');
}

/** B40b: as linhas cruas de `admin_config`, ordenadas por chave — o que a tela usa. */
export async function listarLinhasConfigApi(): Promise<Linha[]> {
  return ler(await chamarApi('/api/admin/config/linhas'), 'Não foi possível carregar a configuração.');
}

/** B41: UPDATE direto, caminho da tela de configurações (policy de super admin). */
export async function atualizarConfigApi(chave: string, valor: unknown): Promise<Linha> {
  return ler(
    await chamarApi(`/api/admin/config/${id(chave)}`, corpoJson('PUT', { valor })),
    'Não foi possível salvar. Só um super admin pode alterar.',
  );
}

/** B42: a RPC `admin_salvar_config`, caminho de useSalvarConfig. */
export async function salvarConfigApi(chave: string, valor: unknown): Promise<unknown> {
  return ler(
    await chamarApi(`/api/admin/config/${id(chave)}`, corpoJson('POST', { valor })),
    'Não foi possível salvar a configuração.',
  );
}

export async function listarDiagnosticosApi(filtros: PaginaFiltros = {}): Promise<Linha[]> {
  return ler(
    await chamarApi(`/api/admin/diagnosticos${consulta(filtros)}`),
    'Não foi possível carregar os diagnósticos.',
  );
}

export async function atualizarStatusDiagnosticoApi(diagnosticoId: string, status: string): Promise<Linha> {
  return ler(
    await chamarApi(`/api/admin/diagnosticos/${id(diagnosticoId)}`, corpoJson('PATCH', { status })),
    'Não foi possível atualizar o status.',
  );
}
