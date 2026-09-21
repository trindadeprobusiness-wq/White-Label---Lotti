-- Durable WhatsApp agent runtime. No channel is enabled by this migration.
begin;
create table public.lotti_agent_channels (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  instance text not null unique,
  enabled boolean not null default false,
  sandbox boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.lotti_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.lotti_agent_channels(id) on delete cascade,
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  mode text not null default 'ai' check (mode in ('ai','human','paused')),
  revision bigint not null default 0,
  processed_revision bigint not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts int not null default 0,
  qualification jsonb not null default '{}'::jsonb,
  notified_stage text,
  last_error text,
  updated_at timestamptz not null default now(),
  unique(channel_id,phone)
);
create table public.lotti_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.lotti_agent_conversations(id) on delete cascade,
  external_id text not null,
  direction text not null check (direction in ('in','out')),
  sender text not null check(sender in ('lead','human','ai')),
  content text not null,
  created_at timestamptz not null default now(),
  unique(conversation_id,external_id)
);
create table public.lotti_agent_usage (
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  phone text not null,
  period_start date not null,
  created_at timestamptz not null default now(),
  primary key(corretor_id,phone,period_start)
);
create table public.lotti_agent_outbox (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.lotti_agent_conversations(id) on delete cascade,
  revision bigint not null,
  content text not null,
  status text not null default 'prepared' check(status in ('prepared','sending','sent','uncertain','cancelled','simulated')),
  external_id text,
  created_at timestamptz not null default now(),
  unique(conversation_id,revision)
);
create index lotti_agent_pending_idx on public.lotti_agent_conversations(next_attempt_at) where mode='ai';
create index lotti_agent_channel_owner_idx on public.lotti_agent_channels(corretor_id);
create index lotti_agent_conversation_owner_idx on public.lotti_agent_conversations(corretor_id);
create index lotti_agent_message_time_idx on public.lotti_agent_messages(conversation_id,created_at);
create index lotti_agent_customer_idx on public.lotti_agent_conversations(cliente_id);
create index lotti_agent_usage_period_idx on public.lotti_agent_usage(corretor_id,period_start);

alter table public.lotti_agent_channels enable row level security;
alter table public.lotti_agent_conversations enable row level security;
alter table public.lotti_agent_messages enable row level security;
alter table public.lotti_agent_usage enable row level security;
alter table public.lotti_agent_outbox enable row level security;
revoke all on public.lotti_agent_channels,public.lotti_agent_conversations,public.lotti_agent_messages,public.lotti_agent_usage,public.lotti_agent_outbox from anon,authenticated;
grant all on public.lotti_agent_channels,public.lotti_agent_conversations,public.lotti_agent_messages,public.lotti_agent_usage,public.lotti_agent_outbox to service_role;
grant select on public.lotti_agent_channels,public.lotti_agent_conversations,public.lotti_agent_messages to authenticated;
create policy lotti_agent_channel_read on public.lotti_agent_channels for select to authenticated using(corretor_id in (select id from public.corretores where user_id=(select auth.uid())));
create policy lotti_agent_conversation_read on public.lotti_agent_conversations for select to authenticated using(corretor_id in (select id from public.corretores where user_id=(select auth.uid())));
create policy lotti_agent_message_read on public.lotti_agent_messages for select to authenticated using(conversation_id in (select id from public.lotti_agent_conversations));

