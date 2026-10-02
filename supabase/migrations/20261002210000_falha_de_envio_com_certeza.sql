begin;

-- Registro de envio que não vai mais ser usado é APAGADO, nunca cancelado.
--
-- Duas coisas aqui, pela mesma razão.
--
-- A razão: `lotti_agent_prepare` grava a resposta assim —
--
--   insert into lotti_agent_outbox(conversation_id,revision,content) values(...)
--   on conflict(conversation_id,revision) do update set content=excluded.content
--   where lotti_agent_outbox.status='prepared' returning id into out_id;
--
-- Registro em 'cancelled' não casa com esse `where`. O `returning` volta vazio,
-- o runtime lê `if(!prepared.outbox_id) return {cancelled:true}` e desiste SEM
-- chamar `fail`. O lease expira sozinho em 2 minutos, `claim` pega a conversa
-- de novo, gasta outra chamada de IA, e tudo se repete — para sempre, sem a
-- mensagem nunca ser respondida e sem ninguém ser avisado.
--
-- ============ 1. `lotti_agent_reconciliar_envio` ============
--
-- O botão "Não chegou" do Inbox marcava 'cancelled' e caía exatamente nesse
-- buraco. Foi encontrado com o botão já em produção: uma conversa real ficou
-- com um registro 'cancelled' na mesma revisão que faltava responder, à espera
-- de alguém religar a IA para entrar no laço. Passa a apagar.
--
-- ============ 2. `lotti_agent_fail` ============
--
-- A ponte chama essa função por seis motivos diferentes e só um é dúvida de
-- verdade. `p_uncertain` deixa quem chamou declarar o que sabe:
--
--   recusa da Evolution (4xx)      -> não saiu. É o único caso de `false`.
--   erro 5xx                       -> PODE ter saído. Continua dúvida.
--   resposta 200 sem id de entrega -> PODE ter saído. Continua dúvida.
--   tempo esgotado (55s)           -> dúvida.
--   envio feito e `finish` falhou  -> saiu. Dúvida, com a mensagem já entregue.
--
-- A tentação é tratar 5xx e resposta-sem-id como falha certa, porque "deu
-- erro". Não é: a Evolution pode ter entregue e falhado só na resposta HTTP —
-- o eco do WhatsApp chega pelo `ingest` antes de a chamada voltar, e o próprio
-- `ingest` tem um ramo para isso (`pending_echo`). Apagar o registro nesse caso
-- faria a IA responder de novo e o lead receber a mesma mensagem duas vezes.
-- Mensagem duplicada no WhatsApp de uma pessoa é pior do que conversa parada.
--
-- O padrão é `true`, o comportamento de hoje: ponte antiga segue funcionando.

create or replace function public.lotti_agent_reconciliar_envio(p_id uuid, p_chegou boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cv public.lotti_agent_conversations; ob public.lotti_agent_outbox;
  v_mid uuid; v_total int := 0; v_revisao bigint := 0;
begin
  select * into cv from public.lotti_agent_conversations where id = p_id for update;
  if cv.id is null then raise exception 'not_found'; end if;
  if not exists (select 1 from public.corretores where id = cv.corretor_id and user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;

  for ob in
    select * from public.lotti_agent_outbox
     where conversation_id = p_id and status = 'uncertain'
     order by revision for update
  loop
    v_total := v_total + 1;
    v_revisao := greatest(v_revisao, ob.revision);

    if p_chegou then
      update public.lotti_agent_outbox set status = 'sent' where id = ob.id;

      -- Se o eco do provedor já entrou, veio rotulado como humano: o
      -- `external_id` do nosso registro estava vazio quando a mensagem voltou,
      -- e `ingest` só reconhece o próprio envio por esse campo. Corrigir o
      -- rótulo é melhor do que gravar a mesma frase duas vezes na conversa.
      update public.lotti_agent_messages set sender = 'ai'
       where conversation_id = p_id and direction = 'out' and sender = 'human'
         and content = ob.content and created_at >= ob.created_at;

      if not found then
        insert into public.lotti_agent_messages(conversation_id, external_id, direction, sender, content)
        values (p_id, 'reconciliado:' || ob.id, 'out', 'ai', ob.content)
        on conflict (conversation_id, external_id) do nothing
        returning id into v_mid;

        if v_mid is not null and cv.cliente_id is not null then
          insert into public.historico_contatos(cliente_id, tipo, direcao, conteudo, metadata)
          values (cv.cliente_id, 'WHATSAPP', 'OUT', ob.content,
                  jsonb_build_object('source', 'lotti_agent', 'message_id', v_mid, 'reconciliado', true));
        end if;
      end if;
    else
      -- APAGA. Ver o cabeçalho: marcar 'cancelled' aqui travava a conversa num
      -- laço silencioso, que é pior do que o problema que o botão resolve.
      delete from public.lotti_agent_outbox where id = ob.id;
    end if;
  end loop;

  if v_total = 0 then return jsonb_build_object('reconciliados', 0); end if;

  update public.lotti_agent_conversations set
    last_error = null, lease_token = null, lease_until = null,
    attempts = 0, next_attempt_at = now(),
    -- `greatest` e não `cv.revision`: mensagem que o lead mandou depois do
    -- envio travado continua sem resposta, e não pode ser engolida aqui.
    processed_revision = case when p_chegou then greatest(processed_revision, v_revisao) else processed_revision end
  where id = p_id;

  return jsonb_build_object('reconciliados', v_total, 'chegou', p_chegou);
end $$;

revoke all on function public.lotti_agent_reconciliar_envio(uuid, boolean) from public, anon;
grant execute on function public.lotti_agent_reconciliar_envio(uuid, boolean) to authenticated;

-- Assinatura nova e antiga não podem coexistir: chamada de três argumentos
-- ficaria ambígua entre as duas.
drop function if exists public.lotti_agent_fail(uuid, uuid, text);

create or replace function public.lotti_agent_fail(
  p_id uuid, p_token uuid, p_error text, p_uncertain boolean default true
) returns boolean language plpgsql set search_path='' as $$
declare cv public.lotti_agent_conversations; uncertain_send boolean;
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

  update public.lotti_agent_conversations set
    last_error=left(p_error,100), lease_until=null, lease_token=null,
    next_attempt_at=now()+interval '30 seconds',
    mode=case when uncertain_send or attempts>=3 then 'human' else mode end
  where id=p_id;

  if (uncertain_send or cv.attempts>=3)
     and not (select sandbox from public.lotti_agent_channels where id=cv.channel_id) then
    insert into public.alertas(corretor_id,cliente_id,tipo,mensagem,metadata,origem)
    values(cv.corretor_id,cv.cliente_id,'GERAL','Conversa precisa de revisão humana após falha no atendimento',
           jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','alta'),'ia');
  end if;

  return true;
end $$;

revoke all on function public.lotti_agent_fail(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.lotti_agent_fail(uuid,uuid,text,boolean) to service_role;

-- Registros que já ficaram presos em 'cancelled' pelo botão antigo. Nenhum é
-- utilizável: ou a revisão já foi respondida, ou está esperando resposta e o
-- registro é justamente o que impede.
delete from public.lotti_agent_outbox where status='cancelled';

notify pgrst,'reload schema';
commit;
