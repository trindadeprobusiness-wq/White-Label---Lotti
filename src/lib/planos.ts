/**
 * Regras de cota de plano.
 *
 * Lógica pura, separada de componente e de banco, porque o vitest deste projeto
 * roda em node sem jsdom — e regra de cobrança é exatamente o tipo de regra que
 * não pode depender de alguém lembrar dela na hora de renderizar.
 *
 * O que governa este arquivo: **o custo da Lotti é dirigido por conversa de
 * qualificação de lead** (R$ 0,396 entre IA e template de WhatsApp). Imóvel,
 * fachada e cliente custam centavos de banco. Por isso a cota que importa é a
 * de leads, e é a única com preço de excedente.
 */

/** Ponto em que o corretor precisa ser avisado, antes de a cota acabar. */
export const LIMIAR_ATENCAO = 0.8;

/**
 * Preço do lead além da cota.
 *
 * Custa R$ 0,396, então R$ 1,50 dá 74% de margem — praticamente a mesma do
 * plano. Cobrar menos faria o cliente que cresce diluir a margem justamente
 * quando ele passa a dar mais trabalho.
 */
export const PRECO_LEAD_EXCEDENTE = 1.5;

export type StatusCota = 'ok' | 'atencao' | 'estourada';

export interface Cota {
  usado: number;
  /** `null` = ilimitado. */
  limite: number | null;
}

/**
 * Situação da cota.
 *
 * "atencao" existe para o aviso chegar antes do problema: descobrir que a cota
 * acabou quando o lead deixa de ser atendido é tarde para todo mundo.
 */
export function statusCota({ usado, limite }: Cota): StatusCota {
  if (limite === null) return 'ok';
  if (limite <= 0) return 'estourada';
  const razao = usado / limite;
  if (razao >= 1) return 'estourada';
  if (razao >= LIMIAR_ATENCAO) return 'atencao';
  return 'ok';
}

/** Fração consumida, de 0 a 1. Ilimitado devolve `null` — não há barra a encher. */
export function proporcaoCota({ usado, limite }: Cota): number | null {
  if (limite === null) return null;
  if (limite <= 0) return 1;
  return Math.min(usado / limite, 1);
}

/** Quantos passaram do teto. Nunca negativo. */
export function excedente({ usado, limite }: Cota): number {
  if (limite === null) return 0;
  return Math.max(0, usado - limite);
}

/** Valor a cobrar pelo que passou da cota. */
export function valorExcedente(cota: Cota, precoUnitario = PRECO_LEAD_EXCEDENTE): number {
  return excedente(cota) * precoUnitario;
}

/**
 * A captura do lead NUNCA é bloqueada por cota.
 *
 * O contato é do corretor, não nosso. Barrar a gravação para forçar um upgrade
 * destrói o ativo dele para proteger centavos nossos — e ele nem fica sabendo
 * que perdeu, porque o lead simplesmente some.
 *
 * O que a cota controla é se a IA vai conversar com esse lead. Estourou: o
 * contato entra, o corretor é avisado, e ele atende à mão ou libera excedente.
 */
export function podeCapturarLead(): true {
  return true;
}

/** A IA só conversa com o lead se houver cota — este é o gasto de verdade. */
export function podeQualificarComIA(cota: Cota): boolean {
  return statusCota(cota) !== 'estourada';
}

/** Texto curto para barra de uso. Ilimitado não mostra fração. */
export function rotuloCota({ usado, limite }: Cota): string {
  if (limite === null) return `${usado} usados`;
  return `${usado} de ${limite}`;
}
