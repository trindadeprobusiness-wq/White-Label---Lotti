import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionSummary } from '@/types/subscription';

const estado = vi.hoisted(() => ({ summary: null as unknown, plans: null as unknown }));
vi.mock('@/hooks/useSubscription', () => ({
  useSubscriptionSummary: () => ({ data: estado.summary, isLoading: false }),
  useAllPlans: () => ({ data: estado.plans }),
}));
import { PlanoAssinatura, criarAssinaturaDemonstracao } from './PlanoAssinatura';

// Teste vencido em conta antiga: imóveis, fachadas e aluguéis seguem liberados.
// "Somente leitura" seria falso — e empurraria a assinar, o que encerra a isenção.
function testeVencido(contaAntigaSemLimite: boolean): SubscriptionSummary {
  const { summary, plans } = criarAssinaturaDemonstracao('essencial');
  estado.plans = plans;
  return {
    ...summary,
    subscription: { ...summary.subscription, status: 'trialing', trial_ends_at: '2026-11-01T12:31:01Z' },
    isReadOnly: true,
    contaAntigaSemLimite,
  };
}

describe('aviso de teste vencido na página do plano', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { search: '', href: 'http://localhost/configuracoes' } });
  });

  it('conta antiga não vê "somente leitura"', () => {
    estado.summary = testeVencido(true);
    const html = renderToStaticMarkup(<PlanoAssinatura />);
    expect(html).toContain('O período de teste terminou');
    expect(html).toContain('continuam sem limite');
    expect(html).not.toContain('somente leitura');
  });

  it('conta nova continua vendo "somente leitura"', () => {
    estado.summary = testeVencido(false);
    const html = renderToStaticMarkup(<PlanoAssinatura />);
    expect(html).toContain('Sua conta está no modo somente leitura');
    expect(html).not.toContain('O período de teste terminou');
  });
});
