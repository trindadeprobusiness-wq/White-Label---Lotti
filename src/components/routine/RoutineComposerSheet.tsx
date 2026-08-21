import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  CheckCircle2, ExternalLink, Loader2, Map, MessageCircle, Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ROUTINE_CATEGORIES, getRoutineCategory } from '@/lib/routine/categories';
import type { RoutineContext } from '@/hooks/routine/useRoutine';
import type { RoutineDraft, RoutineEvent, RoutineMember, RoutinePriority, RoutineTask } from '@/types/routine';
import { RoutineCategoryIcon } from './RoutineCategoryIcon';

type ClientOption = { id: string; nome: string; telefone?: string | null };
type PropertyOption = { id: string; titulo: string; endereco?: string | null };
type RoutineItem = RoutineEvent | RoutineTask;

interface RoutineActions {
  create: { mutateAsync: (draft: RoutineDraft) => Promise<unknown>; isPending: boolean };
  updateEvent: { mutateAsync: (args: { id: string; patch: Partial<RoutineEvent>; expectedUpdatedAt?: string }) => Promise<unknown>; isPending: boolean };
  updateTask: { mutateAsync: (args: { id: string; patch: Partial<RoutineTask>; expectedUpdatedAt?: string }) => Promise<unknown>; isPending: boolean };
  complete: { mutateAsync: (item: RoutineItem) => Promise<unknown>; isPending: boolean };
  remove: { mutateAsync: (item: RoutineItem) => Promise<unknown>; isPending: boolean };
  resolveSyncConflict: { mutateAsync: (args: { eventId: string; strategy: 'lotti' | 'google' }) => Promise<unknown>; isPending: boolean };
  checkConflicts: (assignedTo: string, startAt: string, endAt: string, excludeId?: string) => Promise<Array<{ title: string; start_at: string; end_at: string }>>;
}

