/**
 * Diagnóstico de Crescimento contra o schema REAL (PGlite com todas as migrations, inclusive a
 * 20261008120000_diagnostico_conversacional):
 *  - o fluxo público do service (porte do handler da Edge `diagnostic`) com diagnostic_mutate,
 *    diagnostic_consume_limit e diagnostic_reserve_ai de verdade: os três cenários do handler.test.ts
 *    (abandono e retomada, imobiliária completa com score 16, serviços sem perguntas imobiliárias),
 *    edição que poda o ramo, token/versão errados, limite por sessão, IA falsa e o outbox de e-mail;
 *  - o painel (AdminService pelo TenantDb): diagnostic_admin_list e o detalhe só para is_admin(),
 *    sem token_hash; a policy diagnostic_admin_read e os grants (anon nada; authenticated só lê).
 * Nenhuma rede: a IA e o Resend são falsos.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { AdminService } from '../../src/parceiros/admin/admin.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { DiagnosticoCrescimentoRepo } from '../../src/diagnostico-crescimento/diagnostico-crescimento.repo';
import { DiagnosticoCrescimentoService } from '../../src/diagnostico-crescimento/diagnostico-crescimento.service';
import { getQuestions } from '../../src/diagnostico-crescimento/motor/engine';
import { type BancoTeste, capturarErroHttp, criarBanco } from './harness';

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
let admin: AdminService;
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
  servico = new DiagnosticoCrescimentoService(new DiagnosticoCrescimentoRepo(banco.prisma as unknown as PrismaService))
    .usar({ agendar: (t) => { tarefas.push(t); } });
  admin = new AdminService(banco.db);
});

after(async () => {
  for (const v of VARIAVEIS) { if (salvas[v] === undefined) delete process.env[v]; else process.env[v] = salvas[v]; }
  await banco?.fechar();
});

describe('fluxo público com as funções reais', () => {
  test('nome e telefone persistem na hora; a manutenção marca abandono e a retomada restaura', async () => {
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

    await banco.sqlSuperusuario(`update public.diagnostic_sessions set last_activity_at = now() - interval '25 hours' where id = $1`, [sessao]);
    const antes = Number((await um<{ n: number }>(`select count(*)::int as n from public.diagnostic_sessions
      where status in ('started','contact_captured','in_progress') and last_activity_at < now() - interval '24 hours'`)).n);
    assert.equal(await new DiagnosticoCrescimentoRepo(banco.prisma as unknown as PrismaService).manutencao(), antes);
    assert.equal((await um<{ status: string }>('select status from public.diagnostic_sessions where id = $1', [sessao])).status, 'abandoned');

    r = await post(sessao, { action: 'resume' });
    assert.equal(r.status, 200);
    assert.equal(r.body.session.status, 'in_progress');
    assert.deepEqual(r.body.answers, { name: 'Ana QA', contact: '+5562999999999' });
    assert.equal(r.body.next_question?.id, 'company');
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

describe('painel (AdminService pelo TenantDb) e as policies', () => {
  test('lista só para admin, com as métricas do banco e sem token', async () => {
    const r = await admin.listarDiagnosticosCrescimento(banco.claimsA, {}) as {
      items: Array<Record<string, unknown>>; total: number; metrics: Record<string, number>; dropoff: unknown[];
    };
    const total = Number((await um<{ n: number }>('select count(*)::int as n from public.diagnostic_sessions')).n);
    const completos = Number((await um<{ n: number }>(`select count(*)::int as n from public.diagnostic_sessions where status = 'completed'`)).n);
    assert.equal(r.total, total);
    assert.equal(r.items.length, Math.min(total, 25));
    assert.equal(r.metrics.started, total);
    assert.equal(r.metrics.completed, completos);
    assert.equal(r.metrics.cta, 1);
    assert.ok(!JSON.stringify(r).includes('token_hash'));
    assert.ok(!JSON.stringify(r).includes(sha(TOKEN)));

    const filtrado = await admin.listarDiagnosticosCrescimento(banco.claimsA, { busca: 'Gabriel', temperatura: 'HOT', origem: 'instagram', segmento: 'real_estate' }) as { total: number; items: Array<{ lead: { name: string } }> };
    assert.equal(filtrado.total, 1);
    assert.equal(filtrado.items[0].lead.name, 'Gabriel QA');
    const pagina = await admin.listarDiagnosticosCrescimento(banco.claimsA, { offset: 1, limite: 1 }) as { items: unknown[] };
    assert.equal(pagina.items.length, 1);

    const negado = await capturarErroHttp(admin.listarDiagnosticosCrescimento(banco.claimsB, {}));
    assert.deepEqual([negado.status, negado.corpo.codigo], [403, 'sem_permissao']);
    const invalido = await capturarErroHttp(admin.listarDiagnosticosCrescimento(banco.claimsA, { limite: 1000 }));
    assert.deepEqual([invalido.status, invalido.corpo.codigo], [400, 'dados_invalidos']);
  });

  test('detalhe com as colunas da tela; não admin 403; id inexistente 404', async () => {
    const { id } = await um<{ id: string }>(`select s.id::text as id from public.diagnostic_sessions s
      join public.diagnostic_leads l on l.id = s.lead_id where l.name = 'Gabriel QA' and s.temperature = 'HOT' and s.utm_source = 'instagram'`);
    const d = await admin.diagnosticoCrescimento(banco.claimsA, id);
    assert.deepEqual(Object.keys(d.session).sort(), [
      'completed_at', 'id', 'last_activity_at', 'lead', 'lead_id', 'referrer', 'score', 'source', 'started_at', 'status',
      'temperature', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term',
    ]);
    assert.deepEqual(d.session.lead, {
      id: d.session.lead_id, name: 'Gabriel QA', phone: null, email: 'gabriel.qa@example.test', company: 'Imobiliária QA', segment: 'real_estate', city: null,
    });
    assert.match(String(d.session.started_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/);
    assert.equal(d.answers.length, 21);
    assert.deepEqual(d.answers.map((a) => a.position), [...Array(21).keys()]);
    assert.deepEqual(Object.keys(d.answers[0]).sort(), ['answer', 'created_at', 'id', 'position', 'question', 'question_id']);
    assert.deepEqual(d.answers.find((a) => a.question_id === 'acquisition')?.answer, ['instagram', 'meta_ads']);
    assert.ok(d.events.some((e) => e.event_type === 'diagnostic_completed'));
    assert.deepEqual(d.summary, {
      summary: d.summary?.summary, primary_bottleneck: 'follow_up', secondary_bottleneck: 'service', recommended_next_step: 'strategy_call', source: 'rules',
    });
    assert.deepEqual(d.notifications.map((n) => [n.kind, n.status]), [['completed', 'pending'], ['started', 'pending']]);
    assert.ok(!JSON.stringify(d).includes('token_hash'));

    const negado = await capturarErroHttp(admin.diagnosticoCrescimento(banco.claimsB, id));
    assert.deepEqual([negado.status, negado.corpo.codigo], [403, 'sem_permissao']);
    const sumido = await capturarErroHttp(admin.diagnosticoCrescimento(banco.claimsA, randomUUID()));
    assert.deepEqual([sumido.status, sumido.corpo.codigo], [404, 'diagnostico_nao_encontrado']);
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
      has_function_privilege('service_role', 'public.diagnostic_mutate(uuid,text,text,integer,jsonb)', 'execute') as service_muta`);
    assert.deepEqual(privilegios, {
      anon_le: false, anon_grava: false, auth_le: true, auth_grava: false, auth_le_limites: false,
      auth_muta: false, anon_lista: false, auth_lista: true, service_muta: true,
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
