import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Clock3, Plus, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { automationOnline, errorText, listCampaigns, type CampaignWithCounts } from './api';
import { CAMPAIGN_STATUS, campaignSummary, progress } from './labels';

export default function BroadcastsPage() {
  const navigate = useNavigate();
  const campaigns = useQuery({
    queryKey: ['broadcasts'],
    queryFn: listCampaigns,
    refetchInterval: (query) => (query.state.data?.some((item) => item.status === 'running' || item.status === 'scheduled') ? 10_000 : false),
  });
  const online = useQuery({ queryKey: ['automation-online'], queryFn: () => automationOnline(), refetchInterval: 60_000 });

  return <div className="mx-auto max-w-4xl space-y-5 animate-fade-in">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-primary">Automações</p>
        <h1 className="mt-1 text-2xl font-semibold">Disparos</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">Mensagem para vários contatos de uma vez, pelo WhatsApp conectado.</p>
      </div>
      <Button onClick={() => navigate('/automacoes/novo')}><Plus className="h-4 w-4" aria-hidden="true" />Novo disparo</Button>
    </header>

    <SendingRules online={online.data} />

    {campaigns.isPending && <p className="text-sm text-muted-foreground">Carregando disparos…</p>}
    {campaigns.isError && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{errorText(campaigns.error)}</p>}
    {campaigns.data && campaigns.data.length === 0 && <section className="rounded-xl border border-dashed bg-card p-8 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary"><Send className="h-5 w-5" aria-hidden="true" /></span>
      <h2 className="mt-3 font-semibold">Nenhum disparo ainda</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Monte a mensagem, veja quem vai receber e envie agora ou agende.</p>
      <Button className="mt-4" variant="outline" onClick={() => navigate('/automacoes/novo')}>Criar o primeiro disparo</Button>
    </section>}
    {campaigns.data && campaigns.data.length > 0 && <ul aria-label="Disparos" className="divide-y overflow-hidden rounded-xl border bg-card">
      {campaigns.data.map((campaign) => <CampaignRow key={campaign.id} campaign={campaign} onOpen={() => navigate(`/automacoes/${campaign.id}`)} />)}
    </ul>}
  </div>;
}

/** Regra de quem recebe e se o envio automático está liberado na ponte. */
export function SendingRules({ online }: { online: boolean | undefined }) {
  return <section aria-label="Regras de envio" className="rounded-xl border bg-card p-4 text-sm">
    <p className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span><strong className="font-semibold">Só recebe quem mandou mensagem nas últimas 24 horas.</strong> <span className="text-muted-foreground">É a regra do WhatsApp para mensagem livre. Quem pediu para sair, conversas pausadas ou fechadas e quem conversar depois do agendamento ficam de fora.</span></span>
    </p>
    {online === false && <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-100 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />O envio automático ainda não está liberado. Disparos ativados ficam na fila até a liberação.
    </p>}
  </section>;
}

function CampaignRow({ campaign, onOpen }: { campaign: CampaignWithCounts; onOpen: () => void }) {
  const status = CAMPAIGN_STATUS[campaign.status];
  const showProgress = campaign.total > 0 && ['running', 'paused', 'completed', 'cancelled'].includes(campaign.status);
  return <li>
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{campaign.name}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', status.tone)}>{status.label}</span>
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{campaignSummary(campaign)}</span>
        {showProgress && <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${progress(campaign)}%` }} />
        </span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  </li>;
}
