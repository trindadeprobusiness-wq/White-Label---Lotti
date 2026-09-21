begin;
alter table public.lotti_agent_messages add column media_path text;
create table public.lotti_manual_sends (
 request_id uuid primary key, conversation_id uuid not null references public.lotti_agent_conversations(id),
 corretor_id uuid not null references public.corretores(id), fingerprint text not null, content text not null,
 media_path text, status text not null default 'sending' check(status in ('sending','sent','uncertain','failed')),
 external_id text, created_at timestamptz not null default now()
);
alter table public.lotti_manual_sends enable row level security;
revoke all on public.lotti_manual_sends from anon,authenticated;
grant all on public.lotti_manual_sends to service_role;
create function public.lotti_manual_begin(p_owner uuid,p_conversation uuid,p_request uuid,p_fingerprint text,p_content text,p_media text) returns jsonb
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
 return jsonb_build_object('status','ready','instance',ch.instance,'phone',cv.phone);
end $$;
create function public.lotti_manual_finish(p_request uuid,p_status text,p_external text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare item public.lotti_manual_sends;
begin
 select * into item from public.lotti_manual_sends where request_id=p_request for update;
 if item.request_id is null then return false; end if;
 if item.status='sent' then return true; end if;
 if p_status not in ('sent','uncertain','failed') then raise exception 'invalid_status'; end if;
 if p_status='sent' and nullif(p_external,'') is null then raise exception 'missing_id'; end if;
 update public.lotti_manual_sends set status=p_status,external_id=p_external where request_id=p_request;
 if p_status='sent' then
  insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content,media_path)
  values(item.conversation_id,p_external,'out','human',item.content,item.media_path)
  on conflict(conversation_id,external_id) do update set content=excluded.content,media_path=excluded.media_path,sender='human';
  update public.lotti_agent_conversations set updated_at=now() where id=item.conversation_id;
 end if;
 return true;
end $$;
revoke all on function public.lotti_manual_begin(uuid,uuid,uuid,text,text,text),public.lotti_manual_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.lotti_manual_begin(uuid,uuid,uuid,text,text,text),public.lotti_manual_finish(uuid,text,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lotti-inbox-audio','lotti-inbox-audio',false,4194304,array['audio/webm','audio/ogg','audio/mp4','audio/mpeg']) on conflict(id) do nothing;
create policy lotti_audio_owner_read on storage.objects for select to authenticated using(bucket_id='lotti-inbox-audio' and exists(select 1 from public.corretores where user_id=auth.uid() and id::text=(storage.foldername(name))[1]));
create function public.lotti_manual_mode_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.mode='ai' and exists(select 1 from public.lotti_manual_sends where conversation_id=new.id and status in ('sending','uncertain')) then raise exception 'manual_delivery_pending'; end if;
 return new;
end $$;
create trigger lotti_manual_mode_guard before update of mode on public.lotti_agent_conversations for each row execute function public.lotti_manual_mode_guard();
notify pgrst,'reload schema';
commit;
