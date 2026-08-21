import { useMemo, useState } from 'react';
import { addDays, endOfDay, format, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarPlus, Clock3, History, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell/PageHeader';
import { GoogleCalendarPanel } from '@/components/routine/GoogleCalendarPanel';
import { RoutineBriefing } from '@/components/routine/RoutineBriefing';
import { RoutineCalendar } from '@/components/routine/RoutineCalendar';
import { RoutineCommandBar } from '@/components/routine/RoutineCommandBar';
import { RoutineComposerSheet } from '@/components/routine/RoutineComposerSheet';
import {
  useRoutineActions, useRoutineActivity, useRoutineContext, useRoutineEvents,
  useRoutineInbox, useRoutineMembers, useRoutineTasks,
} from '@/hooks/routine/useRoutine';
import { rangeForView } from '@/lib/routine/calendar';
import { useCRMStore } from '@/stores/crmStore';
import { useAuth } from '@/hooks/useAuth';
import type { RoutineDraft, RoutineEvent, RoutineScope, RoutineTask, RoutineView } from '@/types/routine';

type RoutineItem = RoutineEvent | RoutineTask;

function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function RoutineLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-56 rounded-2xl xl:col-span-5" />
        <Skeleton className="h-56 rounded-2xl xl:col-span-4" />
        <Skeleton className="h-56 rounded-2xl xl:col-span-3" />
      </div>
      <Skeleton className="h-[560px] rounded-2xl" />
    </div>
  );
}

