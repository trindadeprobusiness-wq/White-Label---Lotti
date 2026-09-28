import { describe, expect, it } from 'vitest';
import { createDefaultAgentSettings } from './settings';
import { describeAttendMode, describeBusinessHours, describeHandoff } from './summary';

describe('describeBusinessHours', () => {
  it('groups consecutive days that share the same hours', () => {
    expect(describeBusinessHours(createDefaultAgentSettings().schedule.week)).toBe('Seg a Sex, 08:00–18:00 · Sáb, 09:00–13:00');
  });

  it('separates days that are not consecutive', () => {
    const week = createDefaultAgentSettings().schedule.week;
    week.wed.enabled = false;
    week.sat.enabled = false;

    expect(describeBusinessHours(week)).toBe('Seg e Ter, 08:00–18:00 · Qui e Sex, 08:00–18:00');
  });

  it('says when no day is open', () => {
    const week = createDefaultAgentSettings().schedule.week;
    for (const day of Object.values(week)) day.enabled = false;

    expect(describeBusinessHours(week)).toBe('Nenhum dia de atendimento');
  });
});

describe('describeAttendMode', () => {
  it('describes each answering mode', () => {
    const behavior = createDefaultAgentSettings().behavior;

    expect(describeAttendMode(behavior)).toBe('Responde toda mensagem recebida');
    expect(describeAttendMode({ ...behavior, attendMode: 'outside_hours' })).toBe('Responde só fora do horário de atendimento');
    expect(describeAttendMode({ ...behavior, attendMode: 'after_delay', attendDelayMinutes: 20 })).toBe('Responde se a equipe não responder em 20 min');
  });
});

describe('describeHandoff', () => {
  it('describes the handoff mode and destination stage', () => {
    const behavior = createDefaultAgentSettings().behavior;

    expect(describeHandoff(behavior)).toBe('Com mensagem');
    expect(describeHandoff({ ...behavior, handoff: { ...behavior.handoff, mode: 'silent' } }, 'Atendimento humano')).toBe('Silencioso, vai para Atendimento humano');
  });
});
