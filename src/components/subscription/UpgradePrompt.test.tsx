import { describe, expect, it } from 'vitest';
import { conteudoUpgrade } from './UpgradePrompt';

describe('conteudoUpgrade', () => {
  it('explica a cota atingida e recomenda o próximo plano', () => {
    expect(conteudoUpgrade({
      featureName: 'Imóveis ativos',
      used: 5,
      limit: 5,
      currentPlanName: 'Essencial',
      recommendedPlanName: 'Profissional',
    })).toEqual({
      title: 'Limite de Imóveis ativos atingido',
      description: 'Você usou 5 de 5 no plano Essencial.',
      actionLabel: 'Ver plano Profissional',
    });
  });

  it('não promete outro plano quando a maior cota já foi atingida', () => {
    expect(conteudoUpgrade({
      featureName: 'Fachadas Inteligentes',
      used: 100,
      limit: 100,
      currentPlanName: 'Imobiliária',
      recommendedPlanName: null,
    }).actionLabel).toBe('Ver opções de plano');
  });
});
