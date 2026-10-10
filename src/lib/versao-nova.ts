// Deploy novo troca os arquivos do app; a aba antiga, ao abrir outra tela, não achava mais o código dela
// e recarregava a página inteira na frente da pessoa ("Carregando..."). Aqui a aba confere de tempos em
// tempos se saiu versão nova e, se saiu, recarrega quando ninguém está olhando (aba em segundo plano).

/** O script principal (/assets/index-xxxx.js) que esta aba está rodando. Fora do build (dev) não há. */
export function scriptAtual(doc: Document = document): string | null {
  return doc.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src') ?? null;
}

/** O script principal do index.html publicado agora. */
export function scriptDoHtml(html: string): string | null {
  const tag = html.match(/<script[^>]*type="module"[^>]*>/g)?.find(t => t.includes('/assets/'));
  return tag?.match(/src="([^"]+)"/)?.[1] ?? null;
}

export function vigiarVersaoNova({ intervaloMs = 120_000 }: { intervaloMs?: number } = {}): void {
  const atual = scriptAtual();
  if (!atual) return;
  let nova = false;
  const conferir = async () => {
    if (nova) return;
    try {
      const resposta = await fetch('/index.html', { cache: 'no-store' });
      if (!resposta.ok) return;
      const publicado = scriptDoHtml(await resposta.text());
      if (publicado && publicado !== atual) nova = true;
    } catch {
      // sem rede agora: confere na próxima
    }
  };
  const recarregarSeEscondida = () => {
    if (nova && document.visibilityState === 'hidden') window.location.reload();
  };
  window.setInterval(() => { void conferir().then(recarregarSeEscondida); }, intervaloMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void conferir().then(recarregarSeEscondida);
  });
}
