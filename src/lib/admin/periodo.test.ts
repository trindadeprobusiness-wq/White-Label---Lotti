/**
 * Dois bugs que estes testes travam:
 *
 * 1. Fuso. `new Date().toISOString().slice(0,10)` devolve o dia seguinte para
 *    quem está em UTC-3 depois das 21h — o filtro "últimos 7 dias" passaria a
 *    incluir amanhã e excluir hoje.
 * 2. Variação sobre zero. Sair de 0 para 5 cadastros não é "+500%". Sem base de
 *    comparação a resposta certa é "não dá para comparar", não um número.
 *
 * A data de "hoje" é sempre injetada, nunca mockada — mesmo padrão de
 * tarefaAtrasada() em lib/crm/pipeline.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  paraISO,
  deISO,
  somarDias,
  diasNoPeriodo,
  periodoDeAtalho,
  periodoAnterior,
  variacao,
  periodoValido,
} from './periodo';

// 14/08/2026, 23h — hora que faria toISOString() virar o dia em qualquer fuso
// negativo. É de propósito.
const hoje = new Date(2026, 7, 14, 23, 30);

describe('paraISO', () => {
  it('usa o calendário local, não UTC', () => {
    expect(paraISO(hoje)).toBe('2026-08-14');
  });

  it('preenche mês e dia com zero à esquerda', () => {
    expect(paraISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('ida e volta preserva a data', () => {
    expect(paraISO(deISO('2028-02-29'))).toBe('2028-02-29'); // 2028 é bissexto
  });
});

describe('somarDias', () => {
  it('atravessa a virada de mês', () => {
    expect(somarDias('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('atravessa a virada de ano para trás', () => {
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('diasNoPeriodo', () => {
  it('conta as duas pontas — um único dia é 1, não 0', () => {
    expect(diasNoPeriodo({ inicio: '2026-08-14', fim: '2026-08-14' })).toBe(1);
  });

  it('agosto inteiro dá 31', () => {
    expect(diasNoPeriodo({ inicio: '2026-08-01', fim: '2026-08-31' })).toBe(31);
  });
});

describe('periodoDeAtalho', () => {
  it('"últimos 7 dias" inclui hoje e soma 7 dias', () => {
    const p = periodoDeAtalho('7d', hoje);
    expect(p).toEqual({ inicio: '2026-08-08', fim: '2026-08-14' });
    expect(diasNoPeriodo(p)).toBe(7);
  });

  it('"mês atual" começa no dia 1 e termina hoje', () => {
    expect(periodoDeAtalho('mes_atual', hoje)).toEqual({
      inicio: '2026-08-01',
      fim: '2026-08-14',
    });
  });

  it('"mês anterior" pega o mês fechado, com o último dia correto', () => {
    expect(periodoDeAtalho('mes_anterior', hoje)).toEqual({
      inicio: '2026-07-01',
      fim: '2026-07-31',
    });
  });

  it('mês anterior a março acerta fevereiro bissexto', () => {
    expect(periodoDeAtalho('mes_anterior', new Date(2028, 2, 10))).toEqual({
      inicio: '2028-02-01',
      fim: '2028-02-29',
    });
  });

  it('e acerta fevereiro comum também', () => {
    expect(periodoDeAtalho('mes_anterior', new Date(2026, 2, 10))).toEqual({
      inicio: '2026-02-01',
      fim: '2026-02-28',
    });
  });

  it('mês anterior a janeiro volta para dezembro do ano passado', () => {
    expect(periodoDeAtalho('mes_anterior', new Date(2026, 0, 15))).toEqual({
      inicio: '2025-12-01',
      fim: '2025-12-31',
    });
  });
});

describe('periodoAnterior', () => {
  it('devolve janela de mesma duração, colada antes', () => {
    const atual = { inicio: '2026-08-01', fim: '2026-08-31' };
    const anterior = periodoAnterior(atual);
    expect(anterior).toEqual({ inicio: '2026-07-01', fim: '2026-07-31' });
    expect(diasNoPeriodo(anterior)).toBe(diasNoPeriodo(atual));
  });

  it('intervalo arbitrário mantém a duração, não o nome do mês', () => {
    // 10 dias em agosto comparam com os 10 dias anteriores, não com julho.
    const atual = { inicio: '2026-08-10', fim: '2026-08-19' };
    const anterior = periodoAnterior(atual);
    expect(anterior).toEqual({ inicio: '2026-07-31', fim: '2026-08-09' });
    expect(diasNoPeriodo(anterior)).toBe(10);
  });

  it('não deixa buraco nem sobreposição entre as janelas', () => {
    const atual = { inicio: '2026-08-01', fim: '2026-08-07' };
    expect(somarDias(periodoAnterior(atual).fim, 1)).toBe(atual.inicio);
  });
});

describe('variacao', () => {
  it('calcula o crescimento percentual', () => {
    expect(variacao(150, 100)).toBe(50);
    expect(variacao(50, 100)).toBe(-50);
  });

  it('sem base de comparação devolve null, não um número inventado', () => {
    // O teste central deste arquivo.
    expect(variacao(5, 0)).toBeNull();
    expect(variacao(0, 0)).toBeNull();
  });

  it('queda a zero é -100%, que é comparação legítima', () => {
    expect(variacao(0, 40)).toBe(-100);
  });

  it('valor inválido não vira NaN na tela', () => {
    expect(variacao(NaN, 10)).toBeNull();
    expect(variacao(10, Infinity)).toBeNull();
  });
});

describe('periodoValido', () => {
  it('aceita período bem formado, inclusive de um dia só', () => {
    expect(periodoValido({ inicio: '2026-08-01', fim: '2026-08-31' })).toBe(true);
    expect(periodoValido({ inicio: '2026-08-01', fim: '2026-08-01' })).toBe(true);
  });

  it('recusa início depois do fim', () => {
    expect(periodoValido({ inicio: '2026-08-31', fim: '2026-08-01' })).toBe(false);
  });

  it('recusa formato fora de YYYY-MM-DD', () => {
    expect(periodoValido({ inicio: '01/08/2026', fim: '2026-08-31' })).toBe(false);
    expect(periodoValido({ inicio: '', fim: '' })).toBe(false);
  });
});
