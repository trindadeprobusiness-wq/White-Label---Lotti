import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarClock, Check, FileText, MessageSquareText, Send, Trash2, UsersRound, Zap } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useStageOptions } from '@/features/ai-agent/useStageOptions';
import { activateCampaign, automationOnline, deleteDraft, errorText, previewCampaign, saveCampaign, type CampaignDraft, type Preview } from './api';
import { INTERVALS, REPLY_POLICY, reasonText } from './labels';
import { SendingRules } from './BroadcastsPage';
import { MAX_BODY, draftIssues } from './draft';

const STEPS = [
  { title: 'Público', icon: UsersRound },
  { title: 'Mensagem', icon: MessageSquareText },
  { title: 'Envio', icon: CalendarClock },
  { title: 'Revisar', icon: Check },
] as const;
const VARIABLES = [
  { token: '{{nome}}', label: 'Primeiro nome do contato' },
  { token: '{{corretor}}', label: 'Seu nome' },
];
// datetime-local trabalha no horário do navegador; o banco recebe ISO.
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function useDebounced<T>(value: T, delay = 500): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setCurrent(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return current;
}

export default function BroadcastEditor({ initial }: { initial: CampaignDraft }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CampaignDraft>(initial);
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const { stages } = useStageOptions();
  const issues = useMemo(() => draftIssues(draft), [draft]);
  const set = (patch: Partial<CampaignDraft>) => { setDraft((current) => ({ ...current, ...patch })); setNotice(null); };

  const previewInput = useDebounced({ stageIds: draft.stageIds, body: draft.body, maxRecipients: draft.maxRecipients });
  const preview = useQuery({
    queryKey: ['broadcast-preview', previewInput],
    queryFn: () => previewCampaign({ ...draft, ...previewInput, name: draft.name.trim() || 'Novo disparo', startsAt: null }),
    enabled: previewInput.body.trim().length > 0 && draftIssues({ ...draft, ...previewInput, name: 'x', startsAt: null }).length === 0,
    staleTime: 15_000,
    retry: false,
  });
  const online = useQuery({ queryKey: ['automation-online'], queryFn: () => automationOnline(), refetchInterval: 60_000 });

  const persist = async () => {
    const id = await saveCampaign(draft);
    setDraft((current) => ({ ...current, id }));
    await queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
    return id;
  };
  const saveDraft = useMutation({ mutationFn: persist, onSuccess: () => setNotice('Rascunho salvo.') });
  const activate = useMutation({
    mutationFn: async () => { const id = await persist(); await activateCampaign(id); return id; },
    onSuccess: (id) => { void queryClient.invalidateQueries({ queryKey: ['broadcasts'] }); navigate(`/automacoes/${id}`); },
  });
  const remove = useMutation({
    mutationFn: () => deleteDraft(draft.id!),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['broadcasts'] }); navigate('/automacoes'); },
  });
  const failure = saveDraft.error ?? activate.error ?? remove.error;
  const scheduled = draft.startsAt !== null;
  const busy = saveDraft.isPending || activate.isPending || remove.isPending;

  return <div className="mx-auto max-w-4xl space-y-5 animate-fade-in">
    <header className="space-y-3">
      <Link to="/automacoes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Disparos</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{draft.id ? 'Editar disparo' : 'Novo disparo'}</h1>
          <p className="mt-1 text-muted-foreground">Rascunho: nada é enviado até você ativar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notice && <span className="flex items-center gap-1 text-xs font-medium text-primary"><Check className="h-3.5 w-3.5" aria-hidden="true" />{notice}</span>}
          {draft.id && <Button variant="ghost" onClick={() => remove.mutate()} disabled={busy}><Trash2 className="h-4 w-4" aria-hidden="true" />Excluir</Button>}
          <Button variant="outline" onClick={() => saveDraft.mutate()} disabled={busy || !draft.name.trim() || !draft.body.trim()}>Salvar rascunho</Button>
        </div>
      </div>
    </header>

    {failure && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{errorText(failure)}</p>}

    <nav aria-label="Etapas do disparo" className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {STEPS.map((item, index) => {
        const Icon = item.icon;
        return <button key={item.title} type="button" aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}
          className={cn('flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors', index === step ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          <Icon className="h-4 w-4" aria-hidden="true" />{index + 1}. {item.title}
        </button>;
      })}
    </nav>

    <section className="rounded-xl border bg-card p-4 sm:p-6">
      {step === 0 && <AudienceStep draft={draft} set={set} stages={stages} preview={preview.data} loading={preview.isFetching} error={preview.error} />}
      {step === 1 && <MessageStep draft={draft} set={set} />}
      {step === 2 && <SendStep draft={draft} set={set} />}
      {step === 3 && <ReviewStep draft={draft} preview={preview.data} error={preview.error} issues={issues} online={online.data} stages={stages} />}
      <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button variant="outline" onClick={() => (step === 0 ? navigate('/automacoes') : setStep(step - 1))}>{step === 0 ? 'Cancelar' : 'Voltar'}</Button>
        {step < STEPS.length - 1
          ? <Button onClick={() => setStep(step + 1)}>Próximo<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
          : <Button onClick={() => activate.mutate()} disabled={busy || issues.length > 0 || (!scheduled && !preview.data?.eligible)}>
            <Send className="h-4 w-4" aria-hidden="true" />{activate.isPending ? 'Ativando…' : scheduled ? 'Agendar disparo' : 'Enviar agora'}
          </Button>}
      </footer>
    </section>
  </div>;
}

