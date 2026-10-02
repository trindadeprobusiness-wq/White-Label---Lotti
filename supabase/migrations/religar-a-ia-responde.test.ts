import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

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
  '20260926200000_lotti_whatsapp_lid_conversations.sql',
  '20260927120000_lotti_agent_stalled_claims.sql',
  '20260927120100_lotti_agent_opt_out.sql',
  '20260927130000_lotti_agent_settings.sql',
  '20260927140000_lotti_agent_follow_up.sql',
  '20260927150000_lotti_broadcasts.sql',
  '20260928190000_lotti_whatsapp_contact_names_and_merge.sql',
  '20260928200000_lotti_inbox_add_to_crm.sql',
  '20260929100000_crm_cliente_sem_duplicidade.sql',
  '20260929110000_crm_conversao_e_oportunidade.sql',
  '20260929120000_lotti_conversa_por_chave.sql',
  '20260929130000_lotti_canal_e_optout.sql',
  '20260929140000_duplicidade_ajustes_revisao.sql',
  '20260930190000_conversa_sempre_no_crm.sql',
  '20261001160000_conversa_abre_negocio_em_novo_lead.sql',
  '20261002090000_ia_pausa_com_prazo_e_modo_de_atendimento.sql',
  '20261002160000_atendimento_combinavel.sql',
  '20261002190000_reconciliar_envio_pelo_inbox.sql',
  '20261002210000_falha_de_envio_com_certeza.sql',
  '20261002220000_freio_e_motivos_honestos.sql',
  '20261002230000_religar_a_ia_responde.sql',
];

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = '11111111-1111-4111-8111-111111111111';
const canal = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const conversa = '11111111-0000-4000-8000-000000000001';
let db: PGlite;

const revisoes = async () => (await db.query<{ revision: string; processed_revision: string }>(
  'select revision, processed_revision from lotti_agent_conversations where id=$1', [conversa])).rows[0];
const pendente = async () => {
  const r = await revisoes();
  return Number(r.revision) > Number(r.processed_revision);
};

/**
 * Situação de produção depois de um handoff: a última mensagem do cliente foi
 * processada (a IA passou a conversa para a equipe em vez de responder), e o
 * modo ficou 'human'.
 */
const depoisDoHandoff = async (ultimoAFalar: 'lead' | 'ai' | 'human') => {
  await db.exec(`
    delete from lotti_agent_messages where conversation_id='${conversa}';
    insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content,created_at) values
      ('${conversa}','m1','in','lead','Quero agendar uma visita', now()-interval '3 minutes'),
      ('${conversa}','m2','out','ai','Vou chamar um corretor.', now()-interval '2 minutes'),
      ('${conversa}','m3','${ultimoAFalar === 'lead' ? 'in' : 'out'}','${ultimoAFalar}','Mensagem final', now()-interval '1 minute');
    update lotti_agent_conversations set mode='human', revision=21, processed_revision=21 where id='${conversa}';
  `);
};

const religar = async () => {
  await db.exec(`set request.jwt.claim.sub='${user}'`);
  await db.query(`select public.lotti_agent_set_mode('${conversa}','human')`);
  await db.query(`select public.lotti_agent_set_mode('${conversa}','ai')`);
};

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
    CREATE TABLE public.crm_etapas(id uuid primary key, corretor_id uuid not null, nome text, ordem int not null default 0, tipo text not null default 'ABERTA', ativo boolean not null default true);
    CREATE TABLE public.crm_oportunidades(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, cliente_id uuid, etapa_id uuid not null, titulo text not null, origem text, fechada_em timestamptz, updated_at timestamptz not null default now());
    INSERT INTO corretores VALUES ('${owner}','${user}','Evandro');
  `);
  for (const nome of anteriores) await db.exec(readFileSync(new URL(`./${nome}`, import.meta.url), 'utf8'));
  await db.exec(`
    INSERT INTO lotti_agent_channels(id,corretor_id,instance,enabled,sandbox,account_phone)
      VALUES ('${canal}','${owner}','lotti-agent',true,false,'5562900000001');
    INSERT INTO lotti_agent_conversations(id,channel_id,corretor_id,phone,mode,status)
      VALUES ('${conversa}','${canal}','${owner}','5562911110001','human','open');
  `);
}, 90_000);
afterAll(async () => db?.close());

describe('religar a IA', () => {
  it('com a última palavra do cliente, deixa a conversa pendente para a IA responder já', async () => {
    // O caso de produção: revision=21, processed_revision=21. Religar só
    // armava a IA para a PRÓXIMA mensagem, e o corretor via silêncio.
    await depoisDoHandoff('lead');
    expect(await pendente()).toBe(false);
    await religar();
    expect(await pendente()).toBe(true);
  });

  it('a revisão é nova, não rebaixada', async () => {
    // Rebaixar processed_revision esbarraria em registro antigo do outbox
    // naquela revisão; o `prepare` não grava por cima e a conversa travaria.
    await depoisDoHandoff('lead');
    await religar();
    const r = await revisoes();
    expect(Number(r.processed_revision)).toBe(21);
    expect(Number(r.revision)).toBe(22);
  });

  it('se a equipe falou por último, a IA não entra por cima', async () => {
    await depoisDoHandoff('human');
    await religar();
    expect(await pendente()).toBe(false);
  });

  it('se a própria IA falou por último, não repete', async () => {
    await depoisDoHandoff('ai');
    await religar();
    expect(await pendente()).toBe(false);
  });

  it('não abre uma segunda revisão quando já havia algo pendente', async () => {
    await depoisDoHandoff('lead');
    await db.exec(`update lotti_agent_conversations set revision=23, processed_revision=21 where id='${conversa}'`);
    await religar();
    expect(Number((await revisoes()).revision)).toBe(23);
  });

  it('desligar não mexe em revisão nenhuma', async () => {
    await depoisDoHandoff('lead');
    await db.exec(`update lotti_agent_conversations set mode='ai' where id='${conversa}'`);
    await db.exec(`set request.jwt.claim.sub='${user}'`);
    await db.query(`select public.lotti_agent_set_mode('${conversa}','human')`);
    expect(await pendente()).toBe(false);
  });
});
