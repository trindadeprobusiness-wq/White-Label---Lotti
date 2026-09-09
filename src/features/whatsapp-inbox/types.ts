export type WhatsAppServiceMode = 'ai' | 'human' | 'paused';
export type WhatsAppMessageDirection = 'incoming' | 'outgoing';

export interface WhatsAppConversation {
  id: string;
  contactId: string;
  contactName: string;
  phone: string;
  avatar: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  serviceMode: WhatsAppServiceMode;
  status: 'open' | 'waiting';
  assignee: string;
}

export interface WhatsAppMessage {
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
  stage: string;
  interest: string;
  budget: string;
  assignee: string;
  tags: string[];
  notes: string[];
  timeline: WhatsAppTimelineEvent[];
}
