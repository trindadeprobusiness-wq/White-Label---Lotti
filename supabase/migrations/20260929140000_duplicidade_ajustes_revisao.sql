begin;

-- Fixes from the review of the no-duplicates migrations (20260929100000-130000).
-- Every function below is the latest definition with only the change described.

-- Only a phone that identifies someone is a duplicate key: a valid Brazilian
-- line, or 10 to 15 digits that are not one repeated digit. Placeholders such
-- as (00) 00000-0000 and short or mistyped numbers used to make strangers "the
-- same client"; now they are treated as having no phone for this rule.
create or replace function public.lotti_phone_key_confiavel(p_phone text) returns text
language sql immutable set search_path='' as $$
  select case when k ~ '^[1-9][1-9][mf][0-9]{8}$' then k
              when k ~ '^[0-9]{10,15}$' and k !~ '^([0-9])\1+$' then k end
    from (select public.lotti_phone_key(p_phone) k) s
$$;
grant execute on function public.lotti_phone_key_confiavel(text) to authenticated,service_role;

-- Same as 20260929100000, plus: only reliable keys, and no answer for rows
-- another account's RLS will refuse.
create or replace function public.clientes_phone_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_key text:=public.lotti_phone_key_confiavel(new.telefone); v_existing uuid;
begin
  if v_key is null then return new; end if;
  -- A signed-in user writing a row for another account is refused by RLS,
  -- which runs after this trigger: answering first would tell them whether
  -- that account has the phone.
  if auth.uid() is not null and new.corretor_id is distinct from public.get_corretor_id() then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.corretor_id::text||':'||v_key,716));
  select id into v_existing from public.clientes
   where corretor_id=new.corretor_id and public.lotti_phone_key(telefone)=v_key and id<>new.id
   order by created_at limit 1;
  if v_existing is not null then
    -- The front end shows "Este telefone já é do cliente X" from this id.
    raise exception 'duplicate_client_phone' using detail=v_existing::text;
  end if;
  return new;
end $$;
revoke all on function public.clientes_phone_guard() from public,anon,authenticated;

-- Same as 20260929100000, with reliable keys only.
create or replace function public.lotti_find_or_create_cliente(
  p_owner uuid,p_phone text,p_name text,p_dados jsonb default '{}'::jsonb,p_criar boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_key text:=public.lotti_phone_key_confiavel(p_phone); v_id uuid; v_cols text; v_dados jsonb;
begin
  if p_owner is null then raise exception 'forbidden'; end if;
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||v_key,716));
    select id into v_id from public.clientes
     where corretor_id=p_owner and public.lotti_phone_key(telefone)=v_key order by created_at limit 1;
    if v_id is not null then return jsonb_build_object('cliente_id',v_id,'created',false); end if;
  end if;
  if not p_criar then return jsonb_build_object('cliente_id',null,'created',false); end if;
  select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb),string_agg(quote_ident(e.key),',' order by e.key) into v_dados,v_cols
    from jsonb_each(coalesce(p_dados,'{}'::jsonb)) e
   where e.key in ('email','cpf','tipo_interesse','status_funil','observacoes','tracking_data','ultimo_contato')
     and jsonb_typeof(e.value)<>'null';
  execute format('insert into public.clientes(corretor_id,nome,telefone%s) select $1,$2,$3%s from jsonb_populate_record(null::public.clientes,$4) r returning id',
      coalesce(','||v_cols,''),coalesce(',r.'||replace(v_cols,',',',r.'),''))
    into v_id using p_owner,coalesce(nullif(btrim(p_name),''),'Contato WhatsApp'),coalesce(p_phone,''),v_dados;
  return jsonb_build_object('cliente_id',v_id,'created',true);
