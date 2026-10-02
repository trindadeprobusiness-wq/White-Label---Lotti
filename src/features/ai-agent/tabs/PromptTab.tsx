import { useState } from 'react';
import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';
import { FieldIssues, Segmented, SettingsSection, textareaClassName } from '../components';
import { PROMPT_LIMIT } from '../settings';
import { anexarSugestao } from '../markdownPrompt';
import type { AgentTabProps } from './types';

/**
 * As instruções do corretor são um documento, não um recado.
 *
 * O campo era um textarea sans-serif com "uma regra por linha": quem escrevia
 * dez regras acabava com um parágrafo corrido sem hierarquia, impossível de
 * revisar. Tratar o texto como arquivo .md dá títulos, listas e ênfase — e o
 * que estrutura o texto para quem escreve também estrutura para o modelo.
 *
 * O editor é de propósito simples: fonte monoespaçada e um alternador
 * Escrever/Pré-visualizar. Nada de barra de botões, realce de sintaxe ou
 * numeração de linha — nenhum dos três existe no projeto e todos custariam
 * dependência nova para resolver um problema que o corretor não tem.
 */

const MODELO = `## Prioridades

- Priorize imóveis prontos para morar.
- Pergunte se o cliente já tem crédito aprovado para financiamento.

## Não fazer

- Não atenda pedidos de aluguel por temporada.
- Nunca informe valor de condomínio sem confirmar com o corretor.
`;

const SUGESTOES = [
  'Priorize imóveis prontos para morar.',
  'Pergunte se o cliente já tem crédito aprovado para financiamento.',
  'Não atenda pedidos de aluguel por temporada.',
];

export function PromptTab({ settings, onChange, issues }: AgentTabProps) {
  const [modo, setModo] = useState<'escrever' | 'previa'>('escrever');
  const setPrompt = (value: string) => onChange({ ...settings, prompt: value });
  const excedeu = settings.prompt.length > PROMPT_LIMIT;

  return <SettingsSection
    title="Instruções adicionais"
    description="Regras da sua operação, escritas como um documento. Não substituem as proteções do agente."
    action={<Segmented
      label="Como ver as instruções"
      value={modo}
      onChange={setModo}
      options={[{ id: 'escrever', label: 'Escrever' }, { id: 'previa', label: 'Pré-visualizar' }]}
    />}
  >
    <div className="space-y-2">
      {modo === 'escrever' ? <textarea
        aria-label="Instruções adicionais"
        spellCheck={false}
        className={cn(textareaClassName, 'min-h-64 font-mono text-[12.5px] leading-relaxed')}
        value={settings.prompt}
        placeholder={MODELO}
        onChange={(event) => setPrompt(event.target.value)}
      /> : <div className="min-h-64 rounded-lg border bg-muted/20 p-4">
        {settings.prompt.trim()
          ? <Markdown>{settings.prompt}</Markdown>
          : <p className="text-sm text-muted-foreground">Nada escrito ainda. O agente segue só com as configurações das abas.</p>}
      </div>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Aceita Markdown: <code className="font-mono">## título</code>, <code className="font-mono">- item</code>, <code className="font-mono">**negrito**</code>.
        </p>
        <p className={cn('text-xs tabular-nums', excedeu ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {settings.prompt.length}/{PROMPT_LIMIT}
        </p>
      </div>
    </div>

    <FieldIssues issues={issues} field="prompt" />

    {!settings.prompt.trim() && <button
      type="button"
      onClick={() => setPrompt(MODELO)}
      className="self-start rounded-lg border px-3 py-1.5 text-sm hover:border-primary"
    >Começar com um modelo</button>}

    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      Sugestões:
      {SUGESTOES.filter((texto) => !settings.prompt.includes(texto)).map((texto) => <button
        key={texto}
        type="button"
        onClick={() => setPrompt(anexarSugestao(settings.prompt, texto))}
        className="rounded-full border px-2.5 py-1 text-foreground hover:border-primary"
      >+ {texto}</button>)}
    </div>
  </SettingsSection>;
}
