/**
 * Diagnóstico de Crescimento contra o schema REAL (PGlite com todas as migrations, inclusive a
 * 20261008120000_diagnostico_conversacional e a 20261008130000_diagnostico_abandono_followup do #54):
 *  - o fluxo público do service (porte do handler da Edge `diagnostic`) com diagnostic_mutate,
 *    diagnostic_consume_limit e diagnostic_reserve_ai de verdade: os cenários do handler.test.ts
 *    (abandono em 10 min com aviso parcial e retomada, imobiliária completa com score 16, conclusão que
 *    cancela o parcial, serviços sem perguntas imobiliárias, sem parcial antes do contato), edição que
 *    poda o ramo, token/versão errados, limite por sessão, IA falsa e o outbox de e-mail;
 *  - o painel (porte da Edge `diagnostic-admin` pelo TenantDb): list, detail e follow_up só para
 *    is_admin(), sem token_hash; a policy diagnostic_admin_read e os grants.
 * Nenhuma rede: a IA e o Resend são falsos.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { DiagnosticosCrescimentoAdminService } from '../../src/parceiros/admin/diagnosticos-crescimento.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { DiagnosticoCrescimentoRepo } from '../../src/diagnostico-crescimento/diagnostico-crescimento.repo';
import { DiagnosticoCrescimentoService } from '../../src/diagnostico-crescimento/diagnostico-crescimento.service';
import { getQuestions } from '../../src/diagnostico-crescimento/motor/engine';
import { type BancoTeste, criarBanco } from './harness';

type Corpo = {
  session: { id: string; status: string; version: number };
  answers: Record<string, unknown>;
  next_question: { id: string } | null;
  summary: Record<string, unknown> | null;
  cta_requested: boolean;
  error?: string;
  [chave: string]: unknown;
};

const VARIAVEIS = [
  'PUBLIC_RATE_LIMIT_SECRET', 'DIAGNOSTIC_RATE_LIMIT_SECRET', 'DIAGNOSTIC_AI_ENABLED', 'DIAGNOSTIC_AI_DAILY_LIMIT',
  'DIAGNOSTIC_NOTIFICATIONS_ENABLED', 'EMAIL_PROVIDER', 'EMAIL_API_KEY', 'RESEND_API_KEY', 'EMAIL_FROM',
  'LEAD_NOTIFICATION_EMAIL', 'DIAGNOSTIC_PUBLIC_URL',
];
const salvas: Record<string, string | undefined> = {};
const TOKEN = 'b'.repeat(64);
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

let banco: BancoTeste;
let servico: DiagnosticoCrescimentoService;
let admin: DiagnosticosCrescimentoAdminService;
let repo: DiagnosticoCrescimentoRepo;
let tarefas: Promise<unknown>[] = [];

const IMOBILIARIA: Record<string, unknown> = {
  name: 'Gabriel QA', contact: 'gabriel.qa@example.test', company: 'Imobiliária QA', segment: 'real_estate',
  real_estate_type: 'agency', brokers: '12', listings: '320', revenue: '100k_300k', acquisition: ['instagram', 'meta_ads'],
  paid_media: 'yes', paid_budget: '3k_10k', content: 'weekly', lead_intake: ['whatsapp', 'crm'], lead_attribution: 'no',
  response_time: 'same_day', funnel_tracking: 'no', bottleneck: 'follow_up', goal: 'Organizar o acompanhamento de cada lead',
  urgency: 'now', decision: 'yes', conversation: 'yes',
};

async function post(sessao: string, payload: Record<string, unknown>, opcoes: { token?: string; ip?: string } = {}) {
  const r = await servico.receber({ ...payload, session_id: sessao, token: opcoes.token ?? TOKEN }, opcoes.ip ?? '192.0.2.15');
  return { status: r.status, body: r.corpo as Corpo };
}

const responder = (sessao: string, snap: Corpo, pergunta: string, valor: unknown) =>
  post(sessao, { action: 'answer', version: snap.session.version, question_id: pergunta, answer: valor });

/** Responde a conversa até o fim (ou até `parar`) com `valores`, conferindo 200 a cada passo. */
async function conversar(sessao: string, snap: Corpo, valores: Record<string, unknown>, parar?: string): Promise<Corpo> {
  while (snap.next_question && snap.next_question.id !== parar) {
    const id = snap.next_question.id;
    const r = await responder(sessao, snap, id, valores[id]);
    assert.equal(r.status, 200, JSON.stringify({ id, body: r.body }));
    snap = r.body;
  }
  return snap;
}

