import { describe, expect, it } from 'vitest';
import { ocultarDadoSensivel } from './privacidade';

describe('ocultarDadoSensivel', () => {
  it('preserva ausência de dado e mascara texto pessoal', () => {
    expect(ocultarDadoSensivel(null, 'telefone')).toBe('—');
    expect(ocultarDadoSensivel('(62) 99999-0000', 'telefone')).toBe('••••••••');
  });

  it('mantém o contexto de um valor financeiro sem expor o número', () => {
    expect(ocultarDadoSensivel('R$ 12.500', 'valor')).toBe('R$ ••••••');
  });
});
