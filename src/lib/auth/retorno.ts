/**
 * Extrai apenas o erro de um retorno do Supabase Auth. Tokens que possam estar
 * no hash nunca são devolvidos nem registrados.
 */
export function extrairErroDeRetornoAuth(busca: string, hash: string): string | null {
  const fontes = [busca, hash]
    .filter((valor) => valor.includes('error'))
    .map((valor) => new URLSearchParams(valor.replace(/^[?#]/, '')));

  for (const parametros of fontes) {
    const erro = parametros.get('error_description') ?? parametros.get('error');
    if (erro) return erro;
  }

  return null;
}
