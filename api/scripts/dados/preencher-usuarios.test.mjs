// Preenchimento de public.usuarios a partir de auth.users, no PGlite com todas as
// migrations: id e hash preservados, a senha antiga confere, e rodar de novo não duplica.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import bcrypt from 'bcryptjs';
import { preencherUsuarios } from './preencher-usuarios.mjs';

const pasta = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const migrations = readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
let db;
const comoPg = { query: async (sql) => ({ rows: (await db.query(sql)).rows }) };

test.before(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  for (const m of migrations) await db.exec(readFileSync(join(pasta, m, 'migration.sql'), 'utf8'));
  // Formato do Supabase: $2a$10$...
  const hash = bcrypt.hashSync('senha-antiga', 10).replace(/^\$2b\$/, '$2a$');
  await db.exec('set session_replication_role = replica');
  await db.query(`insert into auth.users (id, email, encrypted_password) values ($1, ' Ana@Exemplo.com ', $2)`, [A, hash]);
  await db.query(`insert into auth.users (id, email, encrypted_password) values ($1, 'oauth@exemplo.com', '')`, [B]);
  await db.query(`insert into auth.users (id, email, banned_until) values ($1, 'banido@exemplo.com', now() + interval '1 day')`, [C]);
  await db.query(`insert into auth.users (id, email, is_anonymous) values ($1, null, true)`, [D]);
  await db.exec('set session_replication_role = origin');
});
test.after(async () => { await db?.close(); });

test('copia id, e-mail normalizado e o hash do Supabase, que confere com a senha antiga', async () => {
  const r = await preencherUsuarios(comoPg);
  assert.deepEqual(r, { elegiveis: 3, usuarios: 3, sem_senha: 2, nao_ativos: 1, orfaos: 0 });
  const { rows: [ana] } = await db.query('select email, password_hash, status from public.usuarios where id = $1', [A]);
  assert.equal(ana.email, 'ana@exemplo.com');
  assert.equal(ana.status, 'ativo');
  assert.ok(bcrypt.compareSync('senha-antiga', ana.password_hash));
  const { rows: [banido] } = await db.query('select status from public.usuarios where id = $1', [C]);
  assert.equal(banido.status, 'suspenso');
});

test('rodar de novo não duplica e preserva session_version', async () => {
  await db.query('update public.usuarios set session_version = 4 where id = $1', [A]);
  const r = await preencherUsuarios(comoPg);
  assert.equal(r.usuarios, 3);
  const { rows: [ana] } = await db.query('select session_version from public.usuarios where id = $1', [A]);
  assert.equal(ana.session_version, 4);
});

test('e-mail repetido (só muda maiúscula) para tudo antes de escrever', async () => {
  await db.exec(`set session_replication_role = replica;
    insert into auth.users (id, email) values ('55555555-5555-4555-8555-555555555555', 'ANA@exemplo.com');
    set session_replication_role = origin;`);
  await assert.rejects(preencherUsuarios(comoPg), /repetido/);
});
