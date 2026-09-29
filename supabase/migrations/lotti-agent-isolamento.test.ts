import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// SCRUM-31 e SCRUM-40: duas imobiliárias recebem o mesmo telefone. Cada uma só
// vê e só envia pelo que é seu, com as migrations reais do agente e RLS ativa.
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
  '20260928200000_lotti_inbox_add_to_crm.sql',
  '20260929100000_crm_cliente_sem_duplicidade.sql',
  '20260929110000_crm_conversao_e_oportunidade.sql',
  '20260929120000_lotti_conversa_por_chave.sql',
  '20260929130000_lotti_canal_e_optout.sql',
  '20260929140000_duplicidade_ajustes_revisao.sql',
];
const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const plan = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const phone = '5511977770031';

let db: PGlite;
let conversationA = '';
let conversationB = '';
const rows = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const ingest = (instance: string, account: string, external_id: string) =>
  db.query('select public.lotti_agent_ingest($1::jsonb)', [JSON.stringify({ instance, phone, external_id, text: 'Oi, vi o anúncio', from_me: false, unsupported: false, account })]);
/** Executa como o usuário logado, com a RLS valendo (papel authenticated). */
async function asUser<T>(user: string, work: () => Promise<T>) {
  await db.exec(`SET request.jwt.claim.sub='${user}'; SET ROLE authenticated`);
  try { return await work(); } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
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
    CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text, entidade_tipo text, entidade_id uuid, lido boolean default false);
    CREATE TABLE public.plan_entitlements(plan_id uuid, feature_key text, limit_value int, unlimited boolean default false, enabled boolean default true);
    CREATE TABLE public.subscriptions(id uuid primary key default gen_random_uuid(), corretor_id uuid, plan_id uuid, status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz default now());
    CREATE TABLE public.usage_counters(corretor_id uuid, feature_key text, used_quantity int, period_start date, period_end date, updated_at timestamptz default now(), unique(corretor_id,feature_key,period_start));
    CREATE TABLE public.crm_etapas(id uuid primary key, corretor_id uuid not null, nome text);
    CREATE TABLE public.crm_oportunidades(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, cliente_id uuid, etapa_id uuid not null, titulo text not null, origem text, fechada_em timestamptz, updated_at timestamptz not null default now());
    INSERT INTO corretores VALUES ('${accountA}','${userA}','Imobiliária A'),('${accountB}','${userB}','Imobiliária B');
    INSERT INTO plan_entitlements VALUES ('${plan}','leads_qualificados_monthly',100,false,true);
    INSERT INTO subscriptions(corretor_id,plan_id,status,current_period_end) VALUES ('${accountA}','${plan}','active',now()+interval '30 days'),('${accountB}','${plan}','active',now()+interval '30 days');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES
    ('${accountA}','lotti-a',true,false,'5562900000001'),('${accountB}','lotti-b',true,false,'5562900000002')`);
  await ingest('lotti-a', '5562900000001', 'msg-a');
  await ingest('lotti-b', '5562900000002', 'msg-b');
  [{ id: conversationA }] = await rows<{ id: string }>(`select id from lotti_agent_conversations where corretor_id=$1`, [accountA]);
  [{ id: conversationB }] = await rows<{ id: string }>(`select id from lotti_agent_conversations where corretor_id=$1`, [accountB]);
}, 60_000);
afterAll(async () => db?.close());

describe('SCRUM-31 — isolamento das conversas entre imobiliárias', () => {
  it('o mesmo telefone gera uma conversa e um cadastro em cada conta', async () => {
    const perAccount = await rows<{ corretor_id: string; conversas: number; clientes: number }>(`
      select c.corretor_id, count(distinct c.id)::int conversas, count(distinct k.id)::int clientes
      from lotti_agent_conversations c join clientes k on k.id=c.cliente_id and k.corretor_id=c.corretor_id
      group by c.corretor_id order by c.corretor_id`);
    expect(perAccount).toEqual([
      { corretor_id: accountA, conversas: 1, clientes: 1 },
      { corretor_id: accountB, conversas: 1, clientes: 1 },
    ]);
  });

  it('com a RLS, cada conta lê só as próprias conversas, mensagens, prévias, canal e eventos', async () => {
    await db.exec(`update lotti_agent_conversations set mode='human' where id in ('${conversationA}','${conversationB}')`);
    const seen = await asUser(userA, async () => ({
      conversations: (await rows<{ id: string }>('select id from lotti_agent_conversations')).map(r => r.id),
      messages: (await rows<{ external_id: string }>('select external_id from lotti_agent_messages')).map(r => r.external_id),
      previews: (await rows<{ conversation_id: string }>('select conversation_id from lotti_agent_latest_messages')).map(r => r.conversation_id),
      channels: (await rows<{ instance: string }>('select instance from lotti_agent_channels')).map(r => r.instance),
      events: (await rows<{ conversation_id: string }>('select distinct conversation_id from lotti_inbox_events')).map(r => r.conversation_id),
    }));
    expect(seen).toEqual({ conversations: [conversationA], messages: ['msg-a'], previews: [conversationA], channels: ['lotti-a'], events: [conversationA] });
  });

  it('visitante sem login não lê conversas nem mensagens', async () => {
    await db.exec('SET ROLE anon');
    try {
      await expect(db.query('select id from lotti_agent_conversations')).rejects.toThrow(/permission denied/);
      await expect(db.query('select id from lotti_agent_messages')).rejects.toThrow(/permission denied/);
    } finally { await db.exec('RESET ROLE'); }
  });

  it('uma conta não muda modo, contato, status nem nome da conversa da outra', async () => {
    await asUser(userA, async () => {
      await expect(db.query(`select public.lotti_agent_set_mode($1,'ai')`, [conversationB])).rejects.toThrow(/forbidden/);
      await expect(db.query(`select public.lotti_inbox_update_contact($1,'Outro','5511900000000')`, [conversationB])).rejects.toThrow(/forbidden/);
      await expect(db.query(`select public.lotti_inbox_set_status($1,'closed')`, [conversationB])).rejects.toThrow(/forbidden/);
      await expect(db.query(`select public.lotti_inbox_rename_client($1,'Outro')`, [conversationB])).rejects.toThrow(/forbidden/);
    });
    const [b] = await rows<{ mode: string; status: string; phone: string }>('select mode,status,phone from lotti_agent_conversations where id=$1', [conversationB]);
    expect(b).toEqual({ mode: 'human', status: 'open', phone });
  });

  it('a franquia de IA é cobrada só da conta que processou a conversa', async () => {
    await db.exec(`update lotti_agent_conversations set mode='ai',processed_revision=revision where id='${conversationB}'`);
    await db.exec(`update lotti_agent_conversations set mode='ai',next_attempt_at=now()-interval '1 second' where id='${conversationA}'`);
    const [{ r: job }] = await rows<{ r: { id: string; corretor_id: string; instance: string } }>('select public.lotti_agent_claim() r');
    expect(job).toMatchObject({ id: conversationA, corretor_id: accountA, instance: 'lotti-a' });
    const usage = await rows<{ corretor_id: string; used_quantity: number }>('select corretor_id,used_quantity from usage_counters');
    expect(usage).toEqual([{ corretor_id: accountA, used_quantity: 1 }]);
    await db.exec(`update lotti_agent_conversations set lease_token=null,lease_until=null,mode='human' where id='${conversationA}'`);
  });
});

describe('SCRUM-40 — isolamento do envio manual', () => {
  const begin = (owner: string, conversation: string) =>
    rows<{ r: { status: string; instance?: string; phone?: string } }>(
      `select public.lotti_manual_begin($1,$2,gen_random_uuid(),'fp','Olá',null) r`, [owner, conversation]);

  it('a conta A não envia pela conversa da conta B', async () => {
    await expect(begin(accountA, conversationB)).rejects.toThrow(/forbidden/);
    expect(await rows('select 1 from lotti_manual_sends where conversation_id=$1', [conversationB])).toEqual([]);
  });

  it('o destino e a instância vêm da conversa e do canal da própria conta', async () => {
    const [{ r }] = await begin(accountB, conversationB);
    // Desde 20260926200000 o LID também vai para a ponte (nulo quando o número é conhecido).
    expect(r).toEqual({ status: 'ready', instance: 'lotti-b', phone, lid: null });
  });

  it('as funções de envio não podem ser chamadas pelo navegador', async () => {
    const [grants] = await rows<{ begin: boolean; finish: boolean; send: boolean }>(`select
      has_function_privilege('authenticated','public.lotti_manual_begin(uuid,uuid,uuid,text,text,text)','execute') "begin",
      has_function_privilege('authenticated','public.lotti_manual_finish(uuid,text,text)','execute') finish,
      has_function_privilege('authenticated','public.lotti_agent_begin_send(uuid,uuid,bigint,boolean)','execute') send`);
    expect(grants).toEqual({ begin: false, finish: false, send: false });
  });
});
