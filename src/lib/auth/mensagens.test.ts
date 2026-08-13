import { describe, it, expect } from 'vitest';
import { mensagemDeAuth } from './mensagens';

/**
 * O app só traduzia DUAS mensagens do Supabase. Todo o resto chegava em inglês
 * cru a um usuário brasileiro — inclusive as falhas mais comuns do mundo real
 * ("Email not confirmed", limite de tentativas). Estes testes travam a tradução.
 */
describe('mensagemDeAuth', () => {
  const casos: [string, string][] = [
    ['Invalid login credentials', 'E-mail ou senha incorretos. Verifique os dados e tente novamente.'],
    ['Email not confirmed', 'Confirme seu e-mail antes de entrar. Procure a mensagem que enviamos (veja também o spam).'],
    ['User already registered', 'Este e-mail já tem conta. Faça login ou use "Esqueci minha senha".'],
    ['Password should be at least 6 characters', 'A senha precisa ter pelo menos 6 caracteres.'],
    ['Email rate limit exceeded', 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.'],
  ];

  for (const [bruto, esperado] of casos) {
    it(`traduz "${bruto.slice(0, 32)}"`, () => {
      expect(mensagemDeAuth({ message: bruto })).toBe(esperado);
    });
  }

  it('casa mesmo com a mensagem dentro de um texto maior', () => {
    expect(mensagemDeAuth({ message: 'AuthApiError: Invalid login credentials (400)' }))
      .toBe('E-mail ou senha incorretos. Verifique os dados e tente novamente.');
  });

  it('a espera por segurança vira aviso com o tempo', () => {
    expect(mensagemDeAuth({ message: 'For security purposes, you can only request this after 47 seconds' }))
      .toBe('Por segurança, aguarde 47 segundos antes de tentar de novo.');
  });

  it('link de recuperação expirado é explicado', () => {
    expect(mensagemDeAuth({ message: 'Token has expired or is invalid' }))
      .toBe('Este link expirou ou já foi usado. Peça um novo e-mail de recuperação.');
  });

  it('falha de rede não vira jargão', () => {
    expect(mensagemDeAuth({ message: 'Failed to fetch' }))
      .toBe('Não conseguimos falar com o servidor. Verifique sua conexão e tente novamente.');
  });

  it('mensagem desconhecida NÃO vaza texto cru em inglês', () => {
    const r = mensagemDeAuth({ message: 'Some unmapped AuthApiError xyz' });
    expect(r).not.toContain('AuthApiError');
    expect(r).toBe('Não foi possível concluir. Tente novamente em instantes.');
  });

  it('erro nulo devolve o padrão', () => {
    expect(mensagemDeAuth(null)).toBe('Não foi possível concluir. Tente novamente em instantes.');
  });

  it('aceita string direta', () => {
    expect(mensagemDeAuth('Invalid login credentials'))
      .toBe('E-mail ou senha incorretos. Verifique os dados e tente novamente.');
  });
});
