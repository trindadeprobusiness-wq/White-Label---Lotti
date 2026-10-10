-- 'Visita agendada' só quando o cliente deu dia e hora (visitRequest). Interesse em visitar sem horário
-- (stage qualificado_visita) fica em Qualificado, a 4ª etapa.
CREATE OR REPLACE FUNCTION public.lotti_agent_prepare(p_id uuid, p_token uuid, p_revision bigint, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 -- Funil: a IA só avança o card (ver lotti_agent_avanca_etapa). Sandbox não mexe no CRM.
 if not ch.sandbox then
   perform public.lotti_agent_avanca_etapa(p_id, case
     when jsonb_typeof(p_result->'visitRequest')='object' then 5
     when stage in ('qualificado_busca','qualificado_visita') then 4
     when stage='qualificando' then 3
     when stage='pre_qualificacao' then 2 end);
 end if;
 if not ch.sandbox and (stage in ('qualificado_busca','qualificado_visita') or (p_result->>'humanRequested')::boolean) and cv.notified_stage is distinct from stage then
   insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
   values(cv.corretor_id,cv.cliente_id,'GERAL',case when stage like 'qualificado%' then 'Lead qualificado: pronto para atendimento do corretor' else 'Contato solicitou atendimento do corretor' end,
     jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority',p_result->>'priority','qualification',p_result), 'ia','cliente',cv.cliente_id);
   update public.lotti_agent_conversations set notified_stage=stage where id=p_id;
 end if;
 insert into public.lotti_agent_outbox(conversation_id,revision,content) values(p_id,p_revision,p_result->>'response')
 on conflict(conversation_id,revision) do update set content=excluded.content where public.lotti_agent_outbox.status='prepared' returning id into out_id;
 return jsonb_build_object('outbox_id',out_id);
end $function$
