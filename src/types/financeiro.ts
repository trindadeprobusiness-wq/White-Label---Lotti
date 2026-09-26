export type TipoLancamento = 'RECEITA' | 'DESPESA';

export type CategoriaFinanceira = 
  // Despesas originais
  | 'ANUNCIO_PORTAL'
  | 'ANUNCIO_SOCIAL'
  | 'ANUNCIO_TRADICIONAL'
  | 'OPERACIONAL_ESCRITORIO'
  | 'OPERACIONAL_TRANSPORTE'
  | 'OPERACIONAL_SISTEMA'
  | 'IMPOSTO_ISS'
  | 'IMPOSTO_IR'
  | 'TAXA_BANCARIA'
  | 'COMISSAO_PARCEIRO'
  // Receitas originais
  | 'COMISSAO_VENDA'
  | 'COMISSAO_LOCACAO'
  | 'TAXA_INTERMEDIACAO'
  | 'HONORARIO_AVALIACAO'
  | 'CONSULTORIA'
  // Geral
  | 'OUTROS'
  // ── Novas categorias (DRE) ──
  // Receitas
  | 'TAXA_ADMINISTRACAO'
  | 'TAXA_CONTRATO'
  | 'SERVICOS'
  | 'MULTA_JUROS_RECEBIDOS'
  | 'OUTRAS_RECEITAS'
  // Despesas
  | 'MARKETING_ANUNCIO'
  | 'COMISSAO_CORRETOR'
  | 'EQUIPE_PESSOAL'
  | 'CONTABILIDADE'
  | 'JURIDICO'
  | 'ESCRITORIO'
  | 'TAXAS_GATEWAY'
  | 'OUTRAS_DESPESAS'
  // Deduções
  | 'IMPOSTO_FATURAMENTO'
  | 'ESTORNO'
  | 'DESCONTO_CONCEDIDO'
  // Resultado financeiro
  | 'RECEITA_FINANCEIRA'
  | 'JUROS_PAGOS'
  | 'TARIFA_BANCARIA';

