-- ═══════════════════════════════════════════════════════════════════════════
-- Back office — operação do SaaS Lotti (RPCs)
--
-- Mesmo contrato das RPCs de 20260814140000: SECURITY DEFINER, guard de papel
-- na primeira linha, `SET search_path = public`, e devolução em JSON para a
-- tela receber lista e totais numa viagem só.
--
-- ── Sobre tabelas de outros módulos ────────────────────────────────────────
-- Este arquivo lê `subscriptions`/`plans` (migration 20260807120000) e
-- `checkout_orders` (repositório do site, migration 20260826090000). Nenhuma
-- das duas é garantida: em 2026-09-02 o diagnóstico de produção mostrou as
-- TRÊS ausentes, apesar de o back office de agosto já as consultar.
--
-- Por isso, duas regras aqui:
--
-- 1. Nenhum tipo de outro módulo aparece em ASSINATURA de função. `p_ciclo` é
--    TEXT, não `public.billing_cycle`. Assinatura é resolvida no CREATE: um
--    enum ausente abortaria o arquivo inteiro, que foi exatamente o que
--    derrubou o deploy de 2026-09-01.
--
-- 2. Toda consulta a tabela de outro módulo é precedida de `to_regclass`.
--    Dentro de PL/pgSQL o comando só é planejado quando executado, então o
--    guard basta — a base sem aquele módulo responde "indisponível" em vez de
--    estourar, e a tela explica o que falta aplicar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Normalização de ciclo ──────────────────────────────────────────────
-- Isolada porque três consultas diferentes precisam concordar sobre quanto
-- vale um plano anual por mês. Duplicar o `CASE` seria convidar as três a
-- divergirem na próxima mudança de preço.
--
-- Recebe TEXT de propósito: ver regra 1 no cabeçalho.
CREATE OR REPLACE FUNCTION public.mrr_da_assinatura(
    p_ciclo   TEXT,
    p_mensal  NUMERIC,
    p_anual   NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE WHEN p_ciclo = 'annual'
                THEN round(COALESCE(p_anual, 0) / 12, 2)
                ELSE COALESCE(p_mensal, 0)
           END
$$;

-- ── 1. Métricas da operação SaaS ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_metricas_saas(
    p_inicio DATE,
    p_fim    DATE
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ini_ts   TIMESTAMPTZ;
    v_fim_ts   TIMESTAMPTZ;
    v_mrr           NUMERIC(14,2) := 0;
    v_mrr_risco     NUMERIC(14,2) := 0;
    v_ativos_inicio INT := 0;
    v_cancelados    INT := 0;
    v_tem_assinaturas BOOLEAN;
    v_tem_checkout  BOOLEAN;
    v_assinaturas   JSON;
    v_mrr_json      JSON;
    v_inadimplencia JSON;
    v_churn         JSON;
    v_pagamentos    JSON;
    v_resultado     JSON;
BEGIN
    PERFORM public.exigir_admin();

    IF p_inicio > p_fim THEN
        RAISE EXCEPTION 'período inválido: início depois do fim';
    END IF;

    -- Limite superior exclusivo, como nas RPCs de 20260814: `<= p_fim` perderia
    -- tudo que aconteceu depois da meia-noite do último dia.
    v_ini_ts := p_inicio::TIMESTAMPTZ;
    v_fim_ts := (p_fim + 1)::TIMESTAMPTZ;

    v_tem_assinaturas := to_regclass('public.subscriptions') IS NOT NULL
                     AND to_regclass('public.plans') IS NOT NULL;

    IF v_tem_assinaturas THEN
        -- MRR só de assinatura ativa. `past_due` continua contratada mas não
        -- está pagando: somá-la ao MRR transformaria inadimplência em receita
        -- no gráfico, que é o erro que mais atrasa a percepção de um problema
        -- de cobrança. Ela aparece separada, como MRR em risco.
        SELECT
            COALESCE(SUM(CASE WHEN s.status::TEXT = 'active'
                              THEN public.mrr_da_assinatura(s.billing_cycle::TEXT, p.monthly_price, p.annual_price) END), 0),
            COALESCE(SUM(CASE WHEN s.status::TEXT = 'past_due'
                              THEN public.mrr_da_assinatura(s.billing_cycle::TEXT, p.monthly_price, p.annual_price) END), 0)
        INTO v_mrr, v_mrr_risco
        FROM public.subscriptions s
        JOIN public.plans p ON p.id = s.plan_id;

        -- Churn do período. Reconstrução aproximada, e vale saber por quê: a
        -- linha de `subscriptions` é atualizada no lugar pelo provisionamento
        -- do site, então não há histórico de status. "Ativa no início" é
        -- deduzida de created_at anterior ao período e cancelamento posterior
        -- a ele. Uma conta que cancelou e voltou aparece só no estado atual.
        SELECT count(*) INTO v_ativos_inicio
        FROM public.subscriptions s
        WHERE s.created_at < v_ini_ts
          AND (s.canceled_at IS NULL OR s.canceled_at >= v_ini_ts);

        SELECT count(*) INTO v_cancelados
        FROM public.subscriptions s
        WHERE s.canceled_at >= v_ini_ts AND s.canceled_at < v_fim_ts;

        SELECT json_build_object(
            'disponivel', TRUE,
            'total',     count(*),
            'ativas',    count(*) FILTER (WHERE status::TEXT = 'active'),
            'trials',    count(*) FILTER (WHERE status::TEXT = 'trialing'),
            'vencidas',  count(*) FILTER (WHERE status::TEXT = 'past_due'),
            'canceladas',count(*) FILTER (WHERE status::TEXT = 'canceled'),
            'expiradas', count(*) FILTER (WHERE status::TEXT = 'expired'),
            'somente_leitura', count(*) FILTER (WHERE status::TEXT = 'read_only'),
            'novas',     count(*) FILTER (WHERE created_at >= v_ini_ts AND created_at < v_fim_ts)
        ) INTO v_assinaturas
        FROM public.subscriptions;

        v_mrr_json := json_build_object(
            -- Sem nenhuma assinatura registrada a resposta certa é "ainda não
            -- há dado", não "R$ 0,00 de MRR".
            'tem_dados', EXISTS (SELECT 1 FROM public.subscriptions),
            'valor',     v_mrr,
            'em_risco',  v_mrr_risco
        );

        SELECT json_build_object(
            'assinaturas', count(*),
            'valor_mensal', v_mrr_risco
        ) INTO v_inadimplencia
        FROM public.subscriptions WHERE status::TEXT = 'past_due';

        v_churn := json_build_object(
            'ativos_inicio', v_ativos_inicio,
            'cancelados',    v_cancelados,
            -- NULL, não 0: sem base no início do período não existe taxa, e
            -- exibir 0% afirmaria retenção perfeita onde não houve medição.
            'taxa', CASE WHEN v_ativos_inicio > 0
                         THEN round((v_cancelados::NUMERIC / v_ativos_inicio) * 100, 2)
                         END
        );
    ELSE
        -- Diferente de zero: zero afirmaria que não há assinatura, e a verdade
        -- é que as tabelas de plano e assinatura não existem nesta base.
        v_assinaturas   := json_build_object('disponivel', FALSE);
        v_mrr_json      := json_build_object('tem_dados', FALSE, 'valor', 0, 'em_risco', 0);
        v_inadimplencia := json_build_object('assinaturas', 0, 'valor_mensal', 0);
        v_churn         := json_build_object('ativos_inicio', 0, 'cancelados', 0, 'taxa', NULL);
    END IF;

    v_tem_checkout := to_regclass('public.checkout_orders') IS NOT NULL;

    IF v_tem_checkout THEN
        SELECT json_build_object(
            'disponivel', TRUE,
            'recebido',  COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'active'), 0),
            'pendente',  COALESCE(SUM(o.amount) FILTER (WHERE o.status IN ('awaiting_payment', 'processing')), 0),
            'vencido',   COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'overdue'), 0),
            'estornado', COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'refunded'), 0),
            'pedidos',   count(*)
        )
        INTO v_pagamentos
        FROM public.checkout_orders o
        WHERE o.created_at >= v_ini_ts AND o.created_at < v_fim_ts;
    ELSE
        v_pagamentos := json_build_object('disponivel', FALSE);
    END IF;

    SELECT json_build_object(
        'periodo', json_build_object('inicio', p_inicio, 'fim', p_fim),

        'contas', json_build_object(
            'total',     (SELECT count(*) FROM public.corretores),
            'novas',     (SELECT count(*) FROM public.corretores
                           WHERE created_at >= v_ini_ts AND created_at < v_fim_ts),
            'suspensas', (SELECT count(*) FROM public.corretores WHERE status = 'suspenso')
        ),

        'assinaturas',   v_assinaturas,
        'mrr',           v_mrr_json,
        'inadimplencia', v_inadimplencia,
        'churn',         v_churn,
        'pagamentos',    v_pagamentos,

        'parceiros', json_build_object(
            'ativos', (SELECT count(*) FROM public.parceiros WHERE status = 'ativo'),
            'receita_atribuida', COALESCE((
                SELECT SUM(c.valor_base) FROM public.parceiro_comissoes c
                 WHERE c.gerada_em >= v_ini_ts AND c.gerada_em < v_fim_ts
                   AND c.status NOT IN ('cancelada', 'estornada')), 0),
            'comissao_gerada', COALESCE((
                SELECT SUM(c.valor_comissao) FROM public.parceiro_comissoes c
                 WHERE c.gerada_em >= v_ini_ts AND c.gerada_em < v_fim_ts
                   AND c.status NOT IN ('cancelada', 'estornada')), 0),
            'saldo_a_pagar', COALESCE((
                SELECT SUM(c.valor_comissao) FROM public.parceiro_comissoes c
                 WHERE c.status = 'aprovada'), 0)
        ),

        'cancelamentos', json_build_object(
            'registrados', (SELECT count(*) FROM public.cancelamento_feedback
                             WHERE data_cancelamento BETWEEN p_inicio AND p_fim)
        )
    ) INTO v_resultado;

    RETURN v_resultado;
