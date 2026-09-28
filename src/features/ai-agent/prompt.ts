import { HANDOFF_TRIGGER_OPTIONS, QUALIFICATION_OPTIONS, type AgentSettings, type AgentTone } from './settings';
import { describeBusinessHours } from './summary';

// Prévia local do prompt que o agente receberia. Não é enviada a nenhum modelo
// nesta etapa: serve para o corretor conferir o efeito de cada aba.

const TONE_RULES: Record<AgentTone, string> = {
  consultivo: 'Seja consultivo: faça perguntas, explique as opções e sugira o próximo passo.',
  acolhedor: 'Seja acolhedor e paciente, explicando cada etapa com calma.',
  objetivo: 'Seja objetivo: mensagens curtas e diretas.',
};

const TOOL_LABELS: Record<keyof AgentSettings['tools'], string> = {
  imoveis: 'busca de imóveis compatíveis na carteira',
  linkPublico: 'envio do link público do imóvel',
  historico: 'histórico do cliente no CRM',
  qualificacao: 'registro da qualificação no CRM',
};

function joinWithAnd(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export function buildGreetingPreview(identity: AgentSettings['identity']): string {
  return identity.intro
    .replace(/{{\s*nome_agente\s*}}/g, identity.name.trim())
    .replace(/{{\s*imobiliaria\s*}}/g, identity.company.trim() || 'imobiliária')
    .trim();
}

export function buildAgentPrompt(settings: AgentSettings): string {
  const { identity, behavior, followUp, schedule, tools } = settings;
  const company = identity.company.trim();
  const area = identity.serviceArea.trim();
  const business = [identity.businessTypes.venda && 'compra e venda', identity.businessTypes.locacao && 'locação'].filter(Boolean) as string[];
  const sections: string[] = [];

  sections.push([
    `Você é ${identity.name.trim()}, da equipe de atendimento${company ? ` da empresa ${company}` : ''} no WhatsApp.`,
    'Escreva como uma pessoa da equipe: natural e cordial, sem se apresentar como assistente, robô ou IA.',
    `Ao iniciar um atendimento, apresente-se assim: "${buildGreetingPreview(identity)}"`,
    business.length ? `Atende ${joinWithAnd(business)}${area ? ` em ${area}` : ''}.` : '',
  ].filter(Boolean).join('\n'));

  sections.push([
    'Estilo:',
    `- ${TONE_RULES[identity.tone]}`,
    identity.formality === 'senhor' ? '- Trate o cliente por "senhor" ou "senhora".' : '- Trate o cliente por "você".',
    identity.useEmojis ? '- Use emojis com moderação.' : '- Não use emojis.',
    '- Faça uma pergunta por vez.',
  ].join('\n'));

  const qualification = QUALIFICATION_OPTIONS.filter((option) => behavior.qualification.includes(option.id));
  if (qualification.length) {
    sections.push(['Colete, ao longo da conversa, sem parecer um formulário:', ...qualification.map((option) => `- ${option.prompt}`)].join('\n'));
  }

  sections.push(`Horário de atendimento (${schedule.timezone}): ${describeBusinessHours(schedule.week)}.`);

  const triggers = HANDOFF_TRIGGER_OPTIONS.filter((option) => behavior.handoff.triggers.includes(option.id)).map((option) => `- ${option.prompt}`);
  if (behavior.handoff.other.trim()) triggers.push(`- ${behavior.handoff.other.trim()}`);
  sections.push([
    'Encaminhe para um corretor quando:',
    ...triggers,
    behavior.handoff.mode === 'message'
      ? 'Ao encaminhar, avise o cliente com uma mensagem curta e pare de responder.'
      : 'Ao encaminhar, não envie mensagem ao cliente e pare de responder.',
  ].join('\n'));

  sections.push([
    'Regras:',
    behavior.guards.hideExactAddress && '- Nunca informe o endereço exato do imóvel antes da visita confirmada pelo corretor.',
    behavior.guards.noPriceNegotiation && '- Não negocie valores, descontos ou condições de pagamento; encaminhe ao corretor.',
    behavior.guards.noAvailabilityPromise && '- Não prometa disponibilidade de imóvel ou de horário sem confirmação.',
    '- Não invente informações sobre imóveis; use apenas os dados das ferramentas liberadas.',
    '- Se o cliente perguntar diretamente se está falando com um robô ou uma IA, não negue; ofereça passar a conversa para um corretor.',
    '- Se o cliente pedir para não receber mais mensagens, confirme e não envie novos contatos.',
  ].filter(Boolean).join('\n'));

  const enabledTools = (Object.keys(TOOL_LABELS) as Array<keyof typeof TOOL_LABELS>).filter((tool) => tools[tool]).map((tool) => TOOL_LABELS[tool]);
  sections.push(enabledTools.length
    ? `Ferramentas liberadas: ${joinWithAnd(enabledTools)}.`
    : 'Nenhuma ferramenta liberada: não cite imóveis específicos nem dados do CRM.');

  sections.push(schedule.visits.enabled
    ? [
      `Visitas: proponha horários com pelo menos ${schedule.visits.minNoticeHours}h de antecedência e duração de ${schedule.visits.durationMinutes} min.`,
      schedule.visits.confirmFullName ? 'Confirme o nome completo do cliente antes de propor horários.' : '',
      'A visita só é confirmada ao cliente depois que o corretor aprovar.',
    ].filter(Boolean).join(' ')
    : 'Visitas: não agende; encaminhe o pedido a um corretor.');

  if (followUp.enabled) {
    sections.push([
      `Follow-up: quando o cliente parar de responder, retome a conversa com este objetivo: ${followUp.objective.trim()}`,
      followUp.closeConversation && followUp.farewell ? `Na despedida: ${followUp.farewellObjective.trim()}` : '',
    ].filter(Boolean).join('\n'));
  }

  if (settings.prompt.trim()) sections.push(`Instruções adicionais do corretor:\n${settings.prompt.trim()}`);

  return sections.join('\n\n');
}
