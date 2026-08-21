-- ---------------------------------------------------------------------------
-- Central de Rotina — prova de isolamento, privacidade e permissões.
--
-- COMO RODAR: depois da migration 20260821004218, execute no SQL Editor.
-- Tudo roda em transação e termina com ROLLBACK.
-- ---------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_owner UUID := 'a1111111-1111-4111-8111-111111111111';
  v_manager UUID := 'a2222222-2222-4222-8222-222222222222';
  v_member UUID := 'a3333333-3333-4333-8333-333333333333';
  v_outsider UUID := 'a4444444-4444-4444-8444-444444444444';
  v_org UUID;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
    (v_owner, 'routine-owner@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_manager, 'routine-manager@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_member, 'routine-member@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_outsider, 'routine-outsider@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.corretores (user_id, nome, email, creci, telefone) VALUES
    (v_owner, 'Owner Rotina', 'routine-owner@teste.local', 'PENDENTE', ''),
    (v_manager, 'Manager Rotina', 'routine-manager@teste.local', 'PENDENTE', ''),
    (v_member, 'Member Rotina', 'routine-member@teste.local', 'PENDENTE', ''),
    (v_outsider, 'Outsider Rotina', 'routine-outsider@teste.local', 'PENDENTE', '')
  ON CONFLICT (user_id) DO NOTHING;

  SELECT o.id INTO v_org FROM public.routine_organizations o
  JOIN public.corretores c ON c.id = o.legacy_corretor_id
  WHERE c.user_id = v_owner;

  INSERT INTO public.routine_memberships (organization_id, user_id, role, status, display_name) VALUES
    (v_org, v_manager, 'gestor', 'active', 'Gestor'),
    (v_org, v_member, 'colaborador', 'active', 'Colaborador')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

  INSERT INTO public.routine_events
    (organization_id, assigned_to, created_by, title, start_at, end_at, visibility)
  VALUES
    (v_org, v_owner, v_owner, 'Reunião da equipe', '2026-08-22 12:00Z', '2026-08-22 13:00Z', 'team'),
    (v_org, v_owner, v_owner, 'Assunto privado', '2026-08-22 14:00Z', '2026-08-22 15:00Z', 'private');
END $$;

-- 1. Usuário externo não atravessa organização.
DO $$
DECLARE v_count INT;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a4444444-4444-4444-8444-444444444444', TRUE);
  SELECT count(*) INTO v_count FROM public.routine_events;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FALHA 1: outsider leu % evento(s)', v_count; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 1: nenhuma informação atravessa organizações';
END $$;

-- 2. Gestor coordena a equipe, mas detalhes privados permanecem privados.
DO $$
DECLARE v_count INT; v_title TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', TRUE);
  SELECT count(*) INTO v_count FROM public.routine_events;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FALHA 2a: gestor deveria ver 1 evento de equipe, viu %', v_count; END IF;
  SELECT title INTO v_title FROM public.routine_detect_conflicts(
    'a1111111-1111-4111-8111-111111111111', '2026-08-22 14:30Z', '2026-08-22 14:45Z', NULL
  ) LIMIT 1;
  IF v_title <> 'Horário ocupado' THEN RAISE EXCEPTION 'FALHA 2b: RPC expôs título privado: %', v_title; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 2: gestor vê operação, não conteúdo privado';
END $$;

-- 3. Colaborador não delega atividade para outra pessoa.
DO $$
DECLARE v_org UUID;
BEGIN
  SELECT organization_id INTO v_org FROM public.routine_memberships
  WHERE user_id = 'a3333333-3333-4333-8333-333333333333'
    AND role = 'colaborador' LIMIT 1;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', TRUE);
  BEGIN
    INSERT INTO public.routine_tasks
      (organization_id, assigned_to, created_by, title)
    VALUES (v_org, 'a1111111-1111-4111-8111-111111111111',
            'a3333333-3333-4333-8333-333333333333', 'Delegação indevida');
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 3: colaborador delegou tarefa para o proprietário';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'OK 3: somente gestor/administrador/proprietário delega';
END $$;

-- 4. Tokens e mappings do Google não são legíveis pelo browser autenticado.
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', TRUE);
  BEGIN
    PERFORM count(*) FROM public.calendar_connections;
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 4a: browser leu calendar_connections';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.calendar_event_mappings;
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 4b: browser leu calendar_event_mappings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'OK 4: credenciais e mappings são backend-only';
END $$;

-- 5. UPDATE respeita USING e WITH CHECK: colaborador edita a própria tarefa,
-- mas não muda o responsável para outro membro.
DO $$
DECLARE v_org UUID; v_task UUID;
BEGIN
  SELECT organization_id INTO v_org FROM public.routine_memberships
  WHERE user_id = 'a3333333-3333-4333-8333-333333333333' AND role = 'colaborador' LIMIT 1;
  INSERT INTO public.routine_tasks (organization_id, assigned_to, created_by, title)
  VALUES (v_org, 'a3333333-3333-4333-8333-333333333333', 'a1111111-1111-4111-8111-111111111111', 'Tarefa própria')
  RETURNING id INTO v_task;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', TRUE);
  UPDATE public.routine_tasks SET title = 'Tarefa editada' WHERE id = v_task;
  BEGIN
    UPDATE public.routine_tasks SET assigned_to = 'a1111111-1111-4111-8111-111111111111' WHERE id = v_task;
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 5: colaborador transferiu tarefa sem permissão';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'OK 5: UPDATE possui WITH CHECK e impede troca de responsável';
END $$;

-- 6. O histórico é append-only por trigger; o browser não forja auditoria.
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', TRUE);
  BEGIN
    INSERT INTO public.routine_activity_log
      (organization_id, actor_user_id, entity_type, entity_id, action)
    SELECT organization_id, 'a1111111-1111-4111-8111-111111111111', 'event', gen_random_uuid(), 'forged'
    FROM public.routine_memberships
    WHERE user_id = 'a1111111-1111-4111-8111-111111111111' LIMIT 1;
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 6: browser inseriu auditoria forjada';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'OK 6: auditoria só é escrita por triggers/backend';
END $$;

-- 7. Mesmo conhecendo o UUID, uma organização não vincula cliente de outra.
DO $$
DECLARE v_owner_org UUID; v_outsider_corretor UUID; v_outsider_client UUID;
BEGIN
  SELECT organization_id INTO v_owner_org FROM public.routine_memberships
  WHERE user_id = 'a1111111-1111-4111-8111-111111111111' LIMIT 1;
  SELECT id INTO v_outsider_corretor FROM public.corretores
  WHERE user_id = 'a4444444-4444-4444-8444-444444444444';
  INSERT INTO public.clientes (corretor_id, nome, telefone)
  VALUES (v_outsider_corretor, 'Cliente de outro tenant', '00000000000')
  RETURNING id INTO v_outsider_client;

  BEGIN
    INSERT INTO public.routine_tasks
      (organization_id, assigned_to, created_by, title, client_id)
    VALUES (
      v_owner_org,
      'a1111111-1111-4111-8111-111111111111',
      'a1111111-1111-4111-8111-111111111111',
      'Vínculo indevido',
      v_outsider_client
    );
    RAISE EXCEPTION 'FALHA 7: tarefa vinculou cliente de outra organização';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 7: vínculos CRM também respeitam a organização';
END $$;

-- 8. Ciclo real da tarefa: criar, editar, concluir e excluir logicamente.
DO $$
DECLARE v_org UUID; v_task UUID; v_status TEXT; v_deleted TIMESTAMPTZ;
BEGIN
  SELECT organization_id INTO v_org FROM public.routine_memberships
  WHERE user_id = 'a3333333-3333-4333-8333-333333333333' LIMIT 1;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', TRUE);
  INSERT INTO public.routine_tasks (organization_id, assigned_to, created_by, title, due_at)
  VALUES (v_org, 'a3333333-3333-4333-8333-333333333333', 'a3333333-3333-4333-8333-333333333333', 'Ciclo da tarefa', now() + interval '1 day')
  RETURNING id INTO v_task;
  UPDATE public.routine_tasks SET title = 'Ciclo editado' WHERE id = v_task;
  UPDATE public.routine_tasks SET status = 'completed', completed_at = now() WHERE id = v_task;
  UPDATE public.routine_tasks SET deleted_at = now() WHERE id = v_task;
  SELECT status, deleted_at INTO v_status, v_deleted FROM public.routine_tasks WHERE id = v_task;
  IF v_status <> 'completed' OR v_deleted IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 8: ciclo CRUD/conclusão ficou inconsistente';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 8: criar, editar, concluir e excluir tarefa passou';
END $$;

-- 9. Gestor pode delegar item não privado; o responsável passa a enxergá-lo.
DO $$
DECLARE v_org UUID; v_task UUID; v_count INT;
BEGIN
  SELECT organization_id INTO v_org FROM public.routine_memberships
  WHERE user_id = 'a2222222-2222-4222-8222-222222222222' AND role = 'gestor' LIMIT 1;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', TRUE);
  INSERT INTO public.routine_tasks (organization_id, assigned_to, created_by, title, visibility)
  VALUES (v_org, 'a3333333-3333-4333-8333-333333333333', 'a2222222-2222-4222-8222-222222222222', 'Tarefa delegada pelo gestor', 'team')
  RETURNING id INTO v_task;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', TRUE);
  SELECT count(*) INTO v_count FROM public.routine_tasks WHERE id = v_task;
  IF v_count <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALHA 9: responsável não enxergou tarefa delegada';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 9: delegação autorizada e visível ao responsável';
END $$;

ROLLBACK;
