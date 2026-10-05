import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { apiDisponivel } from '@/lib/api';
import * as rotinaApi from '@/lib/api/rotina';
import { mensagemDeErro } from '@/lib/errors';
import { expandRecurringEvents, type DateRange } from '@/lib/routine/calendar';
import type {
  CalendarConnectionStatus,
  ExternalCalendar,
  RoutineActivity,
  RoutineDraft,
  RoutineEvent,
  RoutineInboxItem,
  RoutineMember,
  RoutineOrganization,
  RoutineScope,
  RoutineTask,
} from '@/types/routine';

const db = () => supabase as unknown as SupabaseClient;

const routineKeys = {
  root: ['routine'] as const,
  context: () => [...routineKeys.root, 'context'] as const,
  members: (org?: string) => [...routineKeys.root, 'members', org] as const,
  events: (org: string | undefined, start: string, end: string, scope: RoutineScope, member?: string) =>
    [...routineKeys.root, 'events', org, start, end, scope, member] as const,
  tasks: (org?: string) => [...routineKeys.root, 'tasks', org] as const,
  activity: (org?: string) => [...routineKeys.root, 'activity', org] as const,
  inbox: (org?: string) => [...routineKeys.root, 'inbox', org] as const,
  connection: (org?: string) => [...routineKeys.root, 'google', 'connection', org] as const,
  calendars: (org?: string) => [...routineKeys.root, 'google', 'calendars', org] as const,
};

export interface RoutineContext {
  organization: RoutineOrganization;
  membership: RoutineMember;
}

export function useRoutineContext() {
  const { user } = useAuth();
  return useQuery({
    queryKey: routineKeys.context(),
    enabled: !!user,
    retry: false,
    queryFn: async (): Promise<RoutineContext | null> => {
      if (apiDisponivel()) return rotinaApi.contextoRotinaApi();
      const { data, error } = await db()
        .from('routine_memberships')
        .select('*, routine_organizations(*)')
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') return null;
        throw error;
      }
      if (!data) return null;
      const organization = Array.isArray(data.routine_organizations)
        ? data.routine_organizations[0]
        : data.routine_organizations;
      if (!organization) return null;
      const { routine_organizations: _ignored, ...membership } = data;
      return {
        organization: organization as RoutineOrganization,
        membership: membership as RoutineMember,
      };
    },
  });
}

export function useRoutineMembers(context?: RoutineContext | null) {
  return useQuery({
    queryKey: routineKeys.members(context?.organization.id),
    enabled: !!context,
    queryFn: async (): Promise<RoutineMember[]> => {
      if (apiDisponivel()) return rotinaApi.listarMembrosApi();
      const { data, error } = await db().from('routine_memberships')
        .select('*')
        .eq('organization_id', context!.organization.id)
        .eq('status', 'active')
        .order('display_name');
      if (error) throw error;
      return (data ?? []) as RoutineMember[];
    },
  });
}

export function useRoutineEvents(
  context: RoutineContext | null | undefined,
  range: DateRange,
  scope: RoutineScope,
  memberId?: string,
) {
  const { user } = useAuth();
  const start = range.start.toISOString();
  const end = range.end.toISOString();
  return useQuery({
    queryKey: routineKeys.events(context?.organization.id, start, end, scope, memberId),
    enabled: !!context && !!user,
    queryFn: async (): Promise<RoutineEvent[]> => {
      if (apiDisponivel()) {
        const responsavel = memberId || (scope === 'mine' ? user!.id : undefined);
        return expandRecurringEvents(await rotinaApi.listarEventosApi({ inicio: start, fim: end, responsavel }), range);
      }
      const base = () => {
        let query = db().from('routine_events').select('*')
          .eq('organization_id', context!.organization.id)
          .is('deleted_at', null);
        const assignee = memberId || (scope === 'mine' ? user!.id : undefined);
        if (assignee) query = query.eq('assigned_to', assignee);
        return query;
      };

      const [inside, recurring] = await Promise.all([
        base().lte('start_at', end).gte('end_at', start).order('start_at'),
        base().not('recurrence_rule', 'is', null).lte('start_at', end).order('start_at'),
      ]);
      if (inside.error) throw inside.error;
      if (recurring.error) throw recurring.error;
      const merged = new Map<string, RoutineEvent>();
      [...(inside.data ?? []), ...(recurring.data ?? [])]
        .forEach((item) => merged.set(item.id, item as RoutineEvent));
      return expandRecurringEvents([...merged.values()], range);
    },
  });
}

