-- Menor privilégio para os papéis da API pública do Supabase (anon e authenticated).
-- O padrão do Supabase dá a eles todos os privilégios de tabela. Saem os que não
-- servem ao app:
--   - TRUNCATE: apaga a tabela inteira ignorando o RLS;
--   - REFERENCES e TRIGGER: são de DDL;
--   - MAINTAIN (Postgres 17+): permite VACUUM, LOCK e REINDEX. Um VACUUM em
--     contratos/clientes destruiria as linhas apagadas em 2026-10-02 que estão
--     preservadas para recuperação.
-- Ler, inserir, alterar e excluir linhas continua como antes (o RLS decide quais).
-- Nenhuma função do sistema usa TRUNCATE (conferido em 2026-10-04). service_role,
-- que só roda no servidor, não muda.
DO $$
DECLARE
  t record;
  extra text := CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ', MAINTAIN' ELSE '' END;
BEGIN
  FOR t IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'suporte_privado') AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER%s ON TABLE %I.%I FROM anon, authenticated', extra, t.nspname, t.relname);
  END LOOP;
  -- Tabelas novas criadas pelo dono das migrations já nascem sem esses privilégios.
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER%s ON TABLES FROM anon, authenticated', extra);
END $$;
