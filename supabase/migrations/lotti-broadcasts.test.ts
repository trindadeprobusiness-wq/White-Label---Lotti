import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Disparos sobre as migrations reais: público de 24 h calculado no servidor,
// fila com revalidação, espaçamento e o envio automático do agente.
const migrations = [
  '20260912125137_lotti_agent_runtime.sql',
  '20260912171307_lotti_agent_resume_guard.sql',
  '20260916000100_lotti_manual_inbox.sql',
  '20260920000100_lotti_history_import.sql',
  '20260921130000_lotti_inbox_actions.sql',
  '20260923120000_lotti_whatsapp_account_scope.sql',
  '20260923220000_lotti_inbox_update_contact.sql',
  '20260924000100_lotti_channel_company_name.sql',
  '20260924000200_lotti_inbox_events.sql',
  '20260925000100_lotti_inbox_status_events.sql',
  '20260927120000_lotti_agent_stalled_claims.sql',
  '20260927120100_lotti_agent_opt_out.sql',
  '20260927130000_lotti_agent_settings.sql',
  '20260927140000_lotti_agent_follow_up.sql',
  '20260927150000_lotti_broadcasts.sql',
];
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ownerUser = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const stage = '99999999-9999-4999-8999-999999999991';
const foreignStage = '99999999-9999-4999-8999-999999999992';

type Claim = { delivery_id: string; id: string; token: string; revision: number; content: string; reply_policy: string };
let db: PGlite;
let counter = 0;
const rows = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T,>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const r = async <T,>(sql: string, params: unknown[] = []) => (await one<{ r: T }>(sql, params)).r;
async function asUser<T>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET request.jwt.claim.sub='${user}'; SET ROLE authenticated`);
  try { return (await db.query<{ r: T }>(sql, params)).rows[0]?.r; } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
}
const ingest = (phone: string, text = 'Oi', name: string | null = null, fromMe = false) =>
  db.query('select public.lotti_agent_ingest($1::jsonb)', [JSON.stringify({ instance: 'lotti-a', phone, external_id: `m${++counter}`, text, from_me: fromMe, unsupported: false, account: '5562900000001', name })]);
const conversationId = async (phone: string) => (await one<{ id: string }>('select id from lotti_agent_conversations where phone=$1', [phone])).id;
const campaign = (change: Record<string, unknown> = {}) => ({
  name: 'Lançamento Jardins', body: 'Oi, {{nome}}! Aqui é {{corretor}}. Temos novidades.', stageIds: [],
  startsAt: null, intervalSeconds: 30, maxRecipients: 100, replyPolicy: 'preserve', ...change,
});
const save = (value: unknown, user = ownerUser) => asUser<string>(user, 'select public.lotti_broadcast_save($1::jsonb) r', [JSON.stringify(value)]);
const preview = (value: unknown) => asUser<{ eligible: number; overLimit: number; excluded: Record<string, number>; samples: { contact: string; text: string }[] }>(ownerUser, 'select public.lotti_broadcast_preview($1::jsonb) r', [JSON.stringify(value)]);
const activate = (id: string) => asUser<{ status: string; total?: number }>(ownerUser, 'select public.lotti_broadcast_activate($1) r', [id]);
const control = (id: string, action: string) => asUser<string>(ownerUser, 'select public.lotti_broadcast_control($1,$2) r', [id, action]);
const claim = () => r<Claim | { skipped: number } | null>('select public.lotti_broadcast_claim() r');
async function claimDelivery() {
  for (let i = 0; i < 5; i++) {
    const c = await claim();
    if (c && 'delivery_id' in c) return c;
    if (!c) return null;
  }
  return null;
}
const complete = (id: string, status: string, reason: string | null = null, external: string | null = null) =>
  r<boolean>('select public.lotti_broadcast_complete($1,$2,$3,$4) r', [id, status, reason, external]);
async function sendClaimed(c: Claim) {
  const started = await r<{ revision: number; outbox_id?: string; reason?: string }>(
    `select public.lotti_agent_auto_begin($1,$2,$3,$4,'broadcast',true) r`, [c.id, c.token, c.revision, c.content]);
  if (!started.outbox_id) return complete(c.delivery_id, 'skipped', started.reason ?? 'cancelled');
  await db.query('select public.lotti_agent_auto_finish($1,$2,$3,$4)', [c.id, c.token, started.revision, `bc${++counter}`]);
  return complete(c.delivery_id, 'sent', null, `bc${counter}`);
}
// Libera a espera mínima entre entregas do mesmo número.
const skipSpacing = () => db.exec(`update lotti_broadcast_deliveries set updated_at=now()-interval '1 minute' where status in ('sent','sending')`);
const dueNow = (campaignId: string) => db.query(`update lotti_broadcast_deliveries set scheduled_at=now()-interval '1 second' where campaign_id=$1 and status='pending'`, [campaignId]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    CREATE TABLE public.corretores(id uuid primary key, user_id uuid not null, nome text);
    GRANT SELECT ON public.corretores TO authenticated;
    CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, email text, status_funil text, tipo_interesse text, created_at timestamptz default now());
    CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
    CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
    CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text, entidade_tipo text, entidade_id uuid);
    CREATE TABLE public.plan_entitlements(plan_id uuid, feature_key text, limit_value int, unlimited boolean default false, enabled boolean default true);
    CREATE TABLE public.subscriptions(id uuid primary key default gen_random_uuid(), corretor_id uuid, plan_id uuid, status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz default now());
    CREATE TABLE public.usage_counters(corretor_id uuid, feature_key text, used_quantity int, period_start date, period_end date, updated_at timestamptz default now(), unique(corretor_id,feature_key,period_start));
    CREATE TABLE public.crm_etapas(id uuid primary key, corretor_id uuid not null, nome text);
    CREATE TABLE public.crm_oportunidades(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, cliente_id uuid, etapa_id uuid not null, titulo text not null, origem text, fechada_em timestamptz, updated_at timestamptz not null default now());
    INSERT INTO corretores VALUES ('${owner}','${ownerUser}','Rafael Porto'),('${other}','${otherUser}','Outra');
    INSERT INTO crm_etapas VALUES ('${stage}','${owner}','Visita'),('${foreignStage}','${other}','De outra conta');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES ('${owner}','lotti-a',false,false,'5562900000001')`);
}, 60_000);
afterAll(async () => db?.close());