type StepProps = { draft: CampaignDraft; set: (patch: Partial<CampaignDraft>) => void };

function AudienceStep({ draft, set, stages, preview, loading, error }: StepProps & { stages: { id: string; name: string }[]; preview: Preview | undefined; loading: boolean; error: unknown }) {
  const toggle = (id: string) => set({ stageIds: draft.stageIds.includes(id) ? draft.stageIds.filter((item) => item !== id) : [...draft.stageIds, id] });
  return <div className="space-y-5">
    <div>
      <h2 className="text-lg font-semibold">Quem recebe</h2>
      <p className="mt-1 text-sm text-muted-foreground">Contatos do WhatsApp conectado que mandaram mensagem nas últimas 24 horas. Filtre pela etapa do funil, se quiser.</p>
    </div>
    <fieldset>
      <legend className="text-sm font-medium">Etapa do funil</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        <Chip active={draft.stageIds.length === 0} onClick={() => set({ stageIds: [] })}>Todos os contatos</Chip>
        {stages.map((stage) => <Chip key={stage.id} active={draft.stageIds.includes(stage.id)} onClick={() => toggle(stage.id)}>{stage.name}</Chip>)}
      </div>
    </fieldset>
    <AudienceCount preview={preview} loading={loading} error={error} />
  </div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick}
    className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors', active ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-muted/60')}>{children}</button>;
}

function AudienceCount({ preview, loading, error }: { preview: Preview | undefined; loading: boolean; error: unknown }) {
  if (error) return <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{errorText(error)}</p>;
  if (!preview) return <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{loading ? 'Calculando quem recebe…' : 'Escreva a mensagem para calcular quem recebe.'}</p>;
  const excluded = Object.entries(preview.excluded).filter(([, count]) => count > 0);
  return <div aria-live="polite" className="rounded-lg border p-4">
    <p className="text-sm"><strong className="text-2xl font-semibold">{preview.eligible}</strong> {preview.eligible === 1 ? 'contato recebe' : 'contatos recebem'} agora</p>
    {(excluded.length > 0 || preview.overLimit > 0) && <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
      {preview.overLimit > 0 && <li>{preview.overLimit} acima do máximo de contatos</li>}
      {excluded.map(([reason, count]) => <li key={reason}>{count} fora: {reasonText(reason).toLowerCase()}</li>)}
    </ul>}
    <p className="mt-3 text-xs text-muted-foreground">No agendamento, o público é recalculado na hora do envio.</p>
  </div>;
}

function MessageStep({ draft, set }: StepProps) {
  const insert = (token: string) => set({ body: `${draft.body}${draft.body && !draft.body.endsWith(' ') ? ' ' : ''}${token}` });
  return <div className="space-y-5">
    <label className="block text-sm font-medium">Nome do disparo
      <Input className="mt-1.5" maxLength={120} value={draft.name} placeholder="Ex.: Lançamento Jardins" onChange={(event) => set({ name: event.target.value })} />
      <span className="mt-1 block text-xs font-normal text-muted-foreground">Só você vê este nome.</span>
    </label>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-primary bg-primary/5 p-4"><MessageSquareText className="mb-2 h-5 w-5 text-primary" aria-hidden="true" /><strong className="block text-sm">Mensagem livre</strong><span className="mt-1 block text-sm text-muted-foreground">Para quem falou com você nas últimas 24 horas.</span></div>
      <div aria-disabled="true" className="rounded-lg border border-dashed bg-muted/30 p-4 text-muted-foreground"><FileText className="mb-2 h-5 w-5" aria-hidden="true" /><strong className="block text-sm">Modelo aprovado pela Meta</strong><span className="mt-1 block text-sm">Indisponível: exige a API oficial do WhatsApp.</span></div>
    </div>
    <label className="block text-sm font-medium">Mensagem
      <Textarea className="mt-1.5 min-h-32" maxLength={MAX_BODY} value={draft.body} onChange={(event) => set({ body: event.target.value })} />
    </label>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-2">
        {VARIABLES.map((variable) => <Button key={variable.token} type="button" variant="outline" size="sm" title={variable.label} onClick={() => insert(variable.token)}>{variable.token}</Button>)}
      </div>
      <span className="text-xs text-muted-foreground">{draft.body.length}/{MAX_BODY}</span>
    </div>
    <p className="text-xs text-muted-foreground">{'{{nome}}'} vira o primeiro nome do contato; quem não tem nome fica de fora. {'{{corretor}}'} vira o seu nome.</p>
  </div>;
}

