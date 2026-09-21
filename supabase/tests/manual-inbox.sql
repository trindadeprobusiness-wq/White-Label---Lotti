begin;
do $$
declare owner_id uuid; channel uuid; cv uuid; req uuid:=gen_random_uuid(); result jsonb; denied boolean:=false;
begin
 select corretor_id,id into owner_id,channel from public.lotti_agent_channels where instance='lotti-agent';
 insert into public.lotti_agent_conversations(channel_id,corretor_id,phone) values(channel,owner_id,'999999999999999') returning id into cv;
 begin perform public.lotti_manual_begin(gen_random_uuid(),cv,req,'hash','fixture',null); exception when others then denied:=true; end;
 if not denied then raise exception 'cross owner accepted'; end if;
 result:=public.lotti_manual_begin(owner_id,cv,req,'hash','fixture',null);
 if result->>'status'<>'ready' then raise exception 'reservation failed'; end if;
 if (select mode from public.lotti_agent_conversations where id=cv)<>'human' then raise exception 'mode not human'; end if;
 result:=public.lotti_manual_begin(owner_id,cv,req,'hash','fixture',null);
 if result->>'status'<>'sending' then raise exception 'idempotence failed'; end if;
 perform public.lotti_manual_finish(req,'sent','fixture-external');
 perform public.lotti_manual_finish(req,'sent','fixture-external');
 if (select count(*) from public.lotti_agent_messages where conversation_id=cv)<>1 then raise exception 'duplicate message'; end if;
end $$;
select 'manual transaction tests passed' as result;
rollback;