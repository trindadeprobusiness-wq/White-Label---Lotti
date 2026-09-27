import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Lacunas confirmadas nas tarefas SCRUM-32, SCRUM-35 e SCRUM-37 (docs/jira/agente-mensagens.md).
// Cada `it.fails` descreve o comportamento ESPERADO e hoje falha de propósito:
// a suíte continua verde e o teste passa a acusar erro quando a lacuna for corrigida
// (troque `it.fails` por `it` nesse momento). Os cenários e as pré-condições do
// comportamento atual ficam no `beforeAll`, que derruba a suíte se o harness quebrar.
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
];
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const plan = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const instance = 'lotti-lacunas';
const profile = { intent: 'compra', region: 'Centro', budget: 'até 500 mil', needs: '2 quartos com garagem', nextStep: 'enviar opções', propertyId: null, timeframe: 'em 3 meses', payment: null, communication: null };

type Job = { id: string; token: string; revision: number };
let db: PGlite;
const rows = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T,>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const ingest = (phone: string, external_id: string, text: string) =>
  one('select public.lotti_agent_ingest($1::jsonb) r', [JSON.stringify({ instance, phone, external_id, text, from_me: false, unsupported: false, account: '5562900000001' })]);
const conversation = (phone: string) => one<{ id: string; cliente_id: string | null }>('select id,cliente_id from lotti_agent_conversations where phone=$1', [phone]);
/** Deixa só a conversa informada vencida na fila e reserva o próximo trabalho. */
async function claimOnly(id: string) {
  await db.query(`update lotti_agent_conversations set processed_revision=revision where id<>$1`, [id]);
  await db.query(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 second',lease_until=null,lease_token=null where id=$1`, [id]);
  return (await one<{ r: Job | null }>('select public.lotti_agent_claim() r')).r;
}
const prepare = (job: Job, result: Record<string, unknown>) =>
  db.query('select public.lotti_agent_prepare($1,$2,$3,$4::jsonb)', [job.id, job.token, job.revision, JSON.stringify({ stage: 'qualificando', response: 'Certo!', humanRequested: false, reason: 'Compra no Centro', ...result })]);
function assume(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`pré-condição do cenário quebrou: ${message}`); }

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
    CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, email text, status_funil text, tipo_interesse text, observacoes text, proximo_followup timestamptz, tracking_data jsonb default '{}'::jsonb, created_at timestamptz default now());
    CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
    CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
    CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text, entidade_tipo text, entidade_id uuid);
    CREATE TABLE public.plan_entitlements(plan_id uuid, feature_key text, limit_value int, unlimited boolean default false, enabled boolean default true);
    CREATE TABLE public.subscriptions(id uuid primary key default gen_random_uuid(), corretor_id uuid, plan_id uuid, status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz default now());
    CREATE TABLE public.usage_counters(corretor_id uuid, feature_key text, used_quantity int, period_start date, period_end date, updated_at timestamptz default now(), unique(corretor_id,feature_key,period_start));
    CREATE TABLE public.crm_etapas(id uuid primary key, nome text);
    CREATE TABLE public.crm_oportunidades(id uuid primary key, corretor_id uuid, cliente_id uuid, etapa_id uuid, titulo text);
    INSERT INTO corretores VALUES ('${owner}','11111111-1111-4111-8111-111111111111','Conta fictícia');
    INSERT INTO plan_entitlements VALUES ('${plan}','leads_qualificados_monthly',100,false,true);
    INSERT INTO subscriptions(corretor_id,plan_id,status,current_period_end) VALUES ('${owner}','${plan}','active',now()+interval '30 days');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  // Canal real (não sandbox) e habilitado, como no atendimento de produção.
  await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES ('${owner}','${instance}',true,false,'5562900000001')`);
}, 60_000);
afterAll(async () => db?.close());

describe('SCRUM-32 — falha do provedor de IA', () => {
  const phone = '5511900000032';
  beforeAll(async () => {
    await ingest(phone, 'f-1', 'Quero comprar um apartamento');
    const { id } = await conversation(phone);
    // O runtime chama lotti_agent_fail a cada erro do OpenAI (server.mjs:45-47).
    for (let attempt = 1; attempt <= 3; attempt++) {
      const job = await claimOnly(id);
      assume(job?.id === id, `tentativa ${attempt} não reservou a conversa`);
      await db.query(`select public.lotti_agent_fail($1,$2,'qualification_failed')`, [job.id, job.token]);
    }
    const state = await one<{ mode: string }>('select mode from lotti_agent_conversations where id=$1', [id]);
    assume(state.mode === 'human', 'após 3 falhas a conversa deveria ir para humano');
  });

  it.fails('ESPERADO: o lead recebe uma resposta de contingência quando a IA falha de forma definitiva', async () => {
    const { id } = await conversation(phone);
    const outbound = await one<{ n: number }>(`select (select count(*) from lotti_agent_outbox where conversation_id=$1)
      + (select count(*) from lotti_agent_messages where conversation_id=$1 and direction='out') as n`, [id]);
    expect(Number(outbound.n)).toBeGreaterThan(0);
  });
});

describe('SCRUM-35 — faixa de preço, prazo e necessidades no lead', () => {
  const phone = '5511900000035';
  beforeAll(async () => {
    await ingest(phone, 'p-1', 'Quero comprar no Centro até 500 mil em 3 meses, 2 quartos com garagem');
    const { id, cliente_id } = await conversation(phone);
    assume(cliente_id, 'o ingest deveria vincular um cadastro em clientes');
    const first = await claimOnly(id);
    assume(first?.id === id, 'primeira qualificação não reservada');
    await prepare(first, { profile });
    const saved = await one<{ budget: string | null }>(`select qualification->'profile'->>'budget' budget from lotti_agent_conversations where id=$1`, [id]);
    assume(saved.budget === profile.budget, 'o perfil deveria ser salvo em lotti_agent_conversations.qualification');
    // Nova mensagem do lead; o modelo devolve o perfil sem repetir o orçamento.
    await ingest(phone, 'p-2', 'Pode ser perto de escola?');
    const second = await claimOnly(id);
    assume(second?.id === id, 'segunda qualificação não reservada');
    await prepare(second, { profile: { ...profile, budget: null } });
  });

  it.fails('ESPERADO: orçamento, prazo e necessidades qualificados chegam ao cadastro do lead (clientes)', async () => {
    const { cliente_id } = await conversation(phone);
    const lead = await one<{ t: string }>('select row_to_json(c)::text t from clientes c where id=$1', [cliente_id]);
    for (const value of ['até 500 mil', 'em 3 meses', '2 quartos com garagem']) expect(lead.t).toContain(value);
  });

  it.fails('ESPERADO: um turno sem orçamento não apaga o orçamento que o lead já declarou', async () => {
    const { id } = await conversation(phone);
    const saved = await one<{ budget: string | null }>(`select qualification->'profile'->>'budget' budget from lotti_agent_conversations where id=$1`, [id]);
    expect(saved.budget).toBe(profile.budget);
  });
});

describe('SCRUM-37 — pedido de descadastro (opt-out)', () => {
  const phone = '5511900000037';
  let conversationId = '';
  beforeAll(async () => {
    await ingest(phone, 'o-1', 'Oi, vi o anúncio');
    conversationId = (await conversation(phone)).id;
    await db.query(`update lotti_agent_conversations set processed_revision=revision where id=$1`, [conversationId]);
    await ingest(phone, 'o-2', 'SAIR. Não quero mais receber mensagens.');
    const state = await one<{ mode: string; pending: boolean }>('select mode,revision>processed_revision pending from lotti_agent_conversations where id=$1', [conversationId]);
    assume(state.mode === 'ai' && state.pending, 'o pedido de descadastro deveria estar registrado como mensagem nova');
  });

  it.fails('ESPERADO: depois do "SAIR" a IA não reserva a conversa para responder automaticamente', async () => {
    const job = await claimOnly(conversationId);
    expect(job?.id).not.toBe(conversationId);
  });

  it.fails('ESPERADO: depois do "SAIR" um novo envio manual não é liberado sem novo contato do lead', async () => {
    await db.query(`update lotti_agent_conversations set mode='human',lease_token=null,lease_until=null where id=$1`, [conversationId]);
    const status = await one<{ r: { status: string } }>(`select public.lotti_manual_begin($1,$2,gen_random_uuid(),'fp','Temos novas opções para você',null) r`, [owner, conversationId])
      .then(result => result.r.status, () => 'recusado');
    expect(status).not.toBe('ready');
  });
});
