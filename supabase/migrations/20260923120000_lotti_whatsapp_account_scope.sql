-- Conversations belong to the WhatsApp number that produced them. The runtime now
-- sends the connected number (`account`) and the contact name (`name`) inside the
-- event/items, so RPC signatures stay the same and old/new runtimes both work.
-- When another number connects to the channel, the previous conversations move to
-- an archived channel (disabled, sandbox): nothing is deleted and the AI queue,
-- which only claims enabled channels, never processes them.
begin;

alter table public.lotti_agent_channels
  add column account_phone text check (account_phone ~ '^[0-9]{8,15}$'),
  add column archived_at timestamptz;
alter table public.lotti_agent_conversations
  add column contact_name text check (char_length(contact_name) between 1 and 120),
  add column archived_at timestamptz;
create index lotti_agent_conversation_active_idx on public.lotti_agent_conversations(corretor_id,updated_at desc) where archived_at is null;

create function public.lotti_agent_bind_account(p_channel uuid, p_account text) returns void
language plpgsql security invoker set search_path='' as $$
declare ch public.lotti_agent_channels; archive_id uuid;
begin
  if p_account is null then return; end if;
  if p_account !~ '^[0-9]{8,15}$' then raise exception 'invalid_account'; end if;
  select * into ch from public.lotti_agent_channels where id=p_channel for update;
  if ch.id is null or ch.account_phone is not distinct from p_account then return; end if;
  -- First identified number also archives legacy conversations of unknown origin;
  -- the connected number's history is re-imported on pairing.
  if exists(select 1 from public.lotti_agent_conversations where channel_id=ch.id) then
    insert into public.lotti_agent_channels(corretor_id,instance,enabled,sandbox,account_phone,archived_at)
    values(ch.corretor_id,'archived-'||ch.id||'-'||floor(extract(epoch from clock_timestamp())*1000)::bigint,false,true,ch.account_phone,now())
    returning id into archive_id;
    update public.lotti_agent_conversations set channel_id=archive_id,archived_at=now(),lease_token=null,lease_until=null
    where channel_id=ch.id;
    update public.lotti_agent_outbox o set status='cancelled' from public.lotti_agent_conversations c
    where o.conversation_id=c.id and c.channel_id=archive_id and o.status='prepared';
  end if;
  update public.lotti_agent_channels set account_phone=p_account where id=ch.id;
end $$;
revoke all on function public.lotti_agent_bind_account(uuid,text) from public,anon,authenticated;
grant execute on function public.lotti_agent_bind_account(uuid,text) to service_role;

create function public.lotti_agent_contact_name(p_value text) returns text
language sql immutable set search_path='' as $$
  -- Locale-independent: reject number-only fallbacks instead of matching letters.
  select case when v !~ '^[0-9 +().-]+$' and char_length(v) <= 120 then v end
  from (select nullif(btrim(regexp_replace(coalesce(p_value,''),'\s+',' ','g')),'') v) s
$$;
revoke all on function public.lotti_agent_contact_name(text) from public,anon,authenticated;
grant execute on function public.lotti_agent_contact_name(text) to service_role;

