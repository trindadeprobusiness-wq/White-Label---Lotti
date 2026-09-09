-- Catálogo aprovado: plataforma + atendimento de leads por IA.
-- Preserva IDs/códigos e não altera cobranças ou contratos já emitidos no Asaas.
BEGIN;

UPDATE public.plans AS p
SET name = v.name, monthly_price = v.monthly, annual_price = v.monthly * 10,
    description = v.description, updated_at = now()
FROM (VALUES
  ('essencial', 'Lotti Inteligente', 279.00, 'Plataforma e agente de IA com 100 leads atendidos por mês.'),
  ('profissional', 'Lotti Profissional', 399.00, 'Plataforma e agente de IA com 250 leads atendidos por mês.'),
  ('imobiliaria', 'Lotti Eficazes', 799.00, 'Plataforma e agente de IA com 600 leads atendidos por mês.')
) AS v(code, name, monthly, description)
WHERE p.code = v.code;

INSERT INTO public.plan_entitlements
  (plan_id, feature_key, feature_name, category, enabled, limit_value, unlimited, display_order)
SELECT p.id, 'leads_qualificados_monthly', 'Leads atendidos pela IA / mês', 'ia', true, v.leads, false, 1
FROM public.plans p
JOIN (VALUES ('essencial', 100), ('profissional', 250), ('imobiliaria', 600)) AS v(code, leads)
  ON p.code = v.code
ON CONFLICT (plan_id, feature_key) DO UPDATE
SET feature_name = EXCLUDED.feature_name, limit_value = EXCLUDED.limit_value,
    enabled = true, unlimited = false, updated_at = now();

COMMIT;
