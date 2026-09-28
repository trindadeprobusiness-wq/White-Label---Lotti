import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Ordem da produção: as migrations de 2026-09-27 já aplicadas, depois a do número
// oculto (20260926200000) e esta (20260928190000).
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
  '20260926200000_lotti_whatsapp_lid_conversations.sql',
  '20260928190000_lotti_whatsapp_contact_names_and_merge.sql',
];
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = '11111111-1111-4111-8111-111111111111';
let db: PGlite;
let counter = 0;

const ingest = (event: Record<string, unknown>) =>
  db.query('select public.lotti_agent_ingest($1::jsonb)', [JSON.stringify({ instance: 'lotti-agent', external_id: `m${++counter}`, text: 'Oi', from_me: false, unsupported: false, ...event })]);
const importHistory = (messages: Record<string, unknown>[]) =>
  db.query('select public.lotti_agent_import_history($1,$2::jsonb)', ['lotti-agent',
    JSON.stringify(messages.map((m) => ({ external_id: `h${++counter}`, text: 'Oi', from_me: false, created_at: '2026-09-20T12:00:00Z', ...m })))]);
const row = async (where: string) => (await db.query<{ id: string; contact_name: string | null; contact_name_source: string | null; mode: string; opted_out_at: string | null; followup_step: number; phone: string | null; lid: string | null }>(
  `select id,contact_name,contact_name_source,mode,opted_out_at,followup_step,phone,lid from lotti_agent_conversations where ${where}`)).rows;
