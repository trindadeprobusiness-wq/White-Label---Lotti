-- Agente de IA, etapa 2: follow-up automático, mais o envio automático que os
-- Disparos também usam.
--
-- Toda mensagem automática passa pelo mesmo outbox do agente. Assim o eco do
-- WhatsApp é reconhecido como envio automático e não vira atendimento humano, e
-- a trava LIVE_SEND_ENABLED da ponte continua valendo. Cada envio ganha uma
-- revisão própria: uma mensagem nova do lead ou da equipe muda a revisão e
-- cancela o que estava para sair.
--
-- Nada é enviado por esta migration. O follow-up só roda com a ponte liberada
-- (AUTOMATIONS_ENABLED e LIVE_SEND_ENABLED) e com o follow-up ligado na tela.
begin;

alter table public.lotti_agent_conversations
  add column if not exists followup_step smallint not null default 0 check (followup_step between 0 and 10),
  add column if not exists followup_due_at timestamptz,
  add column if not exists followup_revision bigint;
create index if not exists lotti_agent_followup_due_idx
  on public.lotti_agent_conversations(followup_due_at) where followup_due_at is not null;

-- Move ou cria o negócio do contato numa etapa do funil da própria conta.
create or replace function public.lotti_agent_move_stage(p_conversation uuid, p_stage uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; v_opportunity uuid;
begin
  select * into cv from public.lotti_agent_conversations where id = p_conversation;
  if p_stage is null or cv.cliente_id is null
     or not exists(select 1 from public.crm_etapas where id = p_stage and corretor_id = cv.corretor_id) then
    return false;
  end if;
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
  return true;
end $$;

-- Início de um envio automático. Exige o lease da conversa (tomado pelo
-- follow-up ou pelo disparo) e a mesma revisão vista na reserva.
--   followup: só com a IA no comando e o Agente ativo;
--   broadcast: IA ou equipe no comando (nunca pausada), independente do Agente.
create or replace function public.lotti_agent_auto_begin(p_id uuid, p_token uuid, p_revision bigint, p_content text, p_kind text, p_live boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; v_revision bigint; v_outbox uuid;
  v_text text := left(btrim(coalesce(p_content, '')), 2500);
begin
  if p_kind not in ('followup', 'broadcast') then raise exception 'invalid_kind'; end if;
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token or cv.lease_until < now() then
    return jsonb_build_object('cancelled', true, 'reason', 'lease_lost');
  end if;
  select * into ch from public.lotti_agent_channels where id = cv.channel_id;
  if cv.revision <> p_revision then return jsonb_build_object('cancelled', true, 'reason', 'conversation_changed'); end if;
  if v_text = '' then return jsonb_build_object('cancelled', true, 'reason', 'empty_message'); end if;
  if cv.opted_out_at is not null then return jsonb_build_object('cancelled', true, 'reason', 'opted_out'); end if;
  if cv.archived_at is not null or cv.status <> 'open' or cv.phone is null
     or ch.sandbox or ch.archived_at is not null then
    return jsonb_build_object('cancelled', true, 'reason', 'conversation_unavailable');
  end if;
  if p_kind = 'followup' and (cv.mode <> 'ai' or not ch.enabled) then
    return jsonb_build_object('cancelled', true, 'reason', 'ai_not_in_charge');
  end if;
  if p_kind = 'broadcast' and cv.mode = 'paused' then
    return jsonb_build_object('cancelled', true, 'reason', 'conversation_paused');
  end if;
  if exists(select 1 from public.lotti_agent_outbox where conversation_id = p_id and status in ('sending', 'uncertain'))
     or exists(select 1 from public.lotti_manual_sends where conversation_id = p_id and status in ('sending', 'uncertain')) then
    return jsonb_build_object('cancelled', true, 'reason', 'delivery_pending');
  end if;
  if not p_live then return jsonb_build_object('blocked', 'live_send_disabled'); end if;
  v_revision := cv.revision + 1;
  -- A revisão nova já nasce processada: a fila do agente não a trata como
  -- mensagem do lead. O follow-up acompanha a revisão do próprio envio e o
  -- toque em andamento consome o vencimento: se a ponte cair antes de agendar
  -- o próximo, o ciclo termina em vez de repetir o toque.
  update public.lotti_agent_conversations set revision = v_revision, processed_revision = v_revision,
    followup_revision = case when p_kind = 'followup' then v_revision else followup_revision end,
    followup_due_at = case when p_kind = 'followup' then null else followup_due_at end,
    updated_at = now()
  where id = p_id;
  update public.lotti_agent_outbox set status = 'cancelled' where conversation_id = p_id and status = 'prepared';
  insert into public.lotti_agent_outbox(conversation_id, revision, content, status)
  values (p_id, v_revision, v_text, 'sending') returning id into v_outbox;
  return jsonb_build_object('outbox_id', v_outbox, 'revision', v_revision, 'instance', ch.instance, 'phone', cv.phone, 'content', v_text);
end $$;

create or replace function public.lotti_agent_auto_finish(p_id uuid, p_token uuid, p_revision bigint, p_external_id text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ob public.lotti_agent_outbox; v_message uuid;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;
  select * into ob from public.lotti_agent_outbox where conversation_id = p_id and revision = p_revision and status = 'sending' for update;
  if ob.id is null or nullif(p_external_id, '') is null then return false; end if;
  update public.lotti_agent_outbox set status = 'sent', external_id = p_external_id where id = ob.id;
  -- O eco pode ter chegado antes e sido gravado como "equipe": corrige o remetente.
  insert into public.lotti_agent_messages(conversation_id, external_id, direction, sender, content)
  values (p_id, p_external_id, 'out', 'ai', ob.content)
  on conflict (conversation_id, external_id) do update set sender = 'ai' returning id into v_message;
  if cv.cliente_id is not null then
    insert into public.historico_contatos(cliente_id, tipo, direcao, conteudo, metadata)
    values (cv.cliente_id, 'WHATSAPP', 'OUT', ob.content, jsonb_build_object('source', 'lotti_agent', 'message_id', v_message));
  end if;
  update public.lotti_agent_conversations set lease_token = null, lease_until = null, last_error = null, updated_at = now() where id = p_id;
  return true;
end $$;

-- p_uncertain: a ponte não sabe se a mensagem saiu (tempo esgotado ou erro do
-- provedor depois do envio). Como no agente, a conversa vai para a equipe.
create or replace function public.lotti_agent_auto_fail(p_id uuid, p_token uuid, p_revision bigint, p_uncertain boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;
  update public.lotti_agent_outbox set status = case when p_uncertain then 'uncertain' else 'cancelled' end
  where conversation_id = p_id and revision = p_revision and status = 'sending';
  update public.lotti_agent_conversations set lease_token = null, lease_until = null, followup_due_at = null,
    last_error = case when p_uncertain then 'delivery_uncertain' else 'automatic_send_failed' end,
    mode = case when p_uncertain and mode = 'ai' then 'human' else mode end
  where id = p_id;
  select sandbox into v_sandbox from public.lotti_agent_channels where id = cv.channel_id;
  if p_uncertain and not coalesce(v_sandbox, true) then
    insert into public.alertas(corretor_id, cliente_id, tipo, mensagem, metadata, origem)
    values (cv.corretor_id, cv.cliente_id, 'GERAL', 'Conversa precisa de revisão: não foi possível confirmar uma mensagem automática',
      jsonb_build_object('source', 'lotti_agent', 'conversation_id', cv.id, 'priority', 'alta'), 'ia');
  end if;
  return true;
end $$;

-- Arma o follow-up depois de uma resposta da IA entregue. Só vale para a
-- revisão respondida: se o lead ou a equipe escreveu depois, não arma.
create or replace function public.lotti_agent_followup_arm(p_id uuid, p_revision bigint, p_due timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_due is null or p_due <= now() or p_due > now() + interval '3 days' then return false; end if;
  update public.lotti_agent_conversations set followup_step = 0, followup_due_at = p_due, followup_revision = p_revision
  where id = p_id and revision = p_revision and processed_revision = p_revision and mode = 'ai'
    and status = 'open' and opted_out_at is null and archived_at is null;
  return found;
end $$;

create or replace function public.lotti_agent_followup_claim() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; ch public.lotti_agent_channels; v_token uuid := gen_random_uuid();
  v_in timestamptz; v_out timestamptz;
begin
  -- Ciclo desarmado por mensagem nova, equipe, pausa, fechamento ou opt-out.
  update public.lotti_agent_conversations set followup_due_at = null
  where followup_due_at is not null
    and (revision is distinct from followup_revision or mode <> 'ai' or status <> 'open'
         or opted_out_at is not null or archived_at is not null);
  select c.* into cv from public.lotti_agent_conversations c join public.lotti_agent_channels h on h.id = c.channel_id
  where c.followup_due_at <= now() and c.mode = 'ai' and c.status = 'open'
    and c.revision = c.followup_revision and c.revision = c.processed_revision
    and c.opted_out_at is null and c.archived_at is null and c.phone is not null
    and h.enabled and not h.sandbox and h.archived_at is null
    and (c.lease_until is null or c.lease_until < now())
    and not exists(select 1 from public.lotti_agent_outbox o where o.conversation_id = c.id and o.status in ('sending', 'uncertain'))
    and not exists(select 1 from public.lotti_manual_sends m where m.conversation_id = c.id and m.status in ('sending', 'uncertain'))
  order by c.followup_due_at for update of c skip locked limit 1;
  if cv.id is null then return null; end if;
  select * into ch from public.lotti_agent_channels where id = cv.channel_id;
  select max(created_at) filter (where direction = 'in'), max(created_at) filter (where direction = 'out')
  into v_in, v_out from public.lotti_agent_messages where conversation_id = cv.id;
  update public.lotti_agent_conversations set lease_token = v_token, lease_until = now() + interval '2 minutes' where id = cv.id;
  return jsonb_build_object('id', cv.id, 'token', v_token, 'revision', cv.revision, 'corretor_id', cv.corretor_id,
    'instance', ch.instance, 'step', cv.followup_step, 'due_at', cv.followup_due_at,
    'last_inbound_at', v_in, 'last_outbound_at', v_out, 'profile', cv.qualification);
end $$;

-- Sem envio agora: reagenda (horário de atendimento) ou encerra o ciclo (p_due nulo).
create or replace function public.lotti_agent_followup_release(p_id uuid, p_token uuid, p_step smallint, p_due timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;
  update public.lotti_agent_conversations set lease_token = null, lease_until = null,
    followup_step = coalesce(p_step, followup_step),
    followup_due_at = case when revision = followup_revision and p_due > now() - interval '1 minute' and p_due < now() + interval '3 days'
      then p_due end
  where id = p_id;
  return true;
end $$;

-- Depois de um toque entregue: conta o toque e agenda o próximo passo, desde
-- que nada tenha acontecido na conversa desde o envio.
create or replace function public.lotti_agent_followup_advance(p_id uuid, p_revision bigint, p_step smallint, p_due timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.lotti_agent_conversations set followup_step = p_step,
    followup_due_at = case when p_due > now() and p_due < now() + interval '3 days' then p_due end
  where id = p_id and revision = p_revision and followup_revision = p_revision and mode = 'ai';
  return found;
end $$;

-- Fim do ciclo sem resposta: fecha a conversa (se configurado) e move a etapa.
-- A IA continua no comando: se o lead voltar a escrever, a conversa reabre e a
-- IA responde. p_token é nulo quando a despedida acabou de sair (lease liberado).
create or replace function public.lotti_agent_followup_close(p_id uuid, p_token uuid, p_revision bigint, p_close boolean, p_stage uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or (p_token is not null and cv.lease_token is distinct from p_token) then return false; end if;
  if cv.revision <> p_revision or cv.followup_revision is distinct from p_revision or cv.mode <> 'ai' or cv.status <> 'open' then
    update public.lotti_agent_conversations set followup_due_at = null,
      lease_token = case when p_token is not null then null else lease_token end,
      lease_until = case when p_token is not null then null else lease_until end
    where id = p_id;
    return false;
  end if;
  update public.lotti_agent_conversations set followup_due_at = null, lease_token = null, lease_until = null,
    status = case when p_close then 'closed' else status end, updated_at = now()
  where id = p_id;
  perform public.lotti_agent_move_stage(p_id, p_stage);
  return true;
end $$;

revoke all on function
  public.lotti_agent_move_stage(uuid, uuid),
  public.lotti_agent_auto_begin(uuid, uuid, bigint, text, text, boolean),
  public.lotti_agent_auto_finish(uuid, uuid, bigint, text),
  public.lotti_agent_auto_fail(uuid, uuid, bigint, boolean),
  public.lotti_agent_followup_arm(uuid, bigint, timestamptz),
  public.lotti_agent_followup_claim(),
  public.lotti_agent_followup_release(uuid, uuid, smallint, timestamptz),
  public.lotti_agent_followup_advance(uuid, bigint, smallint, timestamptz),
  public.lotti_agent_followup_close(uuid, uuid, bigint, boolean, uuid)
from public, anon, authenticated;
grant execute on function
  public.lotti_agent_move_stage(uuid, uuid),
  public.lotti_agent_auto_begin(uuid, uuid, bigint, text, text, boolean),
  public.lotti_agent_auto_finish(uuid, uuid, bigint, text),
  public.lotti_agent_auto_fail(uuid, uuid, bigint, boolean),
  public.lotti_agent_followup_arm(uuid, bigint, timestamptz),
  public.lotti_agent_followup_claim(),
  public.lotti_agent_followup_release(uuid, uuid, smallint, timestamptz),
  public.lotti_agent_followup_advance(uuid, bigint, smallint, timestamptz),
  public.lotti_agent_followup_close(uuid, uuid, bigint, boolean, uuid)
to service_role;

notify pgrst, 'reload schema';
commit;
