/**
 * Ordem das fotos de um imóvel.
 *
 * A IA só classifica o cômodo de cada foto — quem decide a ordem é este código.
 * Classificar ("isto é uma cozinha") é bem mais confiável para um modelo do que
 * devolver a ordem pronta, e mantém a regra de negócio testável sem rede e sem IA.
 *
 * A sequência segue como corretor monta anúncio: mostra o imóvel de fora, entra
 * pela sala, passa pelas áreas comuns, depois os privativos, e fecha com o extra.
 */
export const ORDEM_CANONICA = [
  'FACHADA',
  'SALA',
  'COZINHA',
  'AREA_SERVICO',
  'QUARTO',
  'BANHEIRO',
  'VARANDA',
  'AREA_EXTERNA',
  'GARAGEM',
  'VISTA',
  'OUTRO',
] as const;

export type CategoriaFoto = (typeof ORDEM_CANONICA)[number];

const posicaoDe = (categoria: string | null | undefined): number => {
  const i = ORDEM_CANONICA.indexOf(String(categoria ?? '').toUpperCase() as CategoriaFoto);
  // Categoria desconhecida ou ausente cai para o fim, nunca no meio do anúncio.
  return i === -1 ? ORDEM_CANONICA.length : i;
};

/**
 * Ordena pela regra de mercado. `Array.prototype.sort` é estável no JS moderno,
 * então fotos da mesma categoria mantêm a ordem em que já estavam — o corretor
 * não vê os quartos embaralharem a cada análise.
 */
export function ordenarPorCategoria<T extends { categoria?: string | null }>(fotos: T[]): T[] {
  return [...fotos].sort((a, b) => posicaoDe(a.categoria) - posicaoDe(b.categoria));
}

/** Converte uma lista de ids já ordenada no que vai para a coluna `ordem`. */
export function novaOrdemPara(idsNaOrdem: string[]): { id: string; ordem: number }[] {
  return idsNaOrdem.map((id, ordem) => ({ id, ordem }));
}
