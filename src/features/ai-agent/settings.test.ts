import { describe, expect, it } from 'vitest';
import { AGENT_SETTINGS_STORAGE_KEY, createDefaultAgentSettings, loadAgentSettings, normalizeAgentSettings, saveAgentSettings } from './settings';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('normalizeAgentSettings', () => {
  it('returns the defaults for anything that is not a settings object', () => {
    expect(normalizeAgentSettings(null)).toEqual(createDefaultAgentSettings());
    expect(normalizeAgentSettings([])).toEqual(createDefaultAgentSettings());
    expect(normalizeAgentSettings('texto')).toEqual(createDefaultAgentSettings());
  });

  it('keeps name, intro, prompt, tools and follow-up from the first local format', () => {
    const settings = normalizeAgentSettings({
      active: false,
      name: 'Lia',
      intro: 'Assistente da Imobiliária Aurora.',
      tone: 'Consultivo e objetivo.',
      behavior: 'Entender o interesse do lead e orientar o próximo passo.',
      handoff: 'Quando citar permuta.',
      timezone: 'America/Manaus',
      hours: 'Segunda a sexta',
      tools: { imoveis: false, agenda: true, crm: false },
      prompt: 'Nunca invente valores.',
      followUp: { enabled: false, delays: [1, 3, 8], message: 'Retomar a busca.' },
    });

    expect(settings.version).toBe(2);
    expect(settings.active).toBe(false);
    expect(settings.identity.name).toBe('Lia');
    expect(settings.identity.intro).toBe('Assistente da Imobiliária Aurora.');
    expect(settings.prompt).toBe('Nunca invente valores.');
    expect(settings.schedule.timezone).toBe('America/Sao_Paulo');
    expect(settings.tools.imoveis).toBe(false);
    expect(settings.tools.historico).toBe(false);
    expect(settings.schedule.visits.enabled).toBe(true);
    expect(settings.behavior.handoff.other).toBe('Quando citar permuta.');
    expect(settings.followUp).toMatchObject({ enabled: false, delaysHours: [1, 3, 8], objective: 'Retomar a busca.' });
  });

  it('replaces the old default name and greeting that presented the agent as the Lotti assistant', () => {
    const settings = normalizeAgentSettings({ name: 'IA Lotti', intro: 'Assistente imobiliário da Lotti.' });

    expect(settings.identity.name).toBe(createDefaultAgentSettings().identity.name);
    expect(settings.identity.intro).toBe(createDefaultAgentSettings().identity.intro);
  });

  it('replaces the previous default greeting that called the agent a virtual assistant', () => {
    const settings = normalizeAgentSettings({
      version: 2,
      identity: { name: 'Lotti', intro: 'Olá! Sou {{nome_agente}}, assistente virtual da {{imobiliaria}}. Posso ajudar você a encontrar um imóvel para comprar ou alugar?' },
    });

    expect(settings.identity.name).toBe(createDefaultAgentSettings().identity.name);
    expect(settings.identity.intro).toBe(createDefaultAgentSettings().identity.intro);
  });

  it('greets as a person from the team by default', () => {
    const { identity } = createDefaultAgentSettings();

    expect(`${identity.name} ${identity.intro}`).not.toMatch(/assistente|virtual|\bIA\b|robô|Lotti/i);
  });

  it('does not carry the old default handoff sentence into the custom rule', () => {
    const settings = normalizeAgentSettings({ handoff: 'Encaminhar quando o lead pedir atendimento humano.' });

    expect(settings.behavior.handoff.other).toBe('');
  });

  it('repairs wrong types and unknown options inside the current format', () => {
    const settings = normalizeAgentSettings({
      version: 2,
      active: 'sim',
      identity: { name: 42, tone: 'agressivo', businessTypes: { venda: 'x', locacao: false } },
      behavior: { attendMode: 'nunca', qualification: ['regiao', 'cpf'], handoff: { triggers: ['proposta', 'hack'], mode: 'grito' } },
      followUp: { delaysHours: [2, 'x', -1, 4, 5, 6, 7, 8] },
      schedule: { timezone: 42, week: { mon: { enabled: true, start: '25:00', end: '18:00' } } },
      tools: { imoveis: 'yes' },
      prompt: null,
    });
    const defaults = createDefaultAgentSettings();

    expect(settings.active).toBe(defaults.active);
    expect(settings.identity.name).toBe(defaults.identity.name);
    expect(settings.identity.tone).toBe(defaults.identity.tone);
    expect(settings.identity.businessTypes).toEqual({ venda: defaults.identity.businessTypes.venda, locacao: false });
    expect(settings.behavior.attendMode).toBe(defaults.behavior.attendMode);
    expect(settings.behavior.qualification).toEqual(['regiao']);
    expect(settings.behavior.handoff.triggers).toEqual(['pede_corretor', 'proposta']);
    expect(settings.behavior.handoff.mode).toBe('message');
    expect(settings.followUp.delaysHours).toEqual([2, 4, 5, 6, 7]);
    expect(settings.schedule.timezone).toBe(defaults.schedule.timezone);
    expect(settings.schedule.week.mon).toEqual({ enabled: true, start: defaults.schedule.week.mon.start, end: '18:00' });
    expect(settings.tools.imoveis).toBe(defaults.tools.imoveis);
    expect(settings.prompt).toBe('');
  });

  it('keeps a known AI model and falls back to the default for unknown ones', () => {
    expect(normalizeAgentSettings({ version: 2, model: 'gpt-4.1-mini' }).model).toBe('gpt-4.1-mini');
    expect(normalizeAgentSettings({ version: 2, model: 'modelo-inventado' }).model).toBe(createDefaultAgentSettings().model);
  });

  it('always keeps the request for a broker as a handoff trigger', () => {
    const settings = normalizeAgentSettings({ version: 2, behavior: { handoff: { triggers: [] } } });

    expect(settings.behavior.handoff.triggers).toEqual(['pede_corretor']);
  });

  it('falls back to the default follow-up touches when none is valid', () => {
    const settings = normalizeAgentSettings({ version: 2, followUp: { delaysHours: ['x'] } });

    expect(settings.followUp.delaysHours).toEqual(createDefaultAgentSettings().followUp.delaysHours);
  });
});

describe('agent settings storage', () => {
  it('loads defaults when the saved value is not JSON', () => {
    expect(loadAgentSettings(memoryStorage({ [AGENT_SETTINGS_STORAGE_KEY]: '{invalido' }))).toEqual(createDefaultAgentSettings());
  });

  it('round-trips the settings through the browser storage', () => {
    const storage = memoryStorage();
    const settings = { ...createDefaultAgentSettings(), prompt: 'Priorize imóveis prontos.' };

    expect(saveAgentSettings(settings, storage)).toBe(true);
    expect(loadAgentSettings(storage)).toEqual(settings);
  });

  it('reports a failed save instead of throwing', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };

    expect(saveAgentSettings(createDefaultAgentSettings(), storage)).toBe(false);
  });
});
