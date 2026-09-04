import { describe, expect, it } from 'vitest';
import { detectarFormato, mapearColunasClientes, validarPreviaClientes } from './importacao';

describe('arquitetura de importação do onboarding', () => {
  it('aceita CSV e XLSX e recusa formatos não suportados', () => {
    expect(detectarFormato('clientes.csv')).toBe('csv');
    expect(detectarFormato('carteira.XLSX')).toBe('xlsx');
    expect(detectarFormato('clientes.pdf')).toBe(null);
  });

  it('sugere mapeamento por vocabulário comum sem depender da ordem', () => {
    expect(mapearColunasClientes(['Celular', 'Nome completo', 'E-mail', 'Origem'])).toEqual({
      Celular: 'telefone',
      'Nome completo': 'nome',
      'E-mail': 'email',
      Origem: 'origem',
    });
  });

  it('separa inválidos e duplicados em vez de importar silenciosamente', () => {
    const previa = validarPreviaClientes([
      { nome: 'Ana Lima', telefone: '(11) 99999-0000', email: '' },
      { nome: '', telefone: '(11) 98888-0000', email: '' },
      { nome: 'Ana duplicada', telefone: '11999990000', email: '' },
      { nome: 'Bruno', telefone: '', email: 'bruno@example.com' },
    ]);

    expect(previa.validas.map((linha) => linha.nome)).toEqual(['Ana Lima', 'Bruno']);
    expect(previa.erros).toEqual([
      { linha: 2, motivo: 'Nome é obrigatório.' },
      { linha: 3, motivo: 'Contato duplicado na planilha.' },
    ]);
    expect(previa.permiteImportacaoParcial).toBe(true);
  });
});
