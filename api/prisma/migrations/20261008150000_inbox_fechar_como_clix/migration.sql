-- Fechar conversa no Inbox do WhatsApp no padrão do Clix (2026-10-08).
--  * Quem fechou fica carimbado (closed_by): 'humano' (vendedor), 'silencio' (acompanhamento sem
--    resposta); 'ia' e 'cliente' ficam reservados para quando a IA encerrar sozinha.
--  * Fechar NÃO pausa mais a IA: quem volta a escrever é atendido de novo. Pausar continua sendo o
--    botão da IA. (No Clix, fechar com pausa deixava o cliente que volta sem IA e sem humano.)
--  * Reabrir (pelo vendedor ou porque o cliente escreveu) apaga o carimbo; a reabertura pelo cliente
--    aparece na linha do tempo como "reaberta por Cliente".
-- A ordem e o filtro Abertas/Fechadas ficam na API (lista pela última mensagem).

ALTER TABLE public.lotti_agent_conversations
  ADD COLUMN IF NOT EXISTS closed_by text,
  ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone;

ALTER TABLE public.lotti_agent_conversations DROP CONSTRAINT IF EXISTS lotti_agent_conversations_closed_by_check;
ALTER TABLE public.lotti_agent_conversations ADD CONSTRAINT lotti_agent_conversations_closed_by_check
  CHECK (closed_by IS NULL OR closed_by = ANY (ARRAY['humano'::text, 'ia'::text, 'cliente'::text, 'silencio'::text]));

-- Já fechadas antes do carimbo: sem autor conhecido (ficam fora do filtro "Fechada por"), com a hora
-- da última mudança como melhor aproximação de quando fecharam.
UPDATE public.lotti_agent_conversations SET closed_at = updated_at WHERE status = 'closed' AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS lotti_agent_conversations_status_idx
  ON public.lotti_agent_conversations USING btree (corretor_id, status) WHERE archived_at IS NULL;

-- Carimbo em um lugar só: qualquer caminho que mude o status passa por aqui.
CREATE OR REPLACE FUNCTION public.lotti_conversa_carimbo_fechamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
  else
    new.closed_by := null;
    new.closed_at := null;
  end if;
  return new;
end $function$
;
REVOKE ALL ON FUNCTION public.lotti_conversa_carimbo_fechamento() FROM PUBLIC;

DROP TRIGGER IF EXISTS lotti_conversa_carimbo_fechamento ON public.lotti_agent_conversations;
CREATE TRIGGER lotti_conversa_carimbo_fechamento BEFORE UPDATE OF status ON public.lotti_agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.lotti_conversa_carimbo_fechamento();

-- Vendedor fecha/reabre: carimba 'humano' e não mexe mais no modo da IA.
CREATE OR REPLACE FUNCTION public.lotti_inbox_set_status(p_conversation uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid;
begin
  if p_status not in ('open','closed') then raise exception 'invalid_status'; end if;
  select corretor_id into v_owner from public.lotti_agent_conversations where id=p_conversation;
  if not exists(select 1 from public.corretores where id=v_owner and user_id=auth.uid()) then raise exception 'forbidden'; end if;
  update public.lotti_agent_conversations
    set status=p_status,
        closed_by=case when p_status='closed' then 'humano' else null end,
        updated_at=now()
    where id=p_conversation and status is distinct from p_status;
  return p_status;
end $function$
;

-- Acompanhamento automático que termina sem resposta: fecha como 'silencio'.
CREATE OR REPLACE FUNCTION public.lotti_agent_followup_close(p_id uuid, p_token uuid, p_revision bigint, p_close boolean, p_stage uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or (p_token is not null and cv.lease_token is distinct from p_token) then return false; end if;
  if cv.revision <> p_revision or cv.followup_revision is distinct from p_revision or cv.mode <> 'ai' or cv.status <> 'open' then
    update public.lotti_agent_conversations set followup_due_at = null,
      lease_token = case when p_token is not null then null else lease_token end,
      lease_until = case when p_token is not null then null else lease_until end
    where id = p_id;
    return false;
  end if;
  if p_close then perform set_config('lotti.ator_evento', 'acompanhamento sem resposta', true); end if;
  update public.lotti_agent_conversations set followup_due_at = null, lease_token = null, lease_until = null,
    status = case when p_close then 'closed' else status end,
    closed_by = case when p_close then 'silencio' else closed_by end,
    updated_at = now()
  where id = p_id;
  perform set_config('lotti.ator_evento', '', true);
  perform public.lotti_agent_move_stage(p_id, p_stage);
  return true;
end $function$
;

-- Cliente escreveu (mensagem da última hora; o histórico importado não reabre): reabre e a linha do
-- tempo mostra "reaberta por Cliente".
CREATE OR REPLACE FUNCTION public.lotti_inbox_reopen_on_inbound()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_recente boolean;
begin
  if new.direction='in' then
    v_recente := new.created_at>=now()-interval '1 hour';
    if v_recente then perform set_config('lotti.ator_evento', 'Cliente', true); end if;
    update public.lotti_agent_conversations
    set status=case when v_recente then 'open' else status end,
        updated_at=greatest(updated_at,new.created_at)
    where id=new.conversation_id;
    perform set_config('lotti.ator_evento', '', true);
  end if;
  return new;
end $function$
;

-- Evento de status com o autor certo: o vendedor logado, 'Cliente' ou o acompanhamento.
CREATE OR REPLACE FUNCTION public.lotti_inbox_record_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status is distinct from old.status then
    insert into public.lotti_inbox_events(conversation_id, kind, from_label, to_label, actor_label)
    values (new.id, 'status', case old.status when 'closed' then 'Fechada' else 'Aberta' end,
      case new.status when 'closed' then 'Fechada' else 'Aberta' end,
      coalesce(nullif(current_setting('lotti.ator_evento', true), ''), public.lotti_inbox_event_actor()));
  end if;
  return new;
end $function$
;
