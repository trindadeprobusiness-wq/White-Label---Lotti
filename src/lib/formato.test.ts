/**
 * O bug que estes testes travam é o do fuso: `new Date('2026-08-14')` é lido
 * como meia-noite UTC, que no Brasil (UTC-3) é dia 13 às 21h. Uma data de
 * vigência de percentual ou de competência de comissão exibida um dia atrás
 * transforma discussão de dinheiro em discussão de bug.
 */
import { describe, it, expect } from 'vitest';
import {
  moeda,
  percentual,
  numero,
  dataBR,
  dataHoraBR,
  competenciaBR,
  documentoMascarado,
  diaDoLancamento,
} from './formato';

describe('diaDoLancamento', () => {
  it('o ISO que a API devolve (00:00 UTC) continua no mesmo dia, não volta para o anterior', () => {
    const d = diaDoLancamento('2026-10-01T00:00:00+00:00');
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 9, 1]);
    expect(dataBR(diaDoLancamento('2026-10-01T00:00:00+00:00'))).toBe('01/10/2026');
    expect(dataBR(diaDoLancamento('2026-10-01'))).toBe('01/10/2026');
  });

  it('valor inválido vira null', () => {
    expect(diaDoLancamento('ontem')).toBeNull();
    expect(diaDoLancamento(null)).toBeNull();
  });
});

// Espaço não-quebrável: o Intl separa "R$" do valor com U+00A0, não com espaço
// comum. Comparar com ' ' faz o teste falhar por um caractere invisível.
const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('moeda', () => {
  it('formata em real com centavos', () => {
    expect(nbsp(moeda(1234.5))).toBe('R$ 1.234,50');
  });

  it('compacta esconde o centavo, para card de métrica', () => {
    expect(nbsp(moeda(1234.5, true))).toBe('R$ 1.235');
  });

  it('negativo mantém o sinal — estorno não pode parecer receita', () => {
    expect(nbsp(moeda(-100))).toBe('-R$ 100,00');
  });

  it('zero é um valor, não ausência de valor', () => {
    expect(nbsp(moeda(0))).toBe('R$ 0,00');
  });

  it('nulo vira travessão, nunca "R$ 0,00"', () => {
    // Distinção que o back office precisa preservar: "não houve receita" e
    // "não sabemos" não são a mesma informação.
    expect(moeda(null)).toBe('—');
    expect(moeda(undefined)).toBe('—');
    expect(moeda(NaN)).toBe('—');
  });
});

describe('percentual', () => {
  it('recebe 12.5 e devolve 12,5%', () => {
    expect(percentual(12.5)).toBe('12,5%');
  });

  it('não força casa decimal em valor redondo', () => {
    expect(percentual(10)).toBe('10%');
  });

  it('nulo vira travessão', () => {
    expect(percentual(null)).toBe('—');
  });
});

describe('numero', () => {
  it('usa ponto como separador de milhar', () => {
    expect(numero(1234567)).toBe('1.234.567');
  });

  it('zero é exibido', () => {
    expect(numero(0)).toBe('0');
  });
});

describe('dataBR', () => {
  it('data pura do Postgres não retrocede um dia', () => {
    // O teste central deste arquivo.
    expect(dataBR('2026-08-14')).toBe('14/08/2026');
  });

  it('vira do ano se mantém', () => {
    expect(dataBR('2026-01-01')).toBe('01/01/2026');
    expect(dataBR('2026-12-31')).toBe('31/12/2026');
  });

  it('aceita Date', () => {
    expect(dataBR(new Date(2026, 7, 14, 12, 0))).toBe('14/08/2026');
  });

  it('nulo e string inválida viram travessão em vez de "Invalid Date"', () => {
    expect(dataBR(null)).toBe('—');
    expect(dataBR('')).toBe('—');
    expect(dataBR('nao-e-data')).toBe('—');
  });
});

describe('dataHoraBR', () => {
  it('timestamptz com fuso explícito é convertido, não truncado', () => {
    // -03:00 é o fuso gravado no dado; o resultado depende do fuso de quem lê,
    // então afirmamos só o formato, não o valor. Fixar "13:45" aqui quebraria
    // o teste em qualquer máquina fora do horário de Brasília.
    expect(dataHoraBR('2026-08-14T13:45:00-03:00')).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    );
  });

  it('nulo vira travessão', () => {
    expect(dataHoraBR(null)).toBe('—');
  });
});

describe('competenciaBR', () => {
  it('reduz a data ao mês de competência', () => {
    expect(competenciaBR('2026-08-01')).toBe('08/2026');
  });

  it('mês de um dígito recebe zero à esquerda', () => {
    expect(competenciaBR('2026-01-31')).toBe('01/2026');
  });
});

describe('documentoMascarado', () => {
  it('CPF mostra só as pontas', () => {
    expect(documentoMascarado('12345678901')).toBe('123.***.***-01');
  });

  it('CNPJ preserva a raiz e a ordem, que é o que identifica a empresa', () => {
    expect(documentoMascarado('12345678000199')).toBe('12.***.***/0001-99');
  });

  it('aceita documento já formatado', () => {
    expect(documentoMascarado('123.456.789-01')).toBe('123.***.***-01');
  });

  it('devolve o original quando o tamanho não é de CPF nem CNPJ', () => {
    // Melhor exibir o que existe do que mascarar errado e esconder um dado ruim.
    expect(documentoMascarado('123')).toBe('123');
    expect(documentoMascarado(null)).toBe('—');
  });
});
