import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Migrations reais, na ordem da produção (inclui as de 2026-09-29, que refazem
// "Nova conversa" e "Editar contato" pela chave do telefone).
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
];

describe('ações persistentes do Inbox', () => {
  let db: PGlite;
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const channelA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
      CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
      CREATE TABLE public.corretores(id uuid primary key, user_id uuid not null, nome text);
      CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, email text, status_funil text, tipo_interesse text, created_at timestamptz default now());
      CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
      CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
      CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text, entidade_tipo text, entidade_id uuid, lido boolean default false);
      CREATE TABLE public.plan_entitlements(plan_id uuid, feature_key text, limit_value int, unlimited boolean default false, enabled boolean default true);
      CREATE TABLE public.subscriptions(id uuid primary key default gen_random_uuid(), corretor_id uuid, plan_id uuid, status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz default now());
      CREATE TABLE public.usage_counters(corretor_id uuid, feature_key text, used_quantity int, period_start date, period_end date, updated_at timestamptz default now(), unique(corretor_id,feature_key,period_start));
      CREATE TABLE public.crm_etapas(id uuid primary key, corretor_id uuid not null, nome text);
      CREATE TABLE public.crm_oportunidades(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, cliente_id uuid, etapa_id uuid not null, titulo text not null, origem text, fechada_em timestamptz, updated_at timestamptz not null default now());
      INSERT INTO corretores VALUES ('${ownerA}','${userA}','A'),('${ownerB}','${userB}','B');
    `);
    for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO lotti_agent_channels(id,corretor_id,instance,enabled,sandbox) VALUES ('${channelA}','${ownerA}','a',true,false)`);
  }, 30_000);
  afterAll(async () => db?.close());
  async function asUser(user: string, sql: string) {
    await db.exec(`SET request.jwt.claim.sub='${user}'`);
    return db.query(sql);
  }

  it('cria e reutiliza cliente e conversa do usuário', async () => {
    const first = await asUser(userA, "select public.lotti_inbox_start_conversation('(62) 99999-9999','Maria') id");
    const again = await asUser(userA, "select public.lotti_inbox_start_conversation('5562999999999','Maria') id");
    expect(again.rows[0].id).toBe(first.rows[0].id);
    await expect(asUser(userB, `select public.lotti_inbox_rename_client('${first.rows[0].id}','Outro')`)).rejects.toThrow(/forbidden/);
  });

  it('renomeia, fecha e reabre ao receber mensagem', async () => {
    const created = await asUser(userA, "select public.lotti_inbox_start_conversation('5562888888888','Ana') id");
    const id = created.rows[0].id as string;
    expect((await asUser(userA, `select public.lotti_inbox_rename_client('${id}','Ana Paula') nome`)).rows[0].nome).toBe('Ana Paula');
    expect((await asUser(userA, `select public.lotti_inbox_set_status('${id}','closed') status`)).rows[0].status).toBe('closed');
    await db.exec(`insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content) values('${id}','m1','in','lead','oi')`);
    expect((await db.query(`select status from lotti_agent_conversations where id='${id}'`)).rows[0].status).toBe('open');
  });

  it('atualiza nome e telefone da conversa sem permitir acesso de outro usuário', async () => {
    const created = await asUser(userA, "select public.lotti_inbox_start_conversation('5562777777777','Beatriz') id");
    const id = created.rows[0].id as string;
    await expect(asUser(userB, `select public.lotti_inbox_update_contact('${id}','Inválido','5562666666666')`)).rejects.toThrow(/forbidden/);
    const updated = await asUser(userA, `select public.lotti_inbox_update_contact('${id}','Beatriz Lima','(62) 96666-5555') result`);
    expect(updated.rows[0].result).toEqual({ name: 'Beatriz Lima', phone: '5562966665555' });
    expect((await db.query(`select phone from lotti_agent_conversations where id='${id}'`)).rows[0].phone).toBe('5562966665555');
  });

  it('não troca o destino durante uma entrega e cancela trabalho ainda não enviado', async () => {
    const created = await asUser(userA, "select public.lotti_inbox_start_conversation('5562555555555','Carla') id");
    const id = created.rows[0].id as string;
    await db.exec(`insert into lotti_agent_outbox(conversation_id,revision,content,status) values('${id}',1,'Oi','sending')`);
    await expect(asUser(userA, `select public.lotti_inbox_update_contact('${id}','Carla','5562444444444')`)).rejects.toThrow(/delivery_pending/);
    await db.exec(`update lotti_agent_outbox set status='prepared' where conversation_id='${id}'`);
    await asUser(userA, `select public.lotti_inbox_update_contact('${id}','Carla','5562444444444')`);
    expect((await db.query(`select status from lotti_agent_outbox where conversation_id='${id}'`)).rows[0].status).toBe('cancelled');
    expect((await db.query(`select mode from lotti_agent_conversations where id='${id}'`)).rows[0].mode).toBe('human');
  });
});
