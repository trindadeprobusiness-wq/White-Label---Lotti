/**
 * Em Markdown, uma quebra de linha simples não quebra linha: vira o mesmo
 * parágrafo. As sugestões clicáveis anexavam com um `\n` só — na
 * pré-visualização a regra nova grudava no texto anterior e sumia.
 */
export function anexarSugestao(texto: string, sugestao: string): string {
  const base = texto.trimEnd();
  if (!base) return `- ${sugestao}`;
  const ultimaLinha = base.slice(base.lastIndexOf('\n') + 1).trimStart();
  const jaEstaEmLista = ultimaLinha.startsWith('- ') || ultimaLinha.startsWith('* ');
  return `${base}${jaEstaEmLista ? '\n' : '\n\n'}- ${sugestao}`;
}
