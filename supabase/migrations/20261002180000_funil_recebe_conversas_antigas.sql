begin;

-- As conversas que já existiam entram no funil.
--
-- A `20261001160000` fez toda conversa nova abrir negócio na primeira etapa, e
-- isso funciona: em produção os dois negócios com `origem='whatsapp'` nasceram
-- depois dela. O que ela não fez foi olhar para trás.
--
-- Resultado medido antes desta migration: 148 clientes, 103 conversas e
-- 8 negócios no Kanban — 123 conversas com cliente vinculado e nenhum cartão.
-- Quem conectou o número e foi procurar o contato no funil não achava, porque
-- o contato é anterior ao gatilho.
--
-- A regra do que abrir não é reescrita aqui: chama `lotti_inbox_abrir_negocio`,
-- que escolhe a primeira etapa aberta pela ordem e não duplica negócio de
-- cliente que já está sendo trabalhado.

do $$
declare r record; v_id uuid; v_abertos int := 0; v_falhas int := 0;
begin
  for r in
    select c.corretor_id, c.cliente_id,
           coalesce(nullif(btrim(c.contact_name), ''), cl.nome) as titulo
      from public.lotti_agent_conversations c
      join public.clientes cl on cl.id = c.cliente_id
      join public.lotti_agent_channels ch on ch.id = c.channel_id
     where c.cliente_id is not null
       -- Canal de teste não povoa o funil de ninguém.
       and not ch.sandbox
       and not exists (
         select 1 from public.crm_oportunidades o
          where o.cliente_id = c.cliente_id and o.fechada_em is null
       )
     -- Uma conversa por cliente: duas conversas do mesmo cliente não viram
     -- dois cartões. A função já protege disso, mas evitar a chamada repetida
     -- deixa a contagem honesta.
     group by c.corretor_id, c.cliente_id, coalesce(nullif(btrim(c.contact_name), ''), cl.nome)
  loop
    begin
      v_id := public.lotti_inbox_abrir_negocio(r.corretor_id, r.cliente_id, r.titulo);
      if v_id is not null then v_abertos := v_abertos + 1; end if;
    exception when others then
      -- Conta sem funil configurado, gatilho de plano recusando o registro:
      -- nenhum desses motivos justifica abortar a migration inteira.
      v_falhas := v_falhas + 1;
    end;
  end loop;
  raise notice 'funil: % negócios abertos, % recusados', v_abertos, v_falhas;
end $$;

commit;
