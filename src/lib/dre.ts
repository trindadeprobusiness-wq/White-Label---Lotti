/**
 * Motor de cálculo da DRE Gerencial — Lotti.
 *
 * A DRE é um cálculo derivado dos lançamentos financeiros filtrados.
 * Não existe tabela própria: o resultado é computado a cada mudança de período.
 *
 * Fluxo:
 *   Lançamento → classificação automática (categoria → grupo DRE) → DRE
 *
 * Regra de ouro para imobiliárias:
 *   Movimentação ≠ Receita. R$ 3.000 de aluguel recebido, onde R$ 2.700 é repasse,
 *   gera receita de R$ 300 (taxa de administração), não R$ 3.000.
 */

import type { CategoriaFinanceira, LancamentoFinanceiro } from '@/types/financeiro';

// ────────────────────────────────────────────────────────────────────────────
// Grupos da DRE
// ────────────────────────────────────────────────────────────────────────────

export type GrupoDRE =
  | 'receita_operacional'
  | 'deducao_receita'
  | 'custo_variavel'
  | 'despesa_operacional'
  | 'resultado_financeiro'
  | 'imposto';

export const GRUPO_DRE_LABELS: Record<GrupoDRE, string> = {
  receita_operacional: 'Receita Operacional Bruta',
  deducao_receita: 'Deduções da Receita',
  custo_variavel: 'Custos Diretos / Variáveis',
  despesa_operacional: 'Despesas Operacionais',
  resultado_financeiro: 'Resultado Financeiro',
  imposto: 'Impostos / Tributos',
};

// ────────────────────────────────────────────────────────────────────────────
// Mapeamento categoria → grupo DRE
// ────────────────────────────────────────────────────────────────────────────

/**
 * Dado uma categoria, determina o grupo DRE automaticamente.
 * O campo `grupo_dre` do banco serve como override manual.
 */
export const CATEGORIA_DRE_MAP: Record<CategoriaFinanceira, GrupoDRE> = {
  // ── Receitas operacionais ──
  COMISSAO_VENDA: 'receita_operacional',
  COMISSAO_LOCACAO: 'receita_operacional',
  TAXA_INTERMEDIACAO: 'receita_operacional',
  TAXA_ADMINISTRACAO: 'receita_operacional',
  TAXA_CONTRATO: 'receita_operacional',
  HONORARIO_AVALIACAO: 'receita_operacional',
  CONSULTORIA: 'receita_operacional',
  SERVICOS: 'receita_operacional',
  MULTA_JUROS_RECEBIDOS: 'receita_operacional',
  OUTRAS_RECEITAS: 'receita_operacional',

  // ── Deduções de receita ──
  IMPOSTO_FATURAMENTO: 'deducao_receita',
  ESTORNO: 'deducao_receita',
  DESCONTO_CONCEDIDO: 'deducao_receita',

  // ── Custos variáveis (diretamente ligados à receita) ──
  COMISSAO_PARCEIRO: 'custo_variavel',
  COMISSAO_CORRETOR: 'custo_variavel',
  TAXAS_GATEWAY: 'custo_variavel',

  // ── Despesas operacionais ──
  ANUNCIO_PORTAL: 'despesa_operacional',
  ANUNCIO_SOCIAL: 'despesa_operacional',
  ANUNCIO_TRADICIONAL: 'despesa_operacional',
  MARKETING_ANUNCIO: 'despesa_operacional',
  OPERACIONAL_ESCRITORIO: 'despesa_operacional',
  OPERACIONAL_TRANSPORTE: 'despesa_operacional',
  OPERACIONAL_SISTEMA: 'despesa_operacional',
  EQUIPE_PESSOAL: 'despesa_operacional',
  CONTABILIDADE: 'despesa_operacional',
  JURIDICO: 'despesa_operacional',
  ESCRITORIO: 'despesa_operacional',
  OUTRAS_DESPESAS: 'despesa_operacional',

  // ── Resultado financeiro ──
  TAXA_BANCARIA: 'resultado_financeiro',
  TARIFA_BANCARIA: 'resultado_financeiro',
  RECEITA_FINANCEIRA: 'resultado_financeiro',
  JUROS_PAGOS: 'resultado_financeiro',

  // ── Impostos ──
  IMPOSTO_ISS: 'imposto',
  IMPOSTO_IR: 'imposto',

  // ── Catch-all ──
  OUTROS: 'despesa_operacional',
};

