/**
 * URLs de imagem redimensionadas pelo Storage do Supabase.
 *
 * O motivo: a landing pública do QR usava a foto ORIGINAL do imóvel (2–5 MB)
 * como plano de fundo — para exibi-la desfocada e escurecida atrás do card de
 * captura. No 4G isso é a diferença entre o visitante ver o formulário em 1s
 * ou desistir antes de carregar. E é justamente a tela onde o lead entra.
 *
 * O Storage aceita `/render/image/public/` com `width`/`quality`. Quando o
 * projeto não tem essa funcionalidade habilitada, a URL transformada responde
 * erro — por isso todo consumo passa por `onError` e volta para a original.
 * Ver `imagemComFallback`.
 */

/**
 * Desligado: o projeto do Supabase responde 403 "FeatureNotEnabled" para /render/image (medido em
 * 11/10/2026). Cada foto pagava uma ida aos EUA só para receber o erro e então baixar a original.
 * Com a transformação ligada no Storage, basta voltar para true.
 */
export const TRANSFORMACAO_DE_IMAGEM_ATIVA = false;

const ehStorageSupabase = (url: string) => url.includes('/storage/v1/object/public/');

/**
 * Versão leve para o fundo desfocado, ou '' quando não há como pedir uma (foto do Storage com a
 * transformação desligada): aí o fundo fica só no gradiente, sem baixar a original de 1 a 3 MB.
 * Foto fora do Storage (as da API) volta intacta, como sempre voltou.
 */
export function fundoLeve(url: string | null | undefined, largura: number, qualidade: number): string {
  if (!url) return '';
  if (ehStorageSupabase(url) && !TRANSFORMACAO_DE_IMAGEM_ATIVA) return '';
  return imagemRedimensionada(url, { largura, qualidade });
}

/** Converte /object/public/ em /render/image/public/ com os parâmetros. */
export function imagemRedimensionada(
  url: string | null | undefined,
  opcoes: { largura: number; qualidade?: number },
): string {
  if (!url) return '';
  // Só mexe em URL de Storage público; qualquer outra volta intacta.
  if (!url.includes('/storage/v1/object/public/')) return url;

  const base = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const sep = base.includes('?') ? '&' : '?';
  const q = opcoes.qualidade ?? 60;
  return `${base}${sep}width=${opcoes.largura}&quality=${q}&resize=cover`;
}

/**
 * Props prontas para um <img> que tenta a versão leve e cai na original.
 *
 * `fundoDesfocado` existe porque a imagem de fundo é borrada de qualquer
 * forma: 480px de largura e qualidade 35 são indistinguíveis do original
 * depois do blur, e custam uma fração do tráfego.
 */
export function imagemComFallback(
  url: string | null | undefined,
  largura: number,
  qualidade = 60,
) {
  const original = url ?? '';
  return {
    src: (TRANSFORMACAO_DE_IMAGEM_ATIVA ? imagemRedimensionada(original, { largura, qualidade }) : original) || original,
    onError: (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      // Uma tentativa só — sem isso, uma original quebrada entraria em laço.
      if (original && img.src !== original) img.src = original;
    },
  };
}
