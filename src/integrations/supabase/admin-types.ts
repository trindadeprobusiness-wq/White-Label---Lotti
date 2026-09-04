/**
 * Tipos das tabelas e RPCs do back office.
 *
 * Escrito à mão de propósito. O `types.ts` gerado cobre 11 de ~35 tabelas e está
 * desatualizado desde maio — é a origem dos 74 erros de typecheck da baseline.
 * Regenerá-lo exige acesso ao projeto Supabase e mexeria nessa baseline, então
 * fica como dívida separada. Enquanto isso, este arquivo dá tipagem real ao
 * código novo em vez de espalhar `as any`.
 *
 * Precisa acompanhar as migrations 20260814100000..20260814130000.
 */

// ── Papéis ────────────────────────────────────────────────────────────────
export type Papel = 'admin' | 'super_admin';

// ── Ciclo de vida da conta ────────────────────────────────────────────────
export type StatusCorretor = 'ativo' | 'suspenso' | 'inativo';

/**
 * Como classificamos atividade. `sem_dados` é uma categoria própria, não um
 * sinônimo de inativo: o registro de atividade só começou com o back office, e
 * chamar de "inativo" quem nunca teve chance de ser medido seria inventar
 * história.
 */
export type ClassificacaoAtividade = 'ativo' | 'inativo' | 'sem_dados';

export interface UsuarioAdmin {
  corretor_id: string;
  user_id: string;
  nome: string;
  email: string;
  telefone: string | null;
  creci: string | null;
  status: StatusCorretor;
  criado_em: string;
  ultimo_acesso_em: string | null;
  atividade: ClassificacaoAtividade;
  suspenso_em: string | null;
  suspenso_motivo: string | null;
  plano_nome: string | null;
  assinatura_status: string | null;
  parceiro_id: string | null;
  parceiro_nome: string | null;
  total_clientes: number;
  total_imoveis: number;
}

export interface PaginaUsuarios {
  itens: UsuarioAdmin[];
  total: number;
}

// ── Métricas ──────────────────────────────────────────────────────────────
export interface JanelaPeriodo {
  inicio: string;
  fim: string;
}

export interface MetricasUsuarios {
  total: number;
  novos: number;
  novos_anterior: number;
  ativos: number;
  inativos: number;
  sem_dados: number;
  suspensos: number;
}

export interface MetricasAssinaturas {
  trialing: number;
  active: number;
  past_due: number;
  canceled: number;
  expired: number;
  read_only: number;
}

export interface MetricasReceita {
  /**
   * Falso enquanto não houver nenhum evento financeiro confirmado. A tela usa
   * isto para dizer "sem eventos financeiros confirmados" em vez de "R$ 0,00" —
   * ausência de dado não é faturamento zero.
   */
  tem_dados: boolean;
  recebida: number;
  recebida_anterior: number;
  eventos: number;
}

export interface MetricasParceiros {
  total: number;
  ativos: number;
  cliques: number;
  cliques_anterior: number;
  atribuicoes: number;
  conversoes: number;
  conversoes_anterior: number;
}

export interface MetricasComissoes {
  valor_pendente: number;
  valor_aprovada: number;
  valor_paga: number;
  valor_estornada: number;
  quantidade: number;
}

export interface MetricasVisaoGeral {
  periodo: JanelaPeriodo;
  periodo_anterior: JanelaPeriodo;
  janela_atividade_dias: number;
  usuarios: MetricasUsuarios;
  assinaturas: MetricasAssinaturas;
  receita: MetricasReceita;
  parceiros: MetricasParceiros;
  comissoes: MetricasComissoes;
}

// ── Parceiros ─────────────────────────────────────────────────────────────
export type StatusParceiro = 'ativo' | 'inativo' | 'suspenso' | 'encerrado';

export type BaseCalculo =
  | 'receita_bruta'
  | 'receita_liquida'
  | 'primeiro_pagamento'
  | 'valor_fixo';

