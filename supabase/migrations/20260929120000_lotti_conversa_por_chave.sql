begin;

-- One WhatsApp conversation per line in each channel. The same mobile arrives
-- with and without the 9th digit (the number typed in "Nova conversa" is
-- 5562981234567, the WhatsApp JID of that account may be 556281234567), and
-- each spelling used to become its own conversation, with the sent message in
-- one and the reply in the other. Conversation phones always carry the
-- country code, so only plausible Brazilian numbers go through lotti_phone_key:
-- a foreign number with 11 digits (+7 999...) must not be read as an area code.
create or replace function public.lotti_conversation_phone_key(p_phone text) returns text
language sql immutable set search_path='' as $$
  select case when p_phone ~ '^55[1-9][1-9][0-9]{8,9}$' then public.lotti_phone_key(p_phone) else p_phone end
$$;
-- Not unique yet: pairs that already exist are merged by hand after review.
create index if not exists lotti_agent_conversation_phone_key_idx
  on public.lotti_agent_conversations(channel_id,public.lotti_conversation_phone_key(phone)) where phone is not null;

-- Refuses a second active conversation for the same line. Every insert already
-- runs under the channel lock (resolve_conversation, start_conversation); the
-- lock is taken again here (re-entrant) so no other path can race it.
create or replace function public.lotti_agent_conversation_phone_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_existing uuid;
begin
  if new.phone is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.channel_id::text,715));
  select id into v_existing from public.lotti_agent_conversations
   where channel_id=new.channel_id and phone is not null and archived_at is null and id<>new.id
     and public.lotti_conversation_phone_key(phone)=public.lotti_conversation_phone_key(new.phone)
   limit 1;
  if v_existing is not null then
    raise exception 'duplicate_conversation_phone' using detail=v_existing::text;
  end if;
  return new;
end $$;
revoke all on function public.lotti_agent_conversation_phone_guard() from public,anon,authenticated;
drop trigger if exists lotti_agent_conversation_phone_guard on public.lotti_agent_conversations;
create trigger lotti_agent_conversation_phone_guard before insert on public.lotti_agent_conversations
  for each row execute function public.lotti_agent_conversation_phone_guard();

-- Same as 20260926200000, plus: when no conversation has the exact phone, the
-- one with the same line (other spelling of the 9th digit) is used and takes
-- the spelling of the WhatsApp event, which is the JID the replies come from.
-- A conversation of the same line already bound to another LID is used as it
-- is, as the exact phone already was.
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
  perform pg_advisory_xact_lock(hashtextextended(p_channel::text,715));
  if v_phone is not null then
    select * into by_phone from public.lotti_agent_conversations where channel_id=p_channel and phone=v_phone for update;
    if by_phone.id is null and public.lotti_conversation_phone_key(v_phone)<>v_phone then
      select * into by_phone from public.lotti_agent_conversations
       where channel_id=p_channel and phone is not null
         and public.lotti_conversation_phone_key(phone)=public.lotti_conversation_phone_key(v_phone)
       order by (lid is null or v_lid is null or lid=v_lid) desc,(lid is not null) desc,updated_at desc
       limit 1 for update;
      if by_phone.id is not null and (by_phone.lid is null or v_lid is null or by_phone.lid=v_lid) then
        update public.lotti_agent_conversations set phone=v_phone where id=by_phone.id;
        by_phone.phone:=v_phone;
      end if;
    end if;
  end if;
  if v_lid is not null then
    select * into by_lid from public.lotti_agent_conversations where channel_id=p_channel and lid=v_lid for update;
  end if;
  if by_phone.id is not null and by_lid.id is not null and by_phone.id<>by_lid.id then
    if by_phone.lid is null and not exists(select 1 from public.lotti_agent_outbox
       where conversation_id=by_lid.id and status in ('sending','uncertain')) then
      perform public.lotti_agent_merge_conversation(by_phone.id,by_lid.id);
    end if;
    v_id:=by_phone.id;
  elsif by_phone.id is not null then
    if v_lid is not null and by_phone.lid is null then
      update public.lotti_agent_conversations set lid=v_lid where id=by_phone.id;
    end if;
    v_id:=by_phone.id;
  elsif by_lid.id is not null then
    if v_phone is not null and by_lid.phone is null then
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
    if v_id is null then -- created concurrently outside this lock
      select id into v_id from public.lotti_agent_conversations
      where channel_id=p_channel and ((v_phone is not null and phone=v_phone) or (v_lid is not null and lid=v_lid))
      order by phone is null limit 1;
    end if;
  end if;
  select * into result from public.lotti_agent_conversations where id=v_id for update;
  return result;
end $$;

