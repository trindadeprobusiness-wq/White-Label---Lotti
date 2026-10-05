// Prova que a baseline (prisma/migrations/0_init) recria o banco da Lotti num
// Postgres vazio, sem Supabase: roda o arquivo inteiro no PGlite, confere que
// tudo que o arquivo declara existe, e que cadastro + RLS funcionam como em
// produção, do jeito que o TenantDb da API consulta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const pasta = fileURLToPath(new URL('../../prisma/migrations/', import.meta.url));
const migrations = readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const ler = (nome) => readFileSync(join(pasta, nome, 'migration.sql'), 'utf8');
const sql = ler('0_init');
const conta = (re) => (sql.match(re) || []).length;

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

// db: só a baseline, para conferir o que o arquivo declara.
// banco: todas as migrations em ordem, como num ambiente novo; cadastro e RLS rodam nele.
let db;
let banco;
test.before(async () => {
  db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(sql);
  banco = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  for (const nome of migrations) await banco.exec(ler(nome));
});
test.after(async () => { await db?.close(); await banco?.close(); });

test('a primeira migration é a baseline e os nomes seguem a ordem de aplicação', () => {
  assert.equal(migrations[0], '0_init');
  for (const nome of migrations.slice(1)) assert.match(nome, /^\d{14}_[a-z0-9_]+$/, `nome fora do padrão: ${nome}`);
});

const um = async (q, p, alvo = banco) => (await alvo.query(q, p)).rows[0];

test('cria tudo que o arquivo declara', async () => {
  const r = await um(`select
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','suporte_privado') and c.relkind='r') as tabelas,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')) as funcoes,
    (select count(*)::int from pg_policies where schemaname in ('public','suporte_privado')) as policies,
    (select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public') as gatilhos,
    (select count(*)::int from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and n.nspname in ('public','suporte_privado')) as fks,
    (select count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e') as enums,
    (select count(*)::int from pg_views where schemaname='public') as views,
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','suporte_privado') and c.relkind='r' and c.relrowsecurity) as rls`, [], db);
  assert.deepEqual(r, {
    tabelas: conta(/^CREATE TABLE (public|suporte_privado)\./gm),
    funcoes: conta(/^CREATE OR REPLACE FUNCTION (public|private)\./gm),
    policies: conta(/^CREATE POLICY /gm),
    gatilhos: conta(/^CREATE TRIGGER .* ON public\./gm),
    fks: conta(/ADD CONSTRAINT \S+ FOREIGN KEY/g),
    enums: conta(/^CREATE TYPE public\.\S+ AS ENUM/gm),
    views: conta(/^CREATE VIEW public\./gm),
    rls: conta(/ENABLE ROW LEVEL SECURITY;$/gm),
  });
  assert.ok(r.tabelas >= 100 && r.funcoes >= 200 && r.policies >= 100, JSON.stringify(r));
});

test('cadastro em auth.users cria o corretor pelo gatilho, como no Supabase', async () => {
  await banco.query(`insert into auth.users (id, email, raw_user_meta_data) values
    ($1, 'a@exemplo.com', '{"nome":"Corretora A"}'), ($2, 'b@exemplo.com', '{"nome":"Corretor B"}')`, [userA, userB]);
  const r = await banco.query('select user_id, nome from public.corretores order by user_id');
  assert.deepEqual(r.rows, [{ user_id: userA, nome: 'Corretora A' }, { user_id: userB, nome: 'Corretor B' }]);
});

test('RLS isola os corretores com claims + papel authenticated (padrão TenantDb)', async () => {
  const { id: corretorA } = await um('select id from public.corretores where user_id = $1', [userA]);
  // Sem plano, a trava de cota da produção recusa o imóvel (PLAN_LIMIT_REACHED):
  // o dado de teste entra com os gatilhos desligados só neste insert.
  await banco.exec("set session_replication_role = replica");
  await banco.query(`insert into public.imoveis (corretor_id, titulo, tipo, valor, endereco, cidade, proprietario_nome)
                  values ($1, 'Apto da A', 'APARTAMENTO', 350000, 'Rua 1', 'Anápolis', 'Dono')`, [corretorA]);
  await banco.exec("set session_replication_role = origin");
  const visiveis = async (sub) => {
    await banco.exec('begin');
    try {
      await banco.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
      await banco.exec('set local role authenticated');
      return (await um('select count(*)::int as n from public.imoveis')).n;
    } finally {
      await banco.exec('rollback');
    }
  };
  assert.equal(await visiveis(userA), 1);
  assert.equal(await visiveis(userB), 0);
  assert.equal(await visiveis('33333333-3333-4333-8333-333333333333'), 0);
});

