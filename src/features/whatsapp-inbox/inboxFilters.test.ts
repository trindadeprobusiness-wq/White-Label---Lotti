import { describe, expect, it } from 'vitest';
import { emptyFilters, matchesDate, matchesFilters, urgency, type FilterRecord } from './inboxFilters';
const now = new Date(2026, 8, 9, 12).getTime();
const record: FilterRecord = { id: '1', stage: 'visit', status: 'open', interaction: 'unanswered', assignee: 'Equipe', tags: ['Compra'], closedBy: '', unread: true };
describe('Inbox filtering', () => {
  it('combines categories with AND and choices with OR', () => {
    const filters = { ...emptyFilters(), stage: ['visit', 'proposal'], tags: ['Compra'] };
    expect(matchesFilters(record, filters, now)).toBe(true);
    expect(matchesFilters({ ...record, status: 'closed' }, { ...filters, status: ['open'] }, now)).toBe(false);
    expect(matchesFilters(record, emptyFilters(), now)).toBe(true);
  });
  it('uses waiting time, excludes closed and unknown timestamps, with disjoint thresholds', () => {
    const waiting = (minutes: number) => ({ ...record, waitingSince: new Date(now - minutes * 60000).toISOString() });
    expect(urgency(record, emptyFilters(), now)).toBe('all');
    expect(urgency(waiting(14), emptyFilters(), now)).toBe('all');
    expect(urgency(waiting(15), emptyFilters(), now)).toBe('late');
    expect(urgency(waiting(60), emptyFilters(), now)).toBe('urgent');
    expect(urgency({ ...waiting(90), status: 'closed' }, emptyFilters(), now)).toBe('all');
  });
  it('handles local calendar boundaries, custom inclusive end date and missing dates', () => {
    const first = emptyFilters().first;
    expect(matchesDate(new Date(2026, 8, 8, 23, 59).toISOString(), { ...first, period: 'today' }, now)).toBe(false);
    expect(matchesDate(new Date(2026, 7, 31, 23, 59).toISOString(), { ...first, period: 'previousMonth' }, now)).toBe(true);
    expect(matchesDate(new Date(2026, 8, 9, 23, 59).toISOString(), { ...first, period: 'custom', from: '2026-09-09', to: '2026-09-09' }, now)).toBe(true);
    expect(matchesDate(undefined, { ...first, period: 'today' }, now)).toBe(false);
    expect(matchesDate(new Date(now - 8 * 86400000).toISOString(), { ...first, period: 'idle', days: 7 }, now)).toBe(true);
  });
});
