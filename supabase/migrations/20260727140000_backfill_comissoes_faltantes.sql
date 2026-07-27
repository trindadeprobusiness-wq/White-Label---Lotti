-- =============================================================================
-- Financeiro: backfill das comissões de locação FALTANTES.
-- Aplicada em produção em 2026-07-27 (após o dedup 20260727130000).
--
-- Contexto: os repasses existem para todas as faturas pagas (126=126), mas ~40
-- faturas pagas nunca tiveram a comissão de 10% do corretor lançada (o trigger
-- pulava quando um repasse já existia — criado antes pelo script rogue). Como o
-- corretor recebe 10% de cada aluguel, cada fatura paga deve ter 1 comissão.
--
-- Idempotente: só cria para faturas SEM comissão (vinculada por fatura_id OU
-- casada por contrato+data+valor). O índice único uq_lancamento_comissao_fatura
-- é o backstop. Os ids criados ficam em _backfill_comissoes_20260727 (rollback).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public._backfill_comissoes_20260727 (
    id         UUID,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH ins AS (
    INSERT INTO public.lancamentos_financeiros
        (corretor_id, tipo, categoria, descricao, valor, data, recorrente,
         contrato_id, imovel_id, fatura_id)
    SELECT
        f.corretor_id, 'RECEITA', 'COMISSAO_LOCACAO',
        'Taxa Adm - Fatura ' || f.mes_referencia,
        round(f.valor_aluguel * (COALESCE(c.taxa_administracao_percentual, 10) / 100.0), 2),
        COALESCE(f.data_pagamento, f.data_vencimento, CURRENT_DATE),
        FALSE, f.contrato_id, f.imovel_id, f.id
    FROM public.faturas_aluguel f
    JOIN public.contratos c ON c.id = f.contrato_id
    WHERE f.status = 'PAGO'
      AND f.valor_aluguel IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.lancamentos_financeiros l
          WHERE l.categoria = 'COMISSAO_LOCACAO'
            AND (
              l.fatura_id = f.id
              OR (
                l.fatura_id IS NULL
                AND l.contrato_id = f.contrato_id
                AND l.data = COALESCE(f.data_pagamento, f.data_vencimento)
                AND round(l.valor, 2) = round(f.valor_aluguel * (COALESCE(c.taxa_administracao_percentual, 10) / 100.0), 2)
              )
            )
      )
    RETURNING id
)
INSERT INTO public._backfill_comissoes_20260727 (id)
SELECT id FROM ins;

COMMIT;