-- Same as 20260928200000, reordered: under the channel lock of the WhatsApp
-- events, the conversation of the same line is found (or created) first, and
-- a client is looked up only when it has none. The typed spelling never
-- replaces the one already in use; a conversation that already heard from the
-- contact (LID, received messages) wins over a manual one.
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
  perform pg_advisory_xact_lock(hashtextextended(v_channel::text,715));
  select c.id,c.cliente_id into v_conversation,v_client from public.lotti_agent_conversations c
   where c.channel_id=v_channel and c.phone is not null
     and public.lotti_conversation_phone_key(c.phone)=public.lotti_conversation_phone_key(v_phone)
   order by c.phone=v_phone desc,c.lid is not null desc,
     exists(select 1 from public.lotti_agent_messages m where m.conversation_id=c.id and m.direction='in') desc,c.updated_at desc
   limit 1 for update of c;
  if v_conversation is null then
    insert into public.lotti_agent_conversations(channel_id,corretor_id,phone,mode,status)
    values(v_channel,v_owner,v_phone,'human','open') returning id into v_conversation;
  else
    update public.lotti_agent_conversations set status='open',updated_at=now() where id=v_conversation;
  end if;
  if v_client is null then
    v_client:=(public.lotti_find_or_create_cliente(v_owner,v_phone,coalesce(v_name,'Contato WhatsApp'),
      jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'))->>'cliente_id')::uuid;
    update public.lotti_agent_conversations set cliente_id=v_client where id=v_conversation;
  end if;
  if v_name is not null then
    update public.clientes set nome=v_name where id=v_client and nome='Contato WhatsApp';
  end if;
  return v_conversation;
end $$;

-- Same as 20260928190000, plus:
-- * lock order of the WhatsApp events (channel lock, then the row);
-- * the same line typed in another spelling keeps the current one and only
--   the name is saved;
-- * a line that is another conversation of the channel is refused with that
--   conversation's id in DETAIL, so the Inbox can offer to merge them
--   (lotti_inbox_merge_conversations) instead of creating a twin;
-- * when the phone given to the client is already another client of the
--   account, the conversation is linked to that client and neither client's
--   phone is overwritten; that client gets the name only if it has the
--   placeholder. The result then carries cliente_id and relinked:true.
create or replace function public.lotti_inbox_update_contact(p_conversation uuid,p_name text,p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_client uuid; v_current_phone text; v_lid text; v_channel uuid; v_other uuid; v_client_phone text; v_key text;
  v_name text:=left(trim(coalesce(p_name,'')),120);
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
  if length(v_name)<1 then raise exception 'invalid_name'; end if;
  select c.corretor_id,c.channel_id into v_owner,v_channel from public.lotti_agent_conversations c where c.id=p_conversation;
  if v_owner is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_channel::text,715));
  select c.corretor_id,c.cliente_id,c.phone,c.lid,c.channel_id into v_owner,v_client,v_current_phone,v_lid,v_channel
    from public.lotti_agent_conversations c where c.id=p_conversation for update;
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if v_current_phone is not null and public.lotti_conversation_phone_key(v_phone)=public.lotti_conversation_phone_key(v_current_phone) then
    v_phone:=v_current_phone;
  elsif v_lid is not null then
    if v_phone<>'' then raise exception 'phone_managed_by_whatsapp'; end if;
    v_phone:=v_current_phone;
  elsif length(v_phone)<12 or length(v_phone)>15 then
    raise exception 'invalid_phone';
  end if;
  if v_current_phone is distinct from v_phone then
    select o.id into v_other from public.lotti_agent_conversations o
     where o.channel_id=v_channel and o.id<>p_conversation and o.phone is not null and o.archived_at is null
       and public.lotti_conversation_phone_key(o.phone)=public.lotti_conversation_phone_key(v_phone)
     limit 1;
    if v_other is not null then raise exception 'phone_in_other_conversation' using detail=v_other::text; end if;
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
    select telefone into v_client_phone from public.clientes where id=v_client and corretor_id=v_owner;
    if not found then raise exception 'forbidden'; end if;
    v_key:=public.lotti_phone_key(v_phone);
    if v_key is not null and v_key is distinct from public.lotti_phone_key(v_client_phone) then
      perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':'||v_key,716));
      select id into v_other from public.clientes
       where corretor_id=v_owner and id<>v_client and public.lotti_phone_key(telefone)=v_key order by created_at limit 1;
      if v_other is not null then
        update public.lotti_agent_conversations set cliente_id=v_other where id=p_conversation;
        update public.clientes set nome=v_name where id=v_other and nome='Contato WhatsApp';
        return jsonb_build_object('name',v_name,'phone',v_phone,'cliente_id',v_other,'relinked',true);
      end if;
    end if;
    update public.clientes set nome=v_name,telefone=coalesce(v_phone,telefone) where id=v_client and corretor_id=v_owner;
  end if;
  return jsonb_build_object('name',v_name,'phone',v_phone);
