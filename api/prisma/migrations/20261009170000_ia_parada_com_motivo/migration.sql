-- A linha do tempo diz POR QUE a IA parou quando alguém da equipe responde (como no Clix):
--   * pelo Inbox: "IA desligada: <nome> assumiu a conversa" (antes: "IA desligada por Sistema");
--   * pelo WhatsApp do celular: "IA em espera porque a equipe respondeu pelo WhatsApp" (antes: nada);
--   * mídia mandada pelo celular (desliga de vez): "IA desligada porque a equipe respondeu pelo WhatsApp".
-- O WhatsApp não diz quem do time respondeu pelo celular; por isso "a equipe". O comportamento da IA não
-- muda: pelo Inbox ela desliga de vez, pelo celular fica em espera 24 h e volta sozinha.

-- 1. Tipo de evento próprio para a espera. Não pode ser 'mode': o agente lê o último evento 'mode' para
-- saber se a equipe religou a IA (runtime turn.mjs, religadaDepois), e a espera não é troca de modo.
ALTER TABLE public.lotti_inbox_events DROP CONSTRAINT lotti_inbox_events_kind_check;
ALTER TABLE public.lotti_inbox_events ADD CONSTRAINT lotti_inbox_events_kind_check
  CHECK ((kind = ANY (ARRAY['mode'::text, 'stage'::text, 'status'::text, 'consent'::text, 'pausa'::text])));

-- 2. Evento de modo com motivo (subject_label): 'assumiu_inbox' vem de lotti_manual_begin (abaixo);
-- 'respondeu_whatsapp' quando a troca para a equipe vem de uma mensagem da equipe gravada nesta mesma
-- transação (a mídia mandada pelo celular, no lotti_agent_ingest: a mensagem é inserida antes do update).
CREATE OR REPLACE FUNCTION public.lotti_inbox_record_mode()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ator text := nullif(current_setting('lotti.ator_evento', true), '');
  v_motivo text := nullif(current_setting('lotti.evento_motivo', true), '');
begin
  -- Closing also pauses the IA, but the event people need to see is the closure.
  if new.status = 'closed' and new.status is distinct from old.status then return new; end if;
  if new.mode is distinct from old.mode then
    if v_ator is null and v_motivo is null and old.mode = 'ai' and new.mode = 'human'
       and exists (select 1 from public.lotti_agent_messages m
                   where m.conversation_id = new.id and m.direction = 'out' and m.sender = 'human' and m.created_at = now()) then
      v_ator := 'a equipe';
      v_motivo := 'respondeu_whatsapp';
    end if;
    insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, subject_label, actor_label)
    values (new.id, 'mode', old.mode, case new.mode when 'ai' then 'IA' when 'human' then 'Equipe' else 'Pausada' end,
      v_motivo, coalesce(v_ator, public.lotti_inbox_event_actor()));
  end if;
  return new;
end;
$function$
;

-- 3. Resposta pelo celular: a IA entra em espera (pausa_ia_ate) sem trocar de modo e nada aparecia.
-- Só na transição (a pausa estava vencida ou vazia), com o agente ligado no número e o cliente já tendo
-- escrito — conversa que a equipe começou pelo celular não ganha "IA em espera". Vale também com a
-- conversa fechada: se o cliente reabrir dentro das 24 h, a linha do tempo explica por que a IA não volta.
-- Quem grava pausa_ia_ate: lotti_agent_ingest (celular), lotti_manual_finish (Inbox, com o modo já
-- 'human', barrado pelo WHEN) e lotti_agent_set_mode (só limpa).
CREATE OR REPLACE FUNCTION public.lotti_inbox_record_pausa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.lotti_agent_channels h where h.id = new.channel_id and h.enabled and not h.sandbox) then
    return new;
  end if;
  if not exists (select 1 from public.lotti_agent_messages m where m.conversation_id = new.id and m.direction = 'in') then
    return new;
  end if;
  insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, subject_label, actor_label)
  values (new.id, 'pausa', 'IA', 'Em espera', 'respondeu_whatsapp', 'a equipe');
  return new;
end;
$function$
;

REVOKE ALL ON FUNCTION public.lotti_inbox_record_pausa() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lotti_inbox_record_pausa() FROM anon;
REVOKE ALL ON FUNCTION public.lotti_inbox_record_pausa() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_inbox_record_pausa() TO service_role;

DROP TRIGGER IF EXISTS lotti_inbox_record_pausa ON public.lotti_agent_conversations;
CREATE TRIGGER lotti_inbox_record_pausa AFTER UPDATE OF pausa_ia_ate ON public.lotti_agent_conversations
  FOR EACH ROW
  WHEN (new.mode = 'ai' AND new.pausa_ia_ate > now() AND (old.pausa_ia_ate IS NULL OR old.pausa_ia_ate <= now()))
  EXECUTE FUNCTION public.lotti_inbox_record_pausa();

-- 4. Envio pelo Inbox: quem envia é sempre o dono da conta (p_owner = corretores.id de quem está logado,
-- conferido na API e na conversa). O nome vai para o evento de modo como autor, com o motivo. Mesma
-- assinatura de antes: nada muda no runtime nem na API, e os grants continuam.
CREATE OR REPLACE FUNCTION public.lotti_manual_begin(p_owner uuid, p_conversation uuid, p_request uuid, p_fingerprint text, p_content text, p_media text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 perform set_config('lotti.ator_evento', coalesce((select nullif(btrim(c.nome),'') from public.corretores c where c.id=p_owner), 'a equipe'), true);
 perform set_config('lotti.evento_motivo', 'assumiu_inbox', true);
 update public.lotti_agent_conversations set mode='human',lease_token=null,lease_until=null,updated_at=now() where id=cv.id;
 perform set_config('lotti.ator_evento', '', true);
 perform set_config('lotti.evento_motivo', '', true);
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
 insert into public.lotti_manual_sends(request_id,conversation_id,corretor_id,fingerprint,content,media_path)
 values(p_request,cv.id,p_owner,p_fingerprint,p_content,p_media);
 return jsonb_build_object('status','ready','instance',ch.instance,'phone',cv.phone,'lid',cv.lid);
end $function$
;
