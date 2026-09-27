import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Agente de IA, etapa 2: follow-up e o envio automático compartilhado com os
// Disparos, sobre as migrations reais.
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
];
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerUser = '11111111-1111-4111-8111-111111111111';
const plan = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const stage = '99999999-9999-4999-8999-999999999991';

type Claim = { id: string; token: string; revision: number; step: number; last_inbound_at: string | null };
type Conversation = { id: string; mode: string; status: string; revision: number; processed_revision: number; followup_step: number; followup_due_at: string | null; followup_revision: number | null; lease_token: string | null };
let db: PGlite;
let counter = 0;
const rows = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T,>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const r = async <T,>(sql: string, params: unknown[] = []) => (await one<{ r: T }>(sql, params)).r;
const ingest = (phone: string, text = 'Oi', fromMe = false, external = `m${++counter}`) =>
  r<{ conversation_id?: string }>('select public.lotti_agent_ingest($1::jsonb) r', [JSON.stringify({ instance: 'lotti-a', phone, external_id: external, text, from_me: fromMe, unsupported: false, account: '5562900000001' })]);
const conversation = (phone: string) => one<Conversation>(
  'select id,mode,status,revision,processed_revision,followup_step,followup_due_at,followup_revision,lease_token from lotti_agent_conversations where phone=$1', [phone]);

