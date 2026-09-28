import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Agente de IA, etapa 1: configuração no banco, adiar/pular, transferência e
// "Nova conversa" independente do agente, sobre as migrations reais.
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
  '20260927130000_lotti_agent_settings.sql',
];
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ownerUser = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const plan = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const stage = '99999999-9999-4999-8999-999999999991';
const foreignStage = '99999999-9999-4999-8999-999999999992';

const settings = (change: Record<string, unknown> = {}) => ({
  version: 2, active: true, model: 'gpt-4o-mini',
  identity: { name: 'Ana', company: 'Imobiliária Centro', intro: 'Olá! Aqui é a Ana.' },
  behavior: { attendMode: 'always', attendDelayMinutes: 15, handoff: { mode: 'message', messageInHours: 'Vou chamar o corretor.', messageOutOfHours: 'Amanhã cedo o corretor te chama.', stageId: null }, guards: { aggregationSeconds: 10 } },
  prompt: '', ...change,
});

type Job = { id: string; token: string; revision: number };
let db: PGlite;
const rows = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T,>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
async function asUser<T>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET request.jwt.claim.sub='${user}'; SET ROLE authenticated`);
  try { return (await db.query<T>(sql, params)).rows[0]; } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
}
const save = (user: string, value: unknown) => asUser<{ r: { updated_at: string } }>(user, 'select public.lotti_agent_save_settings($1::jsonb) r', [JSON.stringify(value)]);
const ingest = (phone: string, external_id: string, text = 'Oi') =>
  one('select public.lotti_agent_ingest($1::jsonb) r', [JSON.stringify({ instance: 'lotti-a', phone, external_id, text, from_me: false, unsupported: false, account: '5562900000001' })]);
const conversation = (phone: string) => one<{ id: string; mode: string; attempts: number; revision: number; processed_revision: number; lease_until: string | null; next_attempt_at: string; cliente_id: string }>(
  'select id,mode,attempts,revision,processed_revision,lease_until,next_attempt_at,cliente_id from lotti_agent_conversations where phone=$1', [phone]);
async function claimOnly(id: string) {
  await db.query('update lotti_agent_conversations set processed_revision=revision where id<>$1', [id]);
  await db.query(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 second',lease_until=null,lease_token=null where id=$1`, [id]);
  return (await one<{ r: Job | null }>('select public.lotti_agent_claim() r')).r!;
}
const usage = async () => Number((await one<{ n: number }>(`select coalesce(sum(used_quantity),0) n from usage_counters where corretor_id=$1`, [owner])).n);

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
    INSERT INTO corretores VALUES ('${owner}','${ownerUser}','Corretora'),('${other}','${otherUser}','Outra');
    INSERT INTO crm_etapas VALUES ('${stage}','${owner}','Com corretor'),('${foreignStage}','${other}','De outra conta');
    INSERT INTO plan_entitlements VALUES ('${plan}','leads_qualificados_monthly',100,false,true);
    INSERT INTO subscriptions(corretor_id,plan_id,status,current_period_end) VALUES ('${owner}','${plan}','active',now()+interval '30 days');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES ('${owner}','lotti-a',false,false,'5562900000001')`);
}, 60_000);
afterAll(async () => db?.close());

describe('configuração salva no banco', () => {
  it('o dono salva e o "Agente ativo" liga e desliga a IA do número conectado', async () => {
    await save(ownerUser, settings({ active: true }));
    expect((await one<{ enabled: boolean }>(`select enabled from lotti_agent_channels where corretor_id=$1`, [owner])).enabled).toBe(true);
    await save(ownerUser, settings({ active: false }));
    expect((await one<{ enabled: boolean }>(`select enabled from lotti_agent_channels where corretor_id=$1`, [owner])).enabled).toBe(false);
    const stored = await one<{ name: string }>(`select settings#>>'{identity,name}' as name from lotti_agent_settings where corretor_id=$1`, [owner]);
    expect(stored.name).toBe('Ana');
  });

  it('cada conta lê só a própria configuração', async () => {
    const seen = await asUser<{ n: number }>(otherUser, 'select count(*)::int n from lotti_agent_settings');
    expect(seen!.n).toBe(0);
    await db.exec('SET ROLE anon');
    try { await expect(db.query('select * from lotti_agent_settings')).rejects.toThrow(/permission denied/); }
    finally { await db.exec('RESET ROLE'); }
  });

  it.each([
    ['modelo inválido', { model: 'DROP TABLE' }, /invalid_model/],
    ['nome vazio', { identity: { name: ' ', company: '', intro: '' } }, /invalid_identity/],
    ['instruções longas demais', { prompt: 'x'.repeat(3001) }, /invalid_prompt/],
    ['modo de atendimento desconhecido', { behavior: { ...settings().behavior, attendMode: 'nunca' } }, /invalid_behavior/],
    ['agrupamento acima de 60 s', { behavior: { ...settings().behavior, guards: { aggregationSeconds: 90 } } }, /invalid_behavior/],
    ['versão antiga', { version: 1 }, /invalid_settings/],
  ])('recusa %s', async (_label, change, error) => {
    await expect(save(ownerUser, settings(change as Record<string, unknown>))).rejects.toThrow(error);
  });

  it('usuário sem conta de corretor não salva', async () => {
    await expect(save('33333333-3333-4333-8333-333333333333', settings())).rejects.toThrow(/forbidden/);
  });
});

describe('"Nova conversa" não depende do agente ligado', () => {
  it('abre a conversa manual com o agente desligado', async () => {
    await db.exec(`update lotti_agent_channels set enabled=false where corretor_id='${owner}'`);
    const created = await asUser<{ id: string }>(ownerUser, `select public.lotti_inbox_start_conversation('(62) 98888-0000','Carla') id`);
    expect(created!.id).toBeTruthy();
  });
});

