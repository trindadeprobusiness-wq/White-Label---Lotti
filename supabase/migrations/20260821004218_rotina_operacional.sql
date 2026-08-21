-- ---------------------------------------------------------------------------
-- Central de Rotina da Lotti
--
-- O restante do produto ainda usa `corretor_id` como tenant. Esta migration
-- cria a primeira entidade de organização/equipe sem reescrever as tabelas
-- legadas: cada corretor existente recebe uma organização cujo
-- `legacy_corretor_id` aponta para os clientes, imóveis e contratos atuais.
-- Membros adicionais compartilham a Rotina; links com o CRM continuam validados
-- contra o corretor-raiz da organização.
--
-- Datas são TIMESTAMPTZ (UTC no banco). A zona de apresentação fica na
-- organização/preferência e começa em America/Sao_Paulo.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE IF NOT EXISTS public.routine_organizations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_corretor_id  UUID NOT NULL UNIQUE
                        REFERENCES public.corretores(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    timezone            TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routine_memberships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'corretor'
                    CHECK (role IN ('proprietario','administrador','gestor','corretor','financeiro','juridico','colaborador')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('invited','active','suspended','revoked')),
    team_name       TEXT,
    unit_name       TEXT,
    display_name    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_routine_memberships_user
    ON public.routine_memberships (user_id, status, organization_id);
CREATE INDEX IF NOT EXISTS idx_routine_memberships_org
    ON public.routine_memberships (organization_id, status, role);

-- Helpers de RLS ficam em schema não exposto. São SECURITY DEFINER somente
-- para consultar memberships sem recursão de policy; todos validam auth.uid().
CREATE OR REPLACE FUNCTION private.routine_is_member(_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.routine_memberships m
        WHERE m.organization_id = _organization_id
          AND m.user_id = (SELECT auth.uid())
          AND m.status = 'active'
    )
$$;

CREATE OR REPLACE FUNCTION private.routine_member_has_role(
    _organization_id UUID,
    _roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.routine_memberships m
        WHERE m.organization_id = _organization_id
          AND m.user_id = (SELECT auth.uid())
          AND m.status = 'active'
          AND m.role = ANY (_roles)
    )
$$;

CREATE OR REPLACE FUNCTION private.routine_user_is_member(
    _organization_id UUID,
    _user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT _user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.routine_memberships m
        WHERE m.organization_id = _organization_id
          AND m.user_id = _user_id
          AND m.status = 'active'
    )
$$;

CREATE OR REPLACE FUNCTION private.routine_can_view_item(
    _organization_id UUID,
    _assigned_to UUID,
    _created_by UUID,
    _visibility TEXT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT private.routine_is_member(_organization_id) AND (
        _assigned_to = (SELECT auth.uid())
        OR _created_by = (SELECT auth.uid())
        OR (
            coalesce(_visibility, 'team') <> 'private'
            AND private.routine_member_has_role(
                _organization_id,
                ARRAY['proprietario','administrador','gestor']
            )
        )
    )
$$;

CREATE OR REPLACE FUNCTION private.routine_can_write_item(
    _organization_id UUID,
    _assigned_to UUID,
    _created_by UUID,
    _visibility TEXT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT private.routine_is_member(_organization_id)
       AND private.routine_user_is_member(_organization_id, _assigned_to)
       AND (
          _assigned_to = (SELECT auth.uid())
          OR (
              coalesce(_visibility, 'team') <> 'private'
              AND private.routine_member_has_role(
                  _organization_id,
                  ARRAY['proprietario','administrador','gestor']
              )
          )
       )
$$;

REVOKE ALL ON FUNCTION private.routine_is_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.routine_member_has_role(UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.routine_user_is_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.routine_can_view_item(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.routine_can_write_item(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_is_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.routine_member_has_role(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.routine_user_is_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.routine_can_view_item(UUID, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION private.routine_can_write_item(UUID, UUID, UUID, TEXT) TO authenticated;

-- Organização e vínculo do proprietário para a base existente.
INSERT INTO public.routine_organizations (legacy_corretor_id, name)
SELECT c.id, coalesce(nullif(c.razao_social, ''), nullif(c.nome, ''), 'Minha organização')
FROM public.corretores c
ON CONFLICT (legacy_corretor_id) DO NOTHING;

INSERT INTO public.routine_memberships
    (organization_id, user_id, role, status, display_name)
SELECT o.id, c.user_id, 'proprietario', 'active', c.nome
FROM public.routine_organizations o
JOIN public.corretores c ON c.id = o.legacy_corretor_id
ON CONFLICT (organization_id, user_id) DO UPDATE
SET status = 'active', display_name = EXCLUDED.display_name;

CREATE OR REPLACE FUNCTION public.ensure_routine_organization_for_corretor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_organization_id UUID;
BEGIN
    INSERT INTO public.routine_organizations (legacy_corretor_id, name)
    VALUES (NEW.id, coalesce(nullif(NEW.razao_social, ''), nullif(NEW.nome, ''), 'Minha organização'))
    ON CONFLICT (legacy_corretor_id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_organization_id;

    INSERT INTO public.routine_memberships
        (organization_id, user_id, role, status, display_name)
    VALUES (v_organization_id, NEW.user_id, 'proprietario', 'active', NEW.nome)
    ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active', display_name = EXCLUDED.display_name;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.ensure_routine_organization_for_corretor() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tr_ensure_routine_organization ON public.corretores;
CREATE TRIGGER tr_ensure_routine_organization
    AFTER INSERT ON public.corretores
    FOR EACH ROW EXECUTE FUNCTION public.ensure_routine_organization_for_corretor();

-- ---------------------------------------------------------------------------
-- Agenda, tarefas, caixa de entrada e automações
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.routine_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    assigned_to         UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_by          UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
    title               TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 180),
    description         TEXT,
    activity_type       TEXT NOT NULL DEFAULT 'outro',
    status              TEXT NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('draft','pending_confirmation','confirmed','completed','cancelled')),
    priority            TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low','medium','high','urgent')),
    start_at            TIMESTAMPTZ NOT NULL,
    end_at              TIMESTAMPTZ NOT NULL,
    all_day             BOOLEAN NOT NULL DEFAULT FALSE,
    timezone            TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    recurrence_rule     TEXT,
    location            TEXT,
    visibility          TEXT NOT NULL DEFAULT 'team'
                        CHECK (visibility IN ('team','private')),
    source              TEXT NOT NULL DEFAULT 'lotti'
                        CHECK (source IN ('lotti','google','automation','ai','other_user')),
    client_id           UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
    property_id         UUID REFERENCES public.imoveis(id) ON DELETE SET NULL,
    deal_id             UUID REFERENCES public.crm_oportunidades(id) ON DELETE SET NULL,
    contract_id         UUID REFERENCES public.contratos(id) ON DELETE SET NULL,
    -- Locações usam a própria tabela `contratos`; o campo separado deixa claro
    -- o papel contextual sem criar uma segunda cópia do contrato.
    rental_id           UUID REFERENCES public.contratos(id) ON DELETE SET NULL,
    sync_status         TEXT NOT NULL DEFAULT 'local'
                        CHECK (sync_status IN ('local','pending','synced','conflict','error')),
    sync_version        BIGINT NOT NULL DEFAULT 1,
    completed_at        TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at > start_at)
);

CREATE TABLE IF NOT EXISTS public.routine_tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    assigned_to         UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_by          UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
    title               TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 180),
    description         TEXT,
    activity_type       TEXT NOT NULL DEFAULT 'tarefa_administrativa',
    status              TEXT NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo','in_progress','completed','cancelled')),
    priority            TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low','medium','high','urgent')),
    due_at              TIMESTAMPTZ,
    estimated_minutes   INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 5 AND 1440),
    timezone            TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    recurrence_rule     TEXT,
    visibility          TEXT NOT NULL DEFAULT 'team'
                        CHECK (visibility IN ('team','private')),
    source              TEXT NOT NULL DEFAULT 'lotti'
                        CHECK (source IN ('lotti','google','automation','ai','other_user','inbox')),
    client_id           UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
    property_id         UUID REFERENCES public.imoveis(id) ON DELETE SET NULL,
    deal_id             UUID REFERENCES public.crm_oportunidades(id) ON DELETE SET NULL,
    contract_id         UUID REFERENCES public.contratos(id) ON DELETE SET NULL,
    rental_id           UUID REFERENCES public.contratos(id) ON DELETE SET NULL,
    completed_at        TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routine_task_checklists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES public.routine_tasks(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    completed   BOOLEAN NOT NULL DEFAULT FALSE,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routine_reminders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_id        UUID REFERENCES public.routine_events(id) ON DELETE CASCADE,
    task_id         UUID REFERENCES public.routine_tasks(id) ON DELETE CASCADE,
    remind_at       TIMESTAMPTZ NOT NULL,
    minutes_before  INTEGER CHECK (minutes_before IS NULL OR minutes_before BETWEEN 0 AND 525600),
    channel         TEXT NOT NULL DEFAULT 'in_app'
                    CHECK (channel IN ('in_app','email','whatsapp','push')),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed','cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((event_id IS NOT NULL)::int + (task_id IS NOT NULL)::int = 1)
);

CREATE TABLE IF NOT EXISTS public.routine_inbox (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind                TEXT NOT NULL DEFAULT 'note'
                        CHECK (kind IN ('idea','note','request','task','audio','message','service_extract')),
    content             TEXT NOT NULL,
    attachment_url      TEXT,
    status              TEXT NOT NULL DEFAULT 'unprocessed'
                        CHECK (status IN ('unprocessed','proposed','converted','archived')),
    extracted_data      JSONB NOT NULL DEFAULT '{}'::jsonb,
    converted_event_id  UUID REFERENCES public.routine_events(id) ON DELETE SET NULL,
    converted_task_id   UUID REFERENCES public.routine_tasks(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routine_automations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    created_by          UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
    name                TEXT NOT NULL,
    source_rule         TEXT NOT NULL,
    action_type         TEXT NOT NULL CHECK (action_type IN ('task','event','reminder','suggestion')),
    assignee_strategy   TEXT NOT NULL DEFAULT 'entity_owner',
    due_offset_minutes  INTEGER NOT NULL DEFAULT 0,
    notification_channel TEXT NOT NULL DEFAULT 'in_app',
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    config              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.routine_automation_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    automation_id   UUID NOT NULL REFERENCES public.routine_automations(id) ON DELETE CASCADE,
    source_event_id TEXT,
    dedupe_key      TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('running','completed','failed','skipped')),
    result          JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_code      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    UNIQUE (organization_id, dedupe_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_routine_automations_org_name
    ON public.routine_automations (organization_id, name);

CREATE OR REPLACE FUNCTION public.seed_routine_automations_for_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.routine_automations
        (organization_id, created_by, name, source_rule, action_type, due_offset_minutes, enabled, config)
    SELECT NEW.id, c.user_id, seed.name, seed.source_rule, seed.action_type,
           seed.due_offset, FALSE, seed.config
    FROM public.corretores c
    CROSS JOIN (VALUES
      ('Primeiro contato de novo lead', 'new_lead', 'suggestion', 15, '{"activity_type":"primeiro_atendimento"}'::jsonb),
      ('Follow-up de lead sem resposta', 'lead_without_reply', 'suggestion', 1440, '{"activity_type":"follow_up","sla_hours":24}'::jsonb),
      ('Feedback após visita', 'visit_completed', 'suggestion', 60, '{"activity_type":"follow_up"}'::jsonb),
      ('Retorno de proposta', 'proposal_sent', 'suggestion', 2880, '{"activity_type":"negociacao"}'::jsonb),
      ('Renovação de contrato', 'contract_expiring', 'suggestion', -43200, '{"activity_type":"renovacao_contratual","days_before":30}'::jsonb),
      ('Cobrança próxima do vencimento', 'rent_due', 'suggestion', -2880, '{"activity_type":"cobranca","days_before":2}'::jsonb),
      ('Checklist de imóvel captado', 'property_captured', 'suggestion', 0, '{"activity_type":"captacao_imovel","checklist":["Fotos","Descrição","Publicação"]}'::jsonb),
      ('SLA de atendimento', 'client_sla_breached', 'suggestion', 0, '{"activity_type":"follow_up","notify_manager":true}'::jsonb)
    ) AS seed(name, source_rule, action_type, due_offset, config)
    WHERE c.id = NEW.legacy_corretor_id
    ON CONFLICT (organization_id, name) DO NOTHING;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.seed_routine_automations_for_organization() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tr_seed_routine_automations ON public.routine_organizations;
CREATE TRIGGER tr_seed_routine_automations
    AFTER INSERT ON public.routine_organizations
    FOR EACH ROW EXECUTE FUNCTION public.seed_routine_automations_for_organization();

-- Backfill para organizações criadas no início desta migration.
INSERT INTO public.routine_automations
    (organization_id, created_by, name, source_rule, action_type, due_offset_minutes, enabled, config)
SELECT o.id, c.user_id, seed.name, seed.source_rule, seed.action_type,
       seed.due_offset, FALSE, seed.config
FROM public.routine_organizations o
JOIN public.corretores c ON c.id = o.legacy_corretor_id
CROSS JOIN (VALUES
  ('Primeiro contato de novo lead', 'new_lead', 'suggestion', 15, '{"activity_type":"primeiro_atendimento"}'::jsonb),
  ('Follow-up de lead sem resposta', 'lead_without_reply', 'suggestion', 1440, '{"activity_type":"follow_up","sla_hours":24}'::jsonb),
  ('Feedback após visita', 'visit_completed', 'suggestion', 60, '{"activity_type":"follow_up"}'::jsonb),
  ('Retorno de proposta', 'proposal_sent', 'suggestion', 2880, '{"activity_type":"negociacao"}'::jsonb),
  ('Renovação de contrato', 'contract_expiring', 'suggestion', -43200, '{"activity_type":"renovacao_contratual","days_before":30}'::jsonb),
  ('Cobrança próxima do vencimento', 'rent_due', 'suggestion', -2880, '{"activity_type":"cobranca","days_before":2}'::jsonb),
  ('Checklist de imóvel captado', 'property_captured', 'suggestion', 0, '{"activity_type":"captacao_imovel","checklist":["Fotos","Descrição","Publicação"]}'::jsonb),
  ('SLA de atendimento', 'client_sla_breached', 'suggestion', 0, '{"activity_type":"follow_up","notify_manager":true}'::jsonb)
) AS seed(name, source_rule, action_type, due_offset, config)
ON CONFLICT (organization_id, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.routine_preferences (
    organization_id         UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    timezone                TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    default_view            TEXT NOT NULL DEFAULT 'week'
                            CHECK (default_view IN ('day','week','month','list')),
    workday_start           TIME NOT NULL DEFAULT '08:00',
    workday_end             TIME NOT NULL DEFAULT '18:00',
    default_event_minutes   INTEGER NOT NULL DEFAULT 60 CHECK (default_event_minutes BETWEEN 15 AND 480),
    default_reminder_minutes INTEGER NOT NULL DEFAULT 120 CHECK (default_reminder_minutes BETWEEN 0 AND 10080),
    quiet_hours_start       TIME,
    quiet_hours_end         TIME,
    daily_summary           BOOLEAN NOT NULL DEFAULT TRUE,
    weekly_summary          BOOLEAN NOT NULL DEFAULT TRUE,
    notification_channels   TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.routine_entity_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    event_id        UUID REFERENCES public.routine_events(id) ON DELETE CASCADE,
    task_id         UUID REFERENCES public.routine_tasks(id) ON DELETE CASCADE,
    entity_type     TEXT NOT NULL CHECK (entity_type IN ('client','lead','property','deal','stage','proposal','contract','rental','charge','user','team','unit')),
    entity_id       UUID NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((event_id IS NOT NULL)::int + (task_id IS NOT NULL)::int = 1),
    UNIQUE (event_id, task_id, entity_type, entity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_routine_entity_links_event
    ON public.routine_entity_links (event_id, entity_type, entity_id)
    WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_routine_entity_links_task
    ON public.routine_entity_links (task_id, entity_type, entity_id)
    WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.routine_activity_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    action          TEXT NOT NULL,
    changes         JSONB NOT NULL DEFAULT '{}'::jsonb,
    source          TEXT NOT NULL DEFAULT 'user',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routine_events_calendar
    ON public.routine_events (organization_id, assigned_to, start_at, end_at)
    WHERE deleted_at IS NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_routine_tasks_due
    ON public.routine_tasks (organization_id, assigned_to, due_at)
    WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled');
CREATE INDEX IF NOT EXISTS idx_routine_inbox_open
    ON public.routine_inbox (organization_id, user_id, created_at DESC)
    WHERE status = 'unprocessed';
CREATE INDEX IF NOT EXISTS idx_routine_activity_entity
    ON public.routine_activity_log (organization_id, entity_type, entity_id, created_at DESC);

-- Um UUID conhecido de outro tenant não pode ser associado a uma atividade.
CREATE OR REPLACE FUNCTION public.routine_validate_item_entities()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_corretor_id UUID;
BEGIN
    SELECT legacy_corretor_id INTO v_corretor_id
    FROM public.routine_organizations
    WHERE id = NEW.organization_id;

    IF v_corretor_id IS NULL THEN
        RAISE EXCEPTION 'routine_organization_invalid' USING ERRCODE = '42501';
    END IF;
    IF NEW.client_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.clientes WHERE id = NEW.client_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_client_outside_organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.property_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.imoveis WHERE id = NEW.property_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_property_outside_organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.deal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.crm_oportunidades WHERE id = NEW.deal_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_deal_outside_organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.contract_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contratos WHERE id = NEW.contract_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_contract_outside_organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.rental_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contratos WHERE id = NEW.rental_id AND corretor_id = v_corretor_id
    ) THEN
        RAISE EXCEPTION 'routine_rental_outside_organization' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.routine_validate_item_entities() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS tr_routine_events_validate_entities ON public.routine_events;
CREATE TRIGGER tr_routine_events_validate_entities
    BEFORE INSERT OR UPDATE
    ON public.routine_events FOR EACH ROW EXECUTE FUNCTION public.routine_validate_item_entities();
DROP TRIGGER IF EXISTS tr_routine_tasks_validate_entities ON public.routine_tasks;
CREATE TRIGGER tr_routine_tasks_validate_entities
    BEFORE INSERT OR UPDATE
    ON public.routine_tasks FOR EACH ROW EXECUTE FUNCTION public.routine_validate_item_entities();

CREATE OR REPLACE FUNCTION private.routine_can_write_event_id(_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.routine_events e
        WHERE e.id = _event_id
          AND private.routine_can_write_item(e.organization_id, e.assigned_to, e.created_by, e.visibility)
    )
$$;

CREATE OR REPLACE FUNCTION private.routine_can_write_task_id(_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.routine_tasks t
        WHERE t.id = _task_id
          AND private.routine_can_write_item(t.organization_id, t.assigned_to, t.created_by, t.visibility)
    )
$$;

REVOKE ALL ON FUNCTION private.routine_can_write_event_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.routine_can_write_task_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_can_write_event_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.routine_can_write_task_id(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Google Calendar: credenciais inacessíveis ao browser, metadados separados.
-- access_token_ciphertext / refresh_token_ciphertext e PKCE são AES-GCM
-- produzidos nas Edge Functions com GOOGLE_TOKEN_ENCRYPTION_KEY.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_connections (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider                TEXT NOT NULL DEFAULT 'google' CHECK (provider = 'google'),
    provider_account_id     TEXT,
    provider_email          TEXT,
    scopes                  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','connected','expired','error','disconnected')),
    access_token_ciphertext TEXT,
    refresh_token_ciphertext TEXT,
    token_expires_at        TIMESTAMPTZ,
    oauth_state_hash        TEXT,
    pkce_verifier_ciphertext TEXT,
    oauth_expires_at        TIMESTAMPTZ,
    privacy_mode            TEXT NOT NULL DEFAULT 'partial'
                            CHECK (privacy_mode IN ('full','partial','busy_only')),
    last_sync_at            TIMESTAMPTZ,
    last_error_code         TEXT,
    disconnected_at         TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.external_calendars (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id       UUID NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
    organization_id     UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    external_calendar_id TEXT NOT NULL,
    summary             TEXT NOT NULL,
    color               TEXT,
    access_role         TEXT,
    selected            BOOLEAN NOT NULL DEFAULT TRUE,
    is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    sync_direction      TEXT NOT NULL DEFAULT 'bidirectional'
                        CHECK (sync_direction IN ('import_only','export_only','bidirectional','disabled')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (connection_id, external_calendar_id)
);

CREATE TABLE IF NOT EXISTS public.calendar_sync_states (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_calendar_id UUID NOT NULL UNIQUE REFERENCES public.external_calendars(id) ON DELETE CASCADE,
    sync_token_ciphertext TEXT,
    full_sync_started_at TIMESTAMPTZ,
    last_incremental_sync_at TIMESTAMPTZ,
    last_success_at     TIMESTAMPTZ,
    last_error_code     TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    next_retry_at       TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calendar_watch_channels (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_calendar_id UUID NOT NULL REFERENCES public.external_calendars(id) ON DELETE CASCADE,
    channel_id          TEXT NOT NULL UNIQUE,
    resource_id         TEXT NOT NULL,
    resource_uri        TEXT,
    channel_token_hash  TEXT NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','renewing','expired','stopped','error')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calendar_event_mappings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.routine_organizations(id) ON DELETE CASCADE,
    connection_id       UUID NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
    external_calendar_id UUID NOT NULL REFERENCES public.external_calendars(id) ON DELETE CASCADE,
    routine_event_id    UUID REFERENCES public.routine_events(id) ON DELETE CASCADE,
    google_event_id     TEXT NOT NULL,
    google_etag         TEXT,
    google_updated_at   TIMESTAMPTZ,
    sync_version        BIGINT NOT NULL DEFAULT 1,
    origin              TEXT NOT NULL DEFAULT 'google',
    last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE (external_calendar_id, google_event_id),
    UNIQUE (connection_id, routine_event_id)
);

CREATE TABLE IF NOT EXISTS public.calendar_webhook_receipts (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel_id      TEXT NOT NULL,
    message_number  BIGINT NOT NULL,
    resource_state  TEXT,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel_id, message_number)
);

CREATE INDEX IF NOT EXISTS idx_calendar_watch_expiration
    ON public.calendar_watch_channels (expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_calendar_mapping_event
    ON public.calendar_event_mappings (routine_event_id);

CREATE OR REPLACE FUNCTION private.routine_connection_owned(_connection_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.calendar_connections c
        WHERE c.id = _connection_id
          AND c.user_id = (SELECT auth.uid())
          AND private.routine_is_member(c.organization_id)
    )
$$;
CREATE OR REPLACE FUNCTION private.routine_connection_owned_in_org(_connection_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.calendar_connections c
        WHERE c.id = _connection_id
          AND c.organization_id = _organization_id
          AND c.user_id = (SELECT auth.uid())
          AND private.routine_is_member(c.organization_id)
    )
$$;
REVOKE ALL ON FUNCTION private.routine_connection_owned(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.routine_connection_owned_in_org(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.routine_connection_owned(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.routine_connection_owned_in_org(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Auditoria automática e concorrência
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.routine_touch_and_version()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = now();
    IF TG_TABLE_NAME = 'routine_events' THEN
        IF (
            NEW.title, NEW.description, NEW.activity_type, NEW.status, NEW.priority,
            NEW.start_at, NEW.end_at, NEW.all_day, NEW.timezone,
            NEW.recurrence_rule, NEW.location, NEW.visibility, NEW.assigned_to,
            NEW.client_id, NEW.property_id, NEW.deal_id, NEW.contract_id,
            NEW.rental_id, NEW.deleted_at
        ) IS DISTINCT FROM (
            OLD.title, OLD.description, OLD.activity_type, OLD.status, OLD.priority,
            OLD.start_at, OLD.end_at, OLD.all_day, OLD.timezone,
            OLD.recurrence_rule, OLD.location, OLD.visibility, OLD.assigned_to,
            OLD.client_id, OLD.property_id, OLD.deal_id, OLD.contract_id,
            OLD.rental_id, OLD.deleted_at
        ) THEN
            NEW.sync_version = coalesce(OLD.sync_version, 0) + 1;
        ELSE
            NEW.sync_version = OLD.sync_version;
        END IF;
        IF NEW.source <> 'google' AND NEW.sync_version > OLD.sync_version THEN
            NEW.sync_status = CASE WHEN NEW.sync_status = 'local' THEN 'local' ELSE 'pending' END;
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.routine_log_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_organization_id UUID;
    v_entity_id UUID;
    v_source TEXT;
    v_updated_at TIMESTAMPTZ;
    v_action TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_organization_id := OLD.organization_id;
        v_entity_id := OLD.id;
        v_source := OLD.source;
        v_updated_at := OLD.updated_at;
    ELSE
        v_organization_id := NEW.organization_id;
        v_entity_id := NEW.id;
        v_source := NEW.source;
        v_updated_at := NEW.updated_at;
    END IF;
    v_action := lower(TG_OP);
    IF TG_OP = 'UPDATE' AND NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
        v_action := 'complete';
    ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        v_action := 'delete';
    ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'routine_events'
       AND (to_jsonb(NEW)->>'start_at', to_jsonb(NEW)->>'end_at')
           IS DISTINCT FROM (to_jsonb(OLD)->>'start_at', to_jsonb(OLD)->>'end_at') THEN
        v_action := 'reschedule';
    END IF;

    INSERT INTO public.routine_activity_log
        (organization_id, actor_user_id, entity_type, entity_id, action, changes, source)
    VALUES (
        v_organization_id,
        (SELECT auth.uid()),
        CASE WHEN TG_TABLE_NAME = 'routine_events' THEN 'event' ELSE 'task' END,
        v_entity_id,
        v_action,
        CASE WHEN TG_OP = 'UPDATE'
             THEN jsonb_build_object('updated_at', v_updated_at)
             ELSE '{}'::jsonb END,
        coalesce(v_source, 'user')
    );
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.routine_log_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_routine_events_touch ON public.routine_events;
CREATE TRIGGER tr_routine_events_touch BEFORE UPDATE ON public.routine_events
    FOR EACH ROW EXECUTE FUNCTION public.routine_touch_and_version();
DROP TRIGGER IF EXISTS tr_routine_tasks_touch ON public.routine_tasks;
CREATE TRIGGER tr_routine_tasks_touch BEFORE UPDATE ON public.routine_tasks
    FOR EACH ROW EXECUTE FUNCTION public.routine_touch_and_version();
DROP TRIGGER IF EXISTS tr_routine_events_log ON public.routine_events;
CREATE TRIGGER tr_routine_events_log AFTER INSERT OR UPDATE OR DELETE ON public.routine_events
    FOR EACH ROW EXECUTE FUNCTION public.routine_log_change();
DROP TRIGGER IF EXISTS tr_routine_tasks_log ON public.routine_tasks;
CREATE TRIGGER tr_routine_tasks_log AFTER INSERT OR UPDATE OR DELETE ON public.routine_tasks
    FOR EACH ROW EXECUTE FUNCTION public.routine_log_change();

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'routine_organizations','routine_memberships','routine_task_checklists',
    'routine_reminders','routine_inbox','routine_automations','routine_preferences',
    'external_calendars','calendar_sync_states','calendar_watch_channels'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%I_updated_at ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER tr_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      v_table, v_table
    );
  END LOOP;
END $$;

-- Retorna conflitos sem revelar o conteúdo de eventos privados de terceiros.
CREATE OR REPLACE FUNCTION public.routine_detect_conflicts(
    p_assigned_to UUID,
    p_start_at TIMESTAMPTZ,
    p_end_at TIMESTAMPTZ,
    p_exclude_event_id UUID DEFAULT NULL
)
RETURNS TABLE (
    event_id UUID,
    title TEXT,
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    is_private BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_org UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL OR p_end_at <= p_start_at THEN
        RAISE EXCEPTION 'solicitação inválida' USING ERRCODE = '22023';
    END IF;

    SELECT m.organization_id INTO v_org
    FROM public.routine_memberships m
    WHERE m.user_id = p_assigned_to AND m.status = 'active'
      AND private.routine_is_member(m.organization_id)
    LIMIT 1;

    IF v_org IS NULL THEN
        RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT e.id,
           CASE WHEN e.visibility = 'private'
                     AND e.assigned_to <> (SELECT auth.uid())
                     AND e.created_by <> (SELECT auth.uid())
                THEN 'Horário ocupado' ELSE e.title END,
           e.start_at, e.end_at, e.visibility = 'private'
    FROM public.routine_events e
    WHERE e.organization_id = v_org
      AND e.assigned_to = p_assigned_to
      AND e.deleted_at IS NULL
      AND e.status NOT IN ('cancelled','draft')
      AND e.id IS DISTINCT FROM p_exclude_event_id
      AND tstzrange(e.start_at, e.end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)')
    ORDER BY e.start_at;
END $$;

REVOKE ALL ON FUNCTION public.routine_detect_conflicts(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.routine_detect_conflicts(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;

-- Registra a conclusão no histórico CRM usando o schema encontrado no projeto.
-- A base legada usa descricao/data/corretor_id; ambientes atualizados usam
-- conteudo/data_contato/direcao/metadata. O RPC preserva ambos sem dar INSERT
-- direto no histórico ao navegador.
CREATE OR REPLACE FUNCTION public.routine_register_completion(
    p_item_type TEXT,
    p_item_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_organization_id UUID;
    v_client_id UUID;
    v_property_id UUID;
    v_activity_type TEXT;
    v_title TEXT;
    v_corretor_id UUID;
BEGIN
    IF p_item_type = 'event' THEN
        SELECT organization_id, client_id, property_id, activity_type, title
        INTO v_organization_id, v_client_id, v_property_id, v_activity_type, v_title
        FROM public.routine_events WHERE id = p_item_id;
        IF NOT private.routine_can_write_event_id(p_item_id) THEN
            RAISE EXCEPTION 'routine_item_forbidden' USING ERRCODE = '42501';
        END IF;
    ELSIF p_item_type = 'task' THEN
        SELECT organization_id, client_id, property_id, activity_type, title
        INTO v_organization_id, v_client_id, v_property_id, v_activity_type, v_title
        FROM public.routine_tasks WHERE id = p_item_id;
        IF NOT private.routine_can_write_task_id(p_item_id) THEN
            RAISE EXCEPTION 'routine_item_forbidden' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'routine_item_type_invalid' USING ERRCODE = '22023';
    END IF;

    IF v_client_id IS NULL THEN RETURN FALSE; END IF;
    SELECT legacy_corretor_id INTO v_corretor_id
    FROM public.routine_organizations WHERE id = v_organization_id;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'historico_contatos' AND column_name = 'conteudo'
    ) THEN
        EXECUTE $sql$
            INSERT INTO public.historico_contatos
                (cliente_id, tipo, direcao, conteudo, data_contato, metadata)
            VALUES ($1, $2::public.canal_contato, $3::public.direcao_contato, $4, now(), $5)
        $sql$ USING
            v_client_id,
            CASE WHEN v_activity_type = 'visita_imovel' THEN 'PRESENCIAL' ELSE 'OUTRO' END,
            'OUT',
            'Atividade concluída na Rotina: ' || v_title,
            jsonb_build_object('origem', 'routine', 'routine_id', p_item_id, 'tipo_ui', CASE WHEN v_activity_type = 'visita_imovel' THEN 'VISITA' ELSE 'NOTA' END);
    ELSE
        INSERT INTO public.historico_contatos
            (cliente_id, corretor_id, tipo, descricao, data, imovel_relacionado_id)
        VALUES (
            v_client_id, v_corretor_id,
            CASE WHEN v_activity_type = 'visita_imovel' THEN 'VISITA'::public.tipo_contato ELSE 'NOTA'::public.tipo_contato END,
            'Atividade concluída na Rotina: ' || v_title,
            now(), v_property_id
        );
    END IF;
    UPDATE public.clientes SET ultimo_contato = now() WHERE id = v_client_id AND corretor_id = v_corretor_id;
    RETURN TRUE;
END $$;

REVOKE ALL ON FUNCTION public.routine_register_completion(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.routine_register_completion(TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS e privilégios da Data API
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'routine_organizations','routine_memberships','routine_events','routine_tasks',
    'routine_task_checklists','routine_reminders','routine_inbox','routine_automations',
    'routine_automation_runs','routine_preferences','routine_entity_links',
    'routine_activity_log','calendar_connections','external_calendars',
    'calendar_sync_states','calendar_watch_channels','calendar_event_mappings',
    'calendar_webhook_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_task_checklists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_reminders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_inbox TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_automations TO authenticated;
GRANT SELECT ON public.routine_automation_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_entity_links TO authenticated;
GRANT SELECT ON public.routine_activity_log TO authenticated;
GRANT SELECT, UPDATE ON public.external_calendars TO authenticated;

-- Credenciais, tokens, mappings e webhooks nunca passam pela Data API do browser.
REVOKE ALL ON public.calendar_connections, public.calendar_sync_states,
    public.calendar_watch_channels, public.calendar_event_mappings,
    public.calendar_webhook_receipts FROM anon, authenticated;

CREATE POLICY "routine organizations: member read" ON public.routine_organizations
    FOR SELECT TO authenticated USING (private.routine_is_member(id));
CREATE POLICY "routine organizations: managers update" ON public.routine_organizations
    FOR UPDATE TO authenticated
    USING (private.routine_member_has_role(id, ARRAY['proprietario','administrador']))
    WITH CHECK (private.routine_member_has_role(id, ARRAY['proprietario','administrador']));

CREATE POLICY "routine memberships: organization read" ON public.routine_memberships
    FOR SELECT TO authenticated USING (private.routine_is_member(organization_id));
CREATE POLICY "routine memberships: managers insert" ON public.routine_memberships
    FOR INSERT TO authenticated
    WITH CHECK (private.routine_member_has_role(organization_id, ARRAY['proprietario','administrador']));
CREATE POLICY "routine memberships: managers update" ON public.routine_memberships
    FOR UPDATE TO authenticated
    USING (private.routine_member_has_role(organization_id, ARRAY['proprietario','administrador']))
    WITH CHECK (private.routine_member_has_role(organization_id, ARRAY['proprietario','administrador']));

CREATE POLICY "routine events: visible items" ON public.routine_events
    FOR SELECT TO authenticated
    USING (private.routine_can_view_item(organization_id, assigned_to, created_by, visibility));
CREATE POLICY "routine events: create authorized" ON public.routine_events
    FOR INSERT TO authenticated
    WITH CHECK (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));
CREATE POLICY "routine events: update authorized" ON public.routine_events
    FOR UPDATE TO authenticated
    USING (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility))
    WITH CHECK (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));
CREATE POLICY "routine events: delete authorized" ON public.routine_events
    FOR DELETE TO authenticated
    USING (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine tasks: visible items" ON public.routine_tasks
    FOR SELECT TO authenticated
    USING (private.routine_can_view_item(organization_id, assigned_to, created_by, visibility));
CREATE POLICY "routine tasks: create authorized" ON public.routine_tasks
    FOR INSERT TO authenticated
    WITH CHECK (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));
CREATE POLICY "routine tasks: update authorized" ON public.routine_tasks
    FOR UPDATE TO authenticated
    USING (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility))
    WITH CHECK (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));
CREATE POLICY "routine tasks: delete authorized" ON public.routine_tasks
    FOR DELETE TO authenticated
    USING (private.routine_can_write_item(organization_id, assigned_to, created_by, visibility));

CREATE POLICY "routine checklist: task read" ON public.routine_task_checklists
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.routine_tasks t WHERE t.id = task_id));
CREATE POLICY "routine checklist: task write" ON public.routine_task_checklists
    FOR ALL TO authenticated
    USING (private.routine_can_write_task_id(task_id))
    WITH CHECK (private.routine_can_write_task_id(task_id));

CREATE POLICY "routine reminders: own or manager read" ON public.routine_reminders
    FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()) OR private.routine_member_has_role(organization_id, ARRAY['proprietario','administrador','gestor']));
CREATE POLICY "routine reminders: authorized write" ON public.routine_reminders
    FOR ALL TO authenticated
    USING (
        (user_id = (SELECT auth.uid()) OR private.routine_member_has_role(organization_id, ARRAY['proprietario','administrador','gestor']))
        AND (
            (event_id IS NOT NULL AND private.routine_can_write_event_id(event_id))
            OR (task_id IS NOT NULL AND private.routine_can_write_task_id(task_id))
        )
    )
    WITH CHECK (
        private.routine_user_is_member(organization_id, user_id)
        AND (user_id = (SELECT auth.uid()) OR private.routine_member_has_role(organization_id, ARRAY['proprietario','administrador','gestor']))
        AND (
            (event_id IS NOT NULL AND private.routine_can_write_event_id(event_id))
            OR (task_id IS NOT NULL AND private.routine_can_write_task_id(task_id))
        )
    );

CREATE POLICY "routine inbox: own read" ON public.routine_inbox
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND private.routine_is_member(organization_id));
CREATE POLICY "routine inbox: own write" ON public.routine_inbox
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()) AND private.routine_is_member(organization_id));

CREATE POLICY "routine automations: members read" ON public.routine_automations
    FOR SELECT TO authenticated USING (private.routine_is_member(organization_id));
CREATE POLICY "routine automations: managers write" ON public.routine_automations
    FOR ALL TO authenticated
    USING (private.routine_member_has_role(organization_id, ARRAY['proprietario','administrador']))
    WITH CHECK (private.routine_member_has_role(organization_id, ARRAY['proprietario','administrador']));
CREATE POLICY "routine automation runs: members read" ON public.routine_automation_runs
    FOR SELECT TO authenticated USING (private.routine_is_member(organization_id));

CREATE POLICY "routine preferences: own" ON public.routine_preferences
    FOR ALL TO authenticated
    USING (user_id = (SELECT auth.uid()) AND private.routine_is_member(organization_id))
    WITH CHECK (user_id = (SELECT auth.uid()) AND private.routine_is_member(organization_id));

CREATE POLICY "routine links: member read" ON public.routine_entity_links
    FOR SELECT TO authenticated USING (
        private.routine_is_member(organization_id)
        AND (
            (event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.routine_events e WHERE e.id = event_id))
            OR (task_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.routine_tasks t WHERE t.id = task_id))
        )
    );
CREATE POLICY "routine links: member write" ON public.routine_entity_links
    FOR ALL TO authenticated
    USING (
        (event_id IS NOT NULL AND private.routine_can_write_event_id(event_id)
            AND EXISTS (SELECT 1 FROM public.routine_events e WHERE e.id = event_id AND e.organization_id = routine_entity_links.organization_id))
        OR (task_id IS NOT NULL AND private.routine_can_write_task_id(task_id)
            AND EXISTS (SELECT 1 FROM public.routine_tasks t WHERE t.id = task_id AND t.organization_id = routine_entity_links.organization_id))
    )
    WITH CHECK (
        (event_id IS NOT NULL AND private.routine_can_write_event_id(event_id)
            AND EXISTS (SELECT 1 FROM public.routine_events e WHERE e.id = event_id AND e.organization_id = routine_entity_links.organization_id))
        OR (task_id IS NOT NULL AND private.routine_can_write_task_id(task_id)
            AND EXISTS (SELECT 1 FROM public.routine_tasks t WHERE t.id = task_id AND t.organization_id = routine_entity_links.organization_id))
    );

CREATE POLICY "routine activity: member read" ON public.routine_activity_log
    FOR SELECT TO authenticated USING (private.routine_is_member(organization_id));

CREATE POLICY "external calendars: owner read" ON public.external_calendars
    FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()) AND private.routine_connection_owned(connection_id));
CREATE POLICY "external calendars: owner configure" ON public.external_calendars
    FOR UPDATE TO authenticated
    USING (user_id = (SELECT auth.uid()) AND private.routine_connection_owned_in_org(connection_id, organization_id))
    WITH CHECK (user_id = (SELECT auth.uid()) AND private.routine_connection_owned_in_org(connection_id, organization_id));

-- Leitura dos módulos relacionados para membros operacionais autorizados.
-- Escritas continuam nas políticas originais de cada módulo.
CREATE POLICY "routine organization: clients read" ON public.clientes
    FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.routine_organizations o
        WHERE o.legacy_corretor_id = clientes.corretor_id
          AND private.routine_member_has_role(o.id, ARRAY['proprietario','administrador','gestor','corretor','colaborador'])
    ));
CREATE POLICY "routine organization: properties read" ON public.imoveis
    FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.routine_organizations o
        WHERE o.legacy_corretor_id = imoveis.corretor_id
          AND private.routine_member_has_role(o.id, ARRAY['proprietario','administrador','gestor','corretor','colaborador'])
    ));
