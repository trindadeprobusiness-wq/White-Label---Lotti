import type { Answers, Question } from './types';

const options = (items: [string, string][]) => items.map(([value, label]) => ({ value, label }));

export const SEGMENT_OPTIONS = options([
  ['real_estate', 'Mercado imobiliário'], ['construction', 'Construção / incorporação'],
  ['saas', 'SaaS / tecnologia'], ['health', 'Clínica / saúde / estética'],
  ['automotive', 'Automotivo'], ['food', 'Restaurante / alimentação'],
  ['services', 'Prestação de serviços'], ['ecommerce', 'E-commerce'], ['other', 'Outro'],
]);

export const BOTTLENECK_OPTIONS = options([
  ['acquisition', 'Falta de leads'], ['lead_quality', 'Lead desqualificado'],
  ['cost', 'Custo por lead alto'], ['content', 'Conteúdo não gera resultado'],
  ['positioning', 'Falta posicionamento'], ['service', 'Atendimento dos leads'],
  ['follow_up', 'Follow-up'], ['conversion', 'Conversão em vendas'],
  ['automation', 'Falta automação'], ['process', 'Falta organização'],
  ['unclear', 'Não sabemos exatamente onde está o problema'],
]);

/** The single source for public prompts, server validation and admin labels. */
export const QUESTIONS: Record<string, Question> = {
  name: { id: 'name', prompt: 'Fala! Antes de qualquer coisa, como posso te chamar?', type: 'text', placeholder: 'Seu nome', maxLength: 100 },
  contact: { id: 'contact', prompt: 'Qual o melhor WhatsApp para falar com você?', type: 'contact', placeholder: '(11) 99999-9999', hint: 'Você também pode informar seu e-mail.', maxLength: 254 },
  company: { id: 'company', prompt: 'Qual é o nome da sua empresa ou projeto?', type: 'text', placeholder: 'Empresa, projeto ou seu nome profissional', maxLength: 160 },
  segment: { id: 'segment', prompt: 'Qual é o seu segmento?', type: 'single', options: SEGMENT_OPTIONS },
  revenue: { id: 'revenue', prompt: 'Qual é aproximadamente o faturamento mensal da operação?', type: 'single', options: options([
    ['starting', 'Ainda estou começando'], ['up_to_20k', 'Até R$20 mil'], ['20k_50k', 'R$20 mil – R$50 mil'],
    ['50k_100k', 'R$50 mil – R$100 mil'], ['100k_300k', 'R$100 mil – R$300 mil'],
    ['300k_1m', 'R$300 mil – R$1 milhão'], ['above_1m', 'Acima de R$1 milhão'], ['private', 'Prefiro não informar'],
  ]) },
  acquisition: { id: 'acquisition', prompt: 'Hoje vocês geram clientes principalmente de onde?', type: 'multi', hint: 'Pode escolher mais de uma opção.', options: options([
    ['referral', 'Indicação'], ['instagram', 'Instagram'], ['meta_ads', 'Meta Ads'], ['google', 'Google'],
    ['outbound', 'Prospecção'], ['marketplace', 'Marketplace / portais'], ['partners', 'Parceiros'],
    ['organic', 'Conteúdo orgânico'], ['other', 'Outro'],
  ]) },
  paid_media: { id: 'paid_media', prompt: 'Vocês investem atualmente em tráfego pago?', type: 'single', options: options([['yes', 'Sim'], ['no', 'Não']]) },
  paid_budget: { id: 'paid_budget', prompt: 'Qual é a faixa de investimento mensal em tráfego pago?', type: 'single', options: options([
    ['up_to_1k', 'Até R$1.000'], ['1k_3k', 'R$1.000 – R$3.000'], ['3k_10k', 'R$3.000 – R$10.000'],
    ['10k_30k', 'R$10.000 – R$30.000'], ['above_30k', 'Acima de R$30.000'],
  ]) },
  content: { id: 'content', prompt: 'Hoje vocês produzem conteúdo com frequência?', type: 'single', options: options([
    ['rarely', 'Quase nunca'], ['monthly', '1–2 vezes por mês'], ['weekly', 'Toda semana'],
    ['frequent', 'Várias vezes por semana'], ['team', 'Temos alguém / time responsável'],
  ]) },
  bottleneck: { id: 'bottleneck', prompt: 'Qual dessas áreas mais incomoda hoje?', type: 'single', options: BOTTLENECK_OPTIONS },
  goal: { id: 'goal', prompt: 'Se você pudesse resolver UMA coisa nos próximos 90 dias, qual seria?', type: 'text', placeholder: 'Me conta o que faria mais diferença hoje…', hint: 'Pode responder com suas palavras.', maxLength: 1500 },
  urgency: { id: 'urgency', prompt: 'Hoje, qual é a urgência para resolver isso?', type: 'single', options: options([
    ['now', 'Agora'], ['30_days', 'Próximos 30 dias'], ['90_days', 'Próximos 3 meses'], ['research', 'Estou pesquisando'],
  ]) },
  decision: { id: 'decision', prompt: 'Você é quem toma a decisão sobre marketing e crescimento?', type: 'single', options: options([
    ['yes', 'Sim'], ['shared', 'Decido junto com outra pessoa'], ['no', 'Não'],
  ]) },
  conversation: { id: 'conversation', prompt: 'Se eu enxergar uma oportunidade real de melhoria, faz sentido conversarmos por alguns minutos?', type: 'single', options: options([
    ['yes', 'Sim'], ['maybe', 'Talvez'], ['no', 'Não agora'],
  ]) },
  real_estate_type: { id: 'real_estate_type', prompt: 'Hoje você atua como:', type: 'single', options: options([
    ['broker', 'Corretor autônomo'], ['agency', 'Imobiliária'], ['builder', 'Construtora'],
    ['developer', 'Incorporadora'], ['land_developer', 'Loteadora'], ['other', 'Outro'],
  ]) },
  brokers: { id: 'brokers', prompt: 'Quantos corretores aproximadamente trabalham na operação?', type: 'text', placeholder: 'Ex.: 8 corretores', maxLength: 80 },
  listings: { id: 'listings', prompt: 'Quantos imóveis ativos vocês possuem, aproximadamente?', type: 'text', placeholder: 'Ex.: 120 imóveis', maxLength: 80 },
  lead_intake: { id: 'lead_intake', prompt: 'Como os leads chegam hoje?', type: 'multi', options: options([
    ['whatsapp', 'WhatsApp'], ['crm', 'CRM'], ['portals', 'Portais'], ['instagram', 'Instagram'], ['meta_ads', 'Meta Ads'], ['other', 'Outro'],
  ]) },
  lead_attribution: { id: 'lead_attribution', prompt: 'Existe acompanhamento de onde cada lead veio?', type: 'single', options: options([
    ['yes', 'Sim, registramos a origem'], ['partial', 'Às vezes / parcialmente'], ['no', 'Não acompanhamos'],
  ]) },
  response_time: { id: 'response_time', prompt: 'Quanto tempo normalmente levam para responder um novo lead?', type: 'single', options: options([
    ['5_minutes', 'Até 5 minutos'], ['1_hour', 'Até 1 hora'], ['same_day', 'No mesmo dia'], ['next_day', 'No dia seguinte ou depois'], ['unknown', 'Não sabemos'],
  ]) },
  funnel_tracking: { id: 'funnel_tracking', prompt: 'Vocês sabem quantos leads viram visita, proposta e venda?', type: 'single', options: options([
    ['yes', 'Sim, acompanhamos cada etapa'], ['partial', 'Temos uma noção, mas falta controle'], ['no', 'Não acompanhamos'],
  ]) },
  saas_model: { id: 'saas_model', prompt: 'Seu produto atende principalmente empresas ou pessoas físicas?', type: 'single', options: options([
    ['b2b', 'B2B — empresas'], ['b2c', 'B2C — pessoas físicas'], ['both', 'Os dois'],
  ]) },
  ticket: { id: 'ticket', prompt: 'Qual é o ticket médio mensal por cliente?', type: 'text', placeholder: 'Ex.: R$350 por mês', hint: 'Uma estimativa já ajuda. Se ainda não souber, escreva “não sei”.', maxLength: 120 },
  cac: { id: 'cac', prompt: 'Vocês sabem quanto custa, em média, conquistar um cliente (CAC)?', type: 'text', placeholder: 'Ex.: R$500 ou “não sei”', hint: 'Se ainda não acompanha, pode pular.', optional: true, maxLength: 120 },
  city: { id: 'city', prompt: 'Em qual cidade ou região você atende?', type: 'text', placeholder: 'Cidade / estado ou região atendida', maxLength: 160 },
  offer: { id: 'offer', prompt: 'Qual é o principal serviço ou produto da operação?', type: 'text', placeholder: 'O que vocês oferecem hoje?', maxLength: 300 },
};

