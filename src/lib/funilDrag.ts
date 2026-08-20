/**
 * Um gesto de arrastar termina com um clique sintético em alguns navegadores.
 * Este guard preserva o clique comum, mas impede que esse último evento navegue
 * para a página do cliente.
 */
export function deveBloquearCliqueDoCard(
  arrasteAtivo: boolean,
  cliqueAposArraste: boolean,
) {
  return arrasteAtivo || cliqueAposArraste;
}
