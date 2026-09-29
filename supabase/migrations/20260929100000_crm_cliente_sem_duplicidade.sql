begin;

-- One CRM client per phone in each account. lotti_phone_key (20260928200000)
-- gives every spelling of a Brazilian line the same key; here every flow that
-- creates a client goes through lotti_find_or_create_cliente, which looks up
-- and inserts under one advisory lock per account and key (716), and a trigger
-- refuses any other insert or phone change that would repeat a key. Clients
-- that already share a key are left alone (they are merged by hand after
-- review): the trigger only checks rows being inserted or whose key changes.
--
-- Lock order (never the reverse): channel row -> 715 (channel) -> conversation
-- row -> 716 (account + phone key) -> 717 (client, for deals).

create or replace function public.clientes_phone_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_key text:=public.lotti_phone_key(new.telefone); v_existing uuid;
begin
  if v_key is null then return new; end if;
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

drop trigger if exists clientes_phone_guard_insert on public.clientes;
create trigger clientes_phone_guard_insert before insert on public.clientes
  for each row execute function public.clientes_phone_guard();
-- Editing a client usually sends the whole form, phone included: only a new
-- key is checked, so legacy duplicates can still be edited.
drop trigger if exists clientes_phone_guard_update on public.clientes;
create trigger clientes_phone_guard_update before update of telefone on public.clientes
  for each row when (public.lotti_phone_key(old.telefone) is distinct from public.lotti_phone_key(new.telefone))
  execute function public.clientes_phone_guard();

-- The single path that creates a client from a phone. Returns the oldest
-- client with the same key ({created:false}) or inserts one. p_dados only
-- fills a closed list of columns, converted by the table's own types (the
-- funnel columns are enums in production); columns not given keep their
-- defaults. With p_criar=false it only looks (under the same lock).
create or replace function public.lotti_find_or_create_cliente(
  p_owner uuid,p_phone text,p_name text,p_dados jsonb default '{}'::jsonb,p_criar boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_key text:=public.lotti_phone_key(p_phone); v_id uuid; v_cols text; v_dados jsonb;
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

-- Clients of one account that may be the same person: same phone key, same
-- CPF/CNPJ digits or same e-mail. At most 5, phone matches first.
create or replace function public.crm_candidatos_cliente(p_owner uuid,p_telefone text,p_email text default null,p_cpf text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_key text:=public.lotti_phone_key(p_telefone);
  v_email text:=nullif(lower(btrim(coalesce(p_email,''))),'');
  v_cpf text:=regexp_replace(coalesce(p_cpf,''),'[^0-9]','','g');
  v_result jsonb;
begin
  if length(v_cpf) not in (11,14) then v_cpf:=null; end if;
  if p_owner is null or (v_key is null and v_email is null and v_cpf is null) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'nome',t.nome,'motivo',t.motivo) order by t.prioridade,t.created_at),'[]'::jsonb)
    into v_result
    from (select * from (
            select distinct on (k.id) k.id,k.nome,k.created_at,m.prioridade,m.motivo
              from public.clientes k
              cross join lateral (values
                (1,'telefone',v_key is not null and public.lotti_phone_key(k.telefone)=v_key),
                (2,'cpf',v_cpf is not null and regexp_replace(coalesce(k.cpf,''),'[^0-9]','','g')=v_cpf),
                (3,'email',v_email is not null and lower(btrim(k.email))=v_email)) m(prioridade,motivo,casou)
             where k.corretor_id=p_owner and m.casou
             order by k.id,m.prioridade) d
          order by d.prioridade,d.created_at limit 5) t;
  return v_result;
