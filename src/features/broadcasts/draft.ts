import type { CampaignDraft } from './api';

export const MAX_BODY = 1000;

/** Problemas que impedem salvar ou ativar, já no navegador (o banco valida de novo). */
export function draftIssues(draft: CampaignDraft, now = new Date()): string[] {
  const issues: string[] = [];
  if (!draft.name.trim()) issues.push('Dê um nome para o disparo.');
  if (!draft.body.trim()) issues.push('Escreva a mensagem.');
  if (draft.body.length > MAX_BODY) issues.push(`A mensagem passou de ${MAX_BODY} caracteres.`);
  const unknown = [...draft.body.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((match) => match[1]).filter((name) => name !== 'nome' && name !== 'corretor');
  if (unknown.length) issues.push(`Variável que não existe: {{${unknown[0]}}}. Use {{nome}} ou {{corretor}}.`);
  if (!Number.isInteger(draft.maxRecipients) || draft.maxRecipients < 1 || draft.maxRecipients > 300) issues.push('O máximo de contatos vai de 1 a 300.');
  if (draft.startsAt !== null && !(Date.parse(draft.startsAt) > now.getTime())) issues.push('Escolha uma data e hora no futuro para o agendamento.');
  return issues;
}

