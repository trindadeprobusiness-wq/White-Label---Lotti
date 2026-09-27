import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Field, FieldIssues, LockedNote, SettingsSection, StageSelect, ToggleRow, inputClassName } from '../components';
import { TIME_OPTIONS, WEEKDAYS, type AgentSettings, type DayHours, type Weekday } from '../settings';
import type { AgentTabProps } from './types';

const WORKDAYS: Weekday[] = ['tue', 'wed', 'thu', 'fri'];
// Mantém um horário salvo fora da grade de 30 min visível no seletor.
const timeChoices = (current: string) => (TIME_OPTIONS.includes(current) ? TIME_OPTIONS : [...TIME_OPTIONS, current].sort());
const onDay = (day: Weekday) => (day === 'sat' || day === 'sun' ? 'no' : 'na');

export function ScheduleTab({ settings, onChange, issues, stages }: AgentTabProps) {
  const schedule = settings.schedule;
  const set = (patch: Partial<AgentSettings['schedule']>) => onChange({ ...settings, schedule: { ...schedule, ...patch } });
  const setDay = (day: Weekday, patch: Partial<DayHours>) => set({ week: { ...schedule.week, [day]: { ...schedule.week[day], ...patch } } });
  const setVisits = (patch: Partial<AgentSettings['schedule']['visits']>) => set({ visits: { ...schedule.visits, ...patch } });
  const copyMondayToWorkdays = () => set({ week: { ...schedule.week, ...Object.fromEntries(WORKDAYS.map((day) => [day, { ...schedule.week.mon }])) } });

  return <>
    <SettingsSection title="Horário de atendimento" description="Horário de Brasília.">
      <div className="divide-y rounded-lg border">
        {WEEKDAYS.map((day) => {
          const hours = schedule.week[day.id];
          return <div key={day.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <Switch aria-label={`Atender ${onDay(day.id)} ${day.label.toLowerCase()}`} checked={hours.enabled} onCheckedChange={(enabled) => setDay(day.id, { enabled })} />
            <span className="w-20 text-sm font-medium">{day.label}</span>
            {hours.enabled
              ? <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <select aria-label={`${day.label}: início`} className={cn(inputClassName, 'h-9 w-24')} value={hours.start} onChange={(event) => setDay(day.id, { start: event.target.value })}>
                  {timeChoices(hours.start).map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
                às
                <select aria-label={`${day.label}: fim`} className={cn(inputClassName, 'h-9 w-24')} value={hours.end} onChange={(event) => setDay(day.id, { end: event.target.value })}>
                  {timeChoices(hours.end).map((time) => <option key={time} value={time}>{time}</option>)}
                </select>
              </span>
              : <span className="text-sm text-muted-foreground">Fechado</span>}
          </div>;
        })}
      </div>
      <FieldIssues issues={issues} field="schedule.week" />
      <Button type="button" variant="outline" size="sm" onClick={copyMondayToWorkdays}><Copy className="h-4 w-4" />Usar o horário de segunda nos dias úteis</Button>
    </SettingsSection>

    <SettingsSection
      title="Visitas"
      description={schedule.visits.enabled ? 'A IA sugere horários e o corretor confirma.' : 'Desligado: pedidos de visita vão para o corretor.'}
      action={<Switch aria-label="Propor horários de visita" checked={schedule.visits.enabled} onCheckedChange={(enabled) => setVisits({ enabled })} />}
    >
      {schedule.visits.enabled && <>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duração da visita (min)">
            {(id) => <input id={id} type="number" min={15} max={240} step={15} className={inputClassName} value={schedule.visits.durationMinutes} onChange={(event) => setVisits({ durationMinutes: Number(event.target.value) })} />}
          </Field>
          <Field label="Antecedência mínima (horas)">
            {(id) => <input id={id} type="number" min={0} max={168} className={inputClassName} value={schedule.visits.minNoticeHours} onChange={(event) => setVisits({ minNoticeHours: Number(event.target.value) })} />}
          </Field>
        </div>
        <FieldIssues issues={issues} field="schedule.visits" />
        <ToggleRow title="Confirmar o nome completo" description="O nome do WhatsApp costuma ser apelido." checked={schedule.visits.confirmFullName} onCheckedChange={(confirmFullName) => setVisits({ confirmFullName })} />
        <StageSelect label="Etapa do funil ao agendar visita" value={schedule.visits.stageId} onChange={(stageId) => setVisits({ stageId })} stages={stages} />
        <LockedNote>O corretor aprova cada visita antes da confirmação ao lead.</LockedNote>
      </>}
    </SettingsSection>
  </>;
}
