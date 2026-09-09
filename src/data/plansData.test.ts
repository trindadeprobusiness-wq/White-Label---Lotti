import { describe, expect, it } from 'vitest';
import { plansDisplay, planLimits } from './plansData';

describe('cards comerciais dos planos', () => {
  it('não exibe uma ação secundária para falar com especialista', () => {
    const imobiliaria = plansDisplay.find((plan) => plan.code === 'imobiliaria');

    expect(imobiliaria).not.toHaveProperty('secondaryCta');
  });

  it('mantém os quatro limites iguais aos cards publicados', () => {
    const limites = Object.fromEntries(planLimits.map((item) => [item.label, [item.essencial, item.profissional, item.imobiliaria]]));
    expect(limites).toMatchObject({
      'Imóveis ativos': ['5', '20', '100'],
      'Contratos de aluguel ativos': ['5', '15', '100'],
      'Fachadas Inteligentes': ['5', '20', '100'],
      'Operações com IA / mês': ['10', '20', '60'],
    });
  });

  it('não contradiz a integração Asaas do plano Essencial', () => {
    const essencial = plansDisplay.find((plan) => plan.code === 'essencial')!;
    expect(essencial.features).toContain('Integração com Asaas');
    expect(essencial.excluded).not.toContain('Integração Asaas');
  });
});
