begin;

alter table public.lotti_agent_channels
  add column if not exists company_name text;

create or replace function public.lotti_channel_reset_company_on_number_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.account_phone is distinct from old.account_phone then
    new.company_name := null;
  end if;
  return new;
end;
$$;

create trigger lotti_channel_reset_company_on_number_change
before update of account_phone on public.lotti_agent_channels
for each row execute function public.lotti_channel_reset_company_on_number_change();

create or replace function public.lotti_channel_set_company_name(p_phone text, p_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 80 then
    raise exception 'invalid_company_name';
  end if;
  update public.lotti_agent_channels ch
     set company_name = trim(p_name)
   where ch.account_phone = p_phone and ch.archived_at is null
     and ch.corretor_id in (
       select c.id from public.corretores c where c.user_id = (select auth.uid())
     );
  return found;
end;
$$;

revoke all on function public.lotti_channel_set_company_name(text,text) from public, anon;
grant execute on function public.lotti_channel_set_company_name(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