export interface LancamentoFinanceiro {
  id: string;
  corretor_id: string;
  tipo: TipoLancamento;
  categoria: CategoriaFinanceira;
  descricao: string;
  valor: number;
  data: string;
  /** Mês de competência para a DRE (default = data). */
  data_competencia?: string;
  /** Data efetiva do pagamento para fluxo de caixa. */
  data_pagamento?: string;
  recorrente: boolean;
  contrato_id?: string;
  imovel_id?: string;
  fatura_id?: string;
  comprovante_url?: string;
  /** pago | pendente | cancelado */
  status?: string;
  /** Se false, não entra na DRE (ex: repasses). */
  impacta_dre?: boolean;
  /** Override do grupo DRE (prioridade sobre mapeamento automático). */
  grupo_dre?: string;
  /** Detalhe livre (ex: "Meta Ads", "OLX"). */
  subcategoria?: string;
  /** Origem: manual | rental | contract | asaas. */
  source_type?: string;
  /** ID do registro de origem. */
  source_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ResumoFinanceiro {
  receita_total: number;
  despesa_total: number;
  lucro: number;
  margem: number;
}

export interface LancamentoPorCategoria {
  categoria: CategoriaFinanceira;
  total: number;
  percentual: number;
}

export interface ProjecaoMensal {
  mes: string;
  receita: number;
  despesa: number;
  lucro: number;
  projetado?: boolean;
}

export const CATEGORIA_LABELS: Record<CategoriaFinanceira, string> = {
  // ── Originais ──
  ANUNCIO_PORTAL: 'Portais (ZAP, VivaReal, OLX)',
  ANUNCIO_SOCIAL: 'Redes Sociais (Meta, Google)',
  ANUNCIO_TRADICIONAL: 'Tradicional (Placas, Panfletos)',
  OPERACIONAL_ESCRITORIO: 'Escritório (Aluguel, Luz)',
  OPERACIONAL_TRANSPORTE: 'Transporte (Combustível)',
  OPERACIONAL_SISTEMA: 'Sistemas e Ferramentas',
  IMPOSTO_ISS: 'ISS',
  IMPOSTO_IR: 'Imposto de Renda',
  TAXA_BANCARIA: 'Tarifas Bancárias',
  COMISSAO_PARCEIRO: 'Comissão a Parceiros',
  COMISSAO_VENDA: 'Comissão de Venda',
  COMISSAO_LOCACAO: 'Comissão de Locação',
  TAXA_INTERMEDIACAO: 'Taxa de Intermediação',
  HONORARIO_AVALIACAO: 'Avaliação de Imóveis',
  CONSULTORIA: 'Consultoria',
  OUTROS: 'Outros',
  // ── Novas (Receita) ──
  TAXA_ADMINISTRACAO: 'Taxa de Administração',
  TAXA_CONTRATO: 'Taxa de Contrato',
  SERVICOS: 'Serviços',
  MULTA_JUROS_RECEBIDOS: 'Multas / Juros Recebidos',
  OUTRAS_RECEITAS: 'Outras Receitas',
  // ── Novas (Despesa) ──
  MARKETING_ANUNCIO: 'Marketing e Anúncios',
  COMISSAO_CORRETOR: 'Comissão de Corretores',
  EQUIPE_PESSOAL: 'Equipe / Pessoal',
  CONTABILIDADE: 'Contabilidade',
  JURIDICO: 'Jurídico',
  ESCRITORIO: 'Escritório',
  TAXAS_GATEWAY: 'Taxas Asaas / Gateway',
  OUTRAS_DESPESAS: 'Outras Despesas',
  // ── Deduções ──
  IMPOSTO_FATURAMENTO: 'Imposto sobre Faturamento',
  ESTORNO: 'Estorno',
  DESCONTO_CONCEDIDO: 'Desconto Concedido',
  // ── Resultado financeiro ──
  RECEITA_FINANCEIRA: 'Receita Financeira',
  JUROS_PAGOS: 'Juros Pagos',
  TARIFA_BANCARIA: 'Tarifa Bancária',
};

export const CATEGORIA_ICONS: Record<CategoriaFinanceira, string> = {
  ANUNCIO_PORTAL: '🌐',
  ANUNCIO_SOCIAL: '📱',
  ANUNCIO_TRADICIONAL: '📋',
  OPERACIONAL_ESCRITORIO: '🏢',
  OPERACIONAL_TRANSPORTE: '🚗',
  OPERACIONAL_SISTEMA: '💻',
  IMPOSTO_ISS: '📄',
  IMPOSTO_IR: '📑',
  TAXA_BANCARIA: '🏦',
  COMISSAO_PARCEIRO: '🤝',
  COMISSAO_VENDA: '💰',
  COMISSAO_LOCACAO: '🔑',
  TAXA_INTERMEDIACAO: '📝',
  HONORARIO_AVALIACAO: '📊',
  CONSULTORIA: '💼',
  OUTROS: '📦',
  // ── Novas ──
  TAXA_ADMINISTRACAO: '🏠',
  TAXA_CONTRATO: '📃',
  SERVICOS: '🔧',
  MULTA_JUROS_RECEBIDOS: '💵',
  OUTRAS_RECEITAS: '💎',
  MARKETING_ANUNCIO: '📢',
  COMISSAO_CORRETOR: '👤',
  EQUIPE_PESSOAL: '👥',
  CONTABILIDADE: '🧮',
  JURIDICO: '⚖️',
  ESCRITORIO: '🏢',
  TAXAS_GATEWAY: '💳',
  OUTRAS_DESPESAS: '📦',
  IMPOSTO_FATURAMENTO: '📄',
  ESTORNO: '↩️',
  DESCONTO_CONCEDIDO: '🏷️',
  RECEITA_FINANCEIRA: '📈',
  JUROS_PAGOS: '📉',
  TARIFA_BANCARIA: '🏦',
};

export const CATEGORIAS_DESPESA: CategoriaFinanceira[] = [
  // Custos variáveis
  'COMISSAO_CORRETOR',
  'COMISSAO_PARCEIRO',
  'TAXAS_GATEWAY',
  // Despesas operacionais
  'MARKETING_ANUNCIO',
  'ANUNCIO_PORTAL',
  'ANUNCIO_SOCIAL',
  'ANUNCIO_TRADICIONAL',
  'EQUIPE_PESSOAL',
  'OPERACIONAL_ESCRITORIO',
  'ESCRITORIO',
  'OPERACIONAL_SISTEMA',
  'CONTABILIDADE',
  'JURIDICO',
  'OPERACIONAL_TRANSPORTE',
  // Deduções
  'IMPOSTO_FATURAMENTO',
  'ESTORNO',
  'DESCONTO_CONCEDIDO',
  // Resultado financeiro
  'TAXA_BANCARIA',
  'TARIFA_BANCARIA',
  'JUROS_PAGOS',
  // Impostos
  'IMPOSTO_ISS',
  'IMPOSTO_IR',
  // Geral
  'OUTRAS_DESPESAS',
  'OUTROS',
];

export const CATEGORIAS_RECEITA: CategoriaFinanceira[] = [
  'COMISSAO_VENDA',
  'COMISSAO_LOCACAO',
  'TAXA_ADMINISTRACAO',
  'TAXA_INTERMEDIACAO',
  'TAXA_CONTRATO',
  'HONORARIO_AVALIACAO',
  'CONSULTORIA',
  'SERVICOS',
  'MULTA_JUROS_RECEBIDOS',
  'RECEITA_FINANCEIRA',
  'OUTRAS_RECEITAS',
  'OUTROS',
];