CREATE POLICY "routine organization: deals read" ON public.crm_oportunidades
    FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.routine_organizations o
        WHERE o.legacy_corretor_id = crm_oportunidades.corretor_id
          AND private.routine_member_has_role(o.id, ARRAY['proprietario','administrador','gestor','corretor','colaborador'])
    ));
CREATE POLICY "routine organization: contracts read" ON public.contratos
    FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.routine_organizations o
        WHERE o.legacy_corretor_id = contratos.corretor_id
          AND private.routine_member_has_role(o.id, ARRAY['proprietario','administrador','gestor','corretor','financeiro','juridico'])
    ));
CREATE POLICY "routine organization: alerts read" ON public.alertas
    FOR SELECT TO authenticated USING (EXISTS (
        SELECT 1 FROM public.routine_organizations o
        WHERE o.legacy_corretor_id = alertas.corretor_id
          AND private.routine_member_has_role(o.id, ARRAY['proprietario','administrador','gestor','corretor','colaborador'])
    ));

COMMENT ON TABLE public.calendar_connections IS
    'Somente backend/service_role. Tokens OAuth e PKCE são ciphertext AES-GCM; nunca texto puro.';
COMMENT ON TABLE public.routine_events IS
    'Compromissos da Central de Rotina. TIMESTAMPTZ armazena UTC; timezone preserva a apresentação.';
COMMENT ON COLUMN public.routine_events.visibility IS
    'private: terceiros podem detectar ocupação via RPC, mas não ler título, cliente ou endereço.';
