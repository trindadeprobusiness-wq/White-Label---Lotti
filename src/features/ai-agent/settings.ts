// Configuração do Agente de IA. O formato é salvo no banco (remoteSettings.ts)
// e lido pela ponte do WhatsApp; o navegador guarda só uma cópia para abrir rápido.

export const AGENT_SETTINGS_STORAGE_KEY = 'lotti:agent-settings';
export const PROMPT_LIMIT = 3000;
export const INTRO_LIMIT = 400;
export const NAME_LIMIT = 40;
export const MAX_FOLLOW_UPS = 5;
/** Soma máxima dos toques para o último cair dentro da janela de 24 h do WhatsApp. */
export const FOLLOW_UP_WINDOW_HOURS = 23;

export type AgentTab = 'identity' | 'behavior' | 'cycle' | 'schedule' | 'tools' | 'prompt';
export type AgentTone = 'consultivo' | 'acolhedor' | 'objetivo';
export type AgentFormality = 'voce' | 'senhor';
export type AttendMode = 'always' | 'outside_hours' | 'after_delay';
export type HandoffMode = 'message' | 'silent';
export type QualificationField = 'finalidade' | 'tipo_imovel' | 'regiao' | 'faixa_preco' | 'quartos' | 'prazo' | 'pagamento';
export type HandoffTrigger = 'pede_corretor' | 'agendar_visita' | 'proposta' | 'financiamento' | 'insatisfacao' | 'fora_do_escopo';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type DayHours = { enabled: boolean; start: string; end: string };

// A ponte do WhatsApp usa o modelo escolhido em cada resposta (OpenAI ou Google,
// conforme a chave configurada no servidor; sem a chave, entra o provedor que houver).
export const AGENT_MODEL_OPTIONS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'OpenAI', description: 'Padrão atual do atendimento. Rápido e econômico.' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', provider: 'OpenAI', description: 'Segue instruções longas com mais precisão.' },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', provider: 'OpenAI', description: 'Melhor em conversas complexas; responde mais devagar.' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google', description: 'O mesmo modelo do Assistente da Lotti.' },
] as const;
export type AgentModelId = typeof AGENT_MODEL_OPTIONS[number]['id'];
export const agentModel = (id: AgentModelId) => AGENT_MODEL_OPTIONS.find((option) => option.id === id) ?? AGENT_MODEL_OPTIONS[0];

export type AgentSettings = {
  version: 2;
  active: boolean;
  model: AgentModelId;
  identity: {
    name: string;
    company: string;
    intro: string;
    tone: AgentTone;
    formality: AgentFormality;
    useEmojis: boolean;
    businessTypes: { venda: boolean; locacao: boolean };
    serviceArea: string;
  };
  behavior: {
    /**
     * Quando a IA entra. Os dois motivos SOMAM: marcar os dois faz a IA
     * atender fora do expediente E quando a equipe demora. Nenhum marcado
     * significa atender sempre, que é o começo de todo mundo.
     *
     * Era um escolha-um-só (`attendMode`), e isso obrigava a abrir mão de
     * um dos dois. O campo antigo continua sendo lido para contas que ainda
     * não foram salvas no formato novo.
     */
    attend: { outsideHours: boolean; afterDelay: boolean };
    attendMode?: AttendMode;
    attendDelayMinutes: number;
    qualification: QualificationField[];
    handoff: {
      triggers: HandoffTrigger[];
      other: string;
      mode: HandoffMode;
      messageInHours: string;
      messageOutOfHours: string;
      stageId: string | null;
    };
    guards: {
      pauseOnHumanReply: boolean;
      aggregationSeconds: number;
      hideExactAddress: boolean;
      noPriceNegotiation: boolean;
      noAvailabilityPromise: boolean;
    };
  };
  followUp: {
    enabled: boolean;
    delaysHours: number[];
    objective: string;
    respectBusinessHours: boolean;
    closeConversation: boolean;
    closeAfterHours: number;
    farewell: boolean;
    farewellObjective: string;
    finalStageId: string | null;
  };
  schedule: {
    timezone: string;
    week: Record<Weekday, DayHours>;
    visits: {
      enabled: boolean;
      durationMinutes: number;
      minNoticeHours: number;
      confirmFullName: boolean;
      stageId: string | null;
    };
  };
  tools: { imoveis: boolean; linkPublico: boolean; historico: boolean; qualificacao: boolean };
  prompt: string;
};

