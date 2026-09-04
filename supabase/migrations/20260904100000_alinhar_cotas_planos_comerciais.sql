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
