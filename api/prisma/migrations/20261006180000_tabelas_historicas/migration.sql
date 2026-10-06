-- Duas tabelas de backup da correção de 2026-07-27 (comissões e lançamentos duplicados)
-- que existem na produção e nunca entraram nas migrations. Vêm para o Railway só para
-- nenhuma linha ficar para trás (87 no total). DDL igual ao catálogo da produção
-- (relatório 30 do Codex): sem PK, RLS ligada, sem policy, só o dono e service_role.
create table if not exists public._backfill_comissoes_20260727 (
  id uuid,
  criado_em timestamp with time zone default now() not null
);
alter table public._backfill_comissoes_20260727 enable row level security;

create table if not exists public._backup_lancamentos_dup_20260727 (
  id uuid,
  corretor_id uuid,
  tipo text,
  categoria text,
  descricao text,
  valor numeric(15,2),
  data timestamp with time zone,
  recorrente boolean,
  contrato_id uuid,
  imovel_id uuid,
  comprovante_url text,
  created_at timestamp with time zone,
  fatura_id uuid
);
alter table public._backup_lancamentos_dup_20260727 enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete, truncate, references, trigger
      on table public._backfill_comissoes_20260727, public._backup_lancamentos_dup_20260727 to service_role;
  end if;
end $$;
revoke all on table public._backfill_comissoes_20260727, public._backup_lancamentos_dup_20260727 from anon, authenticated;
