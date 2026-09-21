import type { WhatsAppMessage, WhatsAppServiceMode } from './types';

/** Apply a normalized message once; only a human outgoing message takes over AI. */
export function receiveChatMessage(messages: WhatsAppMessage[], mode: WhatsAppServiceMode,
  message: WhatsAppMessage, author: 'customer' | 'human' | 'ai', source: 'whatsapp' | 'inbox') {
  if (messages.some(item => item.id === message.id)) return { messages, mode };
  const pause = mode === 'ai' && author === 'human' && message.direction === 'outgoing';
  const notice: WhatsAppMessage = {
    id: `${message.id}-ai-paused`, direction: 'outgoing', content: '',
    sender: message.sender, sentAt: message.sentAt, systemEvent: { type: 'ai-paused', source },
  };
  return { messages: [...messages, message, ...(pause ? [notice] : [])], mode: pause ? 'human' as const : mode };
}
