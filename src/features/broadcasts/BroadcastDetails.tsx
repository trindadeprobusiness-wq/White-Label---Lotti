import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, Pause, Play, XCircle } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { automationOnline, controlCampaign, draftFromCampaign, duplicateCampaign, emptyDraft, errorText, getCampaign, type Campaign, type Delivery, type DeliveryStatus } from './api';
import { CAMPAIGN_STATUS, DELIVERY_STATUS, REPLY_POLICY, formatDateTime, reasonText } from './labels';
import BroadcastEditor from './BroadcastEditor';
import { SendingRules } from './BroadcastsPage';

/** /automacoes/novo abre o criador; /automacoes/:id abre o rascunho no criador ou o acompanhamento. */
export default function BroadcastRoute() {
  const { id = 'novo' } = useParams();
  const campaign = useQuery({
    queryKey: ['broadcast', id],
    queryFn: () => getCampaign(id),
    enabled: id !== 'novo',
    refetchInterval: (query) => (['running', 'scheduled', 'paused'].includes(query.state.data?.campaign.status ?? '') ? 10_000 : false),
  });
  if (id === 'novo') return <BroadcastEditor key="novo" initial={emptyDraft()} />;
  if (campaign.isPending) return <p className="mx-auto max-w-4xl text-sm text-muted-foreground">Carregando disparo…</p>;
  if (campaign.isError) return <div className="mx-auto max-w-4xl space-y-3">
    <Link to="/automacoes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Disparos</Link>
    <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{errorText(campaign.error)}</p>
  </div>;
  const { campaign: data, deliveries, events } = campaign.data;
  if (data.status === 'draft') return <BroadcastEditor key={data.id} initial={draftFromCampaign(data)} />;
  return <BroadcastDetails campaign={data} deliveries={deliveries} events={events} />;
}

const EVENT_TEXT: Record<string, string> = {
  created: 'Rascunho criado', updated: 'Rascunho alterado', scheduled: 'Agendado', started: 'Envio iniciado', paused: 'Pausado',
  resumed: 'Retomado', cancelled: 'Cancelado', completed: 'Concluído', duplicated: 'Criado a partir de outro disparo',
};

function BroadcastDetails({ campaign, deliveries, events }: { campaign: Campaign; deliveries: Delivery[]; events: { id: string; kind: string; actor_label: string; created_at: string }[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const online = useQuery({ queryKey: ['automation-online'], queryFn: () => automationOnline(), refetchInterval: 60_000 });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['broadcast', campaign.id] }),
    queryClient.invalidateQueries({ queryKey: ['broadcasts'] }),
  ]);
  const control = useMutation({ mutationFn: (action: 'pause' | 'resume' | 'cancel') => controlCampaign(campaign.id, action), onSuccess: () => { setConfirmCancel(false); return refresh(); } });
  const duplicate = useMutation({ mutationFn: () => duplicateCampaign(campaign.id), onSuccess: (id) => { void refresh(); navigate(`/automacoes/${id}`); } });
  const status = CAMPAIGN_STATUS[campaign.status];
  const count = (...statuses: DeliveryStatus[]) => deliveries.filter((item) => statuses.includes(item.status)).length;
  const active = ['scheduled', 'running', 'paused'].includes(campaign.status);
  const excluded = Object.entries(campaign.excluded ?? {}).filter(([, value]) => value > 0);

  return <div className="mx-auto max-w-4xl space-y-5 animate-fade-in">
    <header className="space-y-3">
      <Link to="/automacoes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Disparos</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{campaign.name}</h1>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', status.tone)}>{status.label}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {campaign.status === 'scheduled' ? `Começa em ${formatDateTime(campaign.starts_at)}` : campaign.started_at ? `Iniciado em ${formatDateTime(campaign.started_at)}` : ''}
            {' · '}Resposta: {REPLY_POLICY[campaign.reply_policy].label}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(campaign.status === 'running' || campaign.status === 'scheduled') && <Button variant="outline" disabled={control.isPending} onClick={() => control.mutate('pause')}><Pause className="h-4 w-4" aria-hidden="true" />Pausar</Button>}
          {campaign.status === 'paused' && <Button variant="outline" disabled={control.isPending} onClick={() => control.mutate('resume')}><Play className="h-4 w-4" aria-hidden="true" />Retomar</Button>}
          {active && !confirmCancel && <Button variant="ghost" onClick={() => setConfirmCancel(true)}><XCircle className="h-4 w-4" aria-hidden="true" />Cancelar</Button>}
          {active && confirmCancel && <Button variant="destructive" disabled={control.isPending} onClick={() => control.mutate('cancel')}>Confirmar cancelamento</Button>}
          <Button variant="outline" disabled={duplicate.isPending} onClick={() => duplicate.mutate()}><Copy className="h-4 w-4" aria-hidden="true" />Duplicar</Button>
        </div>
      </div>
    </header>

    {(control.error || duplicate.error) && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{errorText(control.error ?? duplicate.error)}</p>}
    {active && <SendingRules online={online.data} />}

    <ul aria-label="Resultado do disparo" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Enviadas" value={count('sent')} />
      <Stat label="Na fila" value={count('pending', 'sending')} />
      <Stat label="Não enviadas" value={count('skipped', 'cancelled')} />
      <Stat label="Falhas" value={count('failed', 'uncertain')} />
    </ul>

    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Mensagem</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm">{campaign.body}</p>
      {excluded.length > 0 && <div className="mt-4 border-t pt-3">
        <h3 className="text-xs font-medium text-muted-foreground">Ficaram de fora no início</h3>
        <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">{excluded.map(([reason, value]) => <li key={reason}>{value} · {reasonText(reason)}</li>)}</ul>
      </div>}
    </section>

    <section aria-label="Contatos do disparo" className="overflow-hidden rounded-xl border bg-card">
      <h2 className="border-b px-4 py-3 text-sm font-semibold sm:px-5">Contatos ({deliveries.length})</h2>
      {deliveries.length === 0
        ? <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">{campaign.status === 'scheduled' ? 'A lista de contatos é montada na hora marcada.' : 'Nenhum contato neste disparo.'}</p>
        : <ul className="divide-y">{deliveries.map((delivery) => <li key={delivery.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm sm:px-5">
          <span className="min-w-0">
            <span className="block truncate font-medium">{delivery.contact}</span>
            {delivery.reason && <span className="block text-xs text-muted-foreground">{reasonText(delivery.reason)}</span>}
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-medium">{DELIVERY_STATUS[delivery.status]}</span>
            <span className="block text-xs text-muted-foreground">{formatDateTime(delivery.status === 'pending' ? delivery.scheduled_at : delivery.updated_at)}</span>
          </span>
        </li>)}</ul>}
    </section>

    {events.length > 0 && <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Histórico</h2>
      <ol className="mt-2 space-y-1 text-sm text-muted-foreground">{events.map((event) => <li key={event.id}>{formatDateTime(event.created_at)} · {EVENT_TEXT[event.kind] ?? event.kind} · {event.actor_label}</li>)}</ol>
    </section>}
  </div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <li className="rounded-xl border bg-card p-4"><span className="block text-xs font-medium text-muted-foreground">{label}</span><span className="mt-1 block text-2xl font-semibold">{value}</span></li>;
}
