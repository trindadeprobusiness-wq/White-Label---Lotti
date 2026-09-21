import { describe, expect, it } from 'vitest';
import type { RoutineEvent, RoutineTask } from '@/types/routine';
import { expandRecurringEvents, hasEventConflict, moveEvent, resizeEvent, taskIsOverdue } from './calendar';

function event(overrides: Partial<RoutineEvent> = {}): RoutineEvent {
  return {
    id: 'event-1', organization_id: 'org-1', assigned_to: 'user-1', created_by: 'user-1',
    title: 'Visita', description: null, activity_type: 'visita_imovel', status: 'confirmed',
    priority: 'high', start_at: '2026-08-21T12:00:00.000Z', end_at: '2026-08-21T13:00:00.000Z',
    all_day: false, timezone: 'America/Sao_Paulo', recurrence_rule: null, location: null,
    visibility: 'team', source: 'lotti', client_id: null, property_id: null, deal_id: null,
    contract_id: null, rental_id: null, sync_status: 'local', sync_version: 1,
    completed_at: null, deleted_at: null, created_at: '2026-08-20T12:00:00.000Z',
    updated_at: '2026-08-20T12:00:00.000Z', ...overrides,
  };
}

describe('routine calendar rules', () => {
  it('detecta sobreposição, mas aceita horários adjacentes e outro responsável', () => {
    const events = [event()];
    expect(hasEventConflict(events, {
      start: new Date('2026-08-21T12:30:00Z'), end: new Date('2026-08-21T13:30:00Z'), assignedTo: 'user-1',
    })).toBe(true);
    expect(hasEventConflict(events, {
      start: new Date('2026-08-21T13:00:00Z'), end: new Date('2026-08-21T14:00:00Z'), assignedTo: 'user-1',
    })).toBe(false);
    expect(hasEventConflict(events, {
      start: new Date('2026-08-21T12:30:00Z'), end: new Date('2026-08-21T13:30:00Z'), assignedTo: 'user-2',
    })).toBe(false);
  });

  it('preserva duração ao reagendar e exige pelo menos 15 minutos ao redimensionar', () => {
    expect(moveEvent(event(), new Date('2026-08-22T15:00:00Z'))).toEqual({
      start_at: '2026-08-22T15:00:00.000Z', end_at: '2026-08-22T16:00:00.000Z',
    });
    expect(resizeEvent(event(), new Date('2026-08-21T12:05:00Z')).end_at)
      .toBe('2026-08-21T12:15:00.000Z');
  });

  it('expande recorrência semanal sem duplicar fora da janela', () => {
    const occurrences = expandRecurringEvents(
      [event({ recurrence_rule: 'FREQ=WEEKLY;COUNT=4' })],
      { start: new Date('2026-08-20T00:00:00Z'), end: new Date('2026-09-05T23:59:59Z') },
    );
    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((item) => item.start_at)).toEqual([
      '2026-08-21T12:00:00.000Z', '2026-08-28T12:00:00.000Z', '2026-09-04T12:00:00.000Z',
    ]);
  });

  it('classifica tarefa vencida sem marcar concluída', () => {
    const task = {
      due_at: '2026-08-20T10:00:00Z', status: 'todo',
    } as RoutineTask;
    expect(taskIsOverdue(task, new Date('2026-08-21T10:00:00Z'))).toBe(true);
    expect(taskIsOverdue({ ...task, status: 'completed' }, new Date('2026-08-21T10:00:00Z'))).toBe(false);
  });
});