exception when unique_violation then
  raise exception 'phone_already_in_use';
end $$;

-- "Unir conversas": the broker merges two conversations of the same contact.
-- The row that WhatsApp identifies (LID, or messages received from the
-- contact) is the one kept, whatever the order of the arguments. Refused while
-- the dropped row has a delivery in progress, as the automatic merge is.
create or replace function public.lotti_inbox_merge_conversations(p_keep uuid,p_drop uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_channel uuid; keep_row public.lotti_agent_conversations; drop_row public.lotti_agent_conversations; swap public.lotti_agent_conversations;
begin
  if p_keep is null or p_drop is null or p_keep=p_drop then raise exception 'invalid_merge'; end if;
  select c.channel_id into v_channel from public.lotti_agent_conversations c
   where c.id=p_keep and exists(select 1 from public.corretores r where r.id=c.corretor_id and r.user_id=auth.uid());
  if v_channel is null then raise exception 'forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_channel::text,715));
  select * into keep_row from public.lotti_agent_conversations where id=p_keep for update;
  select * into drop_row from public.lotti_agent_conversations where id=p_drop for update;
  if drop_row.id is null or drop_row.corretor_id<>keep_row.corretor_id then raise exception 'forbidden'; end if;
  if drop_row.channel_id<>keep_row.channel_id then raise exception 'invalid_merge'; end if;
  -- Two LIDs are two WhatsApp accounts.
  if keep_row.lid is not null and drop_row.lid is not null then raise exception 'different_contacts'; end if;
  if (drop_row.lid is not null and keep_row.lid is null)
     or (keep_row.lid is null and drop_row.lid is null
         and exists(select 1 from public.lotti_agent_messages m where m.conversation_id=drop_row.id and m.direction='in')
         and not exists(select 1 from public.lotti_agent_messages m where m.conversation_id=keep_row.id and m.direction='in')) then
    swap:=keep_row; keep_row:=drop_row; drop_row:=swap;
  end if;
  if exists(select 1 from public.lotti_agent_outbox where conversation_id=drop_row.id and status in ('sending','uncertain'))
     or exists(select 1 from public.lotti_manual_sends where conversation_id=drop_row.id and status='sending') then
    raise exception 'delivery_pending';
  end if;
  perform public.lotti_agent_merge_conversation(keep_row.id,drop_row.id);
  return jsonb_build_object('conversation_id',keep_row.id,'merged_id',drop_row.id);
end $$;

-- A manual send reports the JID WhatsApp actually used. When it is the other
-- spelling of the same line, the conversation adopts it, so the reply and the
-- echo land in the conversation the broker started. Never merges: a
-- conversation that already has that exact phone stays as it is.
create or replace function public.lotti_manual_adopt_remote(p_request uuid,p_remote text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_channel uuid; cv public.lotti_agent_conversations;
begin
  if p_remote is null or p_remote !~ '^[0-9]{8,15}$' then raise exception 'invalid_phone'; end if;
  select c.channel_id into v_channel from public.lotti_manual_sends s
    join public.lotti_agent_conversations c on c.id=s.conversation_id where s.request_id=p_request;
  if v_channel is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_channel::text,715));
  select c.* into cv from public.lotti_manual_sends s
    join public.lotti_agent_conversations c on c.id=s.conversation_id where s.request_id=p_request for update of c;
  if cv.id is null or cv.phone is null or cv.phone=p_remote
     or public.lotti_conversation_phone_key(cv.phone)<>public.lotti_conversation_phone_key(p_remote)
     or exists(select 1 from public.lotti_agent_conversations o where o.channel_id=cv.channel_id and o.phone=p_remote) then
    return false;
  end if;
  update public.lotti_agent_conversations set phone=p_remote where id=cv.id;
  return true;
end $$;

revoke all on function public.lotti_agent_resolve_conversation(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.lotti_agent_resolve_conversation(uuid,text,text,text,timestamptz) to service_role;
revoke all on function public.lotti_inbox_start_conversation(text,text) from public,anon;
grant execute on function public.lotti_inbox_start_conversation(text,text) to authenticated;
revoke all on function public.lotti_inbox_update_contact(uuid,text,text) from public,anon;
grant execute on function public.lotti_inbox_update_contact(uuid,text,text) to authenticated;
revoke all on function public.lotti_inbox_merge_conversations(uuid,uuid) from public,anon;
grant execute on function public.lotti_inbox_merge_conversations(uuid,uuid) to authenticated;
revoke all on function public.lotti_manual_adopt_remote(uuid,text) from public,anon,authenticated;
grant execute on function public.lotti_manual_adopt_remote(uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
