/**
 * O bug sério aqui não é de formatação, é de segurança: CSV injection.
 *
 * Nome de parceiro e observação administrativa são campos livres. Se alguém
 * gravar `=HYPERLINK("http://site-malicioso","Clique")` como nome, o Excel e o
 * Google Sheets executam isso ao abrir o relatório exportado — e quem abre é
 * um administrador da Lotti.
 */
import { describe, it, expect } from 'vitest';
import { montarCsv, nomeArquivoCsv, BOM, type ColunaCsv } from './csv';

interface Linha {
  nome: string;
  valor: number | null;
}

const colunas: ColunaCsv<Linha>[] = [
  { cabecalho: 'Nome', valor: (l) => l.nome },
  { cabecalho: 'Valor', valor: (l) => l.valor },
];

// O BOM não é ruído: sem ele o Excel pt-BR exibe "Imobiliária" como "ImobiliÃ¡ria".
const semBom = (csv: string) => (csv.startsWith(BOM) ? csv.slice(BOM.length) : csv);

describe('montarCsv', () => {
  it('usa ; como separador, que é o que o Excel pt-BR espera', () => {
    const csv = semBom(montarCsv([{ nome: 'Ana', valor: 10 }], colunas));
    expect(csv).toBe('Nome;Valor\r\nAna;10');
  });

  it('começa com BOM UTF-8', () => {
    expect(montarCsv([], colunas).startsWith(BOM)).toBe(true);
    expect(BOM).toBe('\uFEFF');
  });

  it('escapa campo com vírgula e ponto e vírgula', () => {
    const csv = semBom(montarCsv([{ nome: 'Silva, Souza & Cia', valor: 1 }], colunas));
    expect(csv).toContain('"Silva, Souza & Cia"');
  });

  it('duplica aspas internas', () => {
    const csv = semBom(montarCsv([{ nome: 'Imobiliária "Central"', valor: 1 }], colunas));
    expect(csv).toContain('"Imobiliária ""Central"""');
  });

  it('escapa quebra de linha em vez de partir a linha do CSV', () => {
    const csv = semBom(montarCsv([{ nome: 'linha1\nlinha2', valor: 1 }], colunas));
    expect(csv.split('\r\n')).toHaveLength(2); // cabeçalho + 1 registro
    expect(csv).toContain('"linha1\nlinha2"');
  });

  it('neutraliza fórmula do Excel', () => {
    // O teste central deste arquivo.
    const csv = semBom(
      montarCsv([{ nome: '=HYPERLINK("http://mau","x")', valor: 1 }], colunas),
    );
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|;)=HYPERLINK/);
  });

  it('neutraliza os outros prefixos perigosos', () => {
    for (const prefixo of ['+', '-', '@']) {
      const csv = semBom(montarCsv([{ nome: `${prefixo}CMD`, valor: 1 }], colunas));
      expect(csv).toContain(`'${prefixo}CMD`);
    }
  });

  it('nulo vira campo vazio, não a string "null"', () => {
    const csv = semBom(montarCsv([{ nome: 'Ana', valor: null }], colunas));
    expect(csv).toBe('Nome;Valor\r\nAna;');
  });

  it('zero é preservado, não confundido com vazio', () => {
    const csv = semBom(montarCsv([{ nome: 'Ana', valor: 0 }], colunas));
    expect(csv).toBe('Nome;Valor\r\nAna;0');
  });

  it('lista vazia devolve só o cabeçalho', () => {
    expect(semBom(montarCsv([], colunas))).toBe('Nome;Valor');
  });
});

describe('nomeArquivoCsv', () => {
  it('inclui a data para exportações sucessivas não se sobrescreverem', () => {
    expect(nomeArquivoCsv('parceiros', new Date(2026, 7, 14))).toBe('parceiros-2026-08-14.csv');
  });

  it('preenche mês e dia com zero à esquerda', () => {
    expect(nomeArquivoCsv('usuarios', new Date(2026, 0, 5))).toBe('usuarios-2026-01-05.csv');
  });
});
