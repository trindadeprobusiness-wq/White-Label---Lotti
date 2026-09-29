import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Duplicidades (2026-09-29): um cliente por telefone em cada conta, uma
// conversa por linha em cada canal, negócio aberto reaproveitado, número que
// volta ao canal e opt-out repetido. Migrations reais, na ordem da produção.
// O PGlite tem uma conexão só: as travas são conferidas em pg_locks dentro da
// transação; a corrida real precisa de um Postgres com duas conexões.
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
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
const stage = '99999999-9999-4999-8999-999999999991';
const laterStage = '99999999-9999-4999-8999-999999999993';
const foreignStage = '99999999-9999-4999-8999-999999999992';
const facade = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const foreignFacade = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
const account = '5562900000001';
const lid = '123456789012345';
const media = 'Mensagem de áudio ou mídia: atendimento humano necessário';
const optOutEvent = 'Pediu para não receber mensagens';

type Conversation = { id: string; phone: string | null; lid: string | null; mode: string; cliente_id: string | null; contact_name: string | null; opted_out_at: string | null };
let db: PGlite;
let channel: string;
let counter = 0;
const uuid = () => crypto.randomUUID();
const rows = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const one = async <T,>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const count = async (sql: string, params: unknown[] = []) => (await one<{ n: number }>(`select count(*)::int n from ${sql}`, params)).n;
async function asUser<T>(who: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET request.jwt.claim.sub='${who}'; SET ROLE authenticated`);
  try { return (await db.query<T>(sql, params)).rows[0]; } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
}
const ingest = async (event: Record<string, unknown>) => (await one<{ r: Record<string, unknown> }>('select public.lotti_agent_ingest($1::jsonb) r',
  [JSON.stringify({ instance: 'lotti-a', external_id: `m${++counter}`, text: 'Oi', from_me: false, unsupported: false, account, ...event })])).r;
const start = async (phone: string, name: string | null = null, who = user) =>
  (await asUser<{ id: string }>(who, 'select public.lotti_inbox_start_conversation($1,$2) id', [phone, name])).id;
const rename = async (conversation: string, name: string, phone: string, who = user) =>
  (await asUser<{ r: Record<string, unknown> }>(who, 'select public.lotti_inbox_update_contact($1,$2,$3) r', [conversation, name, phone])).r;
const merge = async (keep: string, drop: string, who = user) =>
  (await asUser<{ r: Record<string, unknown> }>(who, 'select public.lotti_inbox_merge_conversations($1,$2) r', [keep, drop])).r;
const conversations = (where = 'true') => rows<Conversation>(
  `select c.id,c.phone,c.lid,c.mode,c.cliente_id,c.contact_name,c.opted_out_at from lotti_agent_conversations c
   join lotti_agent_channels h on h.id=c.channel_id where h.instance='lotti-a' and ${where} order by c.phone`);
const messagesOf = async (id: string) => (await rows<{ external_id: string }>(
  'select external_id from lotti_agent_messages where conversation_id=$1 order by external_id', [id])).map((m) => m.external_id);
async function addClient(telefone: string, nome = 'Cliente', corretor = owner, extra: Record<string, string> = {}) {
  const cols = ['corretor_id', 'nome', 'telefone', ...Object.keys(extra)];
  const values = [corretor, nome, telefone, ...Object.values(extra)];
  return (await one<{ id: string }>(`insert into clientes(${cols.join(',')}) values(${values.map((_, i) => `$${i + 1}`).join(',')}) returning id`, values)).id;
}
// Duplicado herdado de antes desta migration (a trava só vale para o que entra agora).
async function legacyClient(telefone: string, nome = 'Contato WhatsApp') {
  await db.exec('alter table clientes disable trigger clientes_phone_guard_insert');
  try { return await addClient(telefone, nome); } finally { await db.exec('alter table clientes enable trigger clientes_phone_guard_insert'); }
}
const clients = () => rows<{ id: string; nome: string; telefone: string; email: string | null }>('select id,nome,telefone,email from clientes where corretor_id=$1 order by created_at', [owner]);
const lead = async (telefone: string, nome = 'Lead', email: string | null = null, fachada = facade) =>
  (await one<{ id: string }>('insert into fachada_leads(fachada_id,nome,telefone,email) values($1,$2,$3,$4) returning id', [fachada, nome, telefone, email])).id;
const convert = async (leadId: string, etapa: string | null = stage, dados: Record<string, unknown> = {}, cliente: string | null = null, who = user) =>
  (await asUser<{ r: Record<string, unknown> }>(who, 'select public.crm_converter_lead($1,$2,$3::jsonb,$4) r', [leadId, etapa, JSON.stringify(dados), cliente])).r;
const candidates = async (telefone: string | null, email: string | null = null, cpf: string | null = null, who = user) =>
  (await asUser<{ r: unknown[] }>(who, 'select public.crm_clientes_por_telefone($1,$2,$3) r', [telefone, email, cpf])).r;
const openDeals = (cliente: string) => rows<{ id: string; etapa_id: string; origem: string }>(
  'select id,etapa_id,origem from crm_oportunidades where cliente_id=$1 and fechada_em is null', [cliente]);
const privilege = async (role: string, fn: string) =>
  (await one<{ ok: boolean }>('select has_function_privilege($1,$2,\'execute\') ok', [role, fn])).ok;
const LOCK = `select exists(select 1 from pg_locks where locktype='advisory' and ((classid::bigint<<32)|objid::bigint)=hashtextextended($1,$2)) ok`;
async function manualSent(conversation: string, external: string) {
  const request = uuid();
  expect((await one<{ r: { status: string } }>(`select public.lotti_manual_begin($1,$2,$3,'fp','Olá',null) r`, [owner, conversation, request])).r.status).toBe('ready');
  await db.query(`select public.lotti_manual_finish($1,'sent',$2)`, [request, external]);
  return request;
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
    CREATE FUNCTION public.get_corretor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT id FROM public.corretores WHERE user_id=auth.uid() $$;
    -- Como na produção, as colunas do funil são enums.
    CREATE TYPE public.tipo_interesse AS ENUM ('COMPRA','LOCACAO','AMBOS');
    CREATE TYPE public.status_funil AS ENUM ('QUALIFICACAO','VISITA_PROPOSTA','DOCUMENTACAO','FECHADO_GANHO','FECHADO_PERDIDO');
    CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, email text, cpf text,
      tipo_interesse public.tipo_interesse not null default 'COMPRA', status_funil public.status_funil not null default 'QUALIFICACAO', observacoes text,
      tracking_data jsonb default '{}'::jsonb, ultimo_contato timestamptz default now(), created_at timestamptz default clock_timestamp());
    CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
    CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
    CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text, entidade_tipo text, entidade_id uuid, lido boolean default false);
    CREATE TABLE public.plan_entitlements(plan_id uuid, feature_key text, limit_value int, unlimited boolean default false, enabled boolean default true);
    CREATE TABLE public.subscriptions(id uuid primary key default gen_random_uuid(), corretor_id uuid, plan_id uuid, status text, trial_ends_at timestamptz, current_period_end timestamptz, created_at timestamptz default now());
    CREATE TABLE public.usage_counters(corretor_id uuid, feature_key text, used_quantity int, period_start date, period_end date, updated_at timestamptz default now(), unique(corretor_id,feature_key,period_start));
    CREATE TABLE public.crm_etapas(id uuid primary key, corretor_id uuid not null, nome text);
    CREATE TABLE public.crm_oportunidades(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, cliente_id uuid, etapa_id uuid not null, titulo text not null, origem text, fechada_em timestamptz, updated_at timestamptz not null default now());
    CREATE TABLE public.fachadas(id uuid primary key, corretor_id uuid not null);
    CREATE TABLE public.fachada_leads(id uuid primary key default gen_random_uuid(), fachada_id uuid not null, nome text, telefone text, email text, convertido boolean default false, cliente_id uuid, created_at timestamptz default now());
    INSERT INTO corretores VALUES ('${owner}','${user}','Evandro'),('${other}','${otherUser}','Outra conta');
    INSERT INTO crm_etapas VALUES ('${stage}','${owner}','Novo lead'),('${laterStage}','${owner}','Visita agendada'),('${foreignStage}','${other}','De outra conta');
    INSERT INTO fachadas VALUES ('${facade}','${owner}'),('${foreignFacade}','${other}');
  `);
  for (const name of migrations) await db.exec(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
  channel = (await one<{ id: string }>(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone) VALUES ('${owner}','lotti-a',false,false,'${account}') returning id`)).id;
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec(`
    delete from lotti_manual_sends; delete from lotti_broadcast_campaigns; delete from lotti_agent_outbox; delete from lotti_agent_messages;
    delete from lotti_inbox_events; delete from lotti_agent_conversations; delete from lotti_agent_channels where archived_at is not null;
    update lotti_agent_channels set account_phone='${account}',account_bound_at=null where id='${channel}';
    delete from alertas; delete from crm_oportunidades; delete from fachada_leads; delete from clientes;`);
});

describe('um cliente por telefone em cada conta', () => {
  it('o banco recusa outro cliente com o mesmo número em qualquer formato, só dentro da mesma conta', async () => {
    const ana = await addClient('(62) 98123-4567', 'Ana');
    for (const telefone of ['5562981234567', '556281234567', '+55 62 9 8123-4567']) {
      await expect(addClient(telefone, 'Outra')).rejects.toMatchObject({ message: 'duplicate_client_phone', detail: ana });
    }
    await addClient('(62) 98123-4567', 'Da outra conta', other);
    // Fixo e celular com o mesmo final, outro DDD e cadastro sem telefone seguem livres.
    await addClient('(62) 3123-4567', 'Fixo');
    await addClient('(11) 98123-4567', 'Outro DDD');
    await addClient('', 'Sem telefone 1');
    await addClient('', 'Sem telefone 2');
    expect(await count('clientes where corretor_id=$1', [owner])).toBe(5);
  });

  it('duplicados antigos continuam editáveis; trocar para o número de outro cliente não', async () => {
    const a = await legacyClient('(62) 98123-4567', 'A');
    const b = await legacyClient('556281234567', 'B');
    await db.query(`update clientes set nome='A2',telefone='(62) 98123-4567',observacoes='x' where id=$1`, [a]);
    await db.query(`update clientes set telefone='62 98123 4567' where id=$1`, [a]);
    const c = await addClient('(62) 99999-0000', 'C');
    // O relógio do PGlite tem milissegundos: A e B podem empatar como o mais antigo.
    await expect(db.query(`update clientes set telefone='5562981234567' where id=$1`, [c])).rejects.toMatchObject({ message: 'duplicate_client_phone', detail: expect.stringMatching(`^(${a}|${b})$`) });
    await db.query(`update clientes set telefone='(62) 99999-1111' where id=$1`, [c]);
  });

  it('"Novo cliente" devolve o cliente que já tem o telefone e não grava nada', async () => {
    await ingest({ phone: '5562981234567', name: 'Paula' });
    const [paula] = await clients();
    const duplicate = await asUser<{ r: unknown }>(user, 'select public.crm_criar_cliente($1::jsonb) r',
      [JSON.stringify({ nome: 'Paula Souza', telefone: '(62) 98123-4567', email: 'paula@x.com' })]);
    expect(duplicate.r).toEqual({ status: 'duplicate', candidatos: [{ id: paula.id, nome: 'Paula', motivo: 'telefone' }] });
    expect(await clients()).toHaveLength(1);

    const created = await asUser<{ r: { status: string; cliente_id: string } }>(user, 'select public.crm_criar_cliente($1::jsonb) r', [JSON.stringify({
      nome: ' Rui ', telefone: '(62) 99111-0003', email: 'rui@x.com', tipo_interesse: 'LOCACAO', status_funil: 'QUALIFICACAO', observacoes: 'Indicação',
      tracking_data: { utm_source: 'instagram' }, ultimo_contato: '2026-09-28T12:00:00Z', corretor_id: other, rg: '123', created_at: 'ontem' })]);
    expect(created.r.status).toBe('created');
    expect(await one(`select corretor_id,nome,telefone,email,tipo_interesse::text,status_funil::text,observacoes,tracking_data,ultimo_contato=$2::timestamptz ultimo from clientes where id=$1`,
      [created.r.cliente_id, '2026-09-28T12:00:00Z'])).toEqual({ corretor_id: owner, nome: 'Rui', telefone: '(62) 99111-0003', email: 'rui@x.com',
      tipo_interesse: 'LOCACAO', status_funil: 'QUALIFICACAO', observacoes: 'Indicação', tracking_data: { utm_source: 'instagram' }, ultimo: true });
    const minimal = await asUser<{ r: { cliente_id: string } }>(user, 'select public.crm_criar_cliente($1::jsonb) r', [JSON.stringify({ nome: 'Sem telefone' })]);
    expect(await one('select telefone,tipo_interesse::text from clientes where id=$1', [minimal.r.cliente_id])).toEqual({ telefone: '', tipo_interesse: 'COMPRA' });

    await expect(asUser(user, 'select public.crm_criar_cliente($1::jsonb)', [JSON.stringify({ nome: ' ', telefone: '(62) 97777-0000' })])).rejects.toThrow(/invalid_name/);
    await expect(asUser(stranger, 'select public.crm_criar_cliente($1::jsonb)', [JSON.stringify({ nome: 'X', telefone: '(62) 97777-0000' })])).rejects.toThrow(/forbidden/);
  });

  it('busca de candidatos: telefone em qualquer formato, CPF e e-mail, só da própria conta', async () => {
    const ana = await addClient('556291110003', 'Ana');
    const bruno = await addClient('(62) 3333-4444', 'Bruno', owner, { cpf: '123.456.789-01', email: 'Bruno@Mail.com' });
    await addClient('(62) 99111-0003', 'De outra conta', other);
    expect(await candidates('(62) 99111-0003')).toEqual([{ id: ana, nome: 'Ana', motivo: 'telefone' }]);
    expect(await candidates('', ' bruno@mail.com ')).toEqual([{ id: bruno, nome: 'Bruno', motivo: 'email' }]);
    expect(await candidates(null, null, '12345678901')).toEqual([{ id: bruno, nome: 'Bruno', motivo: 'cpf' }]);
    expect(await candidates('5562991110003', 'bruno@mail.com', '123.456.789-01')).toEqual([
      { id: ana, nome: 'Ana', motivo: 'telefone' }, { id: bruno, nome: 'Bruno', motivo: 'cpf' }]);
    expect(await candidates('', '', '123')).toEqual([]);
    for (let i = 0; i < 6; i++) await addClient(`(62) 9700${i}-0000`, `Família ${i}`, owner, { email: 'familia@x.com' });
    expect(await candidates(null, 'familia@x.com')).toHaveLength(5);
    expect(await candidates('(62) 99111-0003', null, null, otherUser)).toEqual([expect.objectContaining({ nome: 'De outra conta' })]);
    await expect(candidates('(62) 99111-0003', null, null, stranger)).rejects.toThrow(/forbidden/);
  });

  it('captura do site atualiza o mesmo cliente em qualquer formato, sem trocar nome nem e-mail', async () => {
    const upsert = async (nome: string, telefone: string, email: string | null, tracking: Record<string, unknown>) =>
      (await one<{ r: { cliente_id: string; created: boolean } }>('select public.lead_capture_upsert_cliente($1,$2,$3,$4,$5::jsonb) r',
        [owner, nome, telefone, email, JSON.stringify(tracking)])).r;
    const carlos = await addClient('(62) 98123-4567', 'Carlos', owner, { email: 'carlos@x.com' });
    expect(await upsert('Outro Nome', '5562981234567', 'novo@x.com', { origem: 'site' })).toEqual({ cliente_id: carlos, created: false });
    expect(await one('select nome,email,tracking_data from clientes where id=$1', [carlos])).toEqual({
      nome: 'Carlos', email: 'carlos@x.com', tracking_data: { ultimo_retorno: { origem: 'site', email_informado: 'novo@x.com' } } });
    const ana = await addClient('556291110003', 'Ana');
    expect(await upsert('Ana', '(62) 99111-0003', null, {})).toEqual({ cliente_id: ana, created: false });

    const first = await upsert('Novo', '(62) 97777-0000', 'n@x.com', { utm_source: 'google' });
    expect(first.created).toBe(true);
    expect(await upsert('Novo', '62977770000', 'n@x.com', { utm_source: 'google' })).toEqual({ cliente_id: first.cliente_id, created: false });
    expect(await one('select nome,email,tipo_interesse::text,status_funil::text,tracking_data->>\'utm_source\' utm from clientes where id=$1', [first.cliente_id]))
      .toEqual({ nome: 'Novo', email: 'n@x.com', tipo_interesse: 'AMBOS', status_funil: 'QUALIFICACAO', utm: 'google' });
    expect(await clients()).toHaveLength(3);
  });

  it('captura ao vivo e "Nova conversa" do mesmo número geram um cliente, sob a trava da conta e do telefone', async () => {
    await ingest({ phone: '556281234567' });
    const [cv] = await conversations();
    expect(await start('(62) 98123-4567')).toBe(cv.id);
    expect(await clients()).toHaveLength(1);

    const held = await db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL request.jwt.claim.sub='${user}'; SET LOCAL ROLE authenticated`);
      await tx.query(`select public.lotti_inbox_start_conversation('(62) 95555-0000',null)`);
      await tx.exec('RESET ROLE');
      return {
        channel: (await tx.query<{ ok: boolean }>(LOCK, [channel, 715])).rows[0].ok,
        phone: (await tx.query<{ ok: boolean }>(LOCK, [`${owner}:62m55550000`, 716])).rows[0].ok,
      };
    });
    expect(held).toEqual({ channel: true, phone: true });
    expect(await clients()).toHaveLength(2);
  });

  it('várias mídias seguidas geram um alerta; depois de lido, a próxima gera outro', async () => {
    for (let i = 0; i < 4; i++) await ingest({ phone: '5562981234567', unsupported: true, text: '[Foto]' });
    const alerts = () => count('alertas where mensagem=$1', [media]);
    expect(await alerts()).toBe(1);
    await ingest({ phone: '5562981234567', unsupported: false, text: 'E aí?' });
    expect(await alerts()).toBe(1);
    await db.exec('update alertas set lido=true');
    await ingest({ phone: '5562981234567', unsupported: true, text: '[Áudio]' });
    await ingest({ phone: '5562981234567', unsupported: true, text: '[Áudio]' });
    expect(await alerts()).toBe(2);
    // Outra conversa tem o próprio alerta.
    await ingest({ phone: '5562977770000', unsupported: true, text: '[Foto]' });
    expect(await alerts()).toBe(3);
  });

  it('só o servidor usa o helper e a captura; a tela chama as RPCs próprias', async () => {
    const fns = {
      helper: 'public.lotti_find_or_create_cliente(uuid,text,text,jsonb,boolean)',
      candidatos: 'public.crm_candidatos_cliente(uuid,text,text,text)',
      captura: 'public.lead_capture_upsert_cliente(uuid,text,text,text,jsonb)',
      aberta: 'public.crm_oportunidade_aberta(uuid,uuid)',
      adotar: 'public.lotti_manual_adopt_remote(uuid,text)',
    };
    for (const fn of Object.values(fns)) {
      expect(await privilege('authenticated', fn)).toBe(false);
      expect(await privilege('anon', fn)).toBe(false);
      expect(await privilege('service_role', fn)).toBe(true);
    }
    for (const fn of ['public.crm_clientes_por_telefone(text,text,text)', 'public.crm_criar_cliente(jsonb)',
      'public.crm_converter_lead(uuid,uuid,jsonb,uuid)', 'public.lotti_inbox_merge_conversations(uuid,uuid)']) {
      expect(await privilege('authenticated', fn)).toBe(true);
      expect(await privilege('anon', fn)).toBe(false);
    }
  });
});

