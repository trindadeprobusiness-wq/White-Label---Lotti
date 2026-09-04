import { describe, expect, it } from 'vitest';
import { deveBloquearCliqueDoCard } from './funilDrag';

describe('deveBloquearCliqueDoCard', () => {
  it('bloqueia a navegação enquanto o card está sendo arrastado', () => {
    expect(deveBloquearCliqueDoCard(true, false)).toBe(true);
  });

  it('bloqueia o clique sintético imediatamente após soltar o card', () => {
    expect(deveBloquearCliqueDoCard(false, true)).toBe(true);
  });

  it('permite o clique normal quando não houve arraste', () => {
    expect(deveBloquearCliqueDoCard(false, false)).toBe(false);
  });
});
