import { useMemo, type ReactNode } from 'react';
import { format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowUpRight, Circle, Inbox,
  MapPin, Plus, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { getRoutineCategory } from '@/lib/routine/categories';
import { taskIsOverdue } from '@/lib/routine/calendar';
import type { RoutineDraft, RoutineEvent, RoutineMember, RoutineTask } from '@/types/routine';
import { RoutineCategoryIcon } from './RoutineCategoryIcon';

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || 'por aí';
}

export function RoutineBriefing({
  currentUserName,
  currentUserId,
  events,
  tasks,
  members,
  onOpen,
  onComplete,
  onCreate,
  comando,
}: {
  currentUserName?: string | null;
  currentUserId: string;
  events: RoutineEvent[];
  tasks: RoutineTask[];
  members: RoutineMember[];
  onOpen: (item: RoutineEvent | RoutineTask) => void;
  onComplete: (item: RoutineEvent | RoutineTask) => Promise<unknown>;
  onCreate: (draft?: Partial<RoutineDraft>) => void;
  /** Cartão do comando da Lotti, renderizado ao lado da próxima ação. */
  comando?: ReactNode;
}) {
  const now = useMemo(() => new Date(), []);
  const myEvents = events.filter((event) => event.assigned_to === currentUserId && event.status !== 'cancelled');
  const todayEvents = myEvents.filter((event) => isSameDay(new Date(event.start_at), now));
  const confirmedToday = todayEvents.filter((event) => event.status === 'confirmed').length;
  const awaitingToday = todayEvents.filter((event) => event.status === 'pending_confirmation').length;
  const visitsToday = todayEvents.filter((event) => event.activity_type === 'visita_imovel').length;
  const nextEvent = myEvents
    .filter((event) => new Date(event.end_at) >= now && event.status !== 'completed')
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const todayTasks = tasks.filter((task) => task.assigned_to === currentUserId && task.due_at && isSameDay(new Date(task.due_at), now) && !['completed', 'cancelled'].includes(task.status));
  const overdue = tasks.filter((task) => task.assigned_to === currentUserId && taskIsOverdue(task, now));

  const teamLoad = useMemo(() => members.map((member) => {
    const openTasks = tasks.filter((task) => task.assigned_to === member.user_id && !['completed', 'cancelled'].includes(task.status)).length;
    const todayEvents = events.filter((event) => event.assigned_to === member.user_id && isSameDay(new Date(event.start_at), now) && event.status !== 'cancelled').length;
    return { member, total: openTasks + todayEvents, openTasks, todayEvents };
  }).sort((a, b) => b.total - a.total), [members, tasks, events, now]);
  const maxLoad = Math.max(1, ...teamLoad.map((item) => item.total));

  const temTarefas = overdue.length > 0 || todayTasks.length > 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <button
        type="button"
        onClick={() => nextEvent ? onOpen(nextEvent) : onCreate()}
        className="group relative overflow-hidden rounded-2xl bg-[#093323] p-5 text-left text-white shadow-sm outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <div className="absolute bottom-0 left-6 top-0 w-px bg-white/15" aria-hidden />
        <span className="relative flex items-center justify-between pl-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65">
          Próxima ação · {firstName(currentUserName)}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
        {nextEvent ? (
          <div className="relative mt-5 flex gap-4 pl-5">
            <span className="absolute -left-[3px] top-1 h-2 w-2 rounded-full bg-[#B8F34A] ring-4 ring-[#093323]" />
            <div className="shrink-0">
              <span className="block text-3xl font-semibold tabular tracking-tight">{format(new Date(nextEvent.start_at), 'HH:mm')}</span>
              <span className="mt-1 block text-xs text-white/60">{isSameDay(new Date(nextEvent.start_at), now) ? 'hoje' : format(new Date(nextEvent.start_at), 'dd MMM', { locale: ptBR })}</span>
            </div>
            <div className="min-w-0 border-l border-white/15 pl-4">
              <span className="block truncate text-lg font-semibold">{nextEvent.title}</span>
              <span className="mt-1 block text-sm text-white/65">{getRoutineCategory(nextEvent.activity_type).label}</span>
              {nextEvent.location && <span className="mt-3 flex items-center gap-1.5 truncate text-xs text-white/70"><MapPin className="h-3.5 w-3.5" />{nextEvent.location}</span>}
            </div>
          </div>
        ) : (
          <div className="relative mt-8 pl-5">
            <span className="absolute -left-[3px] top-1 h-2 w-2 rounded-full bg-[#B8F34A] ring-4 ring-[#093323]" />
            <span className="block text-xl font-semibold">Nenhum compromisso próximo</span>
            <span className="mt-2 block text-sm text-white/65">Abra um horário e mantenha o dia sob controle.</span>
            <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#093323]"><Plus className="h-3.5 w-3.5" />Criar atividade</span>
          </div>
        )}
        <span className="relative mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/15 pt-3 pl-5 text-[10px] text-white/65">
          <span><strong className="text-white">{confirmedToday}</strong> confirmados</span>
          <span><strong className="text-white">{awaitingToday}</strong> aguardando</span>
          <span><strong className="text-white">{visitsToday}</strong> visitas hoje</span>
        </span>
      </button>

      {comando && <div className="xl:col-span-2">{comando}</div>}

      {temTarefas && (
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            Tarefas que pedem ação
            {(overdue.length + todayTasks.length) > 0 && <Badge variant="secondary">{overdue.length + todayTasks.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {[...overdue, ...todayTasks.filter((task) => !overdue.some((candidate) => candidate.id === task.id))].slice(0, 5).map((task) => (
            <div key={task.id} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-accent/60">
              <button type="button" onClick={() => void onComplete(task)} className="text-muted-foreground transition-colors hover:text-primary" aria-label={`Concluir ${task.title}`}>
                <Circle className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                  <span className="truncate">{task.title}</span>
                  {task.is_sample_data && <Badge variant="outline" className="h-4 px-1 text-[9px]">Demo</Badge>}
                </span>
                <span className={cn('mt-0.5 block text-[10px] text-muted-foreground', taskIsOverdue(task, now) && 'font-medium text-destructive')}>
                  {taskIsOverdue(task, now) ? 'Atrasada · ' : ''}{task.due_at ? format(new Date(task.due_at), "dd/MM 'às' HH:mm") : 'Sem prazo'}
                </span>
              </button>
              <RoutineCategoryIcon categoryId={task.activity_type} />
            </div>
          ))}
        </CardContent>
      </Card>
      )}

      {members.length > 1 && (
      <Card className="shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Users className="h-4 w-4" />Carga da equipe</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {teamLoad.slice(0, 5).map(({ member, total, openTasks, todayEvents }) => (
            <div key={member.user_id}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium">{member.display_name || 'Membro da equipe'}</span>
                <span className="shrink-0 text-muted-foreground">{todayEvents} compromissos · {openTasks} tarefas</span>
              </div>
              <Progress value={total / maxLoad * 100} className="h-1.5" />
            </div>
          ))}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
