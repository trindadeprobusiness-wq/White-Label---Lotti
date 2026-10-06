-- gerar_alertas_vencimento_contratos() gravava em alertas.contrato_id, imovel_id,
-- prioridade e data_alerta, que não existem: falhava com 42703 sempre que algum contrato
-- entrava na janela de aviso (no pg_cron do Supabase e, depois, no job da API).
-- Mesma regra de antes, gravando no formato que o sino já lê (src/lib/notificacoes.ts):
-- entidade_tipo/entidade_id levam a /juridico, e a prioridade vai em metadata.
create or replace function public.gerar_alertas_vencimento_contratos()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
    c            record;
    t            int;
    alerta_date  date;
    dias         int;
    prio         text;
    criados      int := 0;
    thresholds   int[] := array[20, 15, 10, 0];
begin
    for c in
        select ct.id, ct.corretor_id, ct.imovel_id, ct.data_fim, ct.tipo,
               i.titulo as imovel_titulo
        from public.contratos ct
        left join public.imoveis i on i.id = ct.imovel_id
        where ct.data_fim is not null
          and ct.data_fim >= current_date - 1
          and ct.tipo in ('EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO', 'COMPRA_VENDA')
          and coalesce(ct.status, '') not in ('ARQUIVADO', 'RESCINDIDO', 'CANCELADO')
    loop
        -- Degraus de antecedência
        foreach t in array thresholds loop
            alerta_date := c.data_fim - t;
            if current_date >= alerta_date and current_date <= c.data_fim then
                dias := (c.data_fim - current_date);
                prio := case when dias <= 10 then 'ALTA' when dias <= 20 then 'MEDIA' else 'BAIXA' end;
                if not exists (
                    select 1 from public.alertas a
                    where a.entidade_tipo = 'contrato' and a.entidade_id = c.id
                      and a.tipo = 'EXCLUSIVIDADE'
                      and a.metadata->>'data_alerta' = alerta_date::text
                ) then
                    insert into public.alertas
                        (corretor_id, tipo, mensagem, lido, origem, entidade_tipo, entidade_id, metadata)
                    values
                        (c.corretor_id, 'EXCLUSIVIDADE',
                         'Contrato "' || coalesce(c.imovel_titulo, 'imóvel') || '" vence em ' || dias
                         || ' dia(s) — ' || to_char(c.data_fim, 'DD/MM/YYYY') || '. Trabalhe até essa data.',
                         false, 'cron', 'contrato', c.id,
                         jsonb_build_object('prioridade', prio, 'data_alerta', alerta_date::text,
                                            'contrato_id', c.id, 'imovel_id', c.imovel_id));
                    criados := criados + 1;
                end if;
            end if;
        end loop;

        -- Vencido (uma vez, no dia seguinte)
        if current_date = c.data_fim + 1 then
            if not exists (
                select 1 from public.alertas a
                where a.entidade_tipo = 'contrato' and a.entidade_id = c.id
                  and a.tipo = 'EXCLUSIVIDADE'
                  and a.metadata->>'data_alerta' = (c.data_fim + 1)::text
            ) then
                insert into public.alertas
                    (corretor_id, tipo, mensagem, lido, origem, entidade_tipo, entidade_id, metadata)
                values
                    (c.corretor_id, 'EXCLUSIVIDADE',
                     'Contrato "' || coalesce(c.imovel_titulo, 'imóvel') || '" VENCEU em '
                     || to_char(c.data_fim, 'DD/MM/YYYY') || '.',
                     false, 'cron', 'contrato', c.id,
                     jsonb_build_object('prioridade', 'ALTA', 'data_alerta', (c.data_fim + 1)::text,
                                        'contrato_id', c.id, 'imovel_id', c.imovel_id));
                criados := criados + 1;
            end if;
        end if;
    end loop;

    return criados;
end;
$function$;

revoke all on function public.gerar_alertas_vencimento_contratos() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gerar_alertas_vencimento_contratos() to service_role;
  end if;
end $$;
