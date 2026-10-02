import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { Field, FieldIssues, SettingsSection, inputClassName, textareaClassName } from '../components';
import { buildGreetingPreview } from '../prompt';
import { AGENT_MODEL_OPTIONS, AGENT_NAME_VARIABLE, COMPANY_VARIABLE, INTRO_LIMIT, NAME_LIMIT, agentModel, type AgentModelId, type AgentSettings } from '../settings';
import type { AgentTabProps } from './types';

export function IdentityTab({ settings, onChange, issues }: AgentTabProps) {
  const identity = settings.identity;
  const introRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<AgentSettings['identity']>) => onChange({ ...settings, identity: { ...identity, ...patch } });

  const insertVariable = (variable: string) => {
    const textarea = introRef.current;
    const start = textarea?.selectionStart ?? identity.intro.length;
    const end = textarea?.selectionEnd ?? identity.intro.length;
    set({ intro: `${identity.intro.slice(0, start)}${variable}${identity.intro.slice(end)}` });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  return <>
    <SettingsSection title="Modelo de IA" description={agentModel(settings.model).description}>
      <select aria-label="Modelo de IA" className={cn(inputClassName, 'max-w-md')} value={settings.model} onChange={(event) => onChange({ ...settings, model: event.target.value as AgentModelId })}>
        {AGENT_MODEL_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.provider}</option>)}
      </select>
    </SettingsSection>

    <SettingsSection title="Apresentação">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do agente" hint="Como a IA se apresenta ao lead." counter={{ value: identity.name.length, limit: NAME_LIMIT }}>
          {(id) => <input id={id} className={inputClassName} value={identity.name} onChange={(event) => set({ name: event.target.value })} />}
        </Field>
        <Field label="Nome da imobiliária" hint="Usado na mensagem de apresentação.">
          {(id) => <input id={id} className={inputClassName} value={identity.company} placeholder="Ex.: Imobiliária Aurora" onChange={(event) => set({ company: event.target.value })} />}
        </Field>
      </div>
      <FieldIssues issues={issues} field="identity.name" />
      <FieldIssues issues={issues} field="identity.company" />

      <Field label="Mensagem de apresentação" counter={{ value: identity.intro.length, limit: INTRO_LIMIT }}>
        {(id) => <>
          <textarea id={id} ref={introRef} className={textareaClassName} value={identity.intro} onChange={(event) => set({ intro: event.target.value })} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Inserir:
            {[AGENT_NAME_VARIABLE, COMPANY_VARIABLE].map((variable) => <button key={variable} type="button" onClick={() => insertVariable(variable)} className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-foreground hover:border-primary">{variable}</button>)}
          </div>
        </>}
      </Field>
      <FieldIssues issues={issues} field="identity.intro" />

      <figure className="rounded-lg bg-primary/5 p-3">
        <figcaption className="text-xs font-medium text-muted-foreground">Como o lead vê</figcaption>
        <p data-testid="greeting-preview" className="mt-2 max-w-md whitespace-pre-wrap rounded-lg rounded-tl-none bg-background px-3 py-2 text-sm shadow-sm">
          {buildGreetingPreview(identity) || 'Escreva a mensagem de apresentação.'}
        </p>
      </figure>
    </SettingsSection>

  </>;
}
