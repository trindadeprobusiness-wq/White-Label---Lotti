begin;

-- O corretor destrava sozinho um envio não confirmado.
--
-- Quando a ponte manda a mensagem e não recebe confirmação, `lotti_agent_claim`
-- marca o registro como `uncertain` e devolve a conversa para o humano. É a
-- decisão certa: ninguém sabe se o lead recebeu, e repetir pode mandar a mesma
-- frase duas vezes.
--
-- O que faltava era a saída. Nada limpa `uncertain` sozinho; enquanto ele
-- existe, `claim` não entrega a conversa e `set_mode('ai')` levanta
-- `reconcile uncertain delivery first`. Na prática a conversa ficava morta até
-- alguém mexer no banco — foi o que aconteceu em produção hoje às 14:53.
--
-- Agora quem olha o WhatsApp responde a única pergunta que o sistema não
-- consegue responder: chegou ou não chegou.

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
      -- Não chegou: o texto é descartado e a revisão continua pendente, para a
      -- IA escrever de novo em vez de repetir uma resposta que ninguém leu.
      update public.lotti_agent_outbox set status = 'cancelled' where id = ob.id;
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

notify pgrst,'reload schema';
commit;
