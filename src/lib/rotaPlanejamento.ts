/**
 * A rota da agenda se chamava `/rotina` e passou a ser `/planejamento`.
 *
 * O endereço antigo não pode simplesmente sumir: o consentimento do Google
 * Agenda volta para um endereço guardado num secret do servidor, e é na query
 * dele que chega `?google_calendar=connected`. Perder a query silenciaria o
 * aviso de conexão sem erro nenhum na tela — o pior tipo de defeito. O
 * fragmento também viaja: o onboarding e as Configurações apontam para
 * `#google-agenda`, que abre o painel certo ao chegar.
 */
export function destinoDoDesvioDaAgenda(search: string, hash: string): string {
  return `/planejamento${search}${hash}`;
}
