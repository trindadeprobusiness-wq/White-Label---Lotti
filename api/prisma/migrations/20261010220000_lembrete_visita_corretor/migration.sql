-- Lembrete ao corretor: visita que a IA reservou ("a confirmar") e começa nas próximas 24 h ainda sem
-- confirmação gera UM alerta para o corretor (quem confirma e avisa o cliente é ele). Roda pelo
-- agendador da API a cada 15 min (agendamentos.config.ts: lembrete-visita-corretor). Devolve quantos criou.
CREATE OR REPLACE FUNCTION public.lotti_visita_lembrete_corretor()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_n integer;
begin
  with novos as (
    insert into public.alertas(corretor_id, cliente_id, tipo, mensagem, metadata, lido, origem, entidade_tipo, entidade_id)
    select co.id, e.client_id, 'GERAL',
      'Visita ainda não confirmada: ' || regexp_replace(e.title, '^Visita: ', '') || ' em '
        || to_char(e.start_at at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '. Confirme com o cliente.',
      jsonb_build_object('prioridade', 'ALTA', 'tipo', 'visita_lembrete_corretor', 'routine_event_id', e.id, 'inicio', e.start_at),
      false, 'ia', 'cliente', e.client_id
    from public.routine_events e
    join public.corretores co on co.user_id = e.assigned_to
    where e.source = 'ai' and e.activity_type = 'visita' and e.status = 'pending_confirmation' and e.deleted_at is null
      and e.start_at > now() and e.start_at <= now() + interval '24 hours'
      and not exists (select 1 from public.alertas a
                      where a.metadata->>'tipo' = 'visita_lembrete_corretor' and a.metadata->>'routine_event_id' = e.id::text)
    returning 1)
  select count(*)::int into v_n from novos;
  return v_n;
end $function$
;

REVOKE ALL ON FUNCTION public.lotti_visita_lembrete_corretor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lotti_visita_lembrete_corretor() FROM anon;
REVOKE ALL ON FUNCTION public.lotti_visita_lembrete_corretor() FROM authenticated;
