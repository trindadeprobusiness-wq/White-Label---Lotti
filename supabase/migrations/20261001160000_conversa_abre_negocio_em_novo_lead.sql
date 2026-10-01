begin;

-- Conversa com número também abre negócio na primeira etapa do funil.
--
-- A `20260930190000` passou a criar o cliente, mas o funil não lista clientes:
-- lista `crm_oportunidades`. Por isso o Inbox mostrava 146 contatos e o Kanban
-- continuava quase vazio — não faltava contato, faltava negócio.
--
-- A etapa é escolhida pela ordem, não pelo nome: "Novo lead" é a primeira
-- etapa aberta do funil, e renomeá-la não pode quebrar a regra.

create or replace function public.lotti_crm_primeira_etapa(p_owner uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select e.id from public.crm_etapas e
   where e.corretor_id=p_owner and coalesce(e.tipo,'ABERTA')='ABERTA' and coalesce(e.ativo,true)
   order by e.ordem, e.nome limit 1
$$;
revoke all on function public.lotti_crm_primeira_etapa(uuid) from public,anon,authenticated;

-- Um negócio aberto por cliente: quem já está sendo trabalhado no funil não
-- volta para o começo, e clicar duas vezes não cria dois cards.
create or replace function public.lotti_inbox_abrir_negocio(p_owner uuid,p_cliente uuid,p_titulo text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_etapa uuid;
begin
  if p_owner is null or p_cliente is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_cliente::text,717));
  select id into v_id from public.crm_oportunidades
   where cliente_id=p_cliente and corretor_id=p_owner and fechada_em is null
   order by updated_at desc limit 1;
  if v_id is not null then return v_id; end if;
  v_etapa:=public.lotti_crm_primeira_etapa(p_owner);
  -- Conta sem funil configurado não é motivo para perder a conversa.
  if v_etapa is null then return null; end if;
  insert into public.crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo,origem)
  values(p_owner,p_cliente,v_etapa,coalesce(nullif(btrim(p_titulo),''),'Contato WhatsApp'),'whatsapp')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.lotti_inbox_abrir_negocio(uuid,uuid,text) from public,anon,authenticated;

-- O gatilho da 20260930190000, agora abrindo o negócio junto. O resto da regra
-- é idêntico: canal de teste não povoa nada, e falha na ligação nunca derruba
-- a mensagem.
create or replace function public.lotti_conversa_no_crm() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if new.cliente_id is null and new.phone is not null
     and not exists(select 1 from public.lotti_agent_channels ch where ch.id=new.channel_id and ch.sandbox) then
    begin
      v_result:=public.lotti_find_or_create_cliente(new.corretor_id,new.phone,
        coalesce(new.contact_name,'Contato WhatsApp'),
        jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'));
      new.cliente_id:=(v_result->>'cliente_id')::uuid;
      if new.last_error='crm_capture_pending' then new.last_error:=null; end if;
    exception when others then
      new.last_error:=coalesce(new.last_error,'crm_capture_pending');
    end;
  end if;
  if new.cliente_id is not null and new.contact_name is not null then
    update public.clientes set nome=new.contact_name
     where id=new.cliente_id and nome='Contato WhatsApp';
  end if;
  -- O card no funil é o que o corretor enxerga. Falhar aqui também não pode
  -- custar a mensagem.
  if new.cliente_id is not null
     and not exists(select 1 from public.lotti_agent_channels ch where ch.id=new.channel_id and ch.sandbox) then
    begin
      perform public.lotti_inbox_abrir_negocio(new.corretor_id,new.cliente_id,
        coalesce(new.contact_name,'Contato WhatsApp'));
    exception when others then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.lotti_conversa_no_crm() from public,anon,authenticated;

-- O botão do front publicado continua existindo e passa a abrir o negócio
-- junto, para não haver dois comportamentos diferentes para a mesma ação.
create or replace function public.lotti_inbox_link_cliente(p_conversation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_phone text; v_name text; v_client uuid; v_result jsonb;
begin
  select c.corretor_id,c.phone,c.contact_name,c.cliente_id into v_owner,v_phone,v_name,v_client
    from public.lotti_agent_conversations c where c.id=p_conversation for update;
  if v_owner is null then raise exception 'conversation_not_found'; end if;
  if v_client is not null then
    perform public.lotti_inbox_abrir_negocio(v_owner,v_client,coalesce(v_name,'Contato WhatsApp'));
    return jsonb_build_object('cliente_id',v_client,'created',false);
  end if;
  if v_phone is null then raise exception 'phone_required'; end if;
  v_result:=public.lotti_find_or_create_cliente(v_owner,v_phone,coalesce(v_name,'Contato WhatsApp'),
    jsonb_build_object('status_funil','QUALIFICACAO','tipo_interesse','AMBOS'));
  update public.lotti_agent_conversations
    set cliente_id=(v_result->>'cliente_id')::uuid,
        last_error=case when last_error='crm_capture_pending' then null else last_error end
    where id=p_conversation;
  perform public.lotti_inbox_abrir_negocio(v_owner,(v_result->>'cliente_id')::uuid,coalesce(v_name,'Contato WhatsApp'));
  return v_result;
end $$;
revoke all on function public.lotti_inbox_link_cliente(uuid) from public,anon,authenticated;

-- Quem já está no Inbox com cliente ganha o card agora, um por vez: uma conta
-- sem funil configurado não pode impedir as demais.
do $$
declare r record;
begin
  for r in select c.corretor_id, c.cliente_id, c.contact_name
             from public.lotti_agent_conversations c
             join public.lotti_agent_channels ch on ch.id=c.channel_id
            where c.cliente_id is not null and not ch.sandbox
            order by c.id
  loop
    begin perform public.lotti_inbox_abrir_negocio(r.corretor_id,r.cliente_id,coalesce(r.contact_name,'Contato WhatsApp'));
    exception when others then null;
    end;
  end loop;
end $$;

notify pgrst,'reload schema';
commit;