function toInputDate(value?: string | null): string {
  return value ? format(new Date(value), "yyyy-MM-dd'T'HH:mm") : '';
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function defaultDraft(assignedTo: string, initial?: Partial<RoutineDraft>): RoutineDraft {
  const start = initial?.start_at ? new Date(initial.start_at) : new Date(Date.now() + 60 * 60_000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  return {
    kind: initial?.kind ?? 'event',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    activity_type: initial?.activity_type ?? 'visita_imovel',
    priority: initial?.priority ?? 'medium',
    assigned_to: initial?.assigned_to ?? assignedTo,
    visibility: initial?.visibility ?? 'team',
    start_at: initial?.start_at ?? start.toISOString(),
    end_at: initial?.end_at ?? new Date(start.getTime() + 60 * 60_000).toISOString(),
    due_at: initial?.due_at ?? start.toISOString(),
    all_day: initial?.all_day ?? false,
    recurrence_rule: initial?.recurrence_rule ?? null,
    location: initial?.location ?? '',
    client_id: initial?.client_id ?? null,
    property_id: initial?.property_id ?? null,
    reminder_minutes: initial?.reminder_minutes ?? 120,
    source: initial?.source ?? 'lotti',
  };
}

function itemToDraft(item: RoutineItem): RoutineDraft {
  const event = 'start_at' in item;
  return {
    kind: event ? 'event' : 'task',
    title: item.title,
    description: item.description,
    activity_type: item.activity_type,
    priority: item.priority,
    assigned_to: item.assigned_to,
    visibility: item.visibility,
    start_at: event ? item.start_at : null,
    end_at: event ? item.end_at : null,
    due_at: event ? null : item.due_at,
    all_day: event ? item.all_day : false,
    recurrence_rule: item.recurrence_rule,
    location: event ? item.location : null,
    client_id: item.client_id,
    property_id: item.property_id,
    reminder_minutes: null,
    source: item.source === 'inbox' ? 'lotti' : item.source,
  };
}

export function RoutineComposerSheet({
  open,
  onOpenChange,
  context,
  members,
  clients,
  properties,
  actions,
  item,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: RoutineContext;
  members: RoutineMember[];
  clients: ClientOption[];
  properties: PropertyOption[];
  actions: RoutineActions;
  item?: RoutineItem | null;
  initial?: Partial<RoutineDraft>;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<RoutineDraft>(() => defaultDraft(context.membership.user_id, initial));
  const [conflicts, setConflicts] = useState<Array<{ title: string; start_at: string; end_at: string }>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(item ? itemToDraft(item) : defaultDraft(context.membership.user_id, initial));
    setConflicts([]);
    setError('');
  }, [open, item, initial, context.membership.user_id]);

  const selectedClient = clients.find((client) => client.id === draft.client_id);
  const selectedProperty = properties.find((property) => property.id === draft.property_id);
  const pending = actions.create.isPending || actions.updateEvent.isPending || actions.updateTask.isPending;
  const category = getRoutineCategory(draft.activity_type);
  const canComplete = !!item && !['completed', 'cancelled'].includes(item.status);

  const recurrence = useMemo(() => {
    const value = draft.recurrence_rule;
    if (!value) return 'none';
    if (value.includes('FREQ=DAILY')) return 'daily';
    if (value.includes('FREQ=WEEKLY')) return 'weekly';
    if (value.includes('FREQ=MONTHLY')) return 'monthly';
    return 'custom';
  }, [draft.recurrence_rule]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setConflicts([]);
    if (!draft.title.trim()) {
      setError('Dê um nome claro para a atividade.');
      return;
    }
    if (draft.kind === 'event') {
      if (!draft.start_at || !draft.end_at || new Date(draft.end_at) <= new Date(draft.start_at)) {
        setError('O horário final precisa ser posterior ao início.');
        return;
      }
      const found = await actions.checkConflicts(draft.assigned_to, draft.start_at, draft.end_at, item?.id);
      if (found.length) {
        setConflicts(found);
        return;
      }
    }

    if (!item) {
      await actions.create.mutateAsync({ ...draft, title: draft.title.trim() });
    } else if ('start_at' in item) {
      await actions.updateEvent.mutateAsync({
        id: item.recurrence_parent_id || item.id,
        expectedUpdatedAt: item.updated_at,
        patch: {
          title: draft.title.trim(),
          description: draft.description || null,
          activity_type: draft.activity_type,
          priority: draft.priority,
          assigned_to: draft.assigned_to,
          visibility: draft.visibility,
          start_at: draft.start_at!,
          end_at: draft.end_at!,
          all_day: !!draft.all_day,
          recurrence_rule: draft.recurrence_rule || null,
          location: draft.location || null,
          client_id: draft.client_id || null,
          property_id: draft.property_id || null,
        },
      });
    } else {
      await actions.updateTask.mutateAsync({
        id: item.id,
        expectedUpdatedAt: item.updated_at,
        patch: {
          title: draft.title.trim(),
          description: draft.description || null,
          activity_type: draft.activity_type,
          priority: draft.priority,
          assigned_to: draft.assigned_to,
          visibility: draft.visibility,
          due_at: draft.due_at || null,
          recurrence_rule: draft.recurrence_rule || null,
          client_id: draft.client_id || null,
          property_id: draft.property_id || null,
        },
      });
    }
    onOpenChange(false);
  };

  const setRecurrence = (value: string) => {
    const rules: Record<string, string | null> = {
      none: null,
      daily: 'FREQ=DAILY;INTERVAL=1',
      weekly: 'FREQ=WEEKLY;INTERVAL=1',
      monthly: 'FREQ=MONTHLY;INTERVAL=1',
    };
    setDraft((current) => ({ ...current, recurrence_rule: rules[value] ?? current.recurrence_rule }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="text-left">
          <SheetTitle>{item ? 'Detalhes da atividade' : 'Nova atividade'}</SheetTitle>
          <SheetDescription>
            {item && 'start_at' in item && item.recurrence_parent_id
              ? 'Esta ocorrência pertence a uma série. As alterações serão aplicadas à série.'
              : 'Organize o compromisso e conecte-o ao contexto do CRM.'}
          </SheetDescription>
        </SheetHeader>

        {item && (
          <div className="mt-5 flex flex-wrap gap-2">
            {item.source !== 'lotti' && <Badge variant="outline">Origem: {item.source === 'google' ? 'Google' : item.source}</Badge>}
            {'sync_status' in item && item.sync_status === 'error' && <Badge variant="destructive">Falha ao sincronizar</Badge>}
            {item.visibility === 'private' && <Badge variant="secondary">Privado</Badge>}
          </div>
        )}

        {item && 'sync_status' in item && item.sync_status === 'conflict' && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="text-sm font-semibold">Este compromisso mudou na Lotti e no Google</p>
            <p className="mt-1 text-xs leading-5 opacity-80">Escolha conscientemente qual versão deve prevalecer. A outra será substituída.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={actions.resolveSyncConflict.isPending} onClick={async () => {
                await actions.resolveSyncConflict.mutateAsync({ eventId: item.id, strategy: 'google' });
                onOpenChange(false);
              }}>Usar versão do Google</Button>
              <Button type="button" size="sm" disabled={actions.resolveSyncConflict.isPending} onClick={async () => {
                await actions.resolveSyncConflict.mutateAsync({ eventId: item.id, strategy: 'lotti' });
                onOpenChange(false);
              }}>Manter versão da Lotti</Button>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-5">
          {!item && (
            <Tabs value={draft.kind} onValueChange={(kind) => setDraft((current) => ({ ...current, kind: kind as 'event' | 'task' }))}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="event">Compromisso</TabsTrigger>
                <TabsTrigger value="task">Tarefa</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <div className="space-y-2">
            <Label htmlFor="routine-title">Título</Label>
            <Input
              id="routine-title"
              value={draft.title}
              onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
              placeholder={draft.kind === 'event' ? 'Ex.: Visita ao Jardim Europa' : 'Ex.: Retornar proposta da Ana'}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={draft.activity_type} onValueChange={(activity_type) => {
              const next = getRoutineCategory(activity_type);
              setDraft((current) => ({ ...current, activity_type, priority: next.defaultPriority }));
            }}>
              <SelectTrigger>
                <span className="flex items-center gap-2">
                  <RoutineCategoryIcon categoryId={draft.activity_type} />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {ROUTINE_CATEGORIES.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    <span className="flex items-center gap-2"><RoutineCategoryIcon categoryId={option.id} />{option.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.kind === 'event' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="routine-start">Início</Label>
                <Input id="routine-start" type="datetime-local" value={toInputDate(draft.start_at)} onChange={(e) => {
                  const start_at = toIso(e.target.value);
                  setDraft((current) => {
                    const oldDuration = current.start_at && current.end_at
                      ? new Date(current.end_at).getTime() - new Date(current.start_at).getTime()
                      : category.defaultMinutes * 60_000;
                    return {
                      ...current,
                      start_at,
                      end_at: start_at ? new Date(new Date(start_at).getTime() + Math.max(15 * 60_000, oldDuration)).toISOString() : current.end_at,
                    };
                  });
                }} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="routine-end">Fim</Label>
                <Input id="routine-end" type="datetime-local" value={toInputDate(draft.end_at)} onChange={(e) => setDraft((current) => ({ ...current, end_at: toIso(e.target.value) }))} />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="routine-due">Prazo</Label>
              <Input id="routine-due" type="datetime-local" value={toInputDate(draft.due_at)} onChange={(e) => setDraft((current) => ({ ...current, due_at: toIso(e.target.value) }))} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Responsável</Label>
              <Select value={draft.assigned_to} onValueChange={(assigned_to) => setDraft((current) => ({ ...current, assigned_to }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {member.display_name || 'Membro da equipe'}
                      {member.user_id === context.membership.user_id ? ' (você)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={draft.priority} onValueChange={(priority) => setDraft((current) => ({ ...current, priority: priority as RoutinePriority }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Cliente ou lead</Label>
              <Select value={draft.client_id || 'none'} onValueChange={(client_id) => setDraft((current) => ({ ...current, client_id: client_id === 'none' ? null : client_id }))}>
                <SelectTrigger><SelectValue placeholder="Sem cliente" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">Sem cliente relacionado</SelectItem>
                  {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Imóvel</Label>
              <Select value={draft.property_id || 'none'} onValueChange={(property_id) => setDraft((current) => {
                const property = properties.find((candidate) => candidate.id === property_id);
                return {
                  ...current,
                  property_id: property_id === 'none' ? null : property_id,
                  location: current.location || property?.endereco || '',
                };
              })}>
                <SelectTrigger><SelectValue placeholder="Sem imóvel" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">Sem imóvel relacionado</SelectItem>
                  {properties.map((property) => <SelectItem key={property.id} value={property.id}>{property.titulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {draft.kind === 'event' && (
            <div className="space-y-2">
              <Label htmlFor="routine-location">Endereço ou local</Label>
              <Input id="routine-location" value={draft.location || ''} onChange={(e) => setDraft((current) => ({ ...current, location: e.target.value }))} placeholder="Endereço da visita ou link da reunião" />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Repetição</Label>
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não repetir</SelectItem>
                  <SelectItem value="daily">Todos os dias</SelectItem>
                  <SelectItem value="weekly">Toda semana</SelectItem>
                  <SelectItem value="monthly">Todo mês</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.kind === 'event' && (
              <div className="space-y-2">
                <Label>Lembrete</Label>
                <Select value={String(draft.reminder_minutes ?? 0)} onValueChange={(value) => setDraft((current) => ({ ...current, reminder_minutes: Number(value) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Na hora</SelectItem>
                    <SelectItem value="15">15 minutos antes</SelectItem>
                    <SelectItem value="60">1 hora antes</SelectItem>
                    <SelectItem value="120">2 horas antes</SelectItem>
                    <SelectItem value="1440">1 dia antes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="routine-description">Observações</Label>
            <Textarea id="routine-description" value={draft.description || ''} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} rows={3} placeholder="Contexto útil para executar esta atividade" />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="routine-private">Compromisso privado</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">A equipe verá somente que o horário está ocupado.</p>
            </div>
            <Switch id="routine-private" checked={draft.visibility === 'private'} onCheckedChange={(checked) => setDraft((current) => ({ ...current, visibility: checked ? 'private' : 'team' }))} />
          </div>

          {conflicts.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-medium">Esse horário já está ocupado</p>
              {conflicts.map((conflict, index) => (
                <p key={`${conflict.start_at}-${index}`} className="mt-1 text-xs">
                  {format(new Date(conflict.start_at), 'HH:mm')}–{format(new Date(conflict.end_at), 'HH:mm')} · {conflict.title}
                </p>
              ))}
              <p className="mt-2 text-xs">Escolha outro horário antes de salvar.</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          {item && (selectedClient || selectedProperty || ('location' in item && item.location)) && (
            <>
              <Separator />
              <div className="flex flex-wrap gap-2">
                {selectedClient && (
                  <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/clientes/${selectedClient.id}`)}>
                    <ExternalLink className="mr-2 h-4 w-4" />Abrir cliente
                  </Button>
                )}
                {selectedClient?.telefone && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={`https://wa.me/55${selectedClient.telefone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                      <MessageCircle className="mr-2 h-4 w-4" />WhatsApp
                    </a>
                  </Button>
                )}
                {selectedProperty && (
                  <Button type="button" variant="outline" size="sm" onClick={() => navigate(`/imoveis/${selectedProperty.id}`)}>
                    <ExternalLink className="mr-2 h-4 w-4" />Abrir imóvel
                  </Button>
                )}
                {draft.location && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(draft.location)}`} target="_blank" rel="noreferrer">
                      <Map className="mr-2 h-4 w-4" />Abrir rota
                    </a>
                  </Button>
                )}
              </div>
            </>
          )}

          <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              {item && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" />Excluir
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir esta atividade?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Ela sairá da agenda e, se estiver sincronizada, será cancelada no Google Agenda.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Manter atividade</AlertDialogCancel>
                      <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
                        await actions.remove.mutateAsync(item);
                        onOpenChange(false);
                      }}>Excluir atividade</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {canComplete && (
                <Button type="button" variant="outline" onClick={async () => {
                  await actions.complete.mutateAsync(item!);
                  onOpenChange(false);
                }} disabled={actions.complete.isPending}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />Concluir
                </Button>
              )}
            </div>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {item ? 'Salvar alterações' : 'Criar atividade'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
