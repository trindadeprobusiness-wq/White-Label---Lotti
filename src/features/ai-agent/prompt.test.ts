import { describe, expect, it } from 'vitest';
import { createDefaultAgentSettings } from './settings';
import { buildAgentPrompt, buildGreetingPreview } from './prompt';

describe('buildAgentPrompt', () => {
  it('combines identity, qualification, hours, handoff and protections', () => {
    const settings = createDefaultAgentSettings();
    settings.identity.name = 'Lia';
    settings.identity.company = 'Imobiliária Aurora';
    settings.identity.serviceArea = 'Setor Bueno e Setor Marista';
    settings.prompt = 'Priorize imóveis prontos para morar.';

    const prompt = buildAgentPrompt(settings);

    expect(prompt).toContain('Você é Lia, da equipe de atendimento da empresa Imobiliária Aurora no WhatsApp.');
    expect(prompt).toContain('Escreva como uma pessoa da equipe');
    expect(prompt).toContain('Se o cliente perguntar diretamente se está falando com um robô ou uma IA, não negue');
    expect(prompt).not.toMatch(/assistente virtual|Lotti/);
    expect(prompt).toContain('Ao iniciar um atendimento, apresente-se assim: "Olá! Aqui é Lia, da Imobiliária Aurora.');
    expect(prompt).toContain('Atende compra e venda e locação em Setor Bueno e Setor Marista.');
    expect(prompt).toContain('- Finalidade: comprar ou alugar');
    expect(prompt).toContain('Horário de atendimento (America/Sao_Paulo): Seg a Sex, 08:00–18:00 · Sáb, 09:00–13:00.');
    expect(prompt).toContain('- O cliente pede para falar com um corretor');
    expect(prompt).toContain('- Nunca informe o endereço exato do imóvel antes da visita confirmada pelo corretor.');
    expect(prompt).toContain('Instruções adicionais do corretor:\nPriorize imóveis prontos para morar.');
  });

  it('leaves out rules that are switched off and empty sections', () => {
    const settings = createDefaultAgentSettings();
    settings.identity.businessTypes = { venda: false, locacao: true };
    settings.behavior.guards.noPriceNegotiation = false;
    settings.behavior.qualification = [];

    const prompt = buildAgentPrompt(settings);

    expect(prompt).toContain('Atende locação.');
    expect(prompt).not.toContain('Não negocie valores');
    expect(prompt).not.toContain('Colete, ao longo da conversa');
    expect(prompt).not.toContain('Instruções adicionais do corretor');
  });

  it('includes the custom handoff case and the visit rules when visits are on', () => {
    const settings = createDefaultAgentSettings();
    settings.behavior.handoff.other = 'Cliente cita permuta';
    settings.schedule.visits.enabled = true;

    const prompt = buildAgentPrompt(settings);

    expect(prompt).toContain('- Cliente cita permuta');
    expect(prompt).toContain('Visitas: proponha horários com pelo menos 2h de antecedência e duração de 60 min.');
    expect(prompt).toContain('A visita só é confirmada ao cliente depois que o corretor aprovar.');
  });
});

describe('buildGreetingPreview', () => {
  it('fills the agent and company variables of the greeting', () => {
    const identity = { ...createDefaultAgentSettings().identity, name: 'Lia', company: 'Imobiliária Aurora' };

    expect(buildGreetingPreview(identity)).toBe('Olá! Aqui é Lia, da Imobiliária Aurora. Como posso ajudar você a encontrar seu imóvel?');
  });

  it('uses a generic company word while the company name is empty', () => {
    const identity = { ...createDefaultAgentSettings().identity, name: 'Lia', company: ' ', intro: 'Sou {{ nome_agente }}, da {{imobiliaria}}.' };

    expect(buildGreetingPreview(identity)).toBe('Sou Lia, da imobiliária.');
  });
});
