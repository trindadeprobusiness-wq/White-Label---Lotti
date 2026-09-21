import { describe, expect, it } from 'vitest';
import { ocultarDadoSensivel, lerPreferenciaOculta, mascararValoresNoTexto } from './privacidade';

describe('ocultarDadoSensivel', () => {
  it('preserva ausência de dado e mascara texto pessoal', () => {
    expect(ocultarDadoSensivel(null, 'telefone')).toBe('—');
    expect(ocultarDadoSensivel('(62) 99999-0000', 'telefone')).toBe('••••••••');
  });

  it('mantém o contexto de um valor financeiro sem expor o número', () => {
    expect(ocultarDadoSensivel('R$ 12.500', 'valor')).toBe('R$ ••••••');
  });
});

describe('lerPreferenciaOculta', () => {
  it('o padrão é mostrar — esconder é escolha explícita', () => {
    expect(lerPreferenciaOculta(null)).toBe(false);
    expect(lerPreferenciaOculta(undefined)).toBe(false);
    expect(lerPreferenciaOculta('')).toBe(false);
  });

  it('só a string exata liga o modo oculto', () => {
    expect(lerPreferenciaOculta('true')).toBe(true);
    expect(lerPreferenciaOculta('false')).toBe(false);
  });

  it('lixo no localStorage não esconde os números sem o corretor pedir', () => {
    // Outra aba, outra versão do app ou extensão de navegador podem gravar
    // qualquer coisa nessa chave. Nenhuma delas deve mascarar a tela.
    expect(lerPreferenciaOculta('1')).toBe(false);
    expect(lerPreferenciaOculta('TRUE')).toBe(false);
    expect(lerPreferenciaOculta('{"oculto":true}')).toBe(false);
  });
});

describe('mascararValoresNoTexto', () => {
  it('esconde o valor embutido na mensagem do alerta', () => {
    expect(mascararValoresNoTexto('Recebimento de R$ 2.300,00 de Diego Vinícius Mendes (2026-08)'))
      .toBe('Recebimento de R$ •••••• de Diego Vinícius Mendes (2026-08)');
  });

  it('pega mais de um valor na mesma frase', () => {
    expect(mascararValoresNoTexto('De R$ 1.000,00 para R$ 2.500,00'))
      .toBe('De R$ •••••• para R$ ••••••');
  });

  it('aceita as variações que o webhook produz', () => {
    expect(mascararValoresNoTexto('R$1.234,56')).toBe('R$ ••••••');
    expect(mascararValoresNoTexto('R$ 970')).toBe('R$ ••••••');
  });

  it('não mexe em número que não é dinheiro', () => {
    // Esconder o prazo não protege ninguém e tira o sentido do aviso.
    expect(mascararValoresNoTexto('Contrato vence em 15 dias — Apto 1.204'))
      .toBe('Contrato vence em 15 dias — Apto 1.204');
  });

  it('texto sem valor algum passa intacto', () => {
    expect(mascararValoresNoTexto('Documento pendente de assinatura'))
      .toBe('Documento pendente de assinatura');
  });
});
