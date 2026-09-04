-- ---------------------------------------------------------------------------
-- Planos v2 — cotas alinhadas ao que a operação realmente custa.
--
-- O que estava errado, medido:
--
-- 1. NÃO EXISTIA cota para o driver de custo. As 18 feature_key cobriam imóveis,
--    fachadas, contratos e assistente — nenhuma contava lead qualificado, que é
--    R$ 0,396 entre IA de conversa e template de WhatsApp, contra centavos para
--    todo o resto. Um cliente do plano de entrada podia receber 500 leads,
--    custar R$ 198 de qualificação, e nada no sistema percebia.
--
-- 2. As cotas de IA eram maiores que a receita. No pior caso, as 1.500
--    interações e 250 contratos do plano Imobiliária custavam R$ 331 — 66% da
--    mensalidade — antes de qualquer lead. No Profissional, 30%.
--
-- 3. Os contadores nunca eram preenchidos. `useIncrementUsage` só existia no
--    front, e o lead chega por webhook, onde não há front nenhum.
--
-- O princípio que organiza as cotas novas: LIMITE O QUE CUSTA, LIBERE O QUE NÃO
-- CUSTA. Imóvel e fachada custam centavos de banco; apertá-los reduzia o valor
-- percebido sem proteger margem nenhuma. Pior: fachada gera lead, e lead agora
-- tem cota — limitar os dois é cobrar duas vezes pelo mesmo funil.
--
-- Resultado: margem típica de ~81% e piso de 66% no pior caso, igual nos três
-- planos. Previsível em vez de variável.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ── 1. Preços ─────────────────────────────────────────────────────────────
-- O anual dá dois meses de graça — desconto que se paga em retenção.
UPDATE public.plans SET
    monthly_price = 129.00, annual_price = 1290.00, highlighted = FALSE,
    description = 'Para o corretor autônomo que está começando a organizar a operação.'
 WHERE code = 'essencial';

UPDATE public.plans SET
    monthly_price = 249.00, annual_price = 2490.00, highlighted = TRUE,
    description = 'Para o corretor em operação, com volume constante de leads e aluguéis.'
 WHERE code = 'profissional';

UPDATE public.plans SET
    monthly_price = 499.00, annual_price = 4990.00, highlighted = FALSE,
    description = 'Para imobiliárias com equipe, com indicadores e controle por corretor.'
 WHERE code = 'imobiliaria';

-- ── 2. Cotas e funcionalidades ────────────────────────────────────────────
DO $$
DECLARE
    ess UUID;
    pro UUID;
    imo UUID;

    -- (feature_key, nome, categoria, ordem, limite_ess, limite_pro, limite_imo)
    -- -1 significa ILIMITADO. NULL não é usado aqui para não confundir com
    -- "feature booleana", que é o significado de limit_value NULL na tabela.
    cotas CONSTANT TEXT[][] := ARRAY[
        -- O QUE CUSTA
        ['leads_qualificados_monthly', 'Leads qualificados pela IA / mês', 'ia',       '1',  '40',  '110', '245'],
        ['ai_assistant_monthly',       'Interações com o Assistente / mês', 'ia',      '2',  '60',  '200', '500'],
        ['ai_contracts_monthly',       'Contratos com IA / mês',            'ia',      '3',  '10',  '25',  '40'],
        ['storage_gb',                 'Armazenamento de mídias (GB)',      'midias',  '4',  '3',   '15',  '50'],
        ['max_users',                  'Usuários',                          'equipe',  '5',  '1',   '3',   '10'],
        ['max_contratos_locacao',      'Contratos de locação ativos',       'alugueis','6',  '5',   '30',  '-1'],
        -- O QUE NÃO CUSTA: generoso de propósito
        ['max_imoveis',                'Imóveis cadastrados',               'imoveis', '7',  '250', '1500','-1'],
        ['max_fachadas',               'Fachadas com QR Code',              'fachadas','8',  '15',  '60',  '-1']
    ];

    -- (feature_key, nome, categoria, ordem, ess, pro, imo)
    recursos CONSTANT TEXT[][] := ARRAY[
        ['rental_management',   'Gestão de aluguéis',                 'alugueis',   '10', 't', 't', 't'],
        ['asaas_integration',   'Cobrança por boleto e PIX (Asaas)',  'alugueis',   '11', 't', 't', 't'],
        ['full_financial',      'Controle financeiro',                'financeiro', '12', 't', 't', 't'],
        ['ai_contract_analysis','Leitura de contrato com IA',         'contratos',  '13', 'f', 't', 't'],
        ['contract_export',     'Exportação em PDF e DOCX',           'contratos',  '14', 'f', 't', 't'],
        ['advanced_reports',    'Relatórios avançados',               'relatorios', '15', 'f', 't', 't'],
        ['automations',         'Automações e alertas inteligentes',  'crm',        '16', 'f', 't', 't'],
        ['fachadas_analytics',  'Métricas detalhadas de Fachadas',    'fachadas',   '17', 'f', 't', 't'],
        ['priority_support',    'Suporte prioritário',                'suporte',    '18', 'f', 't', 't'],
        ['team_management',     'Gestão de equipe',                   'equipe',     '19', 'f', 'f', 't'],
        ['team_analytics',      'Indicadores por corretor',           'equipe',     '20', 'f', 'f', 't'],
        ['guided_onboarding',   'Implantação acompanhada',            'suporte',    '21', 'f', 'f', 't']
    ];

    i INT;
    planos UUID[];
    p INT;
    bruto TEXT;
    lim INT;
