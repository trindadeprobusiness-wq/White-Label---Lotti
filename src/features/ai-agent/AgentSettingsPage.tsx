import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { AlertTriangle, Bot, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { AGENT_TABS, agentModel, loadAgentSettings, type AgentSettings, type AgentTab } from './settings';
import { fetchServerSettings, storeSettings, type SettingsSource } from './remoteSettings';
import { describeAttendMode, describeBusinessHours, describeHandoff } from './summary';
import { hasBlockingIssues, issuesByTab, validateAgentSettings } from './validation';
import { stageName, useStageOptions } from './useStageOptions';
import { IdentityTab } from './tabs/IdentityTab';
import { ServiceTab } from './tabs/ServiceTab';
import { ScheduleTab } from './tabs/ScheduleTab';
import { ToolsTab } from './tabs/ToolsTab';
import type { AgentTabProps } from './tabs/types';

const TAB_COMPONENTS: Record<AgentTab, ComponentType<AgentTabProps>> = {
  identity: IdentityTab,
  service: ServiceTab,
  schedule: ScheduleTab,
  tools: ToolsTab,
};

const tabLabel = (tab: AgentTab) => AGENT_TABS.find((item) => item.id === tab)?.label ?? tab;

/** Dentro de Configurações a tela já tem título próprio; repetir o do agente
 *  daria dois cabeçalhos na mesma página. Os controles de salvar ficam. */
export default function AgentSettingsPage({ embutido = false }: { embutido?: boolean } = {}) {
  const [saved, setSaved] = useState<AgentSettings>(() => loadAgentSettings());
  const [settings, setSettings] = useState<AgentSettings>(saved);
  const [activeTab, setActiveTab] = useState<AgentTab>('identity');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'blocked' | 'failed'>('idle');
  const [source, setSource] = useState<SettingsSource>('browser');
  const { stages, unavailable } = useStageOptions();

  const issues = useMemo(() => validateAgentSettings(settings), [settings]);
  const errorCounts = issuesByTab(issues);
  const blockingIssues = issues.filter((issue) => issue.severity === 'error');
  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(saved), [settings, saved]);

  // Em telas estreitas a faixa de abas rola: traz a aba escolhida (por atalho ou clique) para a vista.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    document.getElementById(`agent-tab-${activeTab}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Abre na hora com a cópia local e troca pela versão do banco, sem perder edição em andamento.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    let live = true;
    fetchServerSettings().then((server) => {
      if (!live || !server) return;
      setSource('server');
      setSaved(server);
      if (!dirtyRef.current) setSettings(server);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const change = (next: AgentSettings) => {
    setSettings(next);
    setSaveState((state) => (state === 'blocked' ? 'blocked' : 'idle'));
  };

  const save = async () => {
    if (hasBlockingIssues(issues)) { setSaveState('blocked'); return; }
    const snapshot = settings;
    setSaveState('saving');
    try {
      setSource(await storeSettings(snapshot));
      setSaved(snapshot);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
  };

  const discard = () => {
    setSettings(saved);
    setSaveState('idle');
  };

  const handoffStage = stageName(stages, settings.behavior.handoff.stageId);
  const summary: Array<{ tab: AgentTab; label: string; value: string }> = [
    { tab: 'identity', label: 'Modelo', value: `${agentModel(settings.model).label} · ${agentModel(settings.model).provider}` },
    { tab: 'service', label: 'Quando atende', value: describeAttendMode(settings.behavior) },
    { tab: 'schedule', label: 'Horário', value: describeBusinessHours(settings.schedule.week) },
    { tab: 'service', label: 'Follow-up', value: settings.followUp.enabled ? `${settings.followUp.delaysHours.length} ${settings.followUp.delaysHours.length === 1 ? 'toque' : 'toques'}${settings.followUp.closeConversation ? ', fecha sem resposta' : ''}` : 'Desligado' },
    { tab: 'service', label: 'Encaminhamento', value: describeHandoff(settings.behavior, handoffStage) },
  ];
  const ActiveTab = TAB_COMPONENTS[activeTab];

  return <div className={embutido ? 'space-y-5' : 'mx-auto max-w-4xl space-y-5 animate-fade-in'}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      {embutido
        ? <div className="min-w-0" />
        : <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">Automações</p>
            <h1 className="mt-1 text-2xl font-semibold">Agente de IA</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground">Como a IA atende, qualifica e passa os leads do WhatsApp para a sua equipe.</p>
          </div>}
      <div className="flex flex-wrap items-center gap-2">
        <SaveStatus dirty={dirty} state={saveState} source={source} />
        {dirty && <Button variant="ghost" onClick={discard}>Descartar</Button>}
        <Button onClick={save} disabled={saveState === 'saving'}>Salvar alterações</Button>
      </div>
    </header>

    {saveState === 'blocked' && blockingIssues.length > 0 && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Corrija {blockingIssues.length === 1 ? '1 pendência' : `${blockingIssues.length} pendências`} antes de salvar</p>
      <ul className="mt-2 space-y-1.5">
        {blockingIssues.map((issue) => <li key={`${issue.field}-${issue.message}`} className="flex flex-wrap items-baseline gap-x-2">
          <span>{issue.message}</span>
          <button type="button" className="text-xs font-medium text-primary underline-offset-4 hover:underline" onClick={() => setActiveTab(issue.tab)}>Abrir {tabLabel(issue.tab)}</button>
        </li>)}
      </ul>
    </div>}
    {saveState === 'failed' && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      Não foi possível salvar a configuração agora. Suas alterações continuam na tela; tente de novo.
    </div>}

    <section aria-label="Estado do agente" className="rounded-xl border bg-card">
      <div className="flex items-start gap-3 p-5">
        <span className="rounded-lg bg-primary/10 p-2 text-primary"><Bot className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Agente ativo</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{settings.active ? 'Ativo' : 'Desligado'}</span>
              <Switch aria-label="Agente ativo" checked={settings.active} onCheckedChange={(active) => change({ ...settings, active })} />
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{settings.active ? 'Ligado: atende os leads do WhatsApp com as regras abaixo.' : 'Desligado: não atende nenhuma conversa.'}</p>
        </div>
      </div>
      <ul aria-label="Resumo do agente" className={cn('grid border-t sm:grid-cols-2 lg:grid-cols-5', !settings.active && 'opacity-60')}>
        {summary.map((item) => <li key={item.label} data-testid={item.label === 'Modelo' ? 'model-in-use' : undefined} className="border-b last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0">
          <button type="button" onClick={() => setActiveTab(item.tab)} className="flex h-full w-full flex-col items-start justify-start px-5 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <span className="block text-xs font-medium text-muted-foreground">{item.label}</span>
            <span className="mt-1 block text-sm font-medium">{item.value}</span>
          </button>
        </li>)}
      </ul>
    </section>

    <div>
      <div role="tablist" aria-label="Configurações do agente" className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {AGENT_TABS.map((tab) => {
          const count = errorCounts[tab.id];
          return <button
            key={tab.id}
            type="button"
            role="tab"
            id={`agent-tab-${tab.id}`}
            aria-controls="agent-tab-panel"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn('flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors', activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {tab.label}
            {count ? <span aria-hidden="true" title={`${count} pendência(s)`} className="grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-destructive-foreground">{count}</span> : null}
          </button>;
        })}
      </div>
      <div role="tabpanel" id="agent-tab-panel" aria-labelledby={`agent-tab-${activeTab}`} className="mt-4 space-y-4">
        {unavailable && ['service', 'service', 'schedule'].includes(activeTab) && <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Não foi possível carregar as etapas do funil agora. Os seletores de etapa ficam só com "Não mover".
        </p>}
        <ActiveTab settings={settings} onChange={change} issues={issues} stages={stages} onOpenTab={setActiveTab} />
      </div>
    </div>
  </div>;
}

function SaveStatus({ dirty, state, source }: { dirty: boolean; state: 'idle' | 'saving' | 'saved' | 'blocked' | 'failed'; source: SettingsSource }) {
  if (state === 'saving') return <span className="text-xs font-medium text-muted-foreground">Salvando…</span>;
  if (dirty) return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Alterações não salvas</span>;
  if (state === 'saved') return <span className="flex items-center gap-1 text-xs font-medium text-primary"><Check className="h-3.5 w-3.5" aria-hidden="true" />{source === 'server' ? 'Salvo' : 'Salvo neste navegador'}</span>;
  return null;
}