end $$;
revoke all on function public.crm_candidatos_cliente(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_candidatos_cliente(uuid,text,text,text) to service_role;

-- Screens that create or pick a client (new client, lead conversion, contract
-- import) ask first. The account is resolved on the server, as in the CRM.
create or replace function public.crm_clientes_por_telefone(p_telefone text,p_email text default null,p_cpf text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_owner uuid:=public.get_corretor_id();
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  return public.crm_candidatos_cliente(v_owner,p_telefone,p_email,p_cpf);
end $$;
revoke all on function public.crm_clientes_por_telefone(text,text,text) from public,anon;
grant execute on function public.crm_clientes_por_telefone(text,text,text) to authenticated;

-- "Novo cliente" in the CRM. There is no "create anyway": when the phone is
-- already a client of the account, nothing is written and the screen offers
-- that client instead.
create or replace function public.crm_criar_cliente(p_dados jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=public.get_corretor_id();
  v_nome text:=btrim(coalesce(p_dados->>'nome',''));
  v_telefone text:=btrim(coalesce(p_dados->>'telefone',''));
  v_result jsonb;
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  if v_nome='' then raise exception 'invalid_name'; end if;
  v_result:=public.lotti_find_or_create_cliente(v_owner,v_telefone,v_nome,coalesce(p_dados,'{}'::jsonb)-'nome'-'telefone',true);
  if not (v_result->>'created')::boolean then
    return jsonb_build_object('status','duplicate','candidatos',public.crm_candidatos_cliente(v_owner,v_telefone));
  end if;
  return jsonb_build_object('status','created','cliente_id',v_result->'cliente_id');
end $$;
revoke all on function public.crm_criar_cliente(jsonb) from public,anon;
grant execute on function public.crm_criar_cliente(jsonb) to authenticated;

-- Public lead capture (runs with service_role). Lookup and insert in one
-- transaction under the same lock, so a double POST creates one client. An
-- existing client is never renamed nor gets its e-mail replaced by an
-- anonymous request: what was sent goes to tracking_data for the broker.
create or replace function public.lead_capture_upsert_cliente(p_corretor uuid,p_nome text,p_telefone text,p_email text,p_tracking jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_email text:=nullif(btrim(coalesce(p_email,'')),'');
  v_tracking jsonb:=coalesce(p_tracking,'{}'::jsonb);
  v_result jsonb;
begin
  v_result:=public.lotti_find_or_create_cliente(p_corretor,p_telefone,p_nome,
    jsonb_build_object('email',v_email,'tipo_interesse','AMBOS','status_funil','QUALIFICACAO','tracking_data',v_tracking,'ultimo_contato',now()));
  if not (v_result->>'created')::boolean then
    update public.clientes set ultimo_contato=now(),
      tracking_data=coalesce(tracking_data,'{}'::jsonb)||jsonb_build_object('ultimo_retorno',v_tracking||jsonb_strip_nulls(jsonb_build_object('email_informado',v_email)))
     where id=(v_result->>'cliente_id')::uuid;
  end if;
  return v_result;
end $$;
revoke all on function public.lead_capture_upsert_cliente(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.lead_capture_upsert_cliente(uuid,text,text,text,jsonb) to service_role;

-- Same as 20260928200000 apart from: the CRM client comes from
-- lotti_find_or_create_cliente (lookup and insert under lock 716, still
-- inside the block that keeps the capture when a legacy CRM insert fails),
-- and a media message raises the "atendimento humano" alert only when the
-- conversation has no unread one yet (one alert, not one per photo).
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
   begin
     client_id:=(public.lotti_find_or_create_cliente(ch.corretor_id,cv.phone,coalesce(cv.contact_name,'Contato WhatsApp'),
       jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'))->>'cliente_id')::uuid;
   exception when others then client_id:=null;
   end;
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
   -- No race: ingest is serialized per channel by lock 715 (resolve_conversation).
   if not is_out and not ch.sandbox and not exists(select 1 from public.alertas a
      where a.corretor_id=cv.corretor_id and a.lido is not true and a.origem='ia'
        and a.metadata->>'conversation_id'=cv.id::text
        and a.mensagem='Mensagem de áudio ou mídia: atendimento humano necessário') then
     insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
     values(cv.corretor_id,client_id,'GERAL','Mensagem de áudio ou mídia: atendimento humano necessário',jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
   end if;
 end if;
 return jsonb_build_object('accepted',true,'conversation_id',cv.id);
end $$;
create index if not exists alertas_ia_conversation_unread_idx on public.alertas((metadata->>'conversation_id'))
  where origem='ia' and lido is not true;

-- Same as 20260928200000, with the client from lotti_find_or_create_cliente.
create or replace function public.lotti_inbox_add_to_crm(p_conversation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_phone text; v_name text; v_client uuid; v_result jsonb;
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
  v_result:=public.lotti_find_or_create_cliente(v_owner,v_phone,coalesce(v_name,'Contato WhatsApp'),
    jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'));
  update public.lotti_agent_conversations
    set cliente_id=(v_result->>'cliente_id')::uuid,last_error=case when last_error='crm_capture_pending' then null else last_error end
    where id=p_conversation;
  return v_result;
end $$;

revoke all on function public.lotti_agent_ingest(jsonb) from public,anon,authenticated;
grant execute on function public.lotti_agent_ingest(jsonb) to service_role;
revoke all on function public.lotti_inbox_add_to_crm(uuid) from public,anon;
grant execute on function public.lotti_inbox_add_to_crm(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
