/**
 * Porte FIEL de supabase/functions/_shared/commercial-diagnostic.ts (contrato §2.4).
 *
 * Nada do cálculo muda: perguntas, validateAnswers, scoreDiagnostic e visibleQuestions são a mesma
 * implementação, linha a linha. O teste de paridade confere que a pontuação do porte é igual à do
 * arquivo compartilhado para as mesmas respostas.
 */
export type Answers = Record<string, string | string[]>;
export type Question = {
  id: string;
  title: string;
  hint?: string;
  type: 'single' | 'multi' | 'text';
  options?: readonly string[];
  when?: (answers: Answers) => boolean;
};

export const questions: Question[] = [
  { id: 'profile', title: 'Hoje você atua como:', type: 'single', options: ['Corretor autônomo', 'Imobiliária', 'Equipe de corretores', 'Outro'] },
  { id: 'team', title: 'Quantos corretores fazem parte da operação?', type: 'single', options: ['2–5', '6–15', '16–30', 'Mais de 30'], when: a => a.profile === 'Imobiliária' || a.profile === 'Equipe de corretores' },
  { id: 'sources', title: 'De onde vêm seus clientes hoje?', hint: 'Escolha as fontes que realmente trazem contatos.', type: 'multi', options: ['Indicação', 'Instagram', 'Portais', 'Anúncios pagos', 'Site ou Google', 'Prospecção', 'Outros'] },
  { id: 'acquisition', title: 'O que mais pesa hoje?', type: 'single', options: ['Gerar mais oportunidades', 'Aproveitar melhor os contatos que chegam', 'Os dois'] },
  { id: 'leads', title: 'Quantos contatos interessados chegam por mês, aproximadamente?', type: 'single', options: ['Até 20', '21–50', '51–100', '101–250', 'Mais de 250', 'Não sei'] },
  { id: 'properties', title: 'Quantos imóveis ativos você acompanha?', type: 'single', options: ['Até 20', '21–50', '51–100', 'Mais de 100', 'Não sei'] },
  { id: 'ad_spend', title: 'Quanto investe em anúncios por mês?', type: 'single', options: ['Até R$ 1 mil', 'R$ 1–3 mil', 'R$ 3–10 mil', 'Mais de R$ 10 mil', 'Não sei'], when: a => Array.isArray(a.sources) && a.sources.includes('Anúncios pagos') },
  { id: 'response', title: 'Quando alguém chama pelo WhatsApp, o que costuma acontecer?', type: 'single', options: ['Respondemos rápido, inclusive fora do horário', 'Respondemos no horário comercial', 'Às vezes demora ou fica sem resposta', 'Não tenho clareza sobre o tempo de resposta'] },
  { id: 'followup', title: 'E depois do primeiro contato?', type: 'single', options: ['Temos acompanhamento definido', 'Cada pessoa acompanha do seu jeito', 'Muitos contatos ficam sem retorno', 'Ainda não tenho um processo'] },
  { id: 'tools', title: 'Como você organiza clientes e trabalho hoje?', hint: 'Pode marcar mais de uma opção.', type: 'multi', options: ['CRM', 'WhatsApp', 'Planilhas', 'Ferramentas separadas', 'Automações', 'Tudo na memória'] },
  { id: 'crm', title: 'Qual CRM você usa?', hint: 'Se preferir, pode deixar em branco.', type: 'text', when: a => Array.isArray(a.tools) && a.tools.includes('CRM') },
  { id: 'gaps', title: 'Quais pontos mais atrapalham sua operação?', hint: 'Escolha até três.', type: 'multi', options: ['Poucos leads', 'Demora no atendimento', 'Falta de acompanhamento', 'Organização de imóveis e clientes', 'Gestão da equipe', 'Contratos e financeiro', 'Trabalho manual', 'Crescer sem perder qualidade'] },
  { id: 'priority', title: 'Se resolvesse uma coisa primeiro, qual seria?', type: 'single', options: ['Gerar mais leads', 'Responder e converter melhor', 'Organizar a operação', 'Automatizar tarefas', 'Conseguir crescer'] },
  { id: 'timing', title: 'Quando gostaria de começar a resolver isso?', type: 'single', options: ['Agora', 'Nos próximos 30 dias', 'Nos próximos 3 meses', 'Estou apenas pesquisando'] },
  { id: 'decision', title: 'Quem participa da decisão sobre uma solução nova?', type: 'single', options: ['Eu decido', 'Decido com sócios ou gestores', 'Preciso apresentar para outra pessoa'], when: a => a.profile === 'Imobiliária' || a.profile === 'Equipe de corretores' },
];

export const visibleQuestions = (answers: Answers) => questions.filter(q => !q.when || q.when(answers));

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const has = (a: Answers, key: string, value: string) => Array.isArray(a[key]) && a[key].includes(value);

export function validateAnswers(input: unknown): Answers {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Respostas inválidas.');
  const raw = input as Record<string, unknown>;
  const result: Answers = {};
  for (const q of questions) {
    const value = raw[q.id];
    if (value === undefined || value === null || value === '') continue;
    if (q.type === 'multi') {
      if (!Array.isArray(value) || value.length > (q.id === 'gaps' ? 3 : 7) || value.some(v => typeof v !== 'string' || !q.options?.includes(v))) throw new Error('Resposta inválida.');
      result[q.id] = [...new Set(value as string[])];
    } else if (q.type === 'single') {
      if (typeof value !== 'string' || !q.options?.includes(value)) throw new Error('Resposta inválida.');
      result[q.id] = value;
    } else {
      if (typeof value !== 'string' || value.length > 80) throw new Error('Resposta inválida.');
      result[q.id] = value.trim();
    }
  }
  for (const q of visibleQuestions(result)) {
    if (q.id !== 'crm' && (!result[q.id] || (Array.isArray(result[q.id]) && result[q.id].length === 0))) throw new Error('Responda todas as etapas antes de enviar.');
  }
  for (const q of questions.filter(q => q.when && !q.when(result))) delete result[q.id];
  return result;
}