export const isRealEstate = (answers: Answers) => ['real_estate', 'construction'].includes(String(answers.segment ?? ''));
export const isLocalBusiness = (answers: Answers) => ['health', 'automotive', 'food', 'services'].includes(String(answers.segment ?? ''));

export function segmentLabel(value: string): string {
  return SEGMENT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function getQuestion(id: string): Question | undefined {
  return QUESTIONS[id];
}

/** General: 13–14; local: 14–15; SaaS: 15; real estate: 18–21.
 * The detailed real-estate branch intentionally exceeds the usual limit to
 * retain the requested lead operations audit. AI follow-ups are bounded separately.
 */
export function getQuestions(answers: Answers): Question[] {
  const ids = ['name', 'contact', 'company', 'segment'];
  if (isRealEstate(answers)) {
    ids.push('real_estate_type');
    if (answers.real_estate_type === 'agency') ids.push('brokers', 'listings');
  } else if (answers.segment === 'saas') {
    ids.push('saas_model', 'ticket');
  } else if (isLocalBusiness(answers)) {
    ids.push('city', 'offer');
  }
  ids.push('revenue', 'acquisition', 'paid_media');
  // SaaS replaces budget/content questions with ticket and CAC to stay at 15.
  if (answers.paid_media === 'yes' && answers.segment !== 'saas') ids.push('paid_budget');
  if (answers.segment === 'saas') ids.push('cac');
  if (answers.segment !== 'saas' && !isLocalBusiness(answers)) ids.push('content');
  if (isRealEstate(answers)) ids.push('lead_intake', 'lead_attribution', 'response_time', 'funnel_tracking');
  ids.push('bottleneck', 'goal', 'urgency', 'decision', 'conversation');
  return ids.map((id) => {
    const question = QUESTIONS[id];
    if (id === 'contact' && typeof answers.name === 'string') {
      const firstName = answers.name.split(' ')[0];
      return { ...question, prompt: `Prazer, ${firstName}. Qual o melhor WhatsApp para falar com você?` };
    }
    if (id === 'revenue' && answers.segment === 'saas') {
      return { ...question, prompt: 'Qual é a receita recorrente mensal (MRR) aproximada do produto?' };
    }
    if (id === 'bottleneck' && isRealEstate(answers)) {
      return { ...question, prompt: 'O principal gargalo hoje está mais perto de:', options: options([
        ['acquisition', 'Gerar demanda'], ['content', 'Criativo / conteúdo'], ['lead_quality', 'Qualidade do lead'],
        ['service', 'Atendimento'], ['follow_up', 'Follow-up'], ['process', 'Gestão do lead'],
        ['conversion', 'Conversão'], ['positioning', 'Posicionamento'], ['unclear', 'Não sabemos'],
      ]) };
    }
    return question;
  });
}
