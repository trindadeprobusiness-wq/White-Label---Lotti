begin;

-- A IA volta sozinha, e o modo de atendimento passa a valer.
--
-- Três mudanças que vêm do mesmo problema: hoje, qualquer resposta humana
-- empurra a conversa para `mode='human'` PARA SEMPRE. Responder uma vez pelo
-- celular condena o contato ao atendimento manual, e ninguém lembra de voltar.
-- Foi assim que 102 das 103 conversas do número real pararam no humano.
--
-- O Clix resolve com uma pausa que expira: responder manualmente silencia a IA
-- por 24h, e depois ela retoma sozinha. É o que se faz aqui.
--
--   1. `pausa_ia_ate`: nulo ou vencido = a IA pode atender.
--   2. As trocas AUTOMÁTICAS para humano viram pausa com prazo. A troca
--      MANUAL, feita no Inbox, continua permanente — é decisão de gente.
--   3. `behavior.attendMode` já existia nas configurações e nunca foi
--      consultado. Agora decide: sempre, só fora do horário, ou só quando o
--      corretor não respondeu nos últimos N minutos.

alter table public.lotti_agent_conversations
  add column if not exists pausa_ia_ate timestamptz;

comment on column public.lotti_agent_conversations.pausa_ia_ate is
  'Silêncio temporário da IA. Nulo ou no passado = a IA pode atender. Escrito '
  'automaticamente quando um humano responde; a troca manual de modo é que é '
  'permanente.';

-- Índice parcial: a fila pergunta por isto a cada ciclo, e a esmagadora
-- maioria das linhas tem o campo nulo.
create index if not exists lotti_agent_conversations_pausa_idx
  on public.lotti_agent_conversations(pausa_ia_ate)
  where pausa_ia_ate is not null;

-- Quanto tempo a resposta humana silencia a IA. 24h é o valor do Clix: cobre
-- o dia seguinte sem condenar a conversa para sempre.
create or replace function public.lotti_agent_pausa_padrao() returns interval
language sql immutable set search_path='' as $$ select interval '24 hours' $$;

-- ── Modo de atendimento ────────────────────────────────────────────────────
--
-- Lê `behavior.attendMode` das configurações do dono. Sem configuração salva,
-- o comportamento é `always`, que é o de hoje.
create or replace function public.lotti_agent_pode_atender(p_conversa uuid, p_agora timestamptz default now())
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_owner uuid; v_cfg jsonb; v_modo text; v_minutos int; v_houve_humano boolean;
  v_tz text; v_local timestamp; v_dia jsonb; v_hora time;
  -- extract(dow) devolve 0 para domingo. As chaves são as da aba Agendamento.
  v_dias constant text[] := array['sun','mon','tue','wed','thu','fri','sat'];
