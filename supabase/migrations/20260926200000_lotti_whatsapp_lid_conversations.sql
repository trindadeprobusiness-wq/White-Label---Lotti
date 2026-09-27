begin;

-- WhatsApp can hide a contact's number behind a LID (an opaque account id).
-- A conversation may start with only the LID and receives the phone when the
-- provider reveals it. The phone is never guessed.
alter table public.lotti_agent_conversations
  add column if not exists lid text check (lid ~ '^[0-9]{6,20}$'),
  alter column phone drop not null;
alter table public.lotti_agent_conversations
  add constraint lotti_agent_conversation_contact_check check (phone is not null or lid is not null);
create unique index if not exists lotti_agent_conversation_lid_key
  on public.lotti_agent_conversations(channel_id,lid) where lid is not null;

-- Moves a LID-only conversation into the conversation that already has the
-- phone. Duplicate provider messages are kept once; the dropped row's outbox
-- is removed by cascade.
create or replace function public.lotti_agent_merge_conversation(p_keep uuid,p_drop uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare keep_row public.lotti_agent_conversations; drop_row public.lotti_agent_conversations;
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
  delete from public.lotti_agent_conversations where id=p_drop;
  update public.lotti_agent_conversations set
    lid=coalesce(keep_row.lid,drop_row.lid),
    contact_name=coalesce(keep_row.contact_name,drop_row.contact_name),
    cliente_id=coalesce(keep_row.cliente_id,drop_row.cliente_id),
    qualification=coalesce(keep_row.qualification,drop_row.qualification),
    updated_at=greatest(keep_row.updated_at,drop_row.updated_at)
  where id=p_keep;
end $$;

-- Finds or creates the conversation for a phone and/or LID in one channel.
-- When both identifiers point to different rows, the LID row is merged into
-- the phone row. A phone already bound to another LID is left untouched.
create or replace function public.lotti_agent_resolve_conversation(
  p_channel uuid,p_phone text,p_lid text,p_mode text default null,p_updated_at timestamptz default now())
returns public.lotti_agent_conversations
language plpgsql security invoker set search_path='' as $$
declare
  ch public.lotti_agent_channels; by_phone public.lotti_agent_conversations; by_lid public.lotti_agent_conversations;
  v_phone text:=nullif(p_phone,''); v_lid text:=nullif(p_lid,''); v_id uuid; result public.lotti_agent_conversations;
begin
  if (v_phone is null and v_lid is null) or v_phone !~ '^[0-9]{8,15}$' or v_lid !~ '^[0-9]{6,20}$' then
    raise exception 'invalid_contact';
  end if;
  select * into ch from public.lotti_agent_channels where id=p_channel;
  if ch.id is null then raise exception 'unknown_channel'; end if;
  if v_phone is not null then
    select * into by_phone from public.lotti_agent_conversations where channel_id=p_channel and phone=v_phone for update;
  end if;
  if v_lid is not null then
    select * into by_lid from public.lotti_agent_conversations where channel_id=p_channel and lid=v_lid for update;
  end if;
  if by_phone.id is not null and by_lid.id is not null and by_phone.id<>by_lid.id then
    if by_phone.lid is null then perform public.lotti_agent_merge_conversation(by_phone.id,by_lid.id); end if;
    v_id:=by_phone.id;
  elsif by_phone.id is not null then
    if v_lid is not null and by_phone.lid is null then
      update public.lotti_agent_conversations set lid=v_lid where id=by_phone.id;
    end if;
    v_id:=by_phone.id;
  elsif by_lid.id is not null then
    -- The provider's number wins over one typed by hand; no other row has it.
    if v_phone is not null and by_lid.phone is distinct from v_phone then
      update public.lotti_agent_conversations set phone=v_phone where id=by_lid.id;
    end if;
    v_id:=by_lid.id;
  else
    if p_mode is null then
      insert into public.lotti_agent_conversations(channel_id,corretor_id,phone,lid,updated_at)
      values(p_channel,ch.corretor_id,v_phone,v_lid,p_updated_at) on conflict do nothing returning id into v_id;
    else
      insert into public.lotti_agent_conversations(channel_id,corretor_id,phone,lid,mode,updated_at)
      values(p_channel,ch.corretor_id,v_phone,v_lid,p_mode,p_updated_at) on conflict do nothing returning id into v_id;
    end if;
    if v_id is null then -- created concurrently by another event
      select id into v_id from public.lotti_agent_conversations
      where channel_id=p_channel and ((v_phone is not null and phone=v_phone) or (v_lid is not null and lid=v_lid))
      order by phone is null limit 1;
    end if;
  end if;
  select * into result from public.lotti_agent_conversations where id=v_id for update;
  return result;
end $$;

revoke all on function public.lotti_agent_merge_conversation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.lotti_agent_resolve_conversation(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.lotti_agent_merge_conversation(uuid,uuid) to service_role;
grant execute on function public.lotti_agent_resolve_conversation(uuid,text,text,text,timestamptz) to service_role;

-- Live messages: resolve by phone and/or LID. The CRM record is created only
-- once the phone is known.
create or replace function public.lotti_agent_ingest(p_event jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ch public.lotti_agent_channels; cv public.lotti_agent_conversations; msg_id uuid; client_id uuid; is_out boolean:=coalesce((p_event->>'from_me')::boolean,false); is_ai boolean;
  v_account text:=case when p_event->>'account' ~ '^[0-9]{8,15}$' then p_event->>'account' end;
  v_name text:=case when not coalesce((p_event->>'from_me')::boolean,false) then public.lotti_agent_contact_name(p_event->>'name') end;
begin
 select * into ch from public.lotti_agent_channels where instance=p_event->>'instance';
 if ch.id is null then return jsonb_build_object('accepted',false,'reason','unregistered_channel'); end if;
 perform public.lotti_agent_bind_account(ch.id,v_account);
 cv:=public.lotti_agent_resolve_conversation(ch.id,p_event->>'phone',p_event->>'lid');
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
 if cv.cliente_id is null and not ch.sandbox and cv.phone is not null then
   select id into client_id from public.clientes where corretor_id=ch.corretor_id and regexp_replace(telefone,'[^0-9]','','g')=cv.phone order by created_at limit 1;
   if client_id is null then
     begin
       insert into public.clientes(corretor_id,nome,telefone,status_funil,tipo_interesse)
       values(ch.corretor_id,coalesce(v_name,cv.contact_name,'Contato WhatsApp'),cv.phone,'QUALIFICACAO','AMBOS') returning id into client_id;
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

-- History: each item carries a phone and/or a LID. New conversations keep the
-- date of the imported message so old chats do not jump to the top.
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
    cv := public.lotti_agent_resolve_conversation(ch.id,v_phone,v_lid,'human',stamp);
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

-- Automatic replies: quota is counted per contact, by phone or by LID, and the
-- runtime receives the LID to reach a contact whose number is hidden.
create or replace function public.lotti_agent_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; token uuid:=gen_random_uuid(); pstart date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date; allowance int; unlimited_flag boolean; used int; contact_key text;
begin
 -- Never replay a send after a worker crash: delivery may have succeeded.
 update public.lotti_agent_outbox o set status='uncertain' from public.lotti_agent_conversations c
 where o.conversation_id=c.id and o.status='sending' and c.lease_until<now();
 update public.lotti_agent_conversations c set mode='human',last_error='delivery_uncertain'
 where c.mode='ai' and exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status='uncertain');
 select c.* into cv from public.lotti_agent_conversations c join public.lotti_agent_channels h on h.id=c.channel_id
 where h.enabled and c.mode='ai' and c.revision>c.processed_revision and c.next_attempt_at<=now()
 and (c.lease_until is null or c.lease_until<now())
 and not exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status in ('sending','uncertain'))
 order by c.next_attempt_at for update of c skip locked limit 1;
 if cv.id is null then return null; end if;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 contact_key:=coalesce(cv.phone,'lid:'||cv.lid);
 if not ch.sandbox then
   -- One lock per account serializes quota reservations across workers/channels.
   perform pg_advisory_xact_lock(hashtextextended(ch.corretor_id::text, 714));
   select e.limit_value,e.unlimited into allowance,unlimited_flag from public.subscriptions s
   join public.plan_entitlements e on e.plan_id=s.plan_id and e.feature_key='leads_qualificados_monthly' and e.enabled
   where s.corretor_id=ch.corretor_id and s.status in ('active','trialing')
   and (case when s.status='trialing' then s.trial_ends_at else s.current_period_end end)>now()
   order by s.created_at desc limit 1;
   if allowance is null and not coalesce(unlimited_flag,false) then
     update public.lotti_agent_conversations set mode='human',last_error='no_active_entitlement' where id=cv.id;
     insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem) values(cv.corretor_id,cv.cliente_id,'GERAL','Novo contato aguardando atendimento: plano de IA indisponível',jsonb_build_object('source','lotti_agent','conversation_id',cv.id),'ia');
     return jsonb_build_object('blocked','no_active_entitlement');
   end if;
   if not exists(select 1 from public.lotti_agent_usage where corretor_id=ch.corretor_id and phone=contact_key and period_start=pstart) then
     select coalesce(max(used_quantity),0) into used from public.usage_counters where corretor_id=ch.corretor_id and feature_key='leads_qualificados_monthly' and period_start=pstart;
     if not coalesce(unlimited_flag,false) and used>=allowance then
       update public.lotti_agent_conversations set mode='human',last_error='quota_exhausted' where id=cv.id;
       insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem) values(cv.corretor_id,cv.cliente_id,'GERAL','Novo contato aguardando atendimento: franquia de IA atingida',jsonb_build_object('source','lotti_agent','conversation_id',cv.id),'ia');
       return jsonb_build_object('blocked','quota_exhausted');
     end if;
     insert into public.lotti_agent_usage(corretor_id,phone,period_start) values(ch.corretor_id,contact_key,pstart);
     insert into public.usage_counters(corretor_id,feature_key,used_quantity,period_start,period_end)
     values(ch.corretor_id,'leads_qualificados_monthly',1,pstart,(pstart+interval '1 month'-interval '1 day')::date)
     on conflict(corretor_id,feature_key,period_start) do update set used_quantity=public.usage_counters.used_quantity+1,updated_at=now();
   end if;
 end if;
 update public.lotti_agent_conversations set lease_token=token,lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=cv.id;
 return jsonb_build_object('id',cv.id,'token',token,'revision',cv.revision,'corretor_id',cv.corretor_id,'instance',ch.instance,'phone',cv.phone,'lid',cv.lid,'sandbox',ch.sandbox,'profile',cv.qualification);
