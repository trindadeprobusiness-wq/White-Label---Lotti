begin;
create or replace function public.lotti_agent_set_mode(p_id uuid,p_mode text) returns boolean language plpgsql security definer set search_path='' as $$
declare cv public.lotti_agent_conversations;
begin
 if p_mode not in ('ai','human','paused') then raise exception 'invalid mode'; end if;
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if not exists(select 1 from public.corretores where id=cv.corretor_id and user_id=auth.uid()) then raise exception 'forbidden'; end if;
 if p_mode='ai' and exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status in ('sending','uncertain')) then raise exception 'reconcile uncertain delivery first'; end if;
 -- Invalidate generated replies without inventing an incoming message. A resume
 -- only processes a genuinely pending inbound revision.
 update public.lotti_agent_conversations set mode=p_mode,
 lease_token=case when exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status='sending') then lease_token else null end,
 lease_until=case when exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status='sending') then lease_until else null end,
 updated_at=now() where id=p_id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=p_id and status='prepared';
 if p_mode='ai' then
   -- A cancelled answer for the same revision must be re-generated from context.
   delete from public.lotti_agent_outbox where conversation_id=p_id and status='cancelled' and revision=cv.revision;
   update public.lotti_agent_conversations set attempts=0,next_attempt_at=now() where id=p_id;
 end if;
 return true;
end $$;
revoke all on function public.lotti_agent_set_mode(uuid,text) from public,anon;
grant execute on function public.lotti_agent_set_mode(uuid,text) to authenticated;
create or replace function public.lotti_agent_prepare(p_id uuid,p_token uuid,p_revision bigint,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; out_id uuid; stage text:=p_result->>'stage';
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if cv.id is null or cv.lease_token is distinct from p_token or cv.lease_until<now() then return jsonb_build_object('cancelled',true); end if;
 if cv.mode<>'ai' or cv.revision<>p_revision or not ch.enabled then
   update public.lotti_agent_conversations set lease_until=null,lease_token=null where id=p_id;
   return jsonb_build_object('cancelled',true);
 end if;
 update public.lotti_agent_conversations set qualification=p_result where id=p_id;
 if not ch.sandbox and (stage in ('qualificado_busca','qualificado_visita') or (p_result->>'humanRequested')::boolean) and cv.notified_stage is distinct from stage then
   insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
   values(cv.corretor_id,cv.cliente_id,'GERAL',case when stage like 'qualificado%' then 'Lead qualificado: pronto para atendimento do corretor' else 'Contato solicitou atendimento do corretor' end,
     jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority',p_result->>'priority','qualification',p_result), 'ia','cliente',cv.cliente_id);
   update public.lotti_agent_conversations set notified_stage=stage where id=p_id;
 end if;
 insert into public.lotti_agent_outbox(conversation_id,revision,content) values(p_id,p_revision,p_result->>'response')
 on conflict(conversation_id,revision) do update set content=excluded.content where public.lotti_agent_outbox.status='prepared' returning id into out_id;
 return jsonb_build_object('outbox_id',out_id);
end $$;


commit;
