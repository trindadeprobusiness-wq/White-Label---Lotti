-- Estorno (desfazer) de pagamento de fatura de aluguel.
--
-- Marcar uma fatura como PAGO dispara handle_bill_payment(), que cria o repasse
-- ao proprietário (repasses_proprietario) e a comissão (lancamentos_financeiros,
-- categoria COMISSAO_LOCACAO). Voltar o status sozinho deixaria esses lançamentos
-- órfãos. Esta função reverte tudo de forma atômica e com checagem de propriedade
-- (o corretor só estorna a própria fatura).
CREATE OR REPLACE FUNCTION public.estornar_pagamento_fatura(p_fatura_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fatura RECORD;
    v_novo_status text;
BEGIN
    -- SECURITY DEFINER ignora RLS → validar a posse manualmente pelo JWT.
    SELECT f.* INTO v_fatura
    FROM public.faturas_aluguel f
    JOIN public.corretores c ON c.id = f.corretor_id
    WHERE f.id = p_fatura_id AND c.user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fatura não encontrada ou sem permissão.';
    END IF;

    IF v_fatura.status <> 'PAGO' THEN
        RAISE EXCEPTION 'Só é possível desfazer o pagamento de faturas pagas.';
    END IF;

    -- Se o repasse ao proprietário já saiu (não está mais AGENDADO), não desfazer
    -- automaticamente — evita inconsistência com dinheiro já movimentado.
    IF EXISTS (
        SELECT 1 FROM public.repasses_proprietario
        WHERE fatura_origem_id = p_fatura_id AND status <> 'AGENDADO'
    ) THEN
        RAISE EXCEPTION 'O repasse ao proprietário desta fatura já foi executado — não é possível desfazer automaticamente.';
    END IF;

    -- Remove a comissão e o repasse AGENDADO criados pelo trigger.
    DELETE FROM public.lancamentos_financeiros
    WHERE fatura_id = p_fatura_id AND categoria = 'COMISSAO_LOCACAO';

    DELETE FROM public.repasses_proprietario
    WHERE fatura_origem_id = p_fatura_id AND status = 'AGENDADO';

    -- Volta a fatura ao estado anterior (não paga).
    v_novo_status := CASE WHEN v_fatura.data_vencimento < CURRENT_DATE THEN 'ATRASADO' ELSE 'PENDENTE' END;
    UPDATE public.faturas_aluguel
    SET status = v_novo_status, data_pagamento = NULL, valor_pago = NULL
    WHERE id = p_fatura_id;

    INSERT INTO public.auditoria_financeira (corretor_id, entidade, entidade_id, acao, dados_depois, origem, ator)
    VALUES (v_fatura.corretor_id, 'faturas_aluguel', p_fatura_id, 'ESTORNO_PAGAMENTO',
            jsonb_build_object('de', 'PAGO', 'para', v_novo_status), 'ui', auth.uid()::text);

    RETURN v_novo_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.estornar_pagamento_fatura(uuid) TO authenticated;