end $$;

create or replace function public.lotti_agent_begin_send(p_id uuid,p_token uuid,p_revision bigint,p_live boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; ob public.lotti_agent_outbox;
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 select * into ob from public.lotti_agent_outbox where conversation_id=p_id and revision=p_revision for update;
 if cv.lease_token is distinct from p_token or cv.lease_until<now() or cv.mode<>'ai' or cv.revision<>p_revision or not ch.enabled or ob.status is distinct from 'prepared' then
   update public.lotti_agent_outbox set status='cancelled' where id=ob.id and status='prepared';
   return jsonb_build_object('cancelled',true);
 end if;
 if ch.sandbox then
   update public.lotti_agent_outbox set status='simulated' where id=ob.id;
   insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content) values(p_id,'simulation:'||ob.id,'out','ai',ob.content);
   update public.lotti_agent_conversations set processed_revision=p_revision,lease_token=null,lease_until=null,attempts=0 where id=p_id;
   return jsonb_build_object('simulated',true);
 end if;
 if not p_live then return jsonb_build_object('blocked','live_send_disabled'); end if;
 update public.lotti_agent_outbox set status='sending' where id=ob.id;
 return jsonb_build_object('outbox_id',ob.id,'content',ob.content,'instance',ch.instance,'phone',cv.phone,'lid',cv.lid);
