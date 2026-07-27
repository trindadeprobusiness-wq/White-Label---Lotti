-- =============================================================================
-- Financeiro: dedup de comissões de locação + trava (1 comissão por fatura)
-- Aplicada em produção em 2026-07-27.
--
-- CAUSA da duplicação: o script scripts/sync_faturas_financeiro.js (removido nesta
-- entrega) rodava com a ANON key. O RLS esconde do anônimo os lançamentos do
-- corretor, então a checagem de idempotência do script (select por contrato/
-- categoria/valor) SEMPRE voltava vazia e ele REINSERIA a comissão
-- ("Comissão Adm (X%) - <imóvel> (Sync)"). Rodado ~20x => até 20 comissões por
-- fatura. O trigger do banco (handle_bill_payment) já é a FONTE ÚNICA correta e
-- idempotente ("Taxa Adm - Fatura MM/YYYY"); os repasses nunca duplicaram
-- (UNIQUE(fatura_origem_id)).
-- =============================================================================

BEGIN;

-- 1. Vínculo lançamento -> fatura (fonte da trava).
ALTER TABLE public.lancamentos_financeiros
    ADD COLUMN IF NOT EXISTS fatura_id UUID REFERENCES public.faturas_aluguel(id) ON DELETE SET NULL;

-- 3. Backfill: casa cada comissão à sua fatura por contrato + data de pagamento +
--    valor da taxa (valor_aluguel * taxa%).
UPDATE public.lancamentos_financeiros l
SET fatura_id = f.id
FROM public.faturas_aluguel f
JOIN public.contratos c ON c.id = f.contrato_id
WHERE l.categoria = 'COMISSAO_LOCACAO'
  AND l.fatura_id IS NULL
  AND l.contrato_id = f.contrato_id
  AND f.status = 'PAGO'
  AND f.data_pagamento IS NOT NULL
  AND l.data = f.data_pagamento
  AND round(l.valor, 2) = round(f.valor_aluguel * (COALESCE(c.taxa_administracao_percentual, 10) / 100.0), 2);

-- 3b. Tabela de backup — criada DEPOIS da coluna fatura_id, para casar com SELECT *.
CREATE TABLE IF NOT EXISTS public._backup_lancamentos_dup_20260727
    AS TABLE public.lancamentos_financeiros WITH NO DATA;

-- 4. Backup das duplicatas: mantém 1 por fatura (ou por contrato+data+valor quando
--    sem fatura_id), preferindo a linha canônica do trigger ("Taxa Adm ...") e a
--    mais antiga.
INSERT INTO public._backup_lancamentos_dup_20260727
SELECT lf.*
FROM public.lancamentos_financeiros lf
JOIN (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY COALESCE(fatura_id::text, contrato_id::text || '|' || data::text || '|' || valor::text)
        ORDER BY (fatura_id IS NOT NULL) DESC, (descricao LIKE 'Taxa Adm%') DESC, created_at, id
    ) AS rn
    FROM public.lancamentos_financeiros
    WHERE categoria = 'COMISSAO_LOCACAO'
) r ON r.id = lf.id
WHERE r.rn > 1;

-- 5. Apaga as duplicatas (exatamente o que foi para o backup).
DELETE FROM public.lancamentos_financeiros
WHERE id IN (SELECT id FROM public._backup_lancamentos_dup_20260727);

-- 6. Trava: no máximo 1 comissão de locação por fatura.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lancamento_comissao_fatura
    ON public.lancamentos_financeiros (fatura_id)
    WHERE fatura_id IS NOT NULL AND categoria = 'COMISSAO_LOCACAO';

-- 7. Trigger endurecido: a comissão passa a vincular a fatura (fatura_id),
--    deixa de ser "recorrente" (é evento pontual da fatura) e não duplica
--    (ON CONFLICT DO NOTHING, além do guard de repasse já existente).
CREATE OR REPLACE FUNCTION public.handle_bill_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_contract RECORD;
    v_admin_fee DECIMAL(15,2);
    v_owner_net DECIMAL(15,2);
    v_repasse_date DATE;
    v_taxa_pct DECIMAL(8,4);
