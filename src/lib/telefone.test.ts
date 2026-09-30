import { describe, expect, it } from 'vitest';
import { documentoParaSalvar, normalizarTelefoneBR, primeiroTelefoneBR } from './telefone';

describe('normalizarTelefoneBR', () => {
  it('aceita celular e fixo com ou sem código do país', () => {
    expect(normalizarTelefoneBR('5562911110002')).toEqual({ digitos: '62911110002', formatado: '(62) 91111-0002' });
    expect(normalizarTelefoneBR('(62) 3333-4444')).toEqual({ digitos: '6233334444', formatado: '(62) 3333-4444' });
  });
  it('recusa o que não é telefone brasileiro utilizável', () => {
    expect(normalizarTelefoneBR('não informado').digitos).toBeNull();
    expect(normalizarTelefoneBR('(20) 99999-8888').digitos).toBeNull();
  });
});

describe('primeiroTelefoneBR', () => {
  it('pega o primeiro número de uma lista lida do contrato', () => {
    expect(primeiroTelefoneBR('(62) 91111-0002 / (62) 3333-4444')).toBe('(62) 91111-0002');
    expect(primeiroTelefoneBR('fixo (62) 3333-4444, celular (62) 91111-0002')).toBe('(62) 3333-4444');
  });
  it('aceita +55, dígitos corridos e texto em volta', () => {
    expect(primeiroTelefoneBR('+55 62 91111-0002')).toBe('(62) 91111-0002');
    expect(primeiroTelefoneBR('Tel.: 62911110002')).toBe('(62) 91111-0002');
  });
  it('pula o que não é telefone válido, como um CPF', () => {
    expect(primeiroTelefoneBR('CPF 123.456.789-00; telefone (62) 91111-0002')).toBe('(62) 91111-0002');
  });
  it('texto sem telefone dá vazio', () => {
    expect(primeiroTelefoneBR('não informado')).toBe('');
    expect(primeiroTelefoneBR('')).toBe('');
    expect(primeiroTelefoneBR(null)).toBe('');
  });
});

describe('documentoParaSalvar', () => {
  it('guarda CPF e CNPJ completos só com dígitos', () => {
    expect(documentoParaSalvar('123.456.789-09')).toBe('12345678909');
    expect(documentoParaSalvar('12.345.678/0001-95')).toBe('12345678000195');
  });
  it('mantém o que veio incompleto para o corretor corrigir, e vazio vira nulo', () => {
    expect(documentoParaSalvar(' 123.456 ')).toBe('123.456');
    expect(documentoParaSalvar('  ')).toBeNull();
    expect(documentoParaSalvar(undefined)).toBeNull();
  });
});
