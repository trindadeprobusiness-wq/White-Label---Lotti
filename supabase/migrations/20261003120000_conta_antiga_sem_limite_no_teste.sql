begin;

-- Conta antiga continua sem limite de imóveis, fachadas e aluguéis durante o
-- período de teste.
--
-- billing_legacy_accounts (20260925120000) guarda as contas que já operavam
-- antes da cobrança. Elas ficaram sem limite nesses três recursos — mas só
-- enquanto não tivessem NENHUMA linha em subscriptions. Uma assinatura de
-- teste bastava para a conta cair nos limites do plano.
--
-- Em 2026-10-02 um teste do Essencial, criado para ligar a IA, pôs uma conta
-- antiga com 16 aluguéis ativos sob o limite de 5: nenhum contrato de locação
-- novo podia ser ativado. E quando o teste acabasse, a conta perderia também
-- imóveis e fachadas — sem plano válido e sem isenção, checar_cota nega tudo.
--
-- Teste não é escolha de plano. A isenção agora só acaba quando existe uma
-- assinatura que não seja teste: paga ('active'), atrasada ('past_due'), em só
-- leitura ('read_only') ou cancelada ('canceled'). 'trialing' e 'expired' —
-- pelo enum, "trial expirado sem conversão" — mantêm a isenção. Quem paga um
-- plano passa às cotas do plano, como antes; cancelamento continua sem virar
-- acesso ilimitado.
--
-- Durante o teste, as demais cotas (contratos por IA, leads qualificados)
-- seguem o plano de teste. A isenção cobre só os três recursos de sempre.
--
-- A regra mora numa função só, usada pelo banco (checar_cota, e por ele o
-- gatilho que barra a criação) e pela tela (useCheckLimit), que não enxerga
-- billing_legacy_accounts e precisa perguntar.

create or replace function public.conta_antiga_sem_limite(_corretor_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Mesma guarda de checar_cota: pelo navegador, só a própria conta.
  if auth.role() = 'authenticated'
     and public.get_corretor_id() is distinct from _corretor_id then
    return false;
  end if;

  return exists (select 1 from public.billing_legacy_accounts b
                  where b.corretor_id = _corretor_id)
     and not exists (select 1 from public.subscriptions s
                      where s.corretor_id = _corretor_id
                        and s.status not in ('trialing', 'expired'));
end $$;

revoke all on function public.conta_antiga_sem_limite(uuid) from public, anon;
grant execute on function public.conta_antiga_sem_limite(uuid) to authenticated, service_role;

create or replace function public.checar_cota(
  _corretor_id uuid,
  _feature_key text
)
returns table (
  permitido boolean, usado int, limite int, ilimitado boolean, habilitado boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_plano uuid;
  v_ent record;
  v_usado int := 0;
  v_extra int := 0;
begin
  if auth.role() = 'authenticated'
     and public.get_corretor_id() is distinct from _corretor_id then
    return query select false, 0, 0, false, false;
    return;
  end if;

  -- Antes de olhar o plano: a conta antiga em teste também tem plano válido,
  -- e era aí que a isenção se perdia.
  if _feature_key in ('max_imoveis', 'max_fachadas', 'max_contratos_locacao')
     and public.conta_antiga_sem_limite(_corretor_id) then
    return query select true, 0, null::integer, true, true;
    return;
  end if;

  select s.plan_id into v_plano
    from public.subscriptions s
   where s.corretor_id = _corretor_id
     and ((s.status = 'trialing' and s.trial_ends_at > now())
       or (s.status = 'active' and s.current_period_end > now()))
   limit 1;

  if v_plano is null then
    return query select false, 0, 0, false, false;
    return;
  end if;

  select e.enabled, e.limit_value, e.unlimited into v_ent
    from public.plan_entitlements e
   where e.plan_id = v_plano and e.feature_key = _feature_key;

  if not found then
    return query select false, 0, 0, false, false;
    return;
  end if;

  if not v_ent.enabled then
    return query select false, 0, v_ent.limit_value, v_ent.unlimited, false;
    return;
  end if;

  if v_ent.unlimited then
    return query select true, 0, null::int, true, true;
    return;
  end if;

  if v_ent.limit_value is null then
    return query select v_ent.enabled, 0, null::int, false, v_ent.enabled;
    return;
  end if;

  case _feature_key
    when 'max_imoveis' then
      select count(*)::int into v_usado from public.imoveis
       where corretor_id = _corretor_id and ativo is true;
    when 'max_contratos_locacao' then
      select count(*)::int into v_usado from public.contratos
       where corretor_id = _corretor_id
         and tipo in ('LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL') and status = 'ATIVO';
    when 'max_fachadas' then
      select count(*)::int into v_usado from public.fachadas
       where corretor_id = _corretor_id and ativo is true;
    else
      select coalesce(u.used_quantity, 0) into v_usado
        from public.usage_counters u
       where u.corretor_id = _corretor_id
         and u.feature_key = _feature_key
         and u.period_start = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
      v_usado := coalesce(v_usado, 0);
  end case;

  select coalesce(sum(
    case a.addon_code
      when 'extra_user' then case when _feature_key = 'max_users' then a.quantity else 0 end
      when 'extra_fachadas_25' then case when _feature_key = 'max_fachadas' then 25 * a.quantity else 0 end
      when 'extra_ai_100' then case when _feature_key = 'ai_contracts_monthly' then 100 * a.quantity else 0 end
      when 'extra_leads_50' then case when _feature_key = 'leads_qualificados_monthly' then 50 * a.quantity else 0 end
      when 'extra_storage_50' then case when _feature_key = 'storage_gb' then 50 * a.quantity else 0 end
      else 0
    end
  ), 0)::int into v_extra
    from public.subscription_addons a
   where a.corretor_id = _corretor_id and a.status = 'active';

  return query select
    v_ent.enabled and v_usado < v_ent.limit_value + v_extra,
    v_usado,
    v_ent.limit_value + v_extra,
    false,
    v_ent.enabled;
end $$;

revoke all on function public.checar_cota(uuid, text) from public, anon;
grant execute on function public.checar_cota(uuid, text) to authenticated, service_role;

-- A tela chama conta_antiga_sem_limite pela API: o PostgREST precisa enxergá-la.
notify pgrst, 'reload schema';
commit;
