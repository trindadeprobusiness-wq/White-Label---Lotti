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
//
// Cópia parcial num destino que JÁ está em uso (depois da virada), só das tabelas pedidas:
//   COPIAR_TABELAS=diagnostico node api/scripts/dados/copiar.mjs
//   COPIAR_TABELAS=public.tabela_a,public.tabela_b node api/scripts/dados/copiar.mjs
// Cada linha entra com ON CONFLICT DO NOTHING (o que o destino já tem fica como está; rodar de novo
// não duplica) e nada fora da lista é tocado: nem os contadores de identidade das outras tabelas.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';
const nome = (t) => `${q(t.esquema)}.${q(t.tabela)}`;

// Tabelas que recebem dados: as do sistema e o mínimo de auth.users.
// usuarios, auth_refresh_tokens e auth_password_tokens são do login da API e não existem na origem:
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
  and not (n.nspname = 'public' and c.relname in ('usuarios', 'auth_refresh_tokens', 'auth_password_tokens'))
  and ((n.nspname in ('public', 'suporte_privado') and c.relname <> '_prisma_migrations') or (n.nspname = 'auth' and c.relname = 'users'))
order by n.nspname = 'auth' desc, n.nspname, c.relname`;

/**
 * Tabelas do Diagnóstico de Crescimento (migration 20261008120000_diagnostico_conversacional): o
 * front público gravou nelas no Supabase depois da virada, até a rota /api/publico/diagnostico
 * existir. COPIAR_TABELAS=diagnostico copia só estas para o Railway já em uso.
 */
export const TABELAS_DIAGNOSTICO = [
  'public.diagnostic_leads', 'public.diagnostic_sessions', 'public.diagnostic_answers', 'public.diagnostic_events',
  'public.diagnostic_summaries', 'public.diagnostic_notifications', 'public.diagnostic_rate_limits',
  'public.diagnostic_ai_usage', 'public.diagnostic_ai_budgets',
];

/** 'diagnostico' (o conjunto acima) ou lista 'esquema.tabela' separada por vírgula; vazio = tudo. */
export function tabelasPedidas(valor) {
  const itens = String(valor ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (!itens.length) return null;
  const lista = itens.flatMap((t) => (t === 'diagnostico' ? TABELAS_DIAGNOSTICO : [t]));
  for (const t of lista) if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`tabela inválida em COPIAR_TABELAS: ${t}`);
  return [...new Set(lista)];
}

const chaveDe = (t) => `${t.esquema}.${t.tabela}`;
const filtroDe = (somente) => (somente ? new Set(somente) : null);

export const SQL_IDENTIDADES = `
select n.nspname as esquema, c.relname as tabela,
  format('select setval(%L, coalesce((select max(%I) from %I.%I), 0) + 1, false)',
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

export function sqlInsercao(t, { semConflito = false } = {}) {
  const colunas = t.colunas.map(q).join(', ');
  const sql = `insert into ${nome(t)} (${colunas}) overriding system value select ${colunas} from json_populate_recordset(null::${nome(t)}, $1::json)`;
  return semConflito ? `${sql} on conflict do nothing` : sql;
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
export async function tabelasSoNaOrigem({ origem, destino, somente = null }) {
  const chave = chaveDe;
  const filtro = filtroDe(somente);
  const noDestino = new Set((await destino.query(SQL_TABELAS)).rows.map(chave));
  const faltam = [];
  for (const t of await origem(SQL_TABELAS)) {
    if (noDestino.has(chave(t)) || (filtro && !filtro.has(chave(t)))) continue;
    const [{ n }] = await origem(sqlContagem(t));
    faltam.push({ tabela: chave(t), linhas: n });
  }
  return faltam;
}

/** Colunas que a origem tem e o destino não: a cópia as descartaria sem avisar. */
export async function colunasSoNaOrigem({ origem, destino, somente = null }) {
  const chave = chaveDe;
  const filtro = filtroDe(somente);
  const naOrigem = new Map((await origem(SQL_TABELAS)).map((t) => [chave(t), new Set(t.colunas)]));
  const faltam = [];
  for (const t of (await destino.query(SQL_TABELAS)).rows) {
    if (filtro && !filtro.has(chave(t))) continue;
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

/**
 * `somente` (lista 'esquema.tabela'): cópia parcial para um destino já em uso. Só as tabelas da lista,
 * cada linha com ON CONFLICT DO NOTHING, e só os contadores de identidade delas.
 */
export async function copiar({ origem, destino, pagina = 5000, log = () => {}, somente = null }) {
  const filtro = filtroDe(somente);
  const faltam = await tabelasSoNaOrigem({ origem, destino, somente });
  if (faltam.length) throw new Error(`tabelas da origem que não existem no destino (crie a migration antes): ${JSON.stringify(faltam)}`);
  const colunas = await colunasSoNaOrigem({ origem, destino, somente });
  if (colunas.length) throw new Error(`colunas da origem que não existem no destino (crie a migration antes): ${JSON.stringify(colunas)}`);
  const tabelas = (await destino.query(SQL_TABELAS)).rows.filter((t) => !filtro || filtro.has(chaveDe(t)));
  if (filtro) {
    const achadas = new Set(tabelas.map(chaveDe));
    const ausentes = somente.filter((t) => !achadas.has(t));
    if (ausentes.length) throw new Error(`tabelas pedidas que não existem no destino (aplique a migration antes): ${JSON.stringify(ausentes)}`);
  }
  const relatorio = [];
  await destino.query('begin');
  try {
    await destino.query('set local session_replication_role = replica');
    for (const t of tabelas) {
      const [{ n }] = await origem(sqlContagem(t));
      let copiadas = 0;
      for (let d = 0; d < n; d += pagina) {
        const [{ dados }] = await origem(sqlPagina(t, pagina, d));
        copiadas += (await destino.query(sqlInsercao(t, { semConflito: !!filtro }), [dados])).rowCount;
      }
      relatorio.push({ tabela: `${t.esquema}.${t.tabela}`, origem: n, copiadas });
      if (n) log(`${t.esquema}.${t.tabela}: ${copiadas}/${n}`);
    }
    for (const i of (await destino.query(SQL_IDENTIDADES)).rows) {
      if (!filtro || filtro.has(chaveDe(i))) await destino.query(i.sql);
    }
    await destino.query('commit');
  } catch (e) {
    await destino.query('rollback').catch(() => {});
    throw e;
  }
  if (filtro) for (const t of tabelas) await destino.query(`analyze ${nome(t)}`);
  else await destino.query('analyze');
  return relatorio;
}

/** Contagem por tabela dos dois lados; devolve só as diferenças. */
export async function conferirContagens({ origem, destino, somente = null }) {
  const filtro = filtroDe(somente);
  const tabelas = (await destino.query(SQL_TABELAS)).rows.filter((t) => !filtro || filtro.has(chaveDe(t)));
  const diferencas = [];
  for (const t of tabelas) {
    const [{ n: o }] = await origem(sqlContagem(t));
    const { rows: [{ n: d }] } = await destino.query(sqlContagem(t));
    if (o !== d) diferencas.push({ tabela: `${t.esquema}.${t.tabela}`, origem: o, destino: d });
  }
  const soNaOrigem = await tabelasSoNaOrigem({ origem, destino, somente });
  const colunasSoOrigem = await colunasSoNaOrigem({ origem, destino, somente });
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
    const somente = tabelasPedidas(process.env.COPIAR_TABELAS);
    if (somente) {
      // Destino em uso: só as tabelas pedidas, sem sobrescrever nada do que já está lá.
      console.log(`cópia parcial (ON CONFLICT DO NOTHING): ${somente.join(', ')}`);
    } else {
      const ja = (await destino.query('select count(*)::int as n from public.corretores')).rows[0].n;
      if (ja > 0) { console.error(`destino já tem dados (${ja} corretores): recrie o banco antes de copiar (ou use COPIAR_TABELAS).`); process.exit(1); }
    }
    const relatorio = await copiar({ origem, destino, log: (l) => console.log(l), somente });
    const total = relatorio.reduce((s, r) => s + r.copiadas, 0);
    console.log(`\ncopiadas ${total} linhas em ${relatorio.filter((r) => r.copiadas).length} tabelas com dados (${relatorio.length} tabelas).`);
    if (somente) console.log(relatorio.map((r) => `${r.tabela}: ${r.copiadas} novas de ${r.origem} na origem`).join('\n'));
    const conf = await conferirContagens({ origem, destino, somente });
    console.log(conf.diferencas.length ? `DIFERENÇAS: ${JSON.stringify(conf.diferencas)}` : `contagens iguais nas ${conf.tabelas} tabelas.`);
    if (conf.soNaOrigem.length) console.log(`SÓ NA ORIGEM: ${JSON.stringify(conf.soNaOrigem)}`);
    if (conf.colunasSoOrigem.length) console.log(`COLUNAS SÓ NA ORIGEM: ${JSON.stringify(conf.colunasSoOrigem)}`);
  } finally {
    await destino.end();
  }
}