export function useRoutineTasks(context?: RoutineContext | null, scope: RoutineScope = 'mine', memberId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...routineKeys.tasks(context?.organization.id), scope, memberId, user?.id] as const,
    enabled: !!context && !!user,
    queryFn: async (): Promise<RoutineTask[]> => {
      if (apiDisponivel()) {
        return rotinaApi.listarTarefasApi({ responsavel: memberId || (scope === 'mine' ? user!.id : undefined) });
      }
      let query = db().from('routine_tasks').select('*')
        .eq('organization_id', context!.organization.id)
        .is('deleted_at', null)
        .order('due_at', { nullsFirst: false });
      const assignee = memberId || (scope === 'mine' ? user!.id : undefined);
      if (assignee) query = query.eq('assigned_to', assignee);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as RoutineTask[];
    },
  });
}

export function useRoutineActivity(context?: RoutineContext | null) {
  return useQuery({
    queryKey: routineKeys.activity(context?.organization.id),
    enabled: !!context,
    queryFn: async (): Promise<RoutineActivity[]> => {
      if (apiDisponivel()) return rotinaApi.listarAtividadeApi();
      const { data, error } = await db().from('routine_activity_log').select('*')
        .eq('organization_id', context!.organization.id)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as RoutineActivity[];
    },
  });
}

export function useRoutineInbox(context?: RoutineContext | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: routineKeys.inbox(context?.organization.id),
    enabled: !!context && !!user,
    queryFn: async (): Promise<RoutineInboxItem[]> => {
      if (apiDisponivel()) return rotinaApi.listarInboxApi();
      const { data, error } = await db().from('routine_inbox').select('*')
        .eq('organization_id', context!.organization.id)
        .eq('user_id', user!.id)
        .eq('status', 'unprocessed')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as RoutineInboxItem[];
    },
  });

  const add = useMutation({
    mutationFn: async ({ content, kind = 'note' }: { content: string; kind?: RoutineInboxItem['kind'] }) => {
      if (!context || !user) throw new Error('Contexto da Rotina indisponível.');
      if (apiDisponivel()) {
        await rotinaApi.criarInboxApi({ content: content.trim(), kind });
        return;
      }
      const { error } = await db().from('routine_inbox').insert({
        organization_id: context.organization.id,
        user_id: user.id,
        kind,
        content: content.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: routineKeys.inbox(context?.organization.id) }),
    onError: (error) => toast.error(mensagemDeErro(error, 'Não foi possível guardar essa anotação.')),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      if (apiDisponivel()) return rotinaApi.arquivarInboxApi(id);
      const { error } = await db().from('routine_inbox').update({ status: 'archived' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: routineKeys.inbox(context?.organization.id) }),
  });

  return { query, add, archive };
}

async function registerCompletionInCrm(item: RoutineEvent | RoutineTask) {
  if (!item.client_id) return;
  const { error } = await db().rpc('routine_register_completion', {
    p_item_type: 'start_at' in item ? 'event' : 'task',
    p_item_id: item.id,
  });
  if (error) {
    console.warn('Conclusão salva, mas o histórico do CRM não pôde ser atualizado:', error.code);
  }
}

async function pushEventToGoogle(eventId: string) {
  const { error } = await supabase.functions.invoke('google-calendar-sync', {
    body: { action: 'push_event', event_id: eventId },
  });
  if (error) console.warn('Evento salvo; sincronização Google ficou pendente.');
}

/**
 * Criação pela API: conflito, insert, lembrete e push para o Google ficam no
 * servidor, numa transação. Os campos saem normalizados como no insert do Supabase.
 */
