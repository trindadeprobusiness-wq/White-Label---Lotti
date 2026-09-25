-- Inclui locação comercial na mesma franquia e limita tentativas públicas de checkout.
BEGIN;
CREATE OR REPLACE FUNCTION public.checar_cota(
  _corretor_id UUID,
  _feature_key TEXT
)
RETURNS TABLE (
  permitido BOOLEAN, usado INT, limite INT, ilimitado BOOLEAN, habilitado BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
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
     AND ((s.status = 'trialing' AND s.trial_ends_at > now())
       OR (s.status = 'active' AND s.current_period_end > now()))
   LIMIT 1;

  IF v_plano IS NULL AND _feature_key IN ('max_imoveis','max_fachadas','max_contratos_locacao')
     AND EXISTS(SELECT 1 FROM public.billing_legacy_accounts WHERE corretor_id=_corretor_id)
     AND NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE corretor_id=_corretor_id) THEN
    RETURN QUERY SELECT TRUE,0,NULL::integer,TRUE,TRUE; RETURN;
  END IF;
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

  IF NOT v_ent.enabled THEN
    RETURN QUERY SELECT FALSE, 0, v_ent.limit_value, v_ent.unlimited, FALSE;
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
         AND tipo IN ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL') AND status = 'ATIVO';
    WHEN 'max_fachadas' THEN
      SELECT COUNT(*)::INT INTO v_usado FROM public.fachadas
       WHERE corretor_id = _corretor_id AND ativo IS TRUE;
    ELSE
      SELECT COALESCE(u.used_quantity, 0) INTO v_usado
        FROM public.usage_counters u
       WHERE u.corretor_id = _corretor_id
         AND u.feature_key = _feature_key
         AND u.period_start = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::DATE;
      v_usado := COALESCE(v_usado, 0);
  END CASE;

  SELECT COALESCE(SUM(
    CASE a.addon_code
      WHEN 'extra_user' THEN CASE WHEN _feature_key = 'max_users' THEN a.quantity ELSE 0 END
      WHEN 'extra_fachadas_25' THEN CASE WHEN _feature_key = 'max_fachadas' THEN 25 * a.quantity ELSE 0 END
      WHEN 'extra_ai_100' THEN CASE WHEN _feature_key = 'ai_contracts_monthly' THEN 100 * a.quantity ELSE 0 END
      WHEN 'extra_leads_50' THEN CASE WHEN _feature_key = 'leads_qualificados_monthly' THEN 50 * a.quantity ELSE 0 END
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
      v_deve_checar := NEW.ativo IS TRUE AND (OLD.ativo IS NOT TRUE OR NEW.corretor_id IS DISTINCT FROM OLD.corretor_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'fachadas' THEN
    v_feature := 'max_fachadas';
    IF TG_OP = 'INSERT' THEN
      v_deve_checar := NEW.ativo IS TRUE;
    ELSE
      v_deve_checar := NEW.ativo IS TRUE AND (OLD.ativo IS NOT TRUE OR NEW.corretor_id IS DISTINCT FROM OLD.corretor_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'contratos' THEN
    v_feature := 'max_contratos_locacao';
    IF TG_OP = 'INSERT' THEN
      v_deve_checar := NEW.tipo IN ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL') AND NEW.status = 'ATIVO';
    ELSE
      v_deve_checar := NEW.tipo IN ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL') AND NEW.status = 'ATIVO'
        AND (OLD.status IS DISTINCT FROM 'ATIVO' OR OLD.tipo NOT IN ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL')
          OR NEW.corretor_id IS DISTINCT FROM OLD.corretor_id);
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
CREATE TRIGGER imoveis_limite_plano BEFORE INSERT OR UPDATE OF ativo, corretor_id ON public.imoveis
FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();

DROP TRIGGER IF EXISTS fachadas_limite_plano ON public.fachadas;
CREATE TRIGGER fachadas_limite_plano BEFORE INSERT OR UPDATE OF ativo, corretor_id ON public.fachadas
FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();

DROP TRIGGER IF EXISTS contratos_limite_plano ON public.contratos;
CREATE TRIGGER contratos_limite_plano BEFORE INSERT OR UPDATE OF status, tipo, corretor_id ON public.contratos
FOR EACH ROW EXECUTE FUNCTION public.bloquear_recurso_acima_da_cota();

CREATE TABLE public.checkout_rate_limits (
 key_hash text NOT NULL,
 bucket timestamptz NOT NULL,
 attempts integer NOT NULL,
 PRIMARY KEY(key_hash,bucket)
);
CREATE INDEX checkout_rate_limits_bucket_idx ON public.checkout_rate_limits(bucket);
ALTER TABLE public.checkout_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_rate_limits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.checkout_rate_limits TO service_role;
CREATE FUNCTION public.consume_checkout_rate_limit(p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE used integer;
BEGIN
 IF p_key !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
 DELETE FROM public.checkout_rate_limits WHERE bucket<now()-interval '2 days';
 INSERT INTO public.checkout_rate_limits(key_hash,bucket,attempts) VALUES(p_key,date_trunc('minute',now()),1)
 ON CONFLICT(key_hash,bucket) DO UPDATE SET attempts=public.checkout_rate_limits.attempts+1 RETURNING attempts INTO used;
 RETURN used<=10;
END $$;
REVOKE ALL ON FUNCTION public.consume_checkout_rate_limit(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_checkout_rate_limit(text) TO service_role;
COMMIT;
