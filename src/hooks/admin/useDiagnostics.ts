import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { diagnosticAdminRequest } from '@/features/diagnostic/admin-api';
import { useAuth } from '@/hooks/useAuth';
import type { FollowUpStatus } from '@/features/diagnostic/contact-links';

export type DiagnosticStatus = 'started' | 'contact_captured' | 'in_progress' | 'completed' | 'abandoned';
export interface DiagnosticLead {
  id: string; name: string; phone: string | null; email: string | null;
  company: string | null; segment: string | null; city: string | null;
  follow_up_status: FollowUpStatus; follow_up_notes?: string; last_contact_at: string | null;
}
export interface DiagnosticRow {
  id: string; lead_id: string | null; status: DiagnosticStatus; source: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  utm_content: string | null; utm_term: string | null; referrer: string | null;
  started_at: string; last_activity_at: string; completed_at: string | null;
  score: number | null; temperature: 'COLD' | 'WARM' | 'HOT' | null;
  lead: DiagnosticLead | null;
}
export interface DiagnosticFilters { search: string; status: string; temperature: string; segment: string; source: string; page: number }
export interface DiagnosticList {
  items: DiagnosticRow[]; total: number;
  metrics: { started: number; contacts: number; completed: number; abandoned: number; hot: number; warm: number; cold: number; cta: number };
  sources: string[]; dropoff: { question_id: string; count: number }[];
  source_quality: { source: string; total: number; hot: number; warm: number; cold: number }[];
}
export interface DiagnosticDetail {
  session: DiagnosticRow;
  answers: { id: string; question_id: string; question: string; answer: string | string[]; position: number; created_at: string }[];
  events: { id: string; event_type: string; metadata: Record<string, unknown>; created_at: string }[];
  summary: { summary: string; primary_bottleneck: string; secondary_bottleneck: string | null; recommended_next_step: string; source: string } | null;
  notifications: { id: string; kind: string; status: string; attempts: number; sent_at: string | null; last_error: string | null }[];
}
export const DIAGNOSTICS_PAGE_SIZE = 25;
export const diagnosticStatusLabels: Record<DiagnosticStatus, string> = {
  started: 'Iniciado', contact_captured: 'Contato capturado', in_progress: 'Em andamento', completed: 'Concluído', abandoned: 'Abandonado',
};

export function useDiagnostics(filters: DiagnosticFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['admin', 'diagnostics', user?.id, filters], enabled: !!user,
    queryFn: () => diagnosticAdminRequest<DiagnosticList>({ action: 'list', filters }),
    staleTime: 15_000, refetchInterval: 30_000, retry: false,
  });
}

export function useDiagnosticDetail(id?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['admin', 'diagnostics', user?.id, 'detail', id], enabled: !!user && !!id,
    queryFn: () => diagnosticAdminRequest<DiagnosticDetail>({ action: 'detail', session_id: id }), retry: false,
  });
}

export function useDiagnosticFollowUp(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ status, notes }: { status: FollowUpStatus; notes: string }) => diagnosticAdminRequest<DiagnosticLead>({ action: 'follow_up', session_id: sessionId, status, notes }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'diagnostics'] }),
  });
}
