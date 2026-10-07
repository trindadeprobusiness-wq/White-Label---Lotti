// Copia os dados de um Postgres de origem (a produção, lida pela CLI do Supabase)
// para um destino que já tem o schema das migrations (o ensaio no Railway).
// - Nada de dado pessoal em disco: cada página chega como texto JSON na memória
//   e vai direto para o destino, que converte os tipos (json_populate_recordset),
//   sem passar números por ponto flutuante no JavaScript.
// - Tudo numa transação, com session_replication_role = replica: gatilhos de
//   cadastro, auditoria e cota não disparam, e as FKs não exigem ordem.
// - Ids preservados (OVERRIDING SYSTEM VALUE); contadores de identidade
//   ajustados no fim; colunas geradas recalculadas pelo destino.
//
// Uso (DESTINO_URL no ambiente, nunca impressa):
//   node api/scripts/dados/copiar.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';
const nome = (t) => `${q(t.esquema)}.${q(t.tabela)}`;

// Tabelas que recebem dados: as do sistema e o mínimo de auth.users.
// usuarios e auth_refresh_tokens são do login da API e não existem na origem:
// quem preenche usuarios é preencher-usuarios.mjs, a partir de auth.users.
export const SQL_TABELAS = `
select n.nspname as esquema, c.relname as tabela,
  array(select a.attname::text from pg_attribute a
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated not in ('s', 'v')
        order by a.attnum) as colunas,
  coalesce((select array(select a.attname::text from unnest(k.conkey) with ordinality u(n, o)
                         join pg_attribute a on a.attrelid = c.oid and a.attnum = u.n order by u.o)
            from pg_constraint k where k.conrelid = c.oid and k.contype = 'p'), '{}') as chave
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and not (n.nspname = 'public' and c.relname in ('usuarios', 'auth_refresh_tokens'))
  and ((n.nspname in ('public', 'suporte_privado') and c.relname <> '_prisma_migrations') or (n.nspname = 'auth' and c.relname = 'users'))
order by n.nspname = 'auth' desc, n.nspname, c.relname`;

export const SQL_IDENTIDADES = `
select format('select setval(%L, coalesce((select max(%I) from %I.%I), 0) + 1, false)',
  pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname), a.attname, n.nspname, c.relname) as sql
from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
where a.attidentity in ('a', 'd') and n.nspname in ('public', 'suporte_privado')`;

export function sqlContagem(t) {
  return `select count(*)::int as n from ${nome(t)}`;
}

export function sqlPagina(t, limite, deslocamento) {
  const ordem = (t.chave.length ? t.chave : t.colunas.slice(0, 1)).map(q).join(', ');
  return `select coalesce(json_agg(p), '[]')::text as dados from (select ${t.colunas.map(q).join(', ')} from ${nome(t)} order by ${ordem} limit ${Number(limite)} offset ${Number(deslocamento)}) p`;
}

export function sqlInsercao(t) {
  const colunas = t.colunas.map(q).join(', ');
  return `insert into ${nome(t)} (${colunas}) overriding system value select ${colunas} from json_populate_recordset(null::${nome(t)}, $1::json)`;
}

/**
 * origem(sql) → linhas; destino.query(sql, params) → { rows, rowCount }.
 * Devolve só contagens por tabela (nada de conteúdo).
 */
/**
 * Tabelas com dados que existem na origem e não no destino. A cópia lê a lista do
 * destino; sem esta checagem, uma tabela que faltasse nas migrations (foi o caso de
 * public.videos) ficaria para trás em silêncio, e a conferência diria "tudo igual".
 */
export async function tabelasSoNaOrigem({ origem, destino }) {
  const chave = (t) => `${t.esquema}.${t.tabela}`;
  const noDestino = new Set((await destino.query(SQL_TABELAS)).rows.map(chave));
  const faltam = [];
  for (const t of await origem(SQL_TABELAS)) {
    if (noDestino.has(chave(t))) continue;
    const [{ n }] = await origem(sqlContagem(t));
    faltam.push({ tabela: chave(t), linhas: n });
  }
  return faltam;
}

/** Colunas que a origem tem e o destino não: a cópia as descartaria sem avisar. */
export async function colunasSoNaOrigem({ origem, destino }) {
  const chave = (t) => `${t.esquema}.${t.tabela}`;
  const naOrigem = new Map((await origem(SQL_TABELAS)).map((t) => [chave(t), new Set(t.colunas)]));
  const faltam = [];
  for (const t of (await destino.query(SQL_TABELAS)).rows) {
    // auth.users no Railway é só o mínimo que o login e os gatilhos usam (id, e-mail, senha,
    // metadados): os tokens internos do Supabase Auth ficam para trás de propósito.
    if (t.esquema === 'auth') continue;
    const o = naOrigem.get(chave(t));
    if (!o) continue;
    const d = new Set(t.colunas);
    for (const c of o) if (!d.has(c)) faltam.push(`${chave(t)}.${c}`);
  }
  return faltam;
}

