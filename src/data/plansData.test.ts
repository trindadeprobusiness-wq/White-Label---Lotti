import { describe, expect, it } from 'vitest';
import { plansDisplay, planLimits } from './plansData';

describe('cards comerciais dos planos', () => {
  it('não exibe uma ação secundária para falar com especialista', () => {
    const imobiliaria = plansDisplay.find((plan) => plan.code === 'imobiliaria');

    expect(imobiliaria).not.toHaveProperty('secondaryCta');
  });

  it('preserva o catálogo mais recente publicado na main', () => {
    const limites = Object.fromEntries(planLimits.map((item) => [item.label, [item.essencial, item.profissional, item.imobiliaria]]));
    expect(limites).toMatchObject({
      'Imóveis ativos': ['250', '1.500', 'Ilimitado'],
      'Leads atendidos pela IA / mês': ['100', '250', '600'],
      'Fachadas Inteligentes': ['15', '60', 'Ilimitado'],
      'Contratos com IA / mês': ['10', '25', '40'],
    });
  });

  it('não contradiz a integração Asaas do plano Essencial', () => {
    const essencial = plansDisplay.find((plan) => plan.code === 'essencial')!;
    expect(essencial.features).toContain('100 leads atendidos pela IA / mês');
    expect(essencial.excluded).not.toContain('Integração Asaas');
  });
});
