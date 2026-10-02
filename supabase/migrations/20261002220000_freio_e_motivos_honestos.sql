begin;

-- Três arestas da separação entre falha certa e dúvida, achadas por revisão
-- adversarial do runtime já publicado.
--
-- ===== 1. O freio voltava a zero sozinho =====
--
-- `lotti_agent_fail` zerava `falhas_de_envio` em toda falha incerta. Parece
-- inofensivo, mas a falha incerta ANTES do envio (o `prepare` ou o `begin_send`
-- falhando) não encontra registro em 'sending': `found` é falso, a conversa
-- continua em 'ai', e o contador volta a zero. Alternando uma dessas com uma
-- falha certa, `falhas_de_envio` nunca passa de 1 e o freio nunca fecha — a
-- mesma retentativa infinita que o contador foi criado para impedir, por outra
-- porta. Agora toda falha conta; só sucesso zera.
--
-- ===== 2. Botão oferecido sem ter o que confirmar =====
--
-- Falha incerta que não achou registro em 'sending' gravava mesmo assim um
-- motivo da família "incerto", e o Inbox mostrava "A mensagem chegou / Não
-- chegou" para um envio que nunca existiu. Os dois botões chamavam
-- `lotti_agent_reconciliar_envio`, que devolvia `{"reconciliados":0}` e não
-- mudava nada: cliques mudos. O motivo passa a dizer o que de fato houve.
--
-- ===== 3. O caminho automático ainda cancelava =====
--
-- `lotti_agent_auto_fail` marca 'cancelled' na falha certa — exatamente o que a
-- migration anterior removeu de `fail` e de `reconciliar_envio`, pelo mesmo
-- motivo: `prepare` só atualiza registro em 'prepared', então o 'cancelled'
-- devolve `returning` vazio, o runtime desiste sem chamar `fail`, o lease
-- expira e o ciclo recomeça — para sempre, sem ninguém ser avisado.
--
-- Aqui ainda não fez mal porque `AUTOMATIONS_ENABLED` está desligado. A
-- armadilha arma no dia em que ele for ligado, e é por isso que entra agora.

create or replace function public.lotti_agent_fail(
  p_id uuid, p_token uuid, p_error text, p_uncertain boolean default true
) returns boolean language plpgsql set search_path='' as $$
declare cv public.lotti_agent_conversations; uncertain_send boolean; v_falhas int; v_motivo text;
  c_familia_incerta constant text[] := array[
    'delivery_uncertain','delivery_failed_or_uncertain','delivery_upstream_error','delivery_commit_failed'];
begin
  select * into cv from public.lotti_agent_conversations where id=p_id for update;
  if cv.lease_token is distinct from p_token then return false; end if;

  if coalesce(p_uncertain, true) then
    update public.lotti_agent_outbox set status='uncertain'
     where conversation_id=p_id and status='sending';
    uncertain_send := found;
  else
    delete from public.lotti_agent_outbox
     where conversation_id=p_id and status='sending';
    uncertain_send := false;
  end if;

  -- Toda falha conta. Zerar aqui reabria o laço; quem zera é o sucesso.
  v_falhas := cv.falhas_de_envio + 1;

  -- O motivo só pode prometer os botões de confirmação quando existe mesmo um
  -- envio pendurado para confirmar, isto é, quando um registro foi marcado.
  v_motivo := left(p_error,100);
  if not uncertain_send and v_motivo = any(c_familia_incerta) then
    v_motivo := case when coalesce(p_uncertain,true) then 'falha_antes_do_envio' else 'delivery_rejected' end;
  end if;

  update public.lotti_agent_conversations set
    last_error=v_motivo, lease_until=null, lease_token=null,
    falhas_de_envio=v_falhas,
    next_attempt_at=now()+interval '30 seconds',
    mode=case when uncertain_send or attempts>=3 or v_falhas>=3 then 'human' else mode end
  where id=p_id;

  if (uncertain_send or cv.attempts>=3 or v_falhas>=3)
     and not (select sandbox from public.lotti_agent_channels where id=cv.channel_id) then
    insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
    values(cv.corretor_id,cv.cliente_id,'GERAL','Conversa precisa de revisão humana após falha no atendimento',
           jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
  end if;

  return true;
end $$;

revoke all on function public.lotti_agent_fail(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.lotti_agent_fail(uuid,uuid,text,boolean) to service_role;

-- O caminho automático apaga, como o manual. `revision` continua no escopo:
-- ali o registro é de uma revisão própria, e apagar fora dela derrubaria
-- trabalho de outro ciclo.
create or replace function public.lotti_agent_auto_fail(p_id uuid, p_token uuid, p_revision bigint, p_uncertain boolean)
returns boolean language plpgsql set search_path='' as $$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null or cv.lease_token is distinct from p_token then return false; end if;

  if p_uncertain then
    update public.lotti_agent_outbox set status = 'uncertain'
     where conversation_id = p_id and revision = p_revision and status = 'sending';
  else
    delete from public.lotti_agent_outbox
     where conversation_id = p_id and revision = p_revision and status = 'sending';
  end if;

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

revoke all on function public.lotti_agent_auto_fail(uuid,uuid,bigint,boolean) from public, anon, authenticated;
grant execute on function public.lotti_agent_auto_fail(uuid,uuid,bigint,boolean) to service_role;

delete from public.lotti_agent_outbox where status='cancelled';

notify pgrst,'reload schema';
commit;
