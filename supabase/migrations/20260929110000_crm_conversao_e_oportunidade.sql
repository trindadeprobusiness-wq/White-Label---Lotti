begin;

-- Automated flows reuse the open deal of a client instead of opening another.
-- A client may still have several deals (buy one, sell another): only the
-- flows below look for an open one first, nothing forbids a second deal.
-- Lock 717 per client serializes "look, then insert" (see the lock order in
-- 20260929100000).
create or replace function public.crm_oportunidade_aberta(p_owner uuid,p_cliente uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_cliente::text,717));
  select id into v_id from public.crm_oportunidades
   where cliente_id=p_cliente and corretor_id=p_owner and fechada_em is null
   order by updated_at desc limit 1;
  return v_id;
end $$;
revoke all on function public.crm_oportunidade_aberta(uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_oportunidade_aberta(uuid,uuid) to service_role;

-- Converts a lead of the broker's facades in one transaction: client (or the
-- one chosen with p_cliente), deal and "convertido". The lead row is locked,
-- so a double click or a second tab gets 'ja_convertido' instead of another
-- client. There is no "create anyway": when the phone or the e-mail is
-- already a client of the account, nothing is written and the screen offers
-- to link to it. p_etapa null is the legacy funnel (no crm_oportunidades).
create or replace function public.crm_converter_lead(p_lead uuid,p_etapa uuid,p_dados jsonb default '{}'::jsonb,p_cliente uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=public.get_corretor_id();
  v_dados jsonb:=coalesce(p_dados,'{}'::jsonb);
  v_lead record; v_nome text; v_telefone text; v_email text; v_key text; v_candidatos jsonb; v_result jsonb;
  v_cliente uuid:=p_cliente; v_created boolean:=false; v_oportunidade uuid;
begin
  if v_owner is null then raise exception 'forbidden'; end if;
  -- Same predicate as the policy "Corretor atualiza leads das suas fachadas".
  select l.id,l.nome,l.telefone,l.email,l.convertido,l.cliente_id into v_lead
    from public.fachada_leads l
   where l.id=p_lead and l.fachada_id in (select f.id from public.fachadas f
     where f.corretor_id in (select r.id from public.corretores r where r.user_id=auth.uid()))
   for update;
  if not found then raise exception 'forbidden'; end if;
  if v_lead.convertido then
    return jsonb_build_object('status','ja_convertido','cliente_id',v_lead.cliente_id);
  end if;
  if p_etapa is not null and not exists(select 1 from public.crm_etapas where id=p_etapa and corretor_id=v_owner) then
    raise exception 'invalid_stage';
  end if;
  v_nome:=coalesce(nullif(btrim(v_dados->>'nome'),''),nullif(btrim(v_lead.nome),''),'Lead da fachada');
  if v_cliente is not null then
    if not exists(select 1 from public.clientes where id=v_cliente and corretor_id=v_owner) then raise exception 'forbidden'; end if;
  else
    v_telefone:=coalesce(nullif(btrim(v_dados->>'telefone'),''),v_lead.telefone,'');
    v_email:=coalesce(nullif(btrim(v_dados->>'email'),''),nullif(btrim(v_lead.email),''));
    v_key:=public.lotti_phone_key(v_telefone);
    if v_key is not null then perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':'||v_key,716)); end if;
    v_candidatos:=public.crm_candidatos_cliente(v_owner,v_telefone,v_email);
    if jsonb_array_length(v_candidatos)>0 then
      return jsonb_build_object('status','duplicate','candidatos',v_candidatos);
    end if;
    v_result:=public.lotti_find_or_create_cliente(v_owner,v_telefone,v_nome,
      jsonb_build_object('tipo_interesse','COMPRA','status_funil','QUALIFICACAO','observacoes','Convertido de lead da fachada.')
      ||(v_dados-'nome'-'telefone'-'email')||jsonb_build_object('email',v_email));
    v_cliente:=(v_result->>'cliente_id')::uuid;
    v_created:=(v_result->>'created')::boolean;
  end if;
  if p_etapa is not null then
    -- An open deal of the client stays where it is (never moved back).
    v_oportunidade:=public.crm_oportunidade_aberta(v_owner,v_cliente);
    if v_oportunidade is null then
      insert into public.crm_oportunidades(corretor_id,cliente_id,etapa_id,titulo,origem)
      values(v_owner,v_cliente,p_etapa,v_nome,'fachada') returning id into v_oportunidade;
    end if;
  end if;
  update public.fachada_leads set convertido=true,cliente_id=v_cliente where id=p_lead;
  return jsonb_build_object('status','converted','cliente_id',v_cliente,'created',v_created,'oportunidade_id',v_oportunidade);
