-- Resposta da equipe (pelo celular ou pelo Inbox) desliga a IA de vez, sem "em espera".
-- O ingest e o lotti_manual_finish gravam pausa_ia_ate = now()+prazo; este gatilho troca isso por
-- mode='human' antes de gravar. O evento de modo (lotti_inbox_record_mode) mostra "IA desligada"
-- com o motivo 'respondeu_whatsapp' quando veio do celular. Para a IA voltar, alguém religa.
CREATE OR REPLACE FUNCTION public.lotti_agent_resposta_desliga_ia()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.mode in ('ai', 'human') and new.pausa_ia_ate is not null and new.pausa_ia_ate > now()
     and new.pausa_ia_ate is distinct from old.pausa_ia_ate then
    new.mode := 'human';
    new.pausa_ia_ate := null;
  end if;
  return new;
end;
$function$
;

REVOKE ALL ON FUNCTION public.lotti_agent_resposta_desliga_ia() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lotti_agent_resposta_desliga_ia() FROM anon;
REVOKE ALL ON FUNCTION public.lotti_agent_resposta_desliga_ia() FROM authenticated;

DROP TRIGGER IF EXISTS lotti_agent_resposta_desliga_ia ON public.lotti_agent_conversations;
CREATE TRIGGER lotti_agent_resposta_desliga_ia BEFORE UPDATE OF pausa_ia_ate ON public.lotti_agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.lotti_agent_resposta_desliga_ia();

-- Conversas que estão em espera agora passam a desligadas (mesmo estado que teriam com a regra nova).
UPDATE public.lotti_agent_conversations SET mode = 'human', pausa_ia_ate = null
 WHERE mode = 'ai' AND pausa_ia_ate > now();
