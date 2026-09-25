import { describe, expect, it } from 'vitest';
import { monthlyUsagePeriod } from './billingPeriod';
describe('período da cota mensal', () => {
  it('não reseta três horas antes da virada no Brasil', () => {
    expect(monthlyUsagePeriod(new Date('2026-10-01T01:00:00Z'))).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(monthlyUsagePeriod(new Date('2026-10-01T03:00:00Z'))).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });
});