describe('conversão de lead da fachada', () => {
  it('converte uma vez só: clique duplo gera 1 cliente e 1 negócio', async () => {
    const l = await lead('(62) 98123-4567', 'Marina', 'marina@x.com');
    const dados = { nome: 'Marina', telefone: '(62) 98123-4567', email: 'marina@x.com' };
    const first = await convert(l, stage, dados);
    expect(first).toMatchObject({ status: 'converted', created: true });
    expect(await convert(l, stage, dados)).toEqual({ status: 'ja_convertido', cliente_id: first.cliente_id });
    expect(await one('select nome,telefone,email,tipo_interesse::text,observacoes from clientes')).toEqual({
      nome: 'Marina', telefone: '(62) 98123-4567', email: 'marina@x.com', tipo_interesse: 'COMPRA', observacoes: 'Convertido de lead da fachada.' });
    expect(await rows('select id,etapa_id,titulo,origem from crm_oportunidades')).toEqual([{ id: first.oportunidade_id, etapa_id: stage, titulo: 'Marina', origem: 'fachada' }]);
    expect(await one('select convertido,cliente_id from fachada_leads where id=$1', [l])).toEqual({ convertido: true, cliente_id: first.cliente_id });
  });

  it('telefone ou e-mail de um cliente existente: devolve o candidato e não grava nada', async () => {
    const ana = await addClient('556291110003', 'Ana');
    const l = await lead('(62) 99111-0003', 'Ana Lima');
    expect(await convert(l)).toEqual({ status: 'duplicate', candidatos: [{ id: ana, nome: 'Ana', motivo: 'telefone' }] });
    const bia = await addClient('(62) 97777-0000', 'Bia', owner, { email: 'bia@x.com' });
    const byEmail = await lead('(62) 96666-0000', 'Bia', 'BIA@x.com');
    expect(await convert(byEmail)).toEqual({ status: 'duplicate', candidatos: [{ id: bia, nome: 'Bia', motivo: 'email' }] });
    expect(await clients()).toHaveLength(2);
    expect(await count('crm_oportunidades')).toBe(0);
    expect(await count('fachada_leads where convertido')).toBe(0);
    // Vincular ao candidato resolve.
    expect(await convert(l, stage, {}, ana)).toMatchObject({ status: 'converted', cliente_id: ana, created: false });
  });

  it('vincular a um cliente com negócio aberto não abre outro nem volta a etapa; dois leads da mesma pessoa, um negócio', async () => {
    const ana = await addClient('(62) 98123-4567', 'Ana');
    const deal = (await one<{ id: string }>(`insert into crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo,origem) values($1,$2,$3,'Ana','whatsapp_ia') returning id`, [owner, ana, laterStage])).id;
    const first = await convert(await lead('(62) 98123-4567', 'Ana'), stage, {}, ana);
    const second = await convert(await lead('62981234567', 'Ana L.'), stage, {}, ana);
    expect(first).toEqual({ status: 'converted', cliente_id: ana, created: false, oportunidade_id: deal });
    expect(second).toEqual(first);
    expect(await openDeals(ana)).toEqual([{ id: deal, etapa_id: laterStage, origem: 'whatsapp_ia' }]);
    expect(await count('fachada_leads where convertido and cliente_id=$1', [ana])).toBe(2);
  });

  it('etapa de outra conta falha sem deixar cliente nem lead convertido', async () => {
    const l = await lead('(62) 95555-0000', 'Leo');
    await expect(convert(l, foreignStage, { nome: 'Leo', telefone: '(62) 95555-0000' })).rejects.toThrow(/invalid_stage/);
    expect(await clients()).toHaveLength(0);
    expect(await one('select convertido from fachada_leads where id=$1', [l])).toEqual({ convertido: false });
  });

  it('lead de outra conta, cliente de outra conta e usuário sem conta: proibido', async () => {
    await expect(convert(await lead('(62) 95555-1111', 'X', null, foreignFacade))).rejects.toThrow(/forbidden/);
    const l = await lead('(62) 95555-2222', 'Y');
    await expect(convert(l, stage, {}, await addClient('(62) 94444-0000', 'Outro', other))).rejects.toThrow(/forbidden/);
    await expect(convert(l, stage, {}, null, stranger)).rejects.toThrow(/forbidden/);
    expect(await count('fachada_leads where convertido')).toBe(0);
  });

  it('funil antigo (sem etapa) cria o cliente sem negócio', async () => {
    const l = await lead('(62) 95555-3333', 'Leo');
    const result = await convert(l, null, { nome: 'Leo Souza', telefone: '(62) 95555-3333', status_funil: 'VISITA_PROPOSTA' });
    expect(result).toMatchObject({ status: 'converted', created: true, oportunidade_id: null });
    expect(await one('select nome,status_funil::text from clientes where id=$1', [result.cliente_id])).toEqual({ nome: 'Leo Souza', status_funil: 'VISITA_PROPOSTA' });
    expect(await count('crm_oportunidades')).toBe(0);
  });
});

