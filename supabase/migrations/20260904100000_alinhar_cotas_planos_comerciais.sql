-- Alinha o aplicativo aos limites publicados nos cards comerciais da Lotti.
-- Idempotente: pode ser reaplicada sem criar linhas duplicadas.
WITH cotas(plan_code, feature_key, limite) AS (
  VALUES
    ('essencial',    'max_imoveis',             5),
    ('essencial',    'max_contratos_locacao',   5),
    ('essencial',    'max_fachadas',            5),
    ('essencial',    'ai_contracts_monthly',   10),
    ('profissional', 'max_imoveis',            20),
    ('profissional', 'max_contratos_locacao',  15),
    ('profissional', 'max_fachadas',           20),
    ('profissional', 'ai_contracts_monthly',   20),
    ('imobiliaria',  'max_imoveis',           100),
    ('imobiliaria',  'max_contratos_locacao', 100),
    ('imobiliaria',  'max_fachadas',          100),
    ('imobiliaria',  'ai_contracts_monthly',   60)
)
UPDATE public.plan_entitlements entitlement
   SET enabled = TRUE,
       limit_value = cotas.limite,
       unlimited = FALSE,
       updated_at = now()
  FROM public.plans plano, cotas
 WHERE plano.id = entitlement.plan_id
   AND plano.code = cotas.plan_code
   AND entitlement.feature_key = cotas.feature_key;

-- A mesma função atende a UI e os gatilhos autoritativos. Recursos ativos são
-- contados diretamente; apenas IA continua usando o contador mensal.
CREATE OR REPLACE FUNCTION public.checar_cota(
  _corretor_id UUID,
  _feature_key TEXT
)
RETURNS TABLE (
  permitido BOOLEAN, usado INT, limite INT, ilimitado BOOLEAN, habilitado BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plano UUID;
  v_ent RECORD;
  v_usado INT := 0;
  v_extra INT := 0;
BEGIN
  IF auth.role() = 'authenticated'
     AND public.get_corretor_id() IS DISTINCT FROM _corretor_id THEN
    RETURN QUERY SELECT FALSE, 0, 0, FALSE, FALSE;
    RETURN;
  END IF;

  SELECT s.plan_id INTO v_plano
    FROM public.subscriptions s
   WHERE s.corretor_id = _corretor_id
     AND s.status IN ('trialing', 'active', 'past_due', 'read_only')
   LIMIT 1;

  IF v_plano IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, FALSE, FALSE;
    RETURN;
  END IF;

  SELECT e.enabled, e.limit_value, e.unlimited INTO v_ent
    FROM public.plan_entitlements e
   WHERE e.plan_id = v_plano AND e.feature_key = _feature_key;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0, 0, FALSE, FALSE;
    RETURN;
  END IF;

  IF v_ent.unlimited THEN
    RETURN QUERY SELECT TRUE, 0, NULL::INT, TRUE, TRUE;
    RETURN;
  END IF;

  IF v_ent.limit_value IS NULL THEN
    RETURN QUERY SELECT v_ent.enabled, 0, NULL::INT, FALSE, v_ent.enabled;
    RETURN;
  END IF;

  CASE _feature_key
    WHEN 'max_imoveis' THEN
      SELECT COUNT(*)::INT INTO v_usado FROM public.imoveis
       WHERE corretor_id = _corretor_id AND ativo IS TRUE;
    WHEN 'max_contratos_locacao' THEN
      SELECT COUNT(*)::INT INTO v_usado FROM public.contratos
       WHERE corretor_id = _corretor_id
         AND tipo = 'LOCACAO_RESIDENCIAL' AND status = 'ATIVO';
    WHEN 'max_fachadas' THEN
      SELECT COUNT(*)::INT INTO v_usado FROM public.fachadas
       WHERE corretor_id = _corretor_id AND ativo IS TRUE;
    ELSE
      SELECT COALESCE(u.used_quantity, 0) INTO v_usado
        FROM public.usage_counters u
       WHERE u.corretor_id = _corretor_id
         AND u.feature_key = _feature_key
         AND u.period_start = date_trunc('month', now())::DATE;
      v_usado := COALESCE(v_usado, 0);
  END CASE;

  SELECT COALESCE(SUM(
    CASE a.addon_code
      WHEN 'extra_user' THEN CASE WHEN _feature_key = 'max_users' THEN a.quantity ELSE 0 END
      WHEN 'extra_fachadas_25' THEN CASE WHEN _feature_key = 'max_fachadas' THEN 25 * a.quantity ELSE 0 END
      WHEN 'extra_ai_100' THEN CASE WHEN _feature_key = 'ai_contracts_monthly' THEN 100 * a.quantity ELSE 0 END
      WHEN 'extra_storage_50' THEN CASE WHEN _feature_key = 'storage_gb' THEN 50 * a.quantity ELSE 0 END
      ELSE 0
    END
  ), 0)::INT INTO v_extra
    FROM public.subscription_addons a
   WHERE a.corretor_id = _corretor_id AND a.status = 'active';

  RETURN QUERY SELECT
    v_ent.enabled AND v_usado < v_ent.limit_value + v_extra,
    v_usado,
    v_ent.limit_value + v_extra,
    FALSE,
    v_ent.enabled;
END $$;

REVOKE ALL ON FUNCTION public.checar_cota(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checar_cota(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bloquear_recurso_acima_da_cota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feature TEXT;
  v_deve_checar BOOLEAN := FALSE;
  v_permitido BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'imoveis' THEN
    v_feature := 'max_imoveis';
    IF TG_OP = 'INSERT' THEN
      v_deve_checar := NEW.ativo IS TRUE;
    ELSE
      v_deve_checar := NEW.ativo IS TRUE AND OLD.ativo IS NOT TRUE;
    END IF;
  ELSIF TG_TABLE_NAME = 'fachadas' THEN
    v_feature := 'max_fachadas';
    IF TG_OP = 'INSERT' THEN
      v_deve_checar := NEW.ativo IS TRUE;
    ELSE
      v_deve_checar := NEW.ativo IS TRUE AND OLD.ativo IS NOT TRUE;
    END IF;
  ELSIF TG_TABLE_NAME = 'contratos' THEN
    v_feature := 'max_contratos_locacao';
    IF TG_OP = 'INSERT' THEN
      v_deve_checar := NEW.tipo = 'LOCACAO_RESIDENCIAL' AND NEW.status = 'ATIVO';
    ELSE
      v_deve_checar := NEW.tipo = 'LOCACAO_RESIDENCIAL' AND NEW.status = 'ATIVO'
        AND OLD.status IS DISTINCT FROM 'ATIVO';
    END IF;
  END IF;

  IF NOT v_deve_checar THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.corretor_id::TEXT || ':' || v_feature, 0));
  SELECT permitido INTO v_permitido
    FROM public.checar_cota(NEW.corretor_id, v_feature);
  IF NOT COALESCE(v_permitido, FALSE) THEN
    RAISE EXCEPTION 'PLAN_LIMIT_REACHED:%', v_feature USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS imoveis_limite_plano ON public.imoveis;
CREATE TRIGGER imoveis_limite_plano BEFORE INSERT OR UPDATE OF ativo ON public.imoveis
FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();

DROP TRIGGER IF EXISTS fachadas_limite_plano ON public.fachadas;
CREATE TRIGGER fachadas_limite_plano BEFORE INSERT OR UPDATE OF ativo ON public.fachadas
FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();

DROP TRIGGER IF EXISTS contratos_limite_plano ON public.contratos;
CREATE TRIGGER contratos_limite_plano BEFORE INSERT OR UPDATE OF status ON public.contratos
FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();