export function scoreDiagnostic(a: Answers) {
  const scores = {
    demand_score: 10, service_score: 10, automation_score: 10,
    management_score: 10, maturity_score: 20, urgency_score: 10, commercial_fit_score: 20,
  };
  if (a.acquisition === 'Gerar mais oportunidades') scores.demand_score += 40;
  if (a.acquisition === 'Aproveitar melhor os contatos que chegam') scores.service_score += 30;
  if (a.acquisition === 'Os dois') { scores.demand_score += 20; scores.service_score += 20; }
  if (a.leads === 'Até 20') scores.demand_score += 25;
  if (['101–250', 'Mais de 250'].includes(String(a.leads))) { scores.service_score += 15; scores.automation_score += 20; scores.commercial_fit_score += 15; }
  if (has(a, 'sources', 'Anúncios pagos')) { scores.maturity_score += 15; scores.commercial_fit_score += 10; }
  if (a.response === 'Às vezes demora ou fica sem resposta') scores.service_score += 35;
  if (a.response === 'Respondemos no horário comercial') scores.service_score += 15;
  if (a.response === 'Respondemos rápido, inclusive fora do horário') scores.maturity_score += 15;
  if (a.followup === 'Muitos contatos ficam sem retorno' || a.followup === 'Ainda não tenho um processo') { scores.service_score += 20; scores.automation_score += 20; }
  if (a.followup === 'Temos acompanhamento definido') scores.maturity_score += 20;
  if (has(a, 'tools', 'CRM')) scores.maturity_score += 25;
  if (has(a, 'tools', 'Automações')) scores.maturity_score += 20;
  if (has(a, 'tools', 'Planilhas') || has(a, 'tools', 'Ferramentas separadas')) { scores.management_score += 20; scores.automation_score += 15; }
  if (has(a, 'tools', 'Tudo na memória')) scores.management_score += 30;
  const gapMap: Record<string, keyof typeof scores> = {
    'Poucos leads': 'demand_score', 'Demora no atendimento': 'service_score', 'Falta de acompanhamento': 'service_score',
    'Organização de imóveis e clientes': 'management_score', 'Gestão da equipe': 'management_score',
    'Contratos e financeiro': 'management_score', 'Trabalho manual': 'automation_score', 'Crescer sem perder qualidade': 'automation_score',
  };
  for (const gap of Array.isArray(a.gaps) ? a.gaps : []) scores[gapMap[gap]] += 18;
  const priorityMap: Record<string, keyof typeof scores> = {
    'Gerar mais leads': 'demand_score', 'Responder e converter melhor': 'service_score',
    'Organizar a operação': 'management_score', 'Automatizar tarefas': 'automation_score', 'Conseguir crescer': 'automation_score',
  };
  if (priorityMap[String(a.priority)]) scores[priorityMap[String(a.priority)]] += 28;
  if (a.timing === 'Agora') scores.urgency_score += 80;
  if (a.timing === 'Nos próximos 30 dias') scores.urgency_score += 60;
  if (a.timing === 'Nos próximos 3 meses') scores.urgency_score += 35;
  if (a.profile === 'Imobiliária' || a.profile === 'Equipe de corretores') scores.commercial_fit_score += 20;
  if (a.team === '6–15' || a.team === '16–30' || a.team === 'Mais de 30') scores.commercial_fit_score += 15;
  if (a.timing === 'Agora' || a.timing === 'Nos próximos 30 dias') scores.commercial_fit_score += 20;
  if (a.profile === 'Outro') scores.commercial_fit_score -= 15;
  if (a.timing === 'Estou apenas pesquisando') scores.commercial_fit_score -= 15;
  for (const key of Object.keys(scores) as (keyof typeof scores)[]) scores[key] = clamp(scores[key]);
  const ranked: Array<[string, number]> = [['DEMANDA', scores.demand_score], ['ATENDIMENTO', scores.service_score], ['AUTOMAÇÃO', scores.automation_score], ['GESTÃO', scores.management_score]];
  ranked.sort((x, y) => y[1] - x[1]);
  const dominant_problem = ranked[0][0];
  const secondary_problems = ranked.slice(1).filter(([, n]) => n >= 45).map(([name]) => name);
  const recommended_next_step = a.timing === 'Estou apenas pesquisando' ? 'CONHECER_PLATAFORMA' : scores.commercial_fit_score >= 60 ? 'DEMONSTRACAO_LOTTI' : 'CONVERSAR_ESPECIALISTA';
  return { ...scores, dominant_problem, secondary_problems, urgency_label: scores.urgency_score >= 70 ? 'ALTA URGÊNCIA' : scores.urgency_score >= 40 ? 'MÉDIA URGÊNCIA' : 'SEM PRAZO DEFINIDO', profile_label: `${String(a.profile).toUpperCase()}${a.team ? ` — ${a.team} CORRETORES` : ''}`, recommended_next_step };
}
