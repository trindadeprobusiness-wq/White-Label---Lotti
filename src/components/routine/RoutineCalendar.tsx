import { useMemo, useRef, useState } from 'react';
import {
  addDays, addMinutes, addMonths, addWeeks, differenceInMinutes, format,
  isSameDay, isSameMonth, setHours, setMinutes, startOfDay, subDays, subMonths, subWeeks,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Clock3, GripVertical,
  List, Rows3, StretchVertical, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { daysForRange, hasEventConflict, rangeForView, taskIsOverdue } from '@/lib/routine/calendar';
import { getRoutineCategory, ROUTINE_CATEGORIES } from '@/lib/routine/categories';
import type { RoutineEvent, RoutineMember, RoutineScope, RoutineTask, RoutineView } from '@/types/routine';
import { RoutineCategoryIcon } from './RoutineCategoryIcon';

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;
const HOUR_HEIGHT = 48;
const SNAP_MINUTES = 15;

type RoutineItem = RoutineEvent | RoutineTask;

function viewLabel(view: RoutineView, anchor: Date) {
  if (view === 'day') return format(anchor, "EEEE, dd 'de' MMMM", { locale: ptBR });
  if (view === 'month') return format(anchor, 'MMMM yyyy', { locale: ptBR });
  if (view === 'list') return `Próximos 30 dias · ${format(anchor, 'dd/MM')}`;
  const range = rangeForView('week', anchor);
  return `${format(range.start, 'dd MMM', { locale: ptBR })} — ${format(range.end, 'dd MMM yyyy', { locale: ptBR })}`;
}

function shiftAnchor(view: RoutineView, anchor: Date, direction: -1 | 1) {
  if (view === 'day') return direction < 0 ? subDays(anchor, 1) : addDays(anchor, 1);
  if (view === 'month') return direction < 0 ? subMonths(anchor, 1) : addMonths(anchor, 1);
  if (view === 'list') return direction < 0 ? subWeeks(anchor, 4) : addWeeks(anchor, 4);
  return direction < 0 ? subWeeks(anchor, 1) : addWeeks(anchor, 1);
}

function eventTopAndHeight(event: RoutineEvent) {
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const visibleStart = DAY_START_HOUR * 60;
  const topMinutes = Math.max(0, startMinutes - visibleStart);
  const duration = Math.max(15, differenceInMinutes(end, start));
  return {
    top: topMinutes * HOUR_HEIGHT / 60,
    height: Math.max(28, duration * HOUR_HEIGHT / 60),
  };
}

function CurrentTimeLine({ day }: { day: Date }) {
  const now = new Date();
  if (!isSameDay(day, now) || now.getHours() < DAY_START_HOUR || now.getHours() >= DAY_END_HOUR) return null;
  const top = ((now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes()) * HOUR_HEIGHT / 60;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-30 flex items-center" style={{ top }} aria-hidden>
      <span className="-ml-1 h-2 w-2 rounded-full bg-destructive" />
      <span className="h-px flex-1 bg-destructive" />
    </div>
  );
}

export function RoutineCalendar({
  view,
  onViewChange,
  anchor,
  onAnchorChange,
  scope,
  onScopeChange,
  canViewTeam = false,
  memberId,
  onMemberChange,
  category,
  onCategoryChange,
  members,
  events,
  tasks,
  onCreateAt,
  onOpen,
  onMoveEvent,
}: {
  view: RoutineView;
  onViewChange: (view: RoutineView) => void;
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  scope: RoutineScope;
  onScopeChange: (scope: RoutineScope) => void;
  canViewTeam?: boolean;
  memberId?: string;
  onMemberChange: (memberId?: string) => void;
  category: string;
  onCategoryChange: (category: string) => void;
  members: RoutineMember[];
  events: RoutineEvent[];
  tasks: RoutineTask[];
  onCreateAt: (date: Date) => void;
  onOpen: (item: RoutineItem) => void;
  onMoveEvent: (event: RoutineEvent, start: Date, end: Date) => Promise<void>;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [teamFilter, setTeamFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);
  const days = useMemo(() => daysForRange(range), [range]);
  const visibleDays = view === 'day' ? [startOfDay(anchor)] : days.slice(0, 7);
  const teamOptions = [...new Set(members.map((member) => member.team_name).filter(Boolean) as string[])];
  const unitOptions = [...new Set(members.map((member) => member.unit_name).filter(Boolean) as string[])];
  const roleOptions = [...new Set(members.map((member) => member.role))];
  const filteredMemberIds = new Set(members.filter((member) => (
    (teamFilter === 'all' || member.team_name === teamFilter)
    && (unitFilter === 'all' || member.unit_name === unitFilter)
    && (roleFilter === 'all' || member.role === roleFilter)
  )).map((member) => member.user_id));
  const filteredEvents = events.filter((event) => (
    (category === 'all' || event.activity_type === category)
    && (scope !== 'team' || filteredMemberIds.has(event.assigned_to))
  ));
  const filteredTasks = tasks.filter((task) => (
    (category === 'all' || task.activity_type === category)
    && (scope !== 'team' || filteredMemberIds.has(task.assigned_to))
  ));
  const listItems = [...filteredEvents, ...filteredTasks]
    .filter((item) => {
      const date = 'start_at' in item ? item.start_at : item.due_at;
      return date && new Date(date) >= range.start && new Date(date) <= range.end;
    })
    .sort((a, b) => {
      const aDate = 'start_at' in a ? a.start_at : a.due_at!;
      const bDate = 'start_at' in b ? b.start_at : b.due_at!;
      return aDate.localeCompare(bDate);
    });

  const beginPointerChange = (
    pointerEvent: React.PointerEvent,
    event: RoutineEvent,
    mode: 'move' | 'resize',
    dayCount: number,
  ) => {
    pointerEvent.stopPropagation();
    if (event.recurrence_parent_id) {
      onOpen(event);
      return;
    }
    const startX = pointerEvent.clientX;
    const startY = pointerEvent.clientY;
    const originalStart = new Date(event.start_at);
    const originalEnd = new Date(event.end_at);
    const width = Math.max(1, (timelineRef.current?.clientWidth ?? 700) - 56);
    const dayWidth = width / dayCount;
    const target = pointerEvent.currentTarget as HTMLElement;
    target.setPointerCapture?.(pointerEvent.pointerId);

    const finish = async (upEvent: PointerEvent) => {
      window.removeEventListener('pointerup', finish);
      const minuteDelta = Math.round(((upEvent.clientY - startY) / HOUR_HEIGHT) * 60 / SNAP_MINUTES) * SNAP_MINUTES;
      if (mode === 'resize') {
        const end = new Date(Math.max(originalStart.getTime() + 15 * 60_000, addMinutes(originalEnd, minuteDelta).getTime()));
        if (end.getTime() !== originalEnd.getTime()) await onMoveEvent(event, originalStart, end);
        return;
      }
      const dayDelta = Math.round((upEvent.clientX - startX) / dayWidth);
      const start = addMinutes(addDays(originalStart, dayDelta), minuteDelta);
      const end = new Date(start.getTime() + originalEnd.getTime() - originalStart.getTime());
      if (start.getTime() !== originalStart.getTime()) await onMoveEvent(event, start, end);
    };
    window.addEventListener('pointerup', finish, { once: true });
  };

  const createFromEmptySlot = (pointerEvent: React.MouseEvent, day: Date) => {
    if ((pointerEvent.target as HTMLElement).closest('[data-routine-event]')) return;
    const rect = pointerEvent.currentTarget.getBoundingClientRect();
    const rawMinutes = (pointerEvent.clientY - rect.top) / HOUR_HEIGHT * 60;
    const snapped = Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES;
    const date = setMinutes(setHours(startOfDay(day), DAY_START_HOUR), snapped);
    onCreateAt(date);
  };

  const moveByKeyboard = async (keyboardEvent: React.KeyboardEvent, event: RoutineEvent) => {
    if (!keyboardEvent.altKey || event.recurrence_parent_id) return;
    const map: Record<string, number> = { ArrowUp: -15, ArrowDown: 15, ArrowLeft: -1440, ArrowRight: 1440 };
    const minutes = map[keyboardEvent.key];
    if (!minutes) return;
    keyboardEvent.preventDefault();
    const start = addMinutes(new Date(event.start_at), minutes);
    const end = addMinutes(new Date(event.end_at), minutes);
    await onMoveEvent(event, start, end);
  };

  const handleEventKeyDown = (keyboardEvent: React.KeyboardEvent, event: RoutineEvent) => {
    if (keyboardEvent.altKey) {
      void moveByKeyboard(keyboardEvent, event);
      return;
    }
    if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
      keyboardEvent.preventDefault();
      onOpen(event);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-label="Calendário da rotina">
      <div className="border-b p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => onAnchorChange(shiftAnchor(view, anchor, -1))} aria-label="Período anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => onAnchorChange(new Date())}>Hoje</Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => onAnchorChange(shiftAnchor(view, anchor, 1))} aria-label="Próximo período">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <h2 className="ml-1 truncate text-sm font-semibold capitalize sm:text-base">{viewLabel(view, anchor)}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tabs value={view} onValueChange={(value) => onViewChange(value as RoutineView)}>
              <TabsList className="h-9">
                <TabsTrigger value="day" className="px-2.5 text-xs">Dia</TabsTrigger>
                <TabsTrigger value="week" className="px-2.5 text-xs">Semana</TabsTrigger>
                <TabsTrigger value="month" className="px-2.5 text-xs">Mês</TabsTrigger>
                <TabsTrigger value="list" className="px-2.5 text-xs">Lista</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Select value={scope} onValueChange={(value) => {
            onScopeChange(value as RoutineScope);
            if (value === 'mine') onMemberChange(undefined);
          }}>
            <SelectTrigger className="h-8 w-[142px] text-xs">
              {scope === 'mine' ? <Rows3 className="mr-2 h-3.5 w-3.5" /> : <Users className="mr-2 h-3.5 w-3.5" />}
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Minha agenda</SelectItem>
              {canViewTeam && <SelectItem value="team">Agenda da equipe</SelectItem>}
            </SelectContent>
          </Select>
          {scope === 'team' && members.length > 1 && (
            <Select value={memberId || 'all'} onValueChange={(value) => onMemberChange(value === 'all' ? undefined : value)}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os responsáveis</SelectItem>
                {members.map((member) => <SelectItem key={member.user_id} value={member.user_id}>{member.display_name || 'Membro'}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {scope === 'team' && teamOptions.length > 1 && (
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as equipes</SelectItem>
                {teamOptions.map((team) => <SelectItem key={team} value={team}>{team}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {scope === 'team' && unitOptions.length > 1 && (
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {unitOptions.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {scope === 'team' && roleOptions.length > 1 && (
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-8 w-[145px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as funções</SelectItem>
                {roleOptions.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={category} onValueChange={onCategoryChange}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">Todas as atividades</SelectItem>
              {ROUTINE_CATEGORIES.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {(view === 'day' || view === 'week') && (
        <div className="overflow-x-auto">
          <div className={cn('min-w-[760px]', view === 'day' && 'min-w-[440px]')} ref={timelineRef}>
            <div className="grid border-b bg-secondary/40" style={{ gridTemplateColumns: `56px repeat(${visibleDays.length}, minmax(0, 1fr))` }}>
              <div className="border-r" />
              {visibleDays.map((day) => (
                <button key={day.toISOString()} type="button" onClick={() => { onAnchorChange(day); if (view === 'week') onViewChange('day'); }} className={cn('border-r px-2 py-3 text-center transition-colors hover:bg-accent', isSameDay(day, new Date()) && 'bg-surface-brand')}>
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{format(day, 'EEE', { locale: ptBR })}</span>
                  <span className={cn('mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold', isSameDay(day, new Date()) && 'bg-primary text-primary-foreground')}>{format(day, 'd')}</span>
                </button>
              ))}
            </div>
            <div className="grid" style={{ gridTemplateColumns: `56px repeat(${visibleDays.length}, minmax(0, 1fr))` }}>
              <div className="relative border-r" style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT }}>
                {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, index) => (
                  <span key={index} className="absolute right-2 -translate-y-2 text-[10px] tabular text-muted-foreground" style={{ top: index * HOUR_HEIGHT }}>
                    {String(DAY_START_HOUR + index).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              {visibleDays.map((day) => {
                const dayEvents = filteredEvents.filter((event) => isSameDay(new Date(event.start_at), day));
                const dayTasks = filteredTasks.filter((task) => task.due_at && isSameDay(new Date(task.due_at), day) && task.status !== 'completed');
                return (
                  <div
                    key={day.toISOString()}
                    className="relative border-r bg-[linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[length:100%_72px]"
                    style={{ height: (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT }}
                    onDoubleClick={(event) => createFromEmptySlot(event, day)}
                    title="Clique duas vezes em um horário livre para criar"
                  >
                    <CurrentTimeLine day={day} />
                    {dayTasks.length > 0 && (
                      <div className="absolute inset-x-1 top-1 z-20 flex gap-1 overflow-hidden">
                        {dayTasks.slice(0, 2).map((task) => (
                          <button key={task.id} type="button" onClick={() => onOpen(task)} className="truncate rounded bg-foreground px-1.5 py-0.5 text-[9px] text-background">
                            {task.title}
                          </button>
                        ))}
                      </div>
                    )}
                    {dayEvents.map((event) => {
                      const position = eventTopAndHeight(event);
                      const style = getRoutineCategory(event.activity_type);
                      const conflict = hasEventConflict(filteredEvents, {
                        start: new Date(event.start_at), end: new Date(event.end_at), assignedTo: event.assigned_to, excludeId: event.id,
                      });
                      return (
                        <div
                          key={event.occurrence_id || event.id}
                          role="button"
                          tabIndex={0}
                          data-routine-event
                          onClick={() => onOpen(event)}
                          onKeyDown={(keyboardEvent) => handleEventKeyDown(keyboardEvent, event)}
                          onPointerDown={(pointerEvent) => beginPointerChange(pointerEvent, event, 'move', visibleDays.length)}
                          className={cn(
                            'group absolute left-1 right-1 z-10 overflow-hidden rounded-md border-l-[3px] p-1.5 text-left shadow-sm outline-none transition-shadow hover:z-20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring',
                            event.status === 'completed' && 'opacity-55',
                            conflict && 'ring-2 ring-amber-400',
                          )}
                          style={{ top: position.top, height: position.height, borderLeftColor: style.color, background: style.surface, color: '#17211d' }}
                          aria-label={`${event.title}, ${format(new Date(event.start_at), 'HH:mm')}`}
                        >
                          <span className="flex items-start gap-1">
                            <GripVertical className="mt-0.5 h-3 w-3 shrink-0 opacity-35" />
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] font-semibold">{event.title}</span>
                              {position.height >= 48 && <span className="mt-0.5 block text-[9px] tabular opacity-70">{format(new Date(event.start_at), 'HH:mm')}–{format(new Date(event.end_at), 'HH:mm')}</span>}
                            </span>
                            {event.source === 'google' && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" title="Google Agenda" />}
                            {conflict && <CircleAlert className="ml-auto h-3 w-3 shrink-0 text-amber-700" />}
                          </span>
                          <span
                            aria-hidden
                            onPointerDown={(pointerEvent) => beginPointerChange(pointerEvent, event, 'resize', visibleDays.length)}
                            className="absolute inset-x-0 bottom-0 flex h-3 cursor-ns-resize items-center justify-center opacity-0 group-hover:opacity-60"
                          >
                            <StretchVertical className="h-3 w-3" />
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {view === 'month' && (
        <div className="grid grid-cols-7">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((weekday) => (
            <div key={weekday} className="border-b border-r bg-secondary/40 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{weekday}</div>
          ))}
          {days.map((day) => {
            const dayEvents = filteredEvents.filter((event) => isSameDay(new Date(event.start_at), day));
            const dayTasks = filteredTasks.filter((task) => task.due_at && isSameDay(new Date(task.due_at), day));
            return (
              <div key={day.toISOString()} onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('[data-routine-month-item]')) return;
                onCreateAt(setHours(day, 9));
              }} className={cn('min-h-28 border-b border-r p-1.5 sm:min-h-32', !isSameMonth(day, anchor) && 'bg-secondary/30 text-muted-foreground')}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium', isSameDay(day, new Date()) && 'bg-primary text-primary-foreground')}>{format(day, 'd')}</span>
                  {(dayEvents.length + dayTasks.length) > 3 && <span className="text-[9px] text-muted-foreground">+{dayEvents.length + dayTasks.length - 3}</span>}
                </div>
                {[...dayEvents, ...dayTasks].slice(0, 3).map((item) => {
                  const isEvent = 'start_at' in item;
                  const style = getRoutineCategory(item.activity_type);
                  return (
                    <button data-routine-month-item key={item.id + (isEvent ? item.occurrence_id || '' : '')} type="button" onClick={() => onOpen(item)} className="mb-1 flex w-full items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[10px] font-medium hover:brightness-95" style={{ background: style.surface, color: '#17211d' }}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: style.color }} />
                      <span className="truncate">{isEvent && format(new Date(item.start_at), 'HH:mm')} {item.title}{!isEvent && item.is_sample_data ? ' · Demo' : ''}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {view === 'list' && (
        <div className="divide-y">
          {listItems.map((item) => {
              const isEvent = 'start_at' in item;
              const date = new Date(isEvent ? item.start_at : item.due_at!);
              return (
                <button key={item.id + (isEvent ? item.occurrence_id || '' : '')} type="button" onClick={() => onOpen(item)} className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/60">
                  <div className="w-12 shrink-0 text-center">
                    <span className="block text-[10px] font-semibold uppercase text-muted-foreground">{format(date, 'EEE', { locale: ptBR })}</span>
                    <span className="block text-lg font-semibold tabular">{format(date, 'dd')}</span>
                  </div>
                  <RoutineCategoryIcon categoryId={item.activity_type} withSurface />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium', item.status === 'completed' && 'line-through text-muted-foreground')}>{item.title}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      {format(date, 'HH:mm')} · {getRoutineCategory(item.activity_type).label}
                    </p>
                  </div>
                  {!isEvent && taskIsOverdue(item) && <Badge variant="destructive">Atrasada</Badge>}
                  {!isEvent && item.is_sample_data && <Badge variant="outline">Demo</Badge>}
                  {isEvent && item.source === 'google' && <Badge variant="outline" className="hidden sm:inline-flex">Google</Badge>}
                </button>
              );
            })}
          {listItems.length === 0 && (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <CalendarDays className="h-9 w-9 text-muted-foreground/40" />
              <p className="mt-3 font-medium">Agenda livre neste período</p>
              <p className="mt-1 text-sm text-muted-foreground">Crie uma atividade ou use o comando da Lotti para começar.</p>
              <Button className="mt-4" onClick={() => onCreateAt(new Date())}>Criar atividade</Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t bg-secondary/40 px-4 py-2.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />Criado na Lotti</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />Google Agenda</span>
        <span className="flex items-center gap-1.5"><List className="h-3 w-3" />Tarefas aparecem no prazo</span>
        <span className="ml-auto hidden sm:inline">Alt + setas move em intervalos de 15 minutos</span>
      </div>
    </section>
  );
}
