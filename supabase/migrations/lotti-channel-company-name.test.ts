import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.corretores(id uuid primary key, user_id uuid not null);
    create table public.lotti_agent_channels(id uuid primary key, corretor_id uuid not null, account_phone text, archived_at timestamptz);
    insert into corretores values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
    insert into lotti_agent_channels(id,corretor_id,account_phone) values
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','5511999999999'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','5522999999999');
  `);
  await db.exec(readFileSync(new URL('./20260924000100_lotti_channel_company_name.sql', import.meta.url), 'utf8'));
}, 30_000);
afterAll(async () => db?.close());

it('edita apenas a empresa do número pertencente ao usuário autenticado', async () => {
  await db.exec("set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111'");
  expect((await db.query("select public.lotti_channel_set_company_name('5522999999999','Outra') ok")).rows[0].ok).toBe(false);
  expect((await db.query("select public.lotti_channel_set_company_name('5511999999999','Imobiliária Alfa') ok")).rows[0].ok).toBe(true);
  expect((await db.query("select company_name from lotti_agent_channels where account_phone='5511999999999'")).rows[0].company_name).toBe('Imobiliária Alfa');
  expect((await db.query("select company_name from lotti_agent_channels where account_phone='5522999999999'")).rows[0].company_name).toBeNull();
});

it('não conserva o nome de empresa quando outro número assume o canal', async () => {
  await db.exec("update lotti_agent_channels set account_phone='5511888888888' where account_phone='5511999999999'");
  expect((await db.query("select company_name from lotti_agent_channels where account_phone='5511888888888'")).rows[0].company_name).toBeNull();
});
