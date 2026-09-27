-- SCRUM-6/16 (B3 da auditoria de onboarding): a migration
-- 20260821130000_onboarding_ativacao, ainda não aplicada em produção, redefine
-- get_corretor_id() SEM exigir corretor ativo. Aplicada hoje, depois da
-- 20260831140000 (já em produção), devolveria acesso a contas suspensas.
-- Esta migration reaplica a versão da 20260831140000 (perfil único, membership
-- ativa e corretor ativo). Aplicar logo depois da 20260821130000; sem as
-- tabelas do onboarding não faz nada.
DO $tenant_funcao$
BEGIN
    IF to_regclass('public.onboarding_profiles') IS NULL THEN
        RAISE NOTICE 'Onboarding ausente: get_corretor_id() mantida como esta.';
        RETURN;
    END IF;

    EXECUTE $fn$
        CREATE OR REPLACE FUNCTION public.get_corretor_id()
        RETURNS UUID
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $tenant$
            SELECT o.legacy_corretor_id
              FROM public.onboarding_profiles p
              JOIN public.routine_memberships m
                ON m.organization_id = p.organization_id
               AND m.user_id = p.user_id
               AND m.status = 'active'
              JOIN public.routine_organizations o ON o.id = p.organization_id
              JOIN public.corretores c ON c.id = o.legacy_corretor_id
             WHERE p.user_id = (SELECT auth.uid())
               AND c.status = 'ativo'
        $tenant$
    $fn$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.get_corretor_id() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_corretor_id() TO authenticated';
    EXECUTE $c$
        COMMENT ON FUNCTION public.get_corretor_id() IS
            'Resolve o tenant pela organizacao do perfil unico do onboarding; '
            'exige membership ativa e corretor ativo, sem LIMIT 1 ambiguo.'
    $c$;
END $tenant_funcao$;

NOTIFY pgrst, 'reload schema';
