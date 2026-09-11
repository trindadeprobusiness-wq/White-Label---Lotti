import { expect, it } from 'vitest';
import { contactDisplay } from './contactDisplay';
it('normalizes display name and derives initials', () => {
  expect(contactDisplay('  Ana   Silva ')).toEqual({ contactName: 'Ana Silva', avatar: 'AS' });
  expect(contactDisplay('Ana')).toEqual({ contactName: 'Ana', avatar: 'AN' });
});
it('rejects blank and oversized names', () => {
  expect(() => contactDisplay(' ')).toThrow();
  expect(() => contactDisplay('a'.repeat(121))).toThrow();
});
