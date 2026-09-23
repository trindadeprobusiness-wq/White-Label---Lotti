begin;

create or replace function public.lotti_inbox_update_contact(p_conversation uuid,p_name text,p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_client uuid; v_current_phone text;
  v_name text:=left(trim(coalesce(p_name,'')),120);
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
  if length(v_name)<1 then raise exception 'invalid_name'; end if;
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if length(v_phone)<12 or length(v_phone)>15 then raise exception 'invalid_phone'; end if;
  select c.corretor_id,c.cliente_id,c.phone into v_owner,v_client,v_current_phone
    from public.lotti_agent_conversations c where c.id=p_conversation for update;
  if v_client is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then raise exception 'forbidden'; end if;
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
  update public.clientes set nome=v_name,telefone=v_phone where id=v_client and corretor_id=v_owner;
  if not found then raise exception 'forbidden'; end if;
  return jsonb_build_object('name',v_name,'phone',v_phone);
exception when unique_violation then
  raise exception 'phone_already_in_use';
end $$;

revoke all on function public.lotti_inbox_update_contact(uuid,text,text) from public,anon;
grant execute on function public.lotti_inbox_update_contact(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
