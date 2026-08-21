import { describe, expect, it } from 'vitest';
import { extrairErroDeRetornoAuth } from './retorno';

describe('retorno do Supabase Auth', () => {
  it('lê a descrição de erro da query string', () => {
    expect(extrairErroDeRetornoAuth(
      '?error=server_error&error_description=Unsupported+provider',
      '',
    )).toBe('Unsupported provider');
  });

  it('lê um erro no hash sem expor tokens', () => {
    expect(extrairErroDeRetornoAuth('', '#error=access_denied&access_token=segredo'))
      .toBe('access_denied');
  });

  it('ignora um retorno bem-sucedido', () => {
    expect(extrairErroDeRetornoAuth('', '#access_token=segredo&token_type=bearer')).toBeNull();
  });
});
