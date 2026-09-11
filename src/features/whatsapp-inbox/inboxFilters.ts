export type FilterRecord = { id: string; stage: string; interaction: string; status: string; assignee: string; tags: string[]; closedBy: string; unread: boolean; firstAt?: string; lastAt?: string; waitingSince?: string };
export type DateFilter = { period: string; from: string; to: string; days: number };
export type InboxFilterState = { stage: string[]; interaction: string[]; status: string[]; assignee: string[]; tags: string[]; closedBy: string[]; unread: boolean; first: DateFilter; last: DateFilter; lateMinutes: number; urgentMinutes: number };
export const emptyFilters = (): InboxFilterState => ({ stage: [], interaction: [], status: [], assignee: [], tags: [], closedBy: [], unread: false, first: { period: 'any', from: '', to: '', days: 7 }, last: { period: 'any', from: '', to: '', days: 7 }, lateMinutes: 15, urgentMinutes: 60 });
export function matchesDate(value: string | undefined, filter: DateFilter, now: number): boolean {
  if (filter.period === 'any') return true;
  if (!value || !Number.isFinite(Date.parse(value))) return false;
  const time = Date.parse(value), today = new Date(now); today.setHours(0, 0, 0, 0);
  const start = new Date(today), end = new Date(today); end.setDate(end.getDate() + 1);
  if (filter.period === 'idle') return time <= now - filter.days * 86400000;
  if (filter.period === 'custom') return (!filter.from || time >= new Date(filter.from + 'T00:00:00').getTime()) && (!filter.to || time <= new Date(filter.to + 'T23:59:59.999').getTime());
  if (filter.period === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (['7', '30', '90'].includes(filter.period)) start.setDate(start.getDate() - Number(filter.period) + 1);
  if (filter.period === 'month') start.setDate(1);
  if (filter.period === 'previousMonth') { start.setDate(1); end.setDate(1); start.setMonth(start.getMonth() - 1); }
  return time >= start.getTime() && time < end.getTime();
}
export function urgency(record: FilterRecord, filters: InboxFilterState, now: number) {
  if (record.status === 'closed' || !record.waitingSince) return 'all';
  const minutes = (now - Date.parse(record.waitingSince)) / 60000;
  return minutes >= filters.urgentMinutes ? 'urgent' : minutes >= filters.lateMinutes ? 'late' : 'all';
}
export function matchesFilters(record: FilterRecord, filters: InboxFilterState, now: number) {
  return (['stage', 'interaction', 'status', 'assignee', 'closedBy'] as const).every(key => !filters[key].length || filters[key].includes(record[key]))
    && (!filters.tags.length || filters.tags.some(tag => record.tags.includes(tag)))
    && (!filters.unread || record.unread) && matchesDate(record.firstAt, filters.first, now) && matchesDate(record.lastAt, filters.last, now);
}