const um = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await banco.sqlSuperusuario<T>(sql, params))[0];

before(async () => {
  for (const v of VARIAVEIS) { salvas[v] = process.env[v]; delete process.env[v]; }
  process.env.PUBLIC_RATE_LIMIT_SECRET = 'segredo-de-teste-do-limite-publico';
  banco = await criarBanco();
  // A conta A é admin (is_admin()); a B é só uma conta comum.
  await banco.inserir('user_roles', { user_id: banco.contaA.userId, role: 'admin' });
  repo = new DiagnosticoCrescimentoRepo(banco.prisma as unknown as PrismaService);
  servico = new DiagnosticoCrescimentoService(repo).usar({ agendar: (t) => { tarefas.push(t); } });
  admin = new DiagnosticosCrescimentoAdminService(banco.db);
});

after(async () => {
  for (const v of VARIAVEIS) { if (salvas[v] === undefined) delete process.env[v]; else process.env[v] = salvas[v]; }
  await banco?.fechar();
});

describe('fluxo público com as funções reais', () => {
  test('nome e telefone persistem na hora; 10 min parado vira abandono com um parcial; a retomada adia o parcial', async () => {
    const sessao = randomUUID();
    let r = await post(sessao, { action: 'start', consent: true, tracking: { utm_source: 'qa', utm_campaign: 'abandon', referrer: 'https://example.test/landing?private=1' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.next_question?.id, 'name');
    r = await responder(sessao, r.body, 'name', 'Ana QA');
    r = await responder(sessao, r.body, 'contact', '(62) 99999-9999');
    assert.equal(r.status, 200);
    assert.equal(r.body.session.status, 'contact_captured');
    const lead = await um(`select l.name, l.phone, l.status from public.diagnostic_leads l
      join public.diagnostic_sessions s on s.lead_id = l.id where s.id = $1`, [sessao]);
    assert.deepEqual(lead, { name: 'Ana QA', phone: '+5562999999999', status: 'lead_iniciado' });
    const sessaoGravada = await um(`select token_hash, referrer, source, utm_campaign from public.diagnostic_sessions where id = $1`, [sessao]);
    // Só o hash do token; o referrer sem a query.
    assert.deepEqual(sessaoGravada, { token_hash: sha(TOKEN), referrer: 'https://example.test/landing', source: 'qa', utm_campaign: 'abandon' });
    assert.deepEqual(await banco.sqlSuperusuario('select kind, status from public.diagnostic_notifications where session_id = $1', [sessao]),
      [{ kind: 'started', status: 'pending' }]);

    const parado = (intervalo: string) => banco.sqlSuperusuario(
      `update public.diagnostic_sessions set last_activity_at = now() - $2::interval where id = $1`, [sessao, intervalo]);
    const parciais = async () => Number((await um<{ n: number }>(
      `select count(*)::int as n from public.diagnostic_notifications where session_id = $1 and kind = 'abandoned'`, [sessao])).n);
    await parado('9 minutes');
    assert.equal(await repo.manutencao(), 0);
    await parado('10 minutes 1 second');
    assert.equal(await repo.manutencao(), 1);
    assert.equal((await um<{ status: string }>('select status from public.diagnostic_sessions where id = $1', [sessao])).status, 'abandoned');
    await repo.manutencao();
    assert.equal(await parciais(), 1);

    r = await post(sessao, { action: 'resume' });
    assert.equal(r.status, 200);
    assert.equal(r.body.session.status, 'in_progress');
    assert.deepEqual(r.body.answers, { name: 'Ana QA', contact: '+5562999999999' });
    assert.equal(r.body.next_question?.id, 'company');
    // Retomou: o parcial ainda não enviado espera a próxima janela parada; só o inicial sai.
    assert.deepEqual((await repo.reivindicarNotificacoes(sessao, 2)).map((n) => n.kind), ['started']);
    r = await responder(sessao, r.body, 'company', 'Empresa após retomada');
    await parado('11 minutes');
    await repo.manutencao();
    const parcial = await repo.reivindicarNotificacoes(sessao, 2);
    assert.deepEqual(parcial.map((n) => n.kind), ['abandoned']);
    // O payload do parcial é refeito no primeiro envio: traz o que foi respondido depois da retomada.
    assert.equal(parcial[0].payload.answers.company, 'Empresa após retomada');
    assert.equal(await parciais(), 1);
  });

  test('sem contato recuperável não há aviso parcial', async () => {
    const sessao = randomUUID();
    let r = await post(sessao, { action: 'start', consent: true });
    r = await responder(sessao, r.body, 'name', 'Sem contato');
    assert.equal(r.status, 200);
    await banco.sqlSuperusuario(`update public.diagnostic_sessions set last_activity_at = now() - interval '11 minutes' where id = $1`, [sessao]);
    await repo.manutencao();
    assert.equal(Number((await um<{ n: number }>('select count(*)::int as n from public.diagnostic_notifications where session_id = $1', [sessao])).n), 0);
  });

  test('imobiliária completa: score 16 HOT, resumo por regras, UTMs e um started + um completed no outbox', async () => {
    const sessao = randomUUID();
    let snap = (await post(sessao, { action: 'start', consent: true, tracking: { utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'real-estate', utm_content: 'video', utm_term: 'growth' } })).body;
    snap = await conversar(sessao, snap, IMOBILIARIA);
    const r = await post(sessao, { action: 'complete', version: snap.session.version });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.session.status, 'completed');
    assert.equal(r.body.next_question, null);
    assert.equal(r.body.summary?.primary_bottleneck, 'follow_up');
    assert.equal(r.body.summary?.source, 'rules');
    assert.match(String(r.body.summary?.user_message), /Gabriel/);
    // O visitante nunca recebe score, temperatura nem lead.
    assert.deepEqual(Object.keys(r.body).sort(), ['answers', 'cta_requested', 'next_question', 'session', 'summary']);
    assert.deepEqual(Object.keys(r.body.session).sort(), ['completed_at', 'id', 'last_activity_at', 'started_at', 'status', 'version']);
    const gravada = await um(`select score, temperature, utm_source, utm_term from public.diagnostic_sessions where id = $1`, [sessao]);
    assert.deepEqual(gravada, { score: 16, temperature: 'HOT', utm_source: 'instagram', utm_term: 'growth' });
    assert.equal((await um<{ status: string }>(`select l.status from public.diagnostic_leads l
      join public.diagnostic_sessions s on s.lead_id = l.id where s.id = $1`, [sessao])).status, 'qualificado');
    const kinds = await banco.sqlSuperusuario<{ kind: string }>('select kind from public.diagnostic_notifications where session_id = $1 order by kind', [sessao]);
    assert.deepEqual(kinds.map((k) => k.kind), ['completed', 'started']);
    assert.ok(getQuestions({ segment: 'real_estate' }).some((q) => q.id === 'real_estate_type'));

    // Concluir de novo devolve o snapshot com 409 (como a Edge); o CTA conta uma vez só.
    const outra = await post(sessao, { action: 'complete', version: r.body.session.version });
    assert.equal(outra.status, 409);
    assert.equal(outra.body.session.status, 'completed');
    for (let i = 0; i < 2; i++) assert.equal((await post(sessao, { action: 'cta' })).body.cta_requested, true);
    assert.equal(Number((await um<{ n: number }>(`select count(*)::int as n from public.diagnostic_events
      where session_id = $1 and event_type = 'cta_clicked'`, [sessao])).n), 1);
  });

  test('concluir cancela o parcial ainda não enviado; started e completed saem', async () => {
    const sessao = randomUUID();
    let snap = (await post(sessao, { action: 'start', consent: true })).body;
    snap = await conversar(sessao, snap, IMOBILIARIA);
    assert.equal((await post(sessao, { action: 'complete', version: snap.session.version })).status, 200);
    await banco.sqlSuperusuario(`insert into public.diagnostic_notifications (session_id, kind, payload)
      values ($1, 'abandoned', public.diagnostic_snapshot($1))`, [sessao]);
    assert.deepEqual((await repo.reivindicarNotificacoes(sessao, 2)).map((n) => n.kind).sort(), ['completed', 'started']);
    assert.deepEqual(await um('select status, last_error from public.diagnostic_notifications where session_id = $1 and kind = $2', [sessao, 'abandoned']),
      { status: 'dead', last_error: 'session_completed' });
  });

  test('serviços não mostra perguntas imobiliárias', async () => {
    const sessao = randomUUID();
    let snap = (await post(sessao, { action: 'start', consent: true })).body;
    snap = await conversar(sessao, snap, {
      name: 'Jo Teste', contact: 'jo@example.test', company: 'Studio QA', segment: 'services', city: 'Goiânia', offer: 'Consultoria de marketing',
    }, 'revenue');
    assert.equal(snap.next_question?.id, 'revenue');
    assert.ok(!('real_estate_type' in snap.answers));
    assert.ok(!('brokers' in snap.answers));
  });

  test('editar o segmento poda o ramo antigo no banco também', async () => {
    const sessao = randomUUID();
    let snap = (await post(sessao, { action: 'start', consent: true })).body;
    snap = await conversar(sessao, snap, IMOBILIARIA, 'revenue');
    assert.equal(snap.answers.brokers, '12');
    const r = await responder(sessao, snap, 'segment', 'services');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.answers).sort(), ['company', 'contact', 'name', 'segment']);
    assert.equal(r.body.next_question?.id, 'city');
    const ids = await banco.sqlSuperusuario<{ question_id: string }>(
      'select question_id from public.diagnostic_answers where session_id = $1 order by position', [sessao]);
    assert.deepEqual(ids.map((i) => i.question_id), ['name', 'contact', 'company', 'segment']);
    const lead = await um(`select l.segment from public.diagnostic_leads l join public.diagnostic_sessions s on s.lead_id = l.id where s.id = $1`, [sessao]);
    assert.deepEqual(lead, { segment: 'services' });
  });

  test('token errado, versão velha, pergunta fora de ordem e concluir antes da hora', async () => {
    const sessao = randomUUID();
    const snap = (await post(sessao, { action: 'start', consent: true })).body;
    assert.deepEqual(await post(sessao, { action: 'resume' }, { token: 'c'.repeat(64) }), { status: 404, body: { error: 'Sessão não encontrada.' } });
    assert.equal((await post(randomUUID(), { action: 'resume' })).status, 404);
    assert.equal((await responder(sessao, { ...snap, session: { ...snap.session, version: 9 } }, 'name', 'Ana')).status, 409);
    assert.deepEqual(await responder(sessao, snap, 'company', 'Empresa'), { status: 409, body: { error: 'Responda a etapa anterior antes de continuar.' } });
    assert.deepEqual(await responder(sessao, snap, 'name', '1'), { status: 400, body: { error: 'Me conta seu nome para continuarmos.' } });
    assert.deepEqual(await post(sessao, { action: 'complete', version: snap.session.version }),
      { status: 400, body: { error: 'Conclua as perguntas antes de ver o diagnóstico.' } });
    // Nada disso mexeu na versão.
    assert.equal((await um<{ version: number }>('select version from public.diagnostic_sessions where id = $1', [sessao])).version, 0);
  });

  test('limite por sessão no início: o 6º start da mesma sessão dá 429', async () => {
    const sessao = randomUUID();
    for (let i = 0; i < 5; i++) assert.equal((await post(sessao, { action: 'start', consent: true }, { ip: '198.51.100.20' })).status, 200);
    const r = await post(sessao, { action: 'start', consent: true }, { ip: '198.51.100.20' });
    assert.deepEqual(r, { status: 429, body: { error: 'Muitas tentativas. Aguarde um pouco e tente novamente.' } });
    // O IP fica só como HMAC; o endereço cru não aparece em lugar nenhum.
    const linhas = await banco.sqlSuperusuario<{ subject_hash: string }>(`select subject_hash from public.diagnostic_rate_limits where scope = 'ip-start'`);
    assert.ok(linhas.every((l) => /^[a-f0-9]{64}$/.test(l.subject_hash)));
    assert.ok(!JSON.stringify(linhas).includes('198.51.100.20'));
  });

  test('IA ligada: resumo da IA gravado, uma reserva por sessão e a mensagem ao visitante das regras', async () => {
    process.env.DIAGNOSTIC_AI_ENABLED = 'true';
    const pedidos: Array<Record<string, unknown>> = [];
    servico.usar({
      agendar: (t) => { tarefas.push(t); },
      pedidoIa: async (corpo) => {
        pedidos.push(corpo);
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          summary: 'Leitura da IA sobre a operação imobiliária.', primary_bottleneck: 'service',
          secondary_bottleneck: 'follow_up', recommended_next_step: 'strategy_call',
        }) } }] }));
      },
    });
    try {
      const sessao = randomUUID();
      let snap = (await post(sessao, { action: 'start', consent: true })).body;
      snap = await conversar(sessao, snap, IMOBILIARIA);
      const r = await post(sessao, { action: 'complete', version: snap.session.version });
      assert.equal(r.status, 200);
      assert.equal(r.body.summary?.source, 'ai');
      assert.equal(r.body.summary?.summary, 'Leitura da IA sobre a operação imobiliária.');
      assert.match(String(r.body.summary?.user_message), /^Gabriel, pelo que você me contou/);
      assert.equal(pedidos.length, 1);
      assert.ok(!JSON.stringify(pedidos[0]).includes('gabriel.qa@example.test'));
      assert.equal(Number((await um<{ n: number }>('select count(*)::int as n from public.diagnostic_ai_usage where session_id = $1', [sessao])).n), 1);
      const resumo = await um('select source, primary_bottleneck, secondary_bottleneck from public.diagnostic_summaries where session_id = $1', [sessao]);
      assert.deepEqual(resumo, { source: 'ai', primary_bottleneck: 'service', secondary_bottleneck: 'follow_up' });
    } finally {
      delete process.env.DIAGNOSTIC_AI_ENABLED;
      servico.usar({ agendar: (t) => { tarefas.push(t); } });
    }
  });

  test('e-mail desligado deixa a fila pending; ligado envia uma vez por tipo e marca sent', async () => {
    const sessao = randomUUID();
    let snap = (await post(sessao, { action: 'start', consent: true })).body;
    snap = await conversar(sessao, snap, IMOBILIARIA, 'company');
    await Promise.all(tarefas.splice(0));
    assert.equal((await um<{ status: string }>(`select status from public.diagnostic_notifications where session_id = $1`, [sessao])).status, 'pending');

    Object.assign(process.env, {
      DIAGNOSTIC_NOTIFICATIONS_ENABLED: 'true', RESEND_API_KEY: 'chave-falsa', EMAIL_FROM: 'lotti@exemplo.test',
      LEAD_NOTIFICATION_EMAIL: 'operador@exemplo.test',
    });
    const enviados: Array<{ url: string; corpo: Record<string, unknown>; idem: string }> = [];
    servico.usar({
      agendar: (t) => { tarefas.push(t); },
      fetchEmail: (async (url: string, init: RequestInit) => {
        enviados.push({ url, corpo: JSON.parse(String(init.body)), idem: (init.headers as Record<string, string>)['Idempotency-Key'] });
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    try {
      snap = (await responder(sessao, snap, 'company', 'Imobiliária QA')).body;
      await Promise.all(tarefas.splice(0));
      snap = await conversar(sessao, snap, IMOBILIARIA);
      await post(sessao, { action: 'complete', version: snap.session.version });
      await Promise.all(tarefas.splice(0));
      assert.deepEqual(enviados.map((e) => e.idem), [`diagnostic-${sessao}-started`, `diagnostic-${sessao}-completed`]);
      assert.ok(enviados.every((e) => e.url === 'https://api.resend.com/emails'));
      assert.deepEqual(enviados[0].corpo.to, ['operador@exemplo.test']);
      const linhas = await banco.sqlSuperusuario<{ kind: string; status: string; attempts: number }>(
        'select kind, status, attempts from public.diagnostic_notifications where session_id = $1 order by kind', [sessao]);
      assert.deepEqual(linhas, [{ kind: 'completed', status: 'sent', attempts: 1 }, { kind: 'started', status: 'sent', attempts: 1 }]);
    } finally {
      for (const v of ['DIAGNOSTIC_NOTIFICATIONS_ENABLED', 'RESEND_API_KEY', 'EMAIL_FROM', 'LEAD_NOTIFICATION_EMAIL']) delete process.env[v];
      servico.usar({ agendar: (t) => { tarefas.push(t); } });
    }
  });
});

describe('painel (porte da Edge diagnostic-admin pelo TenantDb) e as policies', () => {
  const executar = (claims: typeof banco.claimsA, corpo: unknown) => admin.executar(claims, corpo) as Promise<{ status: number; corpo: Record<string, unknown> }>;
  const sessaoDoGabriel = async () => (await um<{ id: string }>(`select s.id::text as id from public.diagnostic_sessions s
    join public.diagnostic_leads l on l.id = s.lead_id where l.name = 'Gabriel QA' and s.temperature = 'HOT' and s.utm_source = 'instagram'`)).id;

  test('list: só para admin, com as métricas do banco e sem token', async () => {
    const r = await executar(banco.claimsA, { action: 'list', filters: { search: '', status: '', temperature: '', segment: '', source: '', page: 1 } });
    assert.equal(r.status, 200);
    const lista = r.corpo as { items: Array<Record<string, unknown>>; total: number; metrics: Record<string, number> };
    const total = Number((await um<{ n: number }>('select count(*)::int as n from public.diagnostic_sessions')).n);
    const completos = Number((await um<{ n: number }>(`select count(*)::int as n from public.diagnostic_sessions where status = 'completed'`)).n);
    assert.equal(lista.total, total);
    assert.equal(lista.items.length, Math.min(total, 25));
    assert.equal(lista.metrics.started, total);
    assert.equal(lista.metrics.completed, completos);
    assert.equal(lista.metrics.cta, 1);
    assert.ok(!JSON.stringify(lista).includes('token_hash'));
    assert.ok(!JSON.stringify(lista).includes(sha(TOKEN)));
    // O lead da lista traz a etapa comercial (#54), não as notas.
    const comLead = lista.items.find((i) => i.lead) as { lead: Record<string, unknown> };
    assert.equal(comLead.lead.follow_up_status, 'new');
    assert.ok(!('follow_up_notes' in comLead.lead));

    const filtrado = await executar(banco.claimsA, { action: 'list', filters: { search: ' Gabriel ', temperature: 'HOT', source: 'instagram', segment: 'real_estate' } });
    assert.equal((filtrado.corpo as { total: number }).total, 1);
    assert.equal(((filtrado.corpo as { items: Array<{ lead: { name: string } }> }).items[0]).lead.name, 'Gabriel QA');
    assert.equal(((await executar(banco.claimsA, { action: 'list', filters: { page: 2 } })).corpo as { items: unknown[] }).items.length, Math.max(0, total - 25));
    assert.equal((await executar(banco.claimsA, { action: 'list' })).status, 200);
  });

  test('não admin: 403 antes de ler o corpo; entradas inválidas com os textos da Edge', async () => {
    assert.deepEqual(await executar(banco.claimsB, { action: 'list' }), { status: 403, corpo: { error: 'Acesso administrativo necessário.' } });
    assert.deepEqual(await executar(banco.claimsB, 'lixo'), { status: 403, corpo: { error: 'Acesso administrativo necessário.' } });
    const id = await sessaoDoGabriel();
    const casos: Array<[unknown, number, string]> = [
      ['lixo', 400, 'Dados inválidos.'],
      [{ action: 'list', filters: 'x' }, 400, 'Dados inválidos.'],
      [{ action: 'list', filters: { page: 0 } }, 400, 'Página inválida.'],
      [{ action: 'list', filters: { page: 1.5 } }, 400, 'Página inválida.'],
      [{ action: 'list', filters: { search: 'x'.repeat(201) } }, 400, 'Filtro inválido.'],
      [{ action: 'list', filters: { status: 1 } }, 400, 'Filtro inválido.'],
      [{ action: 'detail', session_id: 'sql-injection' }, 400, 'Diagnóstico inválido.'],
      [{ action: 'apagar' }, 400, 'Diagnóstico inválido.'],
      [{ action: 'apagar', session_id: id }, 400, 'Ação inválida.'],
      [{ action: 'follow_up', session_id: id, status: 'perdido', notes: '' }, 400, 'Acompanhamento inválido.'],
      [{ action: 'follow_up', session_id: id, status: 'contacted', notes: 'x'.repeat(3001) }, 400, 'Acompanhamento inválido.'],
      [{ action: 'detail', session_id: randomUUID() }, 404, 'Diagnóstico não encontrado.'],
    ];
    for (const [corpo, status, erro] of casos) assert.deepEqual(await executar(banco.claimsA, corpo), { status, corpo: { error: erro } }, JSON.stringify(corpo));
  });

  test('detail: a RPC diagnostic_admin_detail, sem token_hash nem ai_payload', async () => {
    const id = await sessaoDoGabriel();
    const r = await executar(banco.claimsA, { action: 'detail', session_id: id });
    assert.equal(r.status, 200);
    const d = r.corpo as {
      session: Record<string, unknown> & { lead: Record<string, unknown> }; answers: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>; summary: Record<string, unknown>; notifications: Array<Record<string, unknown>>;
    };
    assert.ok(!('token_hash' in d.session));
    assert.equal(d.session.id, id);
    assert.equal(d.session.lead.name, 'Gabriel QA');
    assert.equal(d.session.lead.follow_up_status, 'new');
    assert.match(String(d.session.started_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/);
    assert.equal(d.answers.length, 21);
    assert.deepEqual(d.answers.map((a) => a.position), [...Array(21).keys()]);
    assert.deepEqual(d.answers.find((a) => a.question_id === 'acquisition')?.answer, ['instagram', 'meta_ads']);
    assert.ok(d.events.some((e) => e.event_type === 'diagnostic_completed'));
    assert.deepEqual(Object.keys(d.events[0]).sort(), ['created_at', 'event_type', 'id', 'metadata']);
    assert.ok(!('ai_payload' in d.summary));
    assert.deepEqual([d.summary.primary_bottleneck, d.summary.secondary_bottleneck, d.summary.source], ['follow_up', 'service', 'rules']);
    assert.deepEqual(d.notifications.map((n) => [n.kind, n.status]), [['started', 'pending'], ['completed', 'pending']]);
    assert.ok(!JSON.stringify(d).includes(sha(TOKEN)));
  });

  test('follow_up: etapa e notas no lead, um evento por mudança; sem lead dá 503 como a Edge', async () => {
    const id = await sessaoDoGabriel();
    const r = await executar(banco.claimsA, { action: 'follow_up', session_id: id, status: 'contacted', notes: '  Liguei, retorno sexta  ' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.follow_up_status, 'contacted');
    assert.equal(r.corpo.follow_up_notes, 'Liguei, retorno sexta');
    assert.ok(r.corpo.last_contact_at);
    const eventos = async () => Number((await um<{ n: number }>(`select count(*)::int as n from public.diagnostic_events
      where session_id = $1 and event_type = 'commercial_follow_up_updated'`, [id])).n);
    assert.equal(await eventos(), 1);
    await executar(banco.claimsA, { action: 'follow_up', session_id: id, status: 'contacted', notes: 'Liguei, retorno sexta' });
    assert.equal(await eventos(), 1);
    // Não admin não grava nada.
    assert.equal((await executar(banco.claimsB, { action: 'follow_up', session_id: id, status: 'lost', notes: '' })).status, 403);
    assert.equal((await um<{ s: string }>(`select l.follow_up_status as s from public.diagnostic_leads l
      join public.diagnostic_sessions s on s.lead_id = l.id where s.id = $1`, [id])).s, 'contacted');
    const semLead = randomUUID();
    await post(semLead, { action: 'start', consent: true });
    assert.deepEqual(await executar(banco.claimsA, { action: 'follow_up', session_id: semLead, status: 'contacted', notes: '' }),
      { status: 503, corpo: { error: 'Não foi possível acessar os diagnósticos. Tente novamente.' } });
  });

  test('RLS e grants: anon nada; authenticated comum lê zero linhas; funções de mutação só no servidor', async () => {
    const privilegios = await um(`select
      has_table_privilege('anon', 'public.diagnostic_sessions', 'select') as anon_le,
      has_table_privilege('anon', 'public.diagnostic_leads', 'insert') as anon_grava,
      has_table_privilege('authenticated', 'public.diagnostic_sessions', 'select') as auth_le,
      has_table_privilege('authenticated', 'public.diagnostic_sessions', 'insert,update,delete') as auth_grava,
      has_table_privilege('authenticated', 'public.diagnostic_rate_limits', 'select') as auth_le_limites,
      has_function_privilege('authenticated', 'public.diagnostic_mutate(uuid,text,text,integer,jsonb)', 'execute') as auth_muta,
      has_function_privilege('anon', 'public.diagnostic_admin_list(text,text,text,text,text,integer,integer)', 'execute') as anon_lista,
      has_function_privilege('authenticated', 'public.diagnostic_admin_list(text,text,text,text,text,integer,integer)', 'execute') as auth_lista,
      has_function_privilege('anon', 'public.diagnostic_admin_detail(uuid)', 'execute') as anon_detalhe,
      has_function_privilege('authenticated', 'public.diagnostic_admin_detail(uuid)', 'execute') as auth_detalhe,
      has_function_privilege('anon', 'public.diagnostic_admin_follow_up(uuid,text,text)', 'execute') as anon_follow,
      has_function_privilege('authenticated', 'public.diagnostic_admin_follow_up(uuid,text,text)', 'execute') as auth_follow,
      has_function_privilege('service_role', 'public.diagnostic_mutate(uuid,text,text,integer,jsonb)', 'execute') as service_muta`);
    assert.deepEqual(privilegios, {
      anon_le: false, anon_grava: false, auth_le: true, auth_grava: false, auth_le_limites: false, auth_muta: false,
      anon_lista: false, auth_lista: true, anon_detalhe: false, auth_detalhe: true, anon_follow: false, auth_follow: true, service_muta: true,
    });
    const comum = await banco.db.run(banco.claimsB, (tx) => tx.$queryRaw<Array<{ n: number }>>`select
      (select count(*)::int from public.diagnostic_sessions) + (select count(*)::int from public.diagnostic_leads)
      + (select count(*)::int from public.diagnostic_answers) as n`);
    assert.equal(comum[0].n, 0);
    const doAdmin = await banco.db.run(banco.claimsA, (tx) => tx.$queryRaw<Array<{ n: number }>>`select count(*)::int as n from public.diagnostic_sessions`);
    assert.ok(doAdmin[0].n > 0);
    const rls = await banco.sqlSuperusuario<{ relname: string; relrowsecurity: boolean }>(`select relname::text, relrowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'diagnostic\\_%' order by relname`);
    assert.equal(rls.length, 9);
    assert.ok(rls.every((t) => t.relrowsecurity));
  });
});
