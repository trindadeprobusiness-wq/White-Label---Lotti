/**
 * Formatação pt-BR de moeda, data, percentual e número.
 *
 * Não existia módulo central: `toLocaleString('pt-BR')` aparece inline em ~30
 * arquivos, com variações silenciosas (uns com centavos, outros sem). As telas
 * do back office usam daqui; as telas antigas seguem como estão — refatorá-las
 * é trabalho separado e sem relação com esta entrega.
 */

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const MOEDA_COMPACTA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const NUMERO = new Intl.NumberFormat('pt-BR');

/** Aceita null/undefined porque quase todo valor vem do banco podendo ser nulo. */
function vazio(valor: number | null | undefined): valor is null | undefined {
  return valor === null || valor === undefined || Number.isNaN(valor);
}

/**
 * `moeda(1234.5)` → "R$ 1.234,50".
 * Use `compacta` em cards de métrica, onde o centavo só polui.
 */
export function moeda(valor: number | null | undefined, compacta = false): string {
  if (vazio(valor)) return '—';
  return (compacta ? MOEDA_COMPACTA : MOEDA).format(valor);
}

/** `percentual(12.5)` → "12,5%". O valor entra como 12.5, não 0.125. */
export function percentual(valor: number | null | undefined, casas = 1): string {
  if (vazio(valor)) return '—';
  return `${valor.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas,
  })}%`;
}

export function numero(valor: number | null | undefined): string {
  if (vazio(valor)) return '—';
  return NUMERO.format(valor);
}

function paraData(valor: string | Date | null | undefined): Date | null {
  if (valor === null || valor === undefined || valor === '') return null;
  // Data pura do Postgres ('2026-08-14') seria lida como UTC e voltaria um dia
  // atrás em qualquer fuso negativo — o Brasil inteiro. Fixar ao meio-dia local
  // mantém o dia correto sem depender do fuso de quem abre a tela.
  const d =
    typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)
      ? new Date(`${valor}T12:00:00`)
      : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Dia de um lançamento financeiro. O banco guarda só a data (00:00 UTC) e a API devolve
 * '2026-10-01T00:00:00+00:00': lido no fuso local, virava 30/09 às 21h — o cartão mostrava o dia anterior e
 * editar sem mexer na data gravava o dia anterior. Vale o dia escrito, ao meio-dia local.
 */
export function diaDoLancamento(valor: string | null | undefined): Date | null {
  const dia = typeof valor === 'string' ? valor.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const d = new Date(`${dia}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `dataBR('2026-08-14')` → "14/08/2026". */
export function dataBR(valor: string | Date | null | undefined): string {
  const d = paraData(valor);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR');
}

/** `dataHoraBR(...)` → "14/08/2026 13:45". */
export function dataHoraBR(valor: string | Date | null | undefined): string {
  const d = paraData(valor);
  if (!d) return '—';
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** Competência do ledger: `competenciaBR('2026-08-01')` → "08/2026". */
export function competenciaBR(valor: string | Date | null | undefined): string {
  const d = paraData(valor);
  if (!d) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Documento mascarado para listagem administrativa: "123.***.***-01".
 * O admin precisa reconhecer o parceiro, não ler o CPF inteiro — menor
 * privilégio também vale para o que aparece na tela (LGPD).
 */
export function documentoMascarado(valor: string | null | undefined): string {
  if (!valor) return '—';
  const d = valor.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}`;
  return valor;
}
