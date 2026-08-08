/**
 * Casamento tolerante de entidades extraídas por IA com as já cadastradas.
 * Contratos escrevem "JOÃO DA SILVA", "Joao da Silva Ltda", "Rua 7 nº 120" —
 * a comparação precisa ignorar acento, caixa e espaço sobrando.
 */

/** Remove acentos, baixa a caixa e normaliza espaços. */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

const ehLetraOuNumero = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Contenção em limite de palavra. Sem checar a borda, "Rua 15 de Novembro, 10"
 * casava com "Rua 15 de Novembro, 100" e o contrato ia parar no imóvel errado.
 * O piso de 8 caracteres evita que "Rua A" case com meia cidade.
 */
const contidoEmPalavra = (agulha: string, palheiro: string) => {
  if (agulha.length < 8) return false;
  let i = palheiro.indexOf(agulha);
  while (i !== -1) {
    const antes = palheiro[i - 1];
    const depois = palheiro[i + agulha.length];
    if (!ehLetraOuNumero(antes) && !ehLetraOuNumero(depois)) return true;
    i = palheiro.indexOf(agulha, i + 1);
  }
  return false;
};

/** Igualdade "frouxa": exata, ou um contido no outro em limite de palavra. */
export const looseMatch = (a: string, b: string) => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return contidoEmPalavra(na, nb) || contidoEmPalavra(nb, na);
};
