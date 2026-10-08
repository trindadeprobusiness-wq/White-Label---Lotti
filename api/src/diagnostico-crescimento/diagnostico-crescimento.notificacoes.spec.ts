import { lerConfigDiagnostico } from './diagnostico-crescimento.config';
import { buildSummary } from './motor/engine';
import { drenarNotificacoes, envioConfigurado, htmlDaNotificacao, textoDaNotificacao, type EnvioDiagnostico } from './diagnostico-crescimento.notificacoes';
import type { Notificacao } from './diagnostico-crescimento.repo';

const SESSAO = '22222222-2222-4222-8222-222222222222';
const linha = (kind: 'started' | 'completed'): Notificacao => ({
  id: kind === 'started' ? 'n1' : 'n2',
  session_id: SESSAO,
  kind,
  lease_id: 'lease-1',
  payload: {
    session: {
      id: SESSAO, status: 'completed', started_at: '', last_activity_at: '', completed_at: null, version: 3,
      source: 'instagram', utm_campaign: 'outubro', temperature: 'HOT', score: 14,
    },
    answers: { segment: 'real_estate', acquisition: ['instagram', 'meta_ads'] },
    summary: { summary: 'Resumo.', primary_bottleneck: 'follow_up', secondary_bottleneck: null, recommended_next_step: 'strategy_call', user_message: 'x', source: 'rules' },
    lead: { name: 'Ana\nQA', phone: '+5562999999999', email: null, company: 'Imob QA', segment: 'real_estate' },
  },
});
const configurado: EnvioDiagnostico = { ligado: true, provider: 'resend', apiKey: 'chave-de-teste', from: 'lotti@exemplo.test', to: 'operador@exemplo.test' };

describe('notificações do diagnóstico (e-mail ao operador)', () => {
  it('desligado por padrão: com Resend configurado e sem DIAGNOSTIC_NOTIFICATIONS_ENABLED nada é reivindicado nem enviado', async () => {
    const config = lerConfigDiagnostico({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.test', LEAD_NOTIFICATION_EMAIL: 'c@d.test' });
    expect(config.notificacoesLigadas).toBe(false);
    const repo = { reivindicarNotificacoes: jest.fn(), concluirNotificacao: jest.fn() };
    const fetch = jest.fn();
    await expect(drenarNotificacoes(repo, { ...config.email, ligado: config.notificacoesLigadas, fetch })).resolves.toEqual({ sent: 0, failed: 0 });
    expect(repo.reivindicarNotificacoes).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ligado mas sem destinatário, remetente ou chave: continua sem reivindicar', () => {
    expect(envioConfigurado(configurado)).toBe(true);
    expect(envioConfigurado({ ...configurado, to: undefined })).toBe(false);
    expect(envioConfigurado({ ...configurado, from: undefined })).toBe(false);
    expect(envioConfigurado({ ...configurado, apiKey: undefined })).toBe(false);
    expect(envioConfigurado({ ...configurado, provider: 'smtp' })).toBe(false);
    expect(envioConfigurado({ ...configurado, ligado: false })).toBe(false);
  });

  it('ligado: um POST ao Resend por linha, com idempotência, e o resultado volta para a fila', async () => {
    const repo = {
      reivindicarNotificacoes: jest.fn(async () => [linha('started'), linha('completed')]),
      concluirNotificacao: jest.fn(async () => true),
    };
    const fetch = jest.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 422 }));
    const r = await drenarNotificacoes(repo, { ...configurado, publicUrl: 'https://app.exemplo.test', fetch }, SESSAO);
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(repo.reivindicarNotificacoes).toHaveBeenCalledWith(SESSAO, 2);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers['Idempotency-Key']).toBe(`diagnostic-${SESSAO}-started`);
    expect(init.headers.Authorization).toBe('Bearer chave-de-teste');
    const corpo = JSON.parse(String(init.body));
    expect(corpo).toMatchObject({ from: 'lotti@exemplo.test', to: ['operador@exemplo.test'], subject: 'Novo lead iniciou diagnóstico — Ana QA' });
    expect(corpo.text).toContain(`Link para visualizar: https://app.exemplo.test/admin/diagnosticos/${SESSAO}`);
    expect(corpo.html).toContain('<html');
    expect(corpo.text).not.toContain('RESPOSTAS SALVAS:');
    const segundo = JSON.parse(String((fetch.mock.calls[1] as [string, RequestInit])[1].body));
    expect(segundo.subject).toBe('Diagnóstico concluído — Ana QA / Imob QA');
    expect(segundo.text).toContain('RESPOSTAS SALVAS:');
    expect(repo.concluirNotificacao).toHaveBeenNthCalledWith(1, 'n1', 'lease-1', true, null);
    expect(repo.concluirNotificacao).toHaveBeenNthCalledWith(2, 'n2', 'lease-1', false, 'provider_http_422');
  });

  it('provedor fora do ar marca provider_unavailable; manutenção sem sessão reivindica até 10', async () => {
    const repo = { reivindicarNotificacoes: jest.fn(async () => [linha('started')]), concluirNotificacao: jest.fn(async () => true) };
    const fetch = jest.fn(async () => { throw new Error('rede'); });
    await expect(drenarNotificacoes(repo, { ...configurado, fetch })).resolves.toEqual({ sent: 0, failed: 1 });
    expect(repo.reivindicarNotificacoes).toHaveBeenCalledWith(null, 10);
    expect(repo.concluirNotificacao).toHaveBeenCalledWith('n1', 'lease-1', false, 'provider_unavailable');
  });

  it('texto da conclusão traz classificação, score, resumo e respostas com rótulo; link só em https', () => {
    const texto = textoDaNotificacao(linha('completed'), 'http://inseguro.exemplo.test');
    expect(texto.startsWith('Diagnóstico concluído\n')).toBe(true);
    expect(texto).toContain('Segmento: Mercado imobiliário');
    expect(texto).toContain('Classificação: HOT');
    expect(texto).toContain('Score: 14');
    expect(texto).toContain('Resumo (regras): Resumo.');
    expect(texto).toContain('Principal gargalo: acompanhamento dos leads');
    expect(texto).toContain('Recomendação: Conversa estratégica');
    expect(texto).toContain('Hoje vocês geram clientes principalmente de onde?: Instagram, Meta Ads');
    expect(texto).not.toContain('Link para visualizar');
  });
});

