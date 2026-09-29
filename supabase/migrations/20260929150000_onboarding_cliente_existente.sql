begin;

-- Same as 20260821130000, plus: the first-client step reuses the client that
-- already has the phone instead of failing on duplicate_client_phone.
CREATE OR REPLACE FUNCTION public.onboarding_executar_acao(p_action TEXT, p_payload JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_profile public.onboarding_profiles%ROWTYPE;
    v_progress public.onboarding_progress%ROWTYPE;
    v_corretor UUID;
    v_id UUID;
    v_cliente UUID;
    v_dup_detail TEXT;
    v_imovel UUID;
    v_oportunidade UUID;
    v_etapa UUID;
    v_sample BOOLEAN := COALESCE((p_payload->>'is_sample_data')::BOOLEAN,FALSE);
    v_base_action TEXT;
    v_existing TEXT;
    v_first_value BOOLEAN := FALSE;
    v_due TIMESTAMPTZ;
    v_assigned UUID;
    v_reminder INTEGER;
BEGIN
    SELECT * INTO v_profile FROM public.onboarding_profiles WHERE user_id=auth.uid();
    IF v_profile.id IS NULL THEN RAISE EXCEPTION 'onboarding não encontrado'; END IF;
    SELECT * INTO v_progress FROM public.onboarding_progress WHERE profile_id=v_profile.id FOR UPDATE;
    v_corretor := public.get_corretor_id();
    IF v_corretor IS NULL THEN RAISE EXCEPTION 'organização indisponível'; END IF;
    v_sample := v_sample OR p_action LIKE 'sample_%';
    v_base_action := CASE
        WHEN p_action LIKE 'sample_%' THEN replace(p_action,'sample_','first_')
        ELSE p_action
    END;

    v_existing := v_progress.metadata #>> ARRAY['action_ids',p_action];
    IF v_existing IS NOT NULL AND p_action <> 'remove_samples' THEN
        RETURN jsonb_build_object('id',v_existing::UUID,'reused',TRUE);
    END IF;

    IF v_base_action = 'first_property' THEN
        IF NULLIF(BTRIM(p_payload->>'titulo'),'') IS NULL OR NULLIF(BTRIM(p_payload->>'cidade'),'') IS NULL
           OR COALESCE((p_payload->>'valor')::NUMERIC,0) <= 0 THEN
            RAISE EXCEPTION 'título, cidade e valor são obrigatórios';
        END IF;
        INSERT INTO public.imoveis
            (corretor_id,titulo,tipo,finalidade,valor,endereco,bairro,cidade,estado,
             proprietario_nome,ativo,is_sample_data,tracking_data)
        VALUES
            (v_corretor,BTRIM(p_payload->>'titulo'),
             CASE WHEN p_payload->>'tipo' IN ('APARTAMENTO','CASA','COMERCIAL','TERRENO')
                  THEN (p_payload->>'tipo')::public.tipo_imovel ELSE 'CASA'::public.tipo_imovel END,
             CASE WHEN p_payload->>'finalidade' IN ('VENDA','ALUGUEL')
                  THEN (p_payload->>'finalidade')::public.finalidade_imovel ELSE 'VENDA'::public.finalidade_imovel END,
             (p_payload->>'valor')::NUMERIC,
             COALESCE(NULLIF(BTRIM(p_payload->>'endereco'),''),'Endereço a completar'),
             NULLIF(BTRIM(p_payload->>'bairro'),''),BTRIM(p_payload->>'cidade'),
             COALESCE(NULLIF(BTRIM(p_payload->>'estado'),''),'SP'),
             'A informar',TRUE,v_sample,
             jsonb_build_object('origem','onboarding','is_sample_data',v_sample))
        RETURNING id INTO v_id;

    ELSIF v_base_action = 'first_client' THEN
        IF NULLIF(BTRIM(p_payload->>'nome'),'') IS NULL
           OR (NULLIF(BTRIM(p_payload->>'telefone'),'') IS NULL AND NULLIF(BTRIM(p_payload->>'email'),'') IS NULL) THEN
            RAISE EXCEPTION 'nome e telefone ou e-mail são obrigatórios';
        END IF;
        BEGIN
            INSERT INTO public.clientes
                (corretor_id,nome,telefone,email,tipo_interesse,status_funil,observacoes,
                 is_sample_data,tracking_data)
            VALUES
                (v_corretor,BTRIM(p_payload->>'nome'),COALESCE(BTRIM(p_payload->>'telefone'),''),
                 NULLIF(BTRIM(p_payload->>'email'),''),
                 CASE WHEN p_payload->>'tipo_interesse' IN ('COMPRA','LOCACAO','AMBOS')
                      THEN (p_payload->>'tipo_interesse')::public.tipo_interesse ELSE 'COMPRA'::public.tipo_interesse END,
                 'QUALIFICACAO'::public.status_funil,
                 concat_ws(' · ',NULLIF(p_payload->>'regiao',''),NULLIF(p_payload->>'faixa_preco','')),
                 v_sample,
                 jsonb_build_object('origem',COALESCE(NULLIF(p_payload->>'origem',''),'onboarding'),'is_sample_data',v_sample))
            RETURNING id INTO v_id;
        EXCEPTION WHEN raise_exception THEN
            -- The phone is already a client of the account (e.g. created by WhatsApp):
            -- the step uses that client instead of failing.
            GET STACKED DIAGNOSTICS v_dup_detail = PG_EXCEPTION_DETAIL;
            IF SQLERRM <> 'duplicate_client_phone' THEN RAISE; END IF;
            v_id := v_dup_detail::UUID;
        END;

    ELSIF v_base_action = 'first_deal' THEN
        v_cliente := COALESCE(NULLIF(p_payload->>'cliente_id','')::UUID,
                              NULLIF(v_progress.metadata #>> ARRAY['action_ids',CASE WHEN v_sample THEN 'sample_client' ELSE 'first_client' END],'')::UUID);
        v_imovel := COALESCE(NULLIF(p_payload->>'imovel_id','')::UUID,
                             NULLIF(v_progress.metadata #>> ARRAY['action_ids',CASE WHEN v_sample THEN 'sample_property' ELSE 'first_property' END],'')::UUID);
        IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id=v_cliente AND corretor_id=v_corretor) THEN
            RAISE EXCEPTION 'cliente inválido';
        END IF;
        IF v_imovel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.imoveis WHERE id=v_imovel AND corretor_id=v_corretor) THEN
            RAISE EXCEPTION 'imóvel inválido';
        END IF;
        SELECT id INTO v_etapa FROM public.crm_etapas
         WHERE corretor_id=v_corretor AND ativo ORDER BY ordem LIMIT 1;
        IF v_etapa IS NULL THEN RAISE EXCEPTION 'pipeline não configurado'; END IF;
        INSERT INTO public.crm_oportunidades
            (corretor_id,cliente_id,imovel_id,etapa_id,titulo,valor_estimado,origem,is_sample_data)
        VALUES
            (v_corretor,v_cliente,v_imovel,v_etapa,
             COALESCE(NULLIF(BTRIM(p_payload->>'titulo'),''),'Primeira oportunidade'),
             COALESCE((p_payload->>'valor_estimado')::NUMERIC,0),'onboarding',v_sample)
        RETURNING id INTO v_id;
        IF v_imovel IS NOT NULL THEN
            INSERT INTO public.cliente_imovel (cliente_id,imovel_id)
            VALUES (v_cliente,v_imovel) ON CONFLICT (cliente_id,imovel_id) DO NOTHING;
        END IF;

    ELSIF v_base_action = 'first_task' THEN
        v_cliente := COALESCE(NULLIF(p_payload->>'cliente_id','')::UUID,
                              NULLIF(v_progress.metadata #>> ARRAY['action_ids',CASE WHEN v_sample THEN 'sample_client' ELSE 'first_client' END],'')::UUID);
        v_oportunidade := COALESCE(NULLIF(p_payload->>'oportunidade_id','')::UUID,
                                   NULLIF(v_progress.metadata #>> ARRAY['action_ids',CASE WHEN v_sample THEN 'sample_deal' ELSE 'first_deal' END],'')::UUID);
        IF v_cliente IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id=v_cliente AND corretor_id=v_corretor) THEN
            RAISE EXCEPTION 'cliente inválido';
        END IF;
        v_due := COALESCE(NULLIF(p_payload->>'data_prevista','')::TIMESTAMPTZ,now()+INTERVAL '1 day');
        v_assigned := COALESCE(NULLIF(p_payload->>'responsavel_id','')::UUID,auth.uid());
        v_reminder := LEAST(GREATEST(COALESCE((p_payload->>'lembrete_minutos')::INTEGER,0),0),525600);
        IF NOT EXISTS (
            SELECT 1 FROM public.routine_memberships
             WHERE organization_id=v_profile.organization_id AND user_id=v_assigned AND status='active'
        ) THEN RAISE EXCEPTION 'responsável inválido'; END IF;
        INSERT INTO public.routine_tasks
            (organization_id,assigned_to,created_by,title,description,activity_type,due_at,
             timezone,recurrence_rule,source,client_id,deal_id,is_sample_data)
        VALUES
            (v_profile.organization_id,v_assigned,auth.uid(),
             COALESCE(NULLIF(BTRIM(p_payload->>'titulo'),''),'Fazer follow-up'),
             NULLIF(BTRIM(p_payload->>'descricao'),''),
             CASE p_payload->>'tipo'
                  WHEN 'LIGACAO' THEN 'ligacao'
                  WHEN 'WHATSAPP' THEN 'whatsapp'
                  WHEN 'EMAIL' THEN 'email'
                  WHEN 'REUNIAO' THEN 'reuniao'
                  WHEN 'VISITA' THEN 'visita_imovel'
                  WHEN 'PROPOSTA' THEN 'proposta'
                  ELSE 'tarefa_administrativa' END,
             v_due,
             COALESCE(NULLIF(p_payload->>'timezone',''),'America/Sao_Paulo'),
             CASE p_payload->>'frequencia'
                  WHEN 'diaria' THEN 'FREQ=DAILY'
                  WHEN 'semanal' THEN 'FREQ=WEEKLY'
                  WHEN 'mensal' THEN 'FREQ=MONTHLY'
                  ELSE NULL END,
             'lotti',v_cliente,v_oportunidade,v_sample)
        RETURNING id INTO v_id;
        IF v_reminder > 0 AND NOT v_sample THEN
            INSERT INTO public.routine_reminders
                (organization_id,user_id,task_id,remind_at,minutes_before,channel)
            VALUES (
                v_profile.organization_id,
                v_assigned,
                v_id,
                GREATEST(now(),v_due-make_interval(mins=>v_reminder)),
                v_reminder,
                'in_app'
            );
        END IF;
        IF v_cliente IS NOT NULL THEN
            UPDATE public.clientes SET proximo_followup=(SELECT due_at FROM public.routine_tasks WHERE id=v_id)
             WHERE id=v_cliente AND corretor_id=v_corretor;
        END IF;

    ELSIF p_action = 'remove_samples' THEN
        DELETE FROM public.routine_tasks WHERE organization_id=v_profile.organization_id AND is_sample_data;
        DELETE FROM public.crm_tarefas WHERE corretor_id=v_corretor AND is_sample_data;
        DELETE FROM public.crm_oportunidades WHERE corretor_id=v_corretor AND is_sample_data;
        DELETE FROM public.clientes WHERE corretor_id=v_corretor AND is_sample_data;
        DELETE FROM public.imoveis WHERE corretor_id=v_corretor AND is_sample_data;
        DELETE FROM public.onboarding_sample_data WHERE organization_id=v_profile.organization_id;
        UPDATE public.onboarding_progress SET
            metadata = jsonb_set(metadata,'{action_ids}',COALESCE(metadata->'action_ids','{}'::JSONB) -
                       ARRAY['sample_property','sample_client','sample_deal','sample_task'],TRUE)
         WHERE id=v_progress.id;
        RETURN jsonb_build_object('removed',TRUE);
    ELSE
        RAISE EXCEPTION 'ação de onboarding inválida';
    END IF;

    UPDATE public.onboarding_progress SET
        metadata=jsonb_set(
            metadata,
            '{action_ids}',
            COALESCE(metadata->'action_ids','{}'::JSONB) || jsonb_build_object(p_action,v_id::TEXT),
            TRUE
        ),
        last_activity_at=now()
     WHERE id=v_progress.id;

    IF v_sample THEN
        INSERT INTO public.onboarding_sample_data
            (organization_id,user_id,entity_type,entity_id)
        VALUES (v_profile.organization_id,auth.uid(),
                CASE v_base_action WHEN 'first_property' THEN 'imovel' WHEN 'first_client' THEN 'cliente'
                                   WHEN 'first_deal' THEN 'oportunidade' ELSE 'tarefa' END,v_id)
        ON CONFLICT DO NOTHING;
    END IF;

    IF NOT v_sample THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
        VALUES (
            v_profile.organization_id,
            auth.uid(),
            v_profile.id,
            CASE v_base_action
                WHEN 'first_property' THEN 'first_property_created'
                WHEN 'first_client' THEN 'first_client_created'
                WHEN 'first_deal' THEN 'first_deal_created'
                ELSE 'first_task_created'
            END,
            p_action,
            'onboarding',
            '{}'::JSONB
        ) ON CONFLICT DO NOTHING;

        UPDATE public.onboarding_progress SET first_value_at=now()
         WHERE id=v_progress.id AND first_value_at IS NULL
           AND EXISTS (SELECT 1 FROM public.imoveis WHERE corretor_id=v_corretor AND NOT is_sample_data)
           AND EXISTS (SELECT 1 FROM public.clientes WHERE corretor_id=v_corretor AND NOT is_sample_data)
           AND EXISTS (SELECT 1 FROM public.crm_oportunidades WHERE corretor_id=v_corretor AND NOT is_sample_data)
           AND EXISTS (SELECT 1 FROM public.routine_tasks
                        WHERE organization_id=v_profile.organization_id AND deleted_at IS NULL AND NOT is_sample_data)
        RETURNING TRUE INTO v_first_value;

        IF v_first_value THEN
            INSERT INTO public.onboarding_events
                (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
            VALUES
                (v_profile.organization_id,auth.uid(),v_profile.id,'first_value_reached',p_action,'onboarding','{}'::JSONB)
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN jsonb_build_object('id',v_id,'reused',FALSE);
END $$;

GRANT EXECUTE ON FUNCTION public.onboarding_executar_acao(TEXT,JSONB) TO authenticated;

commit;
