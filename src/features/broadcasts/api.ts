import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// Tabelas e funções dos Disparos (migration 20260927150000) ainda não estão nos
// tipos gerados.
const db = supabase as unknown as SupabaseClient;

export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
export type ReplyPolicy = 'ai' | 'human' | 'preserve';
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'skipped' | 'failed' | 'uncertain' | 'cancelled';

export type CampaignDraft = {
  id?: string;
  name: string;
  body: string;
  stageIds: string[];
  startsAt: string | null;
  intervalSeconds: number;
  maxRecipients: number;
  replyPolicy: ReplyPolicy;
};

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  body: string;
  stage_ids: string[];
  starts_at: string | null;
  interval_seconds: number;
  max_recipients: number;
  reply_policy: ReplyPolicy;
  total: number;
  excluded: Record<string, number>;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type CampaignWithCounts = Campaign & { counts: Partial<Record<DeliveryStatus, number>> };

export type Delivery = {
  id: string;
  status: DeliveryStatus;
  reason: string | null;
  scheduled_at: string;
  updated_at: string;
  contact: string;
};

export type CampaignEvent = { id: string; kind: string; actor_label: string; created_at: string; detail: Record<string, unknown> };

export type Preview = {
  eligible: number;
  overLimit: number;
  excluded: Record<string, number>;
  samples: { contact: string; text: string }[];
};

export const emptyDraft = (): CampaignDraft => ({
  name: '',
  body: 'Oi, {{nome}}! ',
  stageIds: [],
  startsAt: null,
  intervalSeconds: 60,
  maxRecipients: 100,
  replyPolicy: 'preserve',
});

export const draftFromCampaign = (campaign: Campaign): CampaignDraft => ({
  id: campaign.id,
  name: campaign.name,
  body: campaign.body,
  stageIds: campaign.stage_ids ?? [],
  startsAt: campaign.starts_at,
  intervalSeconds: campaign.interval_seconds,
  maxRecipients: campaign.max_recipients,
  replyPolicy: campaign.reply_policy,
});

const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

/** Erro do banco em texto para a tela. `unavailable`: migration ainda não aplicada. */
export class BroadcastError extends Error {
  constructor(public code: string) { super(code); }
}

function fail(error: { code?: string; message?: string } | null): never {
  if (error?.code && MISSING.has(error.code)) throw new BroadcastError('unavailable');
  const known = /(invalid_[a-z_]+|no_eligible_contacts|not_editable|forbidden)/.exec(error?.message ?? '');
  throw new BroadcastError(known?.[1] ?? 'failed');
}

export const ERROR_TEXT: Record<string, string> = {
  unavailable: 'Os Disparos ainda não estão liberados nesta conta.',
  invalid_name: 'Dê um nome de até 120 caracteres para o disparo.',
  invalid_body: 'Escreva a mensagem (até 1.000 caracteres).',
  invalid_variable: 'Use só as variáveis {{nome}} e {{corretor}}.',
  invalid_limits: 'Confira o intervalo entre envios e o máximo de contatos.',
  invalid_schedule: 'Escolha uma data de envio nos próximos 30 dias.',
  invalid_stage: 'Uma das etapas escolhidas não existe mais.',
  invalid_reply_policy: 'Escolha o que acontece quando o contato responder.',
  no_eligible_contacts: 'Ninguém pode receber agora: nenhum contato do público mandou mensagem nas últimas 24 horas.',
  not_editable: 'Este disparo já foi ativado e não pode mais ser editado. Duplique para fazer outro.',
  invalid_action: 'Essa ação não vale para o estado atual do disparo.',
  forbidden: 'Você não tem acesso a este disparo.',
  failed: 'Não foi possível concluir agora. Tente de novo.',
};

export const errorText = (error: unknown) => ERROR_TEXT[error instanceof BroadcastError ? error.code : 'failed'] ?? ERROR_TEXT.failed;

export async function listCampaigns(): Promise<CampaignWithCounts[]> {
  const { data, error } = await db.from('lotti_broadcast_campaigns')
    .select('*, lotti_broadcast_deliveries(status)')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) fail(error);
  return (data as Array<Campaign & { lotti_broadcast_deliveries: { status: DeliveryStatus }[] }>).map(({ lotti_broadcast_deliveries: deliveries, ...campaign }) => ({
    ...campaign,
    counts: (deliveries ?? []).reduce<Partial<Record<DeliveryStatus, number>>>((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {}),
  }));
}

export async function getCampaign(id: string): Promise<{ campaign: Campaign; deliveries: Delivery[]; events: CampaignEvent[] }> {
  const [campaign, deliveries, events] = await Promise.all([
    db.from('lotti_broadcast_campaigns').select('*').eq('id', id).maybeSingle(),
    db.from('lotti_broadcast_deliveries')
      .select('id,status,reason,scheduled_at,updated_at,lotti_agent_conversations(contact_name,clientes(nome))')
      .eq('campaign_id', id).order('scheduled_at').limit(300),
    db.from('lotti_broadcast_events').select('id,kind,actor_label,created_at,detail').eq('campaign_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (campaign.error) fail(campaign.error);
  if (!campaign.data) throw new BroadcastError('forbidden');
  if (deliveries.error) fail(deliveries.error);
  if (events.error) fail(events.error);
  type Row = Omit<Delivery, 'contact'> & { lotti_agent_conversations: { contact_name: string | null; clientes: { nome: string } | null } | null };
  return {
    campaign: campaign.data as Campaign,
    deliveries: (deliveries.data as unknown as Row[]).map(({ lotti_agent_conversations: conversation, ...delivery }) => {
      const client = conversation?.clientes?.nome;
      return { ...delivery, contact: (client && client !== 'Contato WhatsApp' ? client : conversation?.contact_name) || 'Contato sem nome' };
    }),
    events: events.data as CampaignEvent[],
  };
}

const call = async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.rpc(name, args);
  if (error) fail(error);
  return data as T;
};

export const saveCampaign = (draft: CampaignDraft) => call<string>('lotti_broadcast_save', { p_campaign: draft });
export const previewCampaign = (draft: CampaignDraft) => call<Preview>('lotti_broadcast_preview', { p_campaign: draft });
export const activateCampaign = (id: string) => call<{ status: CampaignStatus; total?: number }>('lotti_broadcast_activate', { p_id: id });
export const controlCampaign = (id: string, action: 'pause' | 'resume' | 'cancel') => call<CampaignStatus>('lotti_broadcast_control', { p_id: id, p_action: action });
export const duplicateCampaign = (id: string) => call<string>('lotti_broadcast_duplicate', { p_id: id });
export const deleteDraft = (id: string) => call<boolean>('lotti_broadcast_delete_draft', { p_id: id });

/** A ponte passou nos últimos 2 minutos: o envio automático está liberado. */
export async function automationOnline(now = Date.now()): Promise<boolean> {
  const { data, error } = await db.from('lotti_automation_heartbeat').select('seen_at').maybeSingle();
  if (error || !data) return false;
  return now - Date.parse((data as { seen_at: string }).seen_at) < 120_000;
}
