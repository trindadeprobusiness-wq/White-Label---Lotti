-- Os novos preços de lançamento não acumulam o desconto antigo de fundador.
-- Mantém a campanha e referências históricas; não altera subscriptions nem Asaas.
UPDATE public.pricing_campaigns
SET active = false, updated_at = now()
WHERE name = 'Preço de Fundador — 100 primeiros'
  AND discount_type = 'percentage'
  AND discount_value = 20
  AND active = true;