export const AGENT_TABS: Array<{ id: AgentTab; label: string }> = [
  { id: 'identity', label: 'Identidade' },
  { id: 'behavior', label: 'Comportamento' },
  { id: 'cycle', label: 'Ciclo da conversa' },
  { id: 'schedule', label: 'Agendamento' },
  { id: 'tools', label: 'Ferramentas' },
  { id: 'prompt', label: 'Prompt' },
];

export const TONE_OPTIONS: Array<{ id: AgentTone; label: string; description: string }> = [
  { id: 'consultivo', label: 'Consultivo', description: 'Faz perguntas, explica opções e orienta o próximo passo.' },
  { id: 'acolhedor', label: 'Acolhedor', description: 'Próximo e paciente, bom para primeira compra ou locação.' },
  { id: 'objetivo', label: 'Objetivo', description: 'Mensagens curtas, direto ao ponto.' },
];

export const QUALIFICATION_OPTIONS: Array<{ id: QualificationField; label: string; prompt: string }> = [
  { id: 'finalidade', label: 'Comprar ou alugar', prompt: 'Finalidade: comprar ou alugar' },
  { id: 'tipo_imovel', label: 'Tipo de imóvel', prompt: 'Tipo de imóvel: casa, apartamento, terreno ou comercial' },
  { id: 'regiao', label: 'Região ou bairro', prompt: 'Região ou bairros de interesse' },
  { id: 'faixa_preco', label: 'Faixa de valor', prompt: 'Faixa de valor ou aluguel' },
  { id: 'quartos', label: 'Quartos e vagas', prompt: 'Quantidade de quartos e vagas' },
  { id: 'prazo', label: 'Prazo para mudar', prompt: 'Prazo para se mudar' },
  { id: 'pagamento', label: 'Forma de pagamento', prompt: 'Forma de pagamento: financiamento, FGTS ou à vista' },
];

export const HANDOFF_TRIGGER_OPTIONS: Array<{ id: HandoffTrigger; label: string; prompt: string; locked?: boolean }> = [
  { id: 'pede_corretor', label: 'Pede para falar com um corretor', prompt: 'O cliente pede para falar com um corretor', locked: true },
  { id: 'agendar_visita', label: 'Quer agendar uma visita', prompt: 'O cliente quer agendar uma visita' },
  { id: 'proposta', label: 'Quer fazer proposta ou negociar valor', prompt: 'O cliente quer fazer proposta ou negociar valor' },
  { id: 'financiamento', label: 'Pergunta sobre financiamento, documentos ou contrato', prompt: 'O cliente pergunta sobre financiamento, documentos ou contrato' },
  { id: 'insatisfacao', label: 'Demonstra insatisfação', prompt: 'O cliente demonstra insatisfação' },
  { id: 'fora_do_escopo', label: 'Assunto que a IA não sabe responder', prompt: 'O assunto está fora do que você sabe responder com segurança' },
];

export const WEEKDAYS: Array<{ id: Weekday; short: string; label: string }> = [
  { id: 'mon', short: 'Seg', label: 'Segunda' },
  { id: 'tue', short: 'Ter', label: 'Terça' },
  { id: 'wed', short: 'Qua', label: 'Quarta' },
  { id: 'thu', short: 'Qui', label: 'Quinta' },
  { id: 'fri', short: 'Sex', label: 'Sexta' },
  { id: 'sat', short: 'Sáb', label: 'Sábado' },
  { id: 'sun', short: 'Dom', label: 'Domingo' },
];

// Atendimento só no horário de Brasília.
export const TIMEZONE_OPTIONS = [{ id: 'America/Sao_Paulo', label: 'Brasília' }];

/** Horários de 30 em 30 minutos para os seletores de expediente. */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);

