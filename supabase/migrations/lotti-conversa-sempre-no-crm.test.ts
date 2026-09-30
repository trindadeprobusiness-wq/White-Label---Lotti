import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// A cadeia da produção até a véspera desta migration. Ela é aplicada depois das
// conversas já existirem, que é a situação real: o Inbox tinha 100 conversas
// sem cliente quando a regra mudou.
const anteriores = [
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
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = '11111111-1111-4111-8111-111111111111';
const canal = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const canalTeste = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let db: PGlite;

const conversa = async (where: string) => (await db.query<{ id: string; cliente_id: string | null; phone: string | null }>(
  `select id,cliente_id,phone from lotti_agent_conversations where ${where}`)).rows[0];
const clienteDe = async (id: string | null) => (await db.query<{ nome: string; telefone: string; status_funil: string | null }>(
  'select nome,telefone,status_funil from clientes where id=$1', [id])).rows[0];

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
    CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, email text, status_funil text, tipo_interesse text, created_at timestamptz default clock_timestamp());
    CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
    CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
    CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text, entidade_tipo text, entidade_id uuid, lido boolean default false);
    CREATE TABLE public.plan_entitlements(plan_id uuid, feature_key text, limit_value int, unlimited boolean default false, enabled boolean default true);
    CREATE TABLE public.subscriptions(id uuid primary key default gen_random_uuid(), corretor_id uuid, plan_id uuid, status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz default now());
    CREATE TABLE public.usage_counters(corretor_id uuid, feature_key text, used_quantity int, period_start date, period_end date, updated_at timestamptz default now(), unique(corretor_id,feature_key,period_start));
    CREATE TABLE public.crm_etapas(id uuid primary key, corretor_id uuid not null, nome text);
    CREATE TABLE public.crm_oportunidades(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, cliente_id uuid, etapa_id uuid not null, titulo text not null, origem text, fechada_em timestamptz, updated_at timestamptz not null default now());
    INSERT INTO corretores VALUES ('${owner}','${user}','Evandro');
  `);
  for (const nome of anteriores) await db.exec(readFileSync(new URL(`./${nome}`, import.meta.url), 'utf8'));

  await db.exec(`
    INSERT INTO lotti_agent_channels(id,corretor_id,instance,enabled,sandbox,account_phone)
      VALUES ('${canal}','${owner}','lotti-agent',true,false,'5562900000001'),
             ('${canalTeste}','${owner}','lotti-teste',true,true,'5562900000002');
    INSERT INTO lotti_agent_conversations(channel_id,corretor_id,phone,contact_name,mode,status)
      VALUES ('${canal}','${owner}','5562911110011','Felipe','human','open'),
             ('${canal}','${owner}','5562911110012',null,'ai','open'),
             ('${canalTeste}','${owner}','5562911110013','De teste','ai','open');
    INSERT INTO lotti_agent_conversations(channel_id,corretor_id,phone,lid,contact_name,mode,status)
      VALUES ('${canal}','${owner}',null,'123456789012345','Sem numero','human','open');
  `);
  // Só agora a regra nova entra, como entrará em produção.
  await db.exec(readFileSync(new URL('./20260930190000_conversa_sempre_no_crm.sql', import.meta.url), 'utf8'));
}, 60_000);
afterAll(async () => db?.close());

describe('conversa sempre no CRM', () => {
  it('põe no CRM, em qualificação, quem já estava no Inbox sem cliente', async () => {
    const cv = await conversa(`phone='5562911110011'`);
    expect(cv.cliente_id).not.toBeNull();
    expect(await clienteDe(cv.cliente_id)).toMatchObject({ nome: 'Felipe', telefone: '5562911110011', status_funil: 'QUALIFICACAO' });
  });

  it('sem nome na conversa, o cliente entra como "Contato WhatsApp"', async () => {
    const cv = await conversa(`phone='5562911110012'`);
    expect((await clienteDe(cv.cliente_id)).nome).toBe('Contato WhatsApp');
  });

  it('canal de teste não povoa o CRM de ninguém', async () => {
    expect((await conversa(`phone='5562911110013'`)).cliente_id).toBeNull();
  });

  it('conversa sem número espera, e entra quando o número aparece', async () => {
    const antes = await conversa(`lid='123456789012345'`);
    expect(antes.cliente_id).toBeNull();
    await db.exec(`update lotti_agent_conversations set phone='5562911110014' where id='${antes.id}'`);
    const depois = await conversa(`id='${antes.id}'`);
    expect(depois.cliente_id).not.toBeNull();
    expect(await clienteDe(depois.cliente_id)).toMatchObject({ nome: 'Sem numero', status_funil: 'QUALIFICACAO' });
  });

  it('não duplica, nem rebaixa, o cliente que o CRM já tinha com o mesmo telefone', async () => {
    const existente = (await db.query<{ id: string }>(
      `insert into clientes(corretor_id,nome,telefone,status_funil) values ('${owner}','Ana do CRM','(62) 91111-0015','ATENDIMENTO') returning id`)).rows[0].id;
    await db.exec(`insert into lotti_agent_conversations(channel_id,corretor_id,phone,contact_name,mode,status)
      values ('${canal}','${owner}','5562911110015','Ana','human','open')`);
    const cv = await conversa(`phone='5562911110015'`);
    expect(cv.cliente_id).toBe(existente);
    // Quem já era cliente não volta para a qualificação nem perde o nome.
    expect(await clienteDe(existente)).toMatchObject({ nome: 'Ana do CRM', status_funil: 'ATENDIMENTO' });
  });
});
