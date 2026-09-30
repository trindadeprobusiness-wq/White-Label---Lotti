begin;

-- When the connected number last changed from one number to another. The
-- bridge can use it to tell stored messages of the previous number apart.
alter table public.lotti_agent_channels add column if not exists account_bound_at timestamptz;

-- Same as 20260923120000, plus: reconnecting a number that was connected
-- before (A -> B -> A) brings back its archived conversations instead of
-- starting new ones, so the opt-out, the attendance mode and the history stay
-- with each contact. Only the latest archive of that number is restored; the
-- active channel was just emptied, so no phone or LID clashes. Restored rows
-- do not resume automatic work left from before the switch: pending AI
-- revisions count as handled and no follow-up is due.
create or replace function public.lotti_agent_bind_account(p_channel uuid, p_account text) returns void
language plpgsql security invoker set search_path='' as $$
declare ch public.lotti_agent_channels; archive_id uuid; v_previous uuid;
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

-- Same as 20260927120100, plus: a contact who already asked to stop and says
-- it again (with nothing else in between) does not produce another timeline
-- event and alert; only the date of the latest request is kept. A request
-- after the contact wrote something else, or after the broker released the
-- contact, is new.
create or replace function public.lotti_agent_detect_opt_out() returns trigger
language plpgsql security definer set search_path='' as $$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
begin
 if new.direction<>'in' or new.sender<>'lead' or not public.lotti_agent_is_opt_out(new.content) then return null; end if;
 if exists(select 1 from public.lotti_agent_messages m where m.conversation_id=new.conversation_id and m.direction='in' and m.created_at>new.created_at) then return null; end if;
 select * into cv from public.lotti_agent_conversations where id=new.conversation_id;
 if cv.id is null or cv.opted_out_at>=new.created_at then return null; end if;
 if cv.opted_out_at is not null and not exists(select 1 from public.lotti_agent_messages m
    where m.conversation_id=cv.id and m.direction='in' and m.sender='lead'
      and m.created_at>cv.opted_out_at and m.created_at<new.created_at
      and not public.lotti_agent_is_opt_out(m.content)) then
  update public.lotti_agent_conversations set opted_out_at=new.created_at where id=cv.id;
  return null;
 end if;
 -- O lease fica como está: prepare/begin_send cancelam quando a conversa sai da IA.
 update public.lotti_agent_conversations set opted_out_at=new.created_at,mode=case when mode='ai' then 'human' else mode end where id=cv.id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
 insert into public.lotti_inbox_events(conversation_id,kind,to_label,actor_label,created_at)
 values(cv.id,'consent','Pediu para não receber mensagens','Contato',new.created_at);
 select sandbox into v_sandbox from public.lotti_agent_channels where id=cv.channel_id;
 if not coalesce(v_sandbox,true) and new.created_at>now()-interval '1 day' then
  insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
  values(cv.corretor_id,cv.cliente_id,'GERAL','Contato pediu para não receber mais mensagens: a IA foi desligada nesta conversa',
   jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','media'),'ia',
   case when cv.cliente_id is not null then 'cliente' end,cv.cliente_id);
 end if;
 return null;
end $$;

notify pgrst,'reload schema';
commit;
