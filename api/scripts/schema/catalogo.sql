-- Estrutura do schema public em um único JSON, só leitura (catálogo do Postgres).
-- Uso: supabase db query --linked -f api/scripts/schema/catalogo.sql > catalogo.json
with
tabelas as (
  select c.oid, c.relname as nome, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
),
colunas as (
  select a.attrelid, a.attnum, a.attname as nome, format_type(a.atttypid, a.atttypmod) as tipo,
    t.typname as tipo_base, tn.nspname as tipo_schema, t.typtype::text as tipo_categoria,
    et.typname as elem_base, etn.nspname as elem_schema, et.typtype::text as elem_categoria,
    a.attnotnull as obrigatorio, pg_get_expr(d.adbin, d.adrelid) as padrao,
    a.attidentity::text as identidade, a.attgenerated::text as gerada
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  join pg_namespace tn on tn.oid = t.typnamespace
  left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
  left join pg_namespace etn on etn.oid = et.typnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and a.attrelid in (select oid from tabelas)
),
restricoes as (
  select c.conrelid, c.conname as nome, c.contype::text as tipo,
    array(select a.attname from unnest(c.conkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as colunas,
    rc.relname as ref_tabela, rn.nspname as ref_schema,
    array(select a.attname from unnest(c.confkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o) as ref_colunas,
    c.confdeltype::text as on_delete, c.confupdtype::text as on_update
  from pg_constraint c
  left join pg_class rc on rc.oid = c.confrelid
  left join pg_namespace rn on rn.oid = rc.relnamespace
  where c.conrelid in (select oid from tabelas) and c.contype in ('p', 'u', 'f', 'c', 'x')
),
indices as (
  select i.indrelid, ic.relname as nome, i.indisunique as unico, am.amname as metodo,
    i.indpred is not null as parcial, 0 = any (i.indkey::int2[]) as expressao,
    array(select json_build_object('c', a.attname, 'desc', (i.indoption::int2[])[k.o - 1] & 1 = 1)
          from unnest(i.indkey::int2[]) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n
          where k.o <= i.indnkeyatts order by k.o) as colunas
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_am am on am.oid = ic.relam
  where i.indrelid in (select oid from tabelas)
    and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid and c.contype in ('p', 'u', 'x'))
),
gatilhos as (
  select tgrelid, array_agg(tgname::text order by tgname) as nomes
  from pg_trigger where not tgisinternal and tgrelid in (select oid from tabelas) group by tgrelid
),
enums as (
  select t.typname as nome, array_agg(e.enumlabel::text order by e.enumsortorder) as valores
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname
)
select json_build_object(
  'tabelas', (select json_agg(json_build_object(
      'nome', t.nome, 'rls', t.rls,
      'colunas', (select json_agg(row_to_json(c) order by c.attnum) from colunas c where c.attrelid = t.oid),
      'restricoes', (select coalesce(json_agg(row_to_json(r) order by r.nome), '[]'::json) from restricoes r where r.conrelid = t.oid),
      'indices', (select coalesce(json_agg(row_to_json(i) order by i.nome), '[]'::json) from indices i where i.indrelid = t.oid),
      'gatilhos', (select g.nomes from gatilhos g where g.tgrelid = t.oid)
    ) order by t.nome) from tabelas t),
  'enums', (select json_agg(row_to_json(e) order by e.nome) from enums e),
  'views', (select coalesce(json_agg(table_name::text order by table_name), '[]'::json) from information_schema.views where table_schema = 'public')
) as catalogo;
