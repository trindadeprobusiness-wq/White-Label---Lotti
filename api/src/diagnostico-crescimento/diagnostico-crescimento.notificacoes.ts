import { getQuestion, segmentLabel } from './motor/engine';
import type { ConfigEmailDiagnostico } from './diagnostico-crescimento.config';
import type { DiagnosticoCrescimentoRepo, Notificacao } from './diagnostico-crescimento.repo';

/**
 * Porte de supabase/functions/diagnostic/notifications.ts: a fila durável (diagnostic_notifications)
 * vira e-mail ao operador pelo Resend. Só envia com DIAGNOSTIC_NOTIFICATIONS_ENABLED='true' (ver
 * diagnostico-crescimento.config.ts); desligado, nada é reivindicado e as linhas ficam `pending`.
 *
 * O que sai, quando ligado: POST https://api.resend.com/emails, de EMAIL_FROM para o único endereço
 * LEAD_NOTIFICATION_EMAIL, texto puro com nome, telefone, e-mail, empresa, segmento, origem e campanha
 * do lead (e, na conclusão, temperatura, score, resumo e todas as respostas), mais o link do painel
 * quando DIAGNOSTIC_PUBLIC_URL é https. Um e-mail por sessão e tipo (started/completed), com
 * Idempotency-Key. Nenhum WhatsApp, webhook ou mensagem ao visitante.
 */
export type FetchImpl = typeof globalThis.fetch;

export interface EnvioDiagnostico extends ConfigEmailDiagnostico {
  ligado: boolean;
  fetch?: FetchImpl;
}

const valor = (v: unknown): string => (typeof v === 'string' && v ? v : 'Não informado');

function rotuloResposta(id: string, resposta: unknown): string {
  const pergunta = getQuestion(id);
  const render = (v: unknown) => pergunta?.options?.find((o) => o.value === v)?.label || valor(v);
  return Array.isArray(resposta) ? resposta.map(render).join(', ') : render(resposta);
}

export function textoDaNotificacao(n: Notificacao, publicUrl?: string): string {
  const { lead, session, answers, summary } = n.payload;
  const linhas = [n.kind === 'started' ? 'Novo diagnóstico iniciado.' : 'Diagnóstico concluído.', '',
    `Nome: ${valor(lead?.name)}`, `Telefone: ${valor(lead?.phone)}`, `E-mail: ${valor(lead?.email)}`,
    `Empresa: ${valor(lead?.company)}`, `Segmento: ${lead?.segment ? segmentLabel(lead.segment) : 'Não informado'}`,
    `Origem: ${valor(session.source)}`, `Campanha: ${valor(session.utm_campaign)}`,
    `Status: ${n.kind === 'started' ? 'Diagnóstico em andamento' : 'Diagnóstico concluído'}`,
  ];
  if (n.kind === 'completed') {
    linhas.push('', `Classificação: ${valor(session.temperature)}`, `Score: ${session.score ?? 0}`,
      `Resumo (${summary?.source === 'ai' ? 'IA' : 'regras'}): ${valor(summary?.summary)}`,
      `Principal gargalo: ${valor(summary?.primary_bottleneck)}`, `Recomendação: ${valor(summary?.recommended_next_step)}`, '', 'Respostas:');
    for (const [id, resposta] of Object.entries(answers)) linhas.push(`${getQuestion(id)?.prompt || id}: ${rotuloResposta(id, resposta)}`);
  }
  if (publicUrl) {
    try {
      const url = new URL(`/admin/diagnosticos/${n.session_id}`, publicUrl);
      if (url.protocol === 'https:' || url.hostname === 'localhost') linhas.push('', `Link para visualizar: ${url.toString()}`);
    } catch { /* URL opcional do painel não impede o envio. */ }
  }
  return linhas.join('\n');
}

/** Pronto para enviar: interruptor ligado e Resend configurado. Sem isso, nada é reivindicado. */
export function envioConfigurado(c: EnvioDiagnostico): boolean {
  return c.ligado && (c.provider || 'resend') === 'resend' && !!c.apiKey && !!c.from && !!c.to;
}

/** Fila durável: o lease do claim e a idempotência do Resend tornam seguras drenagens simultâneas. */
export async function drenarNotificacoes(
  repo: Pick<DiagnosticoCrescimentoRepo, 'reivindicarNotificacoes' | 'concluirNotificacao'>,
  c: EnvioDiagnostico,
  sessao?: string,
): Promise<{ sent: number; failed: number }> {
  if (!envioConfigurado(c)) return { sent: 0, failed: 0 };
  const linhas = await repo.reivindicarNotificacoes(sessao || null, sessao ? 2 : 10);
  let sent = 0;
  let failed = 0;
  for (const linha of linhas) {
    let sucesso = false;
    let erro: string | null = null;
    try {
      const nome = valor(linha.payload.lead?.name).replace(/[\r\n]/g, ' ');
      const empresa = linha.payload.lead?.company?.replace(/[\r\n]/g, ' ');
      const r = await (c.fetch ?? ((...a: Parameters<FetchImpl>) => globalThis.fetch(...a)))('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${c.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `diagnostic-${linha.session_id}-${linha.kind}`,
        },
        body: JSON.stringify({
          from: c.from,
          to: [c.to],
          subject: linha.kind === 'started'
            ? `Novo lead iniciou diagnóstico — ${nome}`
            : `Diagnóstico concluído — ${nome}${empresa ? ` / ${empresa}` : ''}`,
          text: textoDaNotificacao(linha, c.publicUrl),
        }),
      });
      sucesso = r.ok;
      erro = r.ok ? null : `provider_http_${r.status}`;
      await r.body?.cancel().catch(() => undefined);
    } catch {
      erro = 'provider_unavailable';
    }
    await repo.concluirNotificacao(linha.id, linha.lease_id, sucesso, erro);
    if (sucesso) sent++;
    else failed++;
  }
  return { sent, failed };
}