test('a trava de plano da produção também vale fora do Supabase', async () => {
  const { id: corretorB } = await um('select id from public.corretores where user_id = $1', [userB]);
  await assert.rejects(
    banco.query(`insert into public.imoveis (corretor_id, titulo, tipo, valor, endereco, cidade, proprietario_nome)
              values ($1, 'Casa do B', 'CASA', 500000, 'Rua 2', 'Anápolis', 'Dona')`, [corretorB]),
    /PLAN_LIMIT_REACHED:max_imoveis/,
  );
});

test('prisma/schema.prisma é exatamente o que as migrations geram (migration e schema no mesmo PR)', async () => {
  const { catalogoLocal } = await import('./schema-local.mjs');
  const { gerarSchema } = await import('./gerar-schema.mjs');
  const norm = (t) => t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const gerado = norm(gerarSchema(await catalogoLocal()));
  const commitado = norm(readFileSync(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)), 'utf8'));
  const faltando = gerado.filter((l) => !commitado.includes(l));
  const sobrando = commitado.filter((l) => !gerado.includes(l));
  assert.deepEqual({ faltando, sobrando }, { faltando: [], sobrando: [] },
    'rode `npm run schema:gerar` e commite o prisma/schema.prisma junto com a migration');
});

test('anon e authenticated sem TRUNCATE/REFERENCES/TRIGGER/MAINTAIN; leitura e escrita intactas', async () => {
  const r = await um(`select
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a join pg_roles g on g.oid=a.grantee
      where n.nspname in ('public','suporte_privado') and g.rolname in ('anon','authenticated')
        and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')) as perigosos,
    has_table_privilege('authenticated','public.imoveis','select,insert,update,delete') as crud_authenticated,
    has_table_privilege('service_role','public.imoveis','truncate') as truncate_service_role`);
  assert.deepEqual(r, { perigosos: 0, crud_authenticated: true, truncate_service_role: true });
});

test('mudança em alertas avisa no canal lotti_alertas com o corretor dono', async () => {
  const avisos = [];
  const parar = await banco.listen('lotti_alertas', (payload) => avisos.push(payload));
  const { id: corretorA } = await um('select id from public.corretores where user_id = $1', [userA]);
  const { id } = await um(`insert into public.alertas (corretor_id, tipo, mensagem) values ($1, 'GERAL', 'teste') returning id`, [corretorA]);
  await banco.query('update public.alertas set lido = true where id = $1', [id]);
  await banco.query('delete from public.alertas where id = $1', [id]);
  await new Promise((r) => setTimeout(r, 50));
  await parar();
  assert.deepEqual(avisos, [corretorA, corretorA, corretorA]);
  const pode = await um(`select has_function_privilege('authenticated', 'public.alertas_avisar_mudanca()', 'execute') as authenticated`);
  assert.equal(pode.authenticated, false);
});

test('o dono troca o status do funil e registra contato; outra conta não grava no histórico', async () => {
  const { id: corretorA } = await um('select id from public.corretores where user_id = $1', [userA]);
  const { id: cliente } = await um(`insert into public.clientes (corretor_id, nome, telefone) values ($1, 'Cliente da A', '62999990000') returning id`, [corretorA]);
  const comoUsuario = async (sub, trabalho) => {
    await banco.exec('begin');
    try {
      await banco.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
      await banco.exec('set local role authenticated');
      return await trabalho();
    } finally {
      await banco.exec('rollback');
    }
  };
  const status = await comoUsuario(userA, async () =>
    (await um(`update public.clientes set status_funil = 'VISITA_PROPOSTA' where id = $1 returning status_funil::text as s`, [cliente])).s);
  assert.equal(status, 'VISITA_PROPOSTA');
  const gravado = await comoUsuario(userA, async () =>
    (await um(`insert into public.historico_contatos (cliente_id, tipo, direcao, conteudo) values ($1, 'WHATSAPP', 'OUT', 'oi') returning conteudo`, [cliente])).conteudo);
  assert.equal(gravado, 'oi');
  await assert.rejects(
    comoUsuario(userB, () => banco.query(`insert into public.historico_contatos (cliente_id, tipo, direcao, conteudo) values ($1, 'WHATSAPP', 'OUT', 'invasão')`, [cliente])),
    /row-level security/,
  );
});

test('anon só escreve nas duas tabelas da fachada pública', async () => {
  const r = await um(`select
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(c.relacl) a join pg_roles g on g.oid=a.grantee
      where n.nspname='public' and g.rolname='anon' and a.privilege_type in ('INSERT','UPDATE','DELETE')
        and c.relname not in ('fachada_leads','fachada_escaneamentos')) as escrita_indevida,
    has_table_privilege('anon','public.fachada_leads','insert') as lead,
    has_table_privilege('anon','public.fachada_escaneamentos','insert') as escaneamento,
    has_table_privilege('anon','public.clientes','select') as leitura_intacta,
    has_table_privilege('authenticated','public.clientes','insert,update,delete') as authenticated_intacto`);
  assert.deepEqual(r, { escrita_indevida: 0, lead: true, escaneamento: true, leitura_intacta: true, authenticated_intacto: true });
});
