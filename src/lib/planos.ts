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

import type { FeatureKey, PlanWithEntitlements, UsageSummary } from '@/types/subscription';

/** Primeiro plano acima do atual que realmente aumenta a capacidade da feature. */
export function proximoPlanoParaCota(
  planos: PlanWithEntitlements[],
  planoAtualId: string,
  featureKey: FeatureKey,
): PlanWithEntitlements | null {
  const ordenados = [...planos].sort((a, b) => a.display_order - b.display_order);
  const indiceAtual = ordenados.findIndex((plano) => plano.id === planoAtualId);
  if (indiceAtual < 0) return null;

  const atual = ordenados[indiceAtual].entitlements.find((item) => item.feature_key === featureKey);
  const limiteAtual = atual?.unlimited ? Number.POSITIVE_INFINITY : (atual?.limit_value ?? 0);

  return ordenados.slice(indiceAtual + 1).find((plano) => {
    const entitlement = plano.entitlements.find((item) => item.feature_key === featureKey);
    if (!entitlement?.enabled) return false;
    return entitlement.unlimited || (entitlement.limit_value ?? 0) > limiteAtual;
  }) ?? null;
}

export type AcaoPlano = 'current' | 'upgrade' | 'downgrade';

export function acaoEntrePlanos(
  atual: PlanWithEntitlements,
  destino: PlanWithEntitlements,
): AcaoPlano {
  if (atual.id === destino.id || atual.display_order === destino.display_order) return 'current';
  return destino.display_order > atual.display_order ? 'upgrade' : 'downgrade';
}

export function cotasIncompativeis(
  destino: PlanWithEntitlements,
  uso: UsageSummary[],
): string[] {
  return uso.flatMap((item) => {
    const entitlement = destino.entitlements.find((ent) => ent.feature_key === item.feature_key);
    if (!entitlement?.enabled || entitlement.unlimited) return [];
    const limite = entitlement.limit_value ?? 0;
    return item.used > limite ? [item.feature_name] : [];
  });
}

/** Edição não consome uma nova vaga; criação exige consulta pronta e permissão. */
export function podeCriarRecurso(
  limite: Pick<import('@/types/subscription').LimitCheck, 'allowed' | 'ready'>,
  editando: boolean,
): boolean {
  return editando || (limite.ready && limite.allowed);
}
