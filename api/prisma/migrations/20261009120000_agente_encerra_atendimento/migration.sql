-- Agente de IA encerra o atendimento como no Clix (encerrar_atendimento, 2026-10-09).
-- A IA só fecha quando o CLIENTE sinaliza que terminou ("era só isso", "obrigado, resolvido"): o
-- carimbo é 'cliente' (filtro "Cliente pediu") e a linha do tempo mostra "fechada por IA". O motivo
-- curto que a IA escreveu fica em closed_reason; reabrir apaga, como o resto do carimbo.

ALTER TABLE public.lotti_agent_conversations ADD COLUMN IF NOT EXISTS closed_reason text;

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
    new.closed_reason := null;
  end if;
  return new;
end $function$
;

-- Chamada pelo runtime depois que a despedida foi entregue. Só fecha a conversa que continua como a
-- IA deixou: o cliente não escreveu de novo (revision), a resposta foi registrada (processed_revision),
-- ninguém tirou da IA, pausou, fechou ou arquivou antes. Sem pausar a IA: quem volta é atendido.
CREATE OR REPLACE FUNCTION public.lotti_agent_end_conversation(p_id uuid, p_revision bigint, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.revision <> p_revision or cv.processed_revision < p_revision
     or cv.mode <> 'ai' or cv.status <> 'open' or cv.archived_at is not null
     or (cv.pausa_ia_ate is not null and cv.pausa_ia_ate > now()) then
    return false;
  end if;
  perform set_config('lotti.ator_evento', 'IA', true);
  update public.lotti_agent_conversations
    set status = 'closed', closed_by = 'cliente', closed_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 280),
        followup_due_at = null, updated_at = now()
  where id = p_id;
  perform set_config('lotti.ator_evento', '', true);
  return true;
end $function$
;
REVOKE ALL ON FUNCTION public.lotti_agent_end_conversation(uuid,bigint,text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.lotti_agent_end_conversation(uuid,bigint,text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.lotti_agent_end_conversation(uuid,bigint,text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.lotti_agent_end_conversation(uuid,bigint,text) TO service_role;
  END IF;
END $$;
