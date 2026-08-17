/**
 * Períodos e comparação com o período anterior.
 *
 * Tudo trafega como 'YYYY-MM-DD' e é construído com componentes de data LOCAIS.
 * Usar `toISOString()` aqui seria o bug clássico: no Brasil ele devolve o dia
 * anterior para qualquer hora antes das 21h, e um filtro "hoje" deixaria de
 * incluir hoje.
 */

export type AtalhoPeriodo = '7d' | '30d' | '90d' | 'mes_atual' | 'mes_anterior' | '12m';

export interface Periodo {
  inicio: string;
  fim: string;
}

export const ATALHOS: { valor: AtalhoPeriodo; label: string }[] = [
  { valor: '7d', label: 'Últimos 7 dias' },
  { valor: '30d', label: 'Últimos 30 dias' },
  { valor: '90d', label: 'Últimos 90 dias' },
  { valor: 'mes_atual', label: 'Mês atual' },
  { valor: 'mes_anterior', label: 'Mês anterior' },
  { valor: '12m', label: 'Últimos 12 meses' },
];

/** Data → 'YYYY-MM-DD' usando o calendário local, nunca UTC. */
export function paraISO(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** 'YYYY-MM-DD' → Date à meia-noite local. */
export function deISO(s: string): Date {
  const [ano, mes, dia] = s.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

export function somarDias(s: string, dias: number): string {
  const d = deISO(s);
  d.setDate(d.getDate() + dias);
  return paraISO(d);
}

/** Dias no intervalo, inclusivo nas duas pontas: 01→01 é 1 dia, não 0. */
export function diasNoPeriodo(p: Periodo): number {
  const ms = deISO(p.fim).getTime() - deISO(p.inicio).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function periodoDeAtalho(atalho: AtalhoPeriodo, hoje = new Date()): Periodo {
  const fimHoje = paraISO(hoje);

  switch (atalho) {
    case '7d':
      return { inicio: somarDias(fimHoje, -6), fim: fimHoje };
    case '30d':
      return { inicio: somarDias(fimHoje, -29), fim: fimHoje };
    case '90d':
      return { inicio: somarDias(fimHoje, -89), fim: fimHoje };
    case 'mes_atual':
      return {
        inicio: paraISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
        fim: fimHoje,
      };
    case 'mes_anterior': {
      const primeiroDoAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      // Dia 0 do mês seguinte é o último dia do mês anterior — evita a tabela de
      // 28/29/30/31 e acerta fevereiro bissexto de graça.
      const ultimoDoAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      return { inicio: paraISO(primeiroDoAnterior), fim: paraISO(ultimoDoAnterior) };
    }
    case '12m': {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
      return { inicio: paraISO(inicio), fim: fimHoje };
    }
  }
}

/**
 * Janela de mesma duração imediatamente antes. Agosto (31 dias) compara com os
 * 31 dias anteriores, não com julho por nome — é o que mantém a comparação
 * honesta quando o usuário escolhe um intervalo qualquer.
 */
export function periodoAnterior(p: Periodo): Periodo {
  const dias = diasNoPeriodo(p);
  const fim = somarDias(p.inicio, -1);
  return { inicio: somarDias(fim, -(dias - 1)), fim };
}

/**
 * Variação percentual. Devolve null quando não há base de comparação — sair de
 * 0 para 5 não é "+500%", é "não havia nada antes", e a tela precisa distinguir
 * os dois casos em vez de exibir um número inventado.
 */
export function variacao(atual: number, anterior: number): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return null;
  if (anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

/** Um período é válido se as duas pontas existem e o início não passa do fim. */
export function periodoValido(p: Periodo): boolean {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(p.inicio) || !re.test(p.fim)) return false;
  const i = deISO(p.inicio);
  const f = deISO(p.fim);
  if (Number.isNaN(i.getTime()) || Number.isNaN(f.getTime())) return false;
  return i.getTime() <= f.getTime();
}
