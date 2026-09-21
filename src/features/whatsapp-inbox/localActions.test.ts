import { expect, it } from 'vitest';
import { updateDraft } from './localActions';
it('keeps drafts isolated and clearing one preserves the other', () => {
  const initial = { a: 'Apartamento', b: 'Casa' };
  expect(updateDraft(initial, 'a', '')).toEqual({ a: '', b: 'Casa' });
  expect(initial.a).toBe('Apartamento');
});
