begin;

-- Conversa com número sempre tem cliente no CRM, em "Em qualificação".
--
-- Até aqui isso dependia do caminho: `lotti_agent_ingest` criava o cliente ao
-- receber mensagem ao vivo, mas `lotti_agent_import_history` só atualizava um
-- cliente que já existisse. Quem chegou pela importação do histórico ficava
-- "Sem cliente vinculado", e só entrava no CRM se alguém clicasse no botão.
-- Garantir por caminho significa refazer a garantia a cada caminho novo; o
-- invariante fica no gatilho, que vale para todos de uma vez.

-- Miolo do lotti_inbox_add_to_crm sem a checagem de sessão, para os caminhos
-- automáticos poderem reusar a mesma regra em vez de repeti-la.
create or replace function public.lotti_inbox_link_cliente(p_conversation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_phone text; v_name text; v_client uuid; v_result jsonb;
begin
  select c.corretor_id,c.phone,c.contact_name,c.cliente_id into v_owner,v_phone,v_name,v_client
    from public.lotti_agent_conversations c where c.id=p_conversation for update;
  if v_owner is null then raise exception 'conversation_not_found'; end if;
  if v_client is not null then return jsonb_build_object('cliente_id',v_client,'created',false); end if;
  if v_phone is null then raise exception 'phone_required'; end if;
  v_result:=public.lotti_find_or_create_cliente(v_owner,v_phone,coalesce(v_name,'Contato WhatsApp'),
    jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'));
  update public.lotti_agent_conversations
    set cliente_id=(v_result->>'cliente_id')::uuid,
        last_error=case when last_error='crm_capture_pending' then null else last_error end
    where id=p_conversation;
  return v_result;
end $$;
revoke all on function public.lotti_inbox_link_cliente(uuid) from public,anon,authenticated;

-- O botão continua existindo: o front publicado ainda o chama. Ele só passa a
-- delegar, para não haver duas definições da mesma regra.
create or replace function public.lotti_inbox_add_to_crm(p_conversation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  select c.corretor_id into v_owner from public.lotti_agent_conversations c where c.id=p_conversation;
  if v_owner is null or not exists(select 1 from public.corretores r where r.id=v_owner and r.user_id=auth.uid()) then
    raise exception 'forbidden';
  end if;
  return public.lotti_inbox_link_cliente(p_conversation);
end $$;
revoke all on function public.lotti_inbox_add_to_crm(uuid) from public,anon;
grant execute on function public.lotti_inbox_add_to_crm(uuid) to authenticated;

-- BEFORE, e não AFTER: escrevendo em new.cliente_id a linha já nasce ligada,
-- sem um segundo update na mesma tabela nem risco de recursão.
create or replace function public.lotti_conversa_no_crm() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if new.cliente_id is null and new.phone is not null
     -- Canal de teste não povoa o CRM de ninguém.
     and not exists(select 1 from public.lotti_agent_channels ch where ch.id=new.channel_id and ch.sandbox) then
    begin
      v_result:=public.lotti_find_or_create_cliente(new.corretor_id,new.phone,
        coalesce(new.contact_name,'Contato WhatsApp'),
        jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'));
      new.cliente_id:=(v_result->>'cliente_id')::uuid;
      if new.last_error='crm_capture_pending' then new.last_error:=null; end if;
    exception when others then
      -- Mensagem nunca se perde por causa do CRM: a conversa entra mesmo assim
      -- e fica marcada para uma nova tentativa.
      new.last_error:=coalesce(new.last_error,'crm_capture_pending');
    end;
  end if;
  -- A conversa é criada antes de o WhatsApp dizer o nome, então o cliente nasce
  -- como "Contato WhatsApp". Quando o nome chega, ele substitui só esse
  -- provisório — nunca um nome que alguém digitou no CRM.
  if new.cliente_id is not null and new.contact_name is not null then
    update public.clientes set nome=new.contact_name
     where id=new.cliente_id and nome='Contato WhatsApp';
  end if;
  return new;
end $$;
revoke all on function public.lotti_conversa_no_crm() from public,anon,authenticated;

-- Número e nome podem chegar depois: conversa achada só pelo LID nasce sem
-- telefone, e o nome do contato costuma vir no evento seguinte.
drop trigger if exists lotti_conversa_no_crm_insert on public.lotti_agent_conversations;
create trigger lotti_conversa_no_crm_insert before insert on public.lotti_agent_conversations
  for each row execute function public.lotti_conversa_no_crm();
drop trigger if exists lotti_conversa_no_crm_phone on public.lotti_agent_conversations;
create trigger lotti_conversa_no_crm_phone before update of phone,contact_name on public.lotti_agent_conversations
  for each row execute function public.lotti_conversa_no_crm();

-- Quem já estava no Inbox sem cliente entra agora, uma conversa por vez: uma
-- que falhe (telefone implausível, corrida) não pode derrubar as outras.
do $$
declare r record;
begin
  for r in select c.id from public.lotti_agent_conversations c
             join public.lotti_agent_channels ch on ch.id=c.channel_id
            where c.cliente_id is null and c.phone is not null and not ch.sandbox
            order by c.id
  loop
    begin perform public.lotti_inbox_link_cliente(r.id);
    exception when others then null;
    end;
  end loop;
end $$;

notify pgrst,'reload schema';
commit;
