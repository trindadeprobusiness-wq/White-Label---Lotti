import { BOTTLENECK_LABELS, buildSummary, getQuestion, segmentLabel } from '../_shared/diagnostic/engine.ts';
import { rpc, type RpcClient, type Snapshot } from './contracts.ts';

export interface EmailConfig { provider?: string; apiKey?: string; from?: string; to?: string; publicUrl?: string; fetch?: typeof fetch }
export interface Notification { id: string; session_id: string; kind: 'started' | 'completed' | 'abandoned'; lease_id: string; payload: Snapshot }
const titles = { started: 'Novo lead iniciou diagnóstico', completed: 'Diagnóstico concluído', abandoned: 'Diagnóstico parcial — contato não concluiu' };
const nextSteps: Record<string, string> = { strategy_call: 'Conversa estratégica', send_diagnostic: 'Enviar análise', nurture: 'Acompanhar o momento da operação' };
function dateTime(v: string | null) {
  return v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Não informado';
}
function value(v: unknown): string { return typeof v === 'string' && v ? v : 'Não informado'; }
function answerLabel(id: string, answer: unknown) {
  const question = getQuestion(id);
  const render = (v: unknown) => question?.options?.find(option => option.value === v)?.label || value(v);
  return Array.isArray(answer) ? answer.map(render).join(', ') : render(answer);
}
export function notificationText(notification: Notification, publicUrl?: string) {
  const { lead, session, answers } = notification.payload;
  const partial = notification.kind === 'abandoned';
  const summary = notification.payload.summary || (partial && (answers.bottleneck || answers.goal) ? buildSummary(answers) : null);
  const lines = [titles[notification.kind], '',
    ...(partial ? ['A pessoa informou contato, mas ficou pelo menos 10 minutos sem enviar uma nova resposta. Este é um diagnóstico parcial.', ''] : []),
    `Nome: ${value(lead?.name)}`, `Telefone: ${value(lead?.phone)}`, `E-mail: ${value(lead?.email)}`,
    `Empresa: ${value(lead?.company)}`, `Segmento: ${lead?.segment ? segmentLabel(lead.segment) : 'Não informado'}`,
    `Origem: ${value(session.source)}`, `UTM source: ${value(session.utm_source)}`, `UTM medium: ${value(session.utm_medium)}`, `Campanha: ${value(session.utm_campaign)}`,
    `UTM content: ${value(session.utm_content)}`, `UTM term: ${value(session.utm_term)}`,
    `Início (Brasília): ${dateTime(session.started_at)}`, `Última atividade (Brasília): ${dateTime(session.last_activity_at)}`,
    `Status: ${partial ? 'Diagnóstico parcial / sem atividade' : notification.kind === 'started' ? 'Diagnóstico em andamento' : 'Diagnóstico concluído'}`,
  ];
  if (notification.kind !== 'started') {
    lines.push('', 'LEITURA COMERCIAL', `Classificação${partial ? ' parcial' : ''}: ${value(session.temperature)}`, `Score${partial ? ' parcial' : ''}: ${session.score ?? 0}`,
      `Faturamento: ${answerLabel('revenue', answers.revenue)}`, `Investimento em mídia: ${answerLabel('paid_budget', answers.paid_budget)}`,
      `Objetivo: ${answerLabel('goal', answers.goal)}`, `Urgência: ${answerLabel('urgency', answers.urgency)}`, `Decisor: ${answerLabel('decision', answers.decision)}`,
      `Resumo (${summary?.source === 'ai' ? 'IA' : 'regras'}): ${summary?.summary || 'Ainda não há respostas suficientes para identificar os gargalos. Retomar a conversa com o contato capturado.'}`,
      `Principal gargalo: ${summary ? BOTTLENECK_LABELS[summary.primary_bottleneck] || summary.primary_bottleneck : 'Não identificado'}`,
      `Recomendação: ${partial ? 'Retomar o diagnóstico com a pessoa e confirmar as informações pendentes' : nextSteps[summary?.recommended_next_step || ''] || 'Analisar as respostas'}`, '', 'RESPOSTAS SALVAS:');
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
function escapeHtml(v: string) { return v.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
export function notificationHtml(notification: Notification, publicUrl?: string) {
  const lines = notificationText(notification, publicUrl).split('\n');
  const body = lines.slice(1).map(line => {
    if (!line) return '<tr><td style="height:16px"></td></tr>';
    const separator = line.indexOf(': ');
    return `<tr><td style="padding:6px 0;line-height:1.6;overflow-wrap:anywhere">${separator > 0 ? `<strong>${escapeHtml(line.slice(0, separator))}:</strong> ${escapeHtml(line.slice(separator + 2))}` : escapeHtml(line)}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#eef3f5;font-family:Arial,sans-serif;color:#193e4b"><table role="presentation" style="width:100%;padding:24px"><tr><td><table role="presentation" style="max-width:680px;width:100%;margin:auto;background:#fff;border-radius:16px;padding:28px"><tr><td style="font-size:12px;letter-spacing:1px">GABRIEL TRINDADE · DIAGNÓSTICO DE CRESCIMENTO</td></tr><tr><td><h1 style="font-size:24px">${escapeHtml(lines[0])}</h1></td></tr>${body}</table></td></tr></table></body></html>`;
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
        body: JSON.stringify({ from: config.from, to: [config.to], subject: `${titles[row.kind]} — ${name}${row.kind !== 'started' && company ? ` / ${company}` : ''}`, text: notificationText(row, config.publicUrl), html: notificationHtml(row, config.publicUrl) }),
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