BEGIN
    SELECT id INTO ess FROM public.plans WHERE code = 'essencial';
    SELECT id INTO pro FROM public.plans WHERE code = 'profissional';
    SELECT id INTO imo FROM public.plans WHERE code = 'imobiliaria';

    IF ess IS NULL OR pro IS NULL OR imo IS NULL THEN
        RAISE EXCEPTION 'Planos base ausentes. Rode 20260807120000_plans_subscriptions.sql antes.';
    END IF;

    planos := ARRAY[ess, pro, imo];

    FOR i IN 1 .. array_length(cotas, 1) LOOP
        FOR p IN 1 .. 3 LOOP
            bruto := cotas[i][4 + p];
            lim := bruto::INT;

            INSERT INTO public.plan_entitlements
                (plan_id, feature_key, feature_name, category, enabled,
                 limit_value, unlimited, display_order)
            VALUES
                (planos[p], cotas[i][1], cotas[i][2], cotas[i][3], TRUE,
                 CASE WHEN lim < 0 THEN NULL ELSE lim END,
                 lim < 0,
                 cotas[i][4]::SMALLINT)
            ON CONFLICT (plan_id, feature_key) DO UPDATE SET
                feature_name  = EXCLUDED.feature_name,
                category      = EXCLUDED.category,
                enabled       = TRUE,
                limit_value   = EXCLUDED.limit_value,
                unlimited     = EXCLUDED.unlimited,
                display_order = EXCLUDED.display_order;
        END LOOP;
    END LOOP;

    FOR i IN 1 .. array_length(recursos, 1) LOOP
        FOR p IN 1 .. 3 LOOP
            INSERT INTO public.plan_entitlements
                (plan_id, feature_key, feature_name, category, enabled,
                 limit_value, unlimited, display_order)
            VALUES
                (planos[p], recursos[i][1], recursos[i][2], recursos[i][3],
                 recursos[i][4 + p] = 't', NULL, FALSE, recursos[i][4]::SMALLINT)
            ON CONFLICT (plan_id, feature_key) DO UPDATE SET
                feature_name  = EXCLUDED.feature_name,
                category      = EXCLUDED.category,
                enabled       = EXCLUDED.enabled,
                limit_value   = NULL,
                unlimited     = FALSE,
                display_order = EXCLUDED.display_order;
        END LOOP;
    END LOOP;
END $$;

COMMENT ON COLUMN public.plan_entitlements.limit_value IS
    'Teto numérico do período. NULL com unlimited=false significa feature '
    'booleana (vale o campo enabled). NULL com unlimited=true é sem teto.';

-- ── 2b. O alerta de cota precisa apontar para o plano ─────────────────
-- O CHECK de `entidade_tipo` foi criado em 20260817100000 com as cinco
-- entidades financeiras. O aviso de cota estourada aponta para a página de
-- plano, e sem esta linha o INSERT falharia — dentro de um try/catch, o que
-- significa aviso perdido em silêncio.
ALTER TABLE public.alertas DROP CONSTRAINT IF EXISTS alertas_entidade_tipo_check;
ALTER TABLE public.alertas ADD CONSTRAINT alertas_entidade_tipo_check
    CHECK (entidade_tipo IS NULL OR entidade_tipo IN
           ('fatura', 'repasse', 'contrato', 'cliente', 'imovel', 'plano'));