async function criarPelaApi(draft: RoutineDraft): Promise<RoutineEvent | RoutineTask> {
  const comum = {
    title: draft.title,
    description: draft.description || null,
    activity_type: draft.activity_type,
    priority: draft.priority,
    assigned_to: draft.assigned_to,
    visibility: draft.visibility,
    recurrence_rule: draft.recurrence_rule || null,
    source: draft.source || 'lotti',
    client_id: draft.client_id || null,
    property_id: draft.property_id || null,
  };
  if (draft.kind === 'event') {
    if (!draft.start_at || !draft.end_at) throw new Error('Informe início e fim do compromisso.');
    return rotinaApi.criarEventoApi({
      ...comum,
      start_at: draft.start_at,
      end_at: draft.end_at,
      all_day: !!draft.all_day,
      location: draft.location || null,
      reminder_minutes: draft.reminder_minutes ?? null,
    });
  }
  return rotinaApi.criarTarefaApi({ ...comum, due_at: draft.due_at || null });
}

export function useRoutineActions(context?: RoutineContext | null) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: routineKeys.root }),
      qc.invalidateQueries({ queryKey: ['crm'] }),
    ]);
  };

  const create = useMutation({
    mutationFn: async (draft: RoutineDraft) => {
      if (!context || !user) throw new Error('Contexto da Rotina indisponível.');
      if (apiDisponivel()) return criarPelaApi(draft);
      if (draft.kind === 'event') {
        if (!draft.start_at || !draft.end_at) throw new Error('Informe início e fim do compromisso.');
        const { data: conflicts, error: conflictError } = await db().rpc('routine_detect_conflicts', {
          p_assigned_to: draft.assigned_to,
          p_start_at: draft.start_at,
          p_end_at: draft.end_at,
          p_exclude_event_id: null,
        });
        if (conflictError) throw conflictError;
        if (conflicts?.length) {
          const error = new Error('CONFLICT');
          (error as Error & { conflicts?: unknown[] }).conflicts = conflicts;
          throw error;
        }
        const { data, error } = await db().from('routine_events').insert({
          organization_id: context.organization.id,
          assigned_to: draft.assigned_to,
          created_by: user.id,
          title: draft.title,
          description: draft.description || null,
          activity_type: draft.activity_type,
          priority: draft.priority,
          start_at: draft.start_at,
          end_at: draft.end_at,
          all_day: !!draft.all_day,
          timezone: context.organization.timezone,
          recurrence_rule: draft.recurrence_rule || null,
          location: draft.location || null,
          visibility: draft.visibility,
          source: draft.source || 'lotti',
          client_id: draft.client_id || null,
          property_id: draft.property_id || null,
          sync_status: 'pending',
        }).select('*').single();
        if (error) throw error;
        if (draft.reminder_minutes != null) {
          await db().from('routine_reminders').insert({
            organization_id: context.organization.id,
            user_id: draft.assigned_to,
            event_id: data.id,
            remind_at: new Date(new Date(draft.start_at).getTime() - draft.reminder_minutes * 60_000).toISOString(),
            minutes_before: draft.reminder_minutes,
          });
        }
        void pushEventToGoogle(data.id);
        return data as RoutineEvent;
      }

      const { data, error } = await db().from('routine_tasks').insert({
        organization_id: context.organization.id,
        assigned_to: draft.assigned_to,
        created_by: user.id,
        title: draft.title,
        description: draft.description || null,
        activity_type: draft.activity_type,
        priority: draft.priority,
        due_at: draft.due_at || null,
        timezone: context.organization.timezone,
        recurrence_rule: draft.recurrence_rule || null,
        visibility: draft.visibility,
        source: draft.source || 'lotti',
        client_id: draft.client_id || null,
        property_id: draft.property_id || null,
      }).select('*').single();
      if (error) throw error;
      return data as RoutineTask;
    },
    onSuccess: async () => {
      toast.success('Atividade criada.');
      await refresh();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'CONFLICT') {
        toast.warning('Existe outro compromisso nesse horário. Escolha um horário livre.');
      } else {
        toast.error(mensagemDeErro(error, 'Não foi possível criar a atividade.'));
      }
    },
  });

  const updateEvent = useMutation({
    mutationFn: async ({ id, patch, expectedUpdatedAt }: {
      id: string;
      patch: Partial<RoutineEvent>;
      expectedUpdatedAt?: string;
    }) => {
      if (apiDisponivel()) return rotinaApi.editarEventoApi(id, patch, expectedUpdatedAt);
      let query = db().from('routine_events').update(patch).eq('id', id);
      if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
      const { data, error } = await query.select('*').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('CONCURRENCY_CONFLICT');
      void pushEventToGoogle(id);
      return data as RoutineEvent;
    },
    onSuccess: refresh,
    onError: (error) => toast.error(
      error instanceof Error && error.message === 'CONCURRENCY_CONFLICT'
        ? 'Esse compromisso mudou em outro lugar. A agenda foi recarregada.'
        : mensagemDeErro(error, 'Não foi possível atualizar o compromisso.'),
    ),
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, patch, expectedUpdatedAt }: {
      id: string;
      patch: Partial<RoutineTask>;
      expectedUpdatedAt?: string;
    }) => {
      if (apiDisponivel()) return rotinaApi.editarTarefaApi(id, patch, expectedUpdatedAt);
      let query = db().from('routine_tasks').update(patch).eq('id', id);
      if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
      const { data, error } = await query.select('*').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('CONCURRENCY_CONFLICT');
      return data as RoutineTask;
    },
    onSuccess: refresh,
    onError: (error) => toast.error(
      error instanceof Error && error.message === 'CONCURRENCY_CONFLICT'
        ? 'Essa tarefa mudou em outro lugar. A rotina foi recarregada.'
        : mensagemDeErro(error, 'Não foi possível atualizar a tarefa.'),
    ),
  });

  const complete = useMutation({
    mutationFn: async (item: RoutineEvent | RoutineTask) => {
      if (apiDisponivel()) return rotinaApi.concluirItemApi('start_at' in item ? 'event' : 'task', item.id);
      const completedAt = new Date().toISOString();
      const table = 'start_at' in item ? 'routine_events' : 'routine_tasks';
      const { data, error } = await db().from(table).update({
        status: 'completed', completed_at: completedAt,
      }).eq('id', item.id).select('*').single();
      if (error) throw error;
      await registerCompletionInCrm(data as RoutineEvent | RoutineTask);
      if (table === 'routine_events') void pushEventToGoogle(item.id);
      return data;
    },
    onSuccess: async () => { toast.success('Atividade concluída e registrada.'); await refresh(); },
    onError: (error) => toast.error(mensagemDeErro(error, 'Não foi possível concluir a atividade.')),
  });

  const remove = useMutation({
    mutationFn: async (item: RoutineEvent | RoutineTask) => {
      if (apiDisponivel()) return rotinaApi.removerItemApi('start_at' in item ? 'event' : 'task', item.id);
      const table = 'start_at' in item ? 'routine_events' : 'routine_tasks';
      const { error } = await db().from(table).update({ deleted_at: new Date().toISOString() }).eq('id', item.id);
      if (error) throw error;
      if (table === 'routine_events') void pushEventToGoogle(item.id);
    },
    onSuccess: async () => { toast.success('Atividade removida.'); await refresh(); },
    onError: (error) => toast.error(mensagemDeErro(error, 'Não foi possível remover a atividade.')),
  });

  const resolveSyncConflict = useMutation({
    mutationFn: async ({ eventId, strategy }: { eventId: string; strategy: 'lotti' | 'google' }) => {
      if (apiDisponivel()) {
        await rotinaApi.sincronizarGoogleApi(`resolve_conflict_${strategy}`, eventId);
        return;
      }
      const { error } = await supabase.functions.invoke('google-calendar-sync', {
        body: { action: `resolve_conflict_${strategy}`, event_id: eventId },
      });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success('Conflito de sincronização resolvido.'); await refresh(); },
    onError: (error) => toast.error(mensagemDeErro(error, 'Não foi possível resolver o conflito.')),
  });

  const checkConflicts = async (assignedTo: string, startAt: string, endAt: string, excludeId?: string) => {
    if (apiDisponivel()) {
      return rotinaApi.detectarConflitosApi({
        assigned_to: assignedTo, start_at: startAt, end_at: endAt, exclude_event_id: excludeId || null,
      });
    }
    const { data, error } = await db().rpc('routine_detect_conflicts', {
      p_assigned_to: assignedTo,
      p_start_at: startAt,
      p_end_at: endAt,
      p_exclude_event_id: excludeId || null,
    });
    if (error) throw error;
    return data ?? [];
  };

  return { create, updateEvent, updateTask, complete, remove, resolveSyncConflict, checkConflicts };
}

