import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const migration = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('conversas com número oculto pelo WhatsApp (LID)', () => {
  let db: PGlite;
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const user = '11111111-1111-4111-8111-111111111111';
  const lid = '123456789012345';
  const ingest = (event: Record<string, unknown>) =>
    db.query<{ r: Record<string, unknown> }>('select public.lotti_agent_ingest($1::jsonb) r', [JSON.stringify({ instance: 'lotti-agent', text: 'Oi', from_me: false, unsupported: false, ...event })]);
  const importHistory = (messages: Record<string, unknown>[]) =>
    db.query<{ r: { imported: number } }>('select public.lotti_agent_import_history($1,$2::jsonb) r', ['lotti-agent', JSON.stringify(messages)]);
  const conversation = async (where: string) => (await db.query<{ id: string; phone: string | null; lid: string | null; cliente_id: string | null; contact_name: string | null; updated_at: string; mode: string; status: string; qualification: Record<string, unknown>; notified_stage: string | null }>(
    `select c.id,c.phone,c.lid,c.cliente_id,c.contact_name,c.updated_at,c.mode,c.status,c.qualification,c.notified_stage from lotti_agent_conversations c join lotti_agent_channels h on h.id=c.channel_id where h.instance='lotti-agent' and ${where}`)).rows;
  const messagesOf = async (id: string) => (await db.query<{ external_id: string }>(
    'select external_id from lotti_agent_messages where conversation_id=$1 order by external_id', [id])).rows.map((row) => row.external_id);
  const asBroker = async <T,>(work: () => Promise<T>) => {
    await db.exec(`SET request.jwt.claim.sub='${user}'; SET ROLE authenticated`);
    try { return await work(); } finally { await db.exec('RESET ROLE'); }
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE public.corretores(id uuid primary key, user_id uuid not null, nome text);
      CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, email text, status_funil text, tipo_interesse text, created_at timestamptz default now());
      CREATE TYPE public.direcao_contato AS ENUM ('IN','OUT');
      CREATE TABLE public.historico_contatos(id uuid primary key default gen_random_uuid(), cliente_id uuid, tipo text, direcao public.direcao_contato, conteudo text, metadata jsonb);
      CREATE TABLE public.alertas(id uuid primary key default gen_random_uuid(), corretor_id uuid, cliente_id uuid, tipo text, mensagem text, metadata jsonb, origem text, entidade_tipo text, entidade_id uuid, lido boolean default false);
      CREATE TABLE public.crm_etapas(id uuid primary key, corretor_id uuid not null, nome text);
      CREATE TABLE public.crm_oportunidades(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, cliente_id uuid, etapa_id uuid not null, titulo text not null, origem text, fechada_em timestamptz, updated_at timestamptz not null default now());
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
    // Ordem da produção, até as de 2026-09-29 (uma conversa por linha no canal).
    for (const name of [
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
    ]) await db.exec(migration(name));
    await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox) VALUES ('${owner}','lotti-agent',true,false)`);
  }, 60_000);
  afterAll(async () => db?.close());

  it('guarda a conversa só com o LID, sem inventar telefone nem criar cliente', async () => {
    const result = await ingest({ lid, external_id: 'lid-1', name: 'Paula' });
    expect(result.rows[0].r.accepted).toBe(true);
    const [row] = await conversation(`c.lid='${lid}'`);
    expect(row).toMatchObject({ phone: null, lid, cliente_id: null, contact_name: 'Paula' });
    expect(await messagesOf(row.id)).toEqual(['lid-1']);
    expect((await db.query(`select count(*)::int n from clientes`)).rows[0]).toEqual({ n: 0 });
  });

  it('recusa conversa sem telefone e sem LID', async () => {
    await expect(ingest({ external_id: 'nada' })).rejects.toThrow(/invalid_contact/);
    await expect(ingest({ lid: 'abc', external_id: 'lid-invalido' })).rejects.toThrow(/invalid_contact/);
    await expect(db.exec(`insert into lotti_agent_conversations(channel_id,corretor_id) select id,corretor_id from lotti_agent_channels limit 1`)).rejects.toThrow(/lotti_agent_conversation_contact_check/);
  });

  it('completa o telefone na mesma conversa quando o WhatsApp revela o número', async () => {
    const [before] = await conversation(`c.lid='${lid}'`);
    await ingest({ lid, phone: '5511911112222', external_id: 'lid-2', name: 'Paula' });
    const [after] = await conversation(`c.lid='${lid}'`);
    expect(after.id).toBe(before.id);
    expect(after.phone).toBe('5511911112222');
    expect(after.cliente_id).not.toBeNull();
    expect(await messagesOf(after.id)).toEqual(['lid-1', 'lid-2']);
  });

  it('une a conversa do LID à conversa que já existia pelo telefone', async () => {
    await ingest({ phone: '5511933334444', external_id: 'tel-1', name: 'Rui' });
    await ingest({ lid: '987654321098765', external_id: 'oculto-1' });
    await ingest({ lid: '987654321098765', external_id: 'tel-1' });
    const [hidden] = await conversation(`c.lid='987654321098765'`);
    await db.exec(`insert into lotti_manual_sends(request_id,conversation_id,corretor_id,fingerprint,content,status) values('22222222-2222-4222-8222-222222222222','${hidden.id}','${owner}','f','Oi','sent')`);

    await ingest({ lid: '987654321098765', phone: '5511933334444', external_id: 'tel-2' });

    const rows = await conversation(`(c.phone='5511933334444' or c.lid='987654321098765')`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phone: '5511933334444', lid: '987654321098765', contact_name: 'Rui' });
    expect(await messagesOf(rows[0].id)).toEqual(['oculto-1', 'tel-1', 'tel-2']);
    expect((await db.query(`select conversation_id from lotti_manual_sends where request_id='22222222-2222-4222-8222-222222222222'`)).rows).toEqual([{ conversation_id: rows[0].id }]);
  });

  it('união preserva atendimento humano, conversa aberta, qualificação e alerta já enviado', async () => {
    await ingest({ phone: '5511944445555', external_id: 'q-tel-1' });
    await ingest({ lid: '321321321321321', external_id: 'q-lid-1' });
    await db.exec(`update lotti_agent_conversations set mode='ai',status='closed' where phone='5511944445555'`);
    await db.exec(`update lotti_agent_conversations set mode='human',status='open',qualification='{"stage":"qualificado_busca"}',notified_stage='qualificado_busca' where lid='321321321321321'`);

    await ingest({ lid: '321321321321321', phone: '5511944445555', external_id: 'q-2', from_me: true });

    const [row] = await conversation(`c.phone='5511944445555'`);
    expect(row).toMatchObject({ lid: '321321321321321', mode: 'human', status: 'open', qualification: { stage: 'qualificado_busca' }, notified_stage: 'qualificado_busca' });
  });

  it('adia a união enquanto a conversa do LID tem uma resposta automática em envio', async () => {
    await ingest({ phone: '5511955556666', external_id: 'o-tel-1' });
    await ingest({ lid: '654654654654654', external_id: 'o-lid-1' });
    const [hidden] = await conversation(`c.lid='654654654654654'`);
    await db.exec(`insert into lotti_agent_outbox(conversation_id,revision,content,status) values('${hidden.id}',1,'Resposta','sending')`);

    await ingest({ lid: '654654654654654', phone: '5511955556666', external_id: 'o-2' });
    expect(await conversation(`(c.phone='5511955556666' or c.lid='654654654654654')`)).toHaveLength(2);
    expect((await db.query(`select status from lotti_agent_outbox where conversation_id='${hidden.id}'`)).rows).toEqual([{ status: 'sending' }]);

    await db.exec(`update lotti_agent_outbox set status='sent' where conversation_id='${hidden.id}'`);
    await ingest({ lid: '654654654654654', phone: '5511955556666', external_id: 'o-3' });
    expect(await conversation(`(c.phone='5511955556666' or c.lid='654654654654654')`)).toHaveLength(1);
  });

  it('histórico aceita conversas só com LID e mantém a data antiga', async () => {
    const result = await importHistory([
      { external_id: 'h-lid-1', lid: '555555555555555', from_me: false, text: 'Oi', created_at: '2026-08-01T12:00:00Z', name: 'Bia' },
      { external_id: 'h-lid-2', lid: '555555555555555', from_me: true, text: 'Olá', created_at: '2026-08-01T12:05:00Z' },
    ]);
    expect(result.rows[0].r.imported).toBe(2);
    const [row] = await conversation(`c.lid='555555555555555'`);
    expect(row).toMatchObject({ phone: null, contact_name: 'Bia' });
    expect(new Date(row.updated_at).toISOString()).toBe('2026-08-01T12:05:00.000Z');
  });

  it('mensagem antiga do histórico não reabre conversa fechada; mensagem nova reabre', async () => {
    const [row] = await conversation(`c.lid='555555555555555'`);
    await db.exec(`update lotti_agent_conversations set status='closed' where id='${row.id}'`);
    await importHistory([{ external_id: 'h-lid-3', lid: '555555555555555', from_me: false, text: 'Antiga', created_at: '2026-08-02T12:00:00Z' }]);
    expect((await db.query(`select status from lotti_agent_conversations where id='${row.id}'`)).rows[0]).toEqual({ status: 'closed' });
    await ingest({ lid: '555555555555555', external_id: 'agora-1' });
    expect((await db.query(`select status from lotti_agent_conversations where id='${row.id}'`)).rows[0]).toEqual({ status: 'open' });
  });

  it('ao conectar, todo contato que já existia fica em atendimento humano', async () => {
    await importHistory([{ external_id: 'h-novo-1', lid: '888888888888888', from_me: false, text: 'Oi', created_at: '2026-08-20T12:00:00Z' }]);
    expect((await conversation(`c.lid='888888888888888'`))[0].mode).toBe('human');
    // Escreveu logo depois de conectar, antes de o histórico dele chegar.
    await ingest({ lid: '777777777777777', external_id: 'ao-vivo-1', text: 'Oi, tudo bem?' });
    const [live] = await conversation(`c.lid='777777777777777'`);
    expect(live.mode).toBe('ai');
    await db.exec(`insert into lotti_agent_outbox(conversation_id,revision,content) values('${live.id}',1,'Olá!')`);
    await importHistory([{ external_id: 'h-antiga-1', lid: '777777777777777', from_me: false, text: 'Mensagem do mês passado', created_at: '2026-08-20T12:00:00Z' }]);
    expect((await conversation(`c.lid='777777777777777'`))[0].mode).toBe('human');
    expect((await db.query(`select status from lotti_agent_outbox where conversation_id='${live.id}'`)).rows).toEqual([{ status: 'cancelled' }]);
    // Reenviar o mesmo histórico (reinício da ponte) não tira da IA quem o corretor religou.
    await db.exec(`update lotti_agent_conversations set mode='ai' where id='${live.id}'`);
    await importHistory([{ external_id: 'h-antiga-1', lid: '777777777777777', from_me: false, text: 'Mensagem do mês passado', created_at: '2026-08-20T12:00:00Z' }]);
    expect((await conversation(`c.lid='777777777777777'`))[0].mode).toBe('ai');
  });

  it('histórico recusa item sem telefone e sem LID válido', async () => {
    await expect(importHistory([{ external_id: 'h-x', from_me: false, text: 'Oi', created_at: '2026-08-01T12:00:00Z' }])).rejects.toThrow(/invalid_history_message/);
    await expect(importHistory([{ external_id: 'h-y', lid: '12', from_me: false, text: 'Oi', created_at: '2026-08-01T12:00:00Z' }])).rejects.toThrow(/invalid_history_message/);
  });

  it('envio manual devolve o LID para a ponte responder pelo WhatsApp', async () => {
    const [row] = await conversation(`c.lid='555555555555555'`);
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.lotti_manual_begin('${owner}','${row.id}','33333333-3333-4333-8333-333333333333','f','Oi',null) r`);
    expect(rows[0].r).toMatchObject({ status: 'ready', phone: null, lid: '555555555555555' });
    await db.query(`select public.lotti_manual_finish('33333333-3333-4333-8333-333333333333','sent','ext-1')`);
  });

  it('corretor renomeia conversa sem número e sem cliente, mantendo o número oculto', async () => {
    const [row] = await conversation(`c.lid='555555555555555'`);
    const { rows } = await asBroker(() => db.query<{ r: Record<string, unknown> }>(`select public.lotti_inbox_update_contact('${row.id}','Beatriz','') r`));
    expect(rows[0].r).toEqual({ name: 'Beatriz', phone: null });
    expect((await conversation(`c.id='${row.id}'`))[0]).toMatchObject({ contact_name: 'Beatriz', phone: null, lid: '555555555555555' });
  });

  it('número de conversa identificada pelo WhatsApp não pode ser digitado pelo corretor', async () => {
    const [hidden] = await conversation(`c.lid='555555555555555'`);
    const [revealed] = await conversation(`c.lid='${lid}'`);
    await asBroker(async () => {
      await expect(db.query(`select public.lotti_inbox_update_contact('${hidden.id}','Beatriz','(11) 97777-6666')`)).rejects.toThrow(/phone_managed_by_whatsapp/);
      await expect(db.query(`select public.lotti_inbox_update_contact('${revealed.id}','Paula','(11) 97777-6666')`)).rejects.toThrow(/phone_managed_by_whatsapp/);
      await db.query(`select public.lotti_inbox_update_contact('${revealed.id}','Paula Lima','5511911112222')`);
    });
    expect((await conversation(`c.id='${hidden.id}'`))[0]).toMatchObject({ phone: null });
    expect((await conversation(`c.id='${revealed.id}'`))[0]).toMatchObject({ phone: '5511911112222', contact_name: 'Paula Lima' });
  });

  it('fila automática identifica o destino pelo LID quando não há telefone', async () => {
    await db.exec(`INSERT INTO lotti_agent_channels(corretor_id,instance,enabled,sandbox) VALUES ('${owner}','lotti-sandbox',true,true)`);
    await db.exec(`insert into lotti_agent_conversations(channel_id,corretor_id,lid,mode,revision,processed_revision,next_attempt_at)
      select id,corretor_id,'444444444444444','ai',1,0,now()-interval '2 minutes' from lotti_agent_channels where instance='lotti-sandbox'`);
    const { rows } = await db.query<{ r: Record<string, unknown> }>('select public.lotti_agent_claim() r');
    expect(rows[0].r).toMatchObject({ phone: null, lid: '444444444444444', instance: 'lotti-sandbox' });
  });

  it('cota de IA conta o contato uma vez, antes e depois do número aparecer', async () => {
    await db.exec(`update lotti_agent_conversations set mode='human'`);
    await ingest({ lid: '777777777777777', external_id: 'cota-1' });
    const claimable = `update lotti_agent_conversations set mode='ai',revision=revision+1,next_attempt_at=now()-interval '1 minute',lease_until=null,lease_token=null where lid='777777777777777'`;
    const used = async () => (await db.query<{ n: number }>(`select coalesce(sum(used_quantity),0)::int n from usage_counters`)).rows[0].n;
    await db.exec(claimable);
    await db.query('select public.lotti_agent_claim()');
    expect(await used()).toBe(1);

    await ingest({ lid: '777777777777777', phone: '5511977770000', external_id: 'cota-2' });
    await db.exec(claimable);
    await db.query('select public.lotti_agent_claim()');
    expect(await used()).toBe(1);
  });
});