-- ── 3. Consultar a cota ───────────────────────────────────────────────────
-- A autoridade sobre limite passa a ser o banco. `useCheckLimit` no front
-- continua existindo para desenhar interface, mas quem decide se a IA roda é
-- esta função — o lead chega por webhook, onde não existe front para checar.
CREATE OR REPLACE FUNCTION public.checar_cota(
    _corretor_id UUID,
    _feature_key TEXT
)
RETURNS TABLE (
    permitido  BOOLEAN,
    usado      INT,
    limite     INT,
    ilimitado  BOOLEAN,
    habilitado BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plano   UUID;
    v_ent     RECORD;
    v_usado   INT := 0;
    v_extra   INT := 0;
    v_inicio  DATE := date_trunc('month', now())::DATE;
BEGIN
    SELECT s.plan_id INTO v_plano
      FROM public.subscriptions s
     WHERE s.corretor_id = _corretor_id
       AND s.status IN ('trialing', 'active', 'past_due', 'read_only')
     LIMIT 1;

    -- Sem assinatura não há plano, e sem plano não há permissão. Quem chama
    -- decide o que fazer — no caso do lead, gravar o contato mesmo assim.
    IF v_plano IS NULL THEN
        RETURN QUERY SELECT FALSE, 0, 0, FALSE, FALSE;
        RETURN;
    END IF;

    SELECT e.enabled, e.limit_value, e.unlimited INTO v_ent
      FROM public.plan_entitlements e
     WHERE e.plan_id = v_plano AND e.feature_key = _feature_key;

    -- Feature que o plano nem conhece: nega. Acrescentar chave nova sem
    -- semeá-la nos três planos não pode liberar acesso por omissão.
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 0, FALSE, FALSE;
        RETURN;
    END IF;

    IF v_ent.unlimited THEN
        RETURN QUERY SELECT TRUE, 0, NULL::INT, TRUE, TRUE;
        RETURN;
    END IF;

    IF v_ent.limit_value IS NULL THEN
        RETURN QUERY SELECT v_ent.enabled, 0, NULL::INT, FALSE, v_ent.enabled;
        RETURN;
    END IF;

    -- Adicionais comprados expandem o teto do período.
    SELECT COALESCE(SUM(a.quantity * CASE a.addon_code
                WHEN 'extra_user'         THEN 1
                WHEN 'extra_fachadas_25'  THEN 25
                WHEN 'extra_ai_100'       THEN 100
                WHEN 'extra_storage_50'   THEN 50
                WHEN 'extra_leads_50'     THEN 50
                ELSE 0 END), 0)
      INTO v_extra
      FROM public.subscription_addons a
     WHERE a.corretor_id = _corretor_id
       AND a.status = 'active'
       AND CASE a.addon_code
             WHEN 'extra_user'        THEN 'max_users'
             WHEN 'extra_fachadas_25' THEN 'max_fachadas'
             WHEN 'extra_ai_100'      THEN 'ai_contracts_monthly'
             WHEN 'extra_storage_50'  THEN 'storage_gb'
             WHEN 'extra_leads_50'    THEN 'leads_qualificados_monthly'
             ELSE '' END = _feature_key;

    SELECT COALESCE(u.used_quantity, 0) INTO v_usado
      FROM public.usage_counters u
     WHERE u.corretor_id = _corretor_id
       AND u.feature_key = _feature_key
       AND u.period_start = v_inicio;

    v_usado := COALESCE(v_usado, 0);

    RETURN QUERY SELECT
        v_usado < (v_ent.limit_value + v_extra),
        v_usado,
        v_ent.limit_value + v_extra,
        FALSE,
        TRUE;
END $$;

REVOKE ALL ON FUNCTION public.checar_cota(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checar_cota(UUID, TEXT) TO authenticated, service_role;

-- ── 4. Registrar consumo ──────────────────────────────────────────────────
-- Precisa ser SECURITY DEFINER e chamável por service_role: o consumo mais
-- importante (qualificação de lead) acontece dentro de Edge Function, sem
-- sessão de usuário.
CREATE OR REPLACE FUNCTION public.incrementar_uso(
    _corretor_id UUID,
    _feature_key TEXT,
    _quantidade  INT DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inicio DATE := date_trunc('month', now())::DATE;
    v_fim    DATE := (date_trunc('month', now()) + INTERVAL '1 month - 1 day')::DATE;
    v_total  INT;
BEGIN
    IF _corretor_id IS NULL OR _quantidade <= 0 THEN
        RETURN 0;
    END IF;

    INSERT INTO public.usage_counters
        (corretor_id, feature_key, used_quantity, period_start, period_end)
    VALUES
        (_corretor_id, _feature_key, _quantidade, v_inicio, v_fim)
    ON CONFLICT (corretor_id, feature_key, period_start) DO UPDATE
        SET used_quantity = public.usage_counters.used_quantity + EXCLUDED.used_quantity
    RETURNING used_quantity INTO v_total;

    RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.incrementar_uso(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.incrementar_uso(UUID, TEXT, INT) TO authenticated, service_role;

COMMENT ON FUNCTION public.checar_cota(UUID, TEXT) IS
    'Autoridade sobre limite de plano. O front usa para desenhar interface; '
    'a Edge Function usa para decidir se a IA roda.';

COMMENT ON FUNCTION public.incrementar_uso(UUID, TEXT, INT) IS
    'Registra consumo do período. Chamável por service_role porque a '
    'qualificação de lead acontece em Edge Function, sem sessão de usuário.';

-- ── 5. Conferência ────────────────────────────────────────────────────────
-- Devolve linhas, não mensagens: a aba Results do Supabase não mostra NOTICE.
--
--   SELECT p.code, p.monthly_price,
--          count(*) FILTER (WHERE e.limit_value IS NOT NULL OR e.unlimited) AS cotas,
--          count(*) FILTER (WHERE e.limit_value IS NULL AND NOT e.unlimited) AS recursos
--     FROM public.plans p
--     JOIN public.plan_entitlements e ON e.plan_id = p.id
--    GROUP BY p.code, p.monthly_price, p.display_order
--    ORDER BY p.display_order;
--
-- Esperado: 3 linhas, 129/249/499, com 8 cotas e 12 recursos cada.
