export interface AIConversation {
  id: string;
  corretor_id: string;
  title: string;
  model: string;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface AIMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: AIToolCall[] | null;
  tool_name?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  attachment?: AIAttachment | null;
}

export interface AIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AIAttachment {
  id: string;
  message_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  extracted_text?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export type AIActionType =
  | 'create_client'
  | 'update_client_status'
  | 'schedule_followup'
  | 'create_alert'
  | 'register_contact';

export interface AISuggestedAction {
  id: string;
  action_type: AIActionType;
  params: Record<string, unknown>;
  description: string;
  status: 'pending' | 'confirmed' | 'rejected';
}

export interface AIStreamChunk {
  type: 'text' | 'tool_call' | 'action' | 'done' | 'error';
  content?: string;
  action?: AISuggestedAction;
  error?: string;
}

export const AI_FILE_LIMITS: Record<string, number> = {
  'application/pdf': 10 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 10 * 1024 * 1024,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 10 * 1024 * 1024,
  'text/csv': 10 * 1024 * 1024,
  'text/plain': 5 * 1024 * 1024,
  'image/*': 10 * 1024 * 1024,
  'video/*': 50 * 1024 * 1024,
};

export const AI_ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
];
