import { addDays, addHours, addMinutes, set } from 'date-fns';
import { getRoutineCategory, ROUTINE_CATEGORIES } from './categories';
import type { RoutineCommandProposal } from '@/types/routine';

const ACTIVITY_ALIASES: Array<[RegExp, string, 'event' | 'task']> = [
  [/\b(visita|visitar)\b/i, 'visita_imovel', 'event'],
  [/\b(ligar|liga[cç][aã]o|telefonar)\b/i, 'ligacao', 'task'],
  [/\b(follow[ -]?up|retorno|retornar)\b/i, 'follow_up', 'task'],
  [/\b(reuni[aã]o|reunir)\b/i, 'reuniao', 'event'],
  [/\b(proposta)\b/i, 'envio_proposta', 'task'],
  [/\b(contrato|assinatura)\b/i, 'assinatura_contrato', 'event'],
  [/\b(vistoria)\b/i, 'vistoria', 'event'],
  [/\b(cobran[cç]a|cobrar)\b/i, 'cobranca', 'task'],
  [/\b(tarefa|lembrar|lembre)\b/i, 'tarefa_administrativa', 'task'],
];

function relativeDate(text: string, now: Date): Date | null {
  if (/depois de amanh[aã]/i.test(text)) return addDays(now, 2);
  if (/amanh[aã]/i.test(text)) return addDays(now, 1);
  if (/\bhoje\b/i.test(text)) return now;

  const numeric = text.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : now.getFullYear();
    const parsed = new Date(year, Number(numeric[2]) - 1, Number(numeric[1]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function timeOfDay(text: string): { hours: number; minutes: number } | null {
  const match = text.match(/(?:[aà]s?|pelas?)\s*(\d{1,2})(?::|h)?(\d{2})?\s*h?/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  return hours <= 23 && minutes <= 59 ? { hours, minutes } : null;
}

function reminderMinutes(text: string): number | null {
  const match = text.match(/(?:lembre|lembrar|avise).{0,35}?(\d+|uma|duas?)\s*(minutos?|horas?|dias?)\s+antes/i);
  if (!match) return null;
  const amount = match[1].toLowerCase() === 'uma' ? 1 : /^duas?$/.test(match[1].toLowerCase()) ? 2 : Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (/dia/i.test(match[2])) return amount * 1440;
  if (/hora/i.test(match[2])) return amount * 60;
  return amount;
}

function afterMarker(text: string, marker: RegExp): string | null {
  const match = text.match(marker);
  return match?.[1]?.trim().replace(/[,.].*$/, '') || null;
}

export function interpretRoutineCommandLocally(
  text: string,
  now = new Date(),
): RoutineCommandProposal {
  const normalized = text.trim();
  const alias = ACTIVITY_ALIASES.find(([pattern]) => pattern.test(normalized));
  const activityType = alias?.[1] ?? 'tarefa_administrativa';
  const kind = alias?.[2] ?? 'task';
  const category = getRoutineCategory(activityType);
  const day = relativeDate(normalized, now);
  const time = timeOfDay(normalized);
  const start = day && time
    ? set(day, { hours: time.hours, minutes: time.minutes, seconds: 0, milliseconds: 0 })
    : null;
  const end = start ? addMinutes(start, category.defaultMinutes) : null;
  const due = kind === 'task'
    ? start ?? (day ? set(day, { hours: 18, minutes: 0, seconds: 0, milliseconds: 0 }) : null)
    : null;
  const clientQuery = afterMarker(normalized, /\bcom\s+(?:o|a)?\s*([^\d]+?)(?=\s+(?:amanh[aã]|hoje|depois|no\s+im[oó]vel|às|as\s+\d)|$)/i);
  const propertyQuery = afterMarker(normalized, /(?:im[oó]vel(?:\s+d[oa])?|no)\s+([^,]+?)(?=\s+e\s+(?:me\s+)?(?:lembre|avise)|$)/i);
  const missing: string[] = [];
  if (!normalized) missing.push('comando');
  if (kind === 'event' && !day) missing.push('data');
  if (kind === 'event' && !time) missing.push('horário');

  const actionVerb = kind === 'event' ? 'Agendar' : 'Fazer';
  const subject = clientQuery ? ` com ${clientQuery}` : '';
  return {
    kind,
    title: `${actionVerb} ${category.label.toLowerCase()}${subject}`,
    activity_type: activityType,
    start_at: start?.toISOString() ?? null,
    end_at: end?.toISOString() ?? null,
    due_at: due?.toISOString() ?? null,
    client_query: clientQuery,
    client_id: null,
    property_query: propertyQuery,
    property_id: null,
    location: null,
    assigned_to: null,
    reminder_minutes: reminderMinutes(normalized),
    priority: category.defaultPriority,
    missing_fields: missing,
    requires_confirmation: true,
    conflicts: [],
    interpretation_source: 'local',
  };
}

export function isRoutineActivity(value: string): boolean {
  return ROUTINE_CATEGORIES.some((category) => category.id === value);
}