// Porte de supabase/functions/diagnostic/notifications.test.ts (#54).
const linhaDoGabriel: Notificacao = {
  id: 'notification', session_id: 'session', kind: 'completed', lease_id: 'lease',
  payload: {
    session: {
      id: 'session', status: 'completed', started_at: '2026-10-07T15:00:00Z', last_activity_at: '2026-10-07T15:05:00Z',
      completed_at: '2026-10-07T15:05:00Z', version: 15, score: 12, temperature: 'HOT', utm_source: 'instagram', utm_term: 'growth',
    },
    lead: { name: 'Pessoa <script>alert(1)</script>', phone: '+5562999999999', email: null, company: 'Empresa QA', segment: 'services' },
    answers: { name: 'Pessoa QA', bottleneck: 'follow_up', goal: 'Organizar atendimento', revenue: '100k_300k', decision: 'yes' },
    summary: buildSummary({ bottleneck: 'follow_up', goal: 'Organizar atendimento', conversation: 'yes' }),
  },
};

describe('organized diagnostic notifications (#54)', () => {
  it('includes answers, attribution, localized commercial labels and escaped HTML', () => {
    const texto = textoDaNotificacao(linhaDoGabriel, 'https://example.test');
    expect(texto).toContain('UTM term: growth');
    expect(texto).toContain('Decisor: Sim');
    expect(texto).toContain('RESPOSTAS SALVAS:');
    expect(texto).toContain('/admin/diagnosticos/session');
    expect(texto).toContain('Início (Brasília): 07/10/2026, 12:00:00');
    expect(htmlDaNotificacao(linhaDoGabriel)).toContain('&lt;script&gt;');
    expect(htmlDaNotificacao(linhaDoGabriel)).not.toContain('<script>');
  });

  it('labels an incomplete contact-only diagnostic without inventing a bottleneck', () => {
    const parcial: Notificacao = {
      ...linhaDoGabriel, kind: 'abandoned',
      payload: { ...linhaDoGabriel.payload, answers: { name: 'Pessoa QA', contact: '+5562999999999' }, summary: null },
    };
    const texto = textoDaNotificacao(parcial);
    expect(texto.startsWith('Diagnóstico parcial — contato não concluiu\n')).toBe(true);
    expect(texto).toContain('10 minutos');
    expect(texto).toContain('Ainda não há respostas suficientes');
    expect(texto).toContain('Principal gargalo: Não identificado');
    expect(texto).toContain('Classificação parcial: HOT');
    expect(texto).toContain('Recomendação: Retomar o diagnóstico');
  });

  it('parcial com gargalo respondido usa o resumo das regras', () => {
    const parcial: Notificacao = {
      ...linhaDoGabriel, kind: 'abandoned',
      payload: { ...linhaDoGabriel.payload, answers: { name: 'Pessoa QA', bottleneck: 'cost' }, summary: null },
    };
    expect(textoDaNotificacao(parcial)).toContain('Principal gargalo: eficiência da mídia paga');
  });

  it('sends text + HTML with stable deduplication and records provider failure', async () => {
    const conclusoes: unknown[][] = [];
    const repo = {
      reivindicarNotificacoes: jest.fn(async () => [linhaDoGabriel]),
      concluirNotificacao: jest.fn(async (...a: unknown[]) => { conclusoes.push(a); return true; }),
    };
    const pedidos: RequestInit[] = [];
    const fetch = jest.fn(async (_url: string, init: RequestInit) => {
      pedidos.push(init);
      return new Response('{}', { status: pedidos.length === 1 ? 200 : 429 });
    });
    const config = { ...configurado, fetch: fetch as unknown as typeof globalThis.fetch };
    await expect(drenarNotificacoes(repo, config)).resolves.toEqual({ sent: 1, failed: 0 });
    await expect(drenarNotificacoes(repo, config)).resolves.toEqual({ sent: 0, failed: 1 });
    const corpo = JSON.parse(String(pedidos[0].body));
    expect(corpo.to).toEqual(['operador@exemplo.test']);
    expect(corpo.subject).toBe('Diagnóstico concluído — Pessoa <script>alert(1)</script> / Empresa QA');
    expect(corpo.html).toContain('<html');
    expect(corpo.text).toContain('RESPOSTAS SALVAS:');
    const chave = (i: number) => (pedidos[i].headers as Record<string, string>)['Idempotency-Key'];
    expect(chave(0)).toBe(chave(1));
    expect(conclusoes[1]).toEqual(['notification', 'lease', false, 'provider_http_429']);
  });
});
