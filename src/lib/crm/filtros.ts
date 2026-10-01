import type { CrmOportunidade } from './tipos';

/**
 * Filtros do quadro — o que o corretor liga para enxergar menos de uma vez.
 *
 * Tudo acontece em memória, sobre os negócios que a tela já tem: o quadro
 * inteiro cabe numa consulta e refazer a busca no servidor a cada clique só
 * acrescentaria espera.
 */

export type PeriodoFiltro = 'qualquer' | 'hoje' | '7d' | '30d' | 'parado';

export interface FiltrosFunil {
  /** Janela de `updated_at`. `parado` é o inverso: nada há mais de 30 dias. */
  periodo: PeriodoFiltro;
  /** Só os que passaram da data prevista de fechamento e seguem abertos. */
  atrasados: boolean;
  /** Só os que já têm valor estimado. */
  comValor: boolean;
  /** Só os que têm imóvel vinculado. */
  comImovel: boolean;
}

export const FILTROS_VAZIOS: FiltrosFunil = {
  periodo: 'qualquer',
  atrasados: false,
  comValor: false,
  comImovel: false,
};

export const PERIODO_LABEL: Record<PeriodoFiltro, string> = {
  qualquer: 'Qualquer data',
  hoje: 'Movimentado hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  parado: 'Parado há mais de 30 dias',
};

const DIAS: Partial<Record<PeriodoFiltro, number>> = { hoje: 1, '7d': 7, '30d': 30 };

/** Quantos filtros estão ligados — vira o número no botão. */
export function contarFiltros(filtros: FiltrosFunil): number {
  return (filtros.periodo !== 'qualquer' ? 1 : 0)
    + (filtros.atrasados ? 1 : 0)
    + (filtros.comValor ? 1 : 0)
    + (filtros.comImovel ? 1 : 0);
}

function dentroDoPeriodo(atualizadoEm: string | null | undefined, periodo: PeriodoFiltro, agora: Date): boolean {
  if (periodo === 'qualquer') return true;
  if (!atualizadoEm) return false;
  const quando = new Date(atualizadoEm);
  // Data inválida não some do quadro por engano: cair fora de todo período
  // esconderia o negócio sem o corretor entender por quê.
  if (Number.isNaN(quando.getTime())) return true;
  const dias = (agora.getTime() - quando.getTime()) / 86_400_000;
  if (periodo === 'parado') return dias > 30;
  return dias <= (DIAS[periodo] ?? Infinity);
}

export function aplicarFiltros<T extends CrmOportunidade & { imoveis?: unknown }>(
  oportunidades: T[],
  filtros: FiltrosFunil,
  agora: Date = new Date(),
): T[] {
  if (contarFiltros(filtros) === 0) return oportunidades;

  return oportunidades.filter((o) => {
    if (!dentroDoPeriodo(o.updated_at, filtros.periodo, agora)) return false;
    if (filtros.comValor && !(Number(o.valor_estimado) > 0)) return false;
    if (filtros.comImovel && !o.imovel_id) return false;
    if (filtros.atrasados) {
      if (o.fechada_em || !o.data_prevista_fechamento) return false;
      if (new Date(o.data_prevista_fechamento) >= agora) return false;
    }
    return true;
  });
}
