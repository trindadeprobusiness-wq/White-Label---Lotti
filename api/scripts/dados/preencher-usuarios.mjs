// Preenche public.usuarios (login da API) a partir de auth.users, no MESMO banco
// (o destino, depois de copiar.mjs). O id é preservado: é o claims.sub que o RLS usa.
// - O hash bcrypt do Supabase ($2a$) vai como está: bcryptjs confere, ninguém troca senha.
// - Sem senha (conta só OAuth ou convite não aceito) fica password_hash null.
// - banned_until no futuro vira 'suspenso'; contas anônimas e sem e-mail ficam de fora.
// - Idempotente: rodar de novo atualiza e-mail/hash/status e não mexe em session_version.
// - Nada de e-mail ou hash na saída: só contagens.
//
// Uso (DESTINO_URL no ambiente, nunca impressa):
//   node api/scripts/dados/preencher-usuarios.mjs
import { fileURLToPath } from 'node:url';

export const SQL_DUPLICADOS = `
select count(*)::int as n from (
  select lower(btrim(email)) from auth.users
  where email is not null and btrim(email) <> '' and not is_anonymous
  group by 1 having count(*) > 1) d`;

export const SQL_PREENCHER = `
insert into public.usuarios (id, email, password_hash, status, created_at)
select u.id,
       lower(btrim(u.email)),
       nullif(u.encrypted_password, ''),
       case when u.banned_until > now() then 'suspenso' else 'ativo' end,
       coalesce(u.created_at, now())
from auth.users u
where u.email is not null and btrim(u.email) <> '' and not u.is_anonymous
on conflict (id) do update set
  email = excluded.email,
  password_hash = excluded.password_hash,
  status = excluded.status,
  updated_at = now()`;

export const SQL_RESUMO = `
select (select count(*)::int from auth.users where email is not null and btrim(email) <> '' and not is_anonymous) as elegiveis,
       (select count(*)::int from public.usuarios) as usuarios,
       (select count(*)::int from public.usuarios where password_hash is null) as sem_senha,
       (select count(*)::int from public.usuarios where status <> 'ativo') as nao_ativos,
       (select count(*)::int from public.usuarios u where not exists (select 1 from auth.users a where a.id = u.id)) as orfaos`;

/** destino.query(sql) → { rows }. Devolve só contagens. */
export async function preencherUsuarios(destino) {
  const { rows: [{ n }] } = await destino.query(SQL_DUPLICADOS);
  if (n > 0) throw new Error(`${n} e-mail(s) repetido(s) em auth.users (ignorando maiúsculas): resolva antes de preencher.`);
  await destino.query('begin');
  try {
    await destino.query(SQL_PREENCHER);
    await destino.query('commit');
  } catch (e) {
    await destino.query('rollback').catch(() => {});
    throw e;
  }
  return (await destino.query(SQL_RESUMO)).rows[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pg } = await import('pg');
  if (!process.env.DESTINO_URL) { console.error('defina DESTINO_URL'); process.exit(1); }
  const destino = new pg.Client({ connectionString: process.env.DESTINO_URL, ssl: { rejectUnauthorized: false } });
  await destino.connect();
  try {
    const r = await preencherUsuarios(destino);
    console.log(JSON.stringify(r));
    if (r.usuarios < r.elegiveis || r.orfaos) process.exitCode = 1;
  } finally {
    await destino.end();
  }
}
