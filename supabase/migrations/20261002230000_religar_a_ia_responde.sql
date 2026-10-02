begin;

-- Religar a IA faz ela responder, em vez de só armá-la para depois.
--
-- Relatado em produção: "quando a IA desativa e depois eu ativo, ela demora
-- muito para responder". Conferido no banco: depois do handoff, `revision` e
-- `processed_revision` estavam iguais (21 e 21). Não havia nada pendente, então
-- `claim` não tinha o que pegar — a IA ficava ligada esperando o cliente
-- escrever DE NOVO. O corretor via o interruptor aceso e silêncio.
--
-- O Clix passou pelo mesmo defeito e registra no próprio código: religar não
-- pode ser só limpar a pausa, tem de convocar a IA. Lá isso virou o campo
-- `aiEngagedAt`; aqui, uma revisão nova quando a última palavra é do cliente.
--
-- Só quando a última mensagem é do cliente. Se a equipe ou a IA falou por
-- último, não há pergunta esperando resposta, e a IA entrar por cima seria
-- falar sem ser chamada.

create or replace function public.lotti_agent_set_mode(p_id uuid, p_mode text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations;
begin
 if p_mode not in ('ai','human','paused') then raise exception 'invalid mode'; end if;
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if not exists(select 1 from public.corretores where id=cv.corretor_id and user_id=auth.uid()) then raise exception 'forbidden'; end if;
 if p_mode='ai' and exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status in ('sending','uncertain')) then raise exception 'reconcile uncertain delivery first'; end if;
 update public.lotti_agent_conversations set mode=p_mode,
 lease_token=case when exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status='sending') then lease_token else null end,
 lease_until=case when exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status='sending') then lease_until else null end,
 pausa_ia_ate=case when p_mode='ai' then null else pausa_ia_ate end,
 updated_at=now() where id=p_id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=p_id and status='prepared';
 if p_mode='ai' then
   delete from public.lotti_agent_outbox where conversation_id=p_id and status='cancelled' and revision=cv.revision;
   update public.lotti_agent_conversations set attempts=0,falhas_de_envio=0,next_attempt_at=now() where id=p_id;
   -- Religar com a última palavra sendo do cliente: a IA responde já.
   -- Depois de um handoff a revisão fica marcada como processada; religar só
   -- armava a IA para a PRÓXIMA mensagem, e o corretor via "IA ligada" sem
   -- resposta nenhuma. Parecia lentidão, era espera.
   -- Abre uma revisão nova em vez de rebaixar processed_revision: a revisão
   -- antiga pode ter registro no outbox, e `prepare` só grava por cima de
   -- registro em 'prepared' — rebaixar travaria a conversa no laço mudo.
   if cv.revision = cv.processed_revision and (
     select m.sender from public.lotti_agent_messages m
      where m.conversation_id = p_id order by m.created_at desc, m.id desc limit 1
   ) = 'lead' then
     update public.lotti_agent_conversations set revision = revision + 1 where id = p_id;
   end if;
 end if;
 return true;
end $function$;

notify pgrst,'reload schema';
commit;
