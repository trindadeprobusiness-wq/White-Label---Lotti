begin;

-- The same phone is written in several ways: WhatsApp and the agent use the
-- country code (5562911110002), the CRM forms save the national format
-- ((62) 91111-0002), and older mobiles may lack the 9th digit (556291110002).
-- lotti_phone_key reduces a Brazilian number to area code + last 8 digits, so
-- all of them find the same client. Other numbers keep their digits.
create or replace function public.lotti_phone_key(p_value text) returns text
language sql immutable set search_path='' as $$
  select case
    when d ~ '^55[0-9]{10,11}$' then substr(d,3,2)||right(d,8)
    when length(d) in (10,11) then left(d,2)||right(d,8)
    else nullif(d,'')
  end
  from (select regexp_replace(coalesce(p_value,''),'[^0-9]','','g') as d) s
$$;
create index if not exists clientes_corretor_phone_key_idx on public.clientes(corretor_id, public.lotti_phone_key(telefone));

-- Automatic capture (live messages) and "Nova conversa" now find the client by
-- that key: same as 20260928190000 / 20260927130000 apart from the lookup.
create or replace function public.lotti_agent_ingest(p_event jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ch public.lotti_agent_channels; cv public.lotti_agent_conversations; msg_id uuid; client_id uuid; is_out boolean:=coalesce((p_event->>'from_me')::boolean,false); is_ai boolean;
  v_account text:=case when p_event->>'account' ~ '^[0-9]{8,15}$' then p_event->>'account' end;
  v_name text:=case when not coalesce((p_event->>'from_me')::boolean,false) then public.lotti_agent_contact_name(p_event->>'name') end;
  v_profile text:=public.lotti_agent_contact_name(p_event->>'profile');
begin
 select * into ch from public.lotti_agent_channels where instance=p_event->>'instance';
 if ch.id is null then return jsonb_build_object('accepted',false,'reason','unregistered_channel'); end if;
 perform public.lotti_agent_bind_account(ch.id,v_account);
 cv:=public.lotti_agent_resolve_conversation(ch.id,p_event->>'phone',p_event->>'lid');
 if v_name is not null and cv.contact_name is distinct from v_name and cv.contact_name_source is distinct from 'typed' then
   update public.lotti_agent_conversations set contact_name=v_name,contact_name_source='saved' where id=cv.id;
   cv.contact_name:=v_name;
 elsif v_name is null and v_profile is not null and cv.contact_name is null then
   update public.lotti_agent_conversations set contact_name=v_profile,contact_name_source='profile' where id=cv.id;
   cv.contact_name:=v_profile;
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
 if cv.cliente_id is null and not ch.sandbox and cv.phone is not null then
   select id into client_id from public.clientes where corretor_id=ch.corretor_id and public.lotti_phone_key(telefone)=public.lotti_phone_key(cv.phone) order by created_at limit 1;
   if client_id is null then
     begin
       insert into public.clientes(corretor_id,nome,telefone,status_funil,tipo_interesse)
       values(ch.corretor_id,coalesce(cv.contact_name,'Contato WhatsApp'),cv.phone,'QUALIFICACAO','AMBOS') returning id into client_id;
     exception when others then client_id:=null;
     end;
   end if;
   update public.lotti_agent_conversations set cliente_id=client_id,last_error=case when client_id is null then 'crm_capture_pending' else last_error end where id=cv.id;
 else client_id:=cv.cliente_id;
 end if;
 -- Replace only the placeholder this function created; never a name typed by the user.
 if client_id is not null and cv.contact_name is not null then
   update public.clientes set nome=cv.contact_name where id=client_id and nome='Contato WhatsApp';
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
  select id into v_channel from public.lotti_agent_channels where corretor_id=v_owner and archived_at is null and not sandbox order by created_at desc limit 1;
  if v_channel is null then raise exception 'channel_unavailable'; end if;
  select id into v_client from public.clientes where corretor_id=v_owner and public.lotti_phone_key(telefone)=public.lotti_phone_key(v_phone) order by created_at limit 1;
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

-- Conversations imported from the WhatsApp history do not become CRM clients by
-- themselves (the broker's WhatsApp also has family, friends and suppliers).
-- The broker adds one with a click in the Inbox: an existing client with the
-- same phone is linked instead of duplicated, and a hidden number (LID only)
-- waits for WhatsApp to reveal the phone, as automatic capture does.
create or replace function public.lotti_inbox_add_to_crm(p_conversation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_phone text; v_name text; v_client uuid; v_created boolean:=false;
begin
  select c.corretor_id,c.phone,c.contact_name,c.cliente_id into v_owner,v_phone,v_name,v_client
    from public.lotti_agent_conversations c where c.id=p_conversation for update;
  if v_owner is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then
    raise exception 'forbidden';
  end if;
  if v_client is not null then
    return jsonb_build_object('cliente_id',v_client,'created',false);
  end if;
  if v_phone is null then raise exception 'phone_required'; end if;
  select id into v_client from public.clientes
    where corretor_id=v_owner and public.lotti_phone_key(telefone)=public.lotti_phone_key(v_phone) order by created_at limit 1;
  if v_client is null then
    insert into public.clientes(corretor_id,nome,telefone,status_funil,tipo_interesse)
    values(v_owner,coalesce(v_name,'Contato WhatsApp'),v_phone,'QUALIFICACAO','AMBOS') returning id into v_client;
    v_created:=true;
  end if;
  update public.lotti_agent_conversations
    set cliente_id=v_client,last_error=case when last_error='crm_capture_pending' then null else last_error end
    where id=p_conversation;
  return jsonb_build_object('cliente_id',v_client,'created',v_created);
end $$;

revoke all on function public.lotti_agent_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.lotti_agent_ingest(jsonb) to service_role;
revoke all on function public.lotti_inbox_start_conversation(text,text) from public,anon;
grant execute on function public.lotti_inbox_start_conversation(text,text) to authenticated;
revoke all on function public.lotti_inbox_add_to_crm(uuid) from public,anon;
grant execute on function public.lotti_inbox_add_to_crm(uuid) to authenticated;

commit;