export const AGENT_NAME_VARIABLE = '{{nome_agente}}';
export const COMPANY_VARIABLE = '{{imobiliaria}}';

const LEGACY_DEFAULT_HANDOFF = 'Encaminhar quando o lead pedir atendimento humano.';
// Padrões antigos que apresentavam o agente como assistente da Lotti: voltam ao padrão atual.
const LEGACY_DEFAULT_NAME = 'IA Lotti';
const LEGACY_DEFAULT_INTRO = 'Assistente imobiliário da Lotti.';
const PREVIOUS_DEFAULT_NAME = 'Lotti';
const PREVIOUS_DEFAULT_INTRO = `Olá! Sou ${AGENT_NAME_VARIABLE}, assistente virtual da ${COMPANY_VARIABLE}. Posso ajudar você a encontrar um imóvel para comprar ou alugar?`;

export function createDefaultAgentSettings(): AgentSettings {
  const workday = (): DayHours => ({ enabled: true, start: '08:00', end: '18:00' });
  return {
    version: 2,
    active: false,
    model: 'gpt-4o-mini',
    identity: {
      name: 'Ana',
      company: '',
      intro: `Olá! Aqui é ${AGENT_NAME_VARIABLE}, da ${COMPANY_VARIABLE}. Como posso ajudar você a encontrar seu imóvel?`,
      tone: 'consultivo',
      formality: 'voce',
      useEmojis: false,
      businessTypes: { venda: true, locacao: true },
      serviceArea: '',
    },
    behavior: {
      attend: { outsideHours: false, afterDelay: false },
      attendDelayMinutes: 15,
      qualification: ['finalidade', 'tipo_imovel', 'regiao', 'faixa_preco', 'quartos'],
      handoff: {
        triggers: ['pede_corretor', 'agendar_visita', 'proposta', 'financiamento'],
        other: '',
        mode: 'message',
        messageInHours: 'Vou chamar um corretor para continuar com você. Só um instante.',
        messageOutOfHours: 'Vou passar seu atendimento para um corretor. Ele retorna assim que o expediente começar.',
        stageId: null,
      },
      guards: {
        pauseOnHumanReply: true,
        aggregationSeconds: 10,
        hideExactAddress: true,
        noPriceNegotiation: true,
        noAvailabilityPromise: true,
      },
    },
    followUp: {
      enabled: true,
      delaysHours: [2, 6, 12],
      objective: 'Retome o assunto de onde a conversa parou e pergunte, sem pressionar, se o cliente quer continuar a busca.',
      respectBusinessHours: true,
      closeConversation: false,
      closeAfterHours: 24,
      farewell: true,
      farewellObjective: 'Diga que vai encerrar por aqui e que o cliente pode chamar quando quiser retomar.',
      finalStageId: null,
    },
    schedule: {
      timezone: 'America/Sao_Paulo',
      week: {
        mon: workday(), tue: workday(), wed: workday(), thu: workday(), fri: workday(),
        sat: { enabled: true, start: '09:00', end: '13:00' },
        sun: { enabled: false, start: '09:00', end: '13:00' },
      },
      visits: { enabled: false, durationMinutes: 60, minNoticeHours: 2, confirmFullName: true, stageId: null },
    },
    tools: { imoveis: true, linkPublico: true, historico: true, qualificacao: true },
    prompt: '',
  };
}

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => !!value && typeof value === 'object' && !Array.isArray(value);
const obj = (value: unknown): Loose => (isObject(value) ? value : {});
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
const optionalId = (value: unknown, fallback: string | null) =>
  value === null ? null : typeof value === 'string' && value.trim() ? value.trim() : fallback;
const time = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;

function knownList<T extends string>(value: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback;
  return allowed.filter((item) => value.includes(item));
}

function delays(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const valid = value
    .filter((delay): delay is number => typeof delay === 'number' && Number.isFinite(delay) && delay > 0)
    .map((delay) => Math.round(delay))
    .slice(0, MAX_FOLLOW_UPS);
  return valid.length ? valid : fallback;
}

