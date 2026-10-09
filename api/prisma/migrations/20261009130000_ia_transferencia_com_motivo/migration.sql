-- "IA desligada por Sistema" não dizia nada: era o agente passando a conversa para a equipe (cliente
-- pediu corretor, mandou foto que a IA não vê, assunto fora do escopo). O evento de modo passa a usar o
-- mesmo autor de linha do tempo dos eventos de status (lotti.ator_evento), e a transferência se identifica.

CREATE OR REPLACE FUNCTION public.lotti_inbox_record_mode()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Closing also pauses the IA, but the event people need to see is the closure.
  if new.status = 'closed' and new.status is distinct from old.status then return new; end if;
  if new.mode is distinct from old.mode then
    insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
    values (new.id, 'mode', old.mode, case new.mode when 'ai' then 'IA' when 'human' then 'Equipe' else 'Pausada' end,
      coalesce(nullif(current_setting('lotti.ator_evento', true), ''), public.lotti_inbox_event_actor()));
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lotti_agent_handoff(p_id uuid, p_token uuid, p_revision bigint, p_result jsonb, p_stage uuid, p_silent boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null then return false; end if;
  perform set_config('lotti.ator_evento', 'transferência automática para a equipe', true);
  if p_silent then
    if cv.lease_token is distinct from p_token or cv.revision <> p_revision then
      perform set_config('lotti.ator_evento', '', true);
      return false;
    end if;
    update public.lotti_agent_conversations set qualification = coalesce(p_result, qualification), processed_revision = p_revision,
      lease_token = null, lease_until = null, attempts = 0, mode = 'human' where id = p_id;
    select sandbox into v_sandbox from public.lotti_agent_channels where id = cv.channel_id;
    if not coalesce(v_sandbox, true) then
      insert into public.alertas(corretor_id, cliente_id, tipo, mensagem, metadata, origem, entidade_tipo, entidade_id)
      values (cv.corretor_id, cv.cliente_id, 'GERAL', 'Contato solicitou atendimento do corretor',
        jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta','qualification',p_result), 'ia',
        case when cv.cliente_id is not null then 'cliente' end, cv.cliente_id);
    end if;
  else
    if cv.processed_revision < p_revision then
      perform set_config('lotti.ator_evento', '', true);
      return false;
    end if;
    update public.lotti_agent_conversations set mode = 'human' where id = p_id and mode = 'ai';
  end if;
  perform set_config('lotti.ator_evento', '', true);
  perform public.lotti_agent_move_stage(p_id, p_stage);
  return true;
end $function$
;
