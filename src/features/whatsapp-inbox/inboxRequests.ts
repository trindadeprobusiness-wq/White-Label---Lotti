import { MENSAGEM_CONVERSA_EXISTENTE } from '@/lib/crm/duplicidade';

// "Nova conversa" sends through lotti_manual_begin, which answers a repeated
// request_id with the first result instead of sending again. One id per
// attempt: the same phone and text keep it, so a retry after a timeout never
// delivers the message twice; another phone or text is another message.
export type StartAttempt = { id: string; phone: string; text: string };
export function nextStartAttempt(current: StartAttempt | null, phone: string, text: string, newId: () => string = () => crypto.randomUUID()): StartAttempt {
  return current && current.phone === phone && current.text === text ? current : { id: newId(), phone, text };
}
// Delivered or refused by WhatsApp: the next click is a new message. Any other
// outcome (uncertain, sending, busy, network) may still be in flight.
export const attemptFinished = (outcome: string) => outcome === 'sent' || outcome === 'failed';

const START_ERRORS: Record<string, string> = {
  busy: 'Há uma entrega em andamento nesta conversa. Aguarde alguns segundos e tente de novo.',
  failed: 'O WhatsApp não aceitou a mensagem. Confira o número e tente de novo.',
  invalid_phone: 'Telefone inválido. Informe o DDD e o número.',
  channel_unavailable: 'Conecte o WhatsApp antes de iniciar uma conversa.',
  forbidden: 'Sua conta não pode iniciar conversas por este WhatsApp.',
  duplicate_conversation_phone: MENSAGEM_CONVERSA_EXISTENTE,
  connection_service_unavailable: 'O WhatsApp não respondeu. Tente de novo em instantes.',
  send_unavailable: 'O WhatsApp não respondeu. Tente de novo em instantes.',
};
export const startErrorText = (code: string) => START_ERRORS[code] ?? 'Não foi possível iniciar a conversa.';

const RENAME_ERRORS: Record<string, string> = {
  phone_managed_by_whatsapp: 'O número deste contato é definido pelo WhatsApp e não pode ser trocado aqui.',
  phone_in_other_conversation: 'Este telefone já está em outra conversa. Una as duas para manter o histórico num lugar só.',
  phone_already_in_use: 'Este telefone já está em outra conversa.',
  delivery_pending: 'Há um envio em andamento nesta conversa. Tente de novo quando ele terminar.',
  invalid_phone: 'Informe um telefone com DDD (10 a 15 dígitos).',
  invalid_name: 'Informe o nome do contato.',
};
export const renameErrorText = (code: string) => RENAME_ERRORS[code] ?? 'Não foi possível salvar o contato. Tente novamente.';

const MERGE_ERRORS: Record<string, string> = {
  different_contacts: 'O WhatsApp identifica as duas conversas como contatos diferentes, então elas não podem ser unidas.',
  delivery_pending: 'Há um envio em andamento na outra conversa. Tente unir quando ele terminar.',
};
export const mergeErrorText = (code: string) => MERGE_ERRORS[code] ?? 'Não foi possível unir as conversas. Tente novamente.';

// supabase.functions.invoke hides the JSON of a non-2xx answer in error.context.
export async function functionErrorCode(error: unknown): Promise<string> {
  const context = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  try {
    const body = await context?.json?.() as { reason?: unknown; error?: unknown } | undefined;
    if (typeof body?.reason === 'string') return body.reason;
    if (typeof body?.error === 'string') return body.error;
  } catch { /* body already read or not JSON */ }
  return 'start_failed';
}
