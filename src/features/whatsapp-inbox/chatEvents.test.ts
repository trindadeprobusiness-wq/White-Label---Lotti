import { describe, expect, it } from 'vitest';
import { receiveChatMessage } from './chatEvents';
import type { WhatsAppMessage } from './types';

const message: WhatsAppMessage = { id: 'm1', content: 'Olá', direction: 'outgoing', sender: 'Equipe', sentAt: '10:43' };
describe('human takeover', () => {
  it('pauses AI and adds the notice after a human reply', () => {
    const result = receiveChatMessage([], 'ai', message, 'human', 'whatsapp');
    expect(result.mode).toBe('human');
    expect(result.messages[1].systemEvent).toEqual({ type: 'ai-paused', source: 'whatsapp' });
  });
  it('does not pause for customer or AI messages', () => {
    expect(receiveChatMessage([], 'ai', { ...message, direction: 'incoming' }, 'customer', 'whatsapp').mode).toBe('ai');
    expect(receiveChatMessage([], 'ai', message, 'ai', 'whatsapp').messages).toHaveLength(1);
  });
  it('ignores repeated messages and does not repeat the pause notice', () => {
    const first = receiveChatMessage([], 'ai', message, 'human', 'whatsapp');
    expect(receiveChatMessage(first.messages, first.mode, message, 'human', 'whatsapp').messages).toHaveLength(2);
    expect(receiveChatMessage(first.messages, first.mode, { ...message, id: 'm2' }, 'human', 'whatsapp').messages).toHaveLength(3);
  });
});
