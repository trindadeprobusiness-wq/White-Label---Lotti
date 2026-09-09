import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanoAssinatura } from './PlanoAssinatura';

vi.mock('@/hooks/useSubscription', () => ({
  useSubscriptionSummary: () => ({ data: null, isLoading: false }),
  useAllPlans: () => ({ data: null }),
}));

describe('hierarquia visual da assinatura', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { search: '?demo=assinatura', href: 'http://localhost/configuracoes' },
    });
  });

  it('apresenta o gerenciamento logo depois do resumo da assinatura', () => {
    const html = renderToStaticMarkup(<PlanoAssinatura />);

    expect(html.indexOf('Sua assinatura')).toBeLessThan(html.indexOf('Gerenciar assinatura'));
    expect(html.indexOf('Gerenciar assinatura')).toBeLessThan(html.indexOf('Uso do plano'));
    expect(html.indexOf('Uso do plano')).toBeLessThan(html.indexOf('Comparar e trocar de plano'));
    expect(html).not.toContain('Plano e Assinatura');
  });

  it('destaca visualmente a ação de cancelar assinatura', () => {
    const html = renderToStaticMarkup(<PlanoAssinatura />);
    const inicioBotao = html.indexOf('Cancelar assinatura');
    const classesAnteriores = html.slice(Math.max(0, inicioBotao - 500), inicioBotao);

    expect(inicioBotao).toBeGreaterThan(-1);
    expect(classesAnteriores).toContain('bg-destructive');
    expect(classesAnteriores).toContain('text-destructive-foreground');
  });

  it('não adiciona espaço extra depois dos cartões de planos', () => {
    const html = renderToStaticMarkup(<PlanoAssinatura />);

    expect(html).toContain('max-w-6xl space-y-8 pb-0');
    expect(html).not.toContain('max-w-6xl space-y-8 pb-10');
  });
});
