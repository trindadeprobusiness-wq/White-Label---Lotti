-- Restaura o `SET search_path = public` em `generate_monthly_rent_bills`.
--
-- Contexto: `20260708150000_asaas_core_financeiro.sql` deliberadamente adicionou
-- `SET search_path = public` a essa função SECURITY DEFINER (hardening contra
-- CWE-426 — resolução de nome via search_path do caller). A redefinição em
-- `20260804120000_fatura_vencimento_dia_correto.sql` corrigiu o cálculo do
-- vencimento mas esqueceu de repetir o `SET search_path`, resetando-o para NULL
-- (comportamento do CREATE OR REPLACE: só os atributos declarados são mantidos).
--
-- Impacto residual: baixo. Os REVOKE EXECUTE FROM PUBLIC/anon/authenticated
-- sobrevivem ao CREATE OR REPLACE, então a superfície é service_role/postgres.
-- Todas as referências no corpo já são schema-qualificadas (public.contratos,
-- public.faturas_aluguel). Isto é hardening perdido, não vulnerabilidade aberta.
BEGIN;

CREATE OR REPLACE FUNCTION public.generate_monthly_rent_bills(reference_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

COMMIT;
