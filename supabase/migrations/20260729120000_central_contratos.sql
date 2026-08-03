-- =============================================================================
-- Central de Contratos (V1) — fundação de banco
-- Aplicada em produção em 2026-07-29.
--
-- Objetivo: permitir "jogar" um contrato (exclusividade / compra e venda),
-- registrar o VENCIMENTO (data_fim) e disparar alertas automáticos conforme a
-- data se aproxima (20/15/10/no dia + vencido). Reusa contratos + alertas
-- (que já tem contrato_id e data_alerta) + pg_cron + o Dashboard de alertas.
-- =============================================================================

BEGIN;

-- 1. contratos: vencimento + observações; cliente/imóvel opcionais (contrato pode
--    ser salvo antes de associar). Aditivo e seguro — dados existentes intactos.
ALTER TABLE public.contratos
    ADD COLUMN IF NOT EXISTS data_fim DATE,
    ADD COLUMN IF NOT EXISTS observacoes TEXT;

ALTER TABLE public.contratos ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE public.contratos ALTER COLUMN imovel_id  DROP NOT NULL;

COMMENT ON COLUMN public.contratos.data_fim IS
    'Vencimento do contrato (fim da exclusividade / prazo da venda). Base dos alertas.';

-- 2. Gerador de alertas de vencimento (SECURITY DEFINER — roda p/ todos os tenants,
--    igual generate_monthly_rent_bills). Idempotente via NOT EXISTS por
--    (contrato_id, data_alerta). Degraus 20/15/10/no dia + vencido.
CREATE OR REPLACE FUNCTION public.gerar_alertas_vencimento_contratos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    c            RECORD;
    t           INT;
    alerta_date DATE;
    dias        INT;
    prio        prioridade_alerta;
    criados     INT := 0;
    thresholds  INT[] := ARRAY[20, 15, 10, 0];
BEGIN
    FOR c IN
        SELECT ct.id, ct.corretor_id, ct.imovel_id, ct.data_fim, ct.tipo,
               i.titulo AS imovel_titulo
        FROM public.contratos ct
        LEFT JOIN public.imoveis i ON i.id = ct.imovel_id
        WHERE ct.data_fim IS NOT NULL
          AND ct.data_fim >= CURRENT_DATE - 1
          AND ct.tipo IN ('EXCLUSIVIDADE_VENDA', 'EXCLUSIVIDADE_LOCACAO', 'COMPRA_VENDA')
          AND COALESCE(ct.status, '') NOT IN ('ARQUIVADO', 'RESCINDIDO', 'CANCELADO')
    LOOP
        -- Degraus de antecedência
        FOREACH t IN ARRAY thresholds LOOP
            alerta_date := c.data_fim - t;
            IF CURRENT_DATE >= alerta_date AND CURRENT_DATE <= c.data_fim THEN
                dias := (c.data_fim - CURRENT_DATE);
                prio := (CASE WHEN dias <= 10 THEN 'ALTA'
                              WHEN dias <= 20 THEN 'MEDIA'
                              ELSE 'BAIXA' END)::prioridade_alerta;
                IF NOT EXISTS (
                    SELECT 1 FROM public.alertas a
                    WHERE a.contrato_id = c.id AND a.tipo = 'EXCLUSIVIDADE'
                      AND a.data_alerta = alerta_date
                ) THEN
                    INSERT INTO public.alertas
                        (corretor_id, contrato_id, imovel_id, tipo, prioridade, data_alerta, mensagem, lido)
                    VALUES
                        (c.corretor_id, c.id, c.imovel_id, 'EXCLUSIVIDADE', prio, alerta_date,
                         'Contrato "' || COALESCE(c.imovel_titulo, 'imóvel') || '" vence em ' || dias
                         || ' dia(s) — ' || to_char(c.data_fim, 'DD/MM/YYYY') || '. Trabalhe até essa data.',
                         false);
                    criados := criados + 1;
                END IF;
            END IF;
        END LOOP;

        -- Vencido (uma vez, no dia seguinte)
        IF CURRENT_DATE = c.data_fim + 1 THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.alertas a
                WHERE a.contrato_id = c.id AND a.tipo = 'EXCLUSIVIDADE'
                  AND a.data_alerta = c.data_fim + 1
            ) THEN
                INSERT INTO public.alertas
                    (corretor_id, contrato_id, imovel_id, tipo, prioridade, data_alerta, mensagem, lido)
                VALUES
                    (c.corretor_id, c.id, c.imovel_id, 'EXCLUSIVIDADE', 'ALTA', c.data_fim + 1,
                     'Contrato "' || COALESCE(c.imovel_titulo, 'imóvel') || '" VENCEU em '
                     || to_char(c.data_fim, 'DD/MM/YYYY') || '.', false);
                criados := criados + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN criados;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.gerar_alertas_vencimento_contratos() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.gerar_alertas_vencimento_contratos() TO service_role;

-- 3. pg_cron: diário 08h UTC (05h BRT)
DO $$
DECLARE j RECORD;
BEGIN
    FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'gerar-alertas-vencimento' LOOP
        PERFORM cron.unschedule(j.jobid);
    END LOOP;
END $$;

SELECT cron.schedule('gerar-alertas-vencimento', '0 8 * * *',
    $$SELECT public.gerar_alertas_vencimento_contratos()$$);

COMMIT;
