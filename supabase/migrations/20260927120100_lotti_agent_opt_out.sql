-- SCRUM-37: pedido de descadastro (opt-out). Quando o lead pede para sair, a
-- conversa sai da IA, envios automáticos param e o envio manual só volta
-- depois que o lead escrever de novo. O corretor pode liberar o contato
-- (engano ou novo consentimento), e tudo fica na linha do tempo do Inbox.
-- Nada é enviado ao lead. Só gatilhos e funções novas: não redefine ingest,
-- claim nem manual_begin (que a branch de número oculto também altera).
begin;

alter table public.lotti_agent_conversations add column if not exists opted_out_at timestamptz;

alter table public.lotti_inbox_events drop constraint lotti_inbox_events_kind_check;
alter table public.lotti_inbox_events add constraint lotti_inbox_events_kind_check check (kind in ('mode','stage','status','consent'));

-- Regra determinística e conservadora: palavra-chave sozinha (ou abrindo a
-- mensagem, como "SAIR. …") ou frase explícita sobre mensagens/lista. Frases
-- como "quero sair do aluguel" ou "não quero mais esse imóvel" não contam.
create or replace function public.lotti_agent_is_opt_out(p_text text) returns boolean
language sql immutable set search_path='' as $$
 with src as (select left(coalesce(p_text,''),500) raw),
 norm as (
  select
   btrim(regexp_replace(lower(translate(raw,'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+',' ','g')) full_text,
   btrim(regexp_replace(lower(translate(coalesce(substring(raw from '^[^.!?\n\r]*'),''),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+',' ','g')) first_part
  from src)
 select full_text in ('sair','parar','pare','stop','descadastrar','descadastre','sair da lista','me tire da lista','me tira da lista','me remova da lista')
  or first_part in ('sair','parar','pare','stop','descadastrar','descadastre')
  or full_text ~ '(^| )nao quero (mais )?receber (mais )?(mensagem|mensagens|msg|msgs|nada)( |$)'
  or full_text ~ '(^| )(para|pare|parem) de (me )?(mandar|enviar) (mensagem|mensagens|msg|msgs)( |$)'
  or full_text ~ '(^| )nao (me )?(mande|mandem|envie|enviem) mais (mensagem|mensagens|msg|msgs|nada)( |$)'
  or full_text ~ '(^| )(me )?(sair|tire|tira|tirem|remova|removam|exclua|excluam|retire|retirem) (me |meu numero |meu contato )?(da|dessa|desta|da sua) lista( |$)'
  or full_text ~ 'descadastr'
 from norm
$$;
revoke all on function public.lotti_agent_is_opt_out(text) from public,anon;
grant execute on function public.lotti_agent_is_opt_out(text) to authenticated,service_role;

-- Vale para mensagens ao vivo e importadas. Só o pedido mais recente conta: um
-- "sair" antigo seguido de nova conversa no histórico não bloqueia o contato.
create or replace function public.lotti_agent_detect_opt_out() returns trigger
language plpgsql security definer set search_path='' as $$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
begin
 if new.direction<>'in' or new.sender<>'lead' or not public.lotti_agent_is_opt_out(new.content) then return null; end if;
 if exists(select 1 from public.lotti_agent_messages m where m.conversation_id=new.conversation_id and m.direction='in' and m.created_at>new.created_at) then return null; end if;
 select * into cv from public.lotti_agent_conversations where id=new.conversation_id;
 if cv.id is null or cv.opted_out_at>=new.created_at then return null; end if;
 -- O lease fica como está: prepare/begin_send cancelam quando a conversa sai da IA.
 update public.lotti_agent_conversations set opted_out_at=new.created_at,mode=case when mode='ai' then 'human' else mode end where id=cv.id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
 insert into public.lotti_inbox_events(conversation_id,kind,to_label,actor_label,created_at)
 values(cv.id,'consent','Pediu para não receber mensagens','Contato',new.created_at);
 select sandbox into v_sandbox from public.lotti_agent_channels where id=cv.channel_id;
 if not coalesce(v_sandbox,true) and new.created_at>now()-interval '1 day' then
  insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
  values(cv.corretor_id,cv.cliente_id,'GERAL','Contato pediu para não receber mais mensagens: a IA foi desligada nesta conversa',
   jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','media'),'ia',
   case when cv.cliente_id is not null then 'cliente' end,cv.cliente_id);
 end if;
 return null;
end $$;
drop trigger if exists lotti_agent_detect_opt_out on public.lotti_agent_messages;
create trigger lotti_agent_detect_opt_out after insert on public.lotti_agent_messages
for each row execute function public.lotti_agent_detect_opt_out();

-- A IA não volta para quem pediu para sair enquanto o corretor não liberar.
create or replace function public.lotti_agent_opt_out_mode_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.mode='ai' and new.opted_out_at is not null then raise exception 'contact_opted_out'; end if;
 return new;
end $$;
drop trigger if exists lotti_agent_opt_out_mode_guard on public.lotti_agent_conversations;
create trigger lotti_agent_opt_out_mode_guard before update of mode on public.lotti_agent_conversations
for each row execute function public.lotti_agent_opt_out_mode_guard();

-- Envio manual (inclusive "Nova conversa") só depois de nova mensagem do lead.
create or replace function public.lotti_manual_opt_out_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_opted timestamptz;
begin
 select opted_out_at into v_opted from public.lotti_agent_conversations where id=new.conversation_id;
 if v_opted is not null and not exists(select 1 from public.lotti_agent_messages m
   where m.conversation_id=new.conversation_id and m.direction='in' and m.created_at>v_opted) then
  raise exception 'contact_opted_out';
 end if;
 return new;
end $$;
drop trigger if exists lotti_manual_opt_out_guard on public.lotti_manual_sends;
create trigger lotti_manual_opt_out_guard before insert on public.lotti_manual_sends
for each row execute function public.lotti_manual_opt_out_guard();

-- O corretor libera o contato: pedido por engano ou novo consentimento. Não
-- religa a IA; isso continua sendo uma ação separada.
create or replace function public.lotti_inbox_clear_opt_out(p_conversation uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_opted timestamptz;
begin
 select corretor_id,opted_out_at into v_owner,v_opted from public.lotti_agent_conversations where id=p_conversation for update;
 if not exists(select 1 from public.corretores where id=v_owner and user_id=auth.uid()) then raise exception 'forbidden'; end if;
 if v_opted is null then return false; end if;
 update public.lotti_agent_conversations set opted_out_at=null,updated_at=now() where id=p_conversation;
 insert into public.lotti_inbox_events(conversation_id,kind,from_label,to_label,actor_label)
 values(p_conversation,'consent','Pediu para não receber mensagens','Contato liberado',public.lotti_inbox_event_actor());
 return true;
end $$;
revoke all on function public.lotti_inbox_clear_opt_out(uuid) from public,anon;
grant execute on function public.lotti_inbox_clear_opt_out(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