// Cada teste começa com uma base conhecida de contatos.
beforeEach(async () => {
  await db.exec(`delete from lotti_broadcast_campaigns; delete from lotti_agent_outbox; delete from lotti_agent_messages; delete from lotti_agent_conversations; delete from crm_oportunidades; delete from clientes;`);
  await ingest('5562911110001', 'Quero ver o apartamento', 'Paula Souza');     // recente, com nome
  await ingest('5562911110002', 'Oi', 'Marcos Lima');                          // vai ficar fora da janela
  await ingest('5562911110003', 'Olá');                                        // recente, sem nome
  await ingest('5562911110004', 'Tenho interesse', 'Júlia Reis');              // vai pedir para sair
  await ingest('5562911110005', 'Bom dia', 'Carlos Dias');                     // atendimento pausado
  await db.exec(`update lotti_agent_messages set created_at=now()-interval '25 hours' where conversation_id=(select id from lotti_agent_conversations where phone='5562911110002')`);
  await db.exec(`update lotti_agent_conversations set mode='human', processed_revision=revision`);
  await db.exec(`update lotti_agent_conversations set opted_out_at=now() where phone='5562911110004'`);
  await db.exec(`update lotti_agent_conversations set mode='paused' where phone='5562911110005'`);
});

describe('rascunho', () => {
  it.each([
    ['variável desconhecida', { body: 'Oi {{cpf}}' }, /invalid_variable/],
    ['mensagem vazia', { body: '  ' }, /invalid_body/],
    ['etapa de outra conta', { stageIds: [foreignStage] }, /invalid_stage/],
    ['intervalo curto demais', { intervalSeconds: 5 }, /invalid_limits/],
    ['mais de 300 contatos', { maxRecipients: 301 }, /invalid_limits/],
  ])('recusa %s', async (_label, change, error) => {
    await expect(save(campaign(change))).rejects.toThrow(error);
  });

  it('só o dono vê a campanha; rascunho ativado não é mais editável', async () => {
    const id = await save(campaign());
    expect(await asUser<number>(otherUser, 'select count(*)::int r from lotti_broadcast_campaigns')).toBe(0);
    await activate(id);
    await expect(save({ ...campaign(), id })).rejects.toThrow(/not_editable/);
  });
});

