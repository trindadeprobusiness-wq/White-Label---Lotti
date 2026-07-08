-- =============================================================================
-- FASE 1 — Fundações de banco do núcleo financeiro Asaas
-- (plano: docs/ASAAS-INTEGRACAO.md §4; aplicada em produção em 2026-07-08)
--
-- 0. Limpeza de faturas gêmeas (mesmo contrato+mês, ambas PAGO com mesmos
--    valores) e de seus repasses — o FK repasses->faturas é ON DELETE SET
--    NULL, então o repasse gêmeo é removido explicitamente antes.
-- 1. asaas_webhook_events — eventos de webhook com idempotência (UNIQUE event_id)
-- 2. job_queue + claim_jobs() — fila de trabalhos com FOR UPDATE SKIP LOCKED
-- 3. auditoria_financeira — trilha imutável (append-only)
-- 4. proprietarios + contratos_renegociacoes — entidades novas
-- 5. Endurecimento das tabelas existentes (colunas, CHECKs, uniques, WITH CHECK)
-- 6. Functions financeiras endurecidas (search_path, idempotência, auditoria)
-- 7. pg_cron + pg_net e os 3 agendamentos da Fase 1
-- 8. Backfill de proprietarios a partir de imoveis
-- 9. Materialização das faturas da competência corrente (fim das faturas virtuais)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Faturas gêmeas: mantém a mais antiga (menor created_at), remove a cópia
--    e o repasse pendurado nela. Só afeta duplicatas exatas com status PAGO.
-- ---------------------------------------------------------------------------
WITH gemeas AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY contrato_id, mes_referencia
               ORDER BY (status = 'PAGO') DESC, created_at, id
           ) AS posicao
    FROM public.faturas_aluguel
)
DELETE FROM public.repasses_proprietario
WHERE status = 'AGENDADO'              -- nunca apaga repasse já enviado/confirmado
  AND fatura_origem_id IN (SELECT id FROM gemeas WHERE posicao > 1);

WITH gemeas AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY contrato_id, mes_referencia
               ORDER BY (status = 'PAGO') DESC, created_at, id
           ) AS posicao
    FROM public.faturas_aluguel
)
DELETE FROM public.faturas_aluguel
WHERE id IN (SELECT id FROM gemeas WHERE posicao > 1);

-- ---------------------------------------------------------------------------
-- 1. Eventos de webhook com idempotência
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asaas_webhook_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      TEXT NOT NULL,          -- payload.id do Asaas (evt_...) ou hash determinístico
    event_type    TEXT NOT NULL,
    payment_id    TEXT,
    payload       JSONB NOT NULL,
    status        TEXT NOT NULL DEFAULT 'RECEIVED'
                  CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','IGNORED','FAILED')),
    attempts      INT  NOT NULL DEFAULT 0,
    last_error    TEXT,
    corretor_id   UUID REFERENCES public.corretores(id) ON DELETE SET NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at  TIMESTAMPTZ,
    CONSTRAINT uq_asaas_webhook_event UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_awe_pending ON public.asaas_webhook_events (status, received_at)
    WHERE status IN ('RECEIVED','FAILED');
CREATE INDEX IF NOT EXISTS idx_awe_payment ON public.asaas_webhook_events (payment_id);

ALTER TABLE public.asaas_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Corretor le seus eventos" ON public.asaas_webhook_events;
CREATE POLICY "Corretor le seus eventos" ON public.asaas_webhook_events
    FOR SELECT TO authenticated
    USING (corretor_id = public.get_corretor_id());
-- (sem policies de escrita: apenas service_role/definer escrevem)