describe('adiar e pular a resposta', () => {
  it('adiar libera a reserva, não conta como falha e reagenda', async () => {
    await db.exec(`update lotti_agent_channels set enabled=true where corretor_id='${owner}'`);
    await ingest('5511900000101', 'd-1');
    const { id } = await conversation('5511900000101');
    const job = await claimOnly(id);
    expect(await one(`select public.lotti_agent_defer($1,gen_random_uuid(),now(),false,'x') r`, [id])).toEqual({ r: false });
    const until = new Date(Date.now() + 60_000).toISOString();
    expect(await one(`select public.lotti_agent_defer($1,$2,$3,false,'aggregation') r`, [id, job.token, until])).toEqual({ r: true });
    const state = await conversation('5511900000101');
    expect(state.lease_until).toBeNull();
    expect(state.attempts).toBe(0);
    expect(new Date(state.next_attempt_at).toISOString()).toBe(until);
    expect(state.processed_revision).toBeLessThan(state.revision);
  });

  it('pular marca como tratada e devolve a franquia de quem a IA nunca atendeu', async () => {
    await ingest('5511900000102', 's-1');
    const { id } = await conversation('5511900000102');
    const before = await usage();
    const job = await claimOnly(id);
    expect(await usage()).toBe(before + 1);
    await one(`select public.lotti_agent_defer($1,$2,null,true,'outside_attend_mode')`, [id, job.token]);
    const state = await conversation('5511900000102');
    expect(state.processed_revision).toBe(state.revision);
    expect(await usage()).toBe(before);
    expect((await claimOnly(id))).toBeNull();
  });

  it('não devolve a franquia de quem a IA já atendeu', async () => {
    await ingest('5511900000103', 'k-1');
    const { id } = await conversation('5511900000103');
    await db.query(`insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content) values($1,'ai-1','out','ai','Olá!')`, [id]);
    await ingest('5511900000103', 'k-2');
    const job = await claimOnly(id);
    const before = await usage();
    await one(`select public.lotti_agent_defer($1,$2,null,true,'outside_attend_mode')`, [id, job.token]);
    expect(await usage()).toBe(before);
  });
});

describe('transferência para a equipe', () => {
  it('silenciosa: pausa a IA, avisa a equipe e cria o negócio na etapa configurada', async () => {
    await ingest('5511900000104', 'h-1', 'Quero falar com um corretor');
    const { id, cliente_id } = await conversation('5511900000104');
    const job = await claimOnly(id);
    const result = { stage: 'qualificando', humanRequested: true, response: '', reason: 'Pediu corretor' };
    expect(await one(`select public.lotti_agent_handoff($1,$2,$3,$4::jsonb,$5,true) r`, [id, job.token, job.revision, JSON.stringify(result), stage])).toEqual({ r: true });
    const state = await conversation('5511900000104');
    expect(state).toMatchObject({ mode: 'human', lease_until: null });
    expect(state.processed_revision).toBe(state.revision);
    expect(await rows(`select mensagem from alertas where metadata->>'conversation_id'=$1`, [id])).toEqual([{ mensagem: 'Contato solicitou atendimento do corretor' }]);
    expect(await rows(`select etapa_id,origem from crm_oportunidades where cliente_id=$1`, [cliente_id])).toEqual([{ etapa_id: stage, origem: 'whatsapp_ia' }]);
    expect(await rows(`select 1 from lotti_agent_outbox where conversation_id=$1`, [id])).toEqual([]);
  });

  it('com mensagem: só pausa depois da entrega e move o negócio existente; ignora etapa de outra conta', async () => {
    await ingest('5511900000105', 'h-2', 'Quero agendar visita');
    const { id, cliente_id } = await conversation('5511900000105');
    await db.query(`insert into crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo) values($1,$2,$3,'Negócio antigo')`, [owner, cliente_id, foreignStage]);
    const job = await claimOnly(id);
    expect(await one(`select public.lotti_agent_handoff($1,null,$2,null,$3,false) r`, [id, job.revision, stage])).toEqual({ r: false });
    await db.query('update lotti_agent_conversations set processed_revision=revision,lease_token=null,lease_until=null where id=$1', [id]);
    expect(await one(`select public.lotti_agent_handoff($1,null,$2,null,$3,false) r`, [id, job.revision, stage])).toEqual({ r: true });
    expect((await conversation('5511900000105')).mode).toBe('human');
    expect(await rows(`select etapa_id from crm_oportunidades where cliente_id=$1`, [cliente_id])).toEqual([{ etapa_id: stage }]);
    await one(`select public.lotti_agent_handoff($1,null,$2,null,$3,false)`, [id, job.revision, foreignStage]);
    expect(await rows(`select etapa_id from crm_oportunidades where cliente_id=$1`, [cliente_id])).toEqual([{ etapa_id: stage }]);
  });

  it('só o runtime (service_role) adia ou transfere; o navegador só salva a própria configuração', async () => {
    const grants = await one<{ defer: boolean; handoff: boolean; save: boolean }>(`select
      has_function_privilege('authenticated','public.lotti_agent_defer(uuid,uuid,timestamptz,boolean,text)','execute') "defer",
      has_function_privilege('authenticated','public.lotti_agent_handoff(uuid,uuid,bigint,jsonb,uuid,boolean)','execute') handoff,
      has_function_privilege('authenticated','public.lotti_agent_save_settings(jsonb)','execute') save`);
    expect(grants).toEqual({ defer: false, handoff: false, save: true });
  });
});
