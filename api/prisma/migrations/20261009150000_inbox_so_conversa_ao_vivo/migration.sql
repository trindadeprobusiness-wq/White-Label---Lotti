-- Como no Clix: a conversa só aparece no Inbox quando alguém manda mensagem depois de o número estar
-- conectado. As que vieram só do histórico importado na conexão ficam guardadas, mas fora da lista;
-- voltam sozinhas quando chega (ou sai) a primeira mensagem ao vivo.
--
-- Como saber o que é histórico: a importação grava o horário do WhatsApp, em segundos cheios; a mensagem
-- ao vivo grava now(), com fração de segundo. Só lotti_agent_import_history insere com created_at.

alter table public.lotti_agent_conversations
  add column if not exists so_historico boolean not null default false;

update public.lotti_agent_conversations c set so_historico = true
where exists (select 1 from public.lotti_agent_messages m where m.conversation_id = c.id)
  and not exists (select 1 from public.lotti_agent_messages m
    where m.conversation_id = c.id and m.created_at <> date_trunc('second', m.created_at));

CREATE OR REPLACE FUNCTION public.lotti_agent_marca_so_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.created_at <> date_trunc('second', new.created_at) then
    update public.lotti_agent_conversations set so_historico = false
    where id = new.conversation_id and so_historico;
  else
    -- Conversa nova criada pela importação: fica fora da lista até ter mensagem ao vivo.
    update public.lotti_agent_conversations c set so_historico = true
    where c.id = new.conversation_id and not c.so_historico
      and not exists (select 1 from public.lotti_agent_messages m
        where m.conversation_id = c.id and m.created_at <> date_trunc('second', m.created_at));
  end if;
  return null;
end $function$;

DROP TRIGGER IF EXISTS lotti_agent_marca_so_historico ON public.lotti_agent_messages;
CREATE TRIGGER lotti_agent_marca_so_historico
  AFTER INSERT ON public.lotti_agent_messages
  FOR EACH ROW EXECUTE FUNCTION public.lotti_agent_marca_so_historico();
