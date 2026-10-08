import { BOTTLENECK_LABELS, buildSummary, getQuestion, segmentLabel } from './motor/engine';
import type { ConfigEmailDiagnostico } from './diagnostico-crescimento.config';
import type { DiagnosticoCrescimentoRepo, Notificacao } from './diagnostico-crescimento.repo';

/**
 * Porte de supabase/functions/diagnostic/notifications.ts (#53 + #54): a fila durável
 * (diagnostic_notifications) vira e-mail ao operador pelo Resend. Só envia com
 * DIAGNOSTIC_NOTIFICATIONS_ENABLED='true' (ver diagnostico-crescimento.config.ts); desligado, nada é
 * reivindicado e as linhas ficam `pending`.
 *
 * O que sai, quando ligado: POST https://api.resend.com/emails, de EMAIL_FROM para o único endereço
 * LEAD_NOTIFICATION_EMAIL, em texto e HTML (o mesmo conteúdo, com escape), com nome, telefone, e-mail,
 * empresa, segmento, origem, UTMs e horários (Brasília) do lead. Na conclusão e no parcial por abandono
 * (contato capturado e 10 min sem resposta), também a leitura comercial e todas as respostas salvas;
 * mais o link do painel quando DIAGNOSTIC_PUBLIC_URL é https. No máximo um e-mail por sessão e tipo
 * (started/abandoned/completed), com Idempotency-Key. Nenhum WhatsApp, webhook ou mensagem ao visitante.
 */
export type FetchImpl = typeof globalThis.fetch;

export interface EnvioDiagnostico extends ConfigEmailDiagnostico {
  ligado: boolean;
  fetch?: FetchImpl;
}

const TITULOS = {
  started: 'Novo lead iniciou diagnóstico',
  completed: 'Diagnóstico concluído',
  abandoned: 'Diagnóstico parcial — contato não concluiu',
} as const;
const PROXIMOS_PASSOS: Record<string, string> = {
  strategy_call: 'Conversa estratégica', send_diagnostic: 'Enviar análise', nurture: 'Acompanhar o momento da operação',
};

function dataHora(v: unknown): string {
  return typeof v === 'string' && v && Number.isFinite(Date.parse(v))
    ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : 'Não informado';
}

const valor = (v: unknown): string => (typeof v === 'string' && v ? v : 'Não informado');

function rotuloResposta(id: string, resposta: unknown): string {
  const pergunta = getQuestion(id);
  const render = (v: unknown) => pergunta?.options?.find((o) => o.value === v)?.label || valor(v);
  return Array.isArray(resposta) ? resposta.map(render).join(', ') : render(resposta);
}

export function textoDaNotificacao(n: Notificacao, publicUrl?: string): string {
  const { lead, session, answers } = n.payload;
  const parcial = n.kind === 'abandoned';
  const resumo = n.payload.summary || (parcial && (answers.bottleneck || answers.goal) ? buildSummary(answers) : null);
  const linhas = [TITULOS[n.kind], '',
    ...(parcial ? ['A pessoa informou contato, mas ficou pelo menos 10 minutos sem enviar uma nova resposta. Este é um diagnóstico parcial.', ''] : []),
    `Nome: ${valor(lead?.name)}`, `Telefone: ${valor(lead?.phone)}`, `E-mail: ${valor(lead?.email)}`,
    `Empresa: ${valor(lead?.company)}`, `Segmento: ${lead?.segment ? segmentLabel(lead.segment) : 'Não informado'}`,
    `Origem: ${valor(session.source)}`, `UTM source: ${valor(session.utm_source)}`, `UTM medium: ${valor(session.utm_medium)}`, `Campanha: ${valor(session.utm_campaign)}`,
    `UTM content: ${valor(session.utm_content)}`, `UTM term: ${valor(session.utm_term)}`,
    `Início (Brasília): ${dataHora(session.started_at)}`, `Última atividade (Brasília): ${dataHora(session.last_activity_at)}`,
    `Status: ${parcial ? 'Diagnóstico parcial / sem atividade' : n.kind === 'started' ? 'Diagnóstico em andamento' : 'Diagnóstico concluído'}`,
  ];
  if (n.kind !== 'started') {
    linhas.push('', 'LEITURA COMERCIAL', `Classificação${parcial ? ' parcial' : ''}: ${valor(session.temperature)}`, `Score${parcial ? ' parcial' : ''}: ${session.score ?? 0}`,
      `Faturamento: ${rotuloResposta('revenue', answers.revenue)}`, `Investimento em mídia: ${rotuloResposta('paid_budget', answers.paid_budget)}`,
      `Objetivo: ${rotuloResposta('goal', answers.goal)}`, `Urgência: ${rotuloResposta('urgency', answers.urgency)}`, `Decisor: ${rotuloResposta('decision', answers.decision)}`,
      `Resumo (${resumo?.source === 'ai' ? 'IA' : 'regras'}): ${resumo?.summary || 'Ainda não há respostas suficientes para identificar os gargalos. Retomar a conversa com o contato capturado.'}`,
      `Principal gargalo: ${resumo ? BOTTLENECK_LABELS[resumo.primary_bottleneck] || resumo.primary_bottleneck : 'Não identificado'}`,
      `Recomendação: ${parcial ? 'Retomar o diagnóstico com a pessoa e confirmar as informações pendentes' : PROXIMOS_PASSOS[resumo?.recommended_next_step || ''] || 'Analisar as respostas'}`, '', 'RESPOSTAS SALVAS:');
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

const escaparHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function htmlDaNotificacao(n: Notificacao, publicUrl?: string): string {
  const linhas = textoDaNotificacao(n, publicUrl).split('\n');
  const corpo = linhas.slice(1).map((linha) => {
    if (!linha) return '<tr><td style="height:16px"></td></tr>';
    const separador = linha.indexOf(': ');
    return `<tr><td style="padding:6px 0;line-height:1.6;overflow-wrap:anywhere">${separador > 0 ? `<strong>${escaparHtml(linha.slice(0, separador))}:</strong> ${escaparHtml(linha.slice(separador + 2))}` : escaparHtml(linha)}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#eef3f5;font-family:Arial,sans-serif;color:#193e4b"><table role="presentation" style="width:100%;padding:24px"><tr><td><table role="presentation" style="max-width:680px;width:100%;margin:auto;background:#fff;border-radius:16px;padding:28px"><tr><td style="font-size:12px;letter-spacing:1px">GABRIEL TRINDADE · DIAGNÓSTICO DE CRESCIMENTO</td></tr><tr><td><h1 style="font-size:24px">${escaparHtml(linhas[0])}</h1></td></tr>${corpo}</table></td></tr></table></body></html>`;
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
          subject: `${TITULOS[linha.kind]} — ${nome}${linha.kind !== 'started' && empresa ? ` / ${empresa}` : ''}`,
          text: textoDaNotificacao(linha, c.publicUrl),
          html: htmlDaNotificacao(linha, c.publicUrl),
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
