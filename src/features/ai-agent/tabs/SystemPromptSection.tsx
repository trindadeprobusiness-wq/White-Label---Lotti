import { cn } from '@/lib/utils';
import { FieldIssues, SettingsSection, textareaClassName } from '../components';
import { PROMPT_PADRAO_AGENTE, SYSTEM_PROMPT_LIMIT } from '../settings';
import type { AgentTabProps } from './types';

/**
 * O prompt do agente, como no Clix: o texto padrão vem do código e aparece aqui para editar.
 * Salvar igual ao padrão (ou apagar tudo) grava "" e o agente segue com o padrão do código,
 * que pode melhorar sem a conta ficar presa a uma cópia antiga. As regras de segurança e o
 * formato da resposta ficam fora deste texto e valem sempre.
 */
export function SystemPromptSection({ settings, onChange, issues }: AgentTabProps) {
  const texto = settings.systemPrompt.trim() ? settings.systemPrompt : PROMPT_PADRAO_AGENTE;
  const personalizado = !!settings.systemPrompt.trim();
  const excedeu = texto.length > SYSTEM_PROMPT_LIMIT;
  const salvar = (valor: string) => onChange({
    ...settings,
    systemPrompt: valor.trim() === PROMPT_PADRAO_AGENTE.trim() ? '' : valor,
  });

  return <SettingsSection
    title="Prompt do agente"
    description="Como o agente pensa e conversa. As regras de segurança e de dados valem sempre, mesmo editando aqui."
    action={personalizado ? <button
      type="button"
      onClick={() => salvar('')}
      className="rounded-lg border px-3 py-1.5 text-sm hover:border-primary"
    >Restaurar padrão</button> : undefined}
  >
    <div className="space-y-2">
      <textarea
        aria-label="Prompt do agente"
        spellCheck={false}
        className={cn(textareaClassName, 'min-h-96 font-mono text-[12.5px] leading-relaxed')}
        value={texto}
        onChange={(event) => salvar(event.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {personalizado ? 'Prompt personalizado.' : 'Usando o prompt padrão da Lotti.'}{' '}
          Variáveis: <code className="font-mono">{'{{nome_agente}}'}</code>, <code className="font-mono">{'{{imobiliaria}}'}</code>, <code className="font-mono">{'{{regiao_atendida}}'}</code>.
        </p>
        <p className={cn('text-xs tabular-nums', excedeu ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {texto.length}/{SYSTEM_PROMPT_LIMIT}
        </p>
      </div>
    </div>
    <FieldIssues issues={issues} field="systemPrompt" />
  </SettingsSection>;
}
