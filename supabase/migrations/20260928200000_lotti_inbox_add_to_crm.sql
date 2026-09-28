begin;

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
    where corretor_id=v_owner and regexp_replace(telefone,'[^0-9]','','g')=v_phone order by created_at limit 1;
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

revoke all on function public.lotti_inbox_add_to_crm(uuid) from public,anon;
grant execute on function public.lotti_inbox_add_to_crm(uuid) to authenticated;

commit;
