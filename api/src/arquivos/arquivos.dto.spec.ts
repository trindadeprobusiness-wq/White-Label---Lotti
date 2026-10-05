import { validarKey } from './arquivos.dto';

describe('validarKey', () => {
  it('entrega a key canônica com as barras preservadas', () => {
    expect(validarKey('a/b/c.pdf')).toBe('a/b/c.pdf');
    expect(validarKey('corretor/contratos/123_arquivo.pdf')).toBe('corretor/contratos/123_arquivo.pdf');
  });

  it.each([
    ['', 'vazia'],
    ['../etc/passwd', 'travessia ..'],
    ['a/../b', '.. no meio'],
    ['a\\b', 'barra invertida'],
    ['/inicio', 'começa com /'],
    ['a//b', 'segmento vazio'],
    ['a/./b', 'segmento .'],
  ])('recusa %p (%s)', (entrada) => {
    expect(() => validarKey(entrada)).toThrow();
  });

  it('recusa key maior que 1024 e aceita no limite', () => {
    expect(() => validarKey('a'.repeat(1025))).toThrow();
    expect(validarKey('a'.repeat(1024))).toHaveLength(1024);
  });

  it('recusa valor que não é string', () => {
    expect(() => validarKey(undefined)).toThrow();
    expect(() => validarKey(123 as unknown)).toThrow();
  });
});
