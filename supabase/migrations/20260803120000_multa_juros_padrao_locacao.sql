-- Padrão de mercado brasileiro para locação: 10% de multa após o vencimento
-- + 1% de juros ao mês.
--
-- Contexto: o boleto do Asaas usa `contratos.multa_atraso_percentual` e
-- `contratos.juros_mora_diario_percentual`. O default histórico era 2,00% de
-- multa e 0,033%/dia (≈0,99%/mês) — fora do padrão de gestão de aluguel.
-- Não existe UI para editar esses valores, então todos os contratos herdaram
-- o default antigo. Esta migração:
--   1. Ajusta o DEFAULT para novos contratos (10% + 0,0333%/dia = 1%/mês).
--   2. Alinha os contratos de locação já existentes (afeta apenas cobranças
--      FUTURAS; boletos já emitidos no Asaas não mudam).
--
-- Observação: `juros_mora_diario_percentual` guarda o percentual AO DIA; o
-- edge function `asaas-sync` multiplica por 30 para enviar o juros mensal ao
-- Asaas (0,0333 × 30 = 1,00% ao mês).
BEGIN;

ALTER TABLE public.contratos
  ALTER COLUMN multa_atraso_percentual SET DEFAULT 10.00,
  ALTER COLUMN juros_mora_diario_percentual SET DEFAULT 0.0333;

UPDATE public.contratos
SET multa_atraso_percentual = 10.00,
    juros_mora_diario_percentual = 0.0333
WHERE tipo::text LIKE 'LOCACAO%'
  AND (COALESCE(multa_atraso_percentual, 0) <> 10.00
       OR COALESCE(juros_mora_diario_percentual, 0) <> 0.0333);

COMMIT;