export async function copiar({ origem, destino, pagina = 5000, log = () => {} }) {
  const faltam = await tabelasSoNaOrigem({ origem, destino });
  if (faltam.length) throw new Error(`tabelas da origem que não existem no destino (crie a migration antes): ${JSON.stringify(faltam)}`);
  const colunas = await colunasSoNaOrigem({ origem, destino });
  if (colunas.length) throw new Error(`colunas da origem que não existem no destino (crie a migration antes): ${JSON.stringify(colunas)}`);
  const tabelas = (await destino.query(SQL_TABELAS)).rows;
  const relatorio = [];
  await destino.query('begin');
  try {
    await destino.query('set local session_replication_role = replica');
    for (const t of tabelas) {
      const [{ n }] = await origem(sqlContagem(t));
      let copiadas = 0;
      for (let d = 0; d < n; d += pagina) {
        const [{ dados }] = await origem(sqlPagina(t, pagina, d));
        copiadas += (await destino.query(sqlInsercao(t), [dados])).rowCount;
      }
      relatorio.push({ tabela: `${t.esquema}.${t.tabela}`, origem: n, copiadas });
      if (n) log(`${t.esquema}.${t.tabela}: ${copiadas}/${n}`);
    }
    for (const { sql } of (await destino.query(SQL_IDENTIDADES)).rows) await destino.query(sql);
    await destino.query('commit');
  } catch (e) {
    await destino.query('rollback').catch(() => {});
    throw e;
  }
  await destino.query('analyze');
  return relatorio;
}

/** Contagem por tabela dos dois lados; devolve só as diferenças. */
export async function conferirContagens({ origem, destino }) {
  const tabelas = (await destino.query(SQL_TABELAS)).rows;
  const diferencas = [];
  for (const t of tabelas) {
    const [{ n: o }] = await origem(sqlContagem(t));
    const { rows: [{ n: d }] } = await destino.query(sqlContagem(t));
    if (o !== d) diferencas.push({ tabela: `${t.esquema}.${t.tabela}`, origem: o, destino: d });
  }
  const soNaOrigem = await tabelasSoNaOrigem({ origem, destino });
  const colunasSoOrigem = await colunasSoNaOrigem({ origem, destino });
  return { tabelas: tabelas.length, diferencas, soNaOrigem, colunasSoOrigem };
}

/** O que cada usuário enxerga com o RLS (padrão TenantDb), nos dois lados. */
export function sqlVisaoDoUsuario(sub) {
  if (!/^[0-9a-f-]{36}$/i.test(sub)) throw new Error('sub inválido');
  const claims = JSON.stringify({ sub, role: 'authenticated' });
  return `begin;
select set_config('request.jwt.claims', '${claims}', true);
set local role authenticated;
select (select count(*)::int from public.clientes) as clientes, (select count(*)::int from public.imoveis) as imoveis,
       (select count(*)::int from public.contratos) as contratos, (select count(*)::int from public.alertas) as alertas,
       (select count(*)::int from public.lotti_agent_conversations) as conversas;
rollback;`;
}

// Origem real: a produção pela CLI do Supabase (só leitura, sem a senha do banco).
export function origemSupabase({ cli = 'C:/Users/rafae/bin/supabase.exe', cwd } = {}) {
  return async (sql) => {
    const r = spawnSync(cli, ['db', 'query', '--linked', sql], { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
    if (r.status !== 0) throw new Error('CLI do Supabase falhou: ' + String(r.stderr || r.stdout).slice(0, 500));
    const json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    if (!Array.isArray(json.rows)) throw new Error('resposta sem rows: ' + r.stdout.slice(0, 300));
    return json.rows;
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pg } = await import('pg');
  if (!process.env.DESTINO_URL) { console.error('defina DESTINO_URL'); process.exit(1); }
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const origem = origemSupabase({ cwd: repo });
  const destino = new pg.Client({ connectionString: process.env.DESTINO_URL, ssl: { rejectUnauthorized: false } });
  await destino.connect();
  try {
    const ja = (await destino.query('select count(*)::int as n from public.corretores')).rows[0].n;
    if (ja > 0) { console.error(`destino já tem dados (${ja} corretores): recrie o banco antes de copiar.`); process.exit(1); }
    const relatorio = await copiar({ origem, destino, log: (l) => console.log(l) });
    const total = relatorio.reduce((s, r) => s + r.copiadas, 0);
    console.log(`\ncopiadas ${total} linhas em ${relatorio.filter((r) => r.copiadas).length} tabelas com dados (${relatorio.length} tabelas).`);
    const conf = await conferirContagens({ origem, destino });
    console.log(conf.diferencas.length ? `DIFERENÇAS: ${JSON.stringify(conf.diferencas)}` : `contagens iguais nas ${conf.tabelas} tabelas.`);
    if (conf.soNaOrigem.length) console.log(`SÓ NA ORIGEM: ${JSON.stringify(conf.soNaOrigem)}`);
    if (conf.colunasSoOrigem.length) console.log(`COLUNAS SÓ NA ORIGEM: ${JSON.stringify(conf.colunasSoOrigem)}`);
  } finally {
    await destino.end();
  }
}
