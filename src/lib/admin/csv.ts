/**
 * Exportação CSV para as listagens do back office.
 *
 * Duas coisas que o `join(',')` ingênuo erra e que aqui são tratadas:
 *
 * 1. Campos com vírgula, aspas ou quebra de linha quebram o arquivo. Um nome
 *    como `Imobiliária Silva, Souza & Cia` viraria duas colunas.
 * 2. Um valor começando com `=`, `+`, `-` ou `@` é interpretado como FÓRMULA
 *    pelo Excel e pelo Google Sheets. Como parte desses dados vem de campo
 *    preenchido por usuário, isso é injeção de fórmula (CSV injection) — um
 *    `=HYPERLINK(...)` num nome de parceiro vira link clicável na planilha de
 *    quem abrir o relatório.
 */

export interface ColunaCsv<T> {
  cabecalho: string;
  valor: (item: T) => string | number | null | undefined;
}

const PERIGOSOS = ['=', '+', '-', '@', '\t', '\r'];

function escapar(bruto: string | number | null | undefined): string {
  if (bruto === null || bruto === undefined) return '';

  let texto = String(bruto);

  // Prefixo com aspa simples neutraliza a fórmula sem alterar o que se lê.
  if (PERIGOSOS.some((p) => texto.startsWith(p))) {
    texto = `'${texto}`;
  }

  if (/[",\n\r;]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }

  return texto;
}

/**
 * Monta o CSV.
 *
 * Separador `;` e BOM UTF-8 porque o público é brasileiro: o Excel em pt-BR
 * espera `;` (a vírgula é separador decimal) e, sem BOM, exibe "Imobiliária"
 * como "ImobiliÃ¡ria".
 */
/** BOM UTF-8, escapado: o caractere literal é invisível e o lint o rejeita. */
export const BOM = '\uFEFF';

export function montarCsv<T>(itens: readonly T[], colunas: readonly ColunaCsv<T>[]): string {
  const linhas = [
    colunas.map((c) => escapar(c.cabecalho)).join(';'),
    ...itens.map((item) => colunas.map((c) => escapar(c.valor(item))).join(';')),
  ];
  return `${BOM}${linhas.join('\r\n')}`;
}

/** Nome de arquivo com a data, para exportações sucessivas não se sobrescreverem. */
export function nomeArquivoCsv(prefixo: string, data = new Date()): string {
  const iso = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(
    data.getDate(),
  ).padStart(2, '0')}`;
  return `${prefixo}-${iso}.csv`;
}

/** Dispara o download no navegador. */
export function baixarCsv(conteudo: string, nomeArquivo: string): void {
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Dispara o download de um arquivo XLSX no navegador. */
export async function baixarXlsx<T>(itens: readonly T[], colunas: readonly ColunaCsv<T>[], nomeArquivo: string): Promise<void> {
  const XLSX = await import('xlsx');
  
  // Convertendo dados para o formato esperado pelo SheetJS (array de arrays)
  const cabecalhos = colunas.map(c => c.cabecalho);
  const linhas = itens.map(item => colunas.map(c => c.valor(item)));
  
  const worksheet = XLSX.utils.aoa_to_sheet([cabecalhos, ...linhas]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Relatório');
  
  // Grava o arquivo
  XLSX.writeFile(workbook, nomeArquivo);
}