end $$;

create or replace function public.lotti_manual_begin(p_owner uuid,p_conversation uuid,p_request uuid,p_fingerprint text,p_content text,p_media text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; prior public.lotti_manual_sends;
begin
 select * into cv from public.lotti_agent_conversations where id=p_conversation and corretor_id=p_owner for update;
 if cv.id is null then raise exception 'forbidden'; end if;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if ch.sandbox then raise exception 'sandbox'; end if;
 update public.lotti_manual_sends set status='uncertain' where conversation_id=cv.id and status='sending' and created_at<now()-interval '2 minutes';
 select * into prior from public.lotti_manual_sends where request_id=p_request;
 if prior.request_id is not null then
  if prior.corretor_id<>p_owner or prior.conversation_id<>p_conversation or prior.fingerprint<>p_fingerprint then raise exception 'request_conflict'; end if;
  return jsonb_build_object('status',prior.status,'duplicate',true);
 end if;
 if exists(select 1 from public.lotti_agent_outbox where conversation_id=cv.id and status in ('sending','uncertain'))
 or exists(select 1 from public.lotti_manual_sends where conversation_id=cv.id and status='sending') then return jsonb_build_object('status','busy'); end if;
 update public.lotti_agent_conversations set mode='human',lease_token=null,lease_until=null,updated_at=now() where id=cv.id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
 insert into public.lotti_manual_sends(request_id,conversation_id,corretor_id,fingerprint,content,media_path)
 values(p_request,cv.id,p_owner,p_fingerprint,p_content,p_media);
 return jsonb_build_object('status','ready','instance',ch.instance,'phone',cv.phone,'lid',cv.lid);
end $$;

-- Rename works without a CRM record; a conversation with a hidden number can be
-- renamed without typing a phone, and the broker may fill the phone later.
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
  if v_phone='' and v_current_phone is null and v_lid is not null then
    v_phone:=null;
  else
    if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
    if length(v_phone)<12 or length(v_phone)>15 then raise exception 'invalid_phone'; end if;
  end if;
  if v_current_phone is distinct from v_phone then
    if exists(select 1 from public.lotti_agent_outbox where conversation_id=p_conversation and status in ('sending','uncertain'))
       or exists(select 1 from public.lotti_manual_sends where conversation_id=p_conversation and status in ('sending','uncertain')) then
      raise exception 'delivery_pending';
    end if;
    update public.lotti_agent_outbox set status='cancelled' where conversation_id=p_conversation and status='prepared';
  end if;
  update public.lotti_agent_conversations set phone=v_phone,contact_name=v_name,mode=case when v_current_phone is distinct from v_phone then 'human' else mode end,
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

-- Imported history must keep each conversation's real last activity: use the
-- message time instead of now(), and let only recent messages reopen a closed
-- conversation. Live messages are stored with now(), so they behave as before.
create or replace function public.lotti_inbox_reopen_on_inbound() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.direction='in' then
    update public.lotti_agent_conversations
    set status=case when new.created_at>=now()-interval '1 hour' then 'open' else status end,
        updated_at=greatest(updated_at,new.created_at)
    where id=new.conversation_id;
  end if;
  return new;
end $$;

notify pgrst,'reload schema';
commit;