// Resposta normal do agente para a última mensagem do lead.
async function aiReply(phone: string) {
  await db.query(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 second' where phone=$1`, [phone]);
  await db.query(`update lotti_agent_conversations set processed_revision=revision where phone<>$1`, [phone]);
  const job = await r<{ id: string; token: string; revision: number }>('select public.lotti_agent_claim() r');
  const args = [job.id, job.token, job.revision];
  await db.query('select public.lotti_agent_prepare($1,$2,$3,$4::jsonb)', [...args, JSON.stringify({ response: 'Posso ajudar?', stage: 'qualificando' })]);
  await db.query('select public.lotti_agent_begin_send($1,$2,$3,true)', args);
  await db.query('select public.lotti_agent_finish($1,$2,$3,$4)', [...args, `ai${++counter}`]);
  return job;
}
async function due(phone: string) {
  await db.query(`update lotti_agent_conversations set followup_due_at=now()-interval '1 second' where phone=$1 and followup_due_at is not null`, [phone]);
}
const arm = (id: string, revision: number) => r<boolean>(`select public.lotti_agent_followup_arm($1,$2,now()+interval '2 hours') r`, [id, revision]);
const claim = () => r<Claim | null>('select public.lotti_agent_followup_claim() r');
const begin = (c: { id: string; token: string; revision: number }, live = true, kind = 'followup', text = 'Conseguiu ver as opções?') =>
  r<{ outbox_id?: string; revision?: number; cancelled?: boolean; reason?: string; blocked?: string; phone?: string }>(
    'select public.lotti_agent_auto_begin($1,$2,$3,$4,$5,$6) r', [c.id, c.token, c.revision, text, kind, live]);

async function armed(phone: string) {
  await ingest(phone, 'Quero um apartamento');
  const job = await aiReply(phone);
  expect(await arm(job.id, job.revision)).toBe(true);
  await due(phone);
  return job;
}

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
    INSERT INTO corretores VALUES ('${owner}','${ownerUser}','Corretora');
    INSERT INTO crm_etapas VALUES ('${stage}','${owner}','Sem resposta');
    INSERT INTO plan_entitlements VALUES ('${plan}','leads_qualificados_monthly',100,false,true);
    INSERT INTO subscriptions(corretor_id,plan_id,status,current_period_end) VALUES ('${owner}','${plan}','active',now()+interval '30 days');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES ('${owner}','lotti-a',true,false,'5562900000001')`);
}, 60_000);
afterAll(async () => db?.close());

describe('armar o follow-up', () => {
  it('arma só depois da resposta da IA, na revisão respondida', async () => {
    await ingest('5562911110001', 'Oi');
    const job = await aiReply('5562911110001');
    await ingest('5562911110001', 'Mais uma coisa');
    expect(await arm(job.id, job.revision)).toBe(false);
    const again = await aiReply('5562911110001');
    expect(await arm(again.id, again.revision)).toBe(true);
    const cv = await conversation('5562911110001');
    expect(cv.followup_step).toBe(0);
    expect(cv.followup_revision).toBe(again.revision);
  });

  it('não arma com a equipe no comando', async () => {
    await ingest('5562911110002', 'Oi');
    const job = await aiReply('5562911110002');
    await db.query(`update lotti_agent_conversations set mode='human' where id=$1`, [job.id]);
    expect(await arm(job.id, job.revision)).toBe(false);
  });
});

describe('toque do follow-up', () => {
  it('só reserva quando vence e envia pelo outbox do agente', async () => {
    await ingest('5562911110003', 'Quero um apartamento');
    const job = await aiReply('5562911110003');
    await arm(job.id, job.revision);
    expect(await claim()).toBeNull();
    await due('5562911110003');
    const c = (await claim())!;
    expect(c.id).toBe(job.id);
    expect(c.step).toBe(0);
    expect(c.last_inbound_at).not.toBeNull();

    const started = await begin(c);
    expect(started.revision).toBe(c.revision + 1);
    const after = await conversation('5562911110003');
    expect(after.processed_revision).toBe(after.revision);
    // O eco do WhatsApp antes da confirmação não vira atendimento humano.
    await ingest('5562911110003', 'Conseguiu ver as opções?', true, 'fu-1');
    expect(await r<boolean>('select public.lotti_agent_auto_finish($1,$2,$3,$4) r', [c.id, c.token, started.revision, 'fu-1'])).toBe(true);
    const message = await one<{ sender: string }>(`select sender from lotti_agent_messages where external_id='fu-1'`);
    expect(message.sender).toBe('ai');
    expect((await conversation('5562911110003')).mode).toBe('ai');
    expect(await r<boolean>(`select public.lotti_agent_followup_advance($1,$2,1::smallint,now()+interval '6 hours') r`, [c.id, started.revision])).toBe(true);
    const next = await conversation('5562911110003');
    expect(next.followup_step).toBe(1);
    expect(next.followup_due_at).not.toBeNull();
    // A fila normal do agente não trata o toque como mensagem do lead.
    await db.query(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 second'`);
    const agent = await r<{ id: string } | null>('select public.lotti_agent_claim() r');
    expect(agent?.id).not.toBe(c.id);
    if (agent) await db.query(`update lotti_agent_conversations set lease_token=null,lease_until=null,processed_revision=revision where id=$1`, [agent.id]);
  });

  it('eco que chega depois do envio também fica como automático', async () => {
    await armed('5562911110004');
    const c = (await claim())!;
    const started = await begin(c);
    await db.query('select public.lotti_agent_auto_finish($1,$2,$3,$4)', [c.id, c.token, started.revision, 'fu-2']);
    const echo = await ingest('5562911110004', 'Conseguiu ver as opções?', true, 'fu-2');
    expect(echo).toMatchObject({ duplicate: true });
    // Sem o "advance" (ponte caiu depois do envio) o toque não se repete.
    expect(await conversation('5562911110004')).toMatchObject({ mode: 'ai', followup_due_at: null });
  });

  it('mensagem do lead entre a reserva e o envio cancela o toque e desarma o ciclo', async () => {
    await armed('5562911110005');
    const c = (await claim())!;
    await ingest('5562911110005', 'Ainda estou vendo');
    expect(await begin(c)).toMatchObject({ cancelled: true, reason: 'conversation_changed' });
    expect(await r<boolean>('select public.lotti_agent_followup_release($1,$2,null,now()) r', [c.id, c.token])).toBe(true);
    const cv = await conversation('5562911110005');
    expect(cv.lease_token).toBeNull();
    expect(cv.followup_due_at).toBeNull();
  });

  it('com envio real desligado nada muda na conversa', async () => {
    await armed('5562911110006');
    const c = (await claim())!;
    const before = await conversation('5562911110006');
    expect(await begin(c, false)).toMatchObject({ blocked: 'live_send_disabled' });
    const after = await conversation('5562911110006');
    expect(after.revision).toBe(before.revision);
    expect(await one<{ n: number }>(`select count(*)::int n from lotti_agent_outbox where conversation_id=$1 and status='sending'`, [c.id])).toEqual({ n: 0 });
    await db.query('select public.lotti_agent_followup_release($1,$2,null,null)', [c.id, c.token]);
  });

  it.each([
    ['equipe assumiu', `mode='human'`],
    ['conversa pausada', `mode='paused'`],
    ['conversa fechada', `status='closed'`],
    ['contato pediu para sair', `opted_out_at=now()`],
  ])('não reserva quando %s', async (_label, change) => {
    const phone = `55629111101${String(++counter).padStart(2, '0')}`;
    await armed(phone);
    await db.query(`update lotti_agent_conversations set ${change} where phone=$1`, [phone]);
    const c = await claim();
    expect(c?.id).not.toBe((await conversation(phone)).id);
    expect((await conversation(phone)).followup_due_at).toBeNull();
    if (c) await db.query('select public.lotti_agent_followup_release($1,$2,null,null)', [c.id, c.token]);
  });

  it('não reserva com o Agente desligado', async () => {
    await armed('5562911110007');
    await db.exec(`update lotti_agent_channels set enabled=false`);
    try { expect(await claim()).toBeNull(); }
    finally { await db.exec(`update lotti_agent_channels set enabled=true`); }
    const c = (await claim())!;
    await db.query('select public.lotti_agent_followup_release($1,$2,null,null)', [c.id, c.token]);
  });

  it('reagenda para o próximo expediente mantendo o toque', async () => {
    await armed('5562911110008');
    const c = (await claim())!;
    await db.query(`select public.lotti_agent_followup_release($1,$2,0::smallint,now()+interval '10 hours')`, [c.id, c.token]);
    const cv = await conversation('5562911110008');
    expect(cv.lease_token).toBeNull();
    expect(new Date(cv.followup_due_at!).getTime()).toBeGreaterThan(Date.now() + 9 * 3600_000);
    await db.query(`update lotti_agent_conversations set followup_due_at=null where id=$1`, [c.id]);
  });
});

