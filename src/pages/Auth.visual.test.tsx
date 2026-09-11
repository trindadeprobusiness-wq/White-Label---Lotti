import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Auth from './Auth';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp: vi.fn(),
    isAuthenticated: false,
    loading: false,
  }),
}));

vi.mock('@/lib/admin/atribuicao', () => ({
  nomeParceiroIndicador: () => null,
}));

describe('tela de autenticação', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => ''),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it('mantém o login em uma viewport e não oferece autenticação social', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/auth">
        <Auth />
      </StaticRouter>,
    );

    expect(html).toContain('min-h-dvh');
    expect(html).toContain('lg:h-dvh');
    expect(html).toContain('lg:overflow-hidden');
    expect(html).not.toContain('ou continue com');
    expect(html).not.toContain('>Google<');
  });

  it('usa título preto e verde e mantém a frase sem travessão', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/auth">
        <Auth />
      </StaticRouter>,
    );

    expect(html).toContain('Mais organização.');
    expect(html).toContain('Mais controle.');
    expect(html).toContain('Mais vendas.');
    expect(html.match(/bg-gradient-to-r/g)).toHaveLength(2);
    expect(html.match(/from-\[#093323\]/g)).toHaveLength(2);
    expect(html.match(/to-\[#000000\]/g)).toHaveLength(2);
    expect(html.match(/bg-clip-text/g)).toHaveLength(2);
    expect(html.match(/text-transparent/g)).toHaveLength(2);
    expect(html).toContain('text-2xl');
    expect(html).toContain('xl:text-3xl');
    expect(html).not.toContain('xl:text-4xl');
    expect(html).toContain('num lugar só com a IA');
    expect(html).not.toContain('lugar só — com a IA');
    expect(html).not.toContain('Acesso administrativo');
  });

  it('oferece acesso público aos termos e à política de privacidade', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/auth">
        <Auth />
      </StaticRouter>,
    );

    expect(html).toContain('href="/termos-de-uso"');
    expect(html).toContain('href="/politica-de-privacidade"');
  });

  it('não oferece cadastro gratuito — o registro acontece via checkout', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/auth">
        <Auth />
      </StaticRouter>,
    );

    // Sem aba de cadastro
    expect(html).not.toContain('>Cadastrar<');
    expect(html).not.toContain('Crie sua conta');
    expect(html).not.toContain('Criar Conta');
    expect(html).not.toContain('signup-nome');
    expect(html).not.toContain('signup-cnpj');

    // Login e recuperação de senha continuam presentes
    expect(html).toContain('Bem-vindo de volta!');
    expect(html).toContain('Esqueci minha senha');
    expect(html).toContain('href="/recuperar-senha"');
  });
});
