import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// SCRUM-32 (conversa abandonada vai para a equipe) e SCRUM-37 (opt-out),
// carregados sobre as migrations reais do agente.
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
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerUser = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const plan = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const instance = 'lotti-protecoes';

type Job = { id: string; token: string; revision: number };
let db: PGlite;
const rows = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T,>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const ingest = (phone: string, external_id: string, text: string) =>
  one('select public.lotti_agent_ingest($1::jsonb) r', [JSON.stringify({ instance, phone, external_id, text, from_me: false, unsupported: false, account: '5562900000001' })]);
const conversation = (phone: string) =>
  one<{ id: string; mode: string; opted_out_at: string | null; last_error: string | null; lease_until: string | null }>(
    'select id,mode,opted_out_at,last_error,lease_until from lotti_agent_conversations where phone=$1', [phone]);
async function claimOnly(id: string) {
  await db.query('update lotti_agent_conversations set processed_revision=revision where id<>$1', [id]);
  await db.query(`update lotti_agent_conversations set next_attempt_at=now()-interval '1 second',lease_until=null,lease_token=null where id=$1`, [id]);
  return (await one<{ r: Job | null }>('select public.lotti_agent_claim() r')).r;
}
async function asUser<T>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET request.jwt.claim.sub='${user}'`);
  try { return (await db.query<T>(sql, params)).rows[0]; } finally { await db.exec(`RESET request.jwt.claim.sub`); }
}
const manualBegin = (conversationId: string) =>
  one<{ r: { status: string } }>(`select public.lotti_manual_begin($1,$2,gen_random_uuid(),'fp','Temos novas opções',null) r`, [owner, conversationId]);
const alerts = (conversationId: string) =>
  rows<{ mensagem: string }>(`select mensagem from alertas where metadata->>'conversation_id'=$1`, [conversationId]);

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
    INSERT INTO corretores VALUES ('${owner}','${ownerUser}','Corretora Teste'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${otherUser}','Outra conta');
    INSERT INTO plan_entitlements VALUES ('${plan}','leads_qualificados_monthly',100,false,true);
    INSERT INTO subscriptions(corretor_id,plan_id,status,current_period_end) VALUES ('${owner}','${plan}','active',now()+interval '30 days');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES ('${owner}','${instance}',true,false,'5562900000001')`);
}, 60_000);
afterAll(async () => db?.close());

describe('SCRUM-37 — reconhecimento do pedido de descadastro', () => {
  const optOut = async (text: string) => (await one<{ r: boolean }>('select public.lotti_agent_is_opt_out($1) r', [text])).r;

  it.each([
    'SAIR', 'sair', 'Pare', 'PARAR!', 'Stop', 'SAIR. Não quero mais receber mensagens.',
    'Não quero mais receber mensagens', 'nao quero receber mais msg', 'Parem de me mandar mensagem, por favor',
    'Por favor não me mande mais nada', 'Quero me descadastrar', 'me tire da lista', 'Tire meu número dessa lista',
  ])('reconhece "%s"', async text => expect(await optOut(text)).toBe(true));

  it.each([
    'Quero sair do aluguel', 'Preciso parar de pagar aluguel', 'Não quero mais esse imóvel, tem outro?',
    'Pode parar na frente do prédio', 'Não quero receber visita hoje', 'Quais imóveis estão na lista?', '', null,
  ])('não confunde "%s" com pedido de saída', async text => expect(await optOut(text as string)).toBe(false));
});