describe('negócio aberto reaproveitado pela IA', () => {
  const handoff = async (phone: string, etapa: string) => {
    const [cv] = await conversations(`c.phone='${phone}'`);
    await db.query('update lotti_agent_conversations set processed_revision=revision where id=$1', [cv.id]);
    const { revision } = await one<{ revision: number }>('select revision from lotti_agent_conversations where id=$1', [cv.id]);
    expect((await one<{ r: boolean }>('select public.lotti_agent_handoff($1,null,$2,null,$3,false) r', [cv.id, revision, etapa])).r).toBe(true);
    return cv;
  };

  it('transferência da IA seguida de "Vincular" deixa um negócio aberto', async () => {
    await ingest({ phone: '5562981234567', name: 'Paula' });
    const cv = await handoff('5562981234567', stage);
    const [deal] = await openDeals(cv.cliente_id!);
    expect(deal).toMatchObject({ etapa_id: stage, origem: 'whatsapp_ia' });
    const l = await lead('(62) 98123-4567', 'Paula');
    expect(await convert(l)).toMatchObject({ status: 'duplicate' });
    expect(await convert(l, stage, {}, cv.cliente_id)).toMatchObject({ oportunidade_id: deal.id });
    expect(await openDeals(cv.cliente_id!)).toHaveLength(1);
    expect(await one<{ ok: boolean }>(`select (select count(*) from crm_oportunidades)=1 ok`)).toEqual({ ok: true });
  });

  it('cliente duplicado herdado: a IA move o negócio que já existe e avisa uma vez', async () => {
    const ana = await addClient('(62) 99111-0003', 'Ana');
    const deal = (await one<{ id: string }>(`insert into crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo,origem) values($1,$2,$3,'Ana','fachada') returning id`, [owner, ana, stage])).id;
    const twin = await legacyClient('5562991110003');
    await ingest({ phone: '5562991110003' });
    const [cv] = await conversations();
    await db.query('update lotti_agent_conversations set cliente_id=$1 where id=$2', [twin, cv.id]);
    for (const etapa of [laterStage, laterStage, stage]) {
      expect((await one<{ r: boolean }>('select public.lotti_agent_move_stage($1,$2) r', [cv.id, etapa])).r).toBe(true);
    }
    expect(await rows('select id,cliente_id,etapa_id from crm_oportunidades where fechada_em is null')).toEqual([{ id: deal, cliente_id: ana, etapa_id: stage }]);
    expect(await rows('select cliente_id,entidade_id,metadata->>\'outro_cliente_id\' outro from alertas where mensagem like \'Possível cliente duplicado%\''))
      .toEqual([{ cliente_id: twin, entidade_id: twin, outro: ana }]);
  });

  it('mais de um cadastro com negócio aberto: não escolhe, abre o do cliente da conversa', async () => {
    for (const nome of ['A', 'B']) {
      const id = await legacyClient('(62) 99111-0003', nome);
      await db.query(`insert into crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo) values($1,$2,$3,$4)`, [owner, id, stage, nome]);
    }
    const twin = await legacyClient('5562991110003');
    await ingest({ phone: '5562991110003' });
    const [cv] = await conversations();
    await db.query('update lotti_agent_conversations set cliente_id=$1 where id=$2', [twin, cv.id]);
    await db.query('select public.lotti_agent_move_stage($1,$2)', [cv.id, laterStage]);
    expect(await openDeals(twin)).toEqual([expect.objectContaining({ etapa_id: laterStage, origem: 'whatsapp_ia' })]);
    expect(await count('crm_oportunidades where etapa_id=$1', [stage])).toBe(2);
  });

  it('o negócio aberto é procurado sob a trava do cliente', async () => {
    const ana = await addClient('(62) 98123-4567', 'Ana');
    const held = await db.transaction(async (tx) => {
      await tx.query('select public.crm_oportunidade_aberta($1,$2)', [owner, ana]);
      return (await tx.query<{ ok: boolean }>(LOCK, [ana, 717])).rows[0].ok;
    });
    expect(held).toBe(true);
  });
});

