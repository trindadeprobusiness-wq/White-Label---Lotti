import { describe, expect, it } from 'vitest';
import { interpretRoutineCommandLocally } from './command';

describe('routine natural-language fallback', () => {
  it('estrutura visita, cliente, imóvel e lembrete sem executar a ação', () => {
    const proposal = interpretRoutineCommandLocally(
      'Lotti, marque uma visita com o João amanhã às 15h no imóvel do Jardim Europa e me lembre duas horas antes.',
      new Date(2026, 7, 20, 9, 0),
    );
    expect(proposal.kind).toBe('event');
    expect(proposal.activity_type).toBe('visita_imovel');
    expect(proposal.client_query).toContain('João');
    expect(proposal.property_query).toContain('Jardim Europa');
    expect(new Date(proposal.start_at!).getHours()).toBe(15);
    expect(proposal.reminder_minutes).toBe(120);
    expect(proposal.requires_confirmation).toBe(true);
    expect(proposal.missing_fields).toEqual([]);
  });

  it('pede somente os campos indispensáveis de um compromisso', () => {
    const proposal = interpretRoutineCommandLocally('Marque uma visita com a Ana');
    expect(proposal.missing_fields).toEqual(['data', 'horário']);
  });

  it('aceita tarefa com prazo no fim do dia quando não há horário', () => {
    const proposal = interpretRoutineCommandLocally(
      'Tenho que ligar para os leads novos hoje',
      new Date(2026, 7, 20, 9, 0),
    );
    expect(proposal.kind).toBe('task');
    expect(proposal.activity_type).toBe('ligacao');
    expect(new Date(proposal.due_at!).getHours()).toBe(18);
  });
});
