-- Disparos: campanhas de WhatsApp pelo número conectado, sem a API oficial da
-- Meta. Regra escolhida pelo dono: mensagem livre só para quem mandou mensagem
-- nas últimas 24 horas (a mesma janela da Meta), revalidada no envio.
--
-- O público e o texto final são calculados no servidor. Cada entrega passa pelo
-- mesmo envio automático do agente (lotti_agent_auto_begin), então o eco não
-- vira atendimento humano e a trava LIVE_SEND_ENABLED da ponte continua valendo.
-- Proteções: espaçamento por campanha e por número, até 300 entregas por conta
-- em 24 h, opt-out, conversa pausada/fechada/arquivada e mensagem nova do lead
-- ou da equipe depois do agendamento cancelam a entrega.
begin;

create table public.lotti_broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft','scheduled','running','paused','completed','cancelled')),
  body text not null default '' check (char_length(body) <= 1000),
  stage_ids uuid[] not null default '{}',
  starts_at timestamptz,
  interval_seconds int not null default 60 check (interval_seconds between 30 and 3600),
  max_recipients int not null default 100 check (max_recipients between 1 and 300),
  reply_policy text not null default 'preserve' check (reply_policy in ('ai','human','preserve')),
  total int not null default 0,
  excluded jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table public.lotti_broadcast_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.lotti_broadcast_campaigns(id) on delete cascade,
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  conversation_id uuid not null references public.lotti_agent_conversations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','skipped','failed','uncertain','cancelled')),
  scheduled_at timestamptz not null,
  content text not null,
  lease_token uuid,
  attempts int not null default 0,
  reason text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, conversation_id)
);

create table public.lotti_broadcast_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.lotti_broadcast_campaigns(id) on delete cascade,
  kind text not null check (kind in ('created','updated','scheduled','started','paused','resumed','cancelled','completed','duplicated')),
  detail jsonb not null default '{}'::jsonb,
  actor_label text not null,
  created_at timestamptz not null default now()
);

-- A ponte marca presença a cada rodada de envio automático. A tela usa isso
-- para avisar quando o envio automático não está liberado (nada sai da fila).
create table public.lotti_automation_heartbeat (
  id smallint primary key default 1 check (id = 1),
  seen_at timestamptz not null default now()
);
alter table public.lotti_automation_heartbeat enable row level security;
revoke all on public.lotti_automation_heartbeat from anon, authenticated;
grant select on public.lotti_automation_heartbeat to authenticated;
grant all on public.lotti_automation_heartbeat to service_role;
create policy lotti_automation_heartbeat_read on public.lotti_automation_heartbeat for select to authenticated using (true);

create index lotti_broadcast_campaign_owner_idx on public.lotti_broadcast_campaigns(corretor_id, updated_at desc);
create index lotti_broadcast_campaign_due_idx on public.lotti_broadcast_campaigns(starts_at) where status = 'scheduled';
create index lotti_broadcast_delivery_due_idx on public.lotti_broadcast_deliveries(scheduled_at) where status = 'pending';
create index lotti_broadcast_delivery_campaign_idx on public.lotti_broadcast_deliveries(campaign_id, status);
create index lotti_broadcast_delivery_account_idx on public.lotti_broadcast_deliveries(corretor_id, created_at);
create index lotti_broadcast_event_campaign_idx on public.lotti_broadcast_events(campaign_id, created_at);

alter table public.lotti_broadcast_campaigns enable row level security;
alter table public.lotti_broadcast_deliveries enable row level security;
alter table public.lotti_broadcast_events enable row level security;
revoke all on public.lotti_broadcast_campaigns, public.lotti_broadcast_deliveries, public.lotti_broadcast_events from anon, authenticated;
grant select on public.lotti_broadcast_campaigns, public.lotti_broadcast_deliveries, public.lotti_broadcast_events to authenticated;
grant all on public.lotti_broadcast_campaigns, public.lotti_broadcast_deliveries, public.lotti_broadcast_events to service_role;
create policy lotti_broadcast_campaign_owner_read on public.lotti_broadcast_campaigns for select to authenticated
  using (corretor_id in (select id from public.corretores where user_id = (select auth.uid())));
