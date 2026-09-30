import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Ordem da produção: as de 2026-09-27, o número oculto, nomes e junção, esta e
// as de 2026-09-29 (um cliente e uma conversa por telefone).
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
  '20260930190000_conversa_sempre_no_crm.sql',
];
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
let counter = 0;

const importHistory = (messages: Record<string, unknown>[]) =>
  db.query('select public.lotti_agent_import_history($1,$2::jsonb)', ['lotti-agent',
    JSON.stringify(messages.map((m) => ({ external_id: `h${++counter}`, text: 'Oi', from_me: false, created_at: '2026-09-20T12:00:00Z', ...m })))]);
const conversation = async (where: string) => (await db.query<{ id: string; cliente_id: string | null; last_error: string | null }>(
  `select id,cliente_id,last_error from lotti_agent_conversations where ${where}`)).rows[0];
async function addToCrm(conversationId: string, as = user) {
  await db.exec(`SET request.jwt.claim.sub='${as}'; SET ROLE authenticated`);
  try { return (await db.query<{ r: { cliente_id: string; created: boolean } }>('select public.lotti_inbox_add_to_crm($1) r', [conversationId])).rows[0].r; }
  finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
}
const clients = async () => (await db.query<{ id: string; nome: string; telefone: string; corretor_id: string; status_funil: string | null }>('select id,nome,telefone,corretor_id,status_funil from clientes order by created_at')).rows;

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
    INSERT INTO corretores VALUES ('${owner}','${user}','Evandro'),('${other}','${otherUser}','Outra conta');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES ('${owner}','lotti-agent',true,false,'5562900000001')`);
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec('delete from lotti_agent_messages; delete from lotti_agent_conversations; delete from clientes;');
});

describe('Adicionar ao CRM a partir do Inbox', () => {
  it('a conversa importada já nasce no CRM em qualificação; o botão vira confirmação', async () => {
    await importHistory([{ phone: '5562911110001', profile: 'Neves' }]);
    const cv = await conversation(`phone='5562911110001'`);
    // Conversa com número não fica mais "Sem cliente vinculado" esperando clique.
    expect(cv.cliente_id).not.toBeNull();
    expect(await clients()).toMatchObject([
      { id: cv.cliente_id, nome: 'Neves', telefone: '5562911110001', corretor_id: owner, status_funil: 'QUALIFICACAO' },
    ]);
    // O front publicado ainda tem o botão: apertá-lo confirma, não duplica.
    expect(await addToCrm(cv.id)).toEqual({ cliente_id: cv.cliente_id, created: false });
    expect(await clients()).toHaveLength(1);
  });

  it('vincula o cliente salvo pelo CRM no formato nacional, sem o 55', async () => {
    const existing = (await db.query<{ id: string }>(`insert into clientes(corretor_id,nome,telefone) values ('${owner}','Carlos Neves','(62) 91111-0002') returning id`)).rows[0].id;
    await importHistory([{ phone: '5562911110002', profile: 'Neves' }]);
    const cv = await conversation(`phone='5562911110002'`);
    expect(await addToCrm(cv.id)).toEqual({ cliente_id: existing, created: false });
    expect(await clients()).toHaveLength(1);
  });

  it('vincula mesmo quando o WhatsApp manda o celular sem o nono dígito', async () => {
    const existing = (await db.query<{ id: string }>(`insert into clientes(corretor_id,nome,telefone) values ('${owner}','Ana','(62) 99111-0003') returning id`)).rows[0].id;
    await importHistory([{ phone: '556291110003' }]);
    const cv = await conversation(`phone='556291110003'`);
    expect(await addToCrm(cv.id)).toEqual({ cliente_id: existing, created: false });
  });

  it('cliente de outra conta com o mesmo telefone não é usado', async () => {
    await db.exec(`insert into clientes(corretor_id,nome,telefone) values ('${other}','De outra conta','(62) 91111-0007')`);
    await importHistory([{ phone: '5562911110007' }]);
    const cv = await conversation(`phone='5562911110007'`);
    const meus = (await clients()).filter((c) => c.corretor_id === owner);
    expect(meus).toHaveLength(1);
    expect(cv.cliente_id).toBe(meus[0].id);
    // Confirmar pelo botão não empresta o cliente da conta vizinha.
    expect(await addToCrm(cv.id)).toEqual({ cliente_id: meus[0].id, created: false });
  });

  it('sem nome usa "Contato WhatsApp", e o número que chega depois limpa a pendência', async () => {
    // Conversa achada só pelo LID nasce sem telefone, então sem cliente.
    await importHistory([{ lid: '123456789012399' }]);
    const semNumero = await conversation(`lid='123456789012399'`);
    expect(semNumero.cliente_id).toBeNull();
    await db.exec(`update lotti_agent_conversations set last_error='crm_capture_pending' where id='${semNumero.id}'`);
    // Quando o WhatsApp revela o número, ela entra no CRM sozinha.
    await db.exec(`update lotti_agent_conversations set phone='5562911110003' where id='${semNumero.id}'`);
    const ligada = await conversation(`id='${semNumero.id}'`);
    expect(ligada.cliente_id).not.toBeNull();
    expect(ligada.last_error).toBeNull();
    expect((await clients())[0].nome).toBe('Contato WhatsApp');
  });

  it('espera o número quando o WhatsApp esconde o telefone', async () => {
    await importHistory([{ lid: '123456789012345', profile: 'Anne' }]);
    const cv = await conversation(`lid='123456789012345'`);
    await expect(addToCrm(cv.id)).rejects.toThrow(/phone_required/);
    expect(await clients()).toHaveLength(0);
  });

  it('só o dono da conversa adiciona; visitante nem chama a função', async () => {
    await importHistory([{ phone: '5562911110004' }]);
    const cv = await conversation(`phone='5562911110004'`);
    await expect(addToCrm(cv.id, otherUser)).rejects.toThrow(/forbidden/);
    await expect(addToCrm('00000000-0000-4000-8000-000000000000')).rejects.toThrow(/forbidden/);
    const anon = (await db.query<{ ok: boolean }>(`select has_function_privilege('anon','public.lotti_inbox_add_to_crm(uuid)','execute') ok`)).rows[0].ok;
    const logged = (await db.query<{ ok: boolean }>(`select has_function_privilege('authenticated','public.lotti_inbox_add_to_crm(uuid)','execute') ok`)).rows[0].ok;
    expect(anon).toBe(false);
    expect(logged).toBe(true);
    // A importação já criou o cliente do dono; a chamada recusada não cria outro.
    expect(await clients()).toHaveLength(1);
  });

  it('captura automática e "Nova conversa" também acham o cliente salvo sem o 55', async () => {
    const byIngest = (await db.query<{ id: string }>(`insert into clientes(corretor_id,nome,telefone) values ('${owner}','Lead do site','(62) 91111-0008') returning id`)).rows[0].id;
    await db.query('select public.lotti_agent_ingest($1::jsonb)', [JSON.stringify({ instance: 'lotti-agent', phone: '5562911110008', external_id: 'live-1', text: 'Oi', from_me: false, unsupported: false, account: '5562900000001' })]);
    expect((await conversation(`phone='5562911110008'`)).cliente_id).toBe(byIngest);
    const byStart = (await db.query<{ id: string }>(`insert into clientes(corretor_id,nome,telefone) values ('${owner}','Indicação','62911110009') returning id`)).rows[0].id;
    await db.exec(`SET request.jwt.claim.sub='${user}'; SET ROLE authenticated`);
    try { await db.query('select public.lotti_inbox_start_conversation($1,$2)', ['(62) 91111-0009', null]); } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
    expect((await conversation(`phone='5562911110009'`)).cliente_id).toBe(byStart);
    expect((await clients()).filter((c) => c.corretor_id === owner)).toHaveLength(2);
  });

  it('a chave de telefone junta os formatos do mesmo número e separa números diferentes', async () => {
    const key = async (v: string | null) => (await db.query<{ k: string | null }>('select public.lotti_phone_key($1) k', [v])).rows[0].k;
    expect(await key('5562911110002')).toBe(await key('(62) 91111-0002'));
    expect(await key('+55 (62) 9 1111-0002')).toBe(await key('62911110002'));
    expect(await key('0055 62 91111-0002')).toBe(await key('5562911110002'));
    expect(await key('556291110003')).toBe(await key('(62) 99111-0003'));
    expect(await key('5555991234567')).toBe(await key('55991234567'));
    expect(await key('5562911110002')).not.toBe(await key('5511911110002'));
    // Fixo e celular com o mesmo final são linhas diferentes.
    expect(await key('(11) 3456-7890')).not.toBe(await key('(11) 93456-7890'));
    expect(await key('551134567890')).not.toBe(await key('5511934567890'));
    expect(await key('(11) 3456-7890')).toBe(await key('551134567890'));
    // Número de outro país fica com todos os dígitos.
    expect(await key('+1 415 555 0123')).toBe('14155550123');
    expect(await key('+1 415 555 0123')).not.toBe(await key('+1 425 555 0123'));
    expect(await key('14155550123')).toBe('14155550123');
    expect(await key('+351 912 345 678')).toBe('351912345678');
    expect(await key('')).toBeNull();
    expect(await key(null)).toBeNull();
  });
});
