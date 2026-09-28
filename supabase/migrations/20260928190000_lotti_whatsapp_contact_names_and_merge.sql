begin;

-- Contact names on WhatsApp conversations, by source:
--   typed   - written by the broker in the Inbox; nothing from WhatsApp replaces it.
--   saved   - the name in the phone's address book (`name`); replaces any other.
--   profile - the contact's WhatsApp profile name (`profile`); only fills an empty name.
-- Names stored before this migration have no source and can be replaced by a
-- saved name. The CRM record created by the first message uses the same name.
alter table public.lotti_agent_conversations
  add column if not exists contact_name_source text check (contact_name_source in ('typed','saved','profile'));

-- Adjusts the merge from 20260926200000 (hidden-number conversations): the
-- kept conversation also keeps the opt-out, the follow-up progress, the name
-- source and the broadcast deliveries of the merged one. A delivery that went
-- out (or may have) wins over a pending one of the same campaign, so a merge
-- never makes a campaign reach the contact twice.
create or replace function public.lotti_agent_merge_conversation(p_keep uuid,p_drop uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare keep_row public.lotti_agent_conversations; drop_row public.lotti_agent_conversations; v_opted timestamptz; v_mode text;
begin
  if p_keep=p_drop then return; end if;
  select * into keep_row from public.lotti_agent_conversations where id=p_keep for update;
  select * into drop_row from public.lotti_agent_conversations where id=p_drop for update;
  if keep_row.id is null or drop_row.id is null or keep_row.channel_id<>drop_row.channel_id then
    raise exception 'invalid_merge';
  end if;
  delete from public.lotti_agent_messages d using public.lotti_agent_messages k
    where d.conversation_id=p_drop and k.conversation_id=p_keep and k.external_id=d.external_id;
  update public.lotti_agent_messages set conversation_id=p_keep where conversation_id=p_drop;
  update public.lotti_manual_sends set conversation_id=p_keep where conversation_id=p_drop;
  update public.lotti_inbox_events set conversation_id=p_keep where conversation_id=p_drop;
  delete from public.lotti_broadcast_deliveries k using public.lotti_broadcast_deliveries d
    where k.conversation_id=p_keep and d.conversation_id=p_drop and d.campaign_id=k.campaign_id
      and k.status in ('pending','cancelled','skipped','failed') and d.status in ('sending','sent','uncertain');
  update public.lotti_broadcast_deliveries d set conversation_id=p_keep
    where d.conversation_id=p_drop
      and not exists(select 1 from public.lotti_broadcast_deliveries k where k.conversation_id=p_keep and k.campaign_id=d.campaign_id);
  delete from public.lotti_agent_conversations where id=p_drop;
  v_opted:=greatest(keep_row.opted_out_at,drop_row.opted_out_at);
  -- Mode first: the opt-out guard refuses an opted-out conversation in 'ai', and
  -- mode is only written when it changes, so the manual-send guard is not triggered needlessly.
  v_mode:=case when keep_row.mode='ai' and drop_row.mode<>'ai' then drop_row.mode
               when keep_row.mode='ai' and v_opted is not null then 'human' else keep_row.mode end;
  if v_mode is distinct from keep_row.mode then
    update public.lotti_agent_conversations set mode=v_mode,lease_token=null,lease_until=null where id=p_keep;
  end if;
  update public.lotti_agent_conversations set
    lid=coalesce(keep_row.lid,drop_row.lid),
    contact_name=coalesce(keep_row.contact_name,drop_row.contact_name),
    contact_name_source=case when keep_row.contact_name is not null then keep_row.contact_name_source else drop_row.contact_name_source end,
    cliente_id=coalesce(keep_row.cliente_id,drop_row.cliente_id),
    qualification=case when keep_row.qualification='{}'::jsonb then drop_row.qualification else keep_row.qualification end,
    notified_stage=coalesce(keep_row.notified_stage,drop_row.notified_stage),
    status=case when 'open' in (keep_row.status,drop_row.status) then 'open' else keep_row.status end,
    opted_out_at=v_opted,
    followup_step=greatest(keep_row.followup_step,drop_row.followup_step),
    updated_at=greatest(keep_row.updated_at,drop_row.updated_at)
  where id=p_keep;
end $$;

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
   select id into client_id from public.clientes where corretor_id=ch.corretor_id and regexp_replace(telefone,'[^0-9]','','g')=cv.phone order by created_at limit 1;
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

create or replace function public.lotti_agent_import_history(p_instance text, p_messages jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  ch public.lotti_agent_channels;
  cv public.lotti_agent_conversations;
  item jsonb;
  v_phone text;
  v_lid text;
  v_external_id text;
  v_name text;
  v_profile text;
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
    v_phone := nullif(item->>'phone','');
    v_lid := nullif(item->>'lid','');
    v_external_id := item->>'external_id';
    body := item->>'text';
    if (v_phone is null and v_lid is null) or v_phone !~ '^[0-9]{8,15}$' or v_lid !~ '^[0-9]{6,20}$'
       or v_external_id is null or length(v_external_id) > 128
       or length(v_external_id) = 0 or body is null or length(body) > 8000
       or jsonb_typeof(item->'from_me') <> 'boolean' then
      raise exception 'invalid_history_message';
    end if;
    stamp := (item->>'created_at')::timestamptz;
    if stamp < '2000-01-01'::timestamptz or stamp > now() + interval '1 day' then
      raise exception 'invalid_history_timestamp';
    end if;
    v_name := case when not (item->>'from_me')::boolean then public.lotti_agent_contact_name(item->>'name') end;
    v_profile := public.lotti_agent_contact_name(item->>'profile');
    cv := public.lotti_agent_resolve_conversation(ch.id,v_phone,v_lid,'human',stamp);
    if v_name is not null and cv.contact_name is distinct from v_name and cv.contact_name_source is distinct from 'typed' then
      update public.lotti_agent_conversations set contact_name=v_name,contact_name_source='saved' where id=cv.id;
    elsif v_name is null and v_profile is not null and cv.contact_name is null then
      update public.lotti_agent_conversations set contact_name=v_profile,contact_name_source='profile' where id=cv.id;
    end if;
    insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content,created_at)
    values(cv.id,v_external_id,case when (item->>'from_me')::boolean then 'out' else 'in' end,
      case when (item->>'from_me')::boolean then 'human' else 'lead' end,body,stamp)
    on conflict(conversation_id,external_id) do nothing;
    if found then
      imported := imported+1;
      update public.lotti_agent_conversations set updated_at=greatest(updated_at,stamp) where id=cv.id;
      -- Whoever has history already existed when the number was connected: the
      -- team attends them, not the AI, even if a live message arrived first.
      if cv.mode='ai' then
        update public.lotti_agent_conversations set mode='human' where id=cv.id;
        update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
      end if;
    end if;
  end loop;
  return jsonb_build_object('imported',imported);
end $$;

-- Same as 20260926200000, plus: a name typed in the Inbox is marked 'typed',
-- so no name coming from WhatsApp replaces it afterwards.
create or replace function public.lotti_inbox_update_contact(p_conversation uuid,p_name text,p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_client uuid; v_current_phone text; v_lid text;
  v_name text:=left(trim(coalesce(p_name,'')),120);
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
  if length(v_name)<1 then raise exception 'invalid_name'; end if;
  select c.corretor_id,c.cliente_id,c.phone,c.lid into v_owner,v_client,v_current_phone,v_lid
    from public.lotti_agent_conversations c where c.id=p_conversation for update;
  if v_owner is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then raise exception 'forbidden'; end if;
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if v_lid is not null then
    if v_phone<>'' and v_phone is distinct from v_current_phone then raise exception 'phone_managed_by_whatsapp'; end if;
    v_phone:=v_current_phone;
  elsif length(v_phone)<12 or length(v_phone)>15 then
    raise exception 'invalid_phone';
  end if;
  if v_current_phone is distinct from v_phone then
    if exists(select 1 from public.lotti_agent_outbox where conversation_id=p_conversation and status in ('sending','uncertain'))
       or exists(select 1 from public.lotti_manual_sends where conversation_id=p_conversation and status in ('sending','uncertain')) then
      raise exception 'delivery_pending';
    end if;
    update public.lotti_agent_outbox set status='cancelled' where conversation_id=p_conversation and status='prepared';
  end if;
  update public.lotti_agent_conversations set phone=v_phone,contact_name=v_name,contact_name_source='typed',mode=case when v_current_phone is distinct from v_phone then 'human' else mode end,
    lease_token=case when v_current_phone is distinct from v_phone then null else lease_token end,lease_until=case when v_current_phone is distinct from v_phone then null else lease_until end,updated_at=now()
    where id=p_conversation and corretor_id=v_owner;
  if v_client is not null then
    update public.clientes set nome=v_name,telefone=coalesce(v_phone,telefone) where id=v_client and corretor_id=v_owner;
    if not found then raise exception 'forbidden'; end if;
  end if;
  return jsonb_build_object('name',v_name,'phone',v_phone);
exception when unique_violation then
  raise exception 'phone_already_in_use';
end $$;

revoke all on function public.lotti_agent_merge_conversation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lotti_agent_merge_conversation(uuid,uuid) to service_role;
revoke all on function public.lotti_inbox_update_contact(uuid,text,text) from public,anon;
grant execute on function public.lotti_inbox_update_contact(uuid,text,text) to authenticated;
revoke all on function public.lotti_agent_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.lotti_agent_ingest(jsonb) to service_role;
revoke all on function public.lotti_agent_import_history(text,jsonb) from public,anon,authenticated;
grant execute on function public.lotti_agent_import_history(text,jsonb) to service_role;

commit;
