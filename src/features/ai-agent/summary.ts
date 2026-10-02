import { WEEKDAYS, type AgentSettings, type DayHours, type Weekday } from './settings';

/** "Seg a Sex, 08:00–18:00 · Sáb, 09:00–13:00", agrupando dias seguidos com o mesmo horário. */
export function describeBusinessHours(week: Record<Weekday, DayHours>): string {
  const groups: Array<{ days: string[]; range: string }> = [];
  let previousOpen = false;

  for (const day of WEEKDAYS) {
    const hoursOfDay = week[day.id];
    if (!hoursOfDay.enabled) { previousOpen = false; continue; }
    const range = `${hoursOfDay.start}–${hoursOfDay.end}`;
    const last = groups[groups.length - 1];
    if (previousOpen && last?.range === range) last.days.push(day.short);
    else groups.push({ days: [day.short], range });
    previousOpen = true;
  }

  if (groups.length === 0) return 'Nenhum dia de atendimento';
  return groups.map(({ days, range }) => {
    const label = days.length > 2 ? `${days[0]} a ${days[days.length - 1]}` : days.join(' e ');
    return `${label}, ${range}`;
  }).join(' · ');
}

export function describeAttendMode(behavior: AgentSettings['behavior']): string {
  const motivos: string[] = [];
  if (behavior.attend.outsideHours) motivos.push('fora do horário de atendimento');
  if (behavior.attend.afterDelay) motivos.push(`se a equipe não responder em ${behavior.attendDelayMinutes} min`);
  // Sem restrição marcada, ela atende tudo — é o começo de toda conta.
  if (motivos.length === 0) return 'Responde toda mensagem recebida';
  return `Responde ${motivos.join(' e ')}`;
}

export function describeHandoff(behavior: AgentSettings['behavior'], stageName?: string): string {
  const mode = behavior.handoff.mode === 'silent' ? 'Silencioso' : 'Com mensagem';
  return stageName ? `${mode}, vai para ${stageName}` : mode;
}
