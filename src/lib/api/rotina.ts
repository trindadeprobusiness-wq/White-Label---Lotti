import { chamarApi } from '@/lib/api';
import type {
  CalendarConnectionStatus,
  ExternalCalendar,
  RoutineActivity,
  RoutineEvent,
  RoutineInboxItem,
  RoutineMember,
  RoutineOrganization,
  RoutineTask,
} from '@/types/routine';
import { corpoJson, escolher, lerErroApi } from './http';

// Rotina (agenda, tarefas, inbox e Google Agenda) pela API Lotti. Só é chamado
// atrás de apiDisponivel(). As listas de chaves espelham os DTOs da API: chave
// fora delas dá 400, então o front só manda as aceitas.

export const CHAVES_CRIAR_EVENTO = [
  'title', 'description', 'activity_type', 'priority', 'assigned_to', 'visibility', 'start_at', 'end_at',
  'all_day', 'recurrence_rule', 'location', 'source', 'client_id', 'property_id', 'reminder_minutes',
] as const;
export const CHAVES_CRIAR_TAREFA = [
  'title', 'description', 'activity_type', 'priority', 'assigned_to', 'visibility', 'due_at',
  'recurrence_rule', 'source', 'client_id', 'property_id',
] as const;
export const CHAVES_EDITAR_EVENTO = [
  'title', 'description', 'activity_type', 'priority', 'assigned_to', 'visibility', 'start_at', 'end_at',
  'all_day', 'recurrence_rule', 'location', 'client_id', 'property_id',
] as const;
export const CHAVES_EDITAR_TAREFA = [
  'title', 'description', 'activity_type', 'priority', 'assigned_to', 'visibility', 'due_at',
  'recurrence_rule', 'client_id', 'property_id',
] as const;
export const CHAVES_CONFIGURAR_CALENDARIO = ['selected', 'is_default', 'sync_direction'] as const;

type Linha = Record<string, unknown>;
export type TipoItemRotina = 'event' | 'task';
export type AcaoSyncGoogle = 'sync' | 'push_event' | 'resolve_conflict_lotti' | 'resolve_conflict_google';
export interface ConflitoRotina { event_id: string; title: string; start_at: string; end_at: string; is_private: boolean }

/**
 * Como lerJson, mas relança CONFLICT e CONCURRENCY_CONFLICT como os Error que
 * useRoutine.ts já compara em `error.message` (http.ts não conhece esses códigos).
 */
async function ler<T>(res: Response, padrao: string): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  let corpo: Record<string, unknown> = {};
  try { corpo = ((await res.clone().json()) ?? {}) as Record<string, unknown>; } catch { /* sem corpo */ }
  if (corpo.codigo === 'CONFLICT') {
    throw Object.assign(new Error('CONFLICT'), { conflicts: Array.isArray(corpo.conflicts) ? corpo.conflicts : [] });
  }
  if (corpo.codigo === 'CONCURRENCY_CONFLICT') throw new Error('CONCURRENCY_CONFLICT');
  throw await lerErroApi(res, padrao);
}

const id = (v: string) => encodeURIComponent(v);
const rotaItem = (tipo: TipoItemRotina, itemId: string) =>
  `/api/rotina/${tipo === 'event' ? 'eventos' : 'tarefas'}/${id(itemId)}`;

// ── routine_* ────────────────────────────────────────────────────────────

export async function contextoRotinaApi(): Promise<{ organization: RoutineOrganization; membership: RoutineMember } | null> {
  return ler(await chamarApi('/api/rotina/contexto'), 'Não foi possível carregar a rotina.');
}

export async function listarMembrosApi(): Promise<RoutineMember[]> {
  return ler(await chamarApi('/api/rotina/membros'), 'Não foi possível carregar a equipe.');
}

export async function listarEventosApi(q: { inicio: string; fim: string; responsavel?: string }): Promise<RoutineEvent[]> {
  const params = new URLSearchParams({ inicio: q.inicio, fim: q.fim });
  if (q.responsavel) params.set('responsavel', q.responsavel);
  return ler(await chamarApi(`/api/rotina/eventos?${params.toString()}`), 'Não foi possível carregar a agenda.');
}

export async function listarTarefasApi(q: { responsavel?: string } = {}): Promise<RoutineTask[]> {
  const busca = q.responsavel ? `?${new URLSearchParams({ responsavel: q.responsavel }).toString()}` : '';
  return ler(await chamarApi(`/api/rotina/tarefas${busca}`), 'Não foi possível carregar as tarefas.');
}

export async function listarAtividadeApi(): Promise<RoutineActivity[]> {
  return ler(await chamarApi('/api/rotina/atividade'), 'Não foi possível carregar a atividade.');
}

export async function listarInboxApi(): Promise<RoutineInboxItem[]> {
  return ler(await chamarApi('/api/rotina/inbox'), 'Não foi possível carregar as anotações.');
}

export async function criarInboxApi(dados: { content: string; kind?: RoutineInboxItem['kind'] }): Promise<RoutineInboxItem> {
  return ler(
    await chamarApi('/api/rotina/inbox', corpoJson('POST', escolher(dados, ['content', 'kind'] as const))),
    'Não foi possível guardar essa anotação.',
  );
}

export async function arquivarInboxApi(inboxId: string): Promise<void> {
  await ler(await chamarApi(`/api/rotina/inbox/${id(inboxId)}/arquivar`, corpoJson('POST')), 'Não foi possível arquivar a anotação.');
}