describe('falha no envio automático', () => {
  it('incerto: vai para a equipe com alerta', async () => {
    await armed('5562911110009');
    const c = (await claim())!;
    const started = await begin(c);
    await db.query('select public.lotti_agent_auto_fail($1,$2,$3,true)', [c.id, c.token, started.revision]);
    const cv = await conversation('5562911110009');
    expect(cv.mode).toBe('human');
    expect(await one<{ status: string }>(`select status from lotti_agent_outbox where conversation_id=$1 and revision=$2`, [c.id, started.revision])).toEqual({ status: 'uncertain' });
    expect(await one<{ n: number }>(`select count(*)::int n from alertas where metadata->>'conversation_id'=$1`, [c.id])).toEqual({ n: 1 });
  });

  it('recusado pelo provedor: cancela sem tirar a IA', async () => {
    await armed('5562911110010');
    const c = (await claim())!;
    const started = await begin(c);
    await db.query('select public.lotti_agent_auto_fail($1,$2,$3,false)', [c.id, c.token, started.revision]);
    const cv = await conversation('5562911110010');
    expect(cv.mode).toBe('ai');
    expect(cv.followup_due_at).toBeNull();
    expect(await one<{ status: string }>(`select status from lotti_agent_outbox where conversation_id=$1 and revision=$2`, [c.id, started.revision])).toEqual({ status: 'cancelled' });
  });
});

describe('fim do ciclo', () => {
  it('fecha a conversa, move a etapa e a IA volta se o lead escrever', async () => {
    await armed('5562911110011');
    const c = (await claim())!;
    expect(await r<boolean>('select public.lotti_agent_followup_close($1,$2,$3,true,$4) r', [c.id, c.token, c.revision, stage])).toBe(true);
    const cv = await conversation('5562911110011');
    expect(cv).toMatchObject({ status: 'closed', mode: 'ai', followup_due_at: null, lease_token: null });
    expect(await one<{ etapa_id: string }>(`select o.etapa_id from crm_oportunidades o join lotti_agent_conversations c on c.cliente_id=o.cliente_id where c.id=$1`, [c.id])).toEqual({ etapa_id: stage });
    await ingest('5562911110011', 'Voltei!');
    expect((await conversation('5562911110011'))).toMatchObject({ status: 'open', mode: 'ai' });
  });

  it('não fecha se o lead respondeu depois da despedida', async () => {
    await armed('5562911110012');
    const c = (await claim())!;
    const started = await begin(c, true, 'followup', 'Vou encerrar por aqui.');
    await db.query('select public.lotti_agent_auto_finish($1,$2,$3,$4)', [c.id, c.token, started.revision, 'bye-1']);
    await ingest('5562911110012', 'Espera!');
    expect(await r<boolean>('select public.lotti_agent_followup_close($1,null,$2,true,null) r', [c.id, started.revision])).toBe(false);
    expect((await conversation('5562911110012')).status).toBe('open');
  });
});

describe('envio automático de disparo', () => {
  it('aceita conversa com a equipe e recusa conversa pausada', async () => {
    await ingest('5562911110013', 'Oi');
    const cv = await conversation('5562911110013');
    await db.query(`update lotti_agent_conversations set mode='human',processed_revision=revision,lease_token=gen_random_uuid(),lease_until=now()+interval '1 minute' where id=$1`, [cv.id]);
    const leased = await one<{ lease_token: string; revision: number }>('select lease_token,revision from lotti_agent_conversations where id=$1', [cv.id]);
    const started = await begin({ id: cv.id, token: leased.lease_token, revision: leased.revision }, true, 'broadcast', 'Novidades!');
    expect(started.outbox_id).toBeTruthy();
    expect((await conversation('5562911110013')).mode).toBe('human');
    await db.query('select public.lotti_agent_auto_finish($1,$2,$3,$4)', [cv.id, leased.lease_token, started.revision, 'bc-1']);

    await db.query(`update lotti_agent_conversations set mode='paused',lease_token=gen_random_uuid(),lease_until=now()+interval '1 minute' where id=$1`, [cv.id]);
    const paused = await one<{ lease_token: string; revision: number }>('select lease_token,revision from lotti_agent_conversations where id=$1', [cv.id]);
    expect(await begin({ id: cv.id, token: paused.lease_token, revision: paused.revision }, true, 'broadcast')).toMatchObject({ cancelled: true, reason: 'conversation_paused' });
  });
});

describe('permissões', () => {
  it.each([
    'select public.lotti_agent_followup_claim()',
    `select public.lotti_agent_auto_begin(gen_random_uuid(),gen_random_uuid(),1,'x','followup',true)`,
    'select public.lotti_agent_move_stage(gen_random_uuid(),gen_random_uuid())',
  ])('usuário logado não executa: %s', async (sql) => {
    await db.exec(`SET request.jwt.claim.sub='${ownerUser}'; SET ROLE authenticated`);
    try { await expect(db.query(sql)).rejects.toThrow(/permission denied/); }
    finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
  });
});
