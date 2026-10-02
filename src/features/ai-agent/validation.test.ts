import { describe, expect, it } from 'vitest';
import { createDefaultAgentSettings, type AgentSettings } from './settings';
import { hasBlockingIssues, issuesByTab, validateAgentSettings } from './validation';

function withSettings(change: (settings: AgentSettings) => void) {
  const settings = createDefaultAgentSettings();
  settings.identity.company = 'Imobiliária Aurora';
  change(settings);
  return validateAgentSettings(settings);
}

const fields = (issues: ReturnType<typeof validateAgentSettings>) => issues.map((issue) => `${issue.severity}:${issue.tab}:${issue.field}`);

describe('validateAgentSettings', () => {
  it('accepts the default settings and only asks for the company name', () => {
    const issues = validateAgentSettings(createDefaultAgentSettings());

    expect(fields(issues)).toEqual(['warning:identity:identity.company']);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('requires a short agent name, a greeting and at least one kind of business', () => {
    expect(fields(withSettings((settings) => { settings.identity.intro = ' '; }))).toContain('error:identity:identity.intro');
    expect(fields(withSettings((settings) => { settings.identity.intro = 'x'.repeat(401); }))).toContain('error:identity:identity.intro');
    expect(fields(withSettings((settings) => { settings.identity.name = '   '; }))).toContain('error:identity:identity.name');
    expect(fields(withSettings((settings) => { settings.identity.name = 'x'.repeat(41); }))).toContain('error:identity:identity.name');
    expect(fields(withSettings((settings) => { settings.identity.businessTypes = { venda: false, locacao: false }; }))).toContain('error:identity:identity.businessTypes');
  });

  it('requires a working day with the end after the start', () => {
    expect(fields(withSettings((settings) => {
      for (const day of Object.values(settings.schedule.week)) day.enabled = false;
    }))).toContain('error:schedule:schedule.week');

    const issues = withSettings((settings) => { settings.schedule.week.tue = { enabled: true, start: '18:00', end: '08:00' }; });
    expect(fields(issues)).toContain('error:schedule:schedule.week.tue');
    expect(issues.find((issue) => issue.field === 'schedule.week.tue')?.message).toContain('Terça');
  });

  it('checks the waiting time only when the agent waits for the team', () => {
    expect(withSettings((settings) => { settings.behavior.attendDelayMinutes = 0; })).toEqual([]);
    expect(fields(withSettings((settings) => {
      settings.behavior.attend.afterDelay = true;
      settings.behavior.attendDelayMinutes = 0;
    }))).toContain('error:behavior:behavior.attendDelayMinutes');
  });

  it('requires the handoff message only when the handoff sends a message', () => {
    expect(fields(withSettings((settings) => { settings.behavior.handoff.messageInHours = ''; }))).toContain('error:behavior:behavior.handoff.messageInHours');
    expect(withSettings((settings) => {
      settings.behavior.handoff.mode = 'silent';
      settings.behavior.handoff.messageInHours = '';
      settings.behavior.handoff.messageOutOfHours = '';
    })).toEqual([]);
  });

  it('validates follow-up touches, objective and closing time only while follow-up is on', () => {
    const issues = withSettings((settings) => {
      settings.followUp.delaysHours = [0, 30];
      settings.followUp.objective = ' ';
      settings.followUp.closeConversation = true;
      settings.followUp.closeAfterHours = 100;
    });

    expect(fields(issues)).toEqual(expect.arrayContaining([
      'error:cycle:followUp.delaysHours.0',
      'error:cycle:followUp.delaysHours.1',
      'error:cycle:followUp.objective',
      'error:cycle:followUp.closeAfterHours',
    ]));
    expect(withSettings((settings) => {
      settings.followUp.enabled = false;
      settings.followUp.objective = '';
    })).toEqual([]);
  });

  it('warns without blocking when the touches go past the WhatsApp 24-hour window', () => {
    const issues = withSettings((settings) => { settings.followUp.delaysHours = [12, 12]; });

    expect(fields(issues)).toEqual(['warning:cycle:followUp.delaysHours']);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('validates visits only when the agent can propose them', () => {
    expect(withSettings((settings) => { settings.schedule.visits.durationMinutes = 5; })).toEqual([]);
    expect(fields(withSettings((settings) => {
      settings.schedule.visits.enabled = true;
      settings.schedule.visits.durationMinutes = 5;
      settings.schedule.visits.minNoticeHours = -1;
    }))).toEqual(['error:schedule:schedule.visits.durationMinutes', 'error:schedule:schedule.visits.minNoticeHours']);
  });

  it('limits the additional instructions', () => {
    expect(fields(withSettings((settings) => { settings.prompt = 'x'.repeat(3001); }))).toEqual(['error:prompt:prompt']);
  });
});

describe('issuesByTab', () => {
  it('counts only blocking issues for each tab', () => {
    const issues = withSettings((settings) => {
      settings.identity.name = '';
      settings.identity.company = '';
      settings.followUp.delaysHours = [12, 12];
    });

    expect(issuesByTab(issues)).toEqual({ identity: 1 });
  });
});
