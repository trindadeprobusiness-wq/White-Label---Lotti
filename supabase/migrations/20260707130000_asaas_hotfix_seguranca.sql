-- =============================================================================
-- HOTFIX de segurança da integração Asaas (2026-07-07)
-- 0. Limpa repasses DUPLICADOS já existentes (o erro 23505 na primeira
--    execução provou que o bug já aconteceu em produção): para cada fatura,
--    mantém o melhor repasse (CONFIRMADO > ENVIADO > demais; depois o mais
--    antigo) e apaga as cópias.
-- 1. Trava anti-repasse-duplicado: o Asaas envia PAYMENT_CONFIRMED e depois
--    PAYMENT_RECEIVED para o mesmo pagamento (e reentrega em timeouts).
--    Sem esta trava, cada evento criaria um repasse ao proprietário.
-- 2. Fecha o vazamento cross-tenant de webhook_logs: as policies criadas em
--    20260320000000 usam USING (true) — qualquer usuário autenticado lê os
--    payloads de pagamento (nome, CPF, valores) de TODOS os corretores.
-- Pode ser executada com segurança mais de uma vez (idempotente).
-- =============================================================================

-- 0. Remove duplicados, preservando 1 repasse por fatura
WITH ranqueados AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY fatura_origem_id
               ORDER BY CASE status
                            WHEN 'CONFIRMADO' THEN 0
                            WHEN 'ENVIADO'    THEN 1
                            ELSE 2
                        END,
                        created_at NULLS LAST,
                        id
           ) AS posicao
    FROM public.repasses_proprietario
    WHERE fatura_origem_id IS NOT NULL
)
DELETE FROM public.repasses_proprietario r
USING ranqueados q
WHERE r.id = q.id
  AND q.posicao > 1;

-- 1. Um repasse por fatura, garantido por constraint (não por código)
CREATE UNIQUE INDEX IF NOT EXISTS uq_repasse_por_fatura
    ON public.repasses_proprietario (fatura_origem_id)
    WHERE fatura_origem_id IS NOT NULL;

-- 2. webhook_logs: remover policies permissivas; sem policy = invisível para
--    authenticated/anon; o service_role continua operando normalmente.
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to insert webhook logs" ON public.webhook_logs;
DROP POLICY IF EXISTS "Allow authenticated users to select their webhook logs" ON public.webhook_logs;
DROP POLICY IF EXISTS "Allow authenticated users to update webhook logs" ON public.webhook_logs;

COMMENT ON TABLE public.webhook_logs IS
    'Log de webhooks (Asaas). Acesso exclusivo do service_role desde 2026-07-07; será substituída por asaas_webhook_events na Fase 1 do plano docs/ASAAS-INTEGRACAO.md.';
