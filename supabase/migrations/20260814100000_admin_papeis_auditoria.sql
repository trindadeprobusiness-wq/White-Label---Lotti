-- ---------------------------------------------------------------------------
-- Back office: papéis administrativos, auditoria e ciclo de vida da conta.
--
-- Até aqui a autorização da Lotti era binária: ou você tem sessão, ou não tem.
-- Não existia `user_roles`, `app_role` nem `has_role` — ProtectedRoute só checava
-- `isAuthenticated`, e quem opera a plataforma não tinha caminho nenhum para ver
-- a operação. A migration 20260812090000 já havia criado `leads_sem_destino`
-- esperando "um painel administrativo futuro"; é este.
--
-- Três decisões que valem registro:
--
-- 1. has_role() é SECURITY DEFINER por necessidade, não por conveniência. A
--    policy de user_roles precisa consultar user_roles; via INVOKER isso é
--    recursão infinita de RLS. DEFINER roda como owner, que não passa por RLS,
--    e corta o ciclo.
--
-- 2. O admin NÃO ganha policy nas ~30 tabelas existentes. Elas acabaram de ser
--    endurecidas contra vazamento entre inquilinos e mexer nelas é risco puro.
--    A leitura administrativa entra por RPCs SECURITY DEFINER com guard no topo
--    (migration 20260814110000), que devolvem só as colunas necessárias.
--
-- 3. Suspender conta passa a valer no backend inteiro de uma vez: get_corretor_id()
--    exige status='ativo'. Como as ~30 policies já dependem dessa função, a
--    suspensão vale em todas as tabelas sem tocar em nenhuma policy. É a mudança
--    de maior alcance deste arquivo — daí o backfill explícito antes.
--
-- Idempotente. Não apaga dado nenhum.
-- ---------------------------------------------------------------------------

-- ── 1. Papéis ─────────────────────────────────────────────────────────────
-- Enum em inglês minúsculo, consistente com subscription_status/billing_cycle
-- das migrations de SaaS (20260807120000). O schema de negócio segue em
-- português; a fronteira PT-negócio / EN-infra já existe no projeto.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role          public.app_role NOT NULL,
    concedido_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    concedido_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revogado_em   TIMESTAMPTZ,
    revogado_por  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    motivo        TEXT
);

-- Revogar é soft delete: o par (user, papel) some do índice mas a linha fica no
-- histórico, e o mesmo papel pode ser reconcedido depois sem colidir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_vigente
    ON public.user_roles (user_id, role) WHERE revogado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);

COMMENT ON TABLE public.user_roles IS
    'Papéis administrativos da plataforma Lotti. Não confundir com o tenant: '
    'todo usuário continua sendo um corretor isolado por RLS. Este papel dá '
    'acesso ao back office, não a dados de outro corretor pela via normal.';

-- ── 2. Funções de autorização ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = _role AND revogado_em IS NULL
    )
$$;

-- super_admin é admin por definição: quem pode tudo pode o menos.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role IN ('admin', 'super_admin')
          AND revogado_em IS NULL
    )
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'super_admin' AND revogado_em IS NULL
    )
$$;

GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- O front precisa saber quais papéis o usuário tem para decidir o que desenhar.
-- Devolve só os papéis do próprio usuário — não é caminho para enumerar admins.
CREATE OR REPLACE FUNCTION public.meus_papeis()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(array_agg(role::TEXT ORDER BY role::TEXT), ARRAY[]::TEXT[])
    FROM public.user_roles
    WHERE user_id = auth.uid() AND revogado_em IS NULL
$$;

GRANT EXECUTE ON FUNCTION public.meus_papeis() TO authenticated;

-- ── 3. RLS de user_roles ──────────────────────────────────────────────────
-- Admin enxerga a lista; só super_admin escreve. Sem isso, um admin operacional
-- se promoveria a super_admin com um INSERT e a hierarquia não valeria nada.
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles: admin le" ON public.user_roles;
CREATE POLICY "user_roles: admin le" ON public.user_roles
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "user_roles: super_admin concede" ON public.user_roles;
CREATE POLICY "user_roles: super_admin concede" ON public.user_roles
    FOR INSERT TO authenticated
    WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "user_roles: super_admin revoga" ON public.user_roles;
CREATE POLICY "user_roles: super_admin revoga" ON public.user_roles
    FOR UPDATE TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Papel não se apaga, se revoga: o histórico de quem teve acesso é a auditoria.
