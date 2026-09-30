import { describe, expect, it } from 'vitest';
import { scoreDiagnostic, validateAnswers, visibleQuestions, type Answers } from '../../supabase/functions/_shared/commercial-diagnostic';

const common: Answers = {
  profile: 'Corretor autônomo', sources: ['Indicação', 'WhatsApp'].filter(v => v !== 'WhatsApp'),
  acquisition: 'Gerar mais oportunidades', leads: 'Até 20', properties: 'Até 20',
  response: 'Respondemos no horário comercial', followup: 'Ainda não tenho um processo',
  tools: ['WhatsApp'], gaps: ['Poucos leads'], priority: 'Gerar mais leads', timing: 'Agora',
};

function scenario(overrides: Answers) { return { ...common, ...overrides }; }
function ids(a: Answers) { return visibleQuestions(a).map(q => q.id); }

describe('diagnóstico comercial', () => {
  it('A: autônomo com poucos leads segue aquisição sem perguntas de equipe ou anúncios', () => {
    const a = validateAnswers(common);
    expect(ids(a)).not.toContain('team');
    expect(ids(a)).not.toContain('ad_spend');
    expect(scoreDiagnostic(a).dominant_problem).toBe('DEMANDA');
  });
  it('B: autônomo com muitos leads e sem follow-up prioriza atendimento', () => {
    const a = validateAnswers(scenario({ acquisition: 'Aproveitar melhor os contatos que chegam', leads: '101–250', response: 'Às vezes demora ou fica sem resposta', followup: 'Muitos contatos ficam sem retorno', gaps: ['Demora no atendimento'], priority: 'Responder e converter melhor' }));
    expect(scoreDiagnostic(a).dominant_problem).toBe('ATENDIMENTO');
  });
  it('C: imobiliária pequena com planilhas tem etapa de equipe e dor de gestão', () => {
    const a = validateAnswers(scenario({ profile: 'Imobiliária', team: '2–5', tools: ['Planilhas', 'WhatsApp'], acquisition: 'Os dois', gaps: ['Organização de imóveis e clientes'], priority: 'Organizar a operação', decision: 'Eu decido' }));
    expect(ids(a)).toContain('team');
    expect(ids(a)).toContain('decision');
    expect(scoreDiagnostic(a).management_score).toBeGreaterThan(50);
  });
  it('D: imobiliária média com anúncios vê investimento e atendimento', () => {
    const a = validateAnswers(scenario({ profile: 'Imobiliária', team: '16–30', sources: ['Anúncios pagos', 'Instagram'], ad_spend: 'R$ 3–10 mil', acquisition: 'Aproveitar melhor os contatos que chegam', leads: '101–250', response: 'Às vezes demora ou fica sem resposta', gaps: ['Demora no atendimento'], priority: 'Responder e converter melhor', decision: 'Decido com sócios ou gestores' }));
    expect(ids(a)).toContain('ad_spend');
    expect(scoreDiagnostic(a).dominant_problem).toBe('ATENDIMENTO');
  });
  it('E: imobiliária estruturada com CRM vê pergunta sobre CRM e automação', () => {
    const a = validateAnswers(scenario({ profile: 'Imobiliária', team: 'Mais de 30', sources: ['Anúncios pagos'], ad_spend: 'Mais de R$ 10 mil', leads: 'Mais de 250', tools: ['CRM', 'Automações'], crm: 'CRM atual', gaps: ['Trabalho manual', 'Crescer sem perder qualidade'], priority: 'Automatizar tarefas', decision: 'Eu decido' }));
    expect(ids(a)).toContain('crm');
    expect(scoreDiagnostic(a).automation_score).toBeGreaterThan(60);
  });
  it('F: quem apenas pesquisa recebe encaminhamento para conhecer a plataforma', () => {
    const a = validateAnswers(scenario({ timing: 'Estou apenas pesquisando' }));
    expect(scoreDiagnostic(a).recommended_next_step).toBe('CONHECER_PLATAFORMA');
  });
  it('rejeita resposta ausente e opção forjada', () => {
    expect(() => validateAnswers({ ...common, priority: undefined })).toThrow();
    expect(() => validateAnswers({ ...common, profile: 'Administrador' })).toThrow();
  });
});
