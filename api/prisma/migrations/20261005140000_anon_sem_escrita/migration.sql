-- O papel `anon` (a chave pública que vai no navegador) tinha INSERT, UPDATE e
-- DELETE em 64 objetos de `public`, incluindo user_roles, admin_config, plans,
-- corretores, clientes, contratos e faturas_aluguel. Hoje o RLS segura quase tudo,
-- mas basta uma policy nova permissiva para virar escrita real — e os default
-- privileges faziam cada tabela nova nascer assim.
--
-- Só duas escritas públicas existem de verdade, as da página pública da fachada
-- (`src/hooks/useFachadaPublica.ts`): registrar escaneamento e criar lead. Elas
-- continuam, protegidas pelas policies de hoje e pelos gatilhos de limite de uso.
-- Todo o resto que é público passa por Edge Function com service_role.
--
-- A leitura de `anon` não é tocada aqui: mexer nela exigiria conferir cada página
-- pública uma a uma, e é assunto de outra migration.

-- 1) Tira a escrita de anon em tudo, menos nas duas tabelas da fachada pública.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as alvo
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and c.relname not in ('fachada_leads', 'fachada_escaneamentos')
      and exists (
        select 1 from aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
        where g.rolname = 'anon' and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      )
  loop
    execute format('revoke insert, update, delete on %s from anon', r.alvo);
  end loop;
end $$;

-- 2) Sequências: anon não precisa avançar contador nenhum. USAGE fica, para não
--    quebrar um insert que dependa de default; só o UPDATE direto sai.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass as alvo
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and exists (
        select 1 from aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee
        where g.rolname = 'anon' and a.privilege_type = 'UPDATE'
      )
  loop
    execute format('revoke update on sequence %s from anon', r.alvo);
  end loop;
end $$;

-- 3) A raiz do problema: os default privileges. Sem isso, a próxima tabela criada
--    volta a nascer com escrita para anon.
do $$
declare r record;
begin
  for r in
    select distinct pg_get_userbyid(d.defaclrole) as dono
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    join pg_roles g on g.oid = a.grantee
    where g.rolname = 'anon'
      and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and d.defaclobjtype = 'r'
      and d.defaclnamespace = 'public'::regnamespace
      -- Só os papéis que este usuário pode administrar. O supabase_admin também tem
      -- default privileges aqui, e mexer nos dele dá 42501.
      and pg_has_role(current_user, d.defaclrole, 'USAGE')
  loop
    execute format('alter default privileges for role %I in schema public revoke insert, update, delete on tables from anon', r.dono);
  end loop;
end $$;
