export type WhatsAppServiceMode = 'ai' | 'human' | 'paused';
export type WhatsAppMessageDirection = 'incoming' | 'outgoing';

export interface WhatsAppConversation {
  firstInteractionAt?: string;
  lastInteractionAt?: string;
  waitingSince?: string;
  closedBy?: string;
  id: string;
  contactId: string;
  contactName: string;
  phone: string;
  avatar: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  serviceMode: WhatsAppServiceMode;
  status: 'open' | 'waiting' | 'closed';
  assignee: string;
}

export interface WhatsAppMessage {
  attachment?: { name: string; url: string; type: string; size: number };
  systemEvent?: { type: 'stage'; from: string; to: string } | { type: 'ai-paused'; source: 'whatsapp' | 'inbox' };
  id: string;
  direction: WhatsAppMessageDirection;
  content: string;
  sentAt: string;
  sender: string;
  status?: 'sent' | 'delivered' | 'read';
}

export interface WhatsAppTimelineEvent {
  id: string;
  title: string;
  detail: string;
  occurredAt: string;
}

export interface WhatsAppContactProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  stageId: string;
  stage: string;
  interest: string;
  budget: string;
  assignee: string;
  tags: string[];
  notes: string[];
  timeline: WhatsAppTimelineEvent[];
}