describe('uma conversa por linha no canal', () => {
  it('"Nova conversa" seguida da resposta com o JID de 12 dígitos: uma conversa só', async () => {
    const id = await start('(62) 98123-4567', 'Paula');
    await ingest({ phone: '556281234567', lid, name: 'Paula' });
    expect(await conversations()).toEqual([expect.objectContaining({ id, phone: '556281234567', lid, mode: 'human' })]);
    expect(await clients()).toHaveLength(1);
  });

  it('mensagem primeiro e "Nova conversa" depois: a mesma conversa, com o número do WhatsApp', async () => {
    await ingest({ phone: '556281234567', lid });
    const [cv] = await conversations();
    expect(await start('(62) 98123-4567', 'Paula')).toBe(cv.id);
    expect(await conversations()).toEqual([expect.objectContaining({ id: cv.id, phone: '556281234567', lid })]);
    expect(await clients()).toMatchObject([{ nome: 'Paula', telefone: '556281234567' }]);
  });

  it('eco do envio manual com o outro formato cai na mesma conversa, uma vez', async () => {
    const id = await start('(62) 98123-4567');
    await manualSent(id, 'X1');
    expect(await ingest({ phone: '556281234567', external_id: 'X1', from_me: true, text: 'Olá' })).toMatchObject({ accepted: true, duplicate: true });
    await ingest({ phone: '556281234567', external_id: 'R1', text: 'Oi, tudo bem?' });
    expect(await conversations()).toHaveLength(1);
    expect(await messagesOf(id)).toEqual(['R1', 'X1']);
  });

  it('número estrangeiro, fixo e outro DDD não se juntam a um celular', async () => {
    for (const phone of ['79991234567', '5579991234567', '14155551234', '556232345678', '5562932345678', '5562981234567', '5511981234567']) {
      await ingest({ phone });
    }
    expect((await conversations()).map((c) => c.phone)).toEqual(
      ['14155551234', '5511981234567', '556232345678', '5562932345678', '5562981234567', '5579991234567', '79991234567']);
  });

  it('o banco recusa outra conversa ativa da mesma linha', async () => {
    await ingest({ phone: '5562981234567' });
    const [cv] = await conversations();
    const insert = (phone: string | null, lidValue: string | null = null) => db.query(
      'insert into lotti_agent_conversations(channel_id,corretor_id,phone,lid) values($1,$2,$3,$4)', [channel, owner, phone, lidValue]);
    await expect(insert('556281234567')).rejects.toMatchObject({ message: 'duplicate_conversation_phone', detail: cv.id });
    await expect(insert('5562981234567')).rejects.toMatchObject({ message: 'duplicate_conversation_phone', detail: cv.id });
    await insert(null, '987654321098765');
    await insert('5562981234568');
  });

  it('editar o contato com o outro formato do mesmo número só troca o nome', async () => {
    await ingest({ phone: '556281234567' });
    const [cv] = await conversations();
    expect(await rename(cv.id, 'Paula', '(62) 98123-4567')).toEqual({ name: 'Paula', phone: '556281234567' });
    expect(await conversations()).toEqual([expect.objectContaining({ phone: '556281234567', contact_name: 'Paula' })]);
    await ingest({ phone: '5562981234567' });
    expect(await conversations()).toHaveLength(1);
  });

  it('número de outra conversa: recusa com o id dela e "Unir conversas" junta as mensagens', async () => {
    await ingest({ phone: '5562981234567', external_id: 'in-1' });
    const [withReply] = await conversations();
    const manual = await start('(62) 97777-0000', 'Paula');
    await db.query(`insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content) values($1,'out-1','out','human','Olá')`, [manual]);
    for (const phone of ['(62) 98123-4567', '556281234567', '5562981234567']) {
      await expect(rename(manual, 'Paula', phone)).rejects.toMatchObject({ message: 'phone_in_other_conversation', detail: withReply.id });
    }
    // A que já ouviu o contato fica, qualquer que seja a ordem pedida.
    expect(await merge(manual, withReply.id)).toEqual({ conversation_id: withReply.id, merged_id: manual });
    expect(await conversations()).toEqual([expect.objectContaining({ id: withReply.id, phone: '5562981234567' })]);
    expect(await messagesOf(withReply.id)).toEqual(['in-1', 'out-1']);
  });

  it('"Unir conversas": só o dono, sem entrega em andamento e nunca dois LIDs', async () => {
    await ingest({ phone: '5562981234567' });
    const [kept] = await conversations();
    const manual = await start('(62) 97777-0000');
    await expect(merge(manual, kept.id, otherUser)).rejects.toThrow(/forbidden/);
    await expect(merge(manual, manual)).rejects.toThrow(/invalid_merge/);
    await db.query(`insert into lotti_agent_outbox(conversation_id,revision,content,status) values($1,1,'Oi','sending')`, [manual]);
    await expect(merge(kept.id, manual)).rejects.toThrow(/delivery_pending/);
    await ingest({ lid: '111111111111111' });
    await ingest({ lid: '222222222222222' });
    const [first, second] = await conversations('c.phone is null');
    await expect(merge(first.id, second.id)).rejects.toThrow(/different_contacts/);
    expect(await conversations()).toHaveLength(4);
  });

  it('editar para o telefone de outro cliente liga a conversa a ele sem sobrescrever cadastros', async () => {
    const bruno = await addClient('(62) 97777-0000', 'Bruno');
    const placeholder = await addClient('(62) 96666-0000', 'Contato WhatsApp');
    await ingest({ phone: '5562981234567', name: 'Ana' });
    const [cv] = await conversations();
    expect(await rename(cv.id, 'Bruno Lima', '(62) 97777-0000')).toEqual({ name: 'Bruno Lima', phone: '5562977770000', cliente_id: bruno, relinked: true });
    expect(await conversations()).toEqual([expect.objectContaining({ phone: '5562977770000', cliente_id: bruno, contact_name: 'Bruno Lima' })]);
    expect((await clients()).map((c) => [c.nome, c.telefone]).sort()).toEqual([['Ana', '5562981234567'], ['Bruno', '(62) 97777-0000'], ['Contato WhatsApp', '(62) 96666-0000']]);
    expect(await rename(cv.id, 'Carla', '(62) 96666-0000')).toMatchObject({ cliente_id: placeholder, relinked: true });
    expect(await one('select nome from clientes where id=$1', [placeholder])).toEqual({ nome: 'Carla' });
    // Sem outro cliente com o número, o cliente da conversa recebe o número, como antes.
    expect(await rename(cv.id, 'Carla', '(62) 95555-0000')).toEqual({ name: 'Carla', phone: '5562955550000' });
    expect(await one('select telefone from clientes where id=$1', [placeholder])).toEqual({ telefone: '5562955550000' });
  });

  it('envio manual adota o número que o WhatsApp usou, sem unir conversas', async () => {
    const id = await start('(62) 98123-4567');
    const request = await manualSent(id, 'X1');
    const adopt = async (remote: string, req = request) => (await one<{ r: boolean }>('select public.lotti_manual_adopt_remote($1,$2) r', [req, remote])).r;
    expect(await adopt('556281234567')).toBe(true);
    expect(await conversations()).toEqual([expect.objectContaining({ id, phone: '556281234567' })]);
    expect(await adopt('556281234567')).toBe(false);
    expect(await adopt('5511981234567')).toBe(false);
    expect(await adopt('556281234567', uuid())).toBe(false);
    await expect(adopt('abc')).rejects.toThrow(/invalid_phone/);
    // Par antigo das duas grafias: fica para a limpeza ou para "Unir conversas".
    await db.exec('alter table lotti_agent_conversations disable trigger lotti_agent_conversation_phone_guard');
    try { await db.query('insert into lotti_agent_conversations(channel_id,corretor_id,phone) values($1,$2,$3)', [channel, owner, '5562981234567']); }
    finally { await db.exec('alter table lotti_agent_conversations enable trigger lotti_agent_conversation_phone_guard'); }
    expect(await adopt('5562981234567')).toBe(false);
    expect((await conversations()).map((c) => c.phone)).toEqual(['556281234567', '5562981234567']);
  });
});

