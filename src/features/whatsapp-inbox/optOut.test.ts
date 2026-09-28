import { describe, expect, it } from 'vitest';
import { optOutState } from './optOut';

describe('optOutState', () => {
  const since = '2026-09-27T12:00:00Z';

  it('sem pedido de saída, nada muda', () => {
    expect(optOutState(null, [])).toBe('none');
    expect(optOutState(undefined, [{ direction: 'in', created_at: since }])).toBe('none');
  });

  it('bloqueia enquanto o contato não escreve de novo', () => {
    expect(optOutState(since, [{ direction: 'in', created_at: since }])).toBe('blocked');
    expect(optOutState(since, [{ direction: 'out', created_at: '2026-09-27T13:00:00Z' }])).toBe('blocked');
  });

  it('libera a resposta quando o contato volta a escrever', () => {
    expect(optOutState(since, [{ direction: 'in', created_at: since }, { direction: 'in', created_at: '2026-09-27T12:05:00Z' }])).toBe('replied');
  });
});