export function useGoogleCalendarConnection(context?: RoutineContext | null) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: routineKeys.connection(context?.organization.id),
    enabled: !!context,
    retry: false,
    queryFn: async (): Promise<CalendarConnectionStatus> => {
      if (apiDisponivel()) return rotinaApi.statusGoogleApi();
      const { data, error } = await supabase.functions.invoke('google-calendar-auth', {
        body: { action: 'status' },
      });
      if (error) throw error;
      return data as CalendarConnectionStatus;
    },
  });

  const calendars = useQuery({
    queryKey: routineKeys.calendars(context?.organization.id),
    enabled: !!context && status.data?.connected,
    queryFn: async (): Promise<ExternalCalendar[]> => {
      if (apiDisponivel()) return rotinaApi.listarCalendariosApi();
      const { data, error } = await db().from('external_calendars').select('*')
        .eq('organization_id', context!.organization.id)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ExternalCalendar[];
    },
  });

  const connect = useMutation({
    mutationFn: async () => {
      if (apiDisponivel()) {
        const { authorization_url } = await rotinaApi.conectarGoogleApi();
        if (!authorization_url) throw new Error('URL de autorização ausente.');
        window.location.assign(authorization_url);
        return;
      }
      const { data, error } = await supabase.functions.invoke('google-calendar-auth', {
        body: { action: 'start' },
      });
      if (error || !data?.authorization_url) throw error || new Error('URL de autorização ausente.');
      window.location.assign(data.authorization_url);
    },
    onError: (error) => toast.error(mensagemDeErro(error, 'Não foi possível iniciar a conexão com o Google.')),
  });

  const sync = useMutation({
    mutationFn: async () => {
      if (apiDisponivel()) return rotinaApi.sincronizarGoogleApi('sync');
      const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
        body: { action: 'sync' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success('Google Agenda sincronizado.');
      await qc.invalidateQueries({ queryKey: routineKeys.root });
    },
    onError: (error) => toast.error(mensagemDeErro(error, 'Não foi possível sincronizar agora.')),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (apiDisponivel()) {
        await rotinaApi.desconectarGoogleApi();
        return;
      }
      const { error } = await supabase.functions.invoke('google-calendar-auth', {
        body: { action: 'disconnect' },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success('Google Agenda desconectado e credenciais removidas.');
      await qc.invalidateQueries({ queryKey: routineKeys.root });
    },
    onError: (error) => toast.error(mensagemDeErro(error, 'Não foi possível desconectar o Google Agenda.')),
  });

  const configureCalendar = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ExternalCalendar> }) => {
      if (apiDisponivel()) {
        await rotinaApi.configurarCalendarioApi(id, patch);
        return;
      }
      if (patch.is_default) {
        const { error: clearError } = await db().from('external_calendars')
          .update({ is_default: false })
          .eq('organization_id', context!.organization.id);
        if (clearError) throw clearError;
      }
      const { error } = await db().from('external_calendars').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: routineKeys.calendars(context?.organization.id) }),
  });

  const configurePrivacy = useMutation({
    mutationFn: async (privacyMode: 'full' | 'partial' | 'busy_only') => {
      if (apiDisponivel()) {
        await rotinaApi.configurarPrivacidadeApi(privacyMode);
        return;
      }
      const { error } = await supabase.functions.invoke('google-calendar-auth', {
        body: { action: 'configure', privacy_mode: privacyMode },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: routineKeys.connection(context?.organization.id) }),
    onError: (error) => toast.error(mensagemDeErro(error, 'Não foi possível atualizar a privacidade.')),
  });

  return { status, calendars, connect, sync, disconnect, configureCalendar, configurePrivacy };
}
