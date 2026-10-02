import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { AgentIssue } from './validation';

export const inputClassName = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
export const textareaClassName = 'min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
export const checkboxClassName = 'mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary disabled:cursor-not-allowed';

/** Um card por assunto, empilhado em coluna única. */
export function SettingsSection({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return <section className="rounded-xl border bg-card p-5">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
    {children ? <div className="mt-4 min-w-0 space-y-4">{children}</div> : null}
  </section>;
}

export function Field({ label, hint, children, counter, className }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; counter?: { value: number; limit: number }; className?: string }) {
  const id = useId();
  return <div className={cn('space-y-2', className)}>
    <div className="flex items-baseline justify-between gap-3">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {counter && <span className={cn('text-xs tabular-nums', counter.value > counter.limit ? 'font-medium text-destructive' : 'text-muted-foreground')}>{counter.value}/{counter.limit}</span>}
    </div>
    {children(id)}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
}

export function ToggleRow({ title, description, checked, onCheckedChange, children }: { title: string; description?: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void; children?: ReactNode }) {
  return <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
    <Switch aria-label={title} checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
  </div>;
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
    {options.map((option) => <button
      key={option.id}
      type="button"
      role="radio"
      aria-checked={value === option.id}
      onClick={() => onChange(option.id)}
      className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', value === option.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
    >{option.label}</button>)}
  </div>;
}

/** Mensagens de pendência de um campo, exibidas logo abaixo do controle. */
export function FieldIssues({ issues, field, exact = false }: { issues: AgentIssue[]; field: string; exact?: boolean }) {
  const matches = issues.filter((issue) => (exact ? issue.field === field : issue.field === field || issue.field.startsWith(`${field}.`)));
  if (!matches.length) return null;
  return <ul className="space-y-1">
    {matches.map((issue) => <li key={`${issue.field}-${issue.message}`} className={cn('flex items-start gap-1.5 text-sm', issue.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400')}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{issue.message}
    </li>)}
  </ul>;
}

export type StageOption = { id: string; name: string };

export function StageSelect({ label, value, onChange, stages, emptyLabel = 'Não mover', hint }: { label: string; value: string | null; onChange: (value: string | null) => void; stages: StageOption[]; emptyLabel?: string; hint?: ReactNode }) {
  const missing = value !== null && stages.length > 0 && !stages.some((stage) => stage.id === value);
  return <Field label={label} hint={hint}>
    {(id) => <>
      <select id={id} className={inputClassName} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{emptyLabel}</option>
        {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        {missing && <option value={value}>Etapa removida do funil</option>}
      </select>
      {missing && <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />A etapa escolhida não existe mais no funil. Escolha outra ou "{emptyLabel}".</p>}
    </>}
  </Field>;
}

export function LockedNote({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{children}</p>;
}

/**
 * Campo de número que guarda o que foi digitado, não o número.
 *
 * Com `value={numero}` e `onChange={Number(...)}`, apagar o campo vira
 * `Number('') === 0`: aparece um "0" que ninguém escreveu, e o próximo dígito
 * entra depois dele — digitar "12" num campo vazio mostrava "012".
 *
 * Aqui o texto é o estado enquanto se edita. Ao sair do campo, ele volta a
 * refletir o número guardado, o que também some com zeros à esquerda. Campo
 * vazio continua vazio na tela; quem reclama disso é a validação, que tem a
 * mensagem certa para dar.
 */
export function NumberField({ id, value, onChange, min, max, className, ...resto }: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [texto, setTexto] = useState(() => String(value));
  // Guarda o último número que veio de fora. Comparar com ele distingue uma
  // mudança externa (descartar, carregar) de uma digitação — depender do foco
  // para isso deixava o campo refém de um evento que nem sempre acontece.
  const [ultimoValor, setUltimoValor] = useState(value);
  if (value !== ultimoValor) {
    setUltimoValor(value);
    setTexto(String(value));
  }

  return <input
    {...resto}
    id={id}
    type="number"
    min={min}
    max={max}
    className={cn(inputClassName, className)}
    value={texto}
    onChange={(event) => {
      setTexto(event.target.value);
      const numero = Number(event.target.value);
      // Texto vazio ou inválido não vira 0 às escondidas: o número guardado
      // fica como estava até a pessoa digitar algo que seja um número.
      if (event.target.value.trim() !== '' && Number.isFinite(numero)) onChange(numero);
    }}
    // Sair do campo vazio ou com lixo devolve o último número válido: salvar
    // um valor que a pessoa não escolheu é pior que desfazer a digitação.
    onBlur={() => setTexto(String(value))}
  />;
}