END $$;

-- ── 2. Assinaturas ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_listar_assinaturas(
    p_busca   TEXT DEFAULT NULL,
    p_status  TEXT DEFAULT NULL,
    p_plano   TEXT DEFAULT NULL,
    p_ciclo   TEXT DEFAULT NULL,
    p_pagina  INT  DEFAULT 1,
    p_por_pagina INT DEFAULT 25
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_offset INT;
    v_limite INT;
    v_total  INT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    IF to_regclass('public.subscriptions') IS NULL
       OR to_regclass('public.plans') IS NULL THEN
        RETURN json_build_object('disponivel', FALSE, 'itens', '[]'::JSON, 'total', 0);
    END IF;

    v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 25), 1), 100);
    v_offset := (GREATEST(COALESCE(p_pagina, 1), 1) - 1) * v_limite;

    SELECT count(*) INTO v_total
    FROM public.subscriptions s
    JOIN public.plans p       ON p.id = s.plan_id
    JOIN public.corretores c  ON c.id = s.corretor_id
    WHERE (p_status IS NULL OR s.status::TEXT = p_status)
      AND (p_plano  IS NULL OR p.code = p_plano)
      AND (p_ciclo  IS NULL OR s.billing_cycle::TEXT = p_ciclo)
      AND (p_busca  IS NULL OR c.nome ILIKE '%' || p_busca || '%'
                            OR c.email ILIKE '%' || p_busca || '%');

    -- Ordena pela coluna, não pelo texto do JSON: `linha->>'criada_em'` sairia
    -- comparado como string, o que só coincide com a ordem real enquanto todos
    -- os timestamps tiverem o mesmo fuso na serialização.
    SELECT COALESCE(json_agg(linha ORDER BY ordem DESC), '[]'::JSON)
    INTO v_itens
    FROM (
        SELECT s.created_at AS ordem, json_build_object(
            'id',            s.id,
            'corretor_id',   c.id,
            'conta_nome',    c.nome,
            'conta_email',   c.email,
            'plano_codigo',  p.code,
            'plano_nome',    p.name,
            'status',        s.status,
            'ciclo',         s.billing_cycle,
            'valor_mensal',  public.mrr_da_assinatura(s.billing_cycle::TEXT, p.monthly_price, p.annual_price),
            'trial_termina_em',   s.trial_ends_at,
            'periodo_inicio',     s.current_period_start,
            'proxima_cobranca',   s.current_period_end,
            'cancelar_no_fim',    s.cancel_at_period_end,
            'cancelada_em',       s.canceled_at,
            'motivo_cancelamento', s.cancel_reason,
            -- ID externo é o que permite conferir a assinatura no painel do
            -- gateway quando cliente e cobrança discordam.
            'id_externo',    s.external_subscription_id,
            'criada_em',     s.created_at
        ) AS linha
        FROM public.subscriptions s
        JOIN public.plans p      ON p.id = s.plan_id
        JOIN public.corretores c ON c.id = s.corretor_id
        WHERE (p_status IS NULL OR s.status::TEXT = p_status)
          AND (p_plano  IS NULL OR p.code = p_plano)
          AND (p_ciclo  IS NULL OR s.billing_cycle::TEXT = p_ciclo)
          AND (p_busca  IS NULL OR c.nome ILIKE '%' || p_busca || '%'
                                OR c.email ILIKE '%' || p_busca || '%')
        ORDER BY s.created_at DESC
        LIMIT v_limite OFFSET v_offset
    ) sub;

    RETURN json_build_object('disponivel', TRUE, 'itens', v_itens, 'total', v_total);
