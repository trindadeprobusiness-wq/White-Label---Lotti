import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(),
  });
});
import { acaoEntrePlanos, cotasIncompativeis } from '@/lib/planos';
import type { PlanWithEntitlements, UsageSummary } from '@/types/subscription';
import { criarAssinaturaDemonstracao } from './PlanoAssinatura';

const plano = (id: string, ordem: number, limite: number): PlanWithEntitlements => ({
  id,
  code: ordem === 1 ? 'essencial' : ordem === 2 ? 'profissional' : 'imobiliaria',
  name: id,
  description: '', monthly_price: 0, annual_price: 0, active: true,
  highlighted: false, display_order: ordem, trial_days: 0, created_at: '', updated_at: '',
  entitlements: [{
    id: `${id}-imoveis`, plan_id: id, feature_key: 'max_imoveis',
    feature_name: 'Imóveis ativos', category: 'imoveis', enabled: true,
    limit_value: limite, unlimited: false, display_order: 1, created_at: '', updated_at: '',
  }],
});

describe('ações entre planos', () => {
  it('distingue upgrade, downgrade e plano atual pela ordem comercial', () => {
    expect(acaoEntrePlanos(plano('Atual', 1, 5), plano('Pro', 2, 20))).toBe('upgrade');
    expect(acaoEntrePlanos(plano('Atual', 2, 20), plano('Básico', 1, 5))).toBe('downgrade');
    expect(acaoEntrePlanos(plano('Atual', 2, 20), plano('Atual', 2, 20))).toBe('current');
  });

  it('impede downgrade que não comporta o consumo atual', () => {
    const uso: UsageSummary[] = [{
      feature_key: 'max_imoveis', feature_name: 'Imóveis ativos', used: 6,
      limit: 20, unlimited: false, ratio: 0.3, status: 'ok',
    }];
    expect(cotasIncompativeis(plano('Básico', 1, 5), uso)).toEqual(['Imóveis ativos']);
  });

  it('permite visualizar uma assinatura Profissional com opção de downgrade', () => {
    const demo = criarAssinaturaDemonstracao('profissional');
    const essencial = demo.plans.find((item) => item.code === 'essencial')!;

    expect(demo.summary.plan.code).toBe('profissional');
    expect(acaoEntrePlanos(demo.summary.plan, essencial)).toBe('downgrade');
  });
});
