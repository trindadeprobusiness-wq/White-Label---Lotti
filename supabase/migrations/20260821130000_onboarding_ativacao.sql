-- ---------------------------------------------------------------------------
-- Onboarding orientado à ativação sobre a organização/equipe da Rotina.
--
-- O legado usa corretor_id como tenant. `routine_organizations.legacy_corretor_id`
-- mantém esse contrato: donos e convidados continuam lendo/escrevendo nas
-- tabelas existentes, enquanto cada pessoa preserva o próprio perfil.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 1. Complementos da organização existente + convites ──────────────────
-- A Central de Rotina é a fonte única de verdade para organização e membros.
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS trade_name TEXT;
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS state CHAR(2);
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS team_size TEXT;
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS operation_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE public.routine_organizations ADD COLUMN IF NOT EXISTS organization_type TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE public.routine_memberships ADD COLUMN IF NOT EXISTS job_role TEXT;

DO $$ BEGIN
    ALTER TABLE public.routine_organizations ADD CONSTRAINT chk_routine_organization_type
        CHECK (organization_type IN ('individual','imobiliaria','construtora_loteadora'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.organizacao_convites (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    email               TEXT NOT NULL,
    papel               TEXT NOT NULL DEFAULT 'corretor'
                        CHECK (papel IN ('gestor','corretor','financeiro','juridico','locacoes','marketing','suporte')),
    token_hash          TEXT NOT NULL UNIQUE,
    status              TEXT NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente','aceito','revogado','expirado')),
    expira_em           TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
    criado_por          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    aceito_por          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    aceito_em           TIMESTAMPTZ,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_convite_pendente_org_email
    ON public.organizacao_convites (organization_id, lower(email))
    WHERE status = 'pendente';

-- Colunas profissionais que hoje só cabiam implicitamente em preferências.
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS estado CHAR(2);
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS tipo_atuacao TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS regioes_atendidas TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS especialidade TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS fuso_horario TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS creci_status TEXT NOT NULL DEFAULT 'nao_informado';

DO $$ BEGIN
    ALTER TABLE public.corretores ADD CONSTRAINT chk_corretores_creci_status
        CHECK (creci_status IN ('nao_informado','informado','aguardando_validacao','validado','rejeitado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Estruturas do onboarding ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_profiles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    persona              TEXT CHECK (persona IN ('corretor_autonomo','gestor_imobiliaria','usuario_convidado','profissional_administrativo')),
    primary_goal         TEXT CHECK (primary_goal IN ('meus_leads','meus_imoveis','meu_funil','minha_rotina','minhas_locacoes','meus_contratos','minha_equipe','todo_negocio')),
    data_entry_strategy  TEXT CHECK (data_entry_strategy IN ('manual','importacao','demonstracao','depois')),
    creci_status         TEXT NOT NULL DEFAULT 'nao_informado'
                         CHECK (creci_status IN ('nao_informado','informado','aguardando_validacao','validado','rejeitado')),
    metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_progress (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id           UUID NOT NULL UNIQUE REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE,
    current_step         TEXT NOT NULL DEFAULT 'boas_vindas',
    completed_steps      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    skipped_steps        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ,
    last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    dismissed_at         TIMESTAMPTZ,
    first_value_at       TIMESTAMPTZ,
    onboarding_version   INTEGER NOT NULL DEFAULT 1,
    metadata             JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS public.onboarding_steps (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id           UUID NOT NULL REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE,
    step_key             TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'iniciado'
                         CHECK (status IN ('iniciado','concluido','pulado','erro')),
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ,
    metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
    UNIQUE (profile_id, step_key)
);

CREATE TABLE IF NOT EXISTS public.onboarding_events (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id      UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_id           UUID REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE,
    event_name           TEXT NOT NULL,
    step_key             TEXT,
    source               TEXT NOT NULL DEFAULT 'onboarding',
    metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_org_data
    ON public.onboarding_events (organization_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_nome_data
    ON public.onboarding_events (event_name, criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_evento_marco
    ON public.onboarding_events (profile_id, event_name)
    WHERE event_name IN (
        'signup_completed','onboarding_started','persona_selected','organization_created',
        'profile_completed','first_property_created','first_client_created','first_deal_created',
        'first_task_created','calendar_connected','team_member_invited','ai_first_used',
        'onboarding_completed','first_value_reached'
    );

CREATE TABLE IF NOT EXISTS public.onboarding_preferences (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id           UUID NOT NULL UNIQUE REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE,
    tips_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    assistant_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    preferred_shortcuts  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
    atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_checklist (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id           UUID NOT NULL UNIQUE REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE,
    minimized            BOOLEAN NOT NULL DEFAULT FALSE,
    dismissed_at         TIMESTAMPTZ,
    metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
    atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_tours (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id           UUID NOT NULL REFERENCES public.onboarding_profiles(id) ON DELETE CASCADE,
    tour_key             TEXT NOT NULL,
    current_step         INTEGER NOT NULL DEFAULT 0,
    completed_at         TIMESTAMPTZ,
    dismissed_at         TIMESTAMPTZ,
    atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_id, tour_key)
);

CREATE TABLE IF NOT EXISTS public.onboarding_sample_data (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_type          TEXT NOT NULL CHECK (entity_type IN ('imovel','cliente','oportunidade','tarefa')),
    entity_id            UUID NOT NULL,
    metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, entity_type, entity_id)
);

-- Demonstração fica identificável e pode ser excluída/ignorada pelos relatórios.
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS is_sample_data BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS is_sample_data BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.crm_oportunidades ADD COLUMN IF NOT EXISTS is_sample_data BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.crm_tarefas ADD COLUMN IF NOT EXISTS is_sample_data BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.routine_tasks ADD COLUMN IF NOT EXISTS is_sample_data BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. Funções de escopo ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_organization_member(_organization_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT private.routine_is_member(_organization_id)
$$;

CREATE OR REPLACE FUNCTION public.is_organization_manager(_organization_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT private.routine_member_has_role(
        _organization_id,
        ARRAY['proprietario','administrador','gestor']
    )
$$;

-- Mantém o contrato legado: todas as policies existentes continuam comparando
-- corretor_id, mas agora o id retornado é o tenant da organização ativa.
CREATE OR REPLACE FUNCTION public.get_corretor_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT o.legacy_corretor_id
      FROM public.routine_memberships m
      JOIN public.routine_organizations o ON o.id = m.organization_id
     WHERE m.user_id = auth.uid() AND m.status = 'active'
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.is_organization_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_organization_manager(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_corretor_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_organization_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_organization_manager(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_corretor_id() TO authenticated;

-- ── 4. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.organizacao_convites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_sample_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "convites: gestor le" ON public.organizacao_convites
    FOR SELECT TO authenticated USING (public.is_organization_manager(organization_id));

CREATE POLICY "onboarding_profile: proprio" ON public.onboarding_profiles
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "onboarding_progress: proprio" ON public.onboarding_progress
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    );
CREATE POLICY "onboarding_steps: proprio" ON public.onboarding_steps
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    );
CREATE POLICY "onboarding_preferences: proprio" ON public.onboarding_preferences
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    );
CREATE POLICY "onboarding_checklist: proprio" ON public.onboarding_checklist
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    );
CREATE POLICY "onboarding_tours: proprio" ON public.onboarding_tours
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.onboarding_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid())
    );
CREATE POLICY "onboarding_events: proprio ou admin" ON public.onboarding_events
    FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "sample_data: membro le" ON public.onboarding_sample_data
    FOR SELECT TO authenticated USING (public.is_organization_member(organization_id));

GRANT SELECT ON public.organizacao_convites, public.onboarding_events,
    public.onboarding_sample_data TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_profiles,
    public.onboarding_progress, public.onboarding_steps, public.onboarding_preferences,
    public.onboarding_checklist, public.onboarding_tours TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organizacao_convites,
    public.onboarding_events, public.onboarding_sample_data FROM anon, authenticated;

-- Assinatura e cotas passam a seguir o tenant da organização, não só o perfil.
DROP POLICY IF EXISTS "subscriptions_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_org_read" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_org_manage" ON public.subscriptions;
CREATE POLICY "subscriptions_org_read" ON public.subscriptions FOR SELECT TO authenticated
    USING (corretor_id = public.get_corretor_id());
CREATE POLICY "subscriptions_org_manage" ON public.subscriptions FOR ALL TO authenticated
    USING (
        corretor_id = public.get_corretor_id()
        AND EXISTS (SELECT 1 FROM public.routine_organizations o
                     WHERE o.legacy_corretor_id=corretor_id AND public.is_organization_manager(o.id))
    )
    WITH CHECK (
        corretor_id = public.get_corretor_id()
        AND EXISTS (SELECT 1 FROM public.routine_organizations o
                     WHERE o.legacy_corretor_id=corretor_id AND public.is_organization_manager(o.id))
    );
DROP POLICY IF EXISTS "usage_own" ON public.usage_counters;
CREATE POLICY "usage_own" ON public.usage_counters FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());
DROP POLICY IF EXISTS "addons_own" ON public.subscription_addons;
DROP POLICY IF EXISTS "addons_org_read" ON public.subscription_addons;
DROP POLICY IF EXISTS "addons_org_manage" ON public.subscription_addons;
CREATE POLICY "addons_org_read" ON public.subscription_addons FOR SELECT TO authenticated
    USING (corretor_id = public.get_corretor_id());
CREATE POLICY "addons_org_manage" ON public.subscription_addons FOR ALL TO authenticated
    USING (
        corretor_id = public.get_corretor_id()
        AND EXISTS (SELECT 1 FROM public.routine_organizations o
                     WHERE o.legacy_corretor_id=corretor_id AND public.is_organization_manager(o.id))
    )
    WITH CHECK (
        corretor_id = public.get_corretor_id()
        AND EXISTS (SELECT 1 FROM public.routine_organizations o
                     WHERE o.legacy_corretor_id=corretor_id AND public.is_organization_manager(o.id))
    );

-- ── 5. Bootstrap idempotente ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bootstrap_onboarding_corretor(_corretor_id UUID, _legacy BOOLEAN DEFAULT FALSE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_corretor public.corretores%ROWTYPE;
    v_org UUID;
    v_profile UUID;
BEGIN
    SELECT * INTO v_corretor FROM public.corretores WHERE id = _corretor_id;
    IF v_corretor.id IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.routine_organizations
        (legacy_corretor_id, name, trade_name, cnpj, phone, email, organization_type)
    VALUES
        (v_corretor.id, COALESCE(NULLIF(v_corretor.razao_social,''), v_corretor.nome),
         v_corretor.nome, v_corretor.cnpj_cpf, v_corretor.telefone, v_corretor.email, 'individual')
    ON CONFLICT (legacy_corretor_id) DO UPDATE SET
        name=EXCLUDED.name,
        trade_name=COALESCE(public.routine_organizations.trade_name,EXCLUDED.trade_name),
        cnpj=COALESCE(public.routine_organizations.cnpj,EXCLUDED.cnpj),
        phone=COALESCE(public.routine_organizations.phone,EXCLUDED.phone),
        email=COALESCE(public.routine_organizations.email,EXCLUDED.email),
        updated_at=now()
    RETURNING id INTO v_org;

    INSERT INTO public.routine_memberships
        (organization_id, user_id, role, status, display_name)
    VALUES (v_org, v_corretor.user_id, 'proprietario', 'active', v_corretor.nome)
    ON CONFLICT (organization_id, user_id) DO UPDATE
        SET status = 'active', role = 'proprietario', display_name = EXCLUDED.display_name, updated_at = now();

    INSERT INTO public.onboarding_profiles
        (organization_id, user_id, persona, creci_status, metadata)
    VALUES
        (v_org, v_corretor.user_id, CASE WHEN _legacy THEN 'corretor_autonomo' END,
         COALESCE(v_corretor.creci_status, 'nao_informado'),
         CASE WHEN _legacy THEN '{"legacy_account":true}'::JSONB ELSE '{}'::JSONB END)
    ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
    RETURNING id INTO v_profile;

    INSERT INTO public.onboarding_progress
        (profile_id, current_step, completed_steps, completed_at, onboarding_version, metadata)
    VALUES
        (v_profile,
         CASE WHEN _legacy THEN 'conclusao' ELSE 'boas_vindas' END,
         CASE WHEN _legacy THEN ARRAY['legacy_account']::TEXT[] ELSE ARRAY[]::TEXT[] END,
         CASE WHEN _legacy THEN now() END,
         1,
         CASE WHEN _legacy THEN '{"migration":"existing_user"}'::JSONB ELSE '{}'::JSONB END)
    ON CONFLICT (profile_id) DO NOTHING;

    INSERT INTO public.onboarding_preferences (profile_id) VALUES (v_profile)
    ON CONFLICT (profile_id) DO NOTHING;
    INSERT INTO public.onboarding_checklist (profile_id) VALUES (v_profile)
    ON CONFLICT (profile_id) DO NOTHING;

    IF NOT _legacy AND NOT EXISTS (
        SELECT 1 FROM public.onboarding_events
         WHERE profile_id = v_profile AND event_name = 'signup_completed'
    ) THEN
        INSERT INTO public.onboarding_events
            (organization_id, user_id, profile_id, event_name, source, metadata)
        VALUES (v_org, v_corretor.user_id, v_profile, 'signup_completed', 'auth', '{}'::JSONB)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_profile;
END $$;

-- Contas anteriores ao recurso não são sequestradas pelo wizard.
SELECT public.bootstrap_onboarding_corretor(id, TRUE) FROM public.corretores;

CREATE OR REPLACE FUNCTION public.trg_bootstrap_onboarding_corretor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.bootstrap_onboarding_corretor(NEW.id, FALSE);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bootstrap_onboarding ON public.corretores;
CREATE TRIGGER trg_bootstrap_onboarding
    AFTER INSERT ON public.corretores FOR EACH ROW
    EXECUTE FUNCTION public.trg_bootstrap_onboarding_corretor();

-- ── 6. Contexto único para gate, wizard e checklist ───────────────────────
CREATE OR REPLACE FUNCTION public.get_onboarding_contexto()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_profile public.onboarding_profiles%ROWTYPE;
    v_progress public.onboarding_progress%ROWTYPE;
    v_org public.routine_organizations%ROWTYPE;
    v_corretor public.corretores%ROWTYPE;
    v_owner UUID;
    v_result JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RETURN NULL; END IF;

    SELECT * INTO v_profile FROM public.onboarding_profiles WHERE user_id = auth.uid();
    IF v_profile.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_progress FROM public.onboarding_progress WHERE profile_id = v_profile.id;
    SELECT * INTO v_org FROM public.routine_organizations WHERE id = v_profile.organization_id;
    SELECT * INTO v_corretor FROM public.corretores WHERE user_id = auth.uid();
    v_owner := v_org.legacy_corretor_id;

    SELECT jsonb_build_object(
        'profile', to_jsonb(v_profile),
        'progress', to_jsonb(v_progress),
        'organization', jsonb_build_object(
            'id', v_org.id,
            'nome', v_org.name,
            'nome_comercial', v_org.trade_name,
            'tipo_organizacao', v_org.organization_type,
            'fuso_horario', v_org.timezone
        ),
        'membership', COALESCE((SELECT jsonb_build_object(
                                      'papel',COALESCE(m.job_role,m.role),
                                      'status',m.status,
                                      'user_id',m.user_id
                                  )
                                  FROM public.routine_memberships m
                                 WHERE m.organization_id = v_org.id AND m.user_id = auth.uid()
                                   AND m.status = 'active'), '{}'::JSONB),
        'members', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'user_id',m.user_id,
                'nome',COALESCE(NULLIF(m.display_name,''),'Membro da equipe'),
                'papel',COALESCE(m.job_role,m.role)
            ) ORDER BY m.display_name)
              FROM public.routine_memberships m
             WHERE m.organization_id=v_org.id AND m.status='active'
        ), '[]'::JSONB),
        'checklist', COALESCE((SELECT to_jsonb(c) FROM public.onboarding_checklist c
                               WHERE c.profile_id = v_profile.id), '{}'::JSONB),
        'tours', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.onboarding_tours t
                           WHERE t.profile_id = v_profile.id), '[]'::JSONB),
        'subscription', COALESCE((
            SELECT jsonb_build_object('status', s.status, 'trial_ends_at', s.trial_ends_at,
                                      'plan_name', p.name, 'plan_code', p.code)
              FROM public.subscriptions s JOIN public.plans p ON p.id = s.plan_id
             WHERE s.corretor_id = v_owner
               AND s.status IN ('trialing','active','past_due','read_only') LIMIT 1
        ), '{}'::JSONB),
        'evidence', jsonb_build_object(
            'perfil_completo', (
                NULLIF(BTRIM(v_corretor.nome),'') IS NOT NULL
                AND NULLIF(BTRIM(v_corretor.telefone),'') IS NOT NULL
                AND NULLIF(BTRIM(COALESCE(v_corretor.cidade,'')),'') IS NOT NULL
            ),
            'total_imoveis_reais', (SELECT count(*) FROM public.imoveis WHERE corretor_id = v_owner AND NOT is_sample_data),
            'total_clientes_reais', (SELECT count(*) FROM public.clientes WHERE corretor_id = v_owner AND NOT is_sample_data),
            'total_oportunidades_reais', (SELECT count(*) FROM public.crm_oportunidades WHERE corretor_id = v_owner AND NOT is_sample_data),
            'total_tarefas_reais', (SELECT count(*) FROM public.routine_tasks
                                     WHERE organization_id = v_org.id AND deleted_at IS NULL AND NOT is_sample_data),
            'total_imoveis_demo', (SELECT count(*) FROM public.imoveis WHERE corretor_id = v_owner AND is_sample_data),
            'total_clientes_demo', (SELECT count(*) FROM public.clientes WHERE corretor_id = v_owner AND is_sample_data),
            'total_registros_demo', (SELECT count(*) FROM public.onboarding_sample_data
                                      WHERE organization_id=v_org.id),
            'calendario_conectado', EXISTS (
                SELECT 1 FROM public.calendar_connections cc
                 WHERE cc.organization_id = v_org.id AND cc.user_id = auth.uid()
                   AND cc.status = 'connected'
            ),
            'whatsapp_configurado', COALESCE((v_profile.metadata #>> '{integrations,whatsapp}')::BOOLEAN, FALSE),
            'total_convites', (SELECT count(*) FROM public.organizacao_convites WHERE organization_id = v_org.id AND status IN ('pendente','aceito')),
            'ia_usada', EXISTS (SELECT 1 FROM public.ai_conversations WHERE corretor_id = v_owner)
        )
    ) INTO v_result;

    RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.get_onboarding_contexto() TO authenticated;

-- ── 7. Persistência e analytics sem PII ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.salvar_onboarding(
    p_profile JSONB DEFAULT '{}'::JSONB,
    p_progress JSONB DEFAULT '{}'::JSONB,
    p_step_key TEXT DEFAULT NULL,
    p_step_status TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_profile public.onboarding_profiles%ROWTYPE;
    v_progress public.onboarding_progress%ROWTYPE;
BEGIN
    SELECT * INTO v_profile FROM public.onboarding_profiles WHERE user_id = auth.uid();
    IF v_profile.id IS NULL THEN RAISE EXCEPTION 'perfil de onboarding não encontrado'; END IF;
    SELECT * INTO v_progress FROM public.onboarding_progress WHERE profile_id = v_profile.id FOR UPDATE;

    UPDATE public.onboarding_profiles SET
        persona = COALESCE(NULLIF(p_profile->>'persona',''), persona),
        primary_goal = COALESCE(NULLIF(p_profile->>'primary_goal',''), primary_goal),
        data_entry_strategy = COALESCE(NULLIF(p_profile->>'data_entry_strategy',''), data_entry_strategy),
        creci_status = COALESCE(NULLIF(p_profile->>'creci_status',''), creci_status),
        metadata = metadata || COALESCE(p_profile->'metadata', '{}'::JSONB),
        atualizado_em = now()
    WHERE id = v_profile.id;

    UPDATE public.onboarding_progress SET
        current_step = COALESCE(NULLIF(p_progress->>'current_step',''), current_step),
        completed_steps = CASE WHEN p_progress ? 'completed_steps'
            THEN ARRAY(SELECT jsonb_array_elements_text(p_progress->'completed_steps')) ELSE completed_steps END,
        skipped_steps = CASE WHEN p_progress ? 'skipped_steps'
            THEN ARRAY(SELECT jsonb_array_elements_text(p_progress->'skipped_steps')) ELSE skipped_steps END,
        completed_at = CASE WHEN COALESCE((p_progress->>'complete')::BOOLEAN,FALSE) THEN COALESCE(completed_at,now()) ELSE completed_at END,
        dismissed_at = CASE WHEN COALESCE((p_progress->>'dismiss')::BOOLEAN,FALSE) THEN COALESCE(dismissed_at,now()) ELSE dismissed_at END,
        last_activity_at = now(),
        metadata = metadata || COALESCE(p_progress->'metadata','{}'::JSONB)
    WHERE id = v_progress.id;

    IF p_step_key IS NOT NULL AND p_step_status IN ('iniciado','concluido','pulado','erro') THEN
        INSERT INTO public.onboarding_steps (profile_id, step_key, status, completed_at)
        VALUES (v_profile.id, left(p_step_key,80), p_step_status,
                CASE WHEN p_step_status IN ('concluido','pulado') THEN now() END)
        ON CONFLICT (profile_id,step_key) DO UPDATE SET
            status = EXCLUDED.status,
            completed_at = EXCLUDED.completed_at;
    END IF;

    IF p_step_status='concluido' AND p_step_key IN ('boas_vindas','persona','perfil') THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
        VALUES (
            v_profile.organization_id,
            auth.uid(),
            v_profile.id,
            CASE p_step_key
                WHEN 'boas_vindas' THEN 'onboarding_started'
                WHEN 'persona' THEN 'persona_selected'
                ELSE 'profile_completed'
            END,
            p_step_key,
            'onboarding',
            CASE WHEN p_step_key='persona'
                 THEN jsonb_build_object('persona',COALESCE(p_profile->>'persona',v_profile.persona))
                 ELSE '{}'::JSONB END
        ) ON CONFLICT DO NOTHING;
    END IF;

    IF COALESCE((p_progress->>'complete')::BOOLEAN,FALSE) THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
        VALUES (v_profile.organization_id,auth.uid(),v_profile.id,'onboarding_completed','conclusao','onboarding','{}'::JSONB)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN public.get_onboarding_contexto();
END $$;

CREATE OR REPLACE FUNCTION public.registrar_onboarding_evento(
    p_event_name TEXT,
    p_step_key TEXT DEFAULT NULL,
    p_source TEXT DEFAULT 'onboarding',
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile public.onboarding_profiles%ROWTYPE;
BEGIN
    IF p_event_name IS NULL OR p_event_name NOT IN (
        'signup_completed','onboarding_started','persona_selected','organization_created',
        'profile_completed','first_property_created','first_client_created','first_deal_created',
        'first_task_created','calendar_connected','team_member_invited','ai_first_used',
        'onboarding_step_skipped','onboarding_completed','onboarding_abandoned','first_value_reached'
    ) THEN RAISE EXCEPTION 'evento de onboarding inválido'; END IF;
    SELECT * INTO v_profile FROM public.onboarding_profiles WHERE user_id = auth.uid();
    IF v_profile.id IS NULL THEN RETURN; END IF;

    INSERT INTO public.onboarding_events
        (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
    VALUES
        (v_profile.organization_id,auth.uid(),v_profile.id,p_event_name,left(p_step_key,80),left(COALESCE(p_source,'onboarding'),40),
         -- Allowlist fechada: nenhuma chave livre ou PII entra no analytics.
         jsonb_strip_nulls(jsonb_build_object(
             'persona',p_metadata->'persona',
             'organization_type',p_metadata->'organization_type',
             'source',p_metadata->'source',
             'step',p_metadata->'step',
             'role',p_metadata->'role',
             'action',p_metadata->'action',
             'reused',p_metadata->'reused'
         )))
    ON CONFLICT DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION public.salvar_onboarding(JSONB,JSONB,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_onboarding_evento(TEXT,TEXT,TEXT,JSONB) TO authenticated;

-- Marcos produzidos fora do wizard são reconhecidos pela fonte operacional.
CREATE OR REPLACE FUNCTION public.trg_onboarding_calendar_connected()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
DECLARE v_profile UUID;
BEGIN
    IF NEW.status <> 'connected' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'connected' THEN RETURN NEW; END IF;

    SELECT id INTO v_profile FROM public.onboarding_profiles
     WHERE user_id=NEW.user_id AND organization_id=NEW.organization_id;
    IF v_profile IS NOT NULL THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,source,metadata)
        VALUES (NEW.organization_id,NEW.user_id,v_profile,'calendar_connected','google_calendar','{}'::JSONB)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_onboarding_calendar_connected ON public.calendar_connections;
CREATE TRIGGER trg_onboarding_calendar_connected
    AFTER INSERT OR UPDATE OF status ON public.calendar_connections
    FOR EACH ROW EXECUTE FUNCTION public.trg_onboarding_calendar_connected();

CREATE OR REPLACE FUNCTION public.trg_onboarding_ai_first_used()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
DECLARE v_user UUID; v_org UUID; v_profile UUID;
BEGIN
    IF NEW.role <> 'user' THEN RETURN NEW; END IF;
    v_user := auth.uid();
    IF v_user IS NULL THEN RETURN NEW; END IF;

    SELECT o.id INTO v_org
      FROM public.ai_conversations c
      JOIN public.routine_organizations o ON o.legacy_corretor_id=c.corretor_id
     WHERE c.id=NEW.conversation_id;
    SELECT id INTO v_profile FROM public.onboarding_profiles
     WHERE user_id=v_user AND organization_id=v_org;
    IF v_profile IS NOT NULL THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,source,metadata)
        VALUES (v_org,v_user,v_profile,'ai_first_used','assistente','{}'::JSONB)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_onboarding_ai_first_used ON public.ai_messages;
CREATE TRIGGER trg_onboarding_ai_first_used
    AFTER INSERT ON public.ai_messages
    FOR EACH ROW EXECUTE FUNCTION public.trg_onboarding_ai_first_used();

-- ── 8. Convites explícitos ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.criar_convite_organizacao(p_email TEXT, p_papel TEXT DEFAULT 'corretor')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org UUID; v_token TEXT; v_id UUID; v_profile UUID;
BEGIN
    SELECT organization_id INTO v_org FROM public.routine_memberships
     WHERE user_id = auth.uid() AND status='active'
       AND role IN ('proprietario','administrador','gestor') LIMIT 1;
    IF v_org IS NULL THEN RAISE EXCEPTION 'somente gestores podem convidar'; END IF;
    IF p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'e-mail inválido'; END IF;
    IF p_papel NOT IN ('gestor','corretor','financeiro','juridico','locacoes','marketing','suporte') THEN
        RAISE EXCEPTION 'papel inválido';
    END IF;
    v_token := gen_random_uuid()::TEXT || gen_random_uuid()::TEXT;
    UPDATE public.organizacao_convites SET status='revogado'
     WHERE organization_id=v_org AND lower(email)=lower(BTRIM(p_email)) AND status='pendente';
    INSERT INTO public.organizacao_convites (organization_id,email,papel,token_hash,criado_por)
    VALUES (v_org,lower(BTRIM(p_email)),p_papel,encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid())
    RETURNING id INTO v_id;
    SELECT id INTO v_profile FROM public.onboarding_profiles WHERE user_id=auth.uid();
    IF v_profile IS NOT NULL THEN
        INSERT INTO public.onboarding_events
            (organization_id,user_id,profile_id,event_name,step_key,source,metadata)
        VALUES (v_org,auth.uid(),v_profile,'team_member_invited','equipe','onboarding',jsonb_build_object('role',p_papel))
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN jsonb_build_object('id',v_id,'token',v_token,'expires_in_days',7);
END $$;

CREATE OR REPLACE FUNCTION public.aceitar_convite_organizacao(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_inv public.organizacao_convites%ROWTYPE;
    v_profile UUID;
    v_email TEXT;
    v_system_role TEXT;
BEGIN
    v_email := lower(COALESCE(auth.jwt()->>'email',''));
    SELECT * INTO v_inv FROM public.organizacao_convites
     WHERE token_hash = encode(extensions.digest(p_token,'sha256'),'hex') FOR UPDATE;
    IF v_inv.id IS NULL OR v_inv.status <> 'pendente' OR v_inv.expira_em <= now() THEN
        RAISE EXCEPTION 'convite inválido ou expirado';
    END IF;
    IF lower(v_inv.email) <> v_email THEN RAISE EXCEPTION 'este convite pertence a outro e-mail'; END IF;
    SELECT id INTO v_profile FROM public.onboarding_profiles WHERE user_id = auth.uid();
    v_system_role := CASE
        WHEN v_inv.papel IN ('gestor','corretor','financeiro','juridico') THEN v_inv.papel
        ELSE 'colaborador'
    END;

    UPDATE public.routine_memberships SET status='revoked', updated_at=now()
     WHERE user_id=auth.uid() AND status='active';
    INSERT INTO public.routine_memberships
        (organization_id,user_id,role,job_role,status,display_name)
    VALUES (
        v_inv.organization_id,
        auth.uid(),
        v_system_role,
        v_inv.papel,
        'active',
        (SELECT nome FROM public.corretores WHERE user_id=auth.uid())
    )
    ON CONFLICT (organization_id,user_id) DO UPDATE SET
        status='active',role=EXCLUDED.role,job_role=EXCLUDED.job_role,
        display_name=EXCLUDED.display_name,updated_at=now();
    UPDATE public.onboarding_profiles SET
        organization_id=v_inv.organization_id,persona='usuario_convidado',atualizado_em=now()
     WHERE id=v_profile;
    UPDATE public.organizacao_convites SET status='aceito',aceito_por=auth.uid(),aceito_em=now()
     WHERE id=v_inv.id;
    RETURN jsonb_build_object('organization_id',v_inv.organization_id,'papel',v_inv.papel);
END $$;

GRANT EXECUTE ON FUNCTION public.criar_convite_organizacao(TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_organizacao(TEXT) TO authenticated;

-- ── 9. Ações reais, atômicas e idempotentes ───────────────────────────────
CREATE OR REPLACE FUNCTION public.onboarding_executar_acao(p_action TEXT, p_payload JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_profile public.onboarding_profiles%ROWTYPE;
    v_progress public.onboarding_progress%ROWTYPE;
    v_corretor UUID;
    v_id UUID;
    v_cliente UUID;
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

-- ── 10. Tours e visão administrativa ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.salvar_onboarding_tour(p_tour_key TEXT, p_status TEXT, p_current_step INTEGER DEFAULT 0)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public, pg_temp AS $$
DECLARE v_profile UUID;
BEGIN
    SELECT id INTO v_profile FROM public.onboarding_profiles WHERE user_id=auth.uid();
    INSERT INTO public.onboarding_tours (profile_id,tour_key,current_step,completed_at,dismissed_at)
    VALUES (v_profile,left(p_tour_key,80),GREATEST(p_current_step,0),
            CASE WHEN p_status='concluido' THEN now() END,
            CASE WHEN p_status='dispensado' THEN now() END)
    ON CONFLICT (profile_id,tour_key) DO UPDATE SET
        current_step=EXCLUDED.current_step,
        completed_at=COALESCE(public.onboarding_tours.completed_at,EXCLUDED.completed_at),
        dismissed_at=COALESCE(public.onboarding_tours.dismissed_at,EXCLUDED.dismissed_at),
        atualizado_em=now();
END $$;
GRANT EXECUTE ON FUNCTION public.salvar_onboarding_tour(TEXT,TEXT,INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_onboarding_metricas(p_inicio TIMESTAMPTZ, p_fim TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, pg_temp AS $$
BEGIN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object(
        'novos_cadastros',(SELECT count(*) FROM public.onboarding_events
                            WHERE event_name='signup_completed' AND criado_em>=p_inicio AND criado_em<p_fim),
        'iniciados',(SELECT count(*) FROM public.onboarding_events
                      WHERE event_name='onboarding_started' AND criado_em>=p_inicio AND criado_em<p_fim),
        'concluidos',(SELECT count(*) FROM public.onboarding_events
                       WHERE event_name='onboarding_completed' AND criado_em>=p_inicio AND criado_em<p_fim),
        'travados',(SELECT count(*) FROM public.onboarding_progress pr
                     JOIN public.onboarding_profiles op ON op.id=pr.profile_id
                    WHERE pr.completed_at IS NULL AND pr.dismissed_at IS NULL
                      AND COALESCE((op.metadata->>'legacy_account')::BOOLEAN,FALSE)=FALSE
                      AND pr.last_activity_at<now()-INTERVAL '48 hours'
                      AND EXISTS (SELECT 1 FROM public.onboarding_events ev
                                   WHERE ev.profile_id=op.id AND ev.event_name='onboarding_started')),
        'primeiro_valor',(SELECT count(*) FROM public.onboarding_events
                            WHERE event_name='first_value_reached' AND criado_em>=p_inicio AND criado_em<p_fim),
        'usaram_demonstracao',(SELECT count(DISTINCT organization_id) FROM public.onboarding_sample_data WHERE criado_em>=p_inicio AND criado_em<p_fim),
        'convites',(SELECT count(*) FROM public.organizacao_convites WHERE criado_em>=p_inicio AND criado_em<p_fim),
        'por_etapa',(SELECT COALESCE(jsonb_object_agg(current_step,total),'{}'::JSONB)
                       FROM (SELECT pr.current_step,count(*) total
                               FROM public.onboarding_progress pr
                               JOIN public.onboarding_profiles op ON op.id=pr.profile_id
                              WHERE pr.completed_at IS NULL AND pr.dismissed_at IS NULL
                                AND COALESCE((op.metadata->>'legacy_account')::BOOLEAN,FALSE)=FALSE
                                AND EXISTS (SELECT 1 FROM public.onboarding_events ev
                                             WHERE ev.profile_id=op.id AND ev.event_name='onboarding_started')
                              GROUP BY pr.current_step) q),
        'trials_encerrando',(SELECT count(*) FROM public.subscriptions
                              WHERE status='trialing' AND trial_ends_at BETWEEN now() AND now()+INTERVAL '7 days')
    );
END $$;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_metricas(TIMESTAMPTZ,TIMESTAMPTZ) TO authenticated;

-- SECURITY DEFINER não pode herdar EXECUTE de PUBLIC. Cada função abaixo é
-- exposta apenas ao papel explicitamente necessário.
REVOKE ALL ON FUNCTION public.bootstrap_onboarding_corretor(UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bootstrap_onboarding_corretor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_onboarding_contexto() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_onboarding(JSONB,JSONB,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_onboarding_evento(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_onboarding_calendar_connected() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_onboarding_ai_first_used() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.criar_convite_organizacao(TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aceitar_convite_organizacao(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.onboarding_executar_acao(TEXT,JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_onboarding_tour(TEXT,TEXT,INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_onboarding_metricas(TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_onboarding_contexto() TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_onboarding(JSONB,JSONB,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_onboarding_evento(TEXT,TEXT,TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_convite_organizacao(TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aceitar_convite_organizacao(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_executar_acao(TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_onboarding_tour(TEXT,TEXT,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_onboarding_metricas(TIMESTAMPTZ,TIMESTAMPTZ) TO authenticated;

COMMENT ON TABLE public.onboarding_events IS
    'Eventos de ativação sem PII. A fonte de verdade para métricas é o banco, não console.log.';
COMMENT ON TABLE public.onboarding_profiles IS
    'Perfil de ativação ligado à organização única da Central de Rotina; não cria tenant paralelo.';
