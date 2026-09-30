import { describe, expect, it } from 'vitest';
import { linkDoInbox, mesmoTelefone, somenteDigitos } from './deepLink';

describe('link do Inbox por telefone', () => {
  it('monta o link com só os dígitos', () => {
    expect(linkDoInbox('(62) 99999-9999')).toBe('/whatsapp?telefone=62999999999');
  });

  it('cai no Inbox sem filtro quando não há telefone', () => {
    expect(linkDoInbox('')).toBe('/whatsapp');
    expect(linkDoInbox(null)).toBe('/whatsapp');
  });

  it('reconhece o mesmo número escrito de formas diferentes', () => {
    expect(mesmoTelefone('5562999999999', '(62) 99999-9999')).toBe(true);
    expect(mesmoTelefone('+55 62 99999-9999', '62999999999')).toBe(true);
  });

  it('não confunde números diferentes', () => {
    expect(mesmoTelefone('62999999999', '62988888888')).toBe(false);
  });

  it('não arrisca palpite com número curto demais', () => {
    // Sete dígitos entrariam em conflito com qualquer número da mesma cidade.
    expect(mesmoTelefone('9999999', '9999999')).toBe(false);
    expect(somenteDigitos('abc')).toBe('');
  });
});
