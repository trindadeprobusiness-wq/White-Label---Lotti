import { describe, expect, it } from 'vitest';
import { shouldShowAIChatWidget } from './appLayoutRules';

describe('visibilidade do assistente flutuante', () => {
  it('não sobrepõe páginas que já possuem experiência de conversa', () => {
    expect(shouldShowAIChatWidget('/whatsapp')).toBe(false);
    expect(shouldShowAIChatWidget('/assistente')).toBe(false);
    expect(shouldShowAIChatWidget('/clientes')).toBe(true);
  });

  it('fica fora do funil, onde o quadro ocupa a tela até a borda de baixo', () => {
    expect(shouldShowAIChatWidget('/crm')).toBe(false);
    expect(shouldShowAIChatWidget('/funil')).toBe(false);
  });

  it('fica fora da tela inicial, que já lista o que fazer agora', () => {
    expect(shouldShowAIChatWidget('/')).toBe(false);
    // A regra é a rota exata: uma rota que apenas comece com barra continua com o botão.
    expect(shouldShowAIChatWidget('/imoveis')).toBe(true);
  });
});
