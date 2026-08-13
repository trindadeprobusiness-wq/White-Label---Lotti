-- ---------------------------------------------------------------------------
-- Isolamento entre contas — fecha os vazamentos que impedem o Lotti de receber
-- um segundo usuário com segurança.
--
-- O sistema JÁ é multi-tenant: handle_new_user() cria um corretor por cadastro
-- e ~30 tabelas têm RLS por get_corretor_id(). O problema não é a arquitetura,
-- são policies permissivas específicas que anulam as corretas.
--
-- Por que anulam: o Postgres combina policies permissivas com OR. Uma única
-- policy `USING (true)` ao lado de dez policies escopadas faz a tabela inteira
-- virar pública. Foi o que aconteceu em imovel_fotos e fachadas.
--
-- Idempotente. Não apaga dado nenhum.
-- ---------------------------------------------------------------------------

-- ── 1. imovel_fotos: fotos de TODOS os corretores estavam públicas ────────
-- A policy abaixo é de 20260106010609 e nunca foi removida. `TO public` cobre
-- anon E authenticated, então ela anulava tanto a policy do dono quanto a
-- policy de leitura pública restrita a imóveis anunciados (20260519140000).
-- Efeito real: qualquer um com a chave anon (que está no bundle JS) listava
-- arquivo_url de todo imóvel de todo corretor, inclusive os fora do mercado.
DROP POLICY IF EXISTS "Fotos de imoveis sao visiveis publicamente" ON public.imovel_fotos;

-- Garante que a leitura pública correta exista: anon só vê foto de imóvel que
-- o corretor marcou como anunciado e disponível.
DROP POLICY IF EXISTS "Leitura pública de fotos de imóveis anunciados" ON public.imovel_fotos;
CREATE POLICY "Leitura pública de fotos de imóveis anunciados"
    ON public.imovel_fotos FOR SELECT TO anon
    USING (
        imovel_id IN (
            SELECT id FROM public.imoveis
            WHERE anunciado = TRUE AND ativo = TRUE AND status_venda = 'DISPONIVEL'
        )
    );

-- ── 2. fachadas: tabela inteira estava legível por qualquer papel ─────────
-- `USING (ativo = true)` sem TO vale para PUBLIC. A landing pública do QR não
-- depende disto: a Edge Function `fachada-publica` roda com service role e
-- devolve um conjunto curado de campos. Remover fecha o buraco sem quebrar nada.
DROP POLICY IF EXISTS "Publico ve fachadas ativas" ON public.fachadas;

-- ── 3. Captação pública: aceitar lead sem virar porta de escrita livre ────
-- fachada_leads e fachada_escaneamentos precisam de INSERT anônimo (o formulário
-- da landing), mas `WITH CHECK (true)` deixa injetar lead em QUALQUER fachada,
-- inclusive inexistente ou desativada, e inflar métrica alheia.
-- Amarrar a uma fachada ativa mantém o formulário funcionando e fecha o resto.
DO $$
BEGIN
    IF to_regclass('public.fachada_leads') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Publico cria lead" ON public.fachada_leads;
        CREATE POLICY "Publico cria lead em fachada ativa"
            ON public.fachada_leads FOR INSERT
            WITH CHECK (fachada_id IN (SELECT id FROM public.fachadas WHERE ativo = TRUE));
    END IF;

    IF to_regclass('public.fachada_escaneamentos') IS NOT NULL THEN
        DROP POLICY IF EXISTS "Publico registra escaneamento" ON public.fachada_escaneamentos;
        CREATE POLICY "Publico registra escaneamento em fachada ativa"
            ON public.fachada_escaneamentos FOR INSERT
            WITH CHECK (fachada_id IN (SELECT id FROM public.fachadas WHERE ativo = TRUE));
    END IF;
END $$;

