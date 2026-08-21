import {
  addDays,
  addMinutes,
  addMonths,
  areIntervalsOverlapping,
  endOfDay,
  endOfMonth,
  endOfWeek,
  isAfter,
  isBefore,
  max,
  min,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { RoutineEvent, RoutineTask, RoutineView } from '@/types/routine';

export interface DateRange {
  start: Date;
  end: Date;
}

export function rangeForView(view: RoutineView, anchor: Date): DateRange {
  if (view === 'day') return { start: startOfDay(anchor), end: endOfDay(anchor) };
  if (view === 'month') {
    const monthStart = startOfMonth(anchor);
    const monthEnd = endOfMonth(anchor);
    return {
      start: startOfWeek(monthStart, { weekStartsOn: 0 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
    };
  }
  if (view === 'list') {
    return { start: startOfDay(anchor), end: endOfDay(addDays(anchor, 30)) };
  }
  return {
    start: startOfWeek(anchor, { weekStartsOn: 1 }),
    end: endOfWeek(anchor, { weekStartsOn: 1 }),
  };
}

export function daysForRange(range: DateRange): Date[] {
  const days: Date[] = [];
  for (let date = startOfDay(range.start); !isAfter(date, range.end); date = addDays(date, 1)) {
    days.push(date);
  }
  return days;
}

export function hasEventConflict(
  events: readonly RoutineEvent[],
  interval: { start: Date; end: Date; assignedTo: string; excludeId?: string },
): boolean {
  return events.some((event) => {
    if (event.id === interval.excludeId || event.assigned_to !== interval.assignedTo) return false;
    if (event.deleted_at || ['draft', 'cancelled'].includes(event.status)) return false;
    return areIntervalsOverlapping(
      { start: new Date(event.start_at), end: new Date(event.end_at) },
      { start: interval.start, end: interval.end },
      { inclusive: false },
    );
  });
}

export function moveEvent(event: RoutineEvent, newStart: Date): Pick<RoutineEvent, 'start_at' | 'end_at'> {
  const duration = Math.max(15 * 60_000, new Date(event.end_at).getTime() - new Date(event.start_at).getTime());
  return { start_at: newStart.toISOString(), end_at: new Date(newStart.getTime() + duration).toISOString() };
}

export function resizeEvent(event: RoutineEvent, newEnd: Date): Pick<RoutineEvent, 'end_at'> {
  const minimum = addMinutes(new Date(event.start_at), 15);
  return { end_at: max([minimum, newEnd]).toISOString() };
}

type ParsedRRule = {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  count: number | null;
  until: Date | null;
};

function parseRRule(value: string): ParsedRRule | null {
  const pairs = Object.fromEntries(
    value.replace(/^RRULE:/i, '').split(';').map((part) => part.split('=', 2).map((item) => item.trim().toUpperCase())),
  );
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(pairs.FREQ)) return null;
  const until = pairs.UNTIL
    ? new Date(pairs.UNTIL.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3T23:59:59Z'))
    : null;
  return {
    frequency: pairs.FREQ as ParsedRRule['frequency'],
    interval: Math.max(1, Number(pairs.INTERVAL) || 1),
    count: pairs.COUNT ? Math.max(1, Number(pairs.COUNT) || 1) : null,
    until: until && !Number.isNaN(until.getTime()) ? until : null,
  };
}

export function expandRecurringEvents(
  events: readonly RoutineEvent[],
  range: DateRange,
  maxOccurrences = 400,
): RoutineEvent[] {
  const expanded: RoutineEvent[] = [];
  for (const event of events) {
    const rule = event.recurrence_rule ? parseRRule(event.recurrence_rule) : null;
    if (!rule) {
      const start = new Date(event.start_at);
      const end = new Date(event.end_at);
      if (!isAfter(start, range.end) && !isBefore(end, range.start)) expanded.push(event);
      continue;
    }

    const originalStart = new Date(event.start_at);
    const duration = new Date(event.end_at).getTime() - originalStart.getTime();
    let occurrence = originalStart;
    let index = 0;
    while (index < maxOccurrences && !isAfter(occurrence, range.end)) {
      if ((rule.count && index >= rule.count) || (rule.until && isAfter(occurrence, rule.until))) break;
      const occurrenceEnd = new Date(occurrence.getTime() + duration);
      if (!isBefore(occurrenceEnd, range.start)) {
        expanded.push({
          ...event,
          occurrence_id: `${event.id}:${occurrence.toISOString()}`,
          recurrence_parent_id: event.id,
          start_at: occurrence.toISOString(),
          end_at: occurrenceEnd.toISOString(),
        });
      }
      index += 1;
      occurrence = rule.frequency === 'DAILY'
        ? addDays(originalStart, index * rule.interval)
        : rule.frequency === 'WEEKLY'
          ? addDays(originalStart, index * rule.interval * 7)
          : addMonths(originalStart, index * rule.interval);
    }
  }
  return expanded.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export function taskIsOverdue(task: RoutineTask, now = new Date()): boolean {
  return !!task.due_at
    && !['completed', 'cancelled'].includes(task.status)
    && isBefore(new Date(task.due_at), now);
}

export function clampEventToDay(event: RoutineEvent, day: Date): DateRange {
  return {
    start: max([new Date(event.start_at), startOfDay(day)]),
    end: min([new Date(event.end_at), endOfDay(day)]),
  };
}
