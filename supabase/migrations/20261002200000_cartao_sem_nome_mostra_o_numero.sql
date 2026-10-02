begin;

-- Cartão de contato sem nome mostra o número, não "Contato WhatsApp".
--
-- Depois da `20261002180000` o funil ganhou 102 cartões, e 49 deles nasceram
-- com o mesmo título: "Contato WhatsApp". É o texto que `lotti_find_or_create_cliente`
-- usa como marcador quando o contato não está salvo na agenda — serve como
-- marcador, não como nome na tela. Meia dúzia de cartões idênticos lado a lado
-- é um quadro que não dá para trabalhar.
--
-- A regra já existe no Inbox, em `conversationTitle`: nome digitado no CRM
-- ganha; depois o nome da agenda; contato não salvo aparece pelo número, como
-- no WhatsApp. Aqui ela passa a valer também para o funil.

create or replace function public.lotti_telefone_legivel(p_telefone text) returns text
language sql immutable set search_path='' as $$
  -- Mesmo formato do `formatContactPhone` do front, para o número não aparecer
  -- de dois jeitos diferentes em telas vizinhas.
  select case
    when d ~ '^55\d{11}$' then '+55 (' || substr(d,3,2) || ') ' || substr(d,5,5) || '-' || substr(d,10,4)
    when d ~ '^55\d{10}$' then '+55 (' || substr(d,3,2) || ') ' || substr(d,5,4) || '-' || substr(d,9,4)
    when d = '' then null
    else '+' || d
  end
  from (select regexp_replace(coalesce(p_telefone,''), '\D', '', 'g') as d) t
$$;

-- O gatilho passa a escolher o título com a mesma regra. Sem isso, todo contato
-- novo sem nome voltaria a nascer como "Contato WhatsApp".
create or replace function public.lotti_conversa_no_crm() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_titulo text;
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
      v_titulo:=coalesce(
        nullif(btrim(new.contact_name),''),
        public.lotti_telefone_legivel(new.phone),
        'Contato WhatsApp');
      perform public.lotti_inbox_abrir_negocio(new.corretor_id,new.cliente_id,v_titulo);
    exception when others then null;
    end;
  end if;
  return new;
end $$;
revoke all on function public.lotti_conversa_no_crm() from public,anon,authenticated;

-- Os cartões que já nasceram com o marcador. Só mexe em quem ficou com o
-- texto exato: cartão renomeado por uma pessoa não é tocado.
update public.crm_oportunidades o set titulo = coalesce(
    nullif(btrim(c.contact_name),''),
    public.lotti_telefone_legivel(c.phone),
    o.titulo)
  from public.lotti_agent_conversations c
 where c.cliente_id = o.cliente_id
   and o.titulo = 'Contato WhatsApp'
   and o.fechada_em is null;

notify pgrst,'reload schema';
commit;
