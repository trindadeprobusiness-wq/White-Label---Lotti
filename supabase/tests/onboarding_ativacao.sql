-- ---------------------------------------------------------------------------
-- Onboarding — integração, idempotência, organização compartilhada e RLS.
--
-- COMO RODAR: depois das migrations de CRM, Rotina e Onboarding, execute no
-- SQL Editor. Tudo roda em transação e termina com ROLLBACK.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE onboarding_test_state (key TEXT PRIMARY KEY, value TEXT);

DO $$
DECLARE
  v_owner UUID := 'b1111111-1111-4111-8111-111111111111';
  v_invited UUID := 'b2222222-2222-4222-8222-222222222222';
  v_outsider UUID := 'b3333333-3333-4333-8333-333333333333';
  v_org UUID;
BEGIN
  INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
    (v_owner, 'onboarding-owner@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_invited, 'onboarding-invited@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
    (v_outsider, 'onboarding-outsider@teste.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  -- corretores não tem UNIQUE(user_id): ON CONFLICT (user_id) abortava o script.
  INSERT INTO public.corretores (user_id, nome, email, creci, telefone)
  SELECT v.* FROM (VALUES
    (v_owner, 'Owner Onboarding', 'onboarding-owner@teste.local', 'PENDENTE', '11900000001'),
    (v_invited, 'Convidado Onboarding', 'onboarding-invited@teste.local', 'PENDENTE', '11900000002'),
    (v_outsider, 'Externo Onboarding', 'onboarding-outsider@teste.local', 'PENDENTE', '11900000003')
  ) AS v(user_id, nome, email, creci, telefone)
  WHERE NOT EXISTS (SELECT 1 FROM public.corretores c WHERE c.user_id = v.user_id);

  SELECT organization_id INTO v_org FROM public.routine_memberships
   WHERE user_id=v_owner AND status='active' LIMIT 1;
  INSERT INTO onboarding_test_state VALUES ('owner_org',v_org::TEXT);
END $$;

-- 1. Uma pessoa externa não lê perfil, evento ou demonstração de outra org.
DO $$
DECLARE v_count INT; v_org UUID := (SELECT value::UUID FROM onboarding_test_state WHERE key='owner_org');
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"b3333333-3333-4333-8333-333333333333","role":"authenticated","email":"onboarding-outsider@teste.local"}', TRUE);
  SELECT count(*) INTO v_count FROM public.onboarding_profiles WHERE organization_id=v_org;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FALHA 1a: externo leu perfil de onboarding'; END IF;
  SELECT count(*) INTO v_count FROM public.onboarding_events WHERE organization_id=v_org;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FALHA 1b: externo leu analytics de onboarding'; END IF;
  SELECT count(*) INTO v_count FROM public.onboarding_sample_data WHERE organization_id=v_org;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FALHA 1c: externo leu dados demo de outra org'; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 1: RLS isolou onboarding e demonstração';
END $$;

-- 2. Ação demo é idempotente e não conta como valor real.
DO $$
DECLARE v_first JSONB; v_second JSONB; v_context JSONB;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","email":"onboarding-owner@teste.local"}', TRUE);
  SELECT public.onboarding_executar_acao('sample_property', jsonb_build_object(
    'titulo','Imóvel demo seguro','cidade','São Paulo','valor',500000,'is_sample_data',TRUE
  )) INTO v_first;
  SELECT public.onboarding_executar_acao('sample_property', jsonb_build_object(
    'titulo','Imóvel demo duplicado','cidade','São Paulo','valor',900000,'is_sample_data',TRUE
  )) INTO v_second;
  IF v_first->>'id' <> v_second->>'id' OR COALESCE((v_second->>'reused')::BOOLEAN,FALSE)=FALSE THEN
    RAISE EXCEPTION 'FALHA 2a: retry criou outra demonstração';
  END IF;
  SELECT public.get_onboarding_contexto() INTO v_context;
  IF (v_context #>> '{evidence,total_imoveis_reais}')::INT <> 0 THEN
    RAISE EXCEPTION 'FALHA 2b: demonstração entrou no indicador real';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 2: demonstração idempotente e fora dos indicadores';
END $$;

-- 3. Cliente + imóvel + oportunidade + tarefa real atingem primeiro valor e
-- a tarefa nasce na Central de Rotina com responsável e lembrete.
DO $$
DECLARE v_context JSONB; v_task UUID; v_org UUID := (SELECT value::UUID FROM onboarding_test_state WHERE key='owner_org');
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","email":"onboarding-owner@teste.local"}', TRUE);
  PERFORM public.onboarding_executar_acao('first_property', jsonb_build_object(
    'titulo','Imóvel real','cidade','São Paulo','valor',650000
  ));
  PERFORM public.onboarding_executar_acao('first_client', jsonb_build_object(
    'nome','Cliente real','telefone','11912345678'
  ));
  PERFORM public.onboarding_executar_acao('first_deal', jsonb_build_object(
    'titulo','Negociação real','valor_estimado',650000
  ));
  SELECT (public.onboarding_executar_acao('first_task', jsonb_build_object(
    'titulo','Follow-up real','tipo','WHATSAPP','data_prevista',now()+INTERVAL '1 day',
    'frequencia','semanal','lembrete_minutos',15
  ))->>'id')::UUID INTO v_task;

  IF NOT EXISTS (SELECT 1 FROM public.routine_tasks WHERE id=v_task AND organization_id=v_org AND recurrence_rule='FREQ=WEEKLY' AND NOT is_sample_data) THEN
    RAISE EXCEPTION 'FALHA 3a: follow-up não entrou na Rotina real';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.routine_reminders WHERE task_id=v_task AND minutes_before=15) THEN
    RAISE EXCEPTION 'FALHA 3b: lembrete não foi criado';
  END IF;
  SELECT public.get_onboarding_contexto() INTO v_context;
  IF (v_context #>> '{evidence,total_oportunidades_reais}')::INT <> 1
     OR (v_context #>> '{evidence,total_tarefas_reais}')::INT <> 1 THEN
    RAISE EXCEPTION 'FALHA 3c: evidências reais não reconheceram ações operacionais';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.onboarding_progress pr JOIN public.onboarding_profiles op ON op.id=pr.profile_id
     WHERE op.user_id='b1111111-1111-4111-8111-111111111111' AND pr.first_value_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'FALHA 3d: primeiro valor não foi marcado'; END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 3: primeiro valor usa CRM + Central de Rotina reais';
END $$;

-- 4. Convite exige gestor, valida o e-mail e troca o tenant legado do membro.
DO $$
DECLARE v_result JSONB;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","email":"onboarding-owner@teste.local"}', TRUE);
  SELECT public.criar_convite_organizacao('onboarding-invited@teste.local','corretor') INTO v_result;
  INSERT INTO onboarding_test_state VALUES ('invite_token',v_result->>'token');
  RESET ROLE;
END $$;

DO $$
DECLARE v_owner_tenant UUID; v_member_tenant UUID;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated","email":"onboarding-invited@teste.local"}', TRUE);
  PERFORM public.aceitar_convite_organizacao((SELECT value FROM onboarding_test_state WHERE key='invite_token'));
  SELECT public.get_corretor_id() INTO v_member_tenant;
  RESET ROLE;
  SELECT legacy_corretor_id INTO v_owner_tenant FROM public.routine_organizations
   WHERE id=(SELECT value::UUID FROM onboarding_test_state WHERE key='owner_org');
  IF v_member_tenant <> v_owner_tenant THEN RAISE EXCEPTION 'FALHA 4: convidado não passou a compartilhar o tenant'; END IF;
  RAISE NOTICE 'OK 4: convite explícito compartilha a organização existente';
END $$;

-- 5. Analytics remove PII mesmo quando o cliente tenta enviá-la.
DO $$
DECLARE v_metadata JSONB;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","email":"onboarding-owner@teste.local"}', TRUE);
  PERFORM public.registrar_onboarding_evento(
    'onboarding_abandoned','teste','onboarding',
    '{"email":"nao-gravar@teste.local","telefone":"11999999999","step":"teste"}'::JSONB
  );
  SELECT metadata INTO v_metadata FROM public.onboarding_events
   WHERE user_id='b1111111-1111-4111-8111-111111111111' AND event_name='onboarding_abandoned'
   ORDER BY criado_em DESC LIMIT 1;
  IF v_metadata ? 'email' OR v_metadata ? 'telefone' OR v_metadata->>'step' <> 'teste' THEN
    RAISE EXCEPTION 'FALHA 5: sanitização de analytics incorreta: %',v_metadata;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 5: analytics preserva evento e descarta PII';
END $$;

-- 6. Remover demonstração preserva tudo que é real.
DO $$
DECLARE v_context JSONB;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', '{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated","email":"onboarding-owner@teste.local"}', TRUE);
  PERFORM public.onboarding_executar_acao('remove_samples','{}'::JSONB);
  SELECT public.get_onboarding_contexto() INTO v_context;
  IF (v_context #>> '{evidence,total_imoveis_reais}')::INT <> 1
     OR EXISTS (SELECT 1 FROM public.onboarding_sample_data WHERE user_id='b1111111-1111-4111-8111-111111111111') THEN
    RAISE EXCEPTION 'FALHA 6: remoção demo afetou dado real ou deixou rastros';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'OK 6: demonstração removível sem tocar nos dados reais';
END $$;

ROLLBACK;
