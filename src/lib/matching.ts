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

/**
 * Igualdade "frouxa": exata, ou um contendo o outro a partir de 8 caracteres.
 * O piso de 8 evita que "Rua A" case com meia cidade.
 */
export const looseMatch = (a: string, b: string) => {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return (na.length >= 8 && nb.includes(na)) || (nb.length >= 8 && na.includes(nb));
};
