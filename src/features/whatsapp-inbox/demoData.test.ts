import { describe, expect, it } from 'vitest';
import {
  demoConversations,
  demoMessagesByConversation,
  demoProfilesByContact,
} from './demoData';

describe('dados demonstrativos do WhatsApp Inbox', () => {
  it('mantém conversas ligadas a mensagens e perfis válidos', () => {
    expect(demoConversations.length).toBeGreaterThan(2);

    for (const conversation of demoConversations) {
      expect(demoMessagesByConversation[conversation.id]?.length).toBeGreaterThan(0);
      expect(demoProfilesByContact[conversation.contactId]?.name).toBeTruthy();
    }
  });

  it('cobre os estados de atendimento necessários para a demonstração', () => {
    expect(demoConversations.some(({ unreadCount }) => unreadCount > 0)).toBe(true);
    expect(demoConversations.some(({ serviceMode }) => serviceMode === 'ai')).toBe(true);
    expect(demoConversations.some(({ serviceMode }) => serviceMode === 'human')).toBe(true);
  });
});
