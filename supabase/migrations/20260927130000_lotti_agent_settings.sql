-- Agente de IA, etapa 1: a configuração da tela passa a ficar no banco e a ponte
-- a lê a cada resposta. Só tabela e funções novas, mais start_conversation sem
-- exigir o agente ligado (a "Nova conversa" manual não depende da IA).
begin;

create table if not exists public.lotti_agent_settings (
  corretor_id uuid primary key references public.corretores(id) on delete cascade,
  settings jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.lotti_agent_settings enable row level security;
revoke all on public.lotti_agent_settings from anon, authenticated;
grant select on public.lotti_agent_settings to authenticated;
grant all on public.lotti_agent_settings to service_role;
drop policy if exists lotti_agent_settings_owner_read on public.lotti_agent_settings;
create policy lotti_agent_settings_owner_read on public.lotti_agent_settings for select to authenticated
  using (corretor_id in (select id from public.corretores where user_id = (select auth.uid())));

-- Validação no servidor do formato salvo pela tela (versão 2). O modelo só é
-- conferido no formato: a lista de modelos vive na tela e na ponte.
create or replace function public.lotti_agent_validate_settings(p jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare v_len int;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 32768 then raise exception 'invalid_settings'; end if;
  if p->'version' is distinct from '2'::jsonb or jsonb_typeof(p->'active') is distinct from 'boolean' then raise exception 'invalid_settings'; end if;
  if coalesce(p->>'model','') !~ '^[a-z][a-z0-9.-]{2,60}$' then raise exception 'invalid_model'; end if;
  if jsonb_typeof(p->'identity') is distinct from 'object' or jsonb_typeof(p->'behavior') is distinct from 'object' then raise exception 'invalid_settings'; end if;
  v_len := char_length(btrim(coalesce(p#>>'{identity,name}','')));
  if v_len < 1 or v_len > 40 then raise exception 'invalid_identity'; end if;
  if char_length(coalesce(p#>>'{identity,company}','')) > 80 or char_length(coalesce(p#>>'{identity,intro}','')) > 400 then raise exception 'invalid_identity'; end if;
  if char_length(coalesce(p->>'prompt','')) > 3000 then raise exception 'invalid_prompt'; end if;
  if coalesce(p#>>'{behavior,attendMode}','') not in ('always','outside_hours','after_delay') then raise exception 'invalid_behavior'; end if;
  if coalesce(p#>>'{behavior,handoff,mode}','') not in ('message','silent') then raise exception 'invalid_behavior'; end if;
  if char_length(coalesce(p#>>'{behavior,handoff,messageInHours}','')) > 500
     or char_length(coalesce(p#>>'{behavior,handoff,messageOutOfHours}','')) > 500 then raise exception 'invalid_behavior'; end if;
  if jsonb_typeof(p#>'{behavior,guards,aggregationSeconds}') is distinct from 'number'
     or (p#>>'{behavior,guards,aggregationSeconds}')::numeric not between 0 and 60 then raise exception 'invalid_behavior'; end if;
  if jsonb_typeof(p#>'{behavior,attendDelayMinutes}') is distinct from 'number'
     or (p#>>'{behavior,attendDelayMinutes}')::numeric not between 1 and 1440 then raise exception 'invalid_behavior'; end if;
end $$;

-- Salva a configuração do dono. "Agente ativo" liga ou desliga a IA do número
-- conectado: a fila da IA só pega canais habilitados.
create or replace function public.lotti_agent_save_settings(p_settings jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_at timestamptz;
begin
  select id into v_owner from public.corretores where user_id = auth.uid() order by id limit 1;
  if v_owner is null then raise exception 'forbidden'; end if;
  perform public.lotti_agent_validate_settings(p_settings);
  insert into public.lotti_agent_settings(corretor_id, settings, updated_at, updated_by)
  values (v_owner, p_settings, now(), auth.uid())
  on conflict (corretor_id) do update set settings = excluded.settings, updated_at = now(), updated_by = auth.uid()
  returning updated_at into v_at;
  update public.lotti_agent_channels set enabled = (p_settings->>'active')::boolean
  where corretor_id = v_owner and archived_at is null and enabled is distinct from (p_settings->>'active')::boolean;
  return jsonb_build_object('updated_at', v_at);
end $$;
revoke all on function public.lotti_agent_save_settings(jsonb) from public, anon;
grant execute on function public.lotti_agent_save_settings(jsonb) to authenticated;
revoke all on function public.lotti_agent_validate_settings(jsonb) from public, anon;
grant execute on function public.lotti_agent_validate_settings(jsonb) to authenticated, service_role;

-- A ponte adia a resposta (agrupar mensagens, esperar o corretor) ou pula a
-- conversa (fora do modo de atendimento). Adiar não conta como falha. Pular uma
-- conversa que a IA nunca respondeu devolve a reserva de franquia do mês.
create or replace function public.lotti_agent_defer(p_id uuid, p_token uuid, p_until timestamptz, p_skip boolean, p_reason text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare
  cv public.lotti_agent_conversations; v jsonb; v_keys text[]; v_removed int;
  pstart date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;
  update public.lotti_agent_conversations set lease_token = null, lease_until = null, attempts = greatest(attempts - 1, 0),
    next_attempt_at = case when p_skip then next_attempt_at else coalesce(p_until, now()) end,
    processed_revision = case when p_skip then revision else processed_revision end,
    last_error = left(p_reason, 100)
  where id = p_id;
  if p_skip and not exists(select 1 from public.lotti_agent_messages where conversation_id = p_id and sender = 'ai') then
    v := to_jsonb(cv);
    v_keys := array_remove(array[v->>'phone', case when v->>'lid' is not null then 'lid:' || (v->>'lid') end], null);
    delete from public.lotti_agent_usage where corretor_id = cv.corretor_id and period_start = pstart and phone = any(v_keys);
    get diagnostics v_removed = row_count;
    if v_removed > 0 then
      update public.usage_counters set used_quantity = greatest(used_quantity - v_removed, 0), updated_at = now()
      where corretor_id = cv.corretor_id and feature_key = 'leads_qualificados_monthly' and period_start = pstart;
    end if;
  end if;
  return true;
end $$;

-- Transferência para a equipe: pausa a IA, move a etapa do funil configurada e
-- registra a qualificação. Silenciosa: nada é enviado e a equipe recebe o alerta.
-- Com mensagem: chamada depois da entrega (o alerta já saiu no prepare).
create or replace function public.lotti_agent_handoff(p_id uuid, p_token uuid, p_revision bigint, p_result jsonb, p_stage uuid, p_silent boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; v_sandbox boolean; v_opportunity uuid;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null then return false; end if;
  if p_silent then
    if cv.lease_token is distinct from p_token or cv.revision <> p_revision then return false; end if;
    update public.lotti_agent_conversations set qualification = coalesce(p_result, qualification), processed_revision = p_revision,
      lease_token = null, lease_until = null, attempts = 0, mode = 'human' where id = p_id;
    select sandbox into v_sandbox from public.lotti_agent_channels where id = cv.channel_id;
    if not coalesce(v_sandbox, true) then
      insert into public.alertas(corretor_id, cliente_id, tipo, mensagem, metadata, origem, entidade_tipo, entidade_id)
      values (cv.corretor_id, cv.cliente_id, 'GERAL', 'Contato solicitou atendimento do corretor',
        jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta','qualification',p_result), 'ia',
        case when cv.cliente_id is not null then 'cliente' end, cv.cliente_id);
    end if;
  else
    if cv.processed_revision < p_revision then return false; end if;
    update public.lotti_agent_conversations set mode = 'human' where id = p_id and mode = 'ai';
  end if;
  if p_stage is not null and cv.cliente_id is not null
     and exists(select 1 from public.crm_etapas where id = p_stage and corretor_id = cv.corretor_id) then
    select id into v_opportunity from public.crm_oportunidades
    where cliente_id = cv.cliente_id and corretor_id = cv.corretor_id and fechada_em is null
    order by updated_at desc limit 1;
    if v_opportunity is null then
      insert into public.crm_oportunidades(corretor_id, cliente_id, etapa_id, titulo, origem)
      select cv.corretor_id, cv.cliente_id, p_stage, coalesce(nullif(k.nome, ''), 'Contato WhatsApp'), 'whatsapp_ia'
      from public.clientes k where k.id = cv.cliente_id;
    else
      update public.crm_oportunidades set etapa_id = p_stage, updated_at = now() where id = v_opportunity and etapa_id is distinct from p_stage;
    end if;
  end if;
  return true;
end $$;

revoke all on function public.lotti_agent_defer(uuid,uuid,timestamptz,boolean,text), public.lotti_agent_handoff(uuid,uuid,bigint,jsonb,uuid,boolean) from public, anon, authenticated;
grant execute on function public.lotti_agent_defer(uuid,uuid,timestamptz,boolean,text), public.lotti_agent_handoff(uuid,uuid,bigint,jsonb,uuid,boolean) to service_role;

-- "Nova conversa" manual usa o número conectado mesmo com o agente desligado.
create or replace function public.lotti_inbox_start_conversation(p_phone text, p_name text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_channel uuid; v_client uuid; v_conversation uuid;
  v_phone text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v_name text:=nullif(left(trim(coalesce(p_name,'')),120),'');
begin
  if length(v_phone) in (10,11) then v_phone:='55'||v_phone; end if;
  if length(v_phone)<12 or length(v_phone)>15 then raise exception 'invalid_phone'; end if;
  select id into v_owner from public.corretores where user_id=auth.uid() order by id limit 1;
  if v_owner is null then raise exception 'forbidden'; end if;
  select id into v_channel from public.lotti_agent_channels where corretor_id=v_owner and archived_at is null and not sandbox order by created_at desc limit 1;
  if v_channel is null then raise exception 'channel_unavailable'; end if;
  select id into v_client from public.clientes where corretor_id=v_owner and regexp_replace(telefone,'[^0-9]','','g')=v_phone order by created_at limit 1;
  if v_client is null then
    insert into public.clientes(corretor_id,nome,telefone,status_funil,tipo_interesse)
    values(v_owner,coalesce(v_name,'Contato WhatsApp'),v_phone,'QUALIFICACAO','AMBOS') returning id into v_client;
  elsif v_name is not null then
    update public.clientes set nome=v_name where id=v_client and nome='Contato WhatsApp';
  end if;
  insert into public.lotti_agent_conversations(channel_id,corretor_id,cliente_id,phone,mode,status)
  values(v_channel,v_owner,v_client,v_phone,'human','open')
  on conflict(channel_id,phone) do update set cliente_id=coalesce(public.lotti_agent_conversations.cliente_id,excluded.cliente_id),status='open',updated_at=now()
  returning id into v_conversation;
  return v_conversation;
end $$;

notify pgrst, 'reload schema';
commit;