end $$;
revoke all on function public.crm_converter_lead(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.crm_converter_lead(uuid,uuid,jsonb,uuid) to authenticated;

-- Same as 20260927140000, plus: the open deal comes from crm_oportunidade_aberta
-- (lock 717), and a transitional guard for clients duplicated by the old
-- capture (before 20260928200000): when this client has no open deal but
-- exactly one other client of the account with the same Brazilian phone key
-- has one, that deal is moved instead of opening a second one, and the team
-- is told once. Nothing is relinked or merged here.
create or replace function public.lotti_agent_move_stage(p_conversation uuid, p_stage uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; v_opportunity uuid; v_key text; v_others uuid[]; v_other_client uuid;
begin
  select * into cv from public.lotti_agent_conversations where id = p_conversation;
  if p_stage is null or cv.cliente_id is null
     or not exists(select 1 from public.crm_etapas where id = p_stage and corretor_id = cv.corretor_id) then
    return false;
  end if;
  v_opportunity := public.crm_oportunidade_aberta(cv.corretor_id, cv.cliente_id);
  if v_opportunity is null then
    v_key := public.lotti_phone_key(cv.phone);
    if v_key ~ '^[1-9][1-9][mf][0-9]{8}$' then
      select array_agg(o.id order by o.updated_at desc), (array_agg(o.cliente_id))[1] into v_others, v_other_client
      from public.crm_oportunidades o join public.clientes k on k.id = o.cliente_id
      where o.corretor_id = cv.corretor_id and o.fechada_em is null and o.cliente_id <> cv.cliente_id
        and k.corretor_id = cv.corretor_id and public.lotti_phone_key(k.telefone) = v_key;
      if cardinality(v_others) = 1 then
        v_opportunity := v_others[1];
        insert into public.alertas(corretor_id, cliente_id, tipo, mensagem, metadata, origem, entidade_tipo, entidade_id)
        select cv.corretor_id, cv.cliente_id, 'GERAL', 'Possível cliente duplicado: o mesmo telefone está em outro cadastro do CRM',
          jsonb_build_object('source','lotti_agent','conversation_id',cv.id,'priority','media','outro_cliente_id',v_other_client,'oportunidade_id',v_opportunity),
          'ia', 'cliente', cv.cliente_id
        where not exists(select 1 from public.alertas a where a.corretor_id = cv.corretor_id and a.origem = 'ia'
          and a.metadata->>'conversation_id' = cv.id::text
          and a.mensagem = 'Possível cliente duplicado: o mesmo telefone está em outro cadastro do CRM');
      end if;
    end if;
  end if;
  if v_opportunity is null then
    insert into public.crm_oportunidades(corretor_id, cliente_id, etapa_id, titulo, origem)
    select cv.corretor_id, cv.cliente_id, p_stage, coalesce(nullif(k.nome, ''), 'Contato WhatsApp'), 'whatsapp_ia'
    from public.clientes k where k.id = cv.cliente_id;
  else
    update public.crm_oportunidades set etapa_id = p_stage, updated_at = now() where id = v_opportunity and etapa_id is distinct from p_stage;
  end if;
  return true;
end $$;

-- Same as 20260927130000; the deal is now moved by lotti_agent_move_stage,
-- which had the same rule and now also reuses the open deal under lock.
create or replace function public.lotti_agent_handoff(p_id uuid, p_token uuid, p_revision bigint, p_result jsonb, p_stage uuid, p_silent boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare cv public.lotti_agent_conversations; v_sandbox boolean;
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
  perform public.lotti_agent_move_stage(p_id, p_stage);
  return true;
end $$;

revoke all on function public.lotti_agent_move_stage(uuid,uuid), public.lotti_agent_handoff(uuid,uuid,bigint,jsonb,uuid,boolean) from public, anon, authenticated;
grant execute on function public.lotti_agent_move_stage(uuid,uuid), public.lotti_agent_handoff(uuid,uuid,bigint,jsonb,uuid,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
