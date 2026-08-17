import { describe, expect, it } from 'vitest';
import { getCommonSelectedStageId } from './funnelSelection';

describe('getCommonSelectedStageId', () => {
  it('returns the actual common stage of the selected clients', () => {
    const clients = [
      { id: '1', status_funil: 'DOCUMENTACAO' },
      { id: '2', status_funil: 'DOCUMENTACAO' },
      { id: '3', status_funil: 'QUALIFICACAO' },
    ];

    expect(getCommonSelectedStageId(new Set(['1', '2']), clients, {})).toBe('DOCUMENTACAO');
  });

  it('uses a custom-stage override as the current stage', () => {
    const clients = [{ id: '1', status_funil: 'QUALIFICACAO' }];

    expect(getCommonSelectedStageId(new Set(['1']), clients, { '1': 'custom_followup' }))
      .toBe('custom_followup');
  });

  it('returns undefined when the selection contains different stages', () => {
    const clients = [
      { id: '1', status_funil: 'DOCUMENTACAO' },
      { id: '2', status_funil: 'QUALIFICACAO' },
    ];

    expect(getCommonSelectedStageId(new Set(['1', '2']), clients, {})).toBeUndefined();
  });
});
