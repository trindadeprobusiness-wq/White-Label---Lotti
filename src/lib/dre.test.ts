import { describe, it, expect } from 'vitest';
import { calcularDRE, grupoDRE, contarNaoClassificados, CATEGORIA_DRE_MAP } from './dre';
import type { LancamentoFinanceiro, CategoriaFinanceira } from '@/types/financeiro';

/** Fábrica de lançamento mínimo para testes. */
function fakeLancamento(
  overrides: Partial<LancamentoFinanceiro> & { tipo: 'RECEITA' | 'DESPESA'; categoria: CategoriaFinanceira; valor: number },
): LancamentoFinanceiro {
  return {
    id: crypto.randomUUID(),
    corretor_id: 'test-corretor',
    descricao: 'Teste',
    data: '2026-09-15',
    recorrente: false,
    created_at: '2026-09-15T00:00:00Z',
    updated_at: '2026-09-15T00:00:00Z',
    impacta_dre: true,
    status: 'pago',
    ...overrides,
  };
}

describe('calcularDRE', () => {
  it('calcula DRE com o cenário de teste real especificado', () => {
    const lancamentos: LancamentoFinanceiro[] = [
      // Receitas
      fakeLancamento({ tipo: 'RECEITA', categoria: 'COMISSAO_VENDA', valor: 20000 }),
      fakeLancamento({ tipo: 'RECEITA', categoria: 'TAXA_ADMINISTRACAO', valor: 5000 }),
      fakeLancamento({ tipo: 'RECEITA', categoria: 'COMISSAO_LOCACAO', valor: 3000 }),
      // Custos variáveis
      fakeLancamento({ tipo: 'DESPESA', categoria: 'COMISSAO_CORRETOR', valor: 4000 }),
      fakeLancamento({ tipo: 'DESPESA', categoria: 'TAXAS_GATEWAY', valor: 500 }),
      // Despesas operacionais
      fakeLancamento({ tipo: 'DESPESA', categoria: 'MARKETING_ANUNCIO', valor: 2000 }),
      fakeLancamento({ tipo: 'DESPESA', categoria: 'ANUNCIO_PORTAL', valor: 1000 }),
      fakeLancamento({ tipo: 'DESPESA', categoria: 'CONTABILIDADE', valor: 500 }),
      fakeLancamento({ tipo: 'DESPESA', categoria: 'OPERACIONAL_TRANSPORTE', valor: 1000 }),
      fakeLancamento({ tipo: 'DESPESA', categoria: 'OPERACIONAL_SISTEMA', valor: 500 }),
    ];

    const dre = calcularDRE(lancamentos);

    expect(dre.receitaBruta).toBe(28000);
    expect(dre.deducoes).toBe(0);
    expect(dre.receitaLiquida).toBe(28000);
    expect(dre.custosVariaveis).toBe(4500);
    expect(dre.margemContribuicao).toBe(23500);
    expect(dre.despesasOperacionais).toBe(5000);
    expect(dre.resultadoOperacional).toBe(18500);
    expect(dre.resultadoFinanceiroTotal).toBe(0);
    expect(dre.impostos).toBe(0);
    expect(dre.resultadoLiquido).toBe(18500);
  });

  it('ignora lançamentos cancelados', () => {
    const lancamentos: LancamentoFinanceiro[] = [
      fakeLancamento({ tipo: 'RECEITA', categoria: 'COMISSAO_VENDA', valor: 10000 }),
      fakeLancamento({ tipo: 'RECEITA', categoria: 'COMISSAO_VENDA', valor: 5000, status: 'cancelado' }),
    ];

    const dre = calcularDRE(lancamentos);
    expect(dre.receitaBruta).toBe(10000);
  });

  it('ignora lançamentos que não impactam DRE (repasses)', () => {
    const lancamentos: LancamentoFinanceiro[] = [
      fakeLancamento({ tipo: 'RECEITA', categoria: 'COMISSAO_VENDA', valor: 10000 }),
      fakeLancamento({ tipo: 'RECEITA', categoria: 'OUTROS', valor: 3000, impacta_dre: false }),
    ];

    const dre = calcularDRE(lancamentos);
    expect(dre.receitaBruta).toBe(10000);
  });

  it('calcula margem líquida corretamente', () => {
    const lancamentos: LancamentoFinanceiro[] = [
      fakeLancamento({ tipo: 'RECEITA', categoria: 'COMISSAO_VENDA', valor: 10000 }),
      fakeLancamento({ tipo: 'DESPESA', categoria: 'EQUIPE_PESSOAL', valor: 4000 }),
    ];

    const dre = calcularDRE(lancamentos);
    expect(dre.margemLiquida).toBe(60); // 6000 / 10000 * 100
  });

  it('trata divisão por zero quando não há receita', () => {
    const lancamentos: LancamentoFinanceiro[] = [
      fakeLancamento({ tipo: 'DESPESA', categoria: 'OPERACIONAL_ESCRITORIO', valor: 500 }),
    ];

    const dre = calcularDRE(lancamentos);
    expect(dre.margemLiquida).toBe(0);
    expect(dre.margemContribuicaoPerc).toBe(0);
    expect(dre.resultadoLiquido).toBe(-500);
  });

  it('retorna estrutura vazia sem lançamentos', () => {
    const dre = calcularDRE([]);
    expect(dre.receitaBruta).toBe(0);
    expect(dre.resultadoLiquido).toBe(0);
    expect(dre.receitaOperacional.linhas).toHaveLength(0);
  });

  it('separa resultado financeiro (receitas - despesas financeiras)', () => {
    const lancamentos: LancamentoFinanceiro[] = [
      fakeLancamento({ tipo: 'RECEITA', categoria: 'RECEITA_FINANCEIRA', valor: 200 }),
      fakeLancamento({ tipo: 'DESPESA', categoria: 'TAXA_BANCARIA', valor: 1200 }),
    ];

    const dre = calcularDRE(lancamentos);
    expect(dre.resultadoFinanceiroTotal).toBe(-1000);
  });

  it('respeita grupo_dre como override', () => {
    const l = fakeLancamento({
      tipo: 'DESPESA',
      categoria: 'OUTROS',
      valor: 500,
      grupo_dre: 'custo_variavel',
    });
    expect(grupoDRE(l)).toBe('custo_variavel');
  });
});