-- Same body as 20260912125137, plus account binding and contact names.
create or replace function public.lotti_agent_ingest(p_event jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ch public.lotti_agent_channels; cv public.lotti_agent_conversations; msg_id uuid; client_id uuid; is_out boolean:=coalesce((p_event->>'from_me')::boolean,false); is_ai boolean;
  v_account text:=case when p_event->>'account' ~ '^[0-9]{8,15}$' then p_event->>'account' end;
  v_name text:=case when not coalesce((p_event->>'from_me')::boolean,false) then public.lotti_agent_contact_name(p_event->>'name') end;
begin
 select * into ch from public.lotti_agent_channels where instance=p_event->>'instance';
 if ch.id is null then return jsonb_build_object('accepted',false,'reason','unregistered_channel'); end if;
 perform public.lotti_agent_bind_account(ch.id,v_account);
 insert into public.lotti_agent_conversations(channel_id,corretor_id,phone) values(ch.id,ch.corretor_id,p_event->>'phone') on conflict(channel_id,phone) do nothing;
 select * into cv from public.lotti_agent_conversations where channel_id=ch.id and phone=p_event->>'phone' for update;
 if v_name is not null and cv.contact_name is distinct from v_name then
   update public.lotti_agent_conversations set contact_name=v_name where id=cv.id;
 end if;
 is_ai:=is_out and exists(select 1 from public.lotti_agent_outbox where conversation_id=cv.id and external_id=p_event->>'external_id');
 insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content)
 values(cv.id,p_event->>'external_id',case when is_out then 'out' else 'in' end,case when is_ai then 'ai' when is_out then 'human' else 'lead' end,left(p_event->>'text',8000))
 on conflict(conversation_id,external_id) do nothing returning id into msg_id;
 if msg_id is null then return jsonb_build_object('accepted',true,'duplicate',true); end if;
 if is_ai then return jsonb_build_object('accepted',true,'echo',true); end if;
 -- Provider can echo our outbound before sendText returns its ID. Hold it for
 -- reconciliation in finish; a different ID is a real human intervention.
 if is_out and exists(select 1 from public.lotti_agent_outbox where conversation_id=cv.id and status='sending') then
   return jsonb_build_object('accepted',true,'pending_echo',true);
 end if;
 -- Capture cannot be lost when a legacy CRM insert is rejected by a plan trigger.
 if cv.cliente_id is null and not ch.sandbox then
   select id into client_id from public.clientes where corretor_id=ch.corretor_id and regexp_replace(telefone,'[^0-9]','','g')=cv.phone order by created_at limit 1;
   if client_id is null then
     begin
       insert into public.clientes(corretor_id,nome,telefone,status_funil,tipo_interesse)
       values(ch.corretor_id,coalesce(v_name,'Contato WhatsApp'),cv.phone,'QUALIFICACAO','AMBOS') returning id into client_id;
     exception when others then client_id:=null;
     end;
   end if;
   update public.lotti_agent_conversations set cliente_id=client_id,last_error=case when client_id is null then 'crm_capture_pending' else last_error end where id=cv.id;
 else client_id:=cv.cliente_id;
 end if;
 -- Replace only the placeholder this function created; never a name typed by the user.
 if client_id is not null and v_name is not null then
   update public.clientes set nome=v_name where id=client_id and nome='Contato WhatsApp';
 end if;
 if client_id is not null then
   insert into public.historico_contatos(cliente_id,tipo,direcao,conteudo,metadata)
   values(client_id,'WHATSAPP',case when is_out then 'OUT'::public.direcao_contato else 'IN'::public.direcao_contato end,p_event->>'text',jsonb_build_object('source','lotti_agent','message_id',msg_id));
 end if;
 update public.lotti_agent_conversations set revision=revision+1,updated_at=now(),next_attempt_at=now()+interval '3 seconds',
   mode=case when is_out or coalesce((p_event->>'unsupported')::boolean,false) then 'human' else mode end,
   attempts=0 where id=cv.id;
 if is_out or coalesce((p_event->>'unsupported')::boolean,false) then
   update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
   if not is_out and not ch.sandbox then
     insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
     values(cv.corretor_id,client_id,'GERAL','Mensagem de áudio ou mídia: atendimento humano necessário',jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
   end if;
 end if;
 return jsonb_build_object('accepted',true,'conversation_id',cv.id);
end $$;

-- Same body as 20260920000100, plus account binding and contact names per item.
create or replace function public.lotti_agent_import_history(p_instance text, p_messages jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  ch public.lotti_agent_channels;
  cv public.lotti_agent_conversations;
  item jsonb;
  v_phone text;
  v_external_id text;
  v_name text;
  body text;
  stamp timestamptz;
  imported int := 0;
begin
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 200 then
    raise exception 'invalid_history_batch';
  end if;
  select * into ch from public.lotti_agent_channels where instance = p_instance;
  if ch.id is null then raise exception 'unknown_channel'; end if;
  perform public.lotti_agent_bind_account(ch.id,(
    select i->>'account' from jsonb_array_elements(p_messages) i where i->>'account' ~ '^[0-9]{8,15}$' limit 1));
  for item in select value from jsonb_array_elements(p_messages) loop
    v_phone := item->>'phone';
    v_external_id := item->>'external_id';
    body := item->>'text';
    if v_phone is null or v_phone !~ '^[0-9]{8,15}$' or v_external_id is null or length(v_external_id) > 128
       or length(v_external_id) = 0 or body is null or length(body) > 8000
       or jsonb_typeof(item->'from_me') <> 'boolean' then
      raise exception 'invalid_history_message';
    end if;
    stamp := (item->>'created_at')::timestamptz;
    if stamp < '2000-01-01'::timestamptz or stamp > now() + interval '1 day' then
      raise exception 'invalid_history_timestamp';
    end if;
    v_name := case when not (item->>'from_me')::boolean then public.lotti_agent_contact_name(item->>'name') end;
    insert into public.lotti_agent_conversations(channel_id,corretor_id,phone,mode,updated_at)
    values(ch.id,ch.corretor_id,v_phone,'human',stamp)
    on conflict(channel_id,phone) do nothing;
    select * into cv from public.lotti_agent_conversations c where c.channel_id=ch.id and c.phone=v_phone;
    if v_name is not null and cv.contact_name is distinct from v_name then
      update public.lotti_agent_conversations set contact_name=v_name where id=cv.id;
    end if;
    insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content,created_at)
    values(cv.id,v_external_id,case when (item->>'from_me')::boolean then 'out' else 'in' end,
      case when (item->>'from_me')::boolean then 'human' else 'lead' end,body,stamp)
    on conflict(conversation_id,external_id) do nothing;
    if found then
      imported := imported+1;
      update public.lotti_agent_conversations set updated_at=greatest(updated_at,stamp) where id=cv.id;
    end if;
  end loop;
  return jsonb_build_object('imported',imported);
end $$;

-- Current public host of the runtime's Quick Tunnel. Only the runtime writes it
-- and only the Edge Function (service role) reads it; the token is not stored.
create table public.lotti_agent_bridge_endpoint (
  id boolean primary key default true check (id),
  host text not null check (host ~ '^[a-z0-9-]+\.trycloudflare\.com$'),
  updated_at timestamptz not null default now()
);
alter table public.lotti_agent_bridge_endpoint enable row level security;
revoke all on public.lotti_agent_bridge_endpoint from public,anon,authenticated;
grant select,insert,update on public.lotti_agent_bridge_endpoint to service_role;
create policy lotti_agent_bridge_service on public.lotti_agent_bridge_endpoint for all to service_role using (true) with check (true);

create function public.lotti_agent_register_bridge(p_host text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if p_host is null or p_host !~ '^[a-z0-9-]+\.trycloudflare\.com$' then raise exception 'invalid_bridge_host'; end if;
  insert into public.lotti_agent_bridge_endpoint(id,host,updated_at) values(true,p_host,now())
  on conflict(id) do update set host=excluded.host,updated_at=excluded.updated_at;
  return true;
end $$;
revoke all on function public.lotti_agent_register_bridge(text) from public,anon,authenticated;
grant execute on function public.lotti_agent_register_bridge(text) to service_role;

notify pgrst,'reload schema';
commit;
