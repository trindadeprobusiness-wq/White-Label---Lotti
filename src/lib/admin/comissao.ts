/**
 * Regras de comissão de parceiro.
 *
 * ESPELHA o que está no banco: `gerar_comissao_de_receita()` calcula, e
 * `admin_transicionar_comissao()` valida as transições. A decisão que vale é
 * sempre a do Postgres — este arquivo existe para a interface não oferecer um
 * botão que o servidor vai recusar, e para as regras ficarem testáveis (o
 * vitest do projeto roda em node, sem banco).
 *
 * Se um dos dois mudar, o outro precisa mudar junto. Os testes deste arquivo
 * são a especificação escrita dos dois.
 */
import type { BaseCalculo, StatusComissao } from '@/integrations/supabase/admin-types';

export interface RegraComissao {
  percentual: number;
  base_calculo: BaseCalculo;
  valor_fixo?: number | null;
  vigencia_inicio: string;
  vigencia_fim?: string | null;
}

export interface EntradaCalculo {
  valorBruto: number;
  valorLiquido?: number | null;
  /** Já houve receita confirmada anterior deste cliente? Decide primeiro_pagamento. */
  jaHouveReceitaAnterior?: boolean;
}

export interface ResultadoComissao {
  valorBase: number;
  valorComissao: number;
  percentualAplicado: number;
  baseCalculo: BaseCalculo;
  /** Nulo quando a regra não remunera este evento. */
  motivoSemComissao: string | null;
}

/** Arredonda a 2 casas como o `round(x, 2)` do Postgres, evitando 0.1+0.2. */
function centavos(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula a comissão de um evento de receita segundo a regra vigente.
 *
 * O valor devolvido é congelado na linha da comissão. Nunca se recalcula depois:
 * a regra que importa é a que valia quando o dinheiro entrou.
 */
export function calcularComissao(
  entrada: EntradaCalculo,
  regra: RegraComissao,
): ResultadoComissao {
  const vazio = (motivo: string): ResultadoComissao => ({
    valorBase: 0,
    valorComissao: 0,
    percentualAplicado: regra.percentual,
    baseCalculo: regra.base_calculo,
    motivoSemComissao: motivo,
  });

  if (regra.base_calculo === 'primeiro_pagamento' && entrada.jaHouveReceitaAnterior) {
    return vazio('A regra remunera apenas o primeiro pagamento deste cliente.');
  }

  if (regra.base_calculo === 'valor_fixo') {
    if (regra.valor_fixo === null || regra.valor_fixo === undefined) {
      return vazio('Regra de valor fixo sem valor definido.');
    }
    return {
      valorBase: entrada.valorBruto,
      valorComissao: centavos(regra.valor_fixo),
      percentualAplicado: regra.percentual,
      baseCalculo: regra.base_calculo,
      motivoSemComissao: null,
    };
  }

  // receita_liquida cai para o bruto quando o líquido não foi informado. É o
  // mesmo COALESCE do SQL: sem isso, uma receita sem líquido geraria comissão
  // zero silenciosamente, e o parceiro só descobriria no extrato.
  const valorBase =
    regra.base_calculo === 'receita_liquida'
      ? (entrada.valorLiquido ?? entrada.valorBruto)
      : entrada.valorBruto;

  return {
    valorBase: centavos(valorBase),
    valorComissao: centavos((valorBase * regra.percentual) / 100),
    percentualAplicado: regra.percentual,
    baseCalculo: regra.base_calculo,
    motivoSemComissao: null,
  };
}

/**
 * Qual regra valia numa data.
 *
 * Recebe a data em vez de usar `new Date()`: a comissão precisa do percentual
 * vigente quando o pagamento foi confirmado, não do de hoje. É isto que impede
 * que mudar o percentual reescreva o passado.
 */
export function percentualVigenteEm<T extends RegraComissao>(
  historico: readonly T[],
  data: string,
): T | null {
  const candidatas = historico.filter(
    (r) =>
      r.vigencia_inicio <= data &&
      (r.vigencia_fim === null || r.vigencia_fim === undefined || r.vigencia_fim >= data),
  );

  if (candidatas.length === 0) return null;

  // Vigências não se sobrepõem (índice único parcial no banco garante uma só
  // aberta), mas ordenar torna a função correta mesmo com dado histórico sujo.
  return candidatas.reduce((maisRecente, atual) =>
    atual.vigencia_inicio > maisRecente.vigencia_inicio ? atual : maisRecente,
  );
}

/**
 * Máquina de estados. Espelha o CASE de `admin_transicionar_comissao()`.
 *
 * Note o que NÃO existe: nada sai de 'cancelada' ou 'estornada'. Um valor
 * desfeito não volta à vida — se o caso mudar, registra-se um evento novo, e o
 * histórico do parceiro continua legível.
 */
const TRANSICOES: Record<StatusComissao, readonly StatusComissao[]> = {
  pendente: ['em_validacao', 'aprovada', 'cancelada'],
  em_validacao: ['aprovada', 'cancelada'],
  aprovada: ['paga', 'cancelada'],
  paga: ['estornada'],
  cancelada: [],
  estornada: [],
};

export function transicaoValida(de: StatusComissao, para: StatusComissao): boolean {
  return TRANSICOES[de]?.includes(para) ?? false;
}

export function proximosStatus(de: StatusComissao): StatusComissao[] {
  return [...(TRANSICOES[de] ?? [])];
}

/** Transições que exigem justificativa — as que retiram valor do parceiro. */
export function exigeJustificativa(para: StatusComissao): boolean {
  return para === 'cancelada' || para === 'estornada';
}

/** Comissão paga já saiu do caixa: reverter é decisão humana, não automática. */
export function estornoAutomaticoPermitido(status: StatusComissao): boolean {
  return status !== 'paga' && status !== 'cancelada' && status !== 'estornada';
}

export const ROTULO_STATUS: Record<StatusComissao, string> = {
  pendente: 'Pendente',
  em_validacao: 'Em validação',
  aprovada: 'Aprovada',
  paga: 'Paga',
  cancelada: 'Cancelada',
  estornada: 'Estornada',
};

/** Classes de badge, no mesmo estilo do statusColors de Clientes.tsx. */
export const COR_STATUS: Record<StatusComissao, string> = {
  pendente: 'bg-muted text-muted-foreground border-border',
  em_validacao: 'bg-warning/10 text-warning border-warning/20',
  aprovada: 'bg-primary/10 text-primary border-primary/20',
  paga: 'bg-success/10 text-success border-success/20',
  cancelada: 'bg-destructive/10 text-destructive border-destructive/20',
  estornada: 'bg-destructive/10 text-destructive border-destructive/20',
};

export const ROTULO_BASE: Record<BaseCalculo, string> = {
  receita_bruta: 'Receita bruta',
  receita_liquida: 'Receita líquida',
  primeiro_pagamento: 'Apenas o primeiro pagamento',
  valor_fixo: 'Valor fixo por cliente',
};