REVOKE DELETE ON public.user_roles FROM anon, authenticated;

-- ── 4. Auditoria administrativa append-only ───────────────────────────────
-- Mesmo padrão de auditoria_financeira (20260708150000): REVOKE + trigger que
-- levanta exceção. Não basta o REVOKE — uma função SECURITY DEFINER escrevendo
-- em nome do admin passaria por cima dele; a trigger não deixa.
CREATE TABLE IF NOT EXISTS public.admin_auditoria (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ator_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    acao          TEXT NOT NULL,
    entidade      TEXT NOT NULL,
    entidade_id   TEXT,
    dados_antes   JSONB,
    dados_depois  JSONB,
    motivo        TEXT,
    ip_hash       TEXT,
    user_agent    TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_auditoria_entidade
    ON public.admin_auditoria (entidade, entidade_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_admin_auditoria_ator
    ON public.admin_auditoria (ator_user_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_admin_auditoria_data
    ON public.admin_auditoria (criado_em DESC);

COMMENT ON TABLE public.admin_auditoria IS
    'Append-only. Toda ação administrativa sensível grava aqui com ator e motivo. '
    'IP é armazenado como hash — o IP cru é dado pessoal e não tem uso operacional.';

ALTER TABLE public.admin_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_auditoria: admin le" ON public.admin_auditoria;
CREATE POLICY "admin_auditoria: admin le" ON public.admin_auditoria
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- Escrita só pela função registradora (SECURITY DEFINER). Não há policy de
-- INSERT de propósito: ninguém escreve auditoria à mão, nem o super_admin.
REVOKE INSERT, UPDATE, DELETE ON public.admin_auditoria FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.bloquear_mutacao_admin_auditoria()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'admin_auditoria é append-only'; END $$;

DROP TRIGGER IF EXISTS tr_admin_auditoria_imutavel ON public.admin_auditoria;
CREATE TRIGGER tr_admin_auditoria_imutavel
    BEFORE UPDATE OR DELETE ON public.admin_auditoria
    FOR EACH ROW EXECUTE FUNCTION public.bloquear_mutacao_admin_auditoria();

CREATE OR REPLACE FUNCTION public.registrar_auditoria_admin(
    p_acao        TEXT,
    p_entidade    TEXT,
    p_entidade_id TEXT DEFAULT NULL,
    p_dados_antes JSONB DEFAULT NULL,
    p_dados_depois JSONB DEFAULT NULL,
    p_motivo      TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), p_acao, p_entidade, p_entidade_id, p_dados_antes, p_dados_depois, p_motivo)
    RETURNING id INTO v_id;

    RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.registrar_auditoria_admin(TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) TO authenticated;

-- ── 5. Ciclo de vida da conta do corretor ─────────────────────────────────
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS suspenso_em TIMESTAMPTZ;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS suspenso_motivo TEXT;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS suspenso_por UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.corretores ADD COLUMN IF NOT EXISTS ultimo_acesso_em TIMESTAMPTZ;

-- Backfill ANTES do NOT NULL e antes de get_corretor_id() passar a filtrar.
-- Se a ordem se inverter, todo corretor existente perde acesso a tudo.
UPDATE public.corretores SET status = 'ativo' WHERE status IS NULL;

ALTER TABLE public.corretores ALTER COLUMN status SET DEFAULT 'ativo';
ALTER TABLE public.corretores ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_corretores_status'
    ) THEN
        ALTER TABLE public.corretores
            ADD CONSTRAINT chk_corretores_status
            CHECK (status IN ('ativo', 'suspenso', 'inativo'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_corretores_status ON public.corretores (status);
CREATE INDEX IF NOT EXISTS idx_corretores_ultimo_acesso ON public.corretores (ultimo_acesso_em DESC NULLS LAST);

COMMENT ON COLUMN public.corretores.status IS
    'ativo | suspenso | inativo. Suspenso perde acesso a TODOS os dados porque '
    'get_corretor_id() devolve NULL, e as ~30 policies dependem dela.';
COMMENT ON COLUMN public.corretores.ultimo_acesso_em IS
    'Alimentado por registrar_atividade(). NULL significa "sem dados de atividade" '
    '— nunca deve ser lido como inativo: o registro só começou no deploy do back office.';

-- ── 6. Suspensão passa a valer no backend inteiro ─────────────────────────
-- Antes: SELECT id FROM corretores WHERE user_id = auth.uid()
-- Agora exige status='ativo'. Um corretor suspenso passa a receber NULL, e como
-- toda policy compara `corretor_id = get_corretor_id()` e NULL nunca é igual a
-- nada, o acesso fecha em todas as tabelas ao mesmo tempo.
-- Continua SECURITY INVOKER, como estava desde 20260503114843.
CREATE OR REPLACE FUNCTION public.get_corretor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT id FROM public.corretores WHERE user_id = auth.uid() AND status = 'ativo'
$$;

-- O UPDATE de corretores nunca teve WITH CHECK (vem de 20260104131559). É a
-- mesma classe de bug corrigida em subscriptions pela 20260812090000: sem
-- WITH CHECK nada valida a linha depois da escrita, então dava para trocar o
-- próprio user_id.
DROP POLICY IF EXISTS "Corretor atualiza próprio perfil" ON public.corretores;
CREATE POLICY "Corretor atualiza próprio perfil"
  ON public.corretores FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Impedir que o corretor mexa no próprio `status` NÃO pode ser feito por policy:
-- um WITH CHECK que compare com o valor atual precisa de subselect na própria
-- corretores, e o Postgres aborta com "infinite recursion detected in policy".
-- A trigger vê OLD e NEW diretamente, sem consultar a tabela.
CREATE OR REPLACE FUNCTION public.proteger_status_corretor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- auth.uid() nulo = service_role, cron ou migration: contexto de servidor,
    -- que já não passa por RLS. anon não tem policy de UPDATE aqui e nunca chega.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND auth.uid() IS NOT NULL
       AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Alterar o status da conta é ação administrativa'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_proteger_status_corretor ON public.corretores;
CREATE TRIGGER tr_proteger_status_corretor
    BEFORE UPDATE ON public.corretores
    FOR EACH ROW EXECUTE FUNCTION public.proteger_status_corretor();

COMMENT ON FUNCTION public.proteger_status_corretor() IS
    'O corretor edita o próprio cadastro, mas não o próprio status — senão um '
    'suspenso se reativaria sozinho com um UPDATE. Mudança de status passa por '
    'admin_definir_status_corretor().';

-- ── 7. Promoção do primeiro super_admin ───────────────────────────────────
-- Sem credencial no código e sem admin semeado. A função só funciona enquanto
-- NÃO existir nenhum super_admin — depois disso ela recusa, e a promoção passa
-- a ser feita pelo back office por quem já é super_admin.
--
-- REVOKE de anon/authenticated é o que impede o pior caso: exposta via PostgREST,
-- qualquer visitante se promoveria enquanto a plataforma não tivesse admin.
-- Roda uma única vez, no SQL Editor do Supabase. Ver docs/BACKOFFICE.md.
CREATE OR REPLACE FUNCTION public.promover_primeiro_super_admin(_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE role = 'super_admin' AND revogado_em IS NULL
    ) THEN
        RAISE EXCEPTION 'Já existe super_admin. Use o back office para conceder papéis.';
    END IF;

    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(trim(_email));

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Nenhum usuário com o e-mail %. Crie a conta pelo /auth antes.', _email;
    END IF;

    INSERT INTO public.user_roles (user_id, role, motivo)
    VALUES (v_user_id, 'super_admin', 'Primeiro super_admin da plataforma (bootstrap).');

    INSERT INTO public.admin_auditoria (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
    VALUES (v_user_id, 'conceder_papel', 'user_roles', v_user_id::TEXT,
            jsonb_build_object('role', 'super_admin'),
            'Bootstrap via promover_primeiro_super_admin()');

    RETURN 'super_admin concedido a ' || _email;
END $$;

REVOKE ALL ON FUNCTION public.promover_primeiro_super_admin(TEXT) FROM PUBLIC, anon, authenticated;

-- ── 8. Conferência ────────────────────────────────────────────────────────
-- Espera-se 0 linhas. Qualquer resultado aqui significa corretor sem status,
-- que perderia acesso silenciosamente na próxima chamada de get_corretor_id().
DO $$
DECLARE
    v_orfaos INT;
BEGIN
    SELECT count(*) INTO v_orfaos FROM public.corretores WHERE status IS NULL;
    IF v_orfaos > 0 THEN
        RAISE EXCEPTION 'Backfill de corretores.status falhou: % linhas sem status', v_orfaos;
    END IF;
END $$;
