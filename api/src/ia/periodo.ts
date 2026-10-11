/**
 * Datas do Assistente no fuso de quem conversa (o navegador manda; o padrão é São Paulo). As telas do app
 * contam por dia do calendário local, e os lançamentos financeiros guardam só a data (00:00 UTC). Por isso o
 * Assistente trabalha com dias 'AAAA-MM-DD': o "hoje" sai do fuso, e o filtro no banco é por dia.
 */
export const FUSO_PADRAO = 'America/Sao_Paulo';

/** Fuso aceito pelo Intl; qualquer outro (a validação do pedido é só por formato) cai em São Paulo. */
export function fusoValido(fuso?: string | null): string {
  if (!fuso) return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'AAAA-MM-DD' de `agora` no fuso. */
export function diaNoFuso(agora: Date, fuso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const partes = (dia: string) => dia.split('-').map(Number) as [number, number, number];

/** Dia válido do calendário ('2026-02-30' não é). */
export function diaValido(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const m = DIA.exec(valor.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return iso(d) === valor.trim() ? valor.trim() : null;
}

export function inicioDoMes(dia: string): string {
  return `${dia.slice(0, 8)}01`;
}

export function fimDoMes(dia: string): string {
  const [a, m] = partes(dia);
  return iso(new Date(Date.UTC(a, m, 0)));
}

/** Primeiro dia do mês `n` meses depois (ou antes, com n negativo) do mês de `dia`. */
export function mesDeslocado(dia: string, n: number): string {
  const [a, m] = partes(dia);
  return iso(new Date(Date.UTC(a, m - 1 + n, 1)));
}

/** '2026-10-01' → '01/10/2026'. */
export function diaBr(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

export interface Intervalo {
  de: string;
  ate: string;
}

/**
 * Período da tela Financeiro (src/pages/Financeiro.tsx): mês atual inteiro, "trimestre" = os últimos três
 * meses do calendário (o atual e os dois anteriores, inteiros) e ano inteiro.
 */
export function periodoDaTela(periodo: unknown, hoje: string): Intervalo {
  if (periodo === 'year') return { de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31` };
  if (periodo === 'quarter') return { de: mesDeslocado(hoje, -2), ate: fimDoMes(hoje) };
  return { de: inicioDoMes(hoje), ate: fimDoMes(hoje) };
}

export function somarDias(dia: string, n: number): string {
  const [a, m, d] = partes(dia);
  return iso(new Date(Date.UTC(a, m - 1, d + n)));
}

/** Segunda-feira da semana de `dia` (a semana do app começa na segunda). */
export function inicioDaSemana(dia: string): string {
  const [a, m, d] = partes(dia);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return somarDias(dia, -((dow + 6) % 7));
}

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * Bloco de data e hora que vai no prompt. O modelo roda sem raciocínio e erra conta de calendário (dia da
 * semana, último dia do mês): as datas vão prontas, e ele só escolhe qual usar.
 */
export function agoraNoPrompt(agora: Date, fuso: string): string {
  const quando = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(agora);
  const hoje = diaNoFuso(agora, fuso);
  const semana = inicioDaSemana(hoje);
  const passado = mesDeslocado(hoje, -1);
  const ano = hoje.slice(0, 4);
  const fusoTexto = fuso === FUSO_PADRAO ? 'horário de Brasília' : fuso;
  // "Na terça", "sexta que vem": a data da proposta sai desta lista, sem conta de calendário.
  const proximos = Array.from({ length: 14 }, (_, i) => {
    const dia = somarDias(hoje, i + 1);
    return `${DIAS_DA_SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${diaBr(dia)}`;
  });
  return [
    `Agora: ${quando} (${fusoTexto}).`,
    `Hoje: ${diaBr(hoje)}. Ontem: ${diaBr(somarDias(hoje, -1))}. Amanhã: ${diaBr(somarDias(hoje, 1))}.`,
    `Esta semana (segunda a domingo): ${diaBr(semana)} a ${diaBr(somarDias(semana, 6))}. Semana passada: ${diaBr(somarDias(semana, -7))} a ${diaBr(somarDias(semana, -1))}. Próxima semana: ${diaBr(somarDias(semana, 7))} a ${diaBr(somarDias(semana, 13))}.`,
    `Próximos 14 dias: ${proximos.join(', ')}.`,
    `Este mês: ${diaBr(inicioDoMes(hoje))} a ${diaBr(fimDoMes(hoje))}. Mês passado: ${diaBr(passado)} a ${diaBr(fimDoMes(passado))}. Este ano: 01/01/${ano} a 31/12/${ano}.`,
    'Use estas datas prontas; não calcule dia da semana. As datas que as consultas devolvem já estão no fuso da conta: não converta fuso.',
  ].join('\n');
}