BEGIN
    IF OLD.status != 'PAGO' AND NEW.status = 'PAGO' THEN
        -- Idempotência: se a fatura já gerou repasse (webhook + UI, reentrega,
        -- dupla transição), não duplica o split.
        IF EXISTS (SELECT 1 FROM public.repasses_proprietario WHERE fatura_origem_id = NEW.id) THEN
            RETURN NEW;
        END IF;

        SELECT * INTO v_contract FROM public.contratos WHERE id = NEW.contrato_id;
        v_taxa_pct  := COALESCE(v_contract.taxa_administracao_percentual, 10.00);
        v_admin_fee := NEW.valor_aluguel * (v_taxa_pct / 100);
        v_owner_net := (NEW.valor_aluguel - v_admin_fee)
                       + COALESCE(NEW.valor_condominio, 0)
                       + COALESCE(NEW.valor_iptu, 0)
                       + COALESCE(NEW.valor_extras, 0);

        BEGIN
            v_repasse_date := MAKE_DATE(
                CAST(EXTRACT(YEAR FROM NEW.data_pagamento) AS INTEGER),
                CAST(EXTRACT(MONTH FROM NEW.data_pagamento) AS INTEGER),
                v_contract.dia_repasse_proprietario);
        EXCEPTION WHEN OTHERS THEN v_repasse_date := NEW.data_pagamento; END;
        IF v_repasse_date < NEW.data_pagamento THEN
            v_repasse_date := NEW.data_pagamento + INTEGER '1';
        END IF;

        INSERT INTO public.repasses_proprietario
            (fatura_origem_id, contrato_id, corretor_id, proprietario_id, proprietario_nome,
             data_prevista, valor_bruto_recebido, valor_taxa_adm, valor_liquido_repasse, status)
        VALUES
            (NEW.id, v_contract.id, NEW.corretor_id,
             (SELECT proprietario_id FROM public.imoveis WHERE id = NEW.imovel_id),
             (SELECT proprietario_nome FROM public.imoveis WHERE id = NEW.imovel_id),
             v_repasse_date, NEW.valor_pago, v_admin_fee, v_owner_net, 'AGENDADO')
        ON CONFLICT (fatura_origem_id) WHERE fatura_origem_id IS NOT NULL DO NOTHING;

        -- Guard de repasse acima já garante execução única; a comissão vincula a
        -- fatura (fatura_id) e o índice parcial uq_lancamento_comissao_fatura é o
        -- backstop rígido contra qualquer duplicata futura.
        INSERT INTO public.lancamentos_financeiros
            (corretor_id, tipo, categoria, descricao, valor, data, recorrente,
             contrato_id, imovel_id, comprovante_url, fatura_id)
        VALUES
            (NEW.corretor_id, 'RECEITA', 'COMISSAO_LOCACAO',
             'Taxa Adm - Fatura ' || NEW.mes_referencia, v_admin_fee, NEW.data_pagamento,
             FALSE, NEW.contrato_id, NEW.imovel_id, NEW.comprovante_url, NEW.id);

        -- Snapshot auditável do cálculo do split
        INSERT INTO public.auditoria_financeira
            (corretor_id, entidade, entidade_id, acao, dados_antes, dados_depois, calculo, origem, ator)
        VALUES
            (NEW.corretor_id, 'faturas_aluguel', NEW.id, 'PAGO',
             jsonb_build_object('status', OLD.status),
             jsonb_build_object('status', NEW.status, 'valor_pago', NEW.valor_pago,
                                'data_pagamento', NEW.data_pagamento),
             jsonb_build_object('taxa_adm_pct', v_taxa_pct, 'base', NEW.valor_aluguel,
                                'valor_taxa', v_admin_fee, 'liquido_repasse', v_owner_net,
                                'data_repasse_prevista', v_repasse_date),
             'trigger', COALESCE(auth.uid()::text, 'system'));
    END IF;
    RETURN NEW;
END;
$function$;

COMMIT;
