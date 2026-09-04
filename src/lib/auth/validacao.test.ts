import { describe, expect, it } from 'vitest';
import { cadastroSchema, emailRecuperacaoSchema } from './validacao';

describe('validação da autenticação', () => {
  const cadastroValido = {
    nome: 'Empresa de Teste',
    email: 'contato@example.com',
    password: 'senha-segura',
    cnpj: '12.345.678/0001-95',
    telefone: '(11) 99999-9999',
  };

  it('aceita um cadastro com CNPJ válido', () => {
    expect(cadastroSchema.safeParse(cadastroValido).success).toBe(true);
  });

  it('recusa CNPJ incompleto ou com dígitos verificadores inválidos', () => {
    expect(cadastroSchema.safeParse({ ...cadastroValido, cnpj: '12.345.678/0001-00' }).success)
      .toBe(false);
    expect(cadastroSchema.safeParse({ ...cadastroValido, cnpj: '12.345' }).success)
      .toBe(false);
  });

  it('valida telefone pela quantidade real de dígitos, não pela máscara', () => {
    expect(cadastroSchema.safeParse({ ...cadastroValido, telefone: '123456789' }).success)
      .toBe(false);
    expect(cadastroSchema.safeParse({ ...cadastroValido, telefone: '1133334444' }).success)
      .toBe(true);
  });

  it('normaliza espaços do e-mail de recuperação', () => {
    expect(emailRecuperacaoSchema.parse('  pessoa@example.com  ')).toBe('pessoa@example.com');
  });
});
