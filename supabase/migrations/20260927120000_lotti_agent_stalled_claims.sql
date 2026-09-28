-- SCRUM-32: conversa reservada pela IA e abandonada (runtime caiu, n8n estourou
-- o tempo, IA sem chave) voltava para a fila a cada 2 min para sempre, sem ir
-- para o corretor e sem alerta. O runtime chama esta função antes de cada claim:
-- na 3ª reserva abandonada, a conversa vai para a equipe com alerta, como já
-- acontece em lotti_agent_fail. Não redefine claim/fail, então vale tanto para
-- a main quanto para a branch de número oculto (LID).
begin;

create or replace function public.lotti_agent_escalate_stalled() returns int
language plpgsql security invoker set search_path='' as $$
declare cv record; total int:=0;
begin
 for cv in
  select c.id,c.corretor_id,c.cliente_id,h.sandbox
  from public.lotti_agent_conversations c join public.lotti_agent_channels h on h.id=c.channel_id
  where h.enabled and c.mode='ai' and c.attempts>=3 and c.lease_until<now()
  -- Envio em andamento com lease vencido é tratado pelo claim (vira incerto).
  and not exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status='sending')
  for update of c skip locked
 loop
  update public.lotti_agent_conversations set mode='human',lease_token=null,lease_until=null,last_error='processing_stalled' where id=cv.id;
  update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
  if not cv.sandbox then
   insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
   values(cv.corretor_id,cv.cliente_id,'GERAL','Conversa aguardando a equipe: o atendimento automático não concluiu',
    jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia',
    case when cv.cliente_id is not null then 'cliente' end,cv.cliente_id);
  end if;
  total:=total+1;
 end loop;
 return total;
end $$;

revoke all on function public.lotti_agent_escalate_stalled() from public,anon,authenticated;
grant execute on function public.lotti_agent_escalate_stalled() to service_role;

notify pgrst,'reload schema';
commit;
