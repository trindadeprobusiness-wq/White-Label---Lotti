-- Corrige a DATA DE VENCIMENTO das faturas de aluguel.
--
-- Bug: o gerador mensal `generate_monthly_rent_bills` calculava o vencimento a
-- partir de `contratos.dia_vencimento_aluguel` (default 10, que ninguém edita
-- pela UI), e não de `contratos.dia_vencimento` (o dia real que a UI/lista e o
-- formulário de contrato usam). Resultado: todo boleto saía no dia 10, enquanto
-- a lista mostrava o dia correto do inquilino → descasamento no boleto do Asaas.
--
-- Correção:
--   1. Gerador passa a usar COALESCE(dia_vencimento, dia_vencimento_aluguel, 10).
--   2. Backfill das faturas NÃO pagas (PENDENTE/ATRASADO) para o dia correto.
--      Não toca em PAGO/CANCELADO.
BEGIN;

-- 1. Gerador mensal: usa o dia_vencimento canônico da UI (com fallbacks)
CREATE OR REPLACE FUNCTION public.generate_monthly_rent_bills(reference_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    contract RECORD;
    bills_created INTEGER := 0;
    target_month_str CHAR(7);
    due_date DATE;
BEGIN
    target_month_str := TO_CHAR(reference_date, 'MM/YYYY');

    FOR contract IN
        SELECT * FROM public.contratos
        WHERE status = 'ATIVO'
          AND tipo IN ('LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL')
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.faturas_aluguel
            WHERE contrato_id = contract.id
              AND mes_referencia = target_month_str
        ) THEN
            -- Dia de vencimento: o mesmo que a UI usa (dia_vencimento). Fallbacks
            -- para a coluna legada e, por fim, 10. Mês curto (ex.: dia 31 em fev)
            -- cai no fallback abaixo.
            BEGIN
                due_date := MAKE_DATE(
                    CAST(EXTRACT(YEAR FROM reference_date) AS INTEGER),
                    CAST(EXTRACT(MONTH FROM reference_date) AS INTEGER),
                    COALESCE(contract.dia_vencimento, contract.dia_vencimento_aluguel, 10)
                );
            EXCEPTION WHEN OTHERS THEN
                due_date := (date_trunc('month', reference_date) + interval '1 month - 1 day')::date;
            END;

            INSERT INTO public.faturas_aluguel (
                contrato_id,
                cliente_id,
                imovel_id,
                corretor_id,
                mes_referencia,
                data_vencimento,
                valor_aluguel,
                valor_condominio,
                valor_iptu,
                status
            ) VALUES (
                contract.id,
                contract.cliente_id,
                contract.imovel_id,
                contract.corretor_id,
                target_month_str,
                due_date,
                contract.valor,
                0,
                0,
                'PENDENTE'
            );

            bills_created := bills_created + 1;
        END IF;
    END LOOP;

    RETURN bills_created;
END;
$$;

-- 2. Backfill: faturas não pagas passam a ter o dia correto do contrato.
UPDATE public.faturas_aluguel f
SET data_vencimento = make_date(sub.yr, sub.mo, LEAST(sub.day_target, sub.last_day))
FROM (
    SELECT f2.id,
           split_part(f2.mes_referencia, '/', 2)::int AS yr,
           split_part(f2.mes_referencia, '/', 1)::int AS mo,
           COALESCE(c.dia_vencimento, c.dia_vencimento_aluguel, 10) AS day_target,
           EXTRACT(DAY FROM (
               date_trunc('month', make_date(
                   split_part(f2.mes_referencia, '/', 2)::int,
                   split_part(f2.mes_referencia, '/', 1)::int, 1))
               + interval '1 month - 1 day'))::int AS last_day
    FROM public.faturas_aluguel f2
    JOIN public.contratos c ON c.id = f2.contrato_id
    WHERE f2.status IN ('PENDENTE', 'ATRASADO')
      AND f2.mes_referencia ~ '^[0-9]{2}/[0-9]{4}$'
) sub
WHERE f.id = sub.id
  AND f.data_vencimento IS DISTINCT FROM make_date(sub.yr, sub.mo, LEAST(sub.day_target, sub.last_day));

COMMIT;
