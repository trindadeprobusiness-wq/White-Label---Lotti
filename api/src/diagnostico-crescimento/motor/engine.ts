import { BOTTLENECKS } from './types';
import type { Answers, AnswerValue, Bottleneck, DiagnosticSummary, LeadScore, Question } from './types';
import { getQuestions, segmentLabel } from './questions';

export { getQuestion, getQuestions, segmentLabel } from './questions';
export type { Answers, AnswerValue, DiagnosticSummary, LeadScore, Question } from './types';

const cleanText = (value: string) => value.normalize('NFKC')
  .replace(/<[^>]*>/g, '')
  // Strip control and bidi characters from visitor-entered text.
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function parseContact(value: string): { phone: string | null; email: string | null } {
  const normalized = value.trim();
  if (normalized.includes('@')) {
    const validEmail = /^[a-z0-9.!#$%&'*+/?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
    const [local, domain] = normalized.split('@');
    if (normalized.length > 254 || !validEmail.test(normalized) || local.length > 64
      || local.startsWith('.') || local.endsWith('.') || local.includes('..')
      || domain.split('.').at(-1)!.length < 2) {
      throw new Error('Confira seu e-mail. Exemplo: voce@empresa.com.br');
    }
    return { email: normalized.toLowerCase(), phone: null };
  }
  if (!/^\+?[\d\s().-]+$/.test(normalized)) {
    throw new Error('Informe um WhatsApp com DDD ou um e-mail válido.');
  }
  let digits = normalized.replace(/\D/g, '');
  if (/^(\d)\1+$/.test(digits)) throw new Error('Confira seu WhatsApp, incluindo o DDD.');
  if (!normalized.startsWith('+') && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  const brazilian = digits.startsWith('55');
  if (brazilian && (![12, 13].includes(digits.length) || Number(digits.slice(2, 4)) < 11
    || Number(digits.slice(2, 4)) > 99 || !/^[2-9]/.test(digits.slice(4))
    || (digits.length === 13 && digits[4] !== '9'))) {
    throw new Error('Confira seu WhatsApp, incluindo o DDD.');
  }
  if (!brazilian && (!normalized.startsWith('+') || digits.length < 8 || digits.length > 15 || digits[0] === '0')) {
    throw new Error('Informe o DDD ou use +código do país para um número internacional.');
  }
  return { phone: `+${digits}`, email: null };
}

export function hasRecoverableContact(answers: Answers): boolean {
  if (typeof answers.contact !== 'string') return false;
  try {
    const contact = parseContact(answers.contact);
    return Boolean(contact.email || (contact.phone && typeof answers.name === 'string' && answers.name.trim().length >= 2));
  } catch {
    return false;
  }
}

export function validateAnswer(question: Question, value: unknown): AnswerValue {
  if (question.type === 'multi') {
    if (!Array.isArray(value) || !value.length || value.length > (question.options?.length ?? 0)
      || value.some((entry) => typeof entry !== 'string')) {
      throw new Error('Escolha pelo menos uma opção para continuar.');
    }
    const selected = [...new Set(value as string[])];
    if (selected.some((entry) => !question.options?.some((option) => option.value === entry))) {
      throw new Error('Escolha uma das opções disponíveis.');
    }
    // Stable configuration order makes retries and comparisons deterministic.
    return question.options!.filter((option) => selected.includes(option.value)).map((option) => option.value);
  }
  if (typeof value !== 'string') throw new Error('Envie uma resposta em texto.');
  const maxLength = question.maxLength ?? 1500;
  if (value.length > maxLength) throw new Error(`Use no máximo ${maxLength} caracteres.`);
  const answer = cleanText(value);
  if (!answer) {
    if (question.optional) return 'Não informado';
    throw new Error('Preencha esta resposta para continuar.');
  }
  if (question.type === 'single') {
    if (!question.options?.some((option) => option.value === answer)) throw new Error('Escolha uma das opções disponíveis.');
    return answer;
  }
  if (question.type === 'contact') {
    const contact = parseContact(answer);
    return contact.email ?? contact.phone!;
  }
  if (question.id === 'name' && (answer.length < 2 || !/\p{L}/u.test(answer))) {
    throw new Error('Me conta seu nome para continuarmos.');
  }
  if (question.id === 'goal' && answer.length < 10) throw new Error('Me conta um pouco mais, em pelo menos 10 caracteres.');
  if (['company', 'city', 'offer'].includes(question.id) && answer.length < 2) {
    throw new Error('Use pelo menos 2 caracteres nesta resposta.');
  }
  return answer;
}

const hasAnswer = (value: AnswerValue | undefined) => typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) && value.length > 0;

export function getNextQuestion(answers: Answers): Question | null {
  return getQuestions(answers).find((question) => !hasAnswer(answers[question.id])) ?? null;
}

/** An edit invalidates all later answers, including answers on a removed branch. */
export function pruneAnswers(answers: Answers, questionId: string, value: unknown): Answers {
  const questions = getQuestions(answers);
  const index = questions.findIndex((question) => question.id === questionId);
  if (index < 0) throw new Error('Esta pergunta não faz parte do seu diagnóstico.');
  const pruned: Answers = {};
  for (const question of questions.slice(0, index)) {
    if (!hasAnswer(answers[question.id])) throw new Error('Responda primeiro a pergunta anterior.');
    pruned[question.id] = answers[question.id];
  }
  pruned[questionId] = validateAnswer(questions[index], value);
  return pruned;
}

export function formatAnswer(question: Question, value: AnswerValue): string {
  const label = (entry: string) => question.options?.find((option) => option.value === entry)?.label ?? entry;
  return Array.isArray(value) ? value.map(label).join(', ') : label(value);
}

const textAnswer = (answers: Answers, id: string) => typeof answers[id] === 'string' ? answers[id] as string : '';
const numericAnswer = (answers: Answers, id: string) => Number.parseInt(textAnswer(answers, id).replace(/[^\d]/g, ''), 10) || 0;
const highRevenue = (answers: Answers) => ['50k_100k', '100k_300k', '300k_1m', 'above_1m'].includes(textAnswer(answers, 'revenue'));

export function scoreLead(answers: Answers): LeadScore {
  let score = 0;
  const signals: string[] = [];
  const add = (condition: boolean, points: number, signal: string) => {
    if (condition) { score += points; signals.push(signal); }
  };
  add(answers.paid_media === 'yes', 3, 'Investe em mídia paga');
  add(highRevenue(answers), 3, 'Receita mensal na faixa de R$50 mil ou superior');
  add(['now', '30_days'].includes(textAnswer(answers, 'urgency')), 2, 'Urgência de até 30 dias');
  add(['yes', 'shared'].includes(textAnswer(answers, 'decision')), 2, 'Participa da decisão');
  add(BOTTLENECKS.includes(answers.bottleneck as Bottleneck) && answers.bottleneck !== 'unclear', 2, 'Gargalo identificado');
  add(answers.conversation === 'yes', 2, 'Aberto a uma conversa');
  add(['weekly', 'frequent', 'team'].includes(textAnswer(answers, 'content')), 1, 'Conteúdo recorrente');
  const intake = Array.isArray(answers.lead_intake) ? answers.lead_intake : [];
  const structured = answers.content === 'team' || intake.includes('crm') || answers.funnel_tracking === 'yes'
    || (answers.real_estate_type === 'agency' && numericAnswer(answers, 'brokers') >= 2)
    || (answers.segment === 'saas' && !['', 'starting', 'private'].includes(textAnswer(answers, 'revenue')));
  add(structured, 1, 'Sinais de operação estruturada');
  return { score, temperature: score >= 11 ? 'HOT' : score >= 6 ? 'WARM' : 'COLD', signals };
}

export const BOTTLENECK_LABELS: Record<Bottleneck, string> = {
  acquisition: 'geração de demanda', lead_quality: 'qualidade dos leads', cost: 'eficiência da mídia paga',
  content: 'conteúdo e criativos', positioning: 'posicionamento', service: 'atendimento dos leads',
  follow_up: 'acompanhamento dos leads', conversion: 'conversão em vendas', automation: 'automação',
  process: 'organização do processo comercial', unclear: 'identificação do principal gargalo',
};

const NEXT_ACTIONS: Record<Bottleneck, string> = {
  acquisition: 'revisar os canais de aquisição e a oferta antes de ampliar os esforços de divulgação',
  lead_quality: 'revisar a mensagem dos anúncios, a oferta e os critérios de qualificação dos contatos',
  cost: 'analisar criativos, segmentação e o caminho do primeiro contato até a venda',
  content: 'conectar os temas e criativos a uma oferta clara e a um próximo passo mensurável',
  positioning: 'esclarecer público, proposta de valor e diferenciais na comunicação',
  service: 'mapear o tempo de resposta e a passagem do contato para o atendimento',
  follow_up: 'organizar uma rotina de retorno e acompanhamento de cada oportunidade',
  conversion: 'mapear as etapas comerciais para entender onde as oportunidades deixam de avançar',
  automation: 'mapear tarefas repetitivas e priorizar uma automação simples com impacto na rotina',
  process: 'organizar etapas, responsáveis e registros antes de adicionar novas ferramentas',
  unclear: 'mapear a jornada entre o primeiro contato e a venda para localizar as maiores perdas',
};

function inferBottleneck(answers: Answers): Bottleneck {
  if (BOTTLENECKS.includes(answers.bottleneck as Bottleneck) && answers.bottleneck !== 'unclear') return answers.bottleneck as Bottleneck;
  const goal = textAnswer(answers, 'goal').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const rules: [RegExp, Bottleneck][] = [
    [/follow.?up|acompanha|retomar|retorno/, 'follow_up'], [/automat|repetitiv/, 'automation'],
    [/atend|respost|responder/, 'service'], [/desqualific|qualidade.*lead|lead.*qualific/, 'lead_quality'],
    [/conteudo|criativo|video/, 'content'], [/posicion|marca|diferencia/, 'positioning'],
    [/custo|caro|cac/, 'cost'], [/conver|fechar|venda/, 'conversion'],
    [/leads|demanda|captar|aquisicao/, 'acquisition'], [/organiz|processo|crm/, 'process'],
  ];
  return rules.find(([pattern]) => pattern.test(goal))?.[1] ?? 'unclear';
}

/** Always available, including when AI times out, is disabled or exceeds budget. */
export function buildSummary(answers: Answers): DiagnosticSummary {
  const primary = inferBottleneck(answers);
  let secondary: Bottleneck | null = null;
  if (['same_day', 'next_day'].includes(textAnswer(answers, 'response_time'))) secondary = 'service';
  else if (['partial', 'no'].includes(textAnswer(answers, 'funnel_tracking'))) secondary = 'follow_up';
  else if (answers.lead_attribution === 'no') secondary = 'process';
  else if (answers.content === 'rarely' && ['acquisition', 'positioning'].includes(primary)) secondary = 'content';
  else if (answers.paid_media === 'yes' && primary === 'lead_quality') secondary = 'conversion';
  if (secondary === primary) secondary = null;
  const name = textAnswer(answers, 'name').split(' ')[0] || 'Tudo certo';
  const company = textAnswer(answers, 'company') || 'A operação';
  const segment = segmentLabel(textAnswer(answers, 'segment')) || 'segmento não informado';
  const focus = `${BOTTLENECK_LABELS[primary]}${secondary ? ` e ${BOTTLENECK_LABELS[secondary]}` : ''}`;
  const urgencyQuestion = getQuestions(answers).find((question) => question.id === 'urgency')!;
  const urgency = answers.urgency ? formatAnswer(urgencyQuestion, answers.urgency) : 'não informada';
  const goal = textAnswer(answers, 'goal');
  const summary = `${company} atua em ${segment}. O diagnóstico aponta atenção a ${focus}.`
    + (goal ? ` Objetivo declarado: ${goal}` : '')
    + ` Urgência: ${urgency}. Próximo passo sugerido: ${NEXT_ACTIONS[primary]}.`;
  const invitation = answers.conversation === 'no'
    ? 'Seu diagnóstico está salvo. Você pode retomar a conversa quando fizer sentido para você.'
    : 'Vou analisar suas respostas com mais profundidade para entender o próximo passo mais útil para a sua operação.';
  return {
    summary,
    primary_bottleneck: primary,
    secondary_bottleneck: secondary,
    recommended_next_step: answers.conversation === 'yes' ? 'strategy_call' : answers.conversation === 'maybe' ? 'send_diagnostic' : 'nurture',
    user_message: `${name}, pelo que você me contou, o principal ponto de atenção parece estar em ${focus}. Um bom primeiro passo é ${NEXT_ACTIONS[primary]}. ${invitation}`,
    source: 'rules',
  };
}
