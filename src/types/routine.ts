export type RoutineView = 'day' | 'week' | 'month' | 'list';
export type RoutineScope = 'mine' | 'team';
export type RoutinePriority = 'low' | 'medium' | 'high' | 'urgent';
export type RoutineVisibility = 'team' | 'private';
export type RoutineSource = 'lotti' | 'google' | 'automation' | 'ai' | 'other_user';

export type RoutineRole =
  | 'proprietario'
  | 'administrador'
  | 'gestor'
  | 'corretor'
  | 'financeiro'
  | 'juridico'
  | 'colaborador';

export interface RoutineOrganization {
  id: string;
  legacy_corretor_id: string;
  name: string;
  timezone: string;
}

export interface RoutineMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: RoutineRole;
  status: 'invited' | 'active' | 'suspended' | 'revoked';
  team_name: string | null;
  unit_name: string | null;
  display_name: string | null;
}

export interface RoutineEvent {
  id: string;
  organization_id: string;
  assigned_to: string;
  created_by: string;
  title: string;
  description: string | null;
  activity_type: string;
  status: 'draft' | 'pending_confirmation' | 'confirmed' | 'completed' | 'cancelled';
  priority: RoutinePriority;
  start_at: string;
  end_at: string;
  all_day: boolean;
  timezone: string;
  recurrence_rule: string | null;
  location: string | null;
  visibility: RoutineVisibility;
  source: RoutineSource;
  client_id: string | null;
  property_id: string | null;
  deal_id: string | null;
  contract_id: string | null;
  rental_id: string | null;
  sync_status: 'local' | 'pending' | 'synced' | 'conflict' | 'error';
  sync_version: number;
  completed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  occurrence_id?: string;
  recurrence_parent_id?: string;
}

export interface RoutineTask {
  id: string;
  organization_id: string;
  assigned_to: string;
  created_by: string;
  title: string;
  description: string | null;
  activity_type: string;
  status: 'todo' | 'in_progress' | 'completed' | 'cancelled';
  priority: RoutinePriority;
  due_at: string | null;
  estimated_minutes: number | null;
  timezone: string;
  recurrence_rule: string | null;
  visibility: RoutineVisibility;
  source: RoutineSource | 'inbox';
  client_id: string | null;
  property_id: string | null;
  deal_id: string | null;
  contract_id: string | null;
  rental_id: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoutineActivity {
  id: number;
  actor_user_id: string | null;
  entity_type: 'event' | 'task' | string;
  entity_id: string;
  action: string;
  changes: Record<string, unknown>;
  source: string;
  created_at: string;
}

export interface RoutineInboxItem {
  id: string;
  organization_id: string;
  user_id: string;
  kind: 'idea' | 'note' | 'request' | 'task' | 'audio' | 'message' | 'service_extract';
  content: string;
  attachment_url: string | null;
  status: 'unprocessed' | 'proposed' | 'converted' | 'archived';
  extracted_data: Record<string, unknown>;
  converted_event_id: string | null;
  converted_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalCalendar {
  id: string;
  connection_id: string;
  external_calendar_id: string;
  summary: string;
  color: string | null;
  access_role: string | null;
  selected: boolean;
  is_primary: boolean;
  is_default: boolean;
  sync_direction: 'import_only' | 'export_only' | 'bidirectional' | 'disabled';
}

export interface CalendarConnectionStatus {
  connected: boolean;
  status: 'not_connected' | 'pending' | 'connected' | 'expired' | 'error' | 'disconnected';
  provider_email?: string | null;
  privacy_mode?: 'full' | 'partial' | 'busy_only';
  last_sync_at?: string | null;
  last_error_code?: string | null;
}

export interface RoutineCommandProposal {
  kind: 'event' | 'task';
  title: string;
  activity_type: string;
  start_at: string | null;
  end_at: string | null;
  due_at: string | null;
  client_query: string | null;
  client_id: string | null;
  property_query: string | null;
  property_id: string | null;
  location: string | null;
  assigned_to: string | null;
  reminder_minutes: number | null;
  priority: RoutinePriority;
  missing_fields: string[];
  requires_confirmation: true;
  conflicts: Array<{
    event_id: string;
    title: string;
    start_at: string;
    end_at: string;
    is_private: boolean;
  }>;
  interpretation_source: 'ai' | 'local';
}

export interface RoutineDraft {
  kind: 'event' | 'task';
  title: string;
  description?: string | null;
  activity_type: string;
  priority: RoutinePriority;
  assigned_to: string;
  visibility: RoutineVisibility;
  start_at?: string | null;
  end_at?: string | null;
  due_at?: string | null;
  all_day?: boolean;
  recurrence_rule?: string | null;
  location?: string | null;
  client_id?: string | null;
  property_id?: string | null;
  reminder_minutes?: number | null;
  source?: RoutineSource;
}