-- ── 4. Assinatura: o usuário podia reescrever o próprio plano ─────────────
-- As policies eram `FOR ALL USING (...)` SEM `WITH CHECK`. Em Postgres, USING
-- filtra o que é lido/alterado, mas sem WITH CHECK nada valida a linha DEPOIS
-- da escrita: dava para dar UPDATE trocando o corretor_id, ou zerar o próprio
-- contador de uso e furar o limite do plano.
DO $$
BEGIN
    IF to_regclass('public.subscriptions') IS NOT NULL THEN
        DROP POLICY IF EXISTS "subscriptions_own" ON public.subscriptions;
        CREATE POLICY "subscriptions_own" ON public.subscriptions
            FOR ALL TO authenticated
            USING (corretor_id = public.get_corretor_id())
            WITH CHECK (corretor_id = public.get_corretor_id());
    END IF;

    IF to_regclass('public.usage_counters') IS NOT NULL THEN
        DROP POLICY IF EXISTS "usage_own" ON public.usage_counters;
        CREATE POLICY "usage_own" ON public.usage_counters
            FOR ALL TO authenticated
            USING (corretor_id = public.get_corretor_id())
            WITH CHECK (corretor_id = public.get_corretor_id());
    END IF;

    IF to_regclass('public.subscription_addons') IS NOT NULL THEN
        DROP POLICY IF EXISTS "addons_own" ON public.subscription_addons;
        CREATE POLICY "addons_own" ON public.subscription_addons
            FOR ALL TO authenticated
            USING (corretor_id = public.get_corretor_id())
            WITH CHECK (corretor_id = public.get_corretor_id());
    END IF;
END $$;

-- ── 5. View de leads: garantir que respeita a RLS de quem consulta ────────
-- View comum roda com os privilégios do DONO e ignora a RLS da tabela base.
-- Já havia correção em 20260519150000, mas o probe de produção é anterior a
-- ela — reaplicar é barato e remove a dúvida.
DO $$
BEGIN
    IF to_regclass('public.v_leads_whatsapp') IS NOT NULL THEN
        EXECUTE 'ALTER VIEW public.v_leads_whatsapp SET (security_invoker = true)';
    END IF;
END $$;

-- ── 6. Storage: upload de foto voltou a ser por dono do imóvel ────────────
-- 20260715120000 trocou a policy escopada por `WITH CHECK (bucket_id = ...)`
-- para não quebrar uploads, aceitando conscientemente o risco. O resultado é
-- que qualquer usuário autenticado grava arquivo dentro da pasta de imóvel de
-- outro corretor. O caminho usado pelo app é `<imovel_id>/<timestamp>_<nome>`
-- (useImovelFotos), então dá para escopar sem quebrar nada.
DROP POLICY IF EXISTS "imoveis-fotos: upload autenticado" ON storage.objects;
CREATE POLICY "imoveis-fotos: upload no proprio imovel"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'imoveis-fotos'
        AND (storage.foldername(name))[1] IN (
            SELECT id::text FROM public.imoveis WHERE corretor_id = public.get_corretor_id()
        )
    );

-- ── 7. Leads sem destinatário ─────────────────────────────────────────────
-- `lead-capture` é público e, sem imovel_id, precisava adivinhar o corretor —
-- então lançava erro quando existia mais de um. Fail-closed está certo, mas
-- devolver 400 fazia o contato do visitante desaparecer no dia em que o segundo
-- usuário se cadastrasse. Agora o lead fica aqui para triagem manual.
CREATE TABLE IF NOT EXISTS public.leads_sem_destino (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome          TEXT NOT NULL,
    telefone      TEXT NOT NULL,
    email         TEXT,
    mensagem      TEXT,
    tracking_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    motivo        TEXT NOT NULL,
    -- Preenchido quando alguém assume o lead.
    atribuido_a   UUID REFERENCES public.corretores(id) ON DELETE SET NULL,
    atribuido_em  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.leads_sem_destino ENABLE ROW LEVEL SECURITY;

-- Sem dono definido, ninguém pode ler pelo app: só service role (a função que
-- grava) e o painel administrativo futuro. Deixar visível para todo corretor
-- seria criar o vazamento que esta migration existe para fechar.
REVOKE ALL ON public.leads_sem_destino FROM anon, authenticated;

-- ── 8. Conferência ────────────────────────────────────────────────────────
-- Depois de aplicar, rode isto e confirme que NÃO sobrou policy permissiva
-- fora do catálogo público de planos:
--
--   SELECT schemaname, tablename, policyname, roles, cmd, qual
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND (qual = 'true' OR with_check = 'true')
--    ORDER BY tablename;
--
-- Esperado: só plans, plan_entitlements e pricing_campaigns (catálogo público,
-- sem dado de tenant).

COMMENT ON POLICY "Leitura pública de fotos de imóveis anunciados" ON public.imovel_fotos IS
    'Substitui a policy USING(true) TO public que expunha as fotos de todos os corretores.';