begin
  select corretor_id into v_owner from public.lotti_agent_conversations where id = p_conversa;
  if v_owner is null then return false; end if;

  select settings into v_cfg from public.lotti_agent_settings where corretor_id = v_owner;
  v_modo := coalesce(v_cfg #>> '{behavior,attendMode}', 'always');

  if v_modo = 'always' then return true; end if;

  if v_modo = 'outside_hours' then
    -- Fora do expediente a IA cobre o turno. O expediente é o da aba
    -- Agendamento: um horário por dia da semana, no fuso escolhido ali.
    v_tz    := coalesce(nullif(v_cfg #>> '{schedule,timezone}', ''), 'America/Sao_Paulo');
    v_local := p_agora at time zone v_tz;
    v_dia   := v_cfg #> array['schedule', 'week', v_dias[extract(dow from v_local)::int + 1]];

    -- Dia sem expediente (domingo, por exemplo) é turno inteiro da IA.
    if v_dia is null or coalesce((v_dia->>'enabled')::boolean, false) is not true then
      return true;
    end if;

    v_hora := v_local::time;
    return v_hora < coalesce(nullif(v_dia->>'start', ''), '09:00')::time
        or v_hora >= coalesce(nullif(v_dia->>'end', ''), '18:00')::time;
  end if;

  if v_modo = 'after_delay' then
    -- A IA só entra quando o corretor não respondeu. Se ele falou há pouco,
    -- a conversa é dele: entrar por cima seria falar junto.
    v_minutos := coalesce((v_cfg #>> '{behavior,attendDelayMinutes}')::int, 5);
    select exists(
      select 1 from public.lotti_agent_messages m
       where m.conversation_id = p_conversa
         and m.sender = 'human'
         and m.created_at >= p_agora - make_interval(mins => v_minutos)
    ) into v_houve_humano;
    return not v_houve_humano;
  end if;

  return true;
end $$;

revoke all on function public.lotti_agent_pode_atender(uuid, timestamptz) from public, anon, authenticated;

-- ── A fila passa a respeitar a pausa e o modo ──────────────────────────────
--
-- O corpo é o da versão anterior; mudam só as duas condições novas no `where`
-- e a checagem de modo logo depois de escolher a conversa.
create or replace function public.lotti_agent_claim() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; token uuid:=gen_random_uuid();
  pstart date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date; allowance int; unlimited_flag boolean; used int;
begin
 update public.lotti_agent_outbox o set status='uncertain' from public.lotti_agent_conversations c
 where o.conversation_id=c.id and o.status='sending' and c.lease_until<now();
 update public.lotti_agent_conversations c set mode='human',last_error='delivery_uncertain'
 where c.mode='ai' and exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status='uncertain');

 select c.* into cv from public.lotti_agent_conversations c
   join public.lotti_agent_channels h on h.id=c.channel_id
  where h.enabled and c.mode='ai' and c.revision>c.processed_revision and c.next_attempt_at<=now()
    and (c.lease_until is null or c.lease_until<now())
    -- Pausa automática: a IA fica quieta pelo prazo e volta sozinha.
    and (c.pausa_ia_ate is null or c.pausa_ia_ate<=now())
    and not exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status in ('sending','uncertain'))
  order by c.next_attempt_at for update of c skip locked limit 1;
 if cv.id is null then return null; end if;

 -- Modo de atendimento. Não é erro nem bloqueio: é a vez do corretor. A
 -- conversa continua na fila, para ser reavaliada no próximo ciclo.
 if not public.lotti_agent_pode_atender(cv.id) then
   update public.lotti_agent_conversations set next_attempt_at=now()+interval '60 seconds' where id=cv.id;
   return jsonb_build_object('skipped','attend_mode');
 end if;

 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if not ch.sandbox then
   perform pg_advisory_xact_lock(hashtextextended(ch.corretor_id::text, 714));
   select e.limit_value,e.unlimited into allowance,unlimited_flag from public.subscriptions s
   join public.plan_entitlements e on e.plan_id=s.plan_id and e.feature_key='leads_qualificados_monthly' and e.enabled
   where s.corretor_id=ch.corretor_id and s.status in ('active','trialing')
   and (case when s.status='trialing' then s.trial_ends_at else s.current_period_end end)>now()
   order by s.created_at desc limit 1;
   if allowance is null and not coalesce(unlimited_flag,false) then
     update public.lotti_agent_conversations set mode='human',last_error='no_active_entitlement' where id=cv.id;
     insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem) values(cv.corretor_id,cv.cliente_id,'GERAL','Novo contato aguardando atendimento: plano de IA indisponível',jsonb_build_object('source','lotti_agent','conversation_id',cv.id),'ia');
     return jsonb_build_object('blocked','no_active_entitlement');
   end if;
   if not exists(select 1 from public.lotti_agent_usage where corretor_id=ch.corretor_id and phone=cv.phone and period_start=pstart) then
     select coalesce(max(used_quantity),0) into used from public.usage_counters where corretor_id=ch.corretor_id and feature_key='leads_qualificados_monthly' and period_start=pstart;
     if not coalesce(unlimited_flag,false) and used>=allowance then
       update public.lotti_agent_conversations set mode='human',last_error='quota_exhausted' where id=cv.id;
       insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem) values(cv.corretor_id,cv.cliente_id,'GERAL','Novo contato aguardando atendimento: franquia de IA atingida',jsonb_build_object('source','lotti_agent','conversation_id',cv.id),'ia');
       return jsonb_build_object('blocked','quota_exhausted');
     end if;
     insert into public.lotti_agent_usage(corretor_id,phone,period_start) values(ch.corretor_id,cv.phone,pstart);
     insert into public.usage_counters(corretor_id,feature_key,used_quantity,period_start,period_end)
     values(ch.corretor_id,'leads_qualificados_monthly',1,pstart,(pstart+interval '1 month'-interval '1 day')::date)
     on conflict(corretor_id,feature_key,period_start) do update set used_quantity=public.usage_counters.used_quantity+1,updated_at=now();
   end if;
 end if;
 update public.lotti_agent_conversations set lease_token=token,lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=cv.id;
 return jsonb_build_object('id',cv.id,'token',token,'revision',cv.revision,'corretor_id',cv.corretor_id,'instance',ch.instance,'phone',cv.phone,'sandbox',ch.sandbox,'profile',cv.qualification);
end $$;

-- ── Resposta pelo celular: pausa, não condenação ──────────────────────────
--
-- Era `mode='human'` para sempre. Agora silencia pelo prazo e volta sozinha.
-- `unsupported` (mídia que não sabemos tratar) continua indo para humano de
-- vez: ali a IA não tem como responder, não é questão de turno.
create or replace function public.lotti_agent_ingest(p_event jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ch public.lotti_agent_channels; cv public.lotti_agent_conversations; msg_id uuid; client_id uuid; is_out boolean:=coalesce((p_event->>'from_me')::boolean,false); is_ai boolean;
  v_account text:=case when p_event->>'account' ~ '^[0-9]{8,15}$' then p_event->>'account' end;
  v_name text:=case when not coalesce((p_event->>'from_me')::boolean,false) then public.lotti_agent_contact_name(p_event->>'name') end;
  v_profile text:=public.lotti_agent_contact_name(p_event->>'profile');
begin
 select * into ch from public.lotti_agent_channels where instance=p_event->>'instance';
 if ch.id is null then return jsonb_build_object('accepted',false,'reason','unregistered_channel'); end if;
 perform public.lotti_agent_bind_account(ch.id,v_account);
 cv:=public.lotti_agent_resolve_conversation(ch.id,p_event->>'phone',p_event->>'lid');
 if v_name is not null and cv.contact_name is distinct from v_name and cv.contact_name_source is distinct from 'typed' then
   update public.lotti_agent_conversations set contact_name=v_name,contact_name_source='saved' where id=cv.id;
   cv.contact_name:=v_name;
 elsif v_name is null and v_profile is not null and cv.contact_name is null then
   update public.lotti_agent_conversations set contact_name=v_profile,contact_name_source='profile' where id=cv.id;
   cv.contact_name:=v_profile;
 end if;
 is_ai:=is_out and exists(select 1 from public.lotti_agent_outbox where conversation_id=cv.id and external_id=p_event->>'external_id');
 insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content)
 values(cv.id,p_event->>'external_id',case when is_out then 'out' else 'in' end,case when is_ai then 'ai' when is_out then 'human' else 'lead' end,left(p_event->>'text',8000))
 on conflict(conversation_id,external_id) do nothing returning id into msg_id;
 if msg_id is null then return jsonb_build_object('accepted',true,'duplicate',true); end if;
 if is_ai then return jsonb_build_object('accepted',true,'echo',true); end if;
 -- Provider can echo our outbound before sendText returns its ID. Hold it for
 -- reconciliation in finish; a different ID is a real human intervention.
 if is_out and exists(select 1 from public.lotti_agent_outbox where conversation_id=cv.id and status='sending') then
   return jsonb_build_object('accepted',true,'pending_echo',true);
 end if;
 -- Capture cannot be lost when a legacy CRM insert is rejected by a plan trigger.
 if cv.cliente_id is null and not ch.sandbox and cv.phone is not null then
   begin
     client_id:=(public.lotti_find_or_create_cliente(ch.corretor_id,cv.phone,coalesce(cv.contact_name,'Contato WhatsApp'),
       jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'))->>'cliente_id')::uuid;
   exception when others then client_id:=null;
   end;
   update public.lotti_agent_conversations set cliente_id=client_id,last_error=case when client_id is null then 'crm_capture_pending' else last_error end where id=cv.id;
 else client_id:=cv.cliente_id;
 end if;
 -- Replace only the placeholder this function created; never a name typed by the user.
 if client_id is not null and cv.contact_name is not null then
   update public.clientes set nome=cv.contact_name where id=client_id and nome='Contato WhatsApp';
 end if;
 if client_id is not null then
   insert into public.historico_contatos(cliente_id,tipo,direcao,conteudo,metadata)
   values(client_id,'WHATSAPP',case when is_out then 'OUT'::public.direcao_contato else 'IN'::public.direcao_contato end,p_event->>'text',jsonb_build_object('source','lotti_agent','message_id',msg_id));
 end if;
 update public.lotti_agent_conversations set revision=revision+1,updated_at=now(),next_attempt_at=now()+interval '3 seconds',
   -- Mídia sem suporte continua sendo caso de gente: ali a IA não tem o que
   -- responder. Resposta pelo celular vira silêncio com prazo.
   mode=case when coalesce((p_event->>'unsupported')::boolean,false) then 'human' else mode end,
   pausa_ia_ate=case when is_out and not coalesce((p_event->>'unsupported')::boolean,false)
     then now()+public.lotti_agent_pausa_padrao() else pausa_ia_ate end,
   attempts=0 where id=cv.id;
 if is_out or coalesce((p_event->>'unsupported')::boolean,false) then
   update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
   -- No race: ingest is serialized per channel by lock 715 (resolve_conversation).
   if not is_out and not ch.sandbox and not exists(select 1 from public.alertas a
      where a.corretor_id=cv.corretor_id and a.lido is not true and a.origem='ia'
        and a.metadata->>'conversation_id'=cv.id::text
        and a.mensagem='Mensagem de áudio ou mídia: atendimento humano necessário') then
     insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
     values(cv.corretor_id,client_id,'GERAL','Mensagem de áudio ou mídia: atendimento humano necessário',jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
   end if;
 end if;
 return jsonb_build_object('accepted',true,'conversation_id',cv.id);
end $$;

-- ── Resposta pelo Inbox: mesma regra ──────────────────────────────────────
create or replace function public.lotti_manual_finish(p_request uuid,p_status text,p_external text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare item public.lotti_manual_sends;
begin
 select * into item from public.lotti_manual_sends where request_id=p_request for update;
 if item.request_id is null then return false; end if;
 if item.status='sent' then return true; end if;
 if p_status not in ('sent','uncertain','failed') then raise exception 'invalid_status'; end if;
 if p_status='sent' and nullif(p_external,'') is null then raise exception 'missing_id'; end if;
 update public.lotti_manual_sends set status=p_status,external_id=p_external where request_id=p_request;
 if p_status='sent' then
  insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content,media_path)
  values(item.conversation_id,p_external,'out','human',item.content,item.media_path)
  on conflict(conversation_id,external_id) do update set content=excluded.content,media_path=excluded.media_path,sender='human';
  -- Respondeu pelo Inbox: a IA se cala pelo prazo e retoma sozinha depois.
  update public.lotti_agent_conversations
     set updated_at=now(), pausa_ia_ate=now()+public.lotti_agent_pausa_padrao()
   where id=item.conversation_id;
 end if;
 return true;
end $$;

-- ── Ligar a IA no perfil limpa a pausa ────────────────────────────────────
--
-- Quem liga o interruptor quer a IA agora, não daqui a 24h. Continua sem
-- inventar mensagem: se não há nada pendente, ela fica armada para a próxima.
create or replace function public.lotti_agent_set_mode(p_id uuid,p_mode text) returns boolean
language plpgsql security definer set search_path='' as $$
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
   update public.lotti_agent_conversations set attempts=0,next_attempt_at=now() where id=p_id;
 end if;
 return true;
end $$;

-- ── Devolver à IA quem foi para o humano sem decisão de ninguém ───────────
--
-- `lotti_inbox_events` registra toda troca de modo com quem a fez:
-- `lotti_inbox_event_actor()` devolve o nome do corretor quando há sessão, e
-- 'Sistema' quando a troca veio de gatilho. Então conversa que só tem evento
-- de 'Sistema' foi empurrada para o humano por mecanismo, não por escolha —
-- e é essa que volta para a IA, com 24h de silêncio para ninguém ser
-- surpreendido hoje.
--
-- Quem um humano moveu de propósito fica onde está.
update public.lotti_agent_conversations c
   set mode='ai', pausa_ia_ate=now()+public.lotti_agent_pausa_padrao()
 where c.mode='human'
   and c.last_error is distinct from 'delivery_uncertain'
   and not exists(
     select 1 from public.lotti_inbox_events e
      where e.conversation_id=c.id and e.kind='mode' and e.actor_label <> 'Sistema'
   );

notify pgrst,'reload schema';
commit;