create policy lotti_broadcast_delivery_owner_read on public.lotti_broadcast_deliveries for select to authenticated
  using (corretor_id in (select id from public.corretores where user_id = (select auth.uid())));
create policy lotti_broadcast_event_owner_read on public.lotti_broadcast_events for select to authenticated
  using (campaign_id in (select id from public.lotti_broadcast_campaigns));

-- Variáveis permitidas: {{nome}} (primeiro nome do contato) e {{corretor}}.
-- Sem nome do contato, quem usa {{nome}} fica de fora da campanha.
create or replace function public.lotti_broadcast_render(p_body text, p_name text, p_broker text) returns text
language plpgsql immutable set search_path = '' as $$
declare v_first text := nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), '');
begin
  if p_body ~ '\{\{\s*nome\s*\}\}' and v_first is null then return null; end if;
  return regexp_replace(regexp_replace(p_body, '\{\{\s*nome\s*\}\}', coalesce(v_first, ''), 'g'),
    '\{\{\s*corretor\s*\}\}', coalesce(nullif(btrim(p_broker), ''), 'a equipe'), 'g');
end $$;

-- Público da conta: conversas do número conectado, com o motivo de exclusão
-- (nulo = pode receber agora). O filtro de etapa usa o negócio aberto no funil.
create or replace function public.lotti_broadcast_audience(p_owner uuid, p_stage_ids uuid[], p_body text)
returns table (conversation_id uuid, contact text, last_inbound_at timestamptz, content text, reason text)
language sql stable security invoker set search_path = '' as $$
  with base as (
    select c.id, c.cliente_id, c.opted_out_at, c.mode, c.status,
      coalesce(nullif(nullif(btrim(k.nome), ''), 'Contato WhatsApp'), c.contact_name) as contact,
      (select max(m.created_at) from public.lotti_agent_messages m where m.conversation_id = c.id and m.direction = 'in') as last_in
    from public.lotti_agent_conversations c
    join public.lotti_agent_channels h on h.id = c.channel_id
    left join public.clientes k on k.id = c.cliente_id
    where c.corretor_id = p_owner and h.corretor_id = p_owner and not h.sandbox and h.archived_at is null
      and c.archived_at is null and c.phone is not null
      and (coalesce(cardinality(p_stage_ids), 0) = 0 or exists (
        select 1 from public.crm_oportunidades o
        where o.cliente_id = c.cliente_id and o.corretor_id = p_owner and o.fechada_em is null and o.etapa_id = any(p_stage_ids)))
  )
  select b.id, b.contact, b.last_in,
    public.lotti_broadcast_render(p_body, b.contact, (select r.nome from public.corretores r where r.id = p_owner)),
    case
      when b.opted_out_at is not null then 'opted_out'
      when b.mode = 'paused' or b.status <> 'open' then 'paused_or_closed'
      when b.last_in is null or b.last_in < now() - interval '24 hours' then 'outside_window'
      when public.lotti_broadcast_render(p_body, b.contact, 'x') is null then 'missing_name'
    end
  from base b
$$;

create or replace function public.lotti_broadcast_owner() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.corretores where user_id = (select auth.uid()) order by id limit 1
$$;

