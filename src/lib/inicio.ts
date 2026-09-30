/**
 * Regras da tela inicial.
 *
 * Ficam fora do componente porque são decisões de negócio — quando um contrato
 * está perto de vencer, há quanto tempo um lead espera — e precisam de teste
 * próprio, sem montar a página inteira.
 */

export interface ContratoPrazo {
  id: string;
  status: 'RASCUNHO' | 'FINALIZADO';
  data_inicio: string;
  prazo_meses?: number;
}

/** Dias de antecedência para um contrato entrar na lista de atenção. */
export const JANELA_VENCIMENTO_DIAS = 60;

const DIA_MS = 86_400_000;

function zerarHora(data: Date) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime();
}

/** Fim da vigência: início mais o prazo. Sem prazo não há vencimento a cobrar. */
export function fimDaVigencia(contrato: ContratoPrazo): Date | null {
  if (!contrato.prazo_meses || contrato.prazo_meses <= 0) return null;
  const inicio = new Date(contrato.data_inicio);
  if (Number.isNaN(inicio.getTime())) return null;
  const fim = new Date(inicio);
  fim.setMonth(fim.getMonth() + contrato.prazo_meses);
  return fim;
}

/**
 * Contratos finalizados que vencem dentro da janela, do mais próximo ao mais
 * distante. Rascunho não entra: não está valendo, então não vence.
 * Vencido continua na lista — quem passou do prazo precisa de ação, não de
 * silêncio.
 */
export function contratosVencendo<T extends ContratoPrazo>(contratos: T[], agora = new Date()): T[] {
  const hoje = zerarHora(agora);
  const limite = hoje + JANELA_VENCIMENTO_DIAS * DIA_MS;
  return contratos
    .filter((contrato) => contrato.status === 'FINALIZADO')
    .map((contrato) => ({ contrato, fim: fimDaVigencia(contrato) }))
    .filter((item): item is { contrato: T; fim: Date } => item.fim !== null && zerarHora(item.fim) <= limite)
    .sort((a, b) => a.fim.getTime() - b.fim.getTime())
    .map((item) => item.contrato);
}

/**
 * Espera em linguagem de quem atende: "agora", "há 12 min", "há 3 h", "há 2 d".
 * Data futura vira "agora" em vez de um número negativo sem sentido na tela.
 */
export function tempoDeEspera(iso: string | null | undefined, agora = new Date()): string {
  if (!iso) return '';
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return '';
  const minutos = Math.floor((agora.getTime() - quando.getTime()) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}