function SendStep({ draft, set }: StepProps) {
  const scheduled = draft.startsAt !== null;
  const defaultStart = () => new Date(Date.now() + 3600_000).toISOString();
  return <div className="space-y-6">
    <fieldset>
      <legend className="text-sm font-medium">Quando enviar</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Option active={!scheduled} onClick={() => set({ startsAt: null })} icon={<Send className="h-4 w-4" aria-hidden="true" />} title="Agora" description="Assim que ativar." />
        <Option active={scheduled} onClick={() => set({ startsAt: draft.startsAt ?? defaultStart() })} icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />} title="Agendar" description="Em data e hora marcadas." />
        <Option disabled icon={<Zap className="h-4 w-4" aria-hidden="true" />} title="Por evento" description="Em breve." />
      </div>
      {scheduled && <label className="mt-3 block max-w-xs text-sm font-medium">Data e hora
        <Input type="datetime-local" className="mt-1.5" value={toLocalInput(draft.startsAt)} onChange={(event) => set({ startsAt: event.target.value ? new Date(event.target.value).toISOString() : null })} />
      </label>}
    </fieldset>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">Intervalo entre mensagens
        <select className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.intervalSeconds} onChange={(event) => set({ intervalSeconds: Number(event.target.value) })}>
          {INTERVALS.map((item) => <option key={item.seconds} value={item.seconds}>{item.label}</option>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">Espaçar protege o número de bloqueio.</span>
      </label>
      <label className="block text-sm font-medium">Máximo de contatos
        <Input type="number" min={1} max={300} className="mt-1.5" value={draft.maxRecipients} onChange={(event) => set({ maxRecipients: Number(event.target.value) })} />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">Até 300 por disparo e 300 por dia na conta.</span>
      </label>
    </div>
    <fieldset>
      <legend className="text-sm font-medium">Quando o contato responder</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {(Object.keys(REPLY_POLICY) as Array<keyof typeof REPLY_POLICY>).map((policy) =>
          <Option key={policy} active={draft.replyPolicy === policy} onClick={() => set({ replyPolicy: policy })} title={REPLY_POLICY[policy].label} description={REPLY_POLICY[policy].description} />)}
      </div>
    </fieldset>
  </div>;
}

function Option({ active = false, disabled = false, onClick, icon, title, description }: { active?: boolean; disabled?: boolean; onClick?: () => void; icon?: ReactNode; title: string; description: string }) {
  return <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick}
    className={cn('rounded-lg border p-3 text-left transition-colors', active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50', disabled && 'cursor-not-allowed border-dashed bg-muted/30 text-muted-foreground hover:bg-muted/30')}>
    <span className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</span>
    <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
  </button>;
}

function ReviewStep({ draft, preview, error, issues, online, stages }: { draft: CampaignDraft; preview: Preview | undefined; error: unknown; issues: string[]; online: boolean | undefined; stages: { id: string; name: string }[] }) {
  const audience = draft.stageIds.length ? draft.stageIds.map((id) => stages.find((stage) => stage.id === id)?.name ?? 'Etapa').join(', ') : 'Todos os contatos';
  const interval = INTERVALS.find((item) => item.seconds === draft.intervalSeconds)?.label ?? `${draft.intervalSeconds} s`;
  return <div className="space-y-5">
    <h2 className="text-lg font-semibold">Revisar e ativar</h2>
    {issues.length > 0 && <ul role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <Fact label="Disparo" value={draft.name || '—'} />
      <Fact label="Público" value={audience} />
      <Fact label="Quando" value={draft.startsAt ? new Date(draft.startsAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Agora, ao ativar'} />
      <Fact label="Ritmo" value={`1 mensagem a cada ${interval}, até ${draft.maxRecipients} contatos`} />
      <Fact label="Quando responder" value={REPLY_POLICY[draft.replyPolicy].label} />
    </dl>
    <AudienceCount preview={preview} loading={false} error={error} />
    {preview && preview.samples.length > 0 && <div>
      <h3 className="text-sm font-medium">Como a mensagem chega</h3>
      <ul className="mt-2 space-y-2">
        {preview.samples.map((sample) => <li key={sample.contact} className="rounded-lg bg-muted/50 p-3 text-sm">
          <span className="block text-xs font-medium text-muted-foreground">{sample.contact}</span>
          <span className="mt-1 block whitespace-pre-wrap">{sample.text}</span>
        </li>)}
      </ul>
    </div>}
    <SendingRules online={online} />
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
}
