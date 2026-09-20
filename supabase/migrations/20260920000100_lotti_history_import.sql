-- Historical WhatsApp messages must never enter the live qualification queue.
begin;
create function public.lotti_agent_import_history(p_instance text, p_messages jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  ch public.lotti_agent_channels;
  cv public.lotti_agent_conversations;
  item jsonb;
  v_phone text;
  v_external_id text;
  body text;
  stamp timestamptz;
  imported int := 0;
begin
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 200 then
    raise exception 'invalid_history_batch';
  end if;
  select * into ch from public.lotti_agent_channels where instance = p_instance;
  if ch.id is null then raise exception 'unknown_channel'; end if;
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
    insert into public.lotti_agent_conversations(channel_id,corretor_id,phone,mode,updated_at)
    values(ch.id,ch.corretor_id,v_phone,'human',stamp)
    on conflict(channel_id,phone) do nothing;
    select * into cv from public.lotti_agent_conversations c where c.channel_id=ch.id and c.phone=v_phone;
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
revoke all on function public.lotti_agent_import_history(text,jsonb) from public,anon,authenticated;
grant execute on function public.lotti_agent_import_history(text,jsonb) to service_role;
-- Security invoker preserves the underlying conversation/message RLS policies.
create view public.lotti_agent_latest_messages with (security_invoker = true) as
select distinct on (conversation_id) conversation_id,direction,created_at,content
from public.lotti_agent_messages order by conversation_id,created_at desc,id desc;
revoke all on public.lotti_agent_latest_messages from public,anon;
grant select on public.lotti_agent_latest_messages to authenticated,service_role;
notify pgrst,'reload schema';
commit;
