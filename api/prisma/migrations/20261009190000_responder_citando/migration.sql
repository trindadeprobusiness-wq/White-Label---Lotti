-- Responder citando, como no WhatsApp: a equipe cita uma mensagem no Inbox e a resposta chega citada no
-- celular do cliente; quando o cliente cita, a citação aparece no balão.

alter table public.lotti_agent_messages
  add column if not exists quoted_external_id text,
  add column if not exists quoted_content text,
  add column if not exists quoted_from_me boolean;
alter table public.lotti_agent_messages
  add constraint lotti_agent_messages_quoted_content_len check (quoted_content is null or length(quoted_content) <= 300);
alter table public.lotti_manual_sends add column if not exists quoted_message_id uuid;

-- begin ganha p_quote (default null). DROP + CREATE na mesma migration: com as duas versões juntas, a
-- chamada de hoje (6 argumentos nomeados, runtime) ficaria ambígua. Corpo igual ao de
-- 20261009170000_ia_parada_com_motivo, mais a citação.
DROP FUNCTION public.lotti_manual_begin(uuid, uuid, uuid, text, text, text);
CREATE FUNCTION public.lotti_manual_begin(p_owner uuid, p_conversation uuid, p_request uuid, p_fingerprint text, p_content text, p_media text, p_quote uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; prior public.lotti_manual_sends; q public.lotti_agent_messages;
begin
 select * into cv from public.lotti_agent_conversations where id=p_conversation and corretor_id=p_owner for update;
 if cv.id is null then raise exception 'forbidden'; end if;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if ch.sandbox then raise exception 'sandbox'; end if;
 -- Só cita mensagem real do WhatsApp desta conversa (pendente, ligação e simulação não têm id do WhatsApp).
 if p_quote is not null then
  select * into q from public.lotti_agent_messages where id=p_quote and conversation_id=cv.id;
  if q.id is null or nullif(q.external_id,'') is null or q.external_id like 'simulation:%' or q.external_id like 'call-%' then
   raise exception 'invalid_quote';
  end if;
 end if;
 update public.lotti_manual_sends set status='uncertain' where conversation_id=cv.id and status='sending' and created_at<now()-interval '2 minutes';
 select * into prior from public.lotti_manual_sends where request_id=p_request;
 if prior.request_id is not null then
  if prior.corretor_id<>p_owner or prior.conversation_id<>p_conversation or prior.fingerprint<>p_fingerprint
     or prior.quoted_message_id is distinct from p_quote then raise exception 'request_conflict'; end if;
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
 insert into public.lotti_manual_sends(request_id,conversation_id,corretor_id,fingerprint,content,media_path,quoted_message_id)
 values(p_request,cv.id,p_owner,p_fingerprint,p_content,p_media,p_quote);
 return jsonb_build_object('status','ready','instance',ch.instance,'phone',cv.phone,'lid',cv.lid)
   || case when q.id is null then '{}'::jsonb else jsonb_build_object('quote',jsonb_build_object(
        'external_id',q.external_id,'from_me',q.direction='out','content',left(q.content,300))) end;
end $function$
;
REVOKE ALL ON FUNCTION public.lotti_manual_begin(uuid,uuid,uuid,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lotti_manual_begin(uuid,uuid,uuid,text,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.lotti_manual_begin(uuid,uuid,uuid,text,text,text,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_manual_begin(uuid,uuid,uuid,text,text,text,uuid) TO service_role;

-- finish copia a citação; se o eco do WhatsApp chegou antes e criou a linha, o DO UPDATE completa sem apagar.
CREATE OR REPLACE FUNCTION public.lotti_manual_finish(p_request uuid, p_status text, p_external text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare item public.lotti_manual_sends; q public.lotti_agent_messages;
begin
 select * into item from public.lotti_manual_sends where request_id=p_request for update;
 if item.request_id is null then return false; end if;
 if item.status='sent' then return true; end if;
 if p_status not in ('sent','uncertain','failed') then raise exception 'invalid_status'; end if;
 if p_status='sent' and nullif(p_external,'') is null then raise exception 'missing_id'; end if;
 update public.lotti_manual_sends set status=p_status,external_id=p_external where request_id=p_request;
 if p_status='sent' then
  if item.quoted_message_id is not null then select * into q from public.lotti_agent_messages where id=item.quoted_message_id; end if;
  insert into public.lotti_agent_messages as m(conversation_id,external_id,direction,sender,content,media_path,quoted_external_id,quoted_content,quoted_from_me)
  values(item.conversation_id,p_external,'out','human',item.content,item.media_path,q.external_id,left(q.content,300),case when q.id is null then null else q.direction='out' end)
  on conflict(conversation_id,external_id) do update set content=excluded.content,media_path=excluded.media_path,sender='human',
    quoted_external_id=coalesce(excluded.quoted_external_id,m.quoted_external_id),
    quoted_content=coalesce(excluded.quoted_content,m.quoted_content),
    quoted_from_me=coalesce(excluded.quoted_from_me,m.quoted_from_me);
  -- Respondeu pelo Inbox: a IA se cala pelo prazo e retoma sozinha depois.
  update public.lotti_agent_conversations
     set updated_at=now(), pausa_ia_ate=now()+public.lotti_agent_pausa_padrao()
   where id=item.conversation_id;
 end if;
 return true;
end $function$
;

-- Citação vinda do WhatsApp (cliente citou, ou o eco da nossa resposta citada). RPC pequena chamada pelo
-- runtime depois do ingest, para não reescrever lotti_agent_ingest. Não sobrescreve citação já gravada.
CREATE OR REPLACE FUNCTION public.lotti_agent_set_quote(p_instance text, p_external text, p_quoted_external text, p_quoted_text text, p_quoted_from_me boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n int;
begin
 if nullif(p_external,'') is null or nullif(p_quoted_external,'') is null then return false; end if;
 update public.lotti_agent_messages m
    set quoted_external_id=p_quoted_external,
        quoted_content=coalesce(m.quoted_content, left(coalesce(
          (select o.content from public.lotti_agent_messages o where o.conversation_id=m.conversation_id and o.external_id=p_quoted_external limit 1),
          p_quoted_text),300)),
        quoted_from_me=coalesce(m.quoted_from_me,p_quoted_from_me)
   from public.lotti_agent_conversations c join public.lotti_agent_channels h on h.id=c.channel_id
  where m.conversation_id=c.id and h.instance=p_instance and m.external_id=p_external and m.quoted_external_id is null;
 get diagnostics n = row_count;
 return n>0;
end $function$
;
REVOKE ALL ON FUNCTION public.lotti_agent_set_quote(text,text,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lotti_agent_set_quote(text,text,text,text,boolean) FROM anon;
REVOKE ALL ON FUNCTION public.lotti_agent_set_quote(text,text,text,text,boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lotti_agent_set_quote(text,text,text,text,boolean) TO service_role;
