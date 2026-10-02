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
];

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = '11111111-1111-4111-8111-111111111111';
const canal = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const conversa = '11111111-0000-4000-8000-000000000001';
let db: PGlite;

const comoDono = async (sql: string) => {
  await db.exec(`set request.jwt.claim.sub='${user}'`);
  return db.query(sql);
};
const outbox = async () => (await db.query<{ status: string }>(
  'select status from lotti_agent_outbox where conversation_id=$1 order by revision', [conversa])).rows;
const estado = async () => (await db.query<{ last_error: string | null; processed_revision: string; revision: string }>(
  'select last_error, processed_revision, revision from lotti_agent_conversations where id=$1', [conversa])).rows[0];
const mensagens = async () => (await db.query<{ sender: string; content: string }>(
  'select sender, content from lotti_agent_messages where conversation_id=$1 order by created_at', [conversa])).rows;

/** Recria o estado exato de produção: envio sem confirmação, conversa travada. */
const travar = async (eco?: 'humano') => {
  await db.exec(`
    delete from lotti_agent_messages where conversation_id='${conversa}';
    delete from lotti_agent_outbox where conversation_id='${conversa}';
    update lotti_agent_conversations set mode='ai', revision=5, processed_revision=4,
      lease_token=gen_random_uuid(), lease_until=now()-interval '1 minute', last_error=null where id='${conversa}';
    insert into lotti_agent_outbox(conversation_id,revision,content,status)
      values('${conversa}',5,'Temos opcoes em Anapolis.','sending');
  `);
  if (eco === 'humano') {
    await db.exec(`
      insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content)
        values('${conversa}','eco-do-provedor','out','human','Temos opcoes em Anapolis.');
    `);
  }
  // É o próprio claim que marca 'uncertain' e devolve a conversa para o humano.
  await db.query('select public.lotti_agent_claim()');
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
      VALUES ('${conversa}','${canal}','${owner}','5562911110001','ai','open');
  `);
}, 90_000);
afterAll(async () => db?.close());

describe('envio sem confirmação', () => {
  it('trava a conversa até alguém dizer se chegou', async () => {
    await travar();
    expect((await outbox())[0].status).toBe('uncertain');
    expect((await estado()).last_error).toBe('delivery_uncertain');
    // É a trava que o corretor sentiu: religar a IA não é permitido.
    await expect(comoDono(`select public.lotti_agent_set_mode('${conversa}','ai')`)).rejects.toThrow(/reconcile/);
  });

  it('"chegou" fecha o envio e libera a IA', async () => {
    await travar();
    await comoDono(`select public.lotti_agent_reconciliar_envio('${conversa}', true)`);
    expect((await outbox())[0].status).toBe('sent');
    const depois = await estado();
    expect(depois.last_error).toBeNull();
    expect(Number(depois.processed_revision)).toBe(5);
    await expect(comoDono(`select public.lotti_agent_set_mode('${conversa}','ai')`)).resolves.toBeTruthy();
  });

  it('"chegou" registra a resposta uma vez só, mesmo com o eco já na conversa', async () => {
    // O eco do provedor entra rotulado como humano, porque o nosso registro
    // ainda não tinha external_id. Gravar de novo duplicaria a frase na tela.
    await travar('humano');
    await comoDono(`select public.lotti_agent_reconciliar_envio('${conversa}', true)`);
    const linhas = await mensagens();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].sender).toBe('ai');
  });

  it('"não chegou" descarta o texto e deixa a IA escrever de novo', async () => {
    await travar();
    await comoDono(`select public.lotti_agent_reconciliar_envio('${conversa}', false)`);
    expect((await outbox())[0].status).toBe('cancelled');
    const depois = await estado();
    expect(depois.last_error).toBeNull();
    // Revisão continua pendente: a mensagem do lead segue sem resposta.
    expect(Number(depois.processed_revision)).toBeLessThan(Number(depois.revision));
    expect(await mensagens()).toHaveLength(0);
  });

  it('conversa de outro corretor não é reconciliável', async () => {
    await travar();
    await db.exec("set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222'");
    await expect(db.query(`select public.lotti_agent_reconciliar_envio('${conversa}', true)`)).rejects.toThrow(/forbidden/);
  });

  it('sem nada travado, não inventa registro', async () => {
    await db.exec(`delete from lotti_agent_outbox where conversation_id='${conversa}'`);
    const r = await comoDono(`select public.lotti_agent_reconciliar_envio('${conversa}', true) as r`);
    expect((r.rows[0] as { r: { reconciliados: number } }).r.reconciliados).toBe(0);
  });
});
