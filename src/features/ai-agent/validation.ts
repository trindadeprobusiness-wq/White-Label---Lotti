import {
  FOLLOW_UP_WINDOW_HOURS,
  INTRO_LIMIT,
  NAME_LIMIT,
  PROMPT_LIMIT,
  WEEKDAYS,
  type AgentSettings,
  type AgentTab,
} from './settings';

export type AgentIssue = { tab: AgentTab; field: string; severity: 'error' | 'warning'; message: string };

const blank = (value: string) => !value.trim();
const between = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;

export function validateAgentSettings(settings: AgentSettings): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const error = (tab: AgentTab, field: string, message: string) => issues.push({ tab, field, severity: 'error', message });
  const warning = (tab: AgentTab, field: string, message: string) => issues.push({ tab, field, severity: 'warning', message });
  const { identity, behavior, followUp, schedule } = settings;

  if (blank(identity.name)) error('identity', 'identity.name', 'Dê um nome ao agente.');
  else if (identity.name.trim().length > NAME_LIMIT) error('identity', 'identity.name', `O nome do agente pode ter até ${NAME_LIMIT} caracteres.`);
  if (blank(identity.company)) warning('identity', 'identity.company', 'Informe o nome da imobiliária para o agente se apresentar corretamente.');
  if (blank(identity.intro)) error('identity', 'identity.intro', 'Escreva a mensagem de apresentação.');
  else if (identity.intro.length > INTRO_LIMIT) error('identity', 'identity.intro', `A apresentação pode ter até ${INTRO_LIMIT} caracteres.`);
  if (!identity.businessTypes.venda && !identity.businessTypes.locacao) error('identity', 'identity.businessTypes', 'Escolha ao menos venda ou locação.');

  if (behavior.attend.afterDelay && !between(behavior.attendDelayMinutes, 1, 240)) {
    error('behavior', 'behavior.attendDelayMinutes', 'O tempo de espera pela equipe deve ficar entre 1 e 240 minutos.');
  }
  if (behavior.handoff.mode === 'message') {
    if (blank(behavior.handoff.messageInHours)) error('behavior', 'behavior.handoff.messageInHours', 'Escreva a mensagem de transferência dentro do horário.');
    if (blank(behavior.handoff.messageOutOfHours)) error('behavior', 'behavior.handoff.messageOutOfHours', 'Escreva a mensagem de transferência fora do horário.');
  }
  if (!between(behavior.guards.aggregationSeconds, 0, 60)) error('behavior', 'behavior.guards.aggregationSeconds', 'A espera para juntar mensagens deve ficar entre 0 e 60 segundos.');

  if (followUp.enabled) {
    followUp.delaysHours.forEach((delay, index) => {
      if (!between(delay, 1, FOLLOW_UP_WINDOW_HOURS)) error('cycle', `followUp.delaysHours.${index}`, `O ${index + 1}º toque deve ficar entre 1 e ${FOLLOW_UP_WINDOW_HOURS} horas.`);
    });
    if (followUp.delaysHours.reduce((total, delay) => total + delay, 0) > FOLLOW_UP_WINDOW_HOURS) {
      warning('cycle', 'followUp.delaysHours', 'Os toques somam mais de 23 horas. O que cair fora da janela de 24 horas do WhatsApp não será enviado.');
    }
    if (blank(followUp.objective)) error('cycle', 'followUp.objective', 'Descreva o objetivo dos toques de follow-up.');
    if (followUp.closeConversation && !between(followUp.closeAfterHours, 1, 72)) error('cycle', 'followUp.closeAfterHours', 'O fechamento deve acontecer entre 1 e 72 horas após o último toque.');
    if (followUp.closeConversation && followUp.farewell && blank(followUp.farewellObjective)) error('cycle', 'followUp.farewellObjective', 'Descreva o objetivo da despedida.');
  }

  const openDays = WEEKDAYS.filter(({ id }) => schedule.week[id].enabled);
  if (openDays.length === 0) error('schedule', 'schedule.week', 'Ative ao menos um dia de atendimento.');
  for (const day of openDays) {
    const hours = schedule.week[day.id];
    if (hours.end <= hours.start) error('schedule', `schedule.week.${day.id}`, `${day.label}: o horário final precisa ser depois do inicial.`);
  }
  if (schedule.visits.enabled) {
    if (!between(schedule.visits.durationMinutes, 15, 240)) error('schedule', 'schedule.visits.durationMinutes', 'A duração da visita deve ficar entre 15 e 240 minutos.');
    if (!between(schedule.visits.minNoticeHours, 0, 168)) error('schedule', 'schedule.visits.minNoticeHours', 'A antecedência mínima deve ficar entre 0 e 168 horas.');
  }

  if (settings.prompt.length > PROMPT_LIMIT) error('prompt', 'prompt', `As instruções adicionais podem ter até ${PROMPT_LIMIT} caracteres.`);

  return issues;
}

export const hasBlockingIssues = (issues: AgentIssue[]) => issues.some((issue) => issue.severity === 'error');

export function issuesByTab(issues: AgentIssue[]): Partial<Record<AgentTab, number>> {
  const counts: Partial<Record<AgentTab, number>> = {};
  for (const issue of issues) {
    if (issue.severity === 'error') counts[issue.tab] = (counts[issue.tab] ?? 0) + 1;
  }
  return counts;
}
