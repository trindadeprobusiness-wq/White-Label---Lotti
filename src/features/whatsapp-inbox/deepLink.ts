/**
 * Abertura do Inbox já no chat de alguém.
 *
 * A tela inicial lista quem espera resposta e precisa levar direto à conversa.
 * Não dá para usar o id da conversa no link: o lead que chegou pelo QR pode
 * nem ter conversa ainda, e quando tem, quem monta o link não conhece o id.
 * O telefone é o único dado que os dois lados têm.
 *
 * A comparação usa os últimos dígitos porque o mesmo número aparece escrito de
 * formas diferentes — com e sem +55, com e sem o nono dígito, com máscara.
 */

export const DIGITOS_COMPARADOS = 8;

export function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** Link do Inbox já apontado para a conversa de um telefone. */
export function linkDoInbox(telefone: string | null | undefined): string {
  const digitos = somenteDigitos(telefone);
  return digitos ? `/whatsapp?telefone=${digitos}` : '/whatsapp';
}

/** Compara dois telefones pelo trecho final, que é o que não varia. */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = somenteDigitos(a);
  const db = somenteDigitos(b);
  if (da.length < DIGITOS_COMPARADOS || db.length < DIGITOS_COMPARADOS) return false;
  return da.slice(-DIGITOS_COMPARADOS) === db.slice(-DIGITOS_COMPARADOS);
}
