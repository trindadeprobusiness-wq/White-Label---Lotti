/**
 * O caso que estes testes protegem: a cota controla se a IA conversa com o
 * lead — nunca se o lead é gravado. Barrar a gravação para forçar upgrade
 * destrói o contato do corretor, que é o ativo dele, e ele nem descobre que
 * perdeu. É a regra que mais fácil se quebra numa refatoração apressada.
 */
import { describe, it, expect } from 'vitest';
import {
  LIMIAR_ATENCAO,
  PRECO_LEAD_EXCEDENTE,
  statusCota,
  proporcaoCota,
  excedente,
  valorExcedente,
  podeCapturarLead,
  podeQualificarComIA,
  rotuloCota,
} from './planos';

describe('statusCota', () => {
  it('avisa antes de acabar, não depois', () => {
    // 88 de 110 é 80% — o corretor precisa saber enquanto ainda dá para agir.
    expect(statusCota({ usado: 87, limite: 110 })).toBe('ok');
    expect(statusCota({ usado: 88, limite: 110 })).toBe('atencao');
    expect(statusCota({ usado: 109, limite: 110 })).toBe('atencao');
  });

  it('estourada só a partir do limite, não antes', () => {
    expect(statusCota({ usado: 110, limite: 110 })).toBe('estourada');
    expect(statusCota({ usado: 240, limite: 110 })).toBe('estourada');
  });

  it('ilimitado nunca entra em atenção nem estoura', () => {
    expect(statusCota({ usado: 0, limite: null })).toBe('ok');
    expect(statusCota({ usado: 99999, limite: null })).toBe('ok');
  });

  it('limite zero é feature fechada, não cota vazia', () => {
    expect(statusCota({ usado: 0, limite: 0 })).toBe('estourada');
  });

  it('o limiar declarado é o que a função aplica', () => {
    expect(statusCota({ usado: Math.ceil(100 * LIMIAR_ATENCAO), limite: 100 })).toBe('atencao');
  });
});

describe('proporcaoCota', () => {
  it('devolve null no ilimitado — não há barra a encher', () => {
    expect(proporcaoCota({ usado: 500, limite: null })).toBeNull();
  });

  it('não passa de 1, para a barra não vazar do container', () => {
    expect(proporcaoCota({ usado: 300, limite: 110 })).toBe(1);
  });

  it('fração normal', () => {
    expect(proporcaoCota({ usado: 55, limite: 110 })).toBe(0.5);
  });
});

describe('excedente e cobrança', () => {
  it('dentro da cota não gera excedente', () => {
    expect(excedente({ usado: 110, limite: 110 })).toBe(0);
    expect(valorExcedente({ usado: 110, limite: 110 })).toBe(0);
  });

  it('conta só o que passou do teto', () => {
    expect(excedente({ usado: 130, limite: 110 })).toBe(20);
    expect(valorExcedente({ usado: 130, limite: 110 })).toBe(20 * PRECO_LEAD_EXCEDENTE);
  });

  it('ilimitado nunca cobra excedente', () => {
    expect(excedente({ usado: 4000, limite: null })).toBe(0);
    expect(valorExcedente({ usado: 4000, limite: null })).toBe(0);
  });

  it('o preço do excedente cobre o custo com folga', () => {
    // Custo real do lead: R$ 0,396 entre IA e template de WhatsApp.
    const custoReal = 0.396;
    expect(PRECO_LEAD_EXCEDENTE).toBeGreaterThan(custoReal);
    const margem = (PRECO_LEAD_EXCEDENTE - custoReal) / PRECO_LEAD_EXCEDENTE;
    // Precisa ficar perto da margem do plano (~75%) para crescer não diluir.
    expect(margem).toBeGreaterThan(0.7);
  });
});

describe('o que a cota pode e não pode bloquear', () => {
  it('captura de lead nunca é bloqueada, nem com a cota estourada', () => {
    expect(podeCapturarLead()).toBe(true);
  });

  it('a IA para de conversar quando a cota acaba', () => {
    expect(podeQualificarComIA({ usado: 109, limite: 110 })).toBe(true);
    expect(podeQualificarComIA({ usado: 110, limite: 110 })).toBe(false);
  });

  it('ilimitado sempre qualifica', () => {
    expect(podeQualificarComIA({ usado: 9999, limite: null })).toBe(true);
  });

  it('plano sem a feature não qualifica', () => {
    expect(podeQualificarComIA({ usado: 0, limite: 0 })).toBe(false);
  });
});

describe('rotuloCota', () => {
  it('mostra a fração quando há teto', () => {
    expect(rotuloCota({ usado: 42, limite: 110 })).toBe('42 de 110');
  });

  it('no ilimitado mostra só o consumo', () => {
    expect(rotuloCota({ usado: 42, limite: null })).toBe('42 usados');
  });
});