create or replace function public.lotti_broadcast_validate(p_owner uuid, p jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare v_body text := coalesce(p->>'body', ''); v_start timestamptz; v_stage text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'invalid_campaign'; end if;
  if char_length(btrim(coalesce(p->>'name', ''))) not between 1 and 120 then raise exception 'invalid_name'; end if;
  if char_length(btrim(v_body)) not between 1 and 1000 then raise exception 'invalid_body'; end if;
  if exists (select 1 from regexp_matches(v_body, '\{\{\s*([^{}]*?)\s*\}\}', 'g') as m where m[1] not in ('nome', 'corretor')) then
    raise exception 'invalid_variable';
  end if;
  if coalesce(p->>'replyPolicy', 'preserve') not in ('ai', 'human', 'preserve') then raise exception 'invalid_reply_policy'; end if;
  if jsonb_typeof(p->'intervalSeconds') is distinct from 'number' or (p->>'intervalSeconds')::numeric not between 30 and 3600
     or jsonb_typeof(p->'maxRecipients') is distinct from 'number' or (p->>'maxRecipients')::numeric not between 1 and 300 then
    raise exception 'invalid_limits';
  end if;
  if nullif(p->>'startsAt', '') is not null then
    begin v_start := (p->>'startsAt')::timestamptz; exception when others then raise exception 'invalid_schedule'; end;
    if v_start > now() + interval '30 days' then raise exception 'invalid_schedule'; end if;
  end if;
  if jsonb_typeof(coalesce(p->'stageIds', '[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p->'stageIds', '[]'::jsonb)) > 20 then
    raise exception 'invalid_stage';
  end if;
  for v_stage in select jsonb_array_elements_text(coalesce(p->'stageIds', '[]'::jsonb)) loop
    if v_stage !~* '^[0-9a-f-]{36}$' or not exists (select 1 from public.crm_etapas where id = v_stage::uuid and corretor_id = p_owner) then
      raise exception 'invalid_stage';
    end if;
  end loop;
end $$;

create or replace function public.lotti_broadcast_stage_ids(p jsonb) returns uuid[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(value::uuid), '{}') from jsonb_array_elements_text(coalesce(p->'stageIds', '[]'::jsonb))
$$;

create or replace function public.lotti_broadcast_log(p_campaign uuid, p_kind text, p_detail jsonb default '{}'::jsonb) returns void
language sql security invoker set search_path = '' as $$
  insert into public.lotti_broadcast_events(campaign_id, kind, detail, actor_label)
  values (p_campaign, p_kind, coalesce(p_detail, '{}'::jsonb), public.lotti_inbox_event_actor())
$$;

-- Rascunho: cria ou altera. Só rascunho é editável.
create or replace function public.lotti_broadcast_save(p_campaign jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public.lotti_broadcast_owner(); v_id uuid;
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  perform public.lotti_broadcast_validate(v_owner, p_campaign);
  v_id := case when coalesce(p_campaign->>'id', '') ~* '^[0-9a-f-]{36}$' then (p_campaign->>'id')::uuid end;
  if v_id is not null then
    update public.lotti_broadcast_campaigns set
      name = btrim(p_campaign->>'name'), body = btrim(p_campaign->>'body'), stage_ids = public.lotti_broadcast_stage_ids(p_campaign),
      starts_at = nullif(p_campaign->>'startsAt', '')::timestamptz, interval_seconds = (p_campaign->>'intervalSeconds')::int,
      max_recipients = (p_campaign->>'maxRecipients')::int, reply_policy = coalesce(p_campaign->>'replyPolicy', 'preserve'), updated_at = now()
    where id = v_id and corretor_id = v_owner and status = 'draft';
    if not found then raise exception 'not_editable'; end if;
    perform public.lotti_broadcast_log(v_id, 'updated');
    return v_id;
  end if;
  insert into public.lotti_broadcast_campaigns(corretor_id, name, body, stage_ids, starts_at, interval_seconds, max_recipients, reply_policy)
  values (v_owner, btrim(p_campaign->>'name'), btrim(p_campaign->>'body'), public.lotti_broadcast_stage_ids(p_campaign),
    nullif(p_campaign->>'startsAt', '')::timestamptz, (p_campaign->>'intervalSeconds')::int, (p_campaign->>'maxRecipients')::int,
    coalesce(p_campaign->>'replyPolicy', 'preserve'))
  returning id into v_id;
  perform public.lotti_broadcast_log(v_id, 'created');
  return v_id;
end $$;

-- Prévia sem salvar: quantos recebem agora, por que os outros ficam de fora e
-- como a mensagem fica para alguns contatos. Não mostra telefone.
create or replace function public.lotti_broadcast_preview(p_campaign jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public.lotti_broadcast_owner(); v_max int; v_result jsonb;
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  perform public.lotti_broadcast_validate(v_owner, p_campaign);
  v_max := (p_campaign->>'maxRecipients')::int;
  with a as (select * from public.lotti_broadcast_audience(v_owner, public.lotti_broadcast_stage_ids(p_campaign), btrim(p_campaign->>'body'))),
  eligible as (select count(*)::int n from a where reason is null)
  select jsonb_build_object(
    'eligible', least((select n from eligible), v_max),
    'overLimit', greatest((select n from eligible) - v_max, 0),
    'excluded', coalesce((select jsonb_object_agg(reason, n) from (select reason, count(*)::int n from a where reason is not null group by reason) x), '{}'::jsonb),
    'samples', coalesce((select jsonb_agg(jsonb_build_object('contact', contact, 'text', content)) from (
      select contact, content from a where reason is null order by last_inbound_at desc limit 3) s), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;

-- Cria as entregas no início da campanha (retrato do público naquele momento).
-- Mais antigos primeiro: a janela deles fecha antes.
create or replace function public.lotti_broadcast_start(p_campaign uuid) returns int
language plpgsql security invoker set search_path = '' as $$
declare b public.lotti_broadcast_campaigns; v_room int; v_total int; v_eligible int; v_excluded jsonb;
begin
  select * into b from public.lotti_broadcast_campaigns where id = p_campaign for update;
  if b.id is null or b.status not in ('draft', 'scheduled') then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended(b.corretor_id::text, 915));
  select greatest(300 - count(*), 0)::int into v_room from public.lotti_broadcast_deliveries
  where corretor_id = b.corretor_id and created_at > now() - interval '24 hours' and status in ('pending', 'sending', 'sent', 'uncertain');
  with a as materialized (
    select * from public.lotti_broadcast_audience(b.corretor_id, b.stage_ids, b.body)
  ), created as (
    insert into public.lotti_broadcast_deliveries(campaign_id, corretor_id, conversation_id, scheduled_at, content)
    select b.id, b.corretor_id, e.conversation_id, now() + (e.n - 1) * b.interval_seconds * interval '1 second', e.content
    from (select a.*, row_number() over (order by a.last_inbound_at, a.conversation_id) n from a where a.reason is null) e
    where e.n <= least(b.max_recipients, v_room)
    returning 1
  )
  select (select count(*)::int from created), (select count(*)::int from a where reason is null),
    coalesce((select jsonb_object_agg(reason, n) from (select reason, count(*)::int n from a where reason is not null group by reason) x), '{}'::jsonb)
  into v_total, v_eligible, v_excluded;
  v_excluded := v_excluded || jsonb_build_object('over_limit', greatest(v_eligible - v_total, 0));
  update public.lotti_broadcast_campaigns set status = case when v_total > 0 then 'running' else 'completed' end,
    total = v_total, excluded = v_excluded, started_at = now(), finished_at = case when v_total > 0 then null else now() end, updated_at = now()
  where id = b.id;
  perform public.lotti_broadcast_log(b.id, 'started', jsonb_build_object('total', v_total, 'excluded', v_excluded));
  if v_total = 0 then perform public.lotti_broadcast_log(b.id, 'completed', jsonb_build_object('reason', 'no_eligible_contacts')); end if;
  return v_total;
end $$;

-- Ativar: começa agora ou agenda. Agora sem ninguém elegível não ativa.
create or replace function public.lotti_broadcast_activate(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public.lotti_broadcast_owner(); b public.lotti_broadcast_campaigns; v_total int;
begin
  select * into b from public.lotti_broadcast_campaigns where id = p_id and corretor_id = v_owner for update;
  if b.id is null then raise exception 'forbidden'; end if;
  if b.status <> 'draft' then raise exception 'not_editable'; end if;
  if b.starts_at is not null and b.starts_at > now() then
    update public.lotti_broadcast_campaigns set status = 'scheduled', updated_at = now() where id = p_id;
    perform public.lotti_broadcast_log(p_id, 'scheduled', jsonb_build_object('starts_at', b.starts_at));
    return jsonb_build_object('status', 'scheduled', 'startsAt', b.starts_at);
  end if;
  if not exists (select 1 from public.lotti_broadcast_audience(v_owner, b.stage_ids, b.body) a where a.reason is null) then
    raise exception 'no_eligible_contacts';
  end if;
  v_total := public.lotti_broadcast_start(p_id);
  return jsonb_build_object('status', case when v_total > 0 then 'running' else 'completed' end, 'total', v_total);
end $$;

-- Pausar, retomar e cancelar. Retomar reespaça o que falta a partir de agora.
create or replace function public.lotti_broadcast_control(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public.lotti_broadcast_owner(); b public.lotti_broadcast_campaigns; v_status text;
begin
  select * into b from public.lotti_broadcast_campaigns where id = p_id and corretor_id = v_owner for update;
  if b.id is null then raise exception 'forbidden'; end if;
  if p_action = 'pause' and b.status in ('scheduled', 'running') then
    v_status := 'paused';
  elsif p_action = 'resume' and b.status = 'paused' then
    v_status := case when b.started_at is null then 'scheduled' else 'running' end;
    update public.lotti_broadcast_deliveries d set scheduled_at = now() + (x.n - 1) * b.interval_seconds * interval '1 second', updated_at = now()
    from (select id, row_number() over (order by scheduled_at, id) n from public.lotti_broadcast_deliveries where campaign_id = p_id and status = 'pending') x
    where d.id = x.id;
  elsif p_action = 'cancel' and b.status in ('draft', 'scheduled', 'running', 'paused') then
    v_status := 'cancelled';
    update public.lotti_broadcast_deliveries set status = 'cancelled', reason = 'campaign_cancelled', updated_at = now()
    where campaign_id = p_id and status = 'pending';
  else
    raise exception 'invalid_action';
  end if;
  update public.lotti_broadcast_campaigns set status = v_status, updated_at = now(),
    finished_at = case when v_status = 'cancelled' then now() else finished_at end
  where id = p_id;
  perform public.lotti_broadcast_log(p_id, case p_action when 'pause' then 'paused' when 'resume' then 'resumed' else 'cancelled' end);
  return v_status;
end $$;

create or replace function public.lotti_broadcast_duplicate(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := public.lotti_broadcast_owner(); v_id uuid;
begin
  insert into public.lotti_broadcast_campaigns(corretor_id, name, body, stage_ids, interval_seconds, max_recipients, reply_policy)
  select corretor_id, left('Cópia de ' || name, 120), body, stage_ids, interval_seconds, max_recipients, reply_policy
  from public.lotti_broadcast_campaigns where id = p_id and corretor_id = v_owner
  returning id into v_id;
  if v_id is null then raise exception 'forbidden'; end if;
  perform public.lotti_broadcast_log(v_id, 'duplicated', jsonb_build_object('from', p_id));
  return v_id;
end $$;

create or replace function public.lotti_broadcast_delete_draft(p_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.lotti_broadcast_campaigns where id = p_id and corretor_id = public.lotti_broadcast_owner() and status = 'draft';
  if not found then raise exception 'not_editable'; end if;
  return true;
end $$;

create or replace function public.lotti_broadcast_finish_campaign(p_campaign uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.lotti_broadcast_deliveries where campaign_id = p_campaign and status in ('pending', 'sending')) then
    update public.lotti_broadcast_campaigns set status = 'completed', finished_at = now(), updated_at = now()
    where id = p_campaign and status = 'running';
    if found then perform public.lotti_broadcast_log(p_campaign, 'completed'); end if;
  end if;
end $$;

-- Ponte: começa as campanhas agendadas que venceram, destrava entregas
-- abandonadas e reserva a próxima entrega (com o lease da conversa).
create or replace function public.lotti_broadcast_claim() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_campaign uuid; d public.lotti_broadcast_deliveries; cv public.lotti_agent_conversations; ch public.lotti_agent_channels;
  b public.lotti_broadcast_campaigns; v_token uuid := gen_random_uuid(); v_in timestamptz; v_reason text; v_outbox text; v_skipped int := 0;
begin
  insert into public.lotti_automation_heartbeat(id, seen_at) values (1, now())
  on conflict (id) do update set seen_at = excluded.seen_at;
  for v_campaign in select id from public.lotti_broadcast_campaigns where status = 'scheduled' and starts_at <= now() order by starts_at limit 5 loop
    perform public.lotti_broadcast_start(v_campaign);
  end loop;

  -- A ponte caiu no meio: o que já saiu fica enviado, o que ficou em dúvida
  -- fica incerto e o que nem começou volta para a fila (até 3 tentativas).
  for d in select * from public.lotti_broadcast_deliveries x where x.status = 'sending' and x.updated_at < now() - interval '3 minutes' for update skip locked loop
    select o.status into v_outbox from public.lotti_agent_outbox o
    where o.conversation_id = d.conversation_id and o.created_at >= d.updated_at order by o.created_at limit 1;
    update public.lotti_broadcast_deliveries set updated_at = now(), lease_token = null,
      status = case when v_outbox = 'sent' then 'sent' when v_outbox is not null then 'uncertain' when d.attempts >= 3 then 'failed' else 'pending' end,
      reason = case when v_outbox is null and d.attempts >= 3 then 'bridge_interrupted' else reason end
    where id = d.id;
    perform public.lotti_broadcast_finish_campaign(d.campaign_id);
  end loop;

  loop
    select x.* into d from public.lotti_broadcast_deliveries x
    join public.lotti_broadcast_campaigns c on c.id = x.campaign_id and c.status = 'running'
    join public.lotti_agent_conversations v on v.id = x.conversation_id
    where x.status = 'pending' and x.scheduled_at <= now()
      and (v.lease_until is null or v.lease_until < now())
      -- Espaçamento mínimo por número conectado, somando todas as campanhas.
      and not exists (select 1 from public.lotti_broadcast_deliveries y join public.lotti_agent_conversations z on z.id = y.conversation_id
        where z.channel_id = v.channel_id and y.status in ('sending', 'sent') and y.updated_at > now() - interval '20 seconds')
    order by x.scheduled_at for update of x skip locked limit 1;
    if d.id is null then return case when v_skipped > 0 then jsonb_build_object('skipped', v_skipped) end; end if;
    select * into b from public.lotti_broadcast_campaigns where id = d.campaign_id;
    select * into cv from public.lotti_agent_conversations where id = d.conversation_id for update;
    select * into ch from public.lotti_agent_channels where id = cv.channel_id;
    select max(created_at) into v_in from public.lotti_agent_messages where conversation_id = cv.id and direction = 'in';
    v_reason := case
      when cv.opted_out_at is not null then 'opted_out'
      when cv.archived_at is not null or ch.archived_at is not null or ch.sandbox or cv.phone is null then 'conversation_unavailable'
      when cv.mode = 'paused' or cv.status <> 'open' then 'paused_or_closed'
      when v_in is null or v_in < now() - interval '24 hours' then 'outside_window'
      when exists (select 1 from public.lotti_agent_messages m where m.conversation_id = cv.id and m.created_at > d.created_at
                   and (m.direction = 'in' or m.sender = 'human')) then 'conversation_moved'
    end;
    if v_reason is not null then
      update public.lotti_broadcast_deliveries set status = 'skipped', reason = v_reason, updated_at = now() where id = d.id;
      perform public.lotti_broadcast_finish_campaign(d.campaign_id);
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- Agente respondendo ou envio em andamento: tenta de novo em 30 s.
    if (cv.mode = 'ai' and cv.revision > cv.processed_revision)
       or exists (select 1 from public.lotti_agent_outbox o where o.conversation_id = cv.id and o.status in ('prepared', 'sending', 'uncertain'))
       or exists (select 1 from public.lotti_manual_sends m where m.conversation_id = cv.id and m.status in ('sending', 'uncertain')) then
      update public.lotti_broadcast_deliveries set scheduled_at = now() + interval '30 seconds', updated_at = now() where id = d.id;
      return case when v_skipped > 0 then jsonb_build_object('skipped', v_skipped) end;
    end if;
    update public.lotti_agent_conversations set lease_token = v_token, lease_until = now() + interval '2 minutes' where id = cv.id;
    update public.lotti_broadcast_deliveries set status = 'sending', lease_token = v_token, attempts = attempts + 1, updated_at = now() where id = d.id;
    return jsonb_build_object('delivery_id', d.id, 'id', cv.id, 'token', v_token, 'revision', cv.revision, 'content', d.content, 'reply_policy', b.reply_policy);
  end loop;
end $$;

-- Resultado da entrega. Enviada: aplica o que acontece quando o contato
-- responder (IA atende, equipe atende ou sem mudança).
create or replace function public.lotti_broadcast_complete(p_delivery uuid, p_status text, p_reason text, p_external_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare d public.lotti_broadcast_deliveries; v_policy text;
begin
  if p_status not in ('sent', 'skipped', 'failed', 'uncertain') then raise exception 'invalid_status'; end if;
  select * into d from public.lotti_broadcast_deliveries where id = p_delivery for update;
  if d.id is null or d.status <> 'sending' then return false; end if;
  update public.lotti_broadcast_deliveries set status = p_status, reason = left(p_reason, 100), external_id = p_external_id, lease_token = null, updated_at = now()
  where id = d.id;
  -- Sem envio (cancelado no início): devolve a conversa.
  update public.lotti_agent_conversations set lease_token = null, lease_until = null where id = d.conversation_id and lease_token = d.lease_token;
  if p_status = 'sent' then
    select reply_policy into v_policy from public.lotti_broadcast_campaigns where id = d.campaign_id;
    if v_policy = 'ai' then
      update public.lotti_agent_conversations c set mode = 'ai' where c.id = d.conversation_id and c.mode = 'human' and c.opted_out_at is null
        and not exists (select 1 from public.lotti_manual_sends m where m.conversation_id = c.id and m.status in ('sending', 'uncertain'))
        and not exists (select 1 from public.lotti_agent_outbox o where o.conversation_id = c.id and o.status = 'uncertain');
    elsif v_policy = 'human' then
      update public.lotti_agent_conversations set mode = 'human' where id = d.conversation_id and mode = 'ai';
    end if;
  end if;
  perform public.lotti_broadcast_finish_campaign(d.campaign_id);
  return true;
end $$;

revoke all on function
  public.lotti_broadcast_render(text, text, text),
  public.lotti_broadcast_audience(uuid, uuid[], text),
  public.lotti_broadcast_owner(),
  public.lotti_broadcast_validate(uuid, jsonb),
  public.lotti_broadcast_stage_ids(jsonb),
  public.lotti_broadcast_log(uuid, text, jsonb),
  public.lotti_broadcast_save(jsonb),
  public.lotti_broadcast_preview(jsonb),
  public.lotti_broadcast_start(uuid),
  public.lotti_broadcast_activate(uuid),
  public.lotti_broadcast_control(uuid, text),
  public.lotti_broadcast_duplicate(uuid),
  public.lotti_broadcast_delete_draft(uuid),
  public.lotti_broadcast_finish_campaign(uuid),
  public.lotti_broadcast_claim(),
  public.lotti_broadcast_complete(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function
  public.lotti_broadcast_save(jsonb),
  public.lotti_broadcast_preview(jsonb),
  public.lotti_broadcast_activate(uuid),
  public.lotti_broadcast_control(uuid, text),
  public.lotti_broadcast_duplicate(uuid),
  public.lotti_broadcast_delete_draft(uuid)
to authenticated;
grant execute on function
  public.lotti_broadcast_render(text, text, text),
  public.lotti_broadcast_audience(uuid, uuid[], text),
  public.lotti_broadcast_log(uuid, text, jsonb),
  public.lotti_broadcast_start(uuid),
  public.lotti_broadcast_finish_campaign(uuid),
  public.lotti_broadcast_claim(),
  public.lotti_broadcast_complete(uuid, text, text, text)
to service_role;

notify pgrst, 'reload schema';
commit;
