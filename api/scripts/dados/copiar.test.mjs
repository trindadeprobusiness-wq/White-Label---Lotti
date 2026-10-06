// Cópia de dados entre dois bancos com o schema das migrations (PGlite nos dois
// papéis): conserva ids e conteúdo, não dispara gatilhos, recalcula coluna
// gerada e deixa os contadores prontos para o próximo insert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { conferirContagens, copiar, sqlInsercao, sqlPagina, sqlVisaoDoUsuario, tabelasSoNaOrigem, colunasSoNaOrigem } from './copiar.mjs';

const pasta = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const migrations = readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
async function bancoNovo() {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  for (const m of migrations) await db.exec(readFileSync(join(pasta, m, 'migration.sql'), 'utf8'));
  return db;
}
const comoPg = (db) => ({ query: async (sql, params) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? 0 }; } });

const userA = '11111111-1111-4111-8111-111111111111';
let origem;
let destino;

test.before(async () => {
  origem = await bancoNovo();
  destino = await bancoNovo();
  // Produção de mentira: um cadastro (gatilhos criam corretor, organização, etapas...)
  // e linhas com identidade, coluna gerada, json, array e decimal.
  await origem.query(`insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values ($1, 'a@exemplo.com', '$2a$10$hash', '{"nome":"Corretora A"}')`, [userA]);
  await origem.exec(`set session_replication_role = replica;
    insert into public.imoveis (corretor_id, titulo, tipo, valor, endereco, cidade, proprietario_nome, tracking_data)
      select id, 'Apto Jundiaí', 'APARTAMENTO', 350000.55, 'Rua 1', 'Anápolis', 'Dono', '{"origem":["site","qr"]}' from public.corretores;
    insert into public.admin_auditoria (acao, entidade) values ('teste', 'x'), ('teste2', 'y');
    set session_replication_role = origin;`);
});
test.after(async () => { await origem?.close(); await destino?.close(); });

test('SQL de página e de inserção com nomes entre aspas e ordem pela chave', () => {
  const t = { esquema: 'public', tabela: 'imoveis', colunas: ['id', 'titulo'], chave: ['id'] };
  assert.equal(sqlPagina(t, 5000, 0), `select coalesce(json_agg(p), '[]')::text as dados from (select "id", "titulo" from "public"."imoveis" order by "id" limit 5000 offset 0) p`);
  assert.equal(sqlInsercao(t), `insert into "public"."imoveis" ("id", "titulo") overriding system value select "id", "titulo" from json_populate_recordset(null::"public"."imoveis", $1::json)`);
  assert.throws(() => sqlVisaoDoUsuario("x'; drop table y; --"));
});

test('copia tudo com ids, conteúdo e tipos preservados, sem disparar gatilhos', async () => {
  const relatorio = await copiar({ origem: async (sql) => (await origem.query(sql)).rows, destino: comoPg(destino), pagina: 2 });
  assert.ok(relatorio.every((r) => r.copiadas === r.origem), JSON.stringify(relatorio.filter((r) => r.copiadas !== r.origem)));
  // A produção não tem as tabelas do login da API; a cópia não pode procurá-las lá.
  assert.ok(!relatorio.some((r) => ['public.usuarios', 'public.auth_refresh_tokens'].includes(r.tabela)));
  const conf = await conferirContagens({ origem: async (sql) => (await origem.query(sql)).rows, destino: comoPg(destino) });
  assert.deepEqual(conf.diferencas, []);

  const lado = async (db) => (await db.query(`select i.id, i.valor::text as valor, i.tracking_data, c.user_id, u.encrypted_password,
      (select count(*)::int from public.crm_etapas e where e.corretor_id = c.id) as etapas
    from public.imoveis i join public.corretores c on c.id = i.corretor_id join auth.users u on u.id = c.user_id`)).rows;
  assert.deepEqual(await lado(destino), await lado(origem));
  assert.equal((await lado(destino))[0].valor, '350000.55');
});

test('identidade continua do maior id copiado; gatilhos voltam a valer depois', async () => {
  const antes = (await destino.query('select max(id)::int as m from public.admin_auditoria')).rows[0].m;
  const novo = (await destino.query(`insert into public.admin_auditoria (acao, entidade) values ('depois', 'z') returning id::int`)).rows[0].id;
  assert.equal(novo, antes + 1);
  // O cadastro no destino volta a disparar o gatilho (a cópia não deixou replica ligado).
  await destino.query(`insert into auth.users (id, email, raw_user_meta_data) values ('22222222-2222-4222-8222-222222222222', 'b@exemplo.com', '{"nome":"B"}')`);
  assert.equal((await destino.query(`select count(*)::int as n from public.corretores where user_id = '22222222-2222-4222-8222-222222222222'`)).rows[0].n, 1);
});

test('a visão de cada usuário pelo RLS é a mesma nos dois bancos', async () => {
  const visao = async (db) => { const r = await db.exec(sqlVisaoDoUsuario(userA)); return r.find((x) => x.rows?.length && 'clientes' in x.rows[0]).rows[0]; };
  assert.deepEqual(await visao(destino), await visao(origem));
  assert.equal((await visao(destino)).imoveis, 1);
});

test('tabela que só existe na origem barra a cópia (antes passava em silêncio)', async () => {
  const o = await bancoNovo();
  const d = await bancoNovo();
  try {
    await o.exec(`create table public.videos_teste (id uuid primary key); insert into public.videos_teste values (gen_random_uuid());`);
    const ler = async (sql) => (await o.query(sql)).rows;
    assert.deepEqual(await tabelasSoNaOrigem({ origem: ler, destino: comoPg(d) }), [{ tabela: 'public.videos_teste', linhas: 1 }]);
    await assert.rejects(copiar({ origem: ler, destino: comoPg(d) }), /não existem no destino/);
    assert.equal((await d.query('select count(*)::int as n from public.corretores')).rows[0].n, 0);
  } finally { await o.close(); await d.close(); }
});

test('coluna que só existe na origem também barra a cópia', async () => {
  const o = await bancoNovo();
  const d = await bancoNovo();
  try {
    await o.exec('alter table public.imoveis add column extra_so_origem text');
    const ler = async (sql) => (await o.query(sql)).rows;
    assert.deepEqual(await colunasSoNaOrigem({ origem: ler, destino: comoPg(d) }), ['public.imoveis.extra_so_origem']);
    await assert.rejects(copiar({ origem: ler, destino: comoPg(d) }), /colunas da origem/);
  } finally { await o.close(); await d.close(); }
});