const tones = TONE_OPTIONS.map((option) => option.id);
const qualificationFields = QUALIFICATION_OPTIONS.map((option) => option.id);
const handoffTriggers = HANDOFF_TRIGGER_OPTIONS.map((option) => option.id);
const timezones = TIMEZONE_OPTIONS.map((option) => option.id);

function lerAtendimento(behavior: Loose): AgentSettings['behavior']['attend'] {
  const novo = obj(behavior.attend);
  if (typeof novo.outsideHours === 'boolean' || typeof novo.afterDelay === 'boolean') {
    return { outsideHours: novo.outsideHours === true, afterDelay: novo.afterDelay === true };
  }
  // Formato antigo: um modo só.
  return {
    outsideHours: behavior.attendMode === 'outside_hours',
    afterDelay: behavior.attendMode === 'after_delay',
  };
}
const models = AGENT_MODEL_OPTIONS.map((option) => option.id);

function normalizeCurrent(raw: Loose): AgentSettings {
  const defaults = createDefaultAgentSettings();
  const identity = obj(raw.identity);
  const business = obj(identity.businessTypes);
  const behavior = obj(raw.behavior);
  const handoff = obj(behavior.handoff);
  const guards = obj(behavior.guards);
  const followUp = obj(raw.followUp);
  const schedule = obj(raw.schedule);
  const week = obj(schedule.week);
  const visits = obj(schedule.visits);
  const tools = obj(raw.tools);

  const triggers = knownList(handoff.triggers, handoffTriggers, defaults.behavior.handoff.triggers);

  return {
    version: 2,
    active: bool(raw.active, defaults.active),
    model: oneOf(raw.model, models, defaults.model),
    identity: {
      name: identity.name === PREVIOUS_DEFAULT_NAME ? defaults.identity.name : str(identity.name, defaults.identity.name),
      company: str(identity.company, defaults.identity.company),
      intro: identity.intro === PREVIOUS_DEFAULT_INTRO ? defaults.identity.intro : str(identity.intro, defaults.identity.intro),
      tone: oneOf(identity.tone, tones, defaults.identity.tone),
      formality: oneOf(identity.formality, ['voce', 'senhor'] as const, defaults.identity.formality),
      useEmojis: bool(identity.useEmojis, defaults.identity.useEmojis),
      businessTypes: {
        venda: bool(business.venda, defaults.identity.businessTypes.venda),
        locacao: bool(business.locacao, defaults.identity.businessTypes.locacao),
      },
      serviceArea: str(identity.serviceArea, defaults.identity.serviceArea),
    },
    behavior: {
      attend: lerAtendimento(behavior),
      attendDelayMinutes: num(behavior.attendDelayMinutes, defaults.behavior.attendDelayMinutes),
      qualification: knownList(behavior.qualification, qualificationFields, defaults.behavior.qualification),
      handoff: {
        // Pedir um corretor sempre encaminha: não é uma opção desligável.
        triggers: triggers.includes('pede_corretor') ? triggers : ['pede_corretor', ...triggers],
        other: str(handoff.other, defaults.behavior.handoff.other),
        mode: oneOf(handoff.mode, ['message', 'silent'] as const, defaults.behavior.handoff.mode),
        messageInHours: str(handoff.messageInHours, defaults.behavior.handoff.messageInHours),
        messageOutOfHours: str(handoff.messageOutOfHours, defaults.behavior.handoff.messageOutOfHours),
        stageId: optionalId(handoff.stageId, defaults.behavior.handoff.stageId),
      },
      guards: {
        pauseOnHumanReply: bool(guards.pauseOnHumanReply, defaults.behavior.guards.pauseOnHumanReply),
        aggregationSeconds: num(guards.aggregationSeconds, defaults.behavior.guards.aggregationSeconds),
        hideExactAddress: bool(guards.hideExactAddress, defaults.behavior.guards.hideExactAddress),
        noPriceNegotiation: bool(guards.noPriceNegotiation, defaults.behavior.guards.noPriceNegotiation),
        noAvailabilityPromise: bool(guards.noAvailabilityPromise, defaults.behavior.guards.noAvailabilityPromise),
      },
    },
    followUp: {
      enabled: bool(followUp.enabled, defaults.followUp.enabled),
      delaysHours: delays(followUp.delaysHours, defaults.followUp.delaysHours),
      objective: str(followUp.objective, defaults.followUp.objective),
      respectBusinessHours: bool(followUp.respectBusinessHours, defaults.followUp.respectBusinessHours),
      closeConversation: bool(followUp.closeConversation, defaults.followUp.closeConversation),
      closeAfterHours: num(followUp.closeAfterHours, defaults.followUp.closeAfterHours),
      farewell: bool(followUp.farewell, defaults.followUp.farewell),
      farewellObjective: str(followUp.farewellObjective, defaults.followUp.farewellObjective),
      finalStageId: optionalId(followUp.finalStageId, defaults.followUp.finalStageId),
    },
    schedule: {
      timezone: oneOf(schedule.timezone, timezones, defaults.schedule.timezone),
      week: Object.fromEntries(WEEKDAYS.map(({ id }) => {
        const day = obj(week[id]);
        const fallback = defaults.schedule.week[id];
        return [id, { enabled: bool(day.enabled, fallback.enabled), start: time(day.start, fallback.start), end: time(day.end, fallback.end) }];
      })) as Record<Weekday, DayHours>,
      visits: {
        enabled: bool(visits.enabled, defaults.schedule.visits.enabled),
        durationMinutes: num(visits.durationMinutes, defaults.schedule.visits.durationMinutes),
        minNoticeHours: num(visits.minNoticeHours, defaults.schedule.visits.minNoticeHours),
        confirmFullName: bool(visits.confirmFullName, defaults.schedule.visits.confirmFullName),
        stageId: optionalId(visits.stageId, defaults.schedule.visits.stageId),
      },
    },
    tools: {
      imoveis: bool(tools.imoveis, defaults.tools.imoveis),
      linkPublico: bool(tools.linkPublico, defaults.tools.linkPublico),
      historico: bool(tools.historico, defaults.tools.historico),
      qualificacao: bool(tools.qualificacao, defaults.tools.qualificacao),
    },
    prompt: str(raw.prompt, defaults.prompt),
  };
}

