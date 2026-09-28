import { cn } from '@/lib/utils';
import { FieldIssues, SettingsSection, textareaClassName } from '../components';
import { PROMPT_LIMIT } from '../settings';
import type { AgentTabProps } from './types';

const SUGGESTIONS = [
  'Priorize imóveis prontos para morar.',
  'Pergunte se o cliente já tem crédito aprovado para financiamento.',
  'Não atenda pedidos de aluguel por temporada.',
];

export function PromptTab({ settings, onChange, issues }: AgentTabProps) {
  const setPrompt = (value: string) => onChange({ ...settings, prompt: value });
  const addSuggestion = (text: string) => setPrompt(settings.prompt.trim() ? `${settings.prompt.trimEnd()}\n${text}` : text);

  return <>
    <SettingsSection title="Instruções adicionais" description="Regras da sua operação. Não substituem as proteções.">
      <div className="space-y-2">
        <textarea aria-label="Instruções adicionais" className={cn(textareaClassName, 'min-h-40')} value={settings.prompt} placeholder="Uma regra por linha. Ex.: Nunca informe valor de condomínio sem confirmar com o corretor." onChange={(event) => setPrompt(event.target.value)} />
        <p className={cn('text-right text-xs tabular-nums', settings.prompt.length > PROMPT_LIMIT ? 'font-medium text-destructive' : 'text-muted-foreground')}>{settings.prompt.length}/{PROMPT_LIMIT}</p>
      </div>
      <FieldIssues issues={issues} field="prompt" />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Sugestões:
        {SUGGESTIONS.filter((text) => !settings.prompt.includes(text)).map((text) => <button key={text} type="button" onClick={() => addSuggestion(text)} className="rounded-full border px-2.5 py-1 text-foreground hover:border-primary">+ {text}</button>)}
      </div>
    </SettingsSection>

  </>;
}