export default function Rotina() {
  const { user } = useAuth();
  const { corretor, clientes, imoveis, alertas } = useCRMStore();
  const contextQuery = useRoutineContext();
  const context = contextQuery.data;
  const [view, setView] = useState<RoutineView>(() => (
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week'
  ));
  const [scope, setScope] = useState<RoutineScope>('mine');
  const [anchor, setAnchor] = useState(new Date());
  const [memberId, setMemberId] = useState<string>();
  const [category, setCategory] = useState('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<RoutineItem | null>(null);
  const [initialDraft, setInitialDraft] = useState<Partial<RoutineDraft> | undefined>();
  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);
  const briefingRange = useMemo(() => ({ start: startOfDay(new Date()), end: endOfDay(addDays(new Date(), 30)) }), []);

  const members = useRoutineMembers(context);
  const calendarEvents = useRoutineEvents(context, range, scope, memberId);
  const briefingEvents = useRoutineEvents(context, briefingRange, 'team');
  const tasks = useRoutineTasks(context, scope, memberId);
  const activity = useRoutineActivity(context);
  const inbox = useRoutineInbox(context);
  const actions = useRoutineActions(context);

  const openCreate = (draft?: Partial<RoutineDraft>) => {
    setSelectedItem(null);
    setInitialDraft(draft);
    setSheetOpen(true);
  };

  const openAt = (date: Date) => openCreate({
    kind: 'event',
    start_at: date.toISOString(),
    end_at: new Date(date.getTime() + 60 * 60_000).toISOString(),
    assigned_to: memberId || user?.id,
  });

  const openItem = (item: RoutineItem) => {
    setSelectedItem(item);
    setInitialDraft(undefined);
    setSheetOpen(true);
  };

  if (contextQuery.isLoading) return <RoutineLoading />;

  if (!context) {
    return (
      <div>
        <PageHeader titulo="Rotina" subtitulo="Agenda, tarefas e próxima melhor ação da operação." comUtilitarios />
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>A Central de Rotina precisa da migration do banco</AlertTitle>
          <AlertDescription className="mt-2 leading-6">
            A interface já está integrada ao produto, mas as tabelas protegidas por RLS ainda não existem neste ambiente.
            Aplique <code>20260821004218_rotina_operacional.sql</code> no Supabase e publique as Edge Functions documentadas.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const allEvents = briefingEvents.data ?? calendarEvents.data ?? [];
  const memberList = members.data ?? [context.membership];
  const canManageTeam = ['proprietario', 'administrador', 'gestor'].includes(context.membership.role);
  const visibleMembers = canManageTeam ? memberList : memberList.filter((member) => member.user_id === user!.id);
  const taskList = tasks.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={`${greeting()}, ${corretor?.nome?.split(/\s+/)[0] || 'vamos organizar o dia'}`}
        subtitulo={format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
        comUtilitarios
        acoes={(
          <Button onClick={() => openCreate()}>
            <CalendarPlus className="mr-2 h-4 w-4" />Nova atividade
          </Button>
        )}
      />

      <RoutineCommandBar
        userId={user!.id}
        timezone={context.organization.timezone}
        clients={clientes.map((client) => ({ id: client.id, label: client.nome }))}
        properties={imoveis.map((property) => ({ id: property.id, label: property.titulo, location: property.endereco }))}
        checkConflicts={actions.checkConflicts}
        onConfirm={(draft) => actions.create.mutateAsync(draft)}
        onEdit={(draft) => openCreate(draft)}
      />

      {(briefingEvents.isLoading || tasks.isLoading) ? (
        <div className="grid gap-4 xl:grid-cols-12">
          <Skeleton className="h-56 rounded-2xl xl:col-span-5" />
          <Skeleton className="h-56 rounded-2xl xl:col-span-4" />
          <Skeleton className="h-56 rounded-2xl xl:col-span-3" />
        </div>
      ) : (
        <RoutineBriefing
          currentUserName={corretor?.nome}
          currentUserId={user!.id}
          events={allEvents}
          tasks={taskList}
          members={visibleMembers}
          clients={clientes}
          alerts={alertas}
          inbox={inbox.query.data ?? []}
          onOpen={openItem}
          onComplete={(item) => actions.complete.mutateAsync(item)}
          onCreate={openCreate}
          onAddInbox={(content) => inbox.add.mutateAsync({ content })}
          onArchiveInbox={(id) => inbox.archive.mutateAsync(id)}
        />
      )}

      {calendarEvents.isLoading ? (
        <Skeleton className="h-[620px] rounded-2xl" />
      ) : calendarEvents.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar a agenda</AlertTitle>
          <AlertDescription>Verifique a conexão e tente novamente.</AlertDescription>
        </Alert>
      ) : (
        <RoutineCalendar
          view={view}
          onViewChange={setView}
          anchor={anchor}
          onAnchorChange={setAnchor}
          scope={scope}
          onScopeChange={setScope}
          canViewTeam={canManageTeam}
          memberId={memberId}
          onMemberChange={setMemberId}
          category={category}
          onCategoryChange={setCategory}
          members={visibleMembers}
          events={calendarEvents.data ?? []}
          tasks={taskList}
          onCreateAt={openAt}
          onOpen={openItem}
          onMoveEvent={async (event, start, end) => {
            const conflicts = await actions.checkConflicts(event.assigned_to, start.toISOString(), end.toISOString(), event.id);
            if (conflicts.length) {
              toast.warning(`Conflito com ${conflicts[0].title}. O compromisso não foi movido.`);
              return;
            }
            await actions.updateEvent.mutateAsync({
              id: event.id,
              expectedUpdatedAt: event.updated_at,
              patch: { start_at: start.toISOString(), end_at: end.toISOString() },
            });
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div id="google-agenda" className="scroll-mt-24 lg:col-span-3"><GoogleCalendarPanel context={context} /></div>
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><History className="h-4 w-4" />Histórico recente</span>
              <Badge variant="outline">Auditável</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.isLoading && <Loader2 className="mx-auto my-5 h-5 w-5 animate-spin text-muted-foreground" />}
            {activity.data?.slice(0, 6).map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-xs">
                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1">
                  <span className="font-medium">{entry.action === 'complete' ? 'Atividade concluída' : entry.action === 'reschedule' ? 'Compromisso reagendado' : entry.action === 'insert' ? 'Atividade criada' : 'Atividade atualizada'}</span>
                  <span className="ml-1 text-muted-foreground">· {format(new Date(entry.created_at), "dd/MM 'às' HH:mm")}</span>
                </p>
              </div>
            ))}
            {!activity.isLoading && !activity.data?.length && <p className="py-5 text-center text-xs text-muted-foreground">As ações da Rotina aparecerão aqui.</p>}
          </CardContent>
        </Card>
      </div>

      <RoutineComposerSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        context={context}
        members={visibleMembers}
        clients={clientes}
        properties={imoveis}
        actions={actions}
        item={selectedItem}
        initial={initialDraft}
      />
    </div>
  );
}
