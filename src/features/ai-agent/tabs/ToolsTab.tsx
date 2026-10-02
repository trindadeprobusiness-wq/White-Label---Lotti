import { Check, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SettingsSection, ToggleRow } from '../components';
import type { AgentSettings, AgentTab } from '../settings';
import type { AgentTabProps } from './types';

const DATA_TOOLS: Array<{ key: keyof AgentSettings['tools']; title: string; description: string }> = [
  { key: 'imoveis', title: 'Buscar imóveis compatíveis', description: 'Imóveis disponíveis da sua carteira.' },
  { key: 'linkPublico', title: 'Enviar link público do imóvel', description: 'Página pública, sem endereço exato.' },
  { key: 'historico', title: 'Consultar histórico do cliente', description: 'Conversas e registros anteriores no CRM.' },
  { key: 'qualificacao', title: 'Registrar qualificação', description: 'Salva no cadastro o que o lead informou.' },
];

export function ToolsTab({ settings, onChange, onOpenTab }: AgentTabProps) {
  const setTool = (key: keyof AgentSettings['tools'], enabled: boolean) => onChange({ ...settings, tools: { ...settings.tools, [key]: enabled } });
  const movesStage = [settings.behavior.handoff.stageId, settings.followUp.finalStageId, settings.schedule.visits.stageId].some(Boolean);

  const capabilityTools: Array<{ title: string; tab: AgentTab; tabLabel: string; on: boolean }> = [
    { title: 'Encaminhar para corretor', tab: 'service', tabLabel: 'Atendimento', on: true },
    { title: 'Mover etapa do funil', tab: 'service', tabLabel: 'Atendimento', on: movesStage },
    { title: 'Retomar conversas paradas', tab: 'service', tabLabel: 'Atendimento', on: settings.followUp.enabled },
    { title: 'Propor horários de visita', tab: 'schedule', tabLabel: 'Agenda', on: settings.schedule.visits.enabled },
  ];

  return <>
    <SettingsSection title="Dados que a IA consulta" description="Dados do proprietário, documentos, cobrança e conversas de outros clientes nunca entram.">
      {DATA_TOOLS.map((tool) => <ToggleRow key={tool.key} title={tool.title} description={tool.description} checked={settings.tools[tool.key]} onCheckedChange={(enabled) => setTool(tool.key, enabled)} />)}
    </SettingsSection>

    <SettingsSection title="Ligadas por outras abas">
      <ul className="divide-y rounded-lg border">
        {capabilityTools.map((tool) => <li key={tool.title} className="flex items-center gap-3 px-3 py-2.5">
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm font-medium">{tool.title}</span>
          <button type="button" className="text-xs font-medium text-primary underline-offset-4 hover:underline" onClick={() => onOpenTab(tool.tab)}>{tool.tabLabel}</button>
          <span className={cn('flex w-20 shrink-0 items-center justify-end gap-1 text-xs font-semibold', tool.on ? 'text-primary' : 'text-muted-foreground')}>
            {tool.on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{tool.on ? 'Ligada' : 'Desligada'}
          </span>
        </li>)}
      </ul>
    </SettingsSection>
  </>;
}
