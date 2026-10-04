-- Prova das consultas da visita. Tudo dentro de transação desfeita no fim.
begin;
create temp table prova as
  select co.id as corretor_id, co.user_id, m.organization_id
  from public.corretores co join public.routine_memberships m on m.user_id = co.user_id and m.status = 'active'
  limit 1;
grant select on prova to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true) from prova;
set local role authenticated;
select count(*)::text as conflitos_amanha_10h
  from prova, public.routine_detect_conflicts(prova.user_id, (current_date + 1 + time '10:00') at time zone 'America/Sao_Paulo',
       (current_date + 1 + time '11:00') at time zone 'America/Sao_Paulo', null);
insert into public.routine_events (organization_id, assigned_to, created_by, title, activity_type, status, priority, start_at, end_at,
  timezone, visibility, source, client_id, property_id, sync_status)
select organization_id, user_id, user_id, 'Visita: prova', 'visita', 'pending_confirmation', 'urgent',
  now() + interval '1 day', now() + interval '1 day 1 hour', 'America/Sao_Paulo', 'team', 'ai', null, null, 'pending' from prova;
select count(*)::text as eventos_prova from public.routine_events where title = 'Visita: prova';
reset role;
insert into public.alertas (corretor_id, cliente_id, tipo, mensagem, metadata, lido, origem, entidade_tipo, entidade_id)
select corretor_id, null, 'GERAL', 'prova', '{"visita_id":"prova","prioridade":"ALTA"}'::jsonb, false, 'ia', 'cliente', null from prova;
select count(*)::text as alertas_prova from public.alertas where metadata->>'visita_id' = 'prova';
rollback;
