export type OptOutState = 'none' | 'blocked' | 'replied';
type TimedMessage = { direction: 'in' | 'out'; created_at: string };

/**
 * Mesma regra de lotti_manual_opt_out_guard (20260927120100): depois do pedido
 * de saída, o corretor só responde se o contato voltar a escrever.
 */
export function optOutState(optedOutAt: string | null | undefined, messages: TimedMessage[]): OptOutState {
  if (!optedOutAt) return 'none';
  const since = new Date(optedOutAt).getTime();
  return messages.some(message => message.direction === 'in' && new Date(message.created_at).getTime() > since) ? 'replied' : 'blocked';
}
