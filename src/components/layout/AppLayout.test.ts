import { describe, expect, it } from 'vitest';
import { shouldShowAIChatWidget } from './appLayoutRules';

describe('visibilidade do assistente flutuante', () => {
  it('não sobrepõe páginas que já possuem experiência de conversa', () => {
    expect(shouldShowAIChatWidget('/whatsapp')).toBe(false);
    expect(shouldShowAIChatWidget('/assistente')).toBe(false);
    expect(shouldShowAIChatWidget('/clientes')).toBe(true);
  });
});