describe('público e prévia', () => {
  it('conta só quem falou nas últimas 24 h e explica quem ficou de fora', async () => {
    const out = await preview(campaign());
    expect(out.eligible).toBe(1);
    expect(out.excluded).toEqual({ outside_window: 1, missing_name: 1, opted_out: 1, paused_or_closed: 1 });
    expect(out.samples).toEqual([{ contact: 'Paula Souza', text: 'Oi, Paula! Aqui é Rafael Porto. Temos novidades.' }]);
  });

  it('sem {{nome}} o contato sem nome também recebe', async () => {
    const out = await preview(campaign({ body: 'Temos novidades no Jardins.' }));
    expect(out.eligible).toBe(2);
  });

  it('filtra pela etapa do funil', async () => {
    const cliente = (await one<{ cliente_id: string }>(`select cliente_id from lotti_agent_conversations where phone='5562911110003'`)).cliente_id;
    await db.query(`insert into crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo) values($1,$2,$3,'Visita')`, [owner, cliente, stage]);
    const out = await preview(campaign({ body: 'Novidades!', stageIds: [stage] }));
    expect(out.eligible).toBe(1);
    expect(out.excluded).toEqual({});
  });
});

describe('ativação e fila', () => {
  it('ativar agora cria as entregas espaçadas; sem ninguém elegível não ativa', async () => {
    const id = await save(campaign({ body: 'Novidades!' }));
    expect(await activate(id)).toEqual({ status: 'running', total: 2 });
    const times = await rows<{ gap: number }>(`select extract(epoch from scheduled_at - min(scheduled_at) over ())::int gap from lotti_broadcast_deliveries where campaign_id=$1 order by scheduled_at`, [id]);
    expect(times.map(t => t.gap)).toEqual([0, 30]);
    const empty = await save(campaign({ body: 'Novidades!', stageIds: [stage] }));
    await expect(activate(empty)).rejects.toThrow(/no_eligible_contacts/);
  });

  it('limite de contatos: o excedente fica registrado como fora do limite', async () => {
    const id = await save(campaign({ body: 'Novidades!', maxRecipients: 1 }));
    await activate(id);
    const b = await one<{ total: number; excluded: Record<string, number> }>('select total,excluded from lotti_broadcast_campaigns where id=$1', [id]);
    expect(b.total).toBe(1);
    expect(b.excluded.over_limit).toBe(1);
  });

  it('"IA atende" não passa a conversa para a IA com o Agente desligado', async () => {
    const id = await save(campaign({ replyPolicy: 'ai' }));
    await activate(id);
    const c = (await claimDelivery())!;
    await sendClaimed(c);
    expect(await one<{ mode: string }>('select mode from lotti_agent_conversations where id=$1', [c.id])).toEqual({ mode: 'human' });
  });

  it('nome com barra invertida entra como texto', async () => {
    await db.exec(`update clientes set nome='Ana\\1 Souza' where telefone='5562911110001'`);
    const out = await preview(campaign());
    expect(out.samples[0].text).toBe('Oi, Ana\\1! Aqui é Rafael Porto. Temos novidades.');
  });

  it('entrega pelo envio automático, aplica "IA atende" e conclui a campanha', async () => {
    await db.exec(`update lotti_agent_channels set enabled=true`);
    const id = await save(campaign({ replyPolicy: 'ai' }));
    await activate(id);
    const c = (await claimDelivery())!;
    expect(c.content).toBe('Oi, Paula! Aqui é Rafael Porto. Temos novidades.');
    expect(await sendClaimed(c)).toBe(true);
    const cv = await one<{ mode: string; lease_token: string | null }>('select mode,lease_token from lotti_agent_conversations where id=$1', [c.id]);
    expect(cv).toEqual({ mode: 'ai', lease_token: null });
    expect(await one<{ sender: string }>(`select sender from lotti_agent_messages where conversation_id=$1 order by created_at desc limit 1`, [c.id])).toEqual({ sender: 'ai' });
    expect(await one<{ status: string }>('select status from lotti_broadcast_campaigns where id=$1', [id])).toEqual({ status: 'completed' });
    // O agente não responde a mensagem do disparo como se fosse do lead.
    await db.exec(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 second'`);
    try { expect(await r('select public.lotti_agent_claim() r')).toBeNull(); }
    finally { await db.exec(`update lotti_agent_channels set enabled=false`); }
  });

  it('mensagem nova do lead depois do agendamento cancela a entrega', async () => {
    const id = await save(campaign({ body: 'Novidades!' }));
    await activate(id);
    await ingest('5562911110001', 'Oi de novo', 'Paula Souza');
    await dueNow(id);
    const c = (await claimDelivery())!;
    expect(c.id).toBe(await conversationId('5562911110003'));
    expect(await one<{ reason: string }>(`select reason from lotti_broadcast_deliveries d join lotti_agent_conversations c on c.id=d.conversation_id where c.phone='5562911110001'`)).toEqual({ reason: 'conversation_moved' });
  });

  it('revalida a janela e o opt-out no envio', async () => {
    const id = await save(campaign({ body: 'Novidades!' }));
    await activate(id);
    await db.exec(`update lotti_agent_messages set created_at=now()-interval '25 hours' where conversation_id=(select id from lotti_agent_conversations where phone='5562911110001')`);
    await db.exec(`update lotti_agent_conversations set opted_out_at=now() where phone='5562911110003'`);
    await dueNow(id);
    expect(await claim()).toEqual({ skipped: 2 });
    const reasons = await rows<{ reason: string }>('select reason from lotti_broadcast_deliveries where campaign_id=$1 order by reason', [id]);
    expect(reasons.map(x => x.reason)).toEqual(['opted_out', 'outside_window']);
    expect(await one<{ status: string }>('select status from lotti_broadcast_campaigns where id=$1', [id])).toEqual({ status: 'completed' });
  });

  it('espera 20 s entre entregas do mesmo número, somando campanhas', async () => {
    const id = await save(campaign({ body: 'Novidades!' }));
    await activate(id);
    await dueNow(id);
    await sendClaimed((await claimDelivery())!);
    expect(await claim()).toBeNull();
    await skipSpacing();
    expect(await claimDelivery()).not.toBeNull();
  });

  it('pausar segura a fila, retomar reespaça e cancelar descarta o que falta', async () => {
    const id = await save(campaign({ body: 'Novidades!' }));
    await activate(id);
    expect(await control(id, 'pause')).toBe('paused');
    await dueNow(id);
    expect(await claim()).toBeNull();
    expect(await control(id, 'resume')).toBe('running');
    const next = await one<{ future: boolean }>(`select max(scheduled_at) > now() future from lotti_broadcast_deliveries where campaign_id=$1`, [id]);
    expect(next.future).toBe(true);
    expect(await control(id, 'cancel')).toBe('cancelled');
    expect(await rows<{ status: string }>('select distinct status from lotti_broadcast_deliveries where campaign_id=$1', [id])).toEqual([{ status: 'cancelled' }]);
    await expect(control(id, 'resume')).rejects.toThrow(/invalid_action/);
  });

  it('agendada começa na hora marcada', async () => {
    const id = await save(campaign({ body: 'Novidades!', startsAt: new Date(Date.now() + 3600_000).toISOString() }));
    expect(await activate(id)).toMatchObject({ status: 'scheduled' });
    expect(await claim()).toBeNull();
    await db.query(`update lotti_broadcast_campaigns set starts_at=now()-interval '1 second' where id=$1`, [id]);
    expect(await claimDelivery()).not.toBeNull();
    expect(await one<{ status: string; total: number }>('select status,total from lotti_broadcast_campaigns where id=$1', [id])).toEqual({ status: 'running', total: 2 });
  });

  it('ponte caída antes de enviar: a entrega volta para a fila e é tentada de novo', async () => {
    const id = await save(campaign({ body: 'Novidades!' }));
    await activate(id);
    const c = (await claimDelivery())!;
    await db.query(`update lotti_broadcast_deliveries set updated_at=now()-interval '5 minutes' where id=$1`, [c.delivery_id]);
    await db.query(`update lotti_agent_conversations set lease_until=now()-interval '1 second' where id=$1`, [c.id]);
    const again = (await claimDelivery())!;
    expect(again.delivery_id).toBe(c.delivery_id);
    expect(await one<{ status: string; attempts: number }>('select status,attempts from lotti_broadcast_deliveries where id=$1', [c.delivery_id]))
      .toEqual({ status: 'sending', attempts: 2 });
  });

  it('ponte caída depois de enviar: a entrega fica como enviada', async () => {
    const id = await save(campaign({ body: 'Novidades!' }));
    await activate(id);
    const c = (await claimDelivery())!;
    const started = await r<{ revision: number }>(`select public.lotti_agent_auto_begin($1,$2,$3,$4,'broadcast',true) r`, [c.id, c.token, c.revision, c.content]);
    await db.query('select public.lotti_agent_auto_finish($1,$2,$3,$4)', [c.id, c.token, started.revision, 'bc-crash']);
    await db.query(`update lotti_broadcast_deliveries set updated_at=now()-interval '5 minutes' where id=$1`, [c.delivery_id]);
    await db.query(`update lotti_agent_outbox set created_at=now()-interval '4 minutes' where external_id='bc-crash'`);
    await claim();
    expect(await one<{ status: string }>('select status from lotti_broadcast_deliveries where id=$1', [c.delivery_id])).toEqual({ status: 'sent' });
  });
});

describe('permissões', () => {
  it.each([
    'select public.lotti_broadcast_claim()',
    `select public.lotti_broadcast_complete(gen_random_uuid(),'sent',null,'x')`,
    `select public.lotti_broadcast_start(gen_random_uuid())`,
  ])('usuário logado não executa: %s', async (sql) => {
    await db.exec(`SET request.jwt.claim.sub='${ownerUser}'; SET ROLE authenticated`);
    try { await expect(db.query(sql)).rejects.toThrow(/permission denied/); }
    finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
  });

  it('a ponte marca presença a cada rodada e a tela consegue ler', async () => {
    await claim();
    expect(await asUser<boolean>(ownerUser, `select seen_at > now() - interval '1 minute' r from lotti_automation_heartbeat`)).toBe(true);
  });

  it('outra conta não controla nem duplica a campanha', async () => {
    const id = await save(campaign());
    await expect(asUser(otherUser, 'select public.lotti_broadcast_control($1,$2) r', [id, 'cancel'])).rejects.toThrow(/forbidden/);
    await expect(asUser(otherUser, 'select public.lotti_broadcast_duplicate($1) r', [id])).rejects.toThrow(/forbidden/);
  });
});