describe('contarNaoClassificados', () => {
  it('conta lançamentos OUTROS sem grupo_dre', () => {
    const lancamentos: LancamentoFinanceiro[] = [
      fakeLancamento({ tipo: 'DESPESA', categoria: 'OUTROS', valor: 100 }),
      fakeLancamento({ tipo: 'DESPESA', categoria: 'OUTROS', valor: 200 }),
      fakeLancamento({ tipo: 'RECEITA', categoria: 'COMISSAO_VENDA', valor: 1000 }),
    ];
    expect(contarNaoClassificados(lancamentos)).toBe(2);
  });

  it('não conta OUTROS com grupo_dre definido', () => {
    const lancamentos: LancamentoFinanceiro[] = [
      fakeLancamento({ tipo: 'DESPESA', categoria: 'OUTROS', valor: 100, grupo_dre: 'despesa_operacional' }),
    ];
    expect(contarNaoClassificados(lancamentos)).toBe(0);
  });
});

describe('CATEGORIA_DRE_MAP', () => {
  it('cobre todas as categorias existentes', () => {
    const allCategories: CategoriaFinanceira[] = [
      'ANUNCIO_PORTAL', 'ANUNCIO_SOCIAL', 'ANUNCIO_TRADICIONAL',
      'OPERACIONAL_ESCRITORIO', 'OPERACIONAL_TRANSPORTE', 'OPERACIONAL_SISTEMA',
      'IMPOSTO_ISS', 'IMPOSTO_IR', 'TAXA_BANCARIA', 'COMISSAO_PARCEIRO',
      'COMISSAO_VENDA', 'COMISSAO_LOCACAO', 'TAXA_INTERMEDIACAO',
      'HONORARIO_AVALIACAO', 'CONSULTORIA', 'OUTROS',
      // novas
      'TAXA_ADMINISTRACAO', 'TAXA_CONTRATO', 'SERVICOS', 'MULTA_JUROS_RECEBIDOS',
      'OUTRAS_RECEITAS', 'MARKETING_ANUNCIO', 'COMISSAO_CORRETOR', 'EQUIPE_PESSOAL',
      'CONTABILIDADE', 'JURIDICO', 'ESCRITORIO', 'TAXAS_GATEWAY', 'OUTRAS_DESPESAS',
      'IMPOSTO_FATURAMENTO', 'ESTORNO', 'DESCONTO_CONCEDIDO',
      'RECEITA_FINANCEIRA', 'JUROS_PAGOS', 'TARIFA_BANCARIA',
    ];

    for (const cat of allCategories) {
      expect(CATEGORIA_DRE_MAP[cat]).toBeDefined();
    }
  });
});