// Primeiro formato local (campos soltos de texto). Converte só o que tem
// equivalente direto; horário e tom em texto livre voltam ao padrão.
function fromLegacy(raw: Loose): AgentSettings {
  const tools = obj(raw.tools);
  const followUp = obj(raw.followUp);
  const handoff = str(raw.handoff, '').trim();
  const savedName = str(raw.name, '').trim();
  const savedIntro = str(raw.intro, '').trim();
  const name = savedName === LEGACY_DEFAULT_NAME ? '' : savedName;
  const intro = savedIntro === LEGACY_DEFAULT_INTRO ? '' : savedIntro;

  return normalizeCurrent({
    active: raw.active,
    identity: { ...(name ? { name } : {}), ...(intro ? { intro } : {}) },
    behavior: { handoff: { other: handoff === LEGACY_DEFAULT_HANDOFF ? '' : handoff } },
    followUp: { enabled: followUp.enabled, delaysHours: followUp.delays, objective: followUp.message },
    schedule: { timezone: raw.timezone, visits: { enabled: tools.agenda } },
    tools: { imoveis: tools.imoveis, historico: tools.crm },
    prompt: raw.prompt,
  });
}

export function normalizeAgentSettings(raw: unknown): AgentSettings {
  if (!isObject(raw)) return createDefaultAgentSettings();
  return raw.version === 2 ? normalizeCurrent(raw) : fromLegacy(raw);
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

const browserStorage = () => (typeof window === 'undefined' ? undefined : window.localStorage);

export function loadAgentSettings(storage: ReadableStorage | undefined = browserStorage()): AgentSettings {
  try {
    return normalizeAgentSettings(JSON.parse(storage?.getItem(AGENT_SETTINGS_STORAGE_KEY) ?? 'null'));
  } catch {
    return createDefaultAgentSettings();
  }
}

export function saveAgentSettings(settings: AgentSettings, storage: WritableStorage | undefined = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(AGENT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
