import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { montarBaseline } from './gerar-baseline.mjs';
import { checksum, sqlMarcarAplicada } from './marcar-aplicada.mjs';

test('checksum é o SHA-256 dos bytes, como o Prisma calcula', () => {
  assert.equal(checksum(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('marcar como aplicada cria o controle do Prisma uma vez só, sem acesso público', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin;");
    const sql = sqlMarcarAplicada('0_init', 'a'.repeat(64));
    await db.exec(sql);
    await db.exec(sql);
    const linhas = (await db.query("select migration_name, checksum, finished_at is not null as aplicada from public._prisma_migrations")).rows;
    assert.deepEqual(linhas, [{ migration_name: '0_init', checksum: 'a'.repeat(64), aplicada: true }]);
    const acesso = (await db.query("select has_table_privilege('anon', 'public._prisma_migrations', 'select') as anon, (select relrowsecurity from pg_class where oid = 'public._prisma_migrations'::regclass) as rls")).rows[0];
    assert.deepEqual(acesso, { anon: false, rls: true });
  } finally {
    await db.close();
  }
});

test('recusa nome ou checksum fora do formato (vão direto para o SQL)', () => {
  assert.throws(() => sqlMarcarAplicada("0_init'; drop table x; --", 'a'.repeat(64)));
  assert.throws(() => sqlMarcarAplicada('0_init', 'xyz'));
});

test('a baseline sai agrupada por seção, com o cabeçalho de compatibilidade e só LF', () => {
  const sql = montarBaseline([
    { ordem: 10, nome: 'public.t', sql: "CREATE TYPE public.t AS ENUM ('a');" },
    { ordem: 20, nome: 'public.x', sql: 'CREATE TABLE public.x (\r\n  id int\r\n);' },
    { ordem: 20, nome: 'public.y', sql: 'CREATE TABLE public.y (id int);' },
  ], { geradoEm: '2026-10-04' });
  assert.match(sql, /^-- 0_init: baseline/);
  assert.match(sql, /SET check_function_bodies = false;/);
  assert.match(sql, /CREATE OR REPLACE|CREATE FUNCTION auth\.uid\(\)/);
  assert.equal(sql.match(/-- ===== Tabelas =====/g).length, 1);
  assert.ok(sql.indexOf('-- ===== Enums =====') < sql.indexOf('-- ===== Tabelas ====='));
  assert.ok(!sql.includes('\r'));
});
