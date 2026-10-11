/**
 * Horários livres para visita, como o `consultar_horarios` do Clix: a IA só oferece o que sai daqui, e
 * marcar confere de novo pela mesma regra ("ofertado == permitido"). Tudo em Brasília (-03:00, sem
 * horário de verão desde 2019).
 */
export type DiaDaSemana = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type Expediente = Partial<Record<DiaDaSemana, { enabled?: boolean; start?: string; end?: string }>>;

export interface RegraDeAgenda {
  semana: Expediente;
  duracaoMin: number;
  antecedenciaHoras: number;
  /** Até quantos dias à frente a IA oferece. */
  dias: number;
  /** De quanto em quanto tempo começa um horário (grade). */
  gradeMin: number;
}

export interface Intervalo { inicio: Date; fim: Date }
export interface Horario { id: string; rotulo: string; inicio: Date; fim: Date }

const DIAS: DiaDaSemana[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NOMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const FUSO_MS = 3 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const hhmm = (v?: string) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null);
const dois = (n: number) => String(n).padStart(2, '0');

export const REGRA_PADRAO: RegraDeAgenda = {
  semana: {
    mon: { enabled: true, start: '08:00', end: '18:00' }, tue: { enabled: true, start: '08:00', end: '18:00' },
    wed: { enabled: true, start: '08:00', end: '18:00' }, thu: { enabled: true, start: '08:00', end: '18:00' },
    fri: { enabled: true, start: '08:00', end: '18:00' }, sat: { enabled: true, start: '09:00', end: '13:00' },
  },
  duracaoMin: 60, antecedenciaHoras: 2, dias: 14, gradeMin: 30,
};

/** Lê a configuração salva na tela do agente (schedule.week e schedule.visits). */
export function regraDasConfiguracoes(settings: unknown): RegraDeAgenda {
  const s = (settings && typeof settings === 'object' ? settings : {}) as { schedule?: { week?: Expediente; visits?: { durationMinutes?: unknown; minNoticeHours?: unknown } } };
  const visits = s.schedule?.visits ?? {};
  const duracao = Number(visits.durationMinutes);
  const antecedencia = Number(visits.minNoticeHours);
  return {
    ...REGRA_PADRAO,
    semana: s.schedule?.week && typeof s.schedule.week === 'object' ? s.schedule.week : REGRA_PADRAO.semana,
    duracaoMin: Number.isFinite(duracao) && duracao >= 15 && duracao <= 240 ? Math.round(duracao) : REGRA_PADRAO.duracaoMin,
    antecedenciaHoras: Number.isFinite(antecedencia) && antecedencia >= 0 && antecedencia <= 168 ? antecedencia : REGRA_PADRAO.antecedenciaHoras,
  };
}

/** "seg 12/10 10:00" e o id "2026-10-12T10:00" (hora de Brasília), que a IA devolve para marcar. */
function horario(inicioMs: number, duracaoMin: number): Horario {
  const local = new Date(inicioMs - FUSO_MS);
  const d = local.getUTCDate(), m = local.getUTCMonth() + 1, h = local.getUTCHours(), mi = local.getUTCMinutes();
  return {
    id: `${local.getUTCFullYear()}-${dois(m)}-${dois(d)}T${dois(h)}:${dois(mi)}`,
    rotulo: `${NOMES[local.getUTCDay()]} ${dois(d)}/${dois(m)} ${dois(h)}:${dois(mi)}`,
    inicio: new Date(inicioMs), fim: new Date(inicioMs + duracaoMin * MIN),
  };
}

const sobrepoe = (a: Intervalo, inicio: number, fim: number) => a.inicio.getTime() < fim && a.fim.getTime() > inicio;

/**
 * Todos os horários livres dentro do expediente, da antecedência mínima e da janela de dias, sem
 * encostar em compromisso da agenda. `porDia`/`limite` só servem para a lista que vai à IA.
 */
export function horariosLivres(regra: RegraDeAgenda, ocupados: Intervalo[], agora: Date, { porDia = Infinity, limite = Infinity } = {}): Horario[] {
  const saida: Horario[] = [];
  const minimo = agora.getTime() + regra.antecedenciaHoras * 60 * MIN;
  const hojeLocal = new Date(agora.getTime() - FUSO_MS);
  const base = Date.UTC(hojeLocal.getUTCFullYear(), hojeLocal.getUTCMonth(), hojeLocal.getUTCDate());
  for (let dia = 0; dia <= regra.dias && saida.length < limite; dia += 1) {
    const meiaNoiteLocal = base + dia * 24 * 60 * MIN;
    const exp = regra.semana[DIAS[new Date(meiaNoiteLocal).getUTCDay()]];
    const ini = hhmm(exp?.start), fim = hhmm(exp?.end);
    if (!exp?.enabled || ini === null || fim === null) continue;
    let doDia = 0;
    for (let t = ini; t + regra.duracaoMin <= fim && doDia < porDia && saida.length < limite; t += regra.gradeMin) {
      const inicio = meiaNoiteLocal + t * MIN + FUSO_MS;
      const termino = inicio + regra.duracaoMin * MIN;
      if (inicio < minimo || ocupados.some((o) => sobrepoe(o, inicio, termino))) continue;
      saida.push(horario(inicio, regra.duracaoMin));
      doDia += 1;
    }
  }
  return saida;
}

/** O horário pedido é um dos que a IA poderia ter oferecido agora? */
export function horarioPermitido(regra: RegraDeAgenda, ocupados: Intervalo[], agora: Date, inicio: Date): boolean {
  return horariosLivres(regra, ocupados, agora).some((h) => h.inicio.getTime() === inicio.getTime());
}