describe('número que volta ao canal e opt-out repetido', () => {
  it('A → B → A devolve as conversas de A com opt-out e atendimento humano, sem duplicar', async () => {
    await ingest({ phone: '5562981234567', text: 'Oi' });
    await ingest({ phone: '5562981234567', text: 'SAIR' });
    const [before] = await conversations();
    expect(before).toMatchObject({ mode: 'human', opted_out_at: expect.anything() });

    await ingest({ phone: '5511911110000', account: '5562900000002' });
    expect((await conversations()).map((c) => c.phone)).toEqual(['5511911110000']);
    expect((await one<{ bound: string | null }>('select account_bound_at bound from lotti_agent_channels where id=$1', [channel])).bound).not.toBeNull();

    await ingest({ phone: '5511922220000', account });
    expect((await conversations()).map((c) => c.phone)).toEqual(['5511922220000', '5562981234567']);
    expect((await conversations(`c.phone='5562981234567'`))[0]).toMatchObject({ id: before.id, mode: 'human', opted_out_at: before.opted_out_at });
    expect(await count(`lotti_agent_conversations where phone='5562981234567'`)).toBe(1);
    expect(await count(`lotti_agent_conversations c join lotti_agent_channels h on h.id=c.channel_id where h.archived_at is not null and c.archived_at is not null`)).toBe(1);
    // O opt-out continua valendo para o envio manual.
    await expect(db.query(`select public.lotti_manual_begin($1,$2,$3,'fp','Olá',null)`, [owner, before.id, uuid()])).rejects.toThrow(/contact_opted_out/);
  });

  it('as conversas devolvidas não retomam trabalho automático de antes da troca', async () => {
    await ingest({ phone: '5562981234567', text: 'Quero alugar' });
    const [cv] = await conversations();
    await db.query(`update lotti_agent_conversations set mode='ai',followup_due_at=now() where id=$1`, [cv.id]);
    await ingest({ phone: '5511911110000', account: '5562900000002' });
    await ingest({ phone: '5511922220000', account });
    expect(await one('select mode,revision=processed_revision handled,followup_due_at from lotti_agent_conversations where id=$1', [cv.id]))
      .toEqual({ mode: 'ai', handled: true, followup_due_at: null });
  });

  it('pedido de saída repetido não gera outro evento nem outro alerta', async () => {
    // Conversa sem mensagens: as de teste têm horário no passado.
    const cv = { id: await start('(62) 98123-4567') };
    const say = (text: string, minutesAgo: number) => db.query(
      `insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content,created_at) values($1,$2,'in','lead',$3,now()-make_interval(mins=>$4))`,
      [cv.id, `o${++counter}`, text, minutesAgo]);
    const events = () => count(`lotti_inbox_events where conversation_id=$1 and kind='consent' and to_label=$2`, [cv.id, optOutEvent]);
    const alerts = () => count(`alertas where metadata->>'conversation_id'=$1 and mensagem like 'Contato pediu%'`, [cv.id]);

    await say('SAIR', 50);
    await say('pare', 40);
    expect([await events(), await alerts()]).toEqual([1, 1]);
    const latest = await one<{ ok: boolean }>(`select opted_out_at=(select max(created_at) from lotti_agent_messages where conversation_id=$1) ok from lotti_agent_conversations where id=$1`, [cv.id]);
    expect(latest.ok).toBe(true);

    await say('oi, mudei de ideia', 30);
    await say('sair', 20);
    expect([await events(), await alerts()]).toEqual([2, 2]);

    expect((await asUser<{ r: boolean }>(user, 'select public.lotti_inbox_clear_opt_out($1) r', [cv.id])).r).toBe(true);
    await say('sair', 10);
    expect(await events()).toBe(3);
  });
});
