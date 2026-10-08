import { getQuestion, segmentLabel } from '../_shared/diagnostic/engine.ts';
import { rpc, type RpcClient, type Snapshot } from './contracts.ts';

export interface EmailConfig { provider?: string; apiKey?: string; from?: string; to?: string; publicUrl?: string; fetch?: typeof fetch }
interface Notification { id: string; session_id: string; kind: 'started' | 'completed'; lease_id: string; payload: Snapshot }
function value(v: unknown): string { return typeof v === 'string' && v ? v : 'Não informado'; }
function answerLabel(id: string, answer: unknown) {
  const question = getQuestion(id);
  const render = (v: unknown) => question?.options?.find(option => option.value === v)?.label || value(v);
  return Array.isArray(answer) ? answer.map(render).join(', ') : render(answer);
}
export function notificationText(notification: Notification, publicUrl?: string) {
  const { lead, session, answers, summary } = notification.payload;
  const lines = [notification.kind === 'started' ? 'Novo diagnóstico iniciado.' : 'Diagnóstico concluído.', '',
    `Nome: ${value(lead?.name)}`, `Telefone: ${value(lead?.phone)}`, `E-mail: ${value(lead?.email)}`,
    `Empresa: ${value(lead?.company)}`, `Segmento: ${lead?.segment ? segmentLabel(lead.segment) : 'Não informado'}`,
    `Origem: ${value(session.source)}`, `Campanha: ${value(session.utm_campaign)}`,
    `Status: ${notification.kind === 'started' ? 'Diagnóstico em andamento' : 'Diagnóstico concluído'}`,
  ];
  if (notification.kind === 'completed') {
    lines.push('', `Classificação: ${value(session.temperature)}`, `Score: ${session.score ?? 0}`, `Resumo (${summary?.source === 'ai' ? 'IA' : 'regras'}): ${value(summary?.summary)}`,
      `Principal gargalo: ${value(summary?.primary_bottleneck)}`, `Recomendação: ${value(summary?.recommended_next_step)}`, '', 'Respostas:');
    for (const [id, answer] of Object.entries(answers)) lines.push(`${getQuestion(id)?.prompt || id}: ${answerLabel(id, answer)}`);
  }
  if (publicUrl) {
    try {
      const url = new URL(`/admin/diagnosticos/${notification.session_id}`, publicUrl);
      if (url.protocol === 'https:' || url.hostname === 'localhost') lines.push('', `Link para visualizar: ${url.toString()}`);
    } catch { /* Optional admin URL must not prevent delivery. */ }
  }
  return lines.join('\n');
}
/** Durable outbox; claim leases + Resend idempotency make concurrent drains safe. */
export async function drainNotifications(client: RpcClient, config: EmailConfig, sessionId?: string): Promise<{ sent: number; failed: number }> {
  // Do not claim until configured: the admin can see pending delivery clearly.
  if ((config.provider || 'resend') !== 'resend' || !config.apiKey || !config.from || !config.to) return { sent: 0, failed: 0 };
  const rows = await rpc(client, 'diagnostic_claim_notifications', { p_session: sessionId || null, p_limit: sessionId ? 2 : 10 }) as Notification[];
  let sent = 0, failed = 0;
  for (const row of rows) {
    let success = false, error: string | null = null;
    try {
      const name = value(row.payload.lead?.name).replace(/[\r\n]/g, ' ');
      const company = row.payload.lead?.company?.replace(/[\r\n]/g, ' ');
      const result = await (config.fetch || fetch)('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `diagnostic-${row.session_id}-${row.kind}` },
        body: JSON.stringify({ from: config.from, to: [config.to], subject: row.kind === 'started' ? `Novo lead iniciou diagnóstico — ${name}` : `Diagnóstico concluído — ${name}${company ? ` / ${company}` : ''}`, text: notificationText(row, config.publicUrl) }),
      });
      success = result.ok;
      error = result.ok ? null : `provider_http_${result.status}`;
      await result.body?.cancel();
    } catch { error = 'provider_unavailable'; }
    await rpc(client, 'diagnostic_finish_notification', { p_id: row.id, p_lease: row.lease_id, p_success: success, p_error: error });
    if (success) sent++; else failed++;
  }
  return { sent, failed };
}