/**
 * Retorna o grupo DRE efetivo do lançamento.
 * Prioridade: campo `grupo_dre` do banco > mapeamento automático por categoria.
 */
export function grupoDRE(lancamento: LancamentoFinanceiro): GrupoDRE {
  if (lancamento.grupo_dre && lancamento.grupo_dre in GRUPO_DRE_LABELS) {
    return lancamento.grupo_dre as GrupoDRE;
  }
  return CATEGORIA_DRE_MAP[lancamento.categoria] ?? 'despesa_operacional';
}

// ────────────────────────────────────────────────────────────────────────────
// Subgrupos visuais para expandir na DRE
// ────────────────────────────────────────────────────────────────────────────

export const SUBGRUPOS_DRE: Record<GrupoDRE, { label: string; categorias: CategoriaFinanceira[] }[]> = {
  receita_operacional: [
    { label: 'Comissões de Venda', categorias: ['COMISSAO_VENDA'] },
    { label: 'Comissões de Locação', categorias: ['COMISSAO_LOCACAO'] },
    { label: 'Taxas de Administração', categorias: ['TAXA_ADMINISTRACAO'] },
    { label: 'Taxas de Intermediação', categorias: ['TAXA_INTERMEDIACAO'] },
    { label: 'Taxa de Contrato', categorias: ['TAXA_CONTRATO'] },
    { label: 'Avaliação de Imóveis', categorias: ['HONORARIO_AVALIACAO'] },
    { label: 'Consultoria', categorias: ['CONSULTORIA'] },
    { label: 'Serviços', categorias: ['SERVICOS'] },
    { label: 'Multas / Juros Recebidos', categorias: ['MULTA_JUROS_RECEBIDOS'] },
    { label: 'Outras Receitas', categorias: ['OUTRAS_RECEITAS', 'OUTROS'] },
  ],
  deducao_receita: [
    { label: 'Impostos sobre Faturamento', categorias: ['IMPOSTO_FATURAMENTO'] },
    { label: 'Estornos', categorias: ['ESTORNO'] },
    { label: 'Descontos Concedidos', categorias: ['DESCONTO_CONCEDIDO'] },
  ],
  custo_variavel: [
    { label: 'Comissões de Corretores', categorias: ['COMISSAO_CORRETOR'] },
    { label: 'Comissões a Parceiros', categorias: ['COMISSAO_PARCEIRO'] },
    { label: 'Taxas de Gateway / Asaas', categorias: ['TAXAS_GATEWAY'] },
  ],
  despesa_operacional: [
    { label: 'Marketing / Anúncios', categorias: ['ANUNCIO_PORTAL', 'ANUNCIO_SOCIAL', 'ANUNCIO_TRADICIONAL', 'MARKETING_ANUNCIO'] },
    { label: 'Pessoal', categorias: ['EQUIPE_PESSOAL'] },
    { label: 'Escritório', categorias: ['OPERACIONAL_ESCRITORIO', 'ESCRITORIO'] },
    { label: 'Tecnologia / Software', categorias: ['OPERACIONAL_SISTEMA'] },
    { label: 'Contabilidade', categorias: ['CONTABILIDADE'] },
    { label: 'Jurídico', categorias: ['JURIDICO'] },
    { label: 'Transporte', categorias: ['OPERACIONAL_TRANSPORTE'] },
    { label: 'Outras Despesas', categorias: ['OUTRAS_DESPESAS'] },
  ],
  resultado_financeiro: [
    { label: 'Receitas Financeiras', categorias: ['RECEITA_FINANCEIRA'] },
    { label: 'Juros Pagos', categorias: ['JUROS_PAGOS'] },
    { label: 'Tarifas Bancárias', categorias: ['TAXA_BANCARIA', 'TARIFA_BANCARIA'] },
  ],
  imposto: [
    { label: 'ISS', categorias: ['IMPOSTO_ISS'] },
    { label: 'Imposto de Renda', categorias: ['IMPOSTO_IR'] },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Estrutura de resultado da DRE
// ────────────────────────────────────────────────────────────────────────────

export interface LinhaDRE {
  label: string;
  valor: number;
  categorias: CategoriaFinanceira[];
  /** Lançamentos que compõem esta linha (para drill-down) */
  lancamentos: LancamentoFinanceiro[];
}

export interface GrupoDREResultado {
  grupo: GrupoDRE;
  label: string;
  total: number;
  linhas: LinhaDRE[];
}

export interface ResultadoDRE {
  // Grupos
  receitaOperacional: GrupoDREResultado;
  deducaoReceita: GrupoDREResultado;
  custoVariavel: GrupoDREResultado;
  despesaOperacional: GrupoDREResultado;
  resultadoFinanceiro: GrupoDREResultado;
  imposto: GrupoDREResultado;

  // Totais calculados
  receitaBruta: number;
  deducoes: number;
  receitaLiquida: number;
  custosVariaveis: number;
  margemContribuicao: number;
  margemContribuicaoPerc: number;
  despesasOperacionais: number;
  resultadoOperacional: number;
  resultadoFinanceiroTotal: number;
  resultadoAntesImpostos: number;
  impostos: number;
  resultadoLiquido: number;
  margemLiquida: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Cálculo
// ────────────────────────────────────────────────────────────────────────────

function calcularGrupo(
  grupo: GrupoDRE,
  lancamentos: LancamentoFinanceiro[],
): GrupoDREResultado {
  const subgrupos = SUBGRUPOS_DRE[grupo] ?? [];
  const lancamentosGrupo = lancamentos.filter((l) => grupoDRE(l) === grupo);

  const linhas: LinhaDRE[] = subgrupos
    .map((sg) => {
      const matching = lancamentosGrupo.filter((l) =>
        sg.categorias.includes(l.categoria),
      );
      const total = matching.reduce((acc, l) => acc + Math.abs(Number(l.valor)), 0);
      return {
        label: sg.label,
        valor: total,
        categorias: sg.categorias,
        lancamentos: matching,
      };
    })
    .filter((l) => l.valor > 0); // Ocultar linhas zeradas

  // Pegar lançamentos não mapeados em nenhum subgrupo
  const catsMapped = subgrupos.flatMap((s) => s.categorias);
  const unmapped = lancamentosGrupo.filter((l) => !catsMapped.includes(l.categoria));
  if (unmapped.length > 0) {
    const total = unmapped.reduce((acc, l) => acc + Math.abs(Number(l.valor)), 0);
    if (total > 0) {
      linhas.push({
        label: 'Não classificado',
        valor: total,
        categorias: [],
        lancamentos: unmapped,
      });
    }
  }

  const total = linhas.reduce((acc, l) => acc + l.valor, 0);

  return {
    grupo,
    label: GRUPO_DRE_LABELS[grupo],
    total,
    linhas,
  };
}

/**
 * Calcula a DRE completa a partir de lançamentos já filtrados pelo período.
 *
 * Regras:
 * - Apenas lançamentos com `impacta_dre !== false` entram no cálculo
 * - Usa `data_competencia` quando disponível, senão `data`
 * - Lançamentos com `status === 'cancelado'` são ignorados
 */
export function calcularDRE(lancamentosRaw: LancamentoFinanceiro[]): ResultadoDRE {
  // Filtrar: somente o que impacta a DRE e não está cancelado
  const lancamentos = lancamentosRaw.filter(
    (l) => l.impacta_dre !== false && l.status !== 'cancelado',
  );

  const receitaOperacional = calcularGrupo('receita_operacional', lancamentos);
  const deducaoReceita = calcularGrupo('deducao_receita', lancamentos);
  const custoVariavel = calcularGrupo('custo_variavel', lancamentos);
  const despesaOperacional = calcularGrupo('despesa_operacional', lancamentos);
  const resultadoFinanceiro = calcularGrupo('resultado_financeiro', lancamentos);
  const imposto = calcularGrupo('imposto', lancamentos);

  // Receita financeira é positiva, o resto do resultado financeiro é negativo
  const receitasFinanceiras = lancamentos
    .filter((l) => grupoDRE(l) === 'resultado_financeiro' && l.tipo === 'RECEITA')
    .reduce((acc, l) => acc + Math.abs(Number(l.valor)), 0);
  const despesasFinanceiras = lancamentos
    .filter((l) => grupoDRE(l) === 'resultado_financeiro' && l.tipo === 'DESPESA')
    .reduce((acc, l) => acc + Math.abs(Number(l.valor)), 0);

  const receitaBruta = receitaOperacional.total;
  const deducoes = deducaoReceita.total;
  const receitaLiquida = receitaBruta - deducoes;
  const custosVariaveis = custoVariavel.total;
  const margemContribuicao = receitaLiquida - custosVariaveis;
  const margemContribuicaoPerc = receitaLiquida > 0
    ? (margemContribuicao / receitaLiquida) * 100
    : 0;
  const despesasOperacionais = despesaOperacional.total;
  const resultadoOperacionalTotal = margemContribuicao - despesasOperacionais;
  const resultadoFinanceiroTotal = receitasFinanceiras - despesasFinanceiras;
  const resultadoAntesImpostos = resultadoOperacionalTotal + resultadoFinanceiroTotal;
  const impostos = imposto.total;
  const resultadoLiquido = resultadoAntesImpostos - impostos;
  const margemLiquida = receitaLiquida > 0
    ? (resultadoLiquido / receitaLiquida) * 100
    : 0;

  return {
    receitaOperacional,
    deducaoReceita,
    custoVariavel,
    despesaOperacional,
    resultadoFinanceiro,
    imposto,

    receitaBruta,
    deducoes,
    receitaLiquida,
    custosVariaveis,
    margemContribuicao,
    margemContribuicaoPerc,
    despesasOperacionais,
    resultadoOperacional: resultadoOperacionalTotal,
    resultadoFinanceiroTotal,
    resultadoAntesImpostos,
    impostos,
    resultadoLiquido,
    margemLiquida,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tooltips educativos
// ────────────────────────────────────────────────────────────────────────────

export const TOOLTIPS_DRE: Record<string, string> = {
  receita_bruta:
    'Total de receitas geradas pela imobiliária antes de impostos e deduções.',
  deducoes:
    'Impostos sobre faturamento, estornos e descontos que reduzem a receita bruta.',
  receita_liquida:
    'Receita efetiva após deduzir impostos sobre faturamento, estornos e descontos.',
  custos_variaveis:
    'Custos diretamente ligados à geração de receita: comissões de corretores, parceiros e taxas de gateway.',
  margem_contribuicao:
    'Mostra quanto sobra das receitas depois dos custos diretamente ligados às vendas e serviços.',
  despesas_operacionais:
    'Custos fixos da operação: marketing, pessoal, escritório, tecnologia, contabilidade e outros.',
  resultado_operacional:
    'Mostra quanto a operação da imobiliária gerou depois dos custos e despesas do negócio.',
  resultado_financeiro:
    'Receitas e despesas financeiras: juros recebidos, juros pagos e tarifas bancárias.',
  resultado_liquido:
    'Resultado final da imobiliária após todas as receitas, custos, despesas e impostos.',
  margem_liquida:
    'Percentual de lucro final em relação à receita líquida. Indica a eficiência geral do negócio.',
};

// ────────────────────────────────────────────────────────────────────────────
// Contagem de lançamentos não classificados para DRE
// ────────────────────────────────────────────────────────────────────────────

export function contarNaoClassificados(lancamentos: LancamentoFinanceiro[]): number {
  return lancamentos.filter(
    (l) =>
      l.impacta_dre !== false &&
      l.status !== 'cancelado' &&
      l.categoria === 'OUTROS' &&
      !l.grupo_dre,
  ).length;
}