describe('SCRUM-37 — o contato que pediu para sair', () => {
  const phone = '5511900000037';
  let id = '';
  beforeAll(async () => {
    await ingest(phone, 'o-1', 'Oi, vi o anúncio');
    id = (await conversation(phone)).id;
    await db.query('update lotti_agent_conversations set processed_revision=revision where id=$1', [id]);
    await ingest(phone, 'o-2', 'SAIR. Não quero mais receber mensagens.');
  });

  it('sai da IA, fica marcado e avisa a equipe sem enviar nada ao lead', async () => {
    const state = await conversation(phone);
    expect(state.mode).toBe('human');
    expect(state.opted_out_at).not.toBeNull();
    expect(await alerts(id)).toEqual([expect.objectContaining({ mensagem: expect.stringContaining('não receber mais mensagens') })]);
    const events = await rows<{ kind: string; to_label: string; actor_label: string }>(
      `select kind,to_label,actor_label from lotti_inbox_events where conversation_id=$1 and kind='consent'`, [id]);
    expect(events).toEqual([{ kind: 'consent', to_label: 'Pediu para não receber mensagens', actor_label: 'Contato' }]);
    const outbound = await one<{ n: number }>(`select (select count(*) from lotti_agent_outbox where conversation_id=$1)
      + (select count(*) from lotti_agent_messages where conversation_id=$1 and direction='out') n`, [id]);
    expect(Number(outbound.n)).toBe(0);
  });

  it('a IA não reserva a conversa nem pode ser religada', async () => {
    expect((await claimOnly(id))?.id).not.toBe(id);
    await expect(asUser(ownerUser, `select public.lotti_agent_set_mode($1,'ai')`, [id])).rejects.toThrow(/contact_opted_out/);
  });

  it('bloqueia envio manual até o lead escrever de novo', async () => {
    await expect(manualBegin(id)).rejects.toThrow(/contact_opted_out/);
    await ingest(phone, 'o-3', 'Na verdade ainda quero ver o apartamento');
    expect((await manualBegin(id)).r.status).toBe('ready');
    const state = await conversation(phone);
    expect(state.mode).toBe('human');
    expect(state.opted_out_at).not.toBeNull();
  });

  it('só o dono libera o contato; liberar registra o evento e não religa a IA sozinho', async () => {
    await db.query(`update lotti_manual_sends set status='sent' where conversation_id=$1`, [id]);
    await expect(asUser(otherUser, 'select public.lotti_inbox_clear_opt_out($1)', [id])).rejects.toThrow(/forbidden/);
    expect((await asUser<{ r: boolean }>(ownerUser, 'select public.lotti_inbox_clear_opt_out($1) r', [id]))!.r).toBe(true);
    const state = await conversation(phone);
    expect(state.opted_out_at).toBeNull();
    expect(state.mode).toBe('human');
    const released = await one<{ to_label: string; actor_label: string }>(
      `select to_label,actor_label from lotti_inbox_events where conversation_id=$1 and kind='consent' and to_label='Contato liberado'`, [id]);
    expect(released).toEqual({ to_label: 'Contato liberado', actor_label: 'Corretora Teste' });
    expect((await asUser<{ r: boolean }>(ownerUser, `select public.lotti_agent_set_mode($1,'ai') r`, [id]))!.r).toBe(true);
  });

  it('mensagem comum não marca opt-out', async () => {
    await ingest('5511900000038', 'c-1', 'Quero sair do aluguel, tem casa de 2 quartos?');
    const state = await conversation('5511900000038');
    expect(state.mode).toBe('ai');
    expect(state.opted_out_at).toBeNull();
  });

  it('no histórico importado, um "sair" antigo seguido de nova conversa não bloqueia', async () => {
    const item = (external_id: string, text: string, created_at: string) =>
      ({ phone: '5511900000039', external_id, text, from_me: false, created_at, account: '5562900000001' });
    await one('select public.lotti_agent_import_history($1,$2::jsonb)', [instance, JSON.stringify([
      item('h-2', 'Oi, voltei. Ainda tem o apartamento?', '2026-09-20T12:00:00Z'),
      item('h-1', 'sair', '2026-09-10T12:00:00Z'),
    ])]);
    expect((await conversation('5511900000039')).opted_out_at).toBeNull();
    await one('select public.lotti_agent_import_history($1,$2::jsonb)', [instance, JSON.stringify([
      { ...item('h-3', 'PARE', '2026-09-21T12:00:00Z'), phone: '5511900000040' },
    ])]);
    const imported = await conversation('5511900000040');
    expect(imported.opted_out_at).not.toBeNull();
    expect(await alerts(imported.id)).toEqual([]);
  });
});

describe('SCRUM-32 — conversa abandonada pela IA', () => {
  const abandon = async (id: string) => {
    const job = await claimOnly(id);
    expect(job?.id).toBe(id);
    // O runtime reservou e sumiu: nem prepare, nem fail. O lease vence.
    await db.query(`update lotti_agent_conversations set lease_until=now()-interval '1 second' where id=$1`, [id]);
  };
  const escalate = async () => Number((await one<{ n: number }>('select public.lotti_agent_escalate_stalled() n')).n);

  it('na 3ª reserva abandonada vai para a equipe com alerta, uma única vez', async () => {
    await ingest('5511900000032', 's-1', 'Quero alugar um apartamento');
    const { id } = await conversation('5511900000032');
    await abandon(id);
    await abandon(id);
    expect(await escalate()).toBe(0);
    expect((await conversation('5511900000032')).mode).toBe('ai');
    await db.query('update lotti_agent_conversations set lease_until=null,lease_token=null where id=$1', [id]);
    await abandon(id);
    expect(await escalate()).toBe(1);
    const state = await conversation('5511900000032');
    expect(state).toMatchObject({ mode: 'human', last_error: 'processing_stalled', lease_until: null });
    expect(await alerts(id)).toEqual([expect.objectContaining({ mensagem: expect.stringContaining('atendimento automático não concluiu') })]);
    expect(await escalate()).toBe(0);
    expect((await claimOnly(id))?.id).not.toBe(id);
  });

  it('não mexe em conversa com reserva ainda válida', async () => {
    await ingest('5511900000033', 'v-1', 'Tem casa com quintal?');
    const { id } = await conversation('5511900000033');
    await db.query(`update lotti_agent_conversations set attempts=3,lease_token=gen_random_uuid(),lease_until=now()+interval '1 minute' where id=$1`, [id]);
    expect(await escalate()).toBe(0);
    expect((await conversation('5511900000033')).mode).toBe('ai');
  });

  it('só o runtime (service_role) executa a função', async () => {
    const grants = await one<{ auth: boolean; svc: boolean }>(`select
      has_function_privilege('authenticated','public.lotti_agent_escalate_stalled()','execute') auth,
      has_function_privilege('service_role','public.lotti_agent_escalate_stalled()','execute') svc`);
    expect(grants).toEqual({ auth: false, svc: true });
  });
});
