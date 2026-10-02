import { cn } from '@/lib/utils';
import { Field, FieldIssues, NumberField, Segmented, SettingsSection, StageSelect, ToggleRow, inputClassName, textareaClassName } from '../components';
import type { AgentSettings } from '../settings';
import type { AgentTabProps } from './types';

export function BehaviorTab({ settings, onChange, issues, stages }: AgentTabProps) {
  const behavior = settings.behavior;
  const set = (patch: Partial<AgentSettings['behavior']>) => onChange({ ...settings, behavior: { ...behavior, ...patch } });
  const setHandoff = (patch: Partial<AgentSettings['behavior']['handoff']>) => set({ handoff: { ...behavior.handoff, ...patch } });
  const setGuards = (patch: Partial<AgentSettings['behavior']['guards']>) => set({ guards: { ...behavior.guards, ...patch } });
  const setAttend = (patch: Partial<AgentSettings['behavior']['attend']>) => set({ attend: { ...behavior.attend, ...patch } });
  const semRestricao = !behavior.attend.outsideHours && !behavior.attend.afterDelay;

  return <>
    <SettingsSection
      title="Quando atender"
      description={semRestricao
        ? 'A IA responde toda mensagem que chega. Ligue abaixo para ela entrar só em algumas situações.'
        : 'A IA entra pelos motivos marcados. Qualquer um deles basta.'}
    >
      <ToggleRow
        title="Fora do horário de atendimento"
        description="Ela cobre o turno quando a equipe não está. O expediente é o da aba Agendamento."
        checked={behavior.attend.outsideHours}
        onCheckedChange={(outsideHours) => setAttend({ outsideHours })}
      />
      <ToggleRow
        title="Quando a equipe não responder"
        description="Ela espera o tempo abaixo antes de entrar. Se alguém responder antes, ela não fala por cima."
        checked={behavior.attend.afterDelay}
        onCheckedChange={(afterDelay) => setAttend({ afterDelay })}
      />
      {behavior.attend.afterDelay && <Field label="Minutos de espera antes de a IA entrar" className="max-w-xs">
        {(id) => <NumberField id={id} min={1} max={240} value={behavior.attendDelayMinutes} onChange={(attendDelayMinutes) => set({ attendDelayMinutes })} />}
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
          <NumberField aria-label="Segundos para juntar mensagens" min={0} max={60} className="w-20" value={behavior.guards.aggregationSeconds} onChange={(aggregationSeconds) => setGuards({ aggregationSeconds })} />s
        </label>
      </div>
      <FieldIssues issues={issues} field="behavior.guards" />
    </SettingsSection>
  </>;
}
