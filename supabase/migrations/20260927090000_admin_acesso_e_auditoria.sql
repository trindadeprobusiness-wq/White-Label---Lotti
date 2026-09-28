-- SCRUM-27 e SCRUM-29: fecha funções auxiliares expostas e leva à trilha de
-- auditoria as alterações administrativas feitas direto pelo painel.
BEGIN;

-- ── 1. Funções auxiliares sem checagem de papel ───────────────────────────
-- Rodam como dono e contornam a RLS: qualquer usuário (até anônimo) lia
-- configurações, percentuais de parceiros e descobria quem é admin. Só são
-- usadas por outras funções SECURITY DEFINER, que continuam podendo chamá-las.
REVOKE EXECUTE ON FUNCTION public.admin_config_texto(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_config_int(TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.percentual_vigente_em(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_config_texto(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_config_int(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.percentual_vigente_em(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO service_role;

-- ── 2. Escritas diretas do painel entram na trilha ────────────────────────
-- As RPCs administrativas rodam como dono e já registram a própria auditoria;
-- este gatilho (SECURITY INVOKER) só age quando quem grava é o usuário logado,
-- isto é, o painel escrevendo direto na tabela. registrar_auditoria_admin
-- exige papel de admin; sem ele a RLS da tabela já decide a gravação.
CREATE OR REPLACE FUNCTION public.auditar_escrita_direta_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_linha JSONB := to_jsonb(COALESCE(NEW, OLD));
BEGIN
    IF current_user <> 'authenticated' OR NOT public.is_admin() THEN
        RETURN NULL;
    END IF;
    PERFORM public.registrar_auditoria_admin(
        CASE TG_OP WHEN 'INSERT' THEN 'criar' WHEN 'UPDATE' THEN 'alterar' ELSE 'excluir' END || '_' || TG_TABLE_NAME,
        TG_TABLE_NAME,
        CASE TG_TABLE_NAME
            WHEN 'admin_config' THEN v_linha->>'chave'
            WHEN 'user_roles' THEN v_linha->>'user_id'
            ELSE v_linha->>'id'
        END,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
        NULL
    );
    RETURN NULL;
END $$;

DO $$
DECLARE
    v_tabela TEXT;
BEGIN
    FOREACH v_tabela IN ARRAY ARRAY['parceiros', 'parceiro_links', 'parceiro_percentuais', 'admin_config', 'user_roles', 'receita_eventos']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS auditar_escrita_direta ON public.%I', v_tabela);
        EXECUTE format(
            'CREATE TRIGGER auditar_escrita_direta AFTER INSERT OR UPDATE OR DELETE ON public.%I
             FOR EACH ROW EXECUTE FUNCTION public.auditar_escrita_direta_admin()', v_tabela);
    END LOOP;
END $$;

-- ── 3. Marcar lote como exportado também vai para a trilha ────────────────
CREATE OR REPLACE FUNCTION public.admin_marcar_lote_exportado(p_lote_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    PERFORM public.exigir_admin();

    SELECT status INTO v_status FROM public.parceiro_lotes WHERE id = p_lote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lote não encontrado'; END IF;
    IF v_status <> 'rascunho' THEN
        RAISE EXCEPTION 'apenas lote em rascunho pode ser exportado';
    END IF;

    UPDATE public.parceiro_lotes
       SET status = 'exportado', exportado_em = now()
     WHERE id = p_lote_id;

    PERFORM public.registrar_auditoria_admin(
        'exportar_lote', 'parceiro_lotes', p_lote_id::TEXT,
        jsonb_build_object('status', v_status), jsonb_build_object('status', 'exportado'), NULL);

    RETURN json_build_object('status', 'exportado');
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
