-- A IA move o lead no funil conforme qualifica (como pediu o Rafael em 10/10/2026):
--   começou a atender (pre_qualificacao) → 2ª etapa (Primeiro contato)
--   qualificando                          → 3ª (Em qualificação)
--   qualificado_busca                     → 4ª (Qualificado)
--   qualificado_visita ou pediu visita    → 5ª (Visita agendada)
-- Pela POSIÇÃO entre as etapas abertas ativas da conta (a conta pode renomear). Nunca volta etapa,
-- nunca mexe em etapa fechada (ganho/perdido) nem em lead que a equipe já levou adiante (Proposta,
-- Negociação): só avança quando a etapa alvo está depois da atual.
CREATE OR REPLACE FUNCTION public.lotti_agent_avanca_etapa(p_conversation uuid, p_posicao integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; v_alvo uuid; v_pos_alvo integer; v_opp uuid; v_atual uuid; v_tipo text; v_pos_atual integer;
begin
  select * into cv from public.lotti_agent_conversations where id = p_conversation;
  if cv.id is null or cv.cliente_id is null or p_posicao is null then return false; end if;
  select e.id, e.pos into v_alvo, v_pos_alvo from (
    select id, row_number() over (order by ordem, id) as pos from public.crm_etapas
     where corretor_id = cv.corretor_id and ativo and tipo = 'ABERTA') e
   where e.pos = p_posicao;
  if v_alvo is null then return false; end if;
  v_opp := public.crm_oportunidade_aberta(cv.corretor_id, cv.cliente_id);
  if v_opp is not null then
    select o.etapa_id, e.tipo into v_atual, v_tipo from public.crm_oportunidades o
      left join public.crm_etapas e on e.id = o.etapa_id where o.id = v_opp;
    if v_tipo is distinct from 'ABERTA' and v_atual is not null then return false; end if;
    select e.pos into v_pos_atual from (
      select id, row_number() over (order by ordem, id) as pos from public.crm_etapas
       where corretor_id = cv.corretor_id and ativo and tipo = 'ABERTA') e
     where e.id = v_atual;
    if v_pos_atual is not null and v_pos_atual >= v_pos_alvo then return false; end if;
  end if;
  return public.lotti_agent_move_stage(p_conversation, v_alvo);
end $function$
;

REVOKE ALL ON FUNCTION public.lotti_agent_avanca_etapa(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lotti_agent_avanca_etapa(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.lotti_agent_avanca_etapa(uuid, integer) FROM authenticated;

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
     when stage='qualificado_visita' or jsonb_typeof(p_result->'visitRequest')='object' then 5
     when stage='qualificado_busca' then 4
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
