export type LiveConversation = {
  id: string;
  // Null when WhatsApp hides the number (the conversation is kept by its LID).
  phone: string | null;
  contact_name?: string | null;
  mode: 'ai' | 'human' | 'paused';
  updated_at: string;
  qualification: { priority?: string; stage?: string };
};

export function formatContactPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.length === 12 && digits.startsWith('55')) return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return digits ? `+${digits}` : value;
}

// A name typed in the CRM wins; then the name saved in the phone's address book;
// an unsaved contact is shown by its number, as in WhatsApp.
export function conversationTitle(conversation: Pick<LiveConversation, 'phone' | 'contact_name'>, clientName?: string | null) {
  if (clientName && clientName !== 'Contato WhatsApp') return clientName;
  return conversation.contact_name || (conversation.phone ? formatContactPhone(conversation.phone) : 'Contato sem número');
}

export type LatestMessage = { conversation_id: string; direction: 'in' | 'out'; created_at: string; content: string };
export type QuickFilter = 'all' | 'late' | 'urgent';

export function latestByConversation(messages: LatestMessage[]) {
  const latest = new Map<string, LatestMessage>();
  for (const message of messages) {
    if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message);
  }
  return latest;
}

export function liveUrgency(conversation: LiveConversation, latest: LatestMessage | undefined, now: number): QuickFilter {
  if (!latest || latest.direction !== 'in' || conversation.mode === 'ai') return 'all';
  const minutes = (now - new Date(latest.created_at).getTime()) / 60000;
  if (!Number.isFinite(minutes) || minutes < 0) return 'all';
  if (conversation.qualification?.priority === 'alta' || minutes >= 60) return 'urgent';
  return minutes >= 15 ? 'late' : 'all';
}

export function filterLiveConversations<T extends LiveConversation>(conversations: T[], latest: Map<string, LatestMessage>, options: {
  query: string; quick: QuickFilter; mode: string; stage: string; period: string; now: number;
}) {
  const query = options.query.trim().toLocaleLowerCase('pt-BR');
  return conversations.filter(conversation => {
    const message = latest.get(conversation.id);
    if (query && ![conversation.phone ?? '', conversation.contact_name ?? '', message?.content ?? ''].some(value => value.toLocaleLowerCase('pt-BR').includes(query))) return false;
    if (options.quick !== 'all' && liveUrgency(conversation, message, options.now) !== options.quick) return false;
    if (options.mode && conversation.mode !== options.mode) return false;
    if (options.stage && conversation.qualification?.stage !== options.stage) return false;
    if (options.period) {
      const days = Number(options.period);
      const timestamp = new Date(conversation.updated_at).getTime();
      if (!Number.isFinite(timestamp) || timestamp < options.now - days * 86400000) return false;
    }
    return true;
  });
}
