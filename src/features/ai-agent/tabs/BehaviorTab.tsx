import { cn } from '@/lib/utils';
import { Field, FieldIssues, Segmented, SettingsSection, StageSelect, ToggleRow, inputClassName, textareaClassName } from '../components';
import type { AgentSettings, AttendMode } from '../settings';
import type { AgentTabProps } from './types';

const ATTEND_MODES: Array<{ id: AttendMode; label: string }> = [
  { id: 'always', label: 'Sempre, toda mensagem recebida' },
  { id: 'outside_hours', label: 'Só fora do horário de atendimento' },
  { id: 'after_delay', label: 'Só se a equipe não responder em X min' },
];

export function BehaviorTab({ settings, onChange, issues, stages }: AgentTabProps) {
  const behavior = settings.behavior;
  const set = (patch: Partial<AgentSettings['behavior']>) => onChange({ ...settings, behavior: { ...behavior, ...patch } });
  const setHandoff = (patch: Partial<AgentSettings['behavior']['handoff']>) => set({ handoff: { ...behavior.handoff, ...patch } });
  const setGuards = (patch: Partial<AgentSettings['behavior']['guards']>) => set({ guards: { ...behavior.guards, ...patch } });

  return <>
    <SettingsSection title="Quando atender">
      <Field label="Modo" hint="O horário de atendimento fica na aba Agendamento." className="max-w-md">
        {(id) => <select id={id} className={inputClassName} value={behavior.attendMode} onChange={(event) => set({ attendMode: event.target.value as AttendMode })}>
          {ATTEND_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
        </select>}
      </Field>
      {behavior.attendMode === 'after_delay' && <Field label="Minutos sem resposta antes de atender" className="max-w-xs">
        {(id) => <input id={id} type="number" min={1} max={240} className={inputClassName} value={behavior.attendDelayMinutes} onChange={(event) => set({ attendDelayMinutes: Number(event.target.value) })} />}
      </Field>}
      <FieldIssues issues={issues} field="behavior.attendDelayMinutes" />
    </SettingsSection>

    <SettingsSection title="Transferência para corretor">
      <div className="space-y-2">
        <p className="text-sm font-medium">Ao transferir</p>
        <Segmented label="Ao transferir" value={behavior.handoff.mode} onChange={(mode) => setHandoff({ mode })} options={[{ id: 'message', label: 'Enviar mensagem' }, { id: 'silent', label: 'Silencioso' }]} />
        <p className="text-xs text-muted-foreground">{behavior.handoff.mode === 'silent' ? 'A IA transfere sem avisar o lead. O lead muda de etapa e a IA para.' : 'A IA manda uma mensagem ao lead antes de passar para o corretor.'}</p>
      </div>
      <StageSelect label="Mover o lead para a etapa do funil" value={behavior.handoff.stageId} onChange={(stageId) => setHandoff({ stageId })} stages={stages} hint="Quando a IA transferir, o lead vai para esta etapa no CRM." />
      {behavior.handoff.mode === 'message' && <details className="rounded-lg border px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Mensagens de transferência</summary>
        <div className="mt-3 space-y-4">
          <Field label="Dentro do horário">
            {(id) => <textarea id={id} className={cn(textareaClassName, 'min-h-16')} value={behavior.handoff.messageInHours} onChange={(event) => setHandoff({ messageInHours: event.target.value })} />}
          </Field>
          <Field label="Fora do horário">
            {(id) => <textarea id={id} className={cn(textareaClassName, 'min-h-16')} value={behavior.handoff.messageOutOfHours} onChange={(event) => setHandoff({ messageOutOfHours: event.target.value })} />}
          </Field>
        </div>
      </details>}
      <FieldIssues issues={issues} field="behavior.handoff" />
    </SettingsSection>

    <SettingsSection title="Proteções">
      <ToggleRow title="Pausar quando alguém da equipe responder" description="Recomendado. Evita a IA atropelar o corretor." checked={behavior.guards.pauseOnHumanReply} onCheckedChange={(pauseOnHumanReply) => setGuards({ pauseOnHumanReply })} />
      <ToggleRow title="Não informar endereço exato" description="O endereço só sai depois da visita confirmada." checked={behavior.guards.hideExactAddress} onCheckedChange={(hideExactAddress) => setGuards({ hideExactAddress })} />
      <ToggleRow title="Não negociar valores" description="Propostas e descontos vão para o corretor." checked={behavior.guards.noPriceNegotiation} onCheckedChange={(noPriceNegotiation) => setGuards({ noPriceNegotiation })} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Juntar mensagens seguidas</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Espera o lead terminar de digitar. 0 responde na hora.</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <input aria-label="Segundos para juntar mensagens" type="number" min={0} max={60} className={cn(inputClassName, 'w-20')} value={behavior.guards.aggregationSeconds} onChange={(event) => setGuards({ aggregationSeconds: Number(event.target.value) })} />s
        </label>
      </div>
      <FieldIssues issues={issues} field="behavior.guards" />
    </SettingsSection>
  </>;
}
