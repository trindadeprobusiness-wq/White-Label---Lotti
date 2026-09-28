import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// B3 da auditoria de onboarding: a versão de get_corretor_id() da migration de
// onboarding não exige corretor ativo; a migration de reforço restaura a regra.
let db: PGlite;
const ativo = '11111111-1111-4111-8111-111111111111';
const suspenso = '22222222-2222-4222-8222-222222222222';
const corretorDe = async (user: string) => {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [user]);
  return (await db.query<{ id: string | null }>('SELECT public.get_corretor_id() id')).rows[0].id;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.corretores(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text);
    CREATE TABLE public.routine_organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_corretor_id uuid);
    CREATE TABLE public.routine_memberships(organization_id uuid, user_id uuid, status text);
    CREATE TABLE public.onboarding_profiles(user_id uuid, organization_id uuid);
    -- Versão da 20260821130000_onboarding_ativacao (sem checar status do corretor).
    CREATE FUNCTION public.get_corretor_id() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT o.legacy_corretor_id FROM public.routine_memberships m
        JOIN public.routine_organizations o ON o.id = m.organization_id
       WHERE m.user_id = auth.uid() AND m.status = 'active' LIMIT 1
    $$;
  `);
  for (const [user, status] of [[ativo, 'ativo'], [suspenso, 'suspenso']]) {
    await db.exec(`
      WITH c AS (INSERT INTO corretores(user_id, status) VALUES ('${user}', '${status}') RETURNING id),
           o AS (INSERT INTO routine_organizations(legacy_corretor_id) SELECT id FROM c RETURNING id),
           m AS (INSERT INTO routine_memberships(organization_id, user_id, status) SELECT id, '${user}', 'active' FROM o RETURNING organization_id)
      INSERT INTO onboarding_profiles(user_id, organization_id) SELECT '${user}', organization_id FROM m;
    `);
  }
}, 30_000);
afterAll(async () => db?.close());

it('sem o reforço, a versão do onboarding devolve o tenant de uma conta suspensa', async () => {
  expect(await corretorDe(suspenso)).not.toBeNull();
});

it('com o reforço, conta suspensa perde o tenant e conta ativa continua', async () => {
  await db.exec(readFileSync(new URL('./20260927110000_onboarding_corretor_ativo.sql', import.meta.url), 'utf8'));
  expect(await corretorDe(suspenso)).toBeNull();
  expect(await corretorDe(ativo)).not.toBeNull();
});