END $$;

-- ── 3. Pagamentos do SaaS ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_listar_pagamentos(
    p_busca   TEXT DEFAULT NULL,
    p_status  TEXT DEFAULT NULL,
    p_metodo  TEXT DEFAULT NULL,
    p_plano   TEXT DEFAULT NULL,
    p_inicio  DATE DEFAULT NULL,
    p_fim     DATE DEFAULT NULL,
    p_pagina  INT  DEFAULT 1,
    p_por_pagina INT DEFAULT 25
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_offset INT;
    v_limite INT;
    v_total  INT;
    v_itens  JSON;
    v_totais JSON;
    v_ini_ts TIMESTAMPTZ;
    v_fim_ts TIMESTAMPTZ;
BEGIN
    PERFORM public.exigir_admin();

    IF to_regclass('public.checkout_orders') IS NULL THEN
        RETURN json_build_object(
            'disponivel', FALSE,
            'itens', '[]'::JSON,
            'total', 0,
            'totais', NULL
        );
    END IF;

    v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 25), 1), 100);
    v_offset := (GREATEST(COALESCE(p_pagina, 1), 1) - 1) * v_limite;
    v_ini_ts := CASE WHEN p_inicio IS NULL THEN NULL ELSE p_inicio::TIMESTAMPTZ END;
    v_fim_ts := CASE WHEN p_fim    IS NULL THEN NULL ELSE (p_fim + 1)::TIMESTAMPTZ END;

    SELECT count(*) INTO v_total
    FROM public.checkout_orders o
    WHERE (p_status IS NULL OR o.status = p_status)
      AND (p_metodo IS NULL OR o.payment_method = p_metodo)
      AND (p_plano  IS NULL OR o.plan_code = p_plano)
      AND (v_ini_ts IS NULL OR o.created_at >= v_ini_ts)
      AND (v_fim_ts IS NULL OR o.created_at <  v_fim_ts)
      AND (p_busca  IS NULL OR o.payer_name ILIKE '%' || p_busca || '%'
                            OR o.payer_email ILIKE '%' || p_busca || '%');

    SELECT json_build_object(
        'recebido',  COALESCE(SUM(amount) FILTER (WHERE status = 'active'), 0),
        'pendente',  COALESCE(SUM(amount) FILTER (WHERE status IN ('awaiting_payment', 'processing')), 0),
        'vencido',   COALESCE(SUM(amount) FILTER (WHERE status = 'overdue'), 0),
        'estornado', COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)
    ) INTO v_totais
    FROM public.checkout_orders o
    WHERE (p_status IS NULL OR o.status = p_status)
      AND (p_metodo IS NULL OR o.payment_method = p_metodo)
      AND (p_plano  IS NULL OR o.plan_code = p_plano)
      AND (v_ini_ts IS NULL OR o.created_at >= v_ini_ts)
      AND (v_fim_ts IS NULL OR o.created_at <  v_fim_ts)
      AND (p_busca  IS NULL OR o.payer_name ILIKE '%' || p_busca || '%'
                            OR o.payer_email ILIKE '%' || p_busca || '%');

    SELECT COALESCE(json_agg(linha ORDER BY ordem DESC), '[]'::JSON)
    INTO v_itens
    FROM (
        SELECT o.created_at AS ordem, json_build_object(
            'id',           o.id,
            'pagador',      o.payer_name,
            'email',        o.payer_email,
            'plano',        o.plan_code,
            'ciclo',        o.billing_cycle,
            'metodo',       o.payment_method,
            'valor',        o.amount,
            'status',       o.status,
            'motivo_falha', o.failure_code,
            'id_cobranca',  o.asaas_payment_id,
            'id_assinatura',o.asaas_subscription_id,
            -- A conta provisionada é o elo entre o pedido e o corretor. Sem
            -- ela, o pedido foi pago e nunca virou acesso — caso que precisa
            -- ser visível, não escondido.
            'corretor_id',  c.id,
            'conta_nome',   c.nome,
            'acesso_enviado_em', o.access_email_sent_at,
            'criado_em',    o.created_at,
            'atualizado_em',o.updated_at
        ) AS linha
        FROM public.checkout_orders o
        LEFT JOIN public.corretores c ON c.user_id = o.provisioned_user_id
        WHERE (p_status IS NULL OR o.status = p_status)
          AND (p_metodo IS NULL OR o.payment_method = p_metodo)
          AND (p_plano  IS NULL OR o.plan_code = p_plano)
          AND (v_ini_ts IS NULL OR o.created_at >= v_ini_ts)
          AND (v_fim_ts IS NULL OR o.created_at <  v_fim_ts)
          AND (p_busca  IS NULL OR o.payer_name ILIKE '%' || p_busca || '%'
                                OR o.payer_email ILIKE '%' || p_busca || '%')
        ORDER BY o.created_at DESC
        LIMIT v_limite OFFSET v_offset
    ) sub;

    RETURN json_build_object(
        'disponivel', TRUE,
        'itens', v_itens,
        'total', v_total,
        'totais', v_totais
    );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_metricas_saas(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mrr_da_assinatura(TEXT, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_assinaturas(TEXT, TEXT, TEXT, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_pagamentos(TEXT, TEXT, TEXT, TEXT, DATE, DATE, INT, INT) TO authenticated;
