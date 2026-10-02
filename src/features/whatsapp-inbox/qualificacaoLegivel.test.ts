import { describe, expect, it } from 'vitest';
import { temperaturaLegivel, valorLegivel } from './qualificacaoLegivel';

describe('qualificação legível', () => {
  it('interesse ganha acento e maiúscula', () => {
    // O caso da tela real: a IA grava "locacao", sem acento.
    expect(valorLegivel('intent', 'locacao')).toBe('Locação');
    expect(valorLegivel('intent', 'aluguel')).toBe('Locação');
    expect(valorLegivel('intent', 'compra')).toBe('Compra');
  });

  // O Intl separa "R$" do número com espaço inseparável (U+00A0), para o
  // valor nunca quebrar de linha no meio. É de propósito.
  const brl = (n: string) => `R$\u00a0${n}`;

  it('orçamento numérico vira moeda', () => {
    expect(valorLegivel('budget', '1900')).toBe(brl('1.900'));
    expect(valorLegivel('budget', '450000')).toBe(brl('450.000'));
  });

  it('ponto de milhar em pt-BR não vira decimal', () => {
    // "1.900" é mil e novecentos, não um vírgula nove.
    expect(valorLegivel('budget', '1.900')).toBe(brl('1.900'));
  });

  it('orçamento em faixa ou frase fica como a IA escreveu', () => {
    // Converter "até 400 mil" num número inventaria uma precisão que não existe.
    expect(valorLegivel('budget', 'até 400 mil')).toBe('Até 400 mil');
    expect(valorLegivel('budget', '1900 a 2500')).toBe('1900 a 2500');
  });

  it('o resto só ganha maiúscula na primeira letra', () => {
    expect(valorLegivel('nextStep', 'agendar visita')).toBe('Agendar visita');
    expect(valorLegivel('region', 'Anápolis')).toBe('Anápolis');
    expect(valorLegivel('needs', '2 quartos')).toBe('2 quartos');
  });

  it('temperatura conhecida ganha tom', () => {
    expect(temperaturaLegivel('morno')).toEqual({ rotulo: 'Morno', tom: 'morno' });
    expect(temperaturaLegivel('QUENTE')).toEqual({ rotulo: 'Quente', tom: 'quente' });
  });

  it('temperatura desconhecida aparece neutra, e vazia não aparece', () => {
    expect(temperaturaLegivel('indefinido')).toEqual({ rotulo: 'Indefinido', tom: 'neutro' });
    expect(temperaturaLegivel('')).toBeNull();
    expect(temperaturaLegivel(null)).toBeNull();
  });
});
