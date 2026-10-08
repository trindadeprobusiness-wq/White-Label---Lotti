import { describe, expect, it, vi } from 'vitest';
import { buildSummary } from '../_shared/diagnostic/engine.ts';
import type { Answers } from '../_shared/diagnostic/types.ts';
import { enrichSummary } from './ai.ts';

const answers: Answers = {
  name: 'Ana Teste', contact: 'ana@example.test', company: 'Empresa Teste', city: 'Goiânia',
  segment: 'real_estate', bottleneck: 'follow_up', goal: 'Organizar o follow-up dos leads',
};
const fallback = buildSummary(answers);
const reserve = async (allowed: boolean) => ({
  rpc: vi.fn(async (name: string) => ({ data: name === 'diagnostic_reserve_ai' ? allowed : null, error: null })),
});

describe('diagnostic AI fallback', () => {
  it('uses the deterministic rule summary while AI is disabled', async () => {
    const client = await reserve(true);
    const request = vi.fn();
    await expect(enrichSummary(client, 'session', answers, fallback, { enabled: false, request: request as never })).resolves.toEqual(fallback);
    expect(request).not.toHaveBeenCalled();
  });

  it('uses the deterministic rule summary when the AI budget is exhausted', async () => {
    const client = await reserve(false);
    const request = vi.fn();
    await expect(enrichSummary(client, 'session', answers, fallback, { enabled: true, request: request as never })).resolves.toEqual(fallback);
    expect(request).not.toHaveBeenCalled();
  });

  it('continues with rules when the AI provider is unavailable', async () => {
    const client = await reserve(true);
    const request = vi.fn(async () => { throw new Error('provider unavailable'); });
    await expect(enrichSummary(client, 'session', answers, fallback, { enabled: true, request: request as never })).resolves.toEqual(fallback);
    expect(request).toHaveBeenCalledOnce();
  });
});
