begin;

create table public.lotti_inbox_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.lotti_agent_conversations(id) on delete cascade,
  kind text not null check (kind in ('mode', 'stage')),
  from_label text,
  to_label text not null,
  subject_label text,
  actor_label text not null,
  created_at timestamptz not null default now()
);
create index lotti_inbox_events_conversation_time on public.lotti_inbox_events(conversation_id, created_at);
alter table public.lotti_inbox_events enable row level security;
revoke all on public.lotti_inbox_events from anon, authenticated;
grant select on public.lotti_inbox_events to authenticated;
grant all on public.lotti_inbox_events to service_role;
create policy lotti_inbox_events_owner_read on public.lotti_inbox_events for select to authenticated
using (exists (
  select 1 from public.lotti_agent_conversations cv
  join public.corretores c on c.id = cv.corretor_id
  where cv.id = conversation_id and c.user_id = (select auth.uid())
));

create function public.lotti_inbox_event_actor() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(c.nome, '') from public.corretores c where c.user_id = (select auth.uid()) limit 1), 'Sistema')
$$;

create function public.lotti_inbox_record_mode() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.mode is distinct from old.mode then
    insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
    values (new.id, 'mode', old.mode, case new.mode when 'ai' then 'IA' when 'human' then 'Equipe' else 'Pausada' end, public.lotti_inbox_event_actor());
  end if;
  return new;
end;
$$;
create trigger lotti_inbox_record_mode after update of mode on public.lotti_agent_conversations
for each row execute function public.lotti_inbox_record_mode();

create function public.lotti_inbox_record_crm_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
declare old_name text; new_name text;
begin
  if new.etapa_id is not distinct from old.etapa_id or new.cliente_id is null then return new; end if;
  select nome into old_name from public.crm_etapas where id = old.etapa_id;
  select nome into new_name from public.crm_etapas where id = new.etapa_id;
  insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, subject_label, actor_label)
  select cv.id, 'stage', coalesce(old_name, 'Etapa anterior'), coalesce(new_name, 'Nova etapa'), new.titulo, public.lotti_inbox_event_actor()
  from public.lotti_agent_conversations cv
  where cv.cliente_id = new.cliente_id and cv.corretor_id = new.corretor_id and cv.archived_at is null;
  return new;
end;
$$;
create trigger lotti_inbox_record_crm_stage after update of etapa_id on public.crm_oportunidades
for each row execute function public.lotti_inbox_record_crm_stage();

create function public.lotti_inbox_record_legacy_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status_funil is not distinct from old.status_funil then return new; end if;
  insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
  select cv.id, 'stage', coalesce(old.status_funil, 'Sem etapa'), coalesce(new.status_funil, 'Sem etapa'), public.lotti_inbox_event_actor()
  from public.lotti_agent_conversations cv
  where cv.cliente_id = new.id and cv.corretor_id = new.corretor_id and cv.archived_at is null;
  return new;
end;
$$;
create trigger lotti_inbox_record_legacy_stage after update of status_funil on public.clientes
for each row execute function public.lotti_inbox_record_legacy_stage();

notify pgrst, 'reload schema';
commit;
