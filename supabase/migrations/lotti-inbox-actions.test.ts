import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

describe('ações persistentes do Inbox', () => {
  let db: PGlite;
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const channelA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE public.corretores(id uuid primary key, user_id uuid not null);
      CREATE TABLE public.clientes(id uuid primary key default gen_random_uuid(), corretor_id uuid not null, nome text not null, telefone text not null, status_funil text, tipo_interesse text, created_at timestamptz default now());
      CREATE TABLE public.lotti_agent_channels(id uuid primary key, corretor_id uuid not null, instance text not null, enabled boolean not null default true, sandbox boolean not null default false);
      CREATE TABLE public.lotti_agent_conversations(id uuid primary key default gen_random_uuid(), channel_id uuid not null, corretor_id uuid not null, cliente_id uuid, phone text not null, mode text not null default 'ai', revision bigint not null default 0, updated_at timestamptz default now(), unique(channel_id,phone));
      CREATE TABLE public.lotti_agent_messages(id uuid primary key default gen_random_uuid(), conversation_id uuid not null, external_id text not null, direction text not null, sender text not null, content text not null, created_at timestamptz default now());
      INSERT INTO corretores VALUES ('${ownerA}','${userA}'),('${ownerB}','${userB}');
      INSERT INTO lotti_agent_channels VALUES ('${channelA}','${ownerA}','a',true,false);
    `);
    await db.exec(readFileSync(new URL('./20260921130000_lotti_inbox_actions.sql', import.meta.url), 'utf8'));
  }, 30_000);
  afterAll(async () => db?.close());
  async function asUser(user: string, sql: string) {
    await db.exec(`SET request.jwt.claim.sub='${user}'`);
    return db.query(sql);
  }

  it('cria e reutiliza cliente e conversa do usuário', async () => {
    const first = await asUser(userA, "select public.lotti_inbox_start_conversation('(62) 99999-9999','Maria') id");
    const again = await asUser(userA, "select public.lotti_inbox_start_conversation('5562999999999','Maria') id");
    expect(again.rows[0].id).toBe(first.rows[0].id);
    await expect(asUser(userB, `select public.lotti_inbox_rename_client('${first.rows[0].id}','Outro')`)).rejects.toThrow(/forbidden/);
  });

  it('renomeia, fecha e reabre ao receber mensagem', async () => {
    const created = await asUser(userA, "select public.lotti_inbox_start_conversation('5562888888888','Ana') id");
    const id = created.rows[0].id as string;
    expect((await asUser(userA, `select public.lotti_inbox_rename_client('${id}','Ana Paula') nome`)).rows[0].nome).toBe('Ana Paula');
    expect((await asUser(userA, `select public.lotti_inbox_set_status('${id}','closed') status`)).rows[0].status).toBe('closed');
    await db.exec(`insert into lotti_agent_messages(conversation_id,external_id,direction,sender,content) values('${id}','m1','in','lead','oi')`);
    expect((await db.query(`select status from lotti_agent_conversations where id='${id}'`)).rows[0].status).toBe('open');
  });
});