-- ---------------------------------------------------------------------------
-- 2. Fila de jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_queue (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_type      TEXT NOT NULL CHECK (job_type IN (
                    'ensure_customer','create_payment','cancel_payment',
                    'create_transfer','send_notification','reconcile_payment')),
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key    TEXT,
    status        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PROCESSING','RETRYING','DONE','FAILED')),
    attempts      INT  NOT NULL DEFAULT 0,
    max_attempts  INT  NOT NULL DEFAULT 5,
    run_after     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error    TEXT,
    corretor_id   UUID REFERENCES public.corretores(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,
    CONSTRAINT uq_job_dedupe UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_job_queue_claim ON public.job_queue (run_after)
    WHERE status IN ('PENDING','RETRYING');

ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Corretor le seus jobs" ON public.job_queue;
CREATE POLICY "Corretor le seus jobs" ON public.job_queue
    FOR SELECT TO authenticated USING (corretor_id = public.get_corretor_id());

CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit INT DEFAULT 10)
RETURNS SETOF public.job_queue
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE job_queue j SET status = 'PROCESSING', started_at = now(), attempts = attempts + 1
    WHERE j.id IN (
        SELECT id FROM job_queue
        WHERE status IN ('PENDING','RETRYING') AND run_after <= now()
        ORDER BY id
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    RETURNING j.*;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_jobs(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Trilha de auditoria imutável
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auditoria_financeira (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    corretor_id  UUID,
    entidade     TEXT NOT NULL,
    entidade_id  UUID NOT NULL,
    acao         TEXT NOT NULL,
    dados_antes  JSONB,
    dados_depois JSONB,
    calculo      JSONB,
    origem       TEXT NOT NULL CHECK (origem IN ('ui','webhook','cron','worker','trigger','migracao')),
    ator         TEXT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON public.auditoria_financeira (entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_tenant   ON public.auditoria_financeira (corretor_id, criado_em);

ALTER TABLE public.auditoria_financeira ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Corretor le sua auditoria" ON public.auditoria_financeira;
CREATE POLICY "Corretor le sua auditoria" ON public.auditoria_financeira
    FOR SELECT TO authenticated USING (corretor_id = public.get_corretor_id());

REVOKE UPDATE, DELETE ON public.auditoria_financeira FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.bloquear_mutacao_auditoria()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'auditoria_financeira é append-only'; END $$;
DROP TRIGGER IF EXISTS tr_auditoria_imutavel ON public.auditoria_financeira;
CREATE TRIGGER tr_auditoria_imutavel
    BEFORE UPDATE OR DELETE ON public.auditoria_financeira
    FOR EACH ROW EXECUTE FUNCTION public.bloquear_mutacao_auditoria();

-- ---------------------------------------------------------------------------
-- 4. Proprietários e renegociações
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proprietarios (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id      UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    nome             TEXT NOT NULL,
    cpf_cnpj         TEXT,
    email            TEXT,
    telefone         TEXT,
    chave_pix        TEXT,
    tipo_chave_pix   TEXT CHECK (tipo_chave_pix IN ('CPF','CNPJ','EMAIL','PHONE','EVP')),
    dados_bancarios  JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.proprietarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Corretor gerencia proprietarios" ON public.proprietarios;
CREATE POLICY "Corretor gerencia proprietarios" ON public.proprietarios
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

ALTER TABLE public.imoveis
    ADD COLUMN IF NOT EXISTS proprietario_id UUID REFERENCES public.proprietarios(id) ON DELETE SET NULL;
ALTER TABLE public.repasses_proprietario
    ADD COLUMN IF NOT EXISTS proprietario_id UUID REFERENCES public.proprietarios(id);

CREATE TABLE IF NOT EXISTS public.contratos_renegociacoes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contrato_id      UUID NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
    corretor_id      UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    tipo             TEXT NOT NULL CHECK (tipo IN ('REAJUSTE','RENEGOCIACAO','ACORDO_INADIMPLENCIA')),
    valores_antes    JSONB NOT NULL,
    valores_depois   JSONB NOT NULL,
    indice_aplicado  TEXT,
    percentual       NUMERIC(8,4),
    vigencia_inicio  DATE NOT NULL,
    motivo           TEXT,
    criado_por       UUID,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contratos_renegociacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Corretor gerencia renegociacoes" ON public.contratos_renegociacoes;
CREATE POLICY "Corretor gerencia renegociacoes" ON public.contratos_renegociacoes
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

-- ---------------------------------------------------------------------------
-- 5. Endurecimento das tabelas existentes
-- ---------------------------------------------------------------------------
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_asaas_customer
    ON public.clientes (asaas_customer_id) WHERE asaas_customer_id IS NOT NULL;

ALTER TABLE public.contratos
    ADD COLUMN IF NOT EXISTS data_proximo_reajuste DATE,
    ADD COLUMN IF NOT EXISTS data_encerramento     DATE;
DO $$ BEGIN
    ALTER TABLE public.contratos
        ADD CONSTRAINT chk_contratos_status
        CHECK (status IN ('RASCUNHO','ATIVO','ENCERRANDO','ENCERRADO','CANCELADO')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.faturas_aluguel
    ADD COLUMN IF NOT EXISTS pix_qrcode_text          TEXT,
    ADD COLUMN IF NOT EXISTS valor_encargos_recebidos NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS motivo_cancelamento      TEXT,
    ADD COLUMN IF NOT EXISTS gerada_por               TEXT DEFAULT 'manual'
        CHECK (gerada_por IN ('manual','cron','ia','migracao'));
DO $$ BEGIN
    ALTER TABLE public.faturas_aluguel
        ADD CONSTRAINT chk_faturas_status
        CHECK (status IN ('PENDENTE','PAGO','ATRASADO','CANCELADO')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Unicidade de competência (a limpeza da seção 0 garante a criação)
CREATE UNIQUE INDEX IF NOT EXISTS uq_fatura_contrato_mes
    ON public.faturas_aluguel (contrato_id, mes_referencia);

-- Policies com WITH CHECK (as atuais têm apenas USING)
DROP POLICY IF EXISTS "Corretor gerencia faturas" ON public.faturas_aluguel;
CREATE POLICY "Corretor gerencia faturas" ON public.faturas_aluguel
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());
DROP POLICY IF EXISTS "Corretor gerencia repasses" ON public.repasses_proprietario;
CREATE POLICY "Corretor gerencia repasses" ON public.repasses_proprietario
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

-- ---------------------------------------------------------------------------
-- 6. Functions financeiras endurecidas
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_corretor_id() SET search_path = public;

CREATE OR REPLACE FUNCTION public.generate_monthly_rent_bills(reference_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    contract RECORD;
    bills_created INTEGER := 0;
    target_month_str CHAR(7);
    due_date DATE;
BEGIN
    target_month_str := TO_CHAR(reference_date, 'MM/YYYY');
    FOR contract IN
        SELECT * FROM public.contratos
        WHERE status = 'ATIVO' AND tipo IN ('LOCACAO_RESIDENCIAL', 'LOCACAO_COMERCIAL')
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.faturas_aluguel
            WHERE contrato_id = contract.id AND mes_referencia = target_month_str
        ) THEN
            BEGIN
                due_date := MAKE_DATE(
                    CAST(EXTRACT(YEAR FROM reference_date) AS INTEGER),
                    CAST(EXTRACT(MONTH FROM reference_date) AS INTEGER),
                    contract.dia_vencimento_aluguel);
            EXCEPTION WHEN OTHERS THEN
                -- dia 29-31 em mês curto: usa o último dia do mês
                due_date := (date_trunc('month', reference_date) + interval '1 month - 1 day')::date;
            END;
            INSERT INTO public.faturas_aluguel
                (contrato_id, cliente_id, imovel_id, corretor_id, mes_referencia,
                 data_vencimento, valor_aluguel, status, gerada_por)
            VALUES
                (contract.id, contract.cliente_id, contract.imovel_id, contract.corretor_id,
                 target_month_str, due_date, contract.valor, 'PENDENTE', 'cron')
            ON CONFLICT (contrato_id, mes_referencia) DO NOTHING;
            bills_created := bills_created + 1;
        END IF;
    END LOOP;

    INSERT INTO public.auditoria_financeira
        (corretor_id, entidade, entidade_id, acao, calculo, origem, ator)
    VALUES
        (NULL, 'faturas_aluguel', gen_random_uuid(), 'GERACAO_MENSAL',
         jsonb_build_object('mes_referencia', target_month_str, 'faturas_criadas', bills_created),
         'cron', 'system');
    RETURN bills_created;
END;
$function$;

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

        INSERT INTO public.lancamentos_financeiros
            (corretor_id, tipo, categoria, descricao, valor, data, recorrente,
             contrato_id, imovel_id, comprovante_url)
        VALUES
            (NEW.corretor_id, 'RECEITA', 'COMISSAO_LOCACAO',
             'Taxa Adm - Fatura ' || NEW.mes_referencia, v_admin_fee, NEW.data_pagamento,
             TRUE, NEW.contrato_id, NEW.imovel_id, NEW.comprovante_url);

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

-- ---------------------------------------------------------------------------
-- 7. pg_cron + pg_net e agendamentos da Fase 1
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE j RECORD;
BEGIN
    FOR j IN SELECT jobid FROM cron.job
             WHERE jobname IN ('gerar-faturas-mensais','marcar-faturas-atrasadas','sweeper-webhook-events')
    LOOP
        PERFORM cron.unschedule(j.jobid);
    END LOOP;
END $$;

-- 7.1 Geração mensal: dia 25, 06h UTC (03h BRT) — gera a competência seguinte
SELECT cron.schedule('gerar-faturas-mensais', '0 6 25 * *',
    $$SELECT public.generate_monthly_rent_bills((date_trunc('month', now()) + interval '1 month')::date)$$);

-- 7.2 Marcar atrasadas: diário 07h UTC (04h BRT) — status persistido no banco
SELECT cron.schedule('marcar-faturas-atrasadas', '0 7 * * *',
    $$UPDATE public.faturas_aluguel
      SET status = 'ATRASADO'
      WHERE status = 'PENDENTE' AND data_vencimento < CURRENT_DATE$$);

-- 7.3 Sweeper: eventos de webhook presos em PROCESSING voltam para retry
SELECT cron.schedule('sweeper-webhook-events', '*/5 * * * *',
    $$UPDATE public.asaas_webhook_events
      SET status = 'RECEIVED'
      WHERE status = 'PROCESSING' AND received_at < now() - interval '10 minutes'$$);

-- ---------------------------------------------------------------------------
-- 8. Backfill: proprietarios a partir de imoveis (idempotente)
-- ---------------------------------------------------------------------------
INSERT INTO public.proprietarios (corretor_id, nome, cpf_cnpj, email, telefone)
SELECT DISTINCT ON (i.corretor_id, lower(trim(i.proprietario_nome)))
       i.corretor_id, trim(i.proprietario_nome), i.proprietario_cpf,
       i.proprietario_email, i.proprietario_telefone
FROM public.imoveis i
WHERE i.proprietario_nome IS NOT NULL
  AND trim(i.proprietario_nome) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM public.proprietarios p
      WHERE p.corretor_id = i.corretor_id
        AND lower(trim(p.nome)) = lower(trim(i.proprietario_nome))
  );

UPDATE public.imoveis i
SET proprietario_id = p.id
FROM public.proprietarios p
WHERE i.proprietario_id IS NULL
  AND i.proprietario_nome IS NOT NULL
  AND p.corretor_id = i.corretor_id
  AND lower(trim(p.nome)) = lower(trim(i.proprietario_nome));

-- ---------------------------------------------------------------------------
-- 9. Materializa a competência corrente (o frontend prioriza faturas do banco)
-- ---------------------------------------------------------------------------
SELECT public.generate_monthly_rent_bills(date_trunc('month', now())::date);

-- Vencimentos já passados da competência corrente entram como ATRASADO
UPDATE public.faturas_aluguel
SET status = 'ATRASADO'
WHERE status = 'PENDENTE' AND data_vencimento < CURRENT_DATE;
