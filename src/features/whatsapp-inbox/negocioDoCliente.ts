import type { CrmOportunidade } from '@/lib/crm/tipos';

/**
 * O negócio que o Inbox mostra: o aberto (fechada_em vazio) mais recente do cliente, pelo updated_at.
 * É a mesma regra de crm_oportunidade_aberta no banco — o negócio que o agente move na transferência.
 * `outros` conta os demais negócios abertos do mesmo cliente (o Funil mostra um cartão para cada).
 */
export function negocioDoCliente(oportunidades: CrmOportunidade[] | undefined, clienteId: string | null) {
  if (!clienteId || !oportunidades) return { negocio: undefined, outros: 0 };
  const abertos = oportunidades
    .filter(o => o.cliente_id === clienteId && !o.fechada_em)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return { negocio: abertos[0], outros: Math.max(0, abertos.length - 1) };
}
