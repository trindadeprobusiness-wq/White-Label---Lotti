/** Quotas reset on the calendar month in the business timezone. */
export function monthlyUsagePeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')!.value);
  const month = Number(parts.find((part) => part.type === 'month')!.value);
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return { start: `${prefix}-01`, end: `${prefix}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` };
}
