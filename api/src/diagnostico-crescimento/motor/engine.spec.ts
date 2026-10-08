// Porte de supabase/functions/_shared/diagnostic/engine.test.ts (vitest → jest), sem mudar os casos.
import { buildSummary, getNextQuestion, getQuestions, parseContact, pruneAnswers, scoreLead, validateAnswer } from './engine';
import { QUESTIONS } from './questions';

const answerSequence = (segment: string, paid = 'no') => ({
  name: 'Ana QA', contact: 'ana@example.test', company: 'Empresa QA', segment,
  ...(segment === 'real_estate' ? { real_estate_type: 'agency' } : {}),
  revenue: '50k_100k', acquisition: ['instagram'], paid_media: paid,
  ...(paid === 'yes' ? { paid_budget: '3k_10k' } : {}),
});

describe('diagnostic declarative rule engine', () => {
  it('keeps non-real-estate branches free of real-estate questions', () => {
    for (const segment of ['saas', 'health', 'services', 'ecommerce', 'other']) {
      expect(getQuestions({ segment }).map((q) => q.id)).not.toContain('real_estate_type');
    }
    expect(getQuestions({ segment: 'saas' }).map((q) => q.id)).toEqual(expect.arrayContaining(['saas_model', 'ticket', 'cac']));
    expect(getQuestions({ segment: 'services' }).map((q) => q.id)).toEqual(expect.arrayContaining(['city', 'offer']));
  });

  it('adds the detailed estate agency qualification in deterministic order', () => {
    const ids = getQuestions(answerSequence('real_estate')).map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining([
      'real_estate_type', 'brokers', 'listings', 'lead_intake', 'lead_attribution', 'response_time', 'funnel_tracking',
    ]));
    expect(ids.indexOf('brokers')).toBeLessThan(ids.indexOf('listings'));
    expect(ids.indexOf('funnel_tracking')).toBeLessThan(ids.indexOf('bottleneck'));
    expect(getQuestions(answerSequence('real_estate')).length).toBeLessThanOrEqual(21);
  });

  it('skips conditional paid budget and selects the next unanswered core question', () => {
    expect(getQuestions({ segment: 'services', paid_media: 'no' }).map((q) => q.id)).not.toContain('paid_budget');
    expect(getQuestions({ segment: 'services', paid_media: 'yes' }).map((q) => q.id)).toContain('paid_budget');
    expect(getNextQuestion({ name: 'Ana', contact: 'ana@example.test' })?.id).toBe('company');
  });

  it('scores and summarizes locally with no external AI dependency', () => {
    const answers = {
      ...answerSequence('real_estate', 'yes'), real_estate_type: 'agency', brokers: '8',
      content: 'weekly', funnel_tracking: 'no', bottleneck: 'follow_up', goal: 'Organizar o follow-up dos leads',
      urgency: '30_days', decision: 'yes', conversation: 'yes',
    };
    expect(scoreLead(answers)).toMatchObject({ temperature: 'HOT' });
    expect(buildSummary(answers)).toMatchObject({ primary_bottleneck: 'follow_up', source: 'rules', recommended_next_step: 'strategy_call' });
    expect(buildSummary(answers).user_message).toContain('Ana');
  });

  it('invalidates answers belonging to a removed branch and validates contact', () => {
    const oldAnswers = { ...answerSequence('real_estate'), real_estate_type: 'agency', brokers: '8', listings: '100' };
    const pruned = pruneAnswers(oldAnswers, 'segment', 'services');
    expect(pruned).not.toHaveProperty('real_estate_type');
    expect(pruned).not.toHaveProperty('brokers');
    expect(parseContact('(11) 99999-9999')).toMatchObject({ phone: '+5511999999999', email: null });
    expect(() => parseContact('not-an-email')).toThrow();
  });
});

describe('validação das respostas (a mesma do servidor da Edge)', () => {
  it('limpa HTML e caracteres de controle e recusa opção fora da lista', () => {
    expect(validateAnswer(QUESTIONS.company, '  <b>Empresa</b>‮ QA  ')).toBe('Empresa QA');
    expect(() => validateAnswer(QUESTIONS.segment, 'inexistente')).toThrow('Escolha uma das opções disponíveis.');
    expect(validateAnswer(QUESTIONS.acquisition, ['google', 'referral', 'google'])).toEqual(['referral', 'google']);
    expect(validateAnswer(QUESTIONS.cac, '   ')).toBe('Não informado');
    expect(() => validateAnswer(QUESTIONS.goal, 'curto')).toThrow('pelo menos 10 caracteres');
  });

  it('o score do fluxo imobiliário completo chega a 16 (HOT)', () => {
    const r = scoreLead({
      segment: 'real_estate', real_estate_type: 'agency', brokers: '12', revenue: '100k_300k', paid_media: 'yes',
      content: 'weekly', bottleneck: 'follow_up', urgency: 'now', decision: 'yes', conversation: 'yes',
    });
    expect(r).toMatchObject({ score: 16, temperature: 'HOT' });
  });
});
