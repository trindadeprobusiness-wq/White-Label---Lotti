import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('nome do contato no WhatsApp: salvo na agenda, senão o nome de perfil', () => {
  let db: PGlite;
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const user = '11111111-1111-4111-8111-111111111111';
  const ingest = (event: Record<string, unknown>) =>
    db.query<{ r: Record<string, unknown> }>('select public.lotti_agent_ingest($1::jsonb) r', [JSON.stringify({ instance: 'lotti-agent', text: 'Oi', from_me: false, unsupported: false, ...event })]);
  const importHistory = (messages: Record<string, unknown>[]) =>
    db.query<{ r: { imported: number } }>('select public.lotti_agent_import_history($1,$2::jsonb) r', ['lotti-agent',
      JSON.stringify(messages.map((m) => ({ text: 'Oi', from_me: false, created_at: '2026-09-20T12:00:00Z', ...m })))]);
  const nameOf = async (where: string) => (await db.query<{ contact_name: string | null }>(
    `select contact_name from lotti_agent_conversations where ${where}`)).rows[0]?.contact_name;
  const clientName = async (phone: string) => (await db.query<{ nome: string }>(
    `select nome from clientes where telefone=$1`, [phone])).rows[0]?.nome;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE public.corretores(id uuid primary key, user_id uuid not null, nome text);
      CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, status_funil text, tipo_interesse text, created_at timestamptz default now());
      CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
      CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
      CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text);
      CREATE TABLE public.crm_etapas(id uuid primary key, nome text);
      CREATE TABLE public.crm_oportunidades(id uuid primary key, corretor_id uuid, cliente_id uuid, etapa_id uuid, titulo text);
      CREATE TABLE public.subscriptions(corretor_id uuid, plan_id text, status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz default now());
      CREATE TABLE public.plan_entitlements(plan_id text, feature_key text, limit_value int, unlimited boolean, enabled boolean);
      CREATE TABLE public.usage_counters(corretor_id uuid, feature_key text, used_quantity int, period_start date, period_end date, updated_at timestamptz, unique(corretor_id,feature_key,period_start));
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name,'/') $$;
      INSERT INTO corretores VALUES ('${owner}','${user}','Evandro');
      INSERT INTO subscriptions VALUES ('${owner}','pro','active',null,now()+interval '30 days');
      INSERT INTO plan_entitlements VALUES ('pro','leads_qualificados_monthly',100,false,true);
    `);
    for (const name of [
      '20260912125137_lotti_agent_runtime.sql',
      '20260916000100_lotti_manual_inbox.sql',
      '20260920000100_lotti_history_import.sql',
      '20260921130000_lotti_inbox_actions.sql',
      '20260923120000_lotti_whatsapp_account_scope.sql',
      '20260923220000_lotti_inbox_update_contact.sql',
      '20260924000200_lotti_inbox_events.sql',
      '20260925000100_lotti_inbox_status_events.sql',
      '20260926200000_lotti_whatsapp_lid_conversations.sql',
      '20260928190000_lotti_whatsapp_profile_names.sql',
    ]) await db.exec(migration(name));
    await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox) VALUES ('${owner}','lotti-agent',true,false)`);
  }, 60_000);
  afterAll(async () => db?.close());

  it('usa o nome de perfil quando não há nome salvo, também no cliente criado pelo CRM', async () => {
    await ingest({ phone: '5511900000001', external_id: 'p-1', profile: 'Neves' });
    expect(await nameOf(`phone='5511900000001'`)).toBe('Neves');
    expect(await clientName('5511900000001')).toBe('Neves');
  });

  it('o nome salvo na agenda substitui o de perfil, e o de perfil nunca volta por cima', async () => {
    await ingest({ phone: '5511900000001', external_id: 'p-2', name: 'Carlos Neves', profile: 'Neves' });
    expect(await nameOf(`phone='5511900000001'`)).toBe('Carlos Neves');
    await ingest({ phone: '5511900000001', external_id: 'p-3', profile: 'Outro Perfil' });
    expect(await nameOf(`phone='5511900000001'`)).toBe('Carlos Neves');
  });

  it('não troca um nome digitado no Inbox pelo nome de perfil', async () => {
    await ingest({ lid: '123456789012345', external_id: 'l-1' });
    await db.exec(`update lotti_agent_conversations set contact_name='Cliente do Evandro' where lid='123456789012345'`);
    await ingest({ lid: '123456789012345', external_id: 'l-2', profile: 'Perfil' });
    expect(await nameOf(`lid='123456789012345'`)).toBe('Cliente do Evandro');
  });

  it('troca o nome provisório do CRM pelo nome de perfil que chega depois', async () => {
    await ingest({ phone: '5511900000002', external_id: 'c-1' });
    expect(await clientName('5511900000002')).toBe('Contato WhatsApp');
    await ingest({ phone: '5511900000002', external_id: 'c-2', profile: 'Vs' });
    expect(await nameOf(`phone='5511900000002'`)).toBe('Vs');
    expect(await clientName('5511900000002')).toBe('Vs');
  });

  it('ignora nome de perfil vazio ou só com números', async () => {
    await ingest({ phone: '5511900000003', external_id: 'n-1', profile: '5511900000003' });
    await ingest({ phone: '5511900000003', external_id: 'n-2', profile: '   ' });
    expect(await nameOf(`phone='5511900000003'`)).toBeNull();
  });

  it('no histórico, o nome de perfil preenche só o vazio e o salvo continua valendo', async () => {
    await importHistory([
      { lid: '223456789012345', external_id: 'h-1', profile: 'Anne Cristina Lima' },
      { lid: '223456789012345', external_id: 'h-2', from_me: true, profile: 'Anne Cristina Lima' },
      { phone: '5511900000004', external_id: 'h-3', name: 'Isadora Moreira', profile: 'Isa' },
      { phone: '5511900000004', external_id: 'h-4', profile: 'Isa' },
    ]);
    expect(await nameOf(`lid='223456789012345'`)).toBe('Anne Cristina Lima');
    expect(await nameOf(`phone='5511900000004'`)).toBe('Isadora Moreira');
  });
});