export async function detectarConflitosApi(dados: {
  assigned_to: string; start_at: string; end_at: string; exclude_event_id?: string | null;
}): Promise<ConflitoRotina[]> {
  return ler(
    await chamarApi('/api/rotina/conflitos', corpoJson('POST', {
      assigned_to: dados.assigned_to,
      start_at: dados.start_at,
      end_at: dados.end_at,
      exclude_event_id: dados.exclude_event_id ?? null,
    })),
    'Não foi possível verificar a agenda.',
  );
}

export async function criarEventoApi(dto: Linha): Promise<RoutineEvent> {
  const r = await ler<{ evento: RoutineEvent; lembrete_criado: boolean }>(
    await chamarApi('/api/rotina/eventos', corpoJson('POST', escolher(dto, CHAVES_CRIAR_EVENTO))),
    'Não foi possível criar a atividade.',
  );
  if (r.lembrete_criado === false && dto.reminder_minutes != null) {
    console.warn('Compromisso salvo, mas o lembrete não pôde ser criado.');
  }
  return r.evento;
}

export async function criarTarefaApi(dto: Linha): Promise<RoutineTask> {
  return ler(
    await chamarApi('/api/rotina/tarefas', corpoJson('POST', escolher(dto, CHAVES_CRIAR_TAREFA))),
    'Não foi possível criar a atividade.',
  );
}

function corpoEdicao(patch: object, chaves: readonly string[], expectedUpdatedAt?: string) {
  const corpo: Linha = escolher(patch, chaves);
  if (expectedUpdatedAt) corpo.expected_updated_at = expectedUpdatedAt;
  return corpo;
}

export async function editarEventoApi(eventoId: string, patch: object, expectedUpdatedAt?: string): Promise<RoutineEvent> {
  return ler(
    await chamarApi(rotaItem('event', eventoId), corpoJson('PATCH', corpoEdicao(patch, CHAVES_EDITAR_EVENTO, expectedUpdatedAt))),
    'Não foi possível atualizar o compromisso.',
  );
}

export async function editarTarefaApi(tarefaId: string, patch: object, expectedUpdatedAt?: string): Promise<RoutineTask> {
  return ler(
    await chamarApi(rotaItem('task', tarefaId), corpoJson('PATCH', corpoEdicao(patch, CHAVES_EDITAR_TAREFA, expectedUpdatedAt))),
    'Não foi possível atualizar a tarefa.',
  );
}

export async function concluirItemApi(tipo: TipoItemRotina, itemId: string): Promise<RoutineEvent | RoutineTask> {
  const r = await ler<{ item: RoutineEvent | RoutineTask; registrado_no_crm: boolean }>(
    await chamarApi(`${rotaItem(tipo, itemId)}/concluir`, corpoJson('POST')),
    'Não foi possível concluir a atividade.',
  );
  return r.item;
}

export async function removerItemApi(tipo: TipoItemRotina, itemId: string): Promise<void> {
  await ler(await chamarApi(rotaItem(tipo, itemId), corpoJson('DELETE')), 'Não foi possível remover a atividade.');
}

// ── Google Agenda ────────────────────────────────────────────────────────

export async function statusGoogleApi(): Promise<CalendarConnectionStatus> {
  return ler(await chamarApi('/api/rotina/google/status'), 'Não foi possível consultar o Google Agenda.');
}

export async function conectarGoogleApi(): Promise<{ authorization_url: string }> {
  return ler(await chamarApi('/api/rotina/google/conectar', corpoJson('POST')), 'Não foi possível iniciar a conexão com o Google.');
}

export async function desconectarGoogleApi(): Promise<{ disconnected: true; idempotent?: true }> {
  return ler(await chamarApi('/api/rotina/google/desconectar', corpoJson('POST')), 'Não foi possível desconectar o Google Agenda.');
}

export async function configurarPrivacidadeApi(modo: 'full' | 'partial' | 'busy_only'): Promise<{ configured: true; privacy_mode: string }> {
  return ler(
    await chamarApi('/api/rotina/google/privacidade', corpoJson('PATCH', { privacy_mode: modo })),
    'Não foi possível atualizar a privacidade.',
  );
}

export async function listarCalendariosApi(): Promise<ExternalCalendar[]> {
  return ler(await chamarApi('/api/rotina/google/calendarios'), 'Não foi possível carregar os calendários.');
}

export async function configurarCalendarioApi(calendarioId: string, patch: object): Promise<ExternalCalendar> {
  return ler(
    await chamarApi(`/api/rotina/google/calendarios/${id(calendarioId)}`,
      corpoJson('PATCH', escolher(patch, CHAVES_CONFIGURAR_CALENDARIO))),
    'Não foi possível atualizar o calendário.',
  );
}

export async function sincronizarGoogleApi(action: AcaoSyncGoogle = 'sync', eventId?: string): Promise<Linha> {
  return ler(
    await chamarApi('/api/rotina/google/sincronizar', corpoJson('POST', eventId ? { action, event_id: eventId } : { action })),
    'Não foi possível sincronizar agora.',
  );
}

// ── Comando por IA ───────────────────────────────────────────────────────

export async function interpretarComandoApi(command: string, timezone: string): Promise<{ proposal: unknown }> {
  return ler(
    await chamarApi('/api/rotina/comando', corpoJson('POST', { command, timezone })),
    'Não consegui interpretar agora.',
  );
}