const clientName = async (phone: string) => (await db.query<{ nome: string }>('select nome from clientes where telefone=$1', [phone])).rows[0]?.nome;
async function rename(conversation: string, name: string, phone = '') {
  await db.exec(`SET request.jwt.claim.sub='${user}'; SET ROLE authenticated`);
  try { await db.query('select public.lotti_inbox_update_contact($1,$2,$3)', [conversation, name, phone]); } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
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
    INSERT INTO corretores VALUES ('${owner}','${user}','Evandro');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES ('${owner}','lotti-agent',true,false,'5562900000001')`);
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec('delete from lotti_broadcast_campaigns; delete from lotti_agent_outbox; delete from lotti_agent_messages; delete from lotti_agent_conversations; delete from clientes;');
});

describe('nome do contato: digitado, salvo na agenda ou de perfil', () => {
  it('usa o nome de perfil quando não há nome salvo, também no cliente criado pelo CRM', async () => {
    await ingest({ phone: '5511900000001', profile: 'Neves' });
    expect(await row(`phone='5511900000001'`)).toMatchObject([{ contact_name: 'Neves', contact_name_source: 'profile' }]);
    expect(await clientName('5511900000001')).toBe('Neves');
  });

  it('o nome salvo substitui o de perfil, e o de perfil nunca volta por cima', async () => {
    await ingest({ phone: '5511900000001', profile: 'Neves' });
    await ingest({ phone: '5511900000001', name: 'Carlos Neves', profile: 'Neves' });
    expect(await row(`phone='5511900000001'`)).toMatchObject([{ contact_name: 'Carlos Neves', contact_name_source: 'saved' }]);
    await ingest({ phone: '5511900000001', profile: 'Outro Perfil' });
    expect((await row(`phone='5511900000001'`))[0].contact_name).toBe('Carlos Neves');
  });

  it('o nome digitado no Inbox não é trocado nem pelo salvo nem pelo de perfil', async () => {
    await ingest({ phone: '5511900000005', name: 'Salvo na Agenda' });
    const [cv] = await row(`phone='5511900000005'`);
    await rename(cv.id, 'Cliente do Evandro', '5511900000005');
    await ingest({ phone: '5511900000005', name: 'Outro Salvo', profile: 'Perfil' });
    await importHistory([{ phone: '5511900000005', name: 'Mais Um Salvo' }]);
    expect(await row(`phone='5511900000005'`)).toMatchObject([{ contact_name: 'Cliente do Evandro', contact_name_source: 'typed' }]);
  });

  it('troca o nome provisório do CRM pelo nome de perfil que chega depois', async () => {
    await ingest({ phone: '5511900000002' });
    expect(await clientName('5511900000002')).toBe('Contato WhatsApp');
    await ingest({ phone: '5511900000002', profile: 'Vs' });
    expect((await row(`phone='5511900000002'`))[0].contact_name).toBe('Vs');
    expect(await clientName('5511900000002')).toBe('Vs');
  });

  it('ignora nome de perfil vazio ou só com números', async () => {
    await ingest({ phone: '5511900000003', profile: '5511900000003' });
    await ingest({ phone: '5511900000003', profile: '   ' });
    expect((await row(`phone='5511900000003'`))[0].contact_name).toBeNull();
  });

  it('no histórico, o nome de perfil preenche só o vazio e o salvo continua valendo', async () => {
    await importHistory([
      { lid: '223456789012345', profile: 'Anne Cristina Lima' },
      { lid: '223456789012345', from_me: true, profile: 'Anne Cristina Lima' },
      { phone: '5511900000004', name: 'Isadora Moreira', profile: 'Isa' },
      { phone: '5511900000004', profile: 'Isa' },
    ]);
    expect((await row(`lid='223456789012345'`))[0].contact_name).toBe('Anne Cristina Lima');
    expect((await row(`phone='5511900000004'`))[0].contact_name).toBe('Isadora Moreira');
  });
});

describe('ao juntar a conversa do número oculto com a do telefone', () => {
  const lid = '323456789012345';
  const phone = '5511911112222';

  it('mantém o pedido para não receber mensagens e tira a conversa da IA', async () => {
    await importHistory([{ lid, profile: 'Paula' }]);
    await db.exec(`update lotti_agent_conversations set opted_out_at=now()-interval '1 hour' where lid='${lid}'`);
    await ingest({ phone });
    await db.exec(`update lotti_agent_conversations set mode='ai' where phone='${phone}'`);
    await ingest({ phone, lid });
    const merged = await row(`phone='${phone}' or lid='${lid}'`);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ phone, lid, contact_name: 'Paula', contact_name_source: 'profile' });
    expect(merged[0].opted_out_at).not.toBeNull();
    expect(merged[0].mode).not.toBe('ai');
  });

  it('mantém o avanço do follow-up', async () => {
    await importHistory([{ lid }]);
    await db.exec(`update lotti_agent_conversations set followup_step=2 where lid='${lid}'`);
    await ingest({ phone });
    await ingest({ phone, lid });
    expect((await row(`phone='${phone}'`))[0].followup_step).toBe(2);
  });

  it('leva as entregas de disparo, sem mandar a mesma campanha duas vezes', async () => {
    await importHistory([{ lid }]);
    await ingest({ phone });
    const [hidden] = await row(`lid='${lid}'`);
    const [byPhone] = await row(`phone='${phone}'`);
    const campaigns = (await db.query<{ id: string }>(
      `insert into lotti_broadcast_campaigns(corretor_id,name) values ('${owner}','A'),('${owner}','B') returning id`)).rows.map((c) => c.id);
    await db.query(`insert into lotti_broadcast_deliveries(campaign_id,corretor_id,conversation_id,status,scheduled_at,content) values
      ($1,'${owner}',$3,'sent',now(),'Oi'),($1,'${owner}',$4,'pending',now(),'Oi'),($2,'${owner}',$3,'pending',now(),'Oi')`,
      [campaigns[0], campaigns[1], hidden.id, byPhone.id]);
    await ingest({ phone, lid });
    const deliveries = (await db.query<{ campaign_id: string; status: string; conversation_id: string }>(
      'select campaign_id,status,conversation_id from lotti_broadcast_deliveries order by status')).rows;
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.conversation_id === byPhone.id)).toBe(true);
    expect(deliveries.find((d) => d.campaign_id === campaigns[0])?.status).toBe('sent');
    expect(deliveries.find((d) => d.campaign_id === campaigns[1])?.status).toBe('pending');
  });
});
