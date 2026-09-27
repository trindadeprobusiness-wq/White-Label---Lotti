import type { CampaignStatus, CampaignWithCounts, DeliveryStatus, ReplyPolicy } from './api';

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: string }> = {
  draft: { label: 'Rascunho', tone: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Agendado', tone: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200' },
  running: { label: 'Enviando', tone: 'bg-primary/10 text-primary' },
  paused: { label: 'Pausado', tone: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  completed: { label: 'Concluído', tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
  cancelled: { label: 'Cancelado', tone: 'bg-muted text-muted-foreground' },
};

export const DELIVERY_STATUS: Record<DeliveryStatus, string> = {
  pending: 'Na fila',
  sending: 'Enviando',
  sent: 'Enviada',
  skipped: 'Não enviada',
  failed: 'Falhou',
  uncertain: 'Sem confirmação',
  cancelled: 'Cancelada',
};

// Motivos gravados pelo banco e pela ponte, no idioma da tela.
export const REASONS: Record<string, string> = {
  opted_out: 'Pediu para não receber mensagens',
  outside_window: 'Não mandou mensagem nas últimas 24 horas',
  paused_or_closed: 'Conversa pausada ou fechada',
  missing_name: 'Sem nome para preencher {{nome}}',
  over_limit: 'Acima do máximo de contatos',
  conversation_moved: 'Conversou depois do agendamento',
  conversation_changed: 'Conversou logo antes do envio',
  conversation_unavailable: 'Conversa indisponível',
  conversation_paused: 'Conversa pausada',
  delivery_pending: 'Outra mensagem ainda estava saindo',
  delivery_rejected: 'O WhatsApp recusou a mensagem',
  delivery_uncertain: 'O WhatsApp não confirmou o envio',
  delivery_commit_failed: 'O WhatsApp não confirmou o envio',
  campaign_cancelled: 'Disparo cancelado',
  bridge_interrupted: 'O envio foi interrompido',
  lease_lost: 'Conversa ocupada no momento do envio',
  live_send_disabled: 'Envio automático desligado',
};

export const reasonText = (reason: string | null) => (reason ? REASONS[reason] ?? 'Não enviada' : '');

export const REPLY_POLICY: Record<ReplyPolicy, { label: string; description: string }> = {
  preserve: { label: 'Sem mudança', description: 'Quem estava com a equipe continua com a equipe; quem estava com a IA continua com a IA.' },
  ai: { label: 'IA atende', description: 'A resposta do contato vai para o Agente de IA.' },
  human: { label: 'Equipe atende', description: 'A resposta do contato fica para a equipe, sem a IA.' },
};

export const INTERVALS = [
  { seconds: 30, label: '30 segundos' },
  { seconds: 60, label: '1 minuto' },
  { seconds: 120, label: '2 minutos' },
  { seconds: 300, label: '5 minutos' },
];

const dateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
export const formatDateTime = (value: string | null) => (value ? dateTime.format(new Date(value)) : '');

/** Linha de resumo da campanha na lista. */
export function campaignSummary(campaign: CampaignWithCounts): string {
  const sent = campaign.counts.sent ?? 0;
  const notSent = (campaign.counts.skipped ?? 0) + (campaign.counts.failed ?? 0) + (campaign.counts.uncertain ?? 0) + (campaign.counts.cancelled ?? 0);
  switch (campaign.status) {
    case 'draft': return `Editado em ${formatDateTime(campaign.updated_at)}`;
    case 'scheduled': return `Começa em ${formatDateTime(campaign.starts_at)}`;
    case 'running':
    case 'paused': return `${sent} de ${campaign.total} ${campaign.total === 1 ? 'enviada' : 'enviadas'}`;
    case 'completed': return campaign.total === 0
      ? 'Ninguém podia receber no início'
      : `${sent} ${sent === 1 ? 'enviada' : 'enviadas'}${notSent ? `, ${notSent} não ${notSent === 1 ? 'enviada' : 'enviadas'}` : ''}`;
    case 'cancelled': return `Cancelado com ${sent} ${sent === 1 ? 'enviada' : 'enviadas'}`;
  }
}

/** Fração concluída (enviadas ou encerradas) das entregas criadas. */
export function progress(campaign: CampaignWithCounts): number {
  if (!campaign.total) return 0;
  const open = (campaign.counts.pending ?? 0) + (campaign.counts.sending ?? 0);
  return Math.round(((campaign.total - open) / campaign.total) * 100);
}