-- Called only by the trusted runtime; tenant comes from a registered channel.
create function public.lotti_agent_ingest(p_event jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ch public.lotti_agent_channels; cv public.lotti_agent_conversations; msg_id uuid; client_id uuid; is_out boolean:=coalesce((p_event->>'from_me')::boolean,false); is_ai boolean;
begin
 select * into ch from public.lotti_agent_channels where instance=p_event->>'instance';
 if ch.id is null then return jsonb_build_object('accepted',false,'reason','unregistered_channel'); end if;
 insert into public.lotti_agent_conversations(channel_id,corretor_id,phone) values(ch.id,ch.corretor_id,p_event->>'phone') on conflict(channel_id,phone) do nothing;
 select * into cv from public.lotti_agent_conversations where channel_id=ch.id and phone=p_event->>'phone' for update;
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
 if cv.cliente_id is null and not ch.sandbox then
   select id into client_id from public.clientes where corretor_id=ch.corretor_id and regexp_replace(telefone,'[^0-9]','','g')=cv.phone order by created_at limit 1;
   if client_id is null then
     begin
       insert into public.clientes(corretor_id,nome,telefone,status_funil,tipo_interesse)
       values(ch.corretor_id,'Contato WhatsApp',cv.phone,'QUALIFICACAO','AMBOS') returning id into client_id;
     exception when others then client_id:=null;
     end;
   end if;
   update public.lotti_agent_conversations set cliente_id=client_id,last_error=case when client_id is null then 'crm_capture_pending' else last_error end where id=cv.id;
 else client_id:=cv.cliente_id;
 end if;
 if client_id is not null then
   insert into public.historico_contatos(cliente_id,tipo,direcao,conteudo,metadata)
   values(client_id,'WHATSAPP',case when is_out then 'OUT'::public.direcao_contato else 'IN'::public.direcao_contato end,p_event->>'text',jsonb_build_object('source','lotti_agent','message_id',msg_id));
 end if;
 update public.lotti_agent_conversations set revision=revision+1,updated_at=now(),next_attempt_at=now()+interval '3 seconds',
   mode=case when is_out or coalesce((p_event->>'unsupported')::boolean,false) then 'human' else mode end,
   attempts=0 where id=cv.id;
 if is_out or coalesce((p_event->>'unsupported')::boolean,false) then
   update public.lotti_agent_outbox set status='cancelled' where conversation_id=cv.id and status='prepared';
   if not is_out and not ch.sandbox then
     insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
     values(cv.corretor_id,client_id,'GERAL','Mensagem de áudio ou mídia: atendimento humano necessário',jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
   end if;
 end if;
 return jsonb_build_object('accepted',true,'conversation_id',cv.id);
end $$;

create function public.lotti_agent_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; token uuid:=gen_random_uuid(); pstart date:=date_trunc('month',now() at time zone 'America/Sao_Paulo')::date; allowance int; unlimited_flag boolean; used int;
begin
 -- Never replay a send after a worker crash: delivery may have succeeded.
 update public.lotti_agent_outbox o set status='uncertain' from public.lotti_agent_conversations c
 where o.conversation_id=c.id and o.status='sending' and c.lease_until<now();
 update public.lotti_agent_conversations c set mode='human',last_error='delivery_uncertain'
 where c.mode='ai' and exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status='uncertain');
 select c.* into cv from public.lotti_agent_conversations c join public.lotti_agent_channels h on h.id=c.channel_id
 where h.enabled and c.mode='ai' and c.revision>c.processed_revision and c.next_attempt_at<=now()
 and (c.lease_until is null or c.lease_until<now())
 and not exists(select 1 from public.lotti_agent_outbox o where o.conversation_id=c.id and o.status in ('sending','uncertain'))
 order by c.next_attempt_at for update of c skip locked limit 1;
 if cv.id is null then return null; end if;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if not ch.sandbox then
   -- One lock per account serializes quota reservations across workers/channels.
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

create function public.lotti_agent_prepare(p_id uuid,p_token uuid,p_revision bigint,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; out_id uuid; stage text:=p_result->>'stage';
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 if cv.id is null or cv.lease_token is distinct from p_token or cv.lease_until<now() then return jsonb_build_object('cancelled',true); end if;
 if cv.mode<>'ai' or cv.revision<>p_revision or not ch.enabled then
   update public.lotti_agent_conversations set lease_until=null,lease_token=null where id=p_id;
   return jsonb_build_object('cancelled',true);
 end if;
 update public.lotti_agent_conversations set qualification=p_result where id=p_id;
 if not ch.sandbox and (stage in ('qualificado_busca','qualificado_visita') or (p_result->>'humanRequested')::boolean) and cv.notified_stage is distinct from stage then
   insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem,entidade_tipo,entidade_id)
   values(cv.corretor_id,cv.cliente_id,'GERAL',case when stage like 'qualificado%' then 'Lead qualificado: pronto para atendimento do corretor' else 'Contato solicitou atendimento do corretor' end,
     jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority',p_result->>'priority','qualification',p_result), 'ia','cliente',cv.cliente_id);
   update public.lotti_agent_conversations set notified_stage=stage where id=p_id;
 end if;
 insert into public.lotti_agent_outbox(conversation_id,revision,content) values(p_id,p_revision,p_result->>'response')
 on conflict(conversation_id,revision) do nothing returning id into out_id;
 return jsonb_build_object('outbox_id',out_id);
end $$;

create function public.lotti_agent_begin_send(p_id uuid,p_token uuid,p_revision bigint,p_live boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; ob public.lotti_agent_outbox;
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 select * into ch from public.lotti_agent_channels where id=cv.channel_id;
 select * into ob from public.lotti_agent_outbox where conversation_id=p_id and revision=p_revision for update;
 if cv.lease_token is distinct from p_token or cv.lease_until<now() or cv.mode<>'ai' or cv.revision<>p_revision or not ch.enabled or ob.status is distinct from 'prepared' then
   update public.lotti_agent_outbox set status='cancelled' where id=ob.id and status='prepared';
   return jsonb_build_object('cancelled',true);
 end if;
 if ch.sandbox then
   update public.lotti_agent_outbox set status='simulated' where id=ob.id;
   insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content) values(p_id,'simulation:'||ob.id,'out','ai',ob.content);
   update public.lotti_agent_conversations set processed_revision=p_revision,lease_token=null,lease_until=null,attempts=0 where id=p_id;
   return jsonb_build_object('simulated',true);
 end if;
 if not p_live then return jsonb_build_object('blocked','live_send_disabled'); end if;
 update public.lotti_agent_outbox set status='sending' where id=ob.id;
 return jsonb_build_object('outbox_id',ob.id,'content',ob.content,'instance',ch.instance,'phone',cv.phone);
end $$;

create function public.lotti_agent_finish(p_id uuid,p_token uuid,p_revision bigint,p_external_id text) returns boolean language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ob public.lotti_agent_outbox; mid uuid;
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if cv.lease_token is distinct from p_token then return false; end if;
 select * into ob from public.lotti_agent_outbox where conversation_id=p_id and revision=p_revision and status='sending' for update;
 if ob.id is null or nullif(p_external_id,'') is null then return false; end if;
 update public.lotti_agent_outbox set status='sent',external_id=p_external_id where id=ob.id;
 insert into public.lotti_agent_messages(conversation_id,external_id,direction,sender,content) values(p_id,p_external_id,'out','ai',ob.content)
 on conflict(conversation_id,external_id) do update set sender='ai' returning id into mid;
 if cv.cliente_id is not null then
   insert into public.historico_contatos(cliente_id,tipo,direcao,conteudo,metadata) values(cv.cliente_id,'WHATSAPP','OUT',ob.content,jsonb_build_object('source','lotti_agent','message_id',mid));
 end if;
 update public.lotti_agent_conversations set processed_revision=p_revision,lease_token=null,lease_until=null,attempts=0,last_error=null,
 mode=case when exists(select 1 from public.lotti_agent_messages where conversation_id=p_id and sender='human' and created_at>=ob.created_at and external_id<>p_external_id) then 'human' else mode end where id=p_id;
 return true;
end $$;

create function public.lotti_agent_fail(p_id uuid,p_token uuid,p_error text) returns boolean language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; uncertain_send boolean;
begin
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if cv.lease_token is distinct from p_token then return false; end if;
 update public.lotti_agent_outbox set status='uncertain' where conversation_id=p_id and status='sending';
 uncertain_send:=found;
 update public.lotti_agent_conversations set last_error=left(p_error,100),lease_until=null,lease_token=null,next_attempt_at=now()+interval '30 seconds',
 mode=case when uncertain_send or attempts>=3 then 'human' else mode end where id=p_id;
 if (uncertain_send or cv.attempts>=3) and not (select sandbox from public.lotti_agent_channels where id=cv.channel_id) then
   insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem) values(cv.corretor_id,cv.cliente_id,'GERAL','Conversa precisa de revisão humana após falha no atendimento',jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
 end if;
 return true;
end $$;

-- Minimal owner-authorized operation; no permission to modify channel/account/quota.
create function public.lotti_agent_set_mode(p_id uuid,p_mode text) returns boolean language plpgsql security definer set search_path='' as $$
declare cv public.lotti_agent_conversations;
begin
 if p_mode not in ('ai','human','paused') then raise exception 'invalid mode'; end if;
 select * into cv from public.lotti_agent_conversations where id=p_id for update;
 if not exists(select 1 from public.corretores where id=cv.corretor_id and user_id=auth.uid()) then raise exception 'forbidden'; end if;
 if p_mode='ai' and exists(select 1 from public.lotti_agent_outbox where conversation_id=p_id and status in ('sending','uncertain')) then raise exception 'reconcile uncertain delivery first'; end if;
 update public.lotti_agent_conversations set mode=p_mode,revision=revision+1,updated_at=now() where id=p_id;
 update public.lotti_agent_outbox set status='cancelled' where conversation_id=p_id and status='prepared';
 return true;
end $$;

revoke all on function public.lotti_agent_ingest(jsonb),public.lotti_agent_claim(),public.lotti_agent_prepare(uuid,uuid,bigint,jsonb),public.lotti_agent_begin_send(uuid,uuid,bigint,boolean),public.lotti_agent_finish(uuid,uuid,bigint,text),public.lotti_agent_fail(uuid,uuid,text),public.lotti_agent_set_mode(uuid,text) from public,anon,authenticated;
grant execute on function public.lotti_agent_ingest(jsonb),public.lotti_agent_claim(),public.lotti_agent_prepare(uuid,uuid,bigint,jsonb),public.lotti_agent_begin_send(uuid,uuid,bigint,boolean),public.lotti_agent_finish(uuid,uuid,bigint,text),public.lotti_agent_fail(uuid,uuid,text) to service_role;
grant execute on function public.lotti_agent_set_mode(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