export interface Parceiro {
  id: string;
  nome: string;
  empresa: string | null;
  documento: string | null;
  email: string;
  telefone: string | null;
  responsavel: string | null;
  status: StatusParceiro;
  data_inicio: string;
  janela_atribuicao_dias: number;
  observacoes: string | null;
  user_id: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface PercentualParceiro {
  id: string;
  parceiro_id: string;
  percentual: number;
  base_calculo: BaseCalculo;
  valor_fixo: number | null;
  vigencia_inicio: string;
  /** Nulo = vigência aberta. Só uma por parceiro (índice único parcial). */
  vigencia_fim: string | null;
  motivo: string | null;
  criado_em: string;
}

export interface LinkParceiro {
  id: string;
  parceiro_id: string;
  slug: string;
  campanha: string | null;
  principal: boolean;
  ativo: boolean;
  revogado_em: string | null;
  criado_em: string;
  total_cliques: number;
}

/** Linha da listagem: parceiro + regra vigente + resultados agregados. */
export interface ParceiroComResultados extends Parceiro {
  percentual_vigente: number | null;
  base_calculo_vigente: BaseCalculo | null;
  total_cliques: number;
  total_atribuicoes: number;
  total_conversoes: number;
  receita_atribuida: number;
  comissao_pendente: number;
  comissao_aprovada: number;
  comissao_paga: number;
}

export type StatusAtribuicao = 'pendente' | 'convertida' | 'expirada' | 'invalidada';

export interface AtribuicaoParceiro {
  id: string;
  parceiro_id: string;
  link_id: string | null;
  corretor_id: string | null;
  corretor_nome: string | null;
  corretor_email: string | null;
  modelo: string;
  janela_dias: number;
  primeiro_clique_em: string;
  expira_em: string;
  convertido_em: string | null;
  status: StatusAtribuicao;
  motivo_invalidacao: string | null;
}

// ── Receita e comissões ───────────────────────────────────────────────────
export type OrigemReceita = 'manual_admin' | 'asaas' | 'stripe';
export type StatusReceita = 'confirmado' | 'estornado' | 'cancelado';
export type TipoReceita = 'assinatura' | 'addon' | 'avulso';

export interface EventoReceita {
  id: string;
  corretor_id: string | null;
  corretor_nome: string | null;
  origem: OrigemReceita;
  external_id: string | null;
  tipo: TipoReceita;
  valor_bruto: number;
  valor_liquido: number | null;
  status: StatusReceita;
  confirmado_em: string;
  competencia: string | null;
  motivo: string | null;
  criado_em: string;
}

export type StatusComissao =
  | 'pendente'
  | 'em_validacao'
  | 'aprovada'
  | 'paga'
  | 'cancelada'
  | 'estornada';

export interface Comissao {
  id: string;
  parceiro_id: string;
  parceiro_nome: string;
  corretor_id: string | null;
  corretor_nome: string | null;
  receita_evento_id: string;
  valor_base: number;
  /** Congelado na geração. Alterar o percentual do parceiro não mexe aqui. */
  percentual_aplicado: number;
  base_calculo: BaseCalculo;
  valor_comissao: number;
  status: StatusComissao;
  gerada_em: string;
  aprovada_em: string | null;
  paga_em: string | null;
  competencia: string | null;
  motivo_cancelamento: string | null;
}

export interface PagamentoComissao {
  id: string;
  parceiro_id: string;
  valor_total: number;
  metodo: string | null;
  referencia: string | null;
  competencia_inicio: string | null;
  competencia_fim: string | null;
  pago_em: string;
  observacoes: string | null;
  criado_em: string;
}

// ── Auditoria ─────────────────────────────────────────────────────────────
export interface RegistroAuditoria {
  id: number;
  ator_user_id: string | null;
  ator_nome: string | null;
  ator_email: string | null;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  dados_antes: Record<string, unknown> | null;
  dados_depois: Record<string, unknown> | null;
  motivo: string | null;
  criado_em: string;
}

export interface PaginaAuditoria {
  itens: RegistroAuditoria[];
  total: number;
}

// ── Operação do SaaS ──────────────────────────────────────────────────────
// Acrescentado em 20260901160000/160100/160200. Assinatura e plano continuam
// vindo das tabelas que já existiam; o back office só passou a lê-las.

export interface MetricasSaas {
  periodo: { inicio: string; fim: string };
  contas: { total: number; novas: number; suspensas: number };
  /** `disponivel: false` = as tabelas plans/subscriptions nao existem na base. */
  assinaturas:
    | { disponivel: false }
    | {
        disponivel: true;
        total: number;
        ativas: number;
        trials: number;
        vencidas: number;
        canceladas: number;
        expiradas: number;
        somente_leitura: number;
        novas: number;
      };
  /** `tem_dados` distingue "MRR zero" de "nenhuma assinatura registrada". */
  mrr: { tem_dados: boolean; valor: number; em_risco: number };
  inadimplencia: { assinaturas: number; valor_mensal: number };
  /** `taxa` é null quando não havia base no início — não é 0%. */
  churn: { ativos_inicio: number; cancelados: number; taxa: number | null };
  /** `disponivel: false` = a base não tem a tabela do checkout do site. */
  pagamentos:
    | { disponivel: false }
    | {
        disponivel: true;
        recebido: number;
        pendente: number;
        vencido: number;
        estornado: number;
        pedidos: number;
      };
  parceiros: {
    ativos: number;
    receita_atribuida: number;
    comissao_gerada: number;
    saldo_a_pagar: number;
  };
  cancelamentos: { registrados: number };
}

export interface Assinatura {
  id: string;
  corretor_id: string;
  conta_nome: string;
  conta_email: string;
  plano_codigo: string;
  plano_nome: string;
  status: string;
  ciclo: string;
  valor_mensal: number;
  trial_termina_em: string | null;
  periodo_inicio: string | null;
  proxima_cobranca: string | null;
  cancelar_no_fim: boolean;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  id_externo: string | null;
  criada_em: string;
}

export interface PaginaAssinaturas {
  /** false = migration 20260807120000 (plans/subscriptions) nao aplicada. */
  disponivel: boolean;
  itens: Assinatura[];
  total: number;
}

export interface PagamentoSaas {
  id: string;
  pagador: string;
  email: string;
  plano: string;
  ciclo: string;
  metodo: string;
  valor: number;
  status: string;
  motivo_falha: string | null;
  id_cobranca: string | null;
  id_assinatura: string | null;
  corretor_id: string | null;
  conta_nome: string | null;
  acesso_enviado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface PaginaPagamentos {
  disponivel: boolean;
  itens: PagamentoSaas[];
  total: number;
  totais: {
    recebido: number;
    pendente: number;
    vencido: number;
    estornado: number;
  } | null;
}

export interface Cancelamento {
  id: string;
  corretor_id: string | null;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  identificado: boolean;
  plano_anterior: string | null;
  motivo: string;
  comentario: string | null;
  origem: string;
  data_cancelamento: string;
  criado_em: string;
}

export interface PaginaCancelamentos {
  itens: Cancelamento[];
  total: number;
}

export interface MetricasCancelamento {
  total_geral: number;
  no_periodo: number;
  ultimos_30: number;
  motivo_principal: string | null;
  por_motivo: { motivo: string; total: number }[];
  por_origem: { origem: string; total: number }[];
}

export interface LoteRepasse {
  id: string;
  referencia: string;
  status: string;
  valor_total: number;
  total_parceiros: number;
  total_comissoes: number;
  saldo_minimo: number | null;
  exportado_em: string | null;
  pago_em: string | null;
  referencia_pagamento: string | null;
  comprovante_url?: string | null;
  observacoes: string | null;
  motivo_cancelamento: string | null;
  criado_em: string;
}

export interface PaginaLotes {
  itens: LoteRepasse[];
  total: number;
}

export interface ItemLote {
  parceiro_id: string;
  nome: string;
  documento: string | null;
  chave_pix: string;
  tipo_chave_pix: string;
  comissoes: number;
  valor: number;
}

export interface DetalheLote {
  lote: LoteRepasse;
  itens: ItemLote[];
}

export interface ElegiveisRepasse {
  saldo_minimo: number;
  hold_dias: number;
  itens: {
    parceiro_id: string;
    nome: string;
    email: string;
    documento: string | null;
    chave_pix: string | null;
    tipo_chave_pix: string | null;
    comissoes: number;
    valor: number;
    elegivel: boolean;
  }[];
}

export interface StatusIntegracoes {
  checkout:
    | { instalado: false }
    | {
        instalado: true;
        pedidos: number;
        pagos: number;
        aguardando: number;
        falhados: number;
        pagos_sem_acesso: number;
      };
  webhook:
    | { instalado: false }
    | {
        instalado: true;
        eventos: number;
        processados: number;
        falhados: number;
        ultimo_processado_em: string | null;
        ultimo_erro: string | null;
      };
  tracking: {
    cliques_total: number;
    cliques_30d: number;
    links_ativos: number;
    atribuicoes: number;
    ultimo_clique_em: string | null;
  };
  repasse: {
    parceiros_ativos: number;
    parceiros_com_pix: number;
    comissoes_aprovadas: number;
    lotes_abertos: number;
    portal_publicado: boolean;
  };
  rls: { tabela: string; rls: boolean; policies: number }[];
  verificado_em: string;
}

export interface ConfigAdmin {
  chave: string;
  valor: unknown;
  descricao: string | null;
  atualizado_em: string;
}
