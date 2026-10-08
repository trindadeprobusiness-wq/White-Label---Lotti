import { useQuery } from '@tanstack/react-query';
import { chamarRpc, tabelaAdmin } from '@/lib/admin/api';
import { useAuth } from '@/hooks/useAuth';

export type DiagnosticStatus = 'started' | 'contact_captured' | 'in_progress' | 'completed' | 'abandoned';
export interface DiagnosticLead {
  id: string; name: string; phone: string | null; email: string | null;
  company: string | null; segment: string | null; city: string | null;
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
    queryFn: () => chamarRpc<DiagnosticList>('diagnostic_admin_list', {
      _search: filters.search.trim() || null, _status: filters.status || null,
      _temperature: filters.temperature || null, _segment: filters.segment || null,
      _source: filters.source || null, _offset: (filters.page - 1) * DIAGNOSTICS_PAGE_SIZE,
      _limit: DIAGNOSTICS_PAGE_SIZE,
    }),
    staleTime: 15_000, retry: false,
  });
}

export function useDiagnosticDetail(id?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['admin', 'diagnostics', user?.id, 'detail', id], enabled: !!user && !!id,
    queryFn: async (): Promise<DiagnosticDetail> => {
      // Select explicit columns: session credentials never leave the server.
      const results = await Promise.all([
        tabelaAdmin('diagnostic_sessions').select('id,lead_id,status,source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referrer,started_at,last_activity_at,completed_at,score,temperature,lead:diagnostic_leads(id,name,phone,email,company,segment,city)').eq('id', id).single(),
        tabelaAdmin('diagnostic_answers').select('id,question_id,question,answer,position,created_at').eq('session_id', id).order('position'),
        tabelaAdmin('diagnostic_events').select('id,event_type,metadata,created_at').eq('session_id', id).order('created_at').limit(200),
        tabelaAdmin('diagnostic_summaries').select('summary,primary_bottleneck,secondary_bottleneck,recommended_next_step,source').eq('session_id', id).maybeSingle(),
        tabelaAdmin('diagnostic_notifications').select('id,kind,status,attempts,sent_at,last_error').eq('session_id', id).order('kind'),
      ]);
      for (const result of results) if (result.error) throw new Error('Não foi possível carregar este diagnóstico. Confira seu acesso e a instalação do módulo.');
      const [session, answers, events, summary, notifications] = results;
      return { session: session.data, answers: answers.data, events: events.data, summary: summary.data, notifications: notifications.data } as unknown as DiagnosticDetail;
    }, retry: false,
  });
}
