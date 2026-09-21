begin;

alter table public.lotti_agent_conversations
  add column if not exists status text not null default 'open'
  check (status in ('open','closed'));

create or replace function public.lotti_inbox_start_conversation(p_phone text, p_name text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_channel uuid; v_client uuid; v_conversation uuid;
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_name text:=nullif(left(trim(coalesce(p_name,'')),120),'');
begin
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if length(v_phone)<12 or length(v_phone)>15 then raise exception 'invalid_phone'; end if;
  select id into v_owner from public.corretores where user_id=auth.uid() order by id limit 1;
  if v_owner is null then raise exception 'forbidden'; end if;
  select id into v_channel from public.lotti_agent_channels where corretor_id=v_owner and enabled order by id limit 1;
  if v_channel is null then raise exception 'channel_unavailable'; end if;
  select id into v_client from public.clientes where corretor_id=v_owner and regexp_replace(telefone,'[^0-9]','','g')=v_phone order by created_at limit 1;
  if v_client is null then
    insert into public.clientes(corretor_id,nome,telefone,status_funil,tipo_interesse)
    values(v_owner,coalesce(v_name,'Contato WhatsApp'),v_phone,'QUALIFICACAO','AMBOS') returning id into v_client;
  elsif v_name is not null then
    update public.clientes set nome=v_name where id=v_client and nome='Contato WhatsApp';
  end if;
  insert into public.lotti_agent_conversations(channel_id,corretor_id,cliente_id,phone,mode,status)
  values(v_channel,v_owner,v_client,v_phone,'human','open')
  on conflict(channel_id,phone) do update set cliente_id=coalesce(public.lotti_agent_conversations.cliente_id,excluded.cliente_id),status='open',updated_at=now()
  returning id into v_conversation;
  return v_conversation;
end $$;

create or replace function public.lotti_inbox_rename_client(p_conversation uuid,p_name text)
returns text language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_client uuid; v_name text:=left(trim(coalesce(p_name,'')),120);
begin
  if length(v_name)<1 then raise exception 'invalid_name'; end if;
  select c.corretor_id,c.cliente_id into v_owner,v_client from public.lotti_agent_conversations c where c.id=p_conversation;
  if v_client is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then raise exception 'forbidden'; end if;
  update public.clientes set nome=v_name where id=v_client and corretor_id=v_owner;
  if not found then raise exception 'forbidden'; end if;
  return v_name;
end $$;

create or replace function public.lotti_inbox_set_status(p_conversation uuid,p_status text)
returns text language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  if p_status not in ('open','closed') then raise exception 'invalid_status'; end if;
  select corretor_id into v_owner from public.lotti_agent_conversations where id=p_conversation;
  if not exists(select 1 from public.corretores where id=v_owner and user_id=auth.uid()) then raise exception 'forbidden'; end if;
  update public.lotti_agent_conversations set status=p_status,mode=case when p_status='closed' then 'paused' else mode end,updated_at=now() where id=p_conversation;
  return p_status;
end $$;

create or replace function public.lotti_inbox_reopen_on_inbound() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.direction='in' then update public.lotti_agent_conversations set status='open',updated_at=now() where id=new.conversation_id; end if;
  return new;
end $$;
drop trigger if exists lotti_inbox_reopen_on_inbound on public.lotti_agent_messages;
create trigger lotti_inbox_reopen_on_inbound after insert on public.lotti_agent_messages for each row execute function public.lotti_inbox_reopen_on_inbound();

revoke all on function public.lotti_inbox_start_conversation(text,text),public.lotti_inbox_rename_client(uuid,text),public.lotti_inbox_set_status(uuid,text) from public,anon;
grant execute on function public.lotti_inbox_start_conversation(text,text),public.lotti_inbox_rename_client(uuid,text),public.lotti_inbox_set_status(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
