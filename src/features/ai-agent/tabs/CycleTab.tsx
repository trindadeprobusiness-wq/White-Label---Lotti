import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Field, FieldIssues, SettingsSection, StageSelect, ToggleRow, inputClassName, textareaClassName } from '../components';
import { FOLLOW_UP_WINDOW_HOURS, MAX_FOLLOW_UPS, type AgentSettings } from '../settings';
import type { AgentTabProps } from './types';

export function CycleTab({ settings, onChange, issues, stages }: AgentTabProps) {
  const followUp = settings.followUp;
  const set = (patch: Partial<AgentSettings['followUp']>) => onChange({ ...settings, followUp: { ...followUp, ...patch } });
  const setDelay = (index: number, value: number) => set({ delaysHours: followUp.delaysHours.map((delay, itemIndex) => (itemIndex === index ? value : delay)) });

  return <>
    <SettingsSection
      title="Follow-up"
      description={followUp.enabled ? 'A IA retoma a conversa quando o lead para de responder. Resposta do lead ou da equipe cancela os toques.' : 'Desligado: a IA não retoma conversas paradas.'}
      action={<Switch aria-label="Retomar conversas paradas" checked={followUp.enabled} onCheckedChange={(enabled) => set({ enabled })} />}
    >
      {followUp.enabled && <>
        <ol className="space-y-2">
          {followUp.delaysHours.map((delay, index) => <li key={index} className="flex items-center gap-2 text-sm">
            <span className="w-16 shrink-0 rounded-full bg-muted px-2 py-1 text-center text-xs font-semibold">{index + 1}º toque</span>
            <input
              aria-label={`${index + 1}º toque, horas após ${index === 0 ? 'a última mensagem' : 'o anterior'}`}
              type="number"
              min={1}
              max={FOLLOW_UP_WINDOW_HOURS}
              className={cn(inputClassName, 'w-20')}
              value={delay}
              onChange={(event) => setDelay(index, Number(event.target.value))}
            />
            <span className="text-muted-foreground">horas<span className="hidden sm:inline">{index === 0 ? ' após a última mensagem' : ' após o toque anterior'}</span></span>
            <Button type="button" variant="ghost" size="icon" className="ml-auto h-8 w-8 text-muted-foreground" aria-label={`Remover ${index + 1}º toque`} disabled={followUp.delaysHours.length === 1} onClick={() => set({ delaysHours: followUp.delaysHours.filter((_, itemIndex) => itemIndex !== index) })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>)}
        </ol>
        {followUp.delaysHours.length < MAX_FOLLOW_UPS && <Button type="button" variant="outline" size="sm" onClick={() => set({ delaysHours: [...followUp.delaysHours, 4] })}>
          <Plus className="h-4 w-4" />Adicionar toque
        </Button>}
        <FollowUpTimeline followUp={followUp} />
        <FieldIssues issues={issues} field="followUp.delaysHours" />

        <Field label="Objetivo dos toques" hint="A IA escreve cada mensagem; aqui vai só a intenção.">
          {(id) => <textarea id={id} className={cn(textareaClassName, 'min-h-20')} value={followUp.objective} onChange={(event) => set({ objective: event.target.value })} />}
        </Field>
        <FieldIssues issues={issues} field="followUp.objective" />
        <ToggleRow title="Respeitar o horário de atendimento" description="Toque fora do horário espera o próximo expediente." checked={followUp.respectBusinessHours} onCheckedChange={(respectBusinessHours) => set({ respectBusinessHours })} />
      </>}
    </SettingsSection>

    {followUp.enabled && <SettingsSection title="Sem resposta" description="Depois do último toque.">
      <ToggleRow title="Fechar a conversa" description={followUp.closeConversation ? undefined : 'Desligado: a conversa fica aberta na Inbox.'} checked={followUp.closeConversation} onCheckedChange={(closeConversation) => set({ closeConversation })} />
      {followUp.closeConversation && <div className="space-y-4 rounded-lg border p-4">
        <Field label="Fechar após (horas do último toque)" className="max-w-xs">
          {(id) => <input id={id} type="number" min={1} max={72} className={inputClassName} value={followUp.closeAfterHours} onChange={(event) => set({ closeAfterHours: Number(event.target.value) })} />}
        </Field>
        <ToggleRow title="Despedir-se antes de fechar" checked={followUp.farewell} onCheckedChange={(farewell) => set({ farewell })} />
        {followUp.farewell && <Field label="Objetivo da despedida">
          {(id) => <textarea id={id} className={cn(textareaClassName, 'min-h-16')} value={followUp.farewellObjective} onChange={(event) => set({ farewellObjective: event.target.value })} />}
        </Field>}
        <FieldIssues issues={issues} field="followUp.closeAfterHours" />
        <FieldIssues issues={issues} field="followUp.farewellObjective" />
      </div>}
      <StageSelect label="Etapa do funil ao final" value={followUp.finalStageId} onChange={(finalStageId) => set({ finalStageId })} stages={stages} />
    </SettingsSection>}
  </>;
}

/** Linha do tempo acumulada desde a última mensagem, marcando o que sai da janela de 24 h. */
function FollowUpTimeline({ followUp }: { followUp: AgentSettings['followUp'] }) {
  let elapsed = 0;
  const steps = followUp.delaysHours.map((delay, index) => {
    elapsed += Number.isFinite(delay) ? delay : 0;
    return { label: `${index + 1}º toque`, at: elapsed, outside: elapsed > FOLLOW_UP_WINDOW_HOURS };
  });
  const ending = followUp.closeConversation ? `Fecha ${followUp.closeAfterHours}h depois` : 'Fica aberta';

  return <ol aria-label="Linha do tempo do follow-up" className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
    <li className="rounded-full border px-2.5 py-1 font-medium">Última mensagem</li>
    {steps.map((step) => <li key={step.label} className="flex items-center gap-2">
      <span aria-hidden="true" className="h-px w-4 bg-border" />
      <span className={cn('rounded-full px-2.5 py-1 font-medium', step.outside ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-primary/10 text-primary')}>
        {step.label} · {step.at}h{step.outside && ' · fora da janela'}
      </span>
    </li>)}
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className="h-px w-4 bg-border" />
      <span className="rounded-full border px-2.5 py-1 font-medium text-muted-foreground">{ending}</span>
    </li>
  </ol>;
}
