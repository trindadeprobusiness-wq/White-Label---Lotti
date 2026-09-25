begin;

alter table public.lotti_inbox_events drop constraint lotti_inbox_events_kind_check;
alter table public.lotti_inbox_events add constraint lotti_inbox_events_kind_check check (kind in ('mode', 'stage', 'status'));

create or replace function public.lotti_inbox_record_mode() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Closing also pauses the IA, but the event people need to see is the closure.
  if new.status = 'closed' and new.status is distinct from old.status then return new; end if;
  if new.mode is distinct from old.mode then
    insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
    values (new.id, 'mode', old.mode, case new.mode when 'ai' then 'IA' when 'human' then 'Equipe' else 'Pausada' end, public.lotti_inbox_event_actor());
  end if;
  return new;
end;
$$;

create function public.lotti_inbox_record_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
    values (new.id, 'status', case old.status when 'closed' then 'Fechada' else 'Aberta' end,
      case new.status when 'closed' then 'Fechada' else 'Aberta' end, public.lotti_inbox_event_actor());
  end if;
  return new;
end;
$$;
create trigger lotti_inbox_record_status after update of status on public.lotti_agent_conversations
for each row execute function public.lotti_inbox_record_status();

commit;
