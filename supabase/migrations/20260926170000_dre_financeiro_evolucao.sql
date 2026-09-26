-- =============================================================================
-- DRE Gerencial: evolução do módulo Financeiro
-- Adiciona campos necessários para DRE, competência, status e rastreabilidade.
-- Novas categorias para cobertura completa de receitas e despesas imobiliárias.
-- =============================================================================

BEGIN;

-- ─── 1. Novas categorias ───────────────────────────────────────────────

-- Receitas
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'TAXA_ADMINISTRACAO';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'TAXA_CONTRATO';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'SERVICOS';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'MULTA_JUROS_RECEBIDOS';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'OUTRAS_RECEITAS';

-- Despesas
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'MARKETING_ANUNCIO';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'COMISSAO_CORRETOR';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'EQUIPE_PESSOAL';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'CONTABILIDADE';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'JURIDICO';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'ESCRITORIO';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'TAXAS_GATEWAY';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'OUTRAS_DESPESAS';

-- Deduções
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'IMPOSTO_FATURAMENTO';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'ESTORNO';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'DESCONTO_CONCEDIDO';

-- Resultado financeiro
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'RECEITA_FINANCEIRA';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'JUROS_PAGOS';
ALTER TYPE categoria_financeira ADD VALUE IF NOT EXISTS 'TARIFA_BANCARIA';

COMMIT;

-- ADD VALUE não pode ficar dentro de transação no PG < 16, então commitamos
-- antes de usar os novos valores. As alterações de tabela abaixo são idempotentes.

-- ─── 2. Novos campos ───────────────────────────────────────────────────

ALTER TABLE public.lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS data_competencia DATE,
  ADD COLUMN IF NOT EXISTS data_pagamento DATE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pago',
  ADD COLUMN IF NOT EXISTS impacta_dre BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS grupo_dre TEXT,
  ADD COLUMN IF NOT EXISTS subcategoria TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id UUID;

-- Backfill: data_competencia padrão = data existente (competência = mês do fato)
UPDATE public.lancamentos_financeiros
SET data_competencia = data
WHERE data_competencia IS NULL;

-- Lançamentos com fatura_id vieram de pagamento de aluguel → source_type = rental
UPDATE public.lancamentos_financeiros
SET source_type = 'rental', source_id = fatura_id
WHERE fatura_id IS NOT NULL AND source_type = 'manual';

-- Lançamentos com contrato_id → source_type = contract (se ainda manual)
UPDATE public.lancamentos_financeiros
SET source_type = 'contract', source_id = contrato_id
WHERE contrato_id IS NOT NULL AND source_type = 'manual' AND source_id IS NULL;

-- ─── 3. Índices para consultas DRE ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_lancamentos_competencia
  ON public.lancamentos_financeiros (data_competencia);

CREATE INDEX IF NOT EXISTS idx_lancamentos_grupo_dre
  ON public.lancamentos_financeiros (grupo_dre);

CREATE INDEX IF NOT EXISTS idx_lancamentos_impacta_dre
  ON public.lancamentos_financeiros (impacta_dre) WHERE impacta_dre = true;

-- ─── 4. Constraint de status ───────────────────────────────────────────

ALTER TABLE public.lancamentos_financeiros
  DROP CONSTRAINT IF EXISTS chk_lancamento_status;

ALTER TABLE public.lancamentos_financeiros
  ADD CONSTRAINT chk_lancamento_status
  CHECK (status IN ('pago', 'pendente', 'cancelado'));