end $$;
revoke all on function public.lotti_find_or_create_cliente(uuid,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.lotti_find_or_create_cliente(uuid,text,text,jsonb,boolean) to service_role;

-- Same as 20260929100000, with reliable keys only.
create or replace function public.crm_candidatos_cliente(p_owner uuid,p_telefone text,p_email text default null,p_cpf text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_key text:=public.lotti_phone_key_confiavel(p_telefone);
  v_email text:=nullif(lower(btrim(coalesce(p_email,''))),'');
  v_cpf text:=regexp_replace(coalesce(p_cpf,''),'[^0-9]','','g');
  v_result jsonb;
begin
  if length(v_cpf) not in (11,14) then v_cpf:=null; end if;
  if p_owner is null or (v_key is null and v_email is null and v_cpf is null) then return '[]'::jsonb; end if;
  -- One branch per reason, so the phone lookup uses clientes_corretor_phone_key_idx.
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'nome',t.nome,'motivo',t.motivo) order by t.prioridade,t.created_at),'[]'::jsonb)
    into v_result
    from (select * from (
            select distinct on (m.id) m.* from (
              select k.id,k.nome,k.created_at,1 prioridade,'telefone' motivo from public.clientes k
               where v_key is not null and k.corretor_id=p_owner and public.lotti_phone_key(k.telefone)=v_key
              union all
              select k.id,k.nome,k.created_at,2,'cpf' from public.clientes k
               where v_cpf is not null and k.corretor_id=p_owner and regexp_replace(coalesce(k.cpf,''),'[^0-9]','','g')=v_cpf
              union all
              select k.id,k.nome,k.created_at,3,'email' from public.clientes k
               where v_email is not null and k.corretor_id=p_owner and lower(btrim(k.email))=v_email) m
             order by m.id,m.prioridade) d
          order by d.prioridade,d.created_at limit 5) t;
  return v_result;
end $$;
revoke all on function public.crm_candidatos_cliente(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_candidatos_cliente(uuid,text,text,text) to service_role;

-- Same as 20260929120000, plus: a conversation found only by the line and bound
-- to another LID does not take the event when the event's LID has its own.
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
    -- Found only by the line (other spelling) and bound to another LID: that is
    -- another WhatsApp account, and the event's LID already has its conversation.
    v_id:=case when by_phone.lid is not null and by_phone.lid<>v_lid and by_phone.phone<>v_phone then by_lid.id else by_phone.id end;
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
revoke all on function public.lotti_agent_resolve_conversation(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.lotti_agent_resolve_conversation(uuid,text,text,text,timestamptz) to service_role;

-- Same as 20260929130000, plus the channel lock 715 (after the channel row).
create or replace function public.lotti_agent_bind_account(p_channel uuid, p_account text) returns void
language plpgsql security invoker set search_path='' as $$
declare ch public.lotti_agent_channels; archive_id uuid; v_previous uuid;
begin
  if p_account is null then return; end if;
  if p_account !~ '^[0-9]{8,15}$' then raise exception 'invalid_account'; end if;
  select * into ch from public.lotti_agent_channels where id=p_channel for update;
  if ch.id is null or ch.account_phone is not distinct from p_account then return; end if;
  -- Same lock as start, update_contact and resolve: nobody creates a conversation
  -- in the channel while its conversations are archived and restored.
  perform pg_advisory_xact_lock(hashtextextended(ch.id::text,715));
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
  select x.id into v_previous from public.lotti_agent_channels x
   where x.corretor_id=ch.corretor_id and x.archived_at is not null and x.account_phone=p_account and x.id<>ch.id
   order by x.archived_at desc,x.created_at desc limit 1;
  if v_previous is not null then
    update public.lotti_agent_conversations set channel_id=ch.id,archived_at=null,lease_token=null,lease_until=null,
      processed_revision=greatest(processed_revision,revision),followup_due_at=null
    where channel_id=v_previous;
  end if;
  update public.lotti_agent_channels set account_phone=p_account,
    account_bound_at=case when ch.account_phone is not null then now() else account_bound_at end
  where id=ch.id;
end $$;
revoke all on function public.lotti_agent_bind_account(uuid,text) from public,anon,authenticated;
grant execute on function public.lotti_agent_bind_account(uuid,text) to service_role;

commit;
