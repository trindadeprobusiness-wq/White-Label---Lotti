-- ---------------------------------------------------------------------------
-- RPCs do back office.
--
-- Por que RPC e não policy: o admin precisa ler dados de TODOS os inquilinos, e
-- a RLS existente diz o contrário. Havia duas saídas — adicionar `OR is_admin()`
-- nas ~30 tabelas do corretor, ou concentrar a leitura administrativa em
-- funções com guard. A segunda foi escolhida porque:
--
--   * não encosta nas policies que a 20260812090000 acabou de endurecer contra
--     vazamento entre contas;
--   * devolve só as colunas que a operação precisa, em vez de abrir a tabela
--     inteira (menor privilégio, e menos dado pessoal circulando);
--   * é o único caminho para auth.users (e-mail, created_at, last_sign_in_at).
--
-- Toda função aqui começa com o mesmo guard e levanta 42501 quando o chamador
-- não tem papel. Falhar é melhor que devolver lista vazia: lista vazia parece
-- "não há dados" e esconde o problema de permissão.
--
-- Roda por último de propósito: referencia tabelas das quatro migrations
-- anteriores.
-- ---------------------------------------------------------------------------

-- ── Guards ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.exigir_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.exigir_super_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501';
    END IF;
END $$;

-- ── 1. Visão geral ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_metricas_visao_geral(
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
    v_janela   INT := public.admin_config_int('janela_atividade_dias', 30);
    v_dias     INT;
    v_ini_ant  DATE;
    v_fim_ant  DATE;
    v_ini_ts   TIMESTAMPTZ;
    v_fim_ts   TIMESTAMPTZ;
    v_ini_ant_ts TIMESTAMPTZ;
    v_fim_ant_ts TIMESTAMPTZ;
    v_resultado JSON;
BEGIN
    PERFORM public.exigir_admin();

    IF p_inicio > p_fim THEN
        RAISE EXCEPTION 'período inválido: início depois do fim';
    END IF;

    v_dias    := (p_fim - p_inicio) + 1;
    v_fim_ant := p_inicio - 1;
    v_ini_ant := v_fim_ant - (v_dias - 1);

    -- Comparação sempre em [início 00:00, fim+1 00:00) para incluir o último
    -- dia inteiro. Usar `<= p_fim` cortaria tudo que aconteceu depois da
    -- meia-noite do último dia.
    v_ini_ts     := p_inicio::TIMESTAMPTZ;
    v_fim_ts     := (p_fim + 1)::TIMESTAMPTZ;
    v_ini_ant_ts := v_ini_ant::TIMESTAMPTZ;
    v_fim_ant_ts := (v_fim_ant + 1)::TIMESTAMPTZ;

    SELECT json_build_object(
        'periodo', json_build_object('inicio', p_inicio, 'fim', p_fim),
        'periodo_anterior', json_build_object('inicio', v_ini_ant, 'fim', v_fim_ant),
        'janela_atividade_dias', v_janela,

        'usuarios', (
            SELECT json_build_object(
                'total',     count(*),
                'novos',     count(*) FILTER (WHERE c.created_at >= v_ini_ts AND c.created_at < v_fim_ts),
                'novos_anterior', count(*) FILTER (WHERE c.created_at >= v_ini_ant_ts AND c.created_at < v_fim_ant_ts),
                'ativos',    count(*) FILTER (WHERE c.status = 'ativo' AND public.classificar_atividade(c.ultimo_acesso_em, v_janela) = 'ativo'),
                'inativos',  count(*) FILTER (WHERE c.status = 'ativo' AND public.classificar_atividade(c.ultimo_acesso_em, v_janela) = 'inativo'),
                'sem_dados', count(*) FILTER (WHERE c.status = 'ativo' AND c.ultimo_acesso_em IS NULL),
                'suspensos', count(*) FILTER (WHERE c.status = 'suspenso')
            )
            FROM public.corretores c
        ),

        'assinaturas', COALESCE((
            SELECT json_build_object(
                'trialing',  count(*) FILTER (WHERE s.status = 'trialing'),
                'active',    count(*) FILTER (WHERE s.status = 'active'),
                'past_due',  count(*) FILTER (WHERE s.status = 'past_due'),
                'canceled',  count(*) FILTER (WHERE s.status = 'canceled'),
                'expired',   count(*) FILTER (WHERE s.status = 'expired'),
                'read_only', count(*) FILTER (WHERE s.status = 'read_only')
            )
            FROM public.subscriptions s
        ), json_build_object('trialing',0,'active',0,'past_due',0,'canceled',0,'expired',0,'read_only',0)),

        'receita', (
            SELECT json_build_object(
                -- tem_dados olha a tabela inteira, não o período: é a diferença
                -- entre "não faturamos neste mês" e "nunca registramos receita".
                -- A tela usa isso para não exibir R$ 0,00 como se fosse um fato.
                'tem_dados', EXISTS (SELECT 1 FROM public.receita_eventos WHERE status = 'confirmado'),
                'recebida',  COALESCE(sum(r.valor_bruto) FILTER (WHERE r.confirmado_em >= v_ini_ts AND r.confirmado_em < v_fim_ts), 0),
                'recebida_anterior', COALESCE(sum(r.valor_bruto) FILTER (WHERE r.confirmado_em >= v_ini_ant_ts AND r.confirmado_em < v_fim_ant_ts), 0),
                'eventos',   count(*) FILTER (WHERE r.confirmado_em >= v_ini_ts AND r.confirmado_em < v_fim_ts)
            )
            FROM public.receita_eventos r
            WHERE r.status = 'confirmado'
        ),

        'parceiros', json_build_object(
            'total',  (SELECT count(*) FROM public.parceiros),
            'ativos', (SELECT count(*) FROM public.parceiros WHERE status = 'ativo'),
            'cliques', (SELECT count(*) FROM public.parceiro_cliques WHERE criado_em >= v_ini_ts AND criado_em < v_fim_ts),
            'cliques_anterior', (SELECT count(*) FROM public.parceiro_cliques WHERE criado_em >= v_ini_ant_ts AND criado_em < v_fim_ant_ts),
            'atribuicoes', (SELECT count(*) FROM public.parceiro_atribuicoes WHERE criado_em >= v_ini_ts AND criado_em < v_fim_ts),
            'conversoes', (SELECT count(*) FROM public.parceiro_atribuicoes WHERE convertido_em >= v_ini_ts AND convertido_em < v_fim_ts),
            'conversoes_anterior', (SELECT count(*) FROM public.parceiro_atribuicoes WHERE convertido_em >= v_ini_ant_ts AND convertido_em < v_fim_ant_ts)
        ),

        'comissoes', (
            SELECT json_build_object(
                'valor_pendente',  COALESCE(sum(valor_comissao) FILTER (WHERE status IN ('pendente','em_validacao')), 0),
                'valor_aprovada',  COALESCE(sum(valor_comissao) FILTER (WHERE status = 'aprovada'), 0),
                'valor_paga',      COALESCE(sum(valor_comissao) FILTER (WHERE status = 'paga'), 0),
                'valor_estornada', COALESCE(sum(valor_comissao) FILTER (WHERE status IN ('estornada','cancelada')), 0),
                'quantidade',      count(*)
            )
            FROM public.parceiro_comissoes
        )
    ) INTO v_resultado;

    RETURN v_resultado;
END $$;

-- ── 2. Listagem de usuários ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_listar_usuarios(
    p_busca      TEXT DEFAULT NULL,
    p_status     TEXT DEFAULT NULL,
    p_atividade  TEXT DEFAULT NULL,
    p_parceiro_id UUID DEFAULT NULL,
    p_criado_de  DATE DEFAULT NULL,
    p_criado_ate DATE DEFAULT NULL,
    p_ordenar    TEXT DEFAULT 'criado_em',
    p_direcao    TEXT DEFAULT 'desc',
    p_limite     INT  DEFAULT 25,
    p_offset     INT  DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_janela INT := public.admin_config_int('janela_atividade_dias', 30);
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_busca  TEXT := NULLIF(btrim(COALESCE(p_busca, '')), '');
    v_total  BIGINT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    -- Whitelist de ordenação. p_ordenar decide a ordem, então aceitar texto
    -- livre e concatenar seria injeção de SQL. Aqui ele nunca vira SQL: só
    -- escolhe qual CASE do ORDER BY fica não-nulo.
    IF p_ordenar NOT IN ('criado_em', 'nome', 'ultimo_acesso_em', 'status') THEN
        p_ordenar := 'criado_em';
    END IF;
    IF lower(COALESCE(p_direcao, 'desc')) NOT IN ('asc', 'desc') THEN
        p_direcao := 'desc';
    ELSE
        p_direcao := lower(p_direcao);
    END IF;

    -- Uma passagem só: `count(*) OVER ()` é avaliado antes do LIMIT, então
    -- devolve o total filtrado junto com a página. Duas queries separadas
    -- correriam o risco de discordar sob escrita concorrente — a página diria
    -- "1–25 de 40" com 41 linhas existindo.
    SELECT COALESCE(json_agg(to_jsonb(x) - 'total_geral'), '[]'::json),
           COALESCE(max(x.total_geral), 0)
      INTO v_itens, v_total
      FROM (
        SELECT
            c.id  AS corretor_id,
            c.user_id,
            c.nome,
            c.email,
            c.telefone,
            c.creci,
            c.status,
            c.created_at AS criado_em,
            c.ultimo_acesso_em,
            public.classificar_atividade(c.ultimo_acesso_em, v_janela) AS atividade,
            c.suspenso_em,
            c.suspenso_motivo,
            pl.name        AS plano_nome,
            s.status::TEXT AS assinatura_status,
            pa.parceiro_id,
            p.nome         AS parceiro_nome,
            (SELECT count(*) FROM public.clientes cl WHERE cl.corretor_id = c.id) AS total_clientes,
            (SELECT count(*) FROM public.imoveis  im WHERE im.corretor_id = c.id) AS total_imoveis,
            count(*) OVER () AS total_geral
        FROM public.corretores c
        -- LATERAL com LIMIT 1, não LEFT JOIN direto: o índice único de
        -- subscriptions(corretor_id) é PARCIAL (só trialing/active/past_due),
        -- então um corretor pode ter várias assinaturas canceladas ou expiradas
        -- e o join simples o duplicaria na listagem — inflando o total de
        -- usuários com linhas repetidas.
        LEFT JOIN LATERAL (
            SELECT sub.status, sub.plan_id
              FROM public.subscriptions sub
             WHERE sub.corretor_id = c.id
             ORDER BY CASE WHEN sub.status IN ('trialing','active','past_due') THEN 0 ELSE 1 END,
                      sub.created_at DESC
             LIMIT 1
        ) s ON TRUE
        LEFT JOIN public.plans pl        ON pl.id = s.plan_id
        -- parceiro_atribuicoes tem UNIQUE parcial em corretor_id, então aqui o
        -- join direto não duplica.
        LEFT JOIN public.parceiro_atribuicoes pa
               ON pa.corretor_id = c.id AND pa.status = 'convertida'
        LEFT JOIN public.parceiros p     ON p.id = pa.parceiro_id
        WHERE (v_busca IS NULL
               OR c.nome  ILIKE '%' || v_busca || '%'
               OR c.email ILIKE '%' || v_busca || '%'
               OR COALESCE(c.telefone, '') ILIKE '%' || v_busca || '%'
               OR COALESCE(c.creci, '')    ILIKE '%' || v_busca || '%')
          AND (p_status      IS NULL OR c.status = p_status)
          AND (p_atividade   IS NULL
               OR public.classificar_atividade(c.ultimo_acesso_em, v_janela) = p_atividade)
          AND (p_parceiro_id IS NULL OR pa.parceiro_id = p_parceiro_id)
          AND (p_criado_de   IS NULL OR c.created_at >= p_criado_de::TIMESTAMPTZ)
          AND (p_criado_ate  IS NULL OR c.created_at < (p_criado_ate + 1)::TIMESTAMPTZ)
        ORDER BY
            CASE WHEN p_ordenar = 'nome'             AND p_direcao = 'asc'  THEN c.nome END ASC,
            CASE WHEN p_ordenar = 'nome'             AND p_direcao = 'desc' THEN c.nome END DESC,
            CASE WHEN p_ordenar = 'status'           AND p_direcao = 'asc'  THEN c.status END ASC,
            CASE WHEN p_ordenar = 'status'           AND p_direcao = 'desc' THEN c.status END DESC,
            CASE WHEN p_ordenar = 'ultimo_acesso_em' AND p_direcao = 'asc'  THEN c.ultimo_acesso_em END ASC NULLS LAST,
            CASE WHEN p_ordenar = 'ultimo_acesso_em' AND p_direcao = 'desc' THEN c.ultimo_acesso_em END DESC NULLS LAST,
            CASE WHEN p_ordenar = 'criado_em'        AND p_direcao = 'asc'  THEN c.created_at END ASC,
            CASE WHEN p_ordenar = 'criado_em'        AND p_direcao = 'desc' THEN c.created_at END DESC,
            -- Desempate estável: sem ele, duas páginas podem repetir ou pular
            -- uma linha quando há empate no critério escolhido.
            c.id
        LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $$;

-- ── 3. Mudança de status da conta ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_definir_status_corretor(
    p_corretor_id UUID,
    p_status      TEXT,
    p_motivo      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_antes public.corretores;
BEGIN
    PERFORM public.exigir_admin();

    IF p_status NOT IN ('ativo', 'suspenso', 'inativo') THEN
        RAISE EXCEPTION 'status inválido: %', p_status;
    END IF;

    -- Justificativa obrigatória: é ela que dá valor à trilha de auditoria.
    IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    SELECT * INTO v_antes FROM public.corretores WHERE id = p_corretor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'corretor não encontrado';
    END IF;

    -- Suspender o próprio acesso derrubaria o operador para fora do painel na
    -- ação seguinte, sem ninguém para reverter.
    IF v_antes.user_id = auth.uid() THEN
        RAISE EXCEPTION 'você não pode alterar o status da própria conta';
    END IF;

    IF v_antes.status = p_status THEN
        RETURN json_build_object('alterado', false, 'status', p_status);
    END IF;

    UPDATE public.corretores
       SET status = p_status,
           suspenso_em     = CASE WHEN p_status = 'suspenso' THEN now() ELSE NULL END,
           suspenso_motivo = CASE WHEN p_status = 'suspenso' THEN btrim(p_motivo) ELSE NULL END,
           suspenso_por    = CASE WHEN p_status = 'suspenso' THEN auth.uid() ELSE NULL END
     WHERE id = p_corretor_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'definir_status_corretor', 'corretores', p_corretor_id::TEXT,
         jsonb_build_object('status', v_antes.status),
         jsonb_build_object('status', p_status),
         btrim(p_motivo));

    RETURN json_build_object('alterado', true, 'status', p_status);
END $$;

-- ── 4. Detalhe do usuário ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_detalhe_usuario(p_corretor_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_janela INT := public.admin_config_int('janela_atividade_dias', 30);
    v_res    JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT json_build_object(
        'corretor', json_build_object(
            'corretor_id', c.id,
            'user_id', c.user_id,
            'nome', c.nome,
            'email', c.email,
            'telefone', c.telefone,
            'creci', c.creci,
            'creci_estado', c.creci_estado,
            'status', c.status,
            'criado_em', c.created_at,
            'ultimo_acesso_em', c.ultimo_acesso_em,
            'atividade', public.classificar_atividade(c.ultimo_acesso_em, v_janela),
            'suspenso_em', c.suspenso_em,
            'suspenso_motivo', c.suspenso_motivo,
            -- last_sign_in_at do auth é o único dado histórico que existia antes
            -- do back office. Exposto como referência, separado de
            -- ultimo_acesso_em, que é o que a operação passa a medir.
            'ultimo_login_auth', (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = c.user_id),
            'email_confirmado_em', (SELECT u.email_confirmed_at FROM auth.users u WHERE u.id = c.user_id)
        ),
        'uso', json_build_object(
            'clientes',  (SELECT count(*) FROM public.clientes  WHERE corretor_id = c.id),
            'imoveis',   (SELECT count(*) FROM public.imoveis   WHERE corretor_id = c.id),
            'contratos', (SELECT count(*) FROM public.contratos WHERE corretor_id = c.id),
            'eventos_atividade', (SELECT count(*) FROM public.atividade_eventos WHERE corretor_id = c.id)
        ),
        'assinatura', (
            SELECT json_build_object(
                'status', s.status, 'plano', pl.name, 'ciclo', s.billing_cycle,
                'inicio_periodo', s.current_period_start, 'fim_periodo', s.current_period_end,
                'trial_termina_em', s.trial_ends_at
            )
            FROM public.subscriptions s
            LEFT JOIN public.plans pl ON pl.id = s.plan_id
            WHERE s.corretor_id = c.id
            -- Mesma ordenação da listagem: a assinatura vigente primeiro. Sem
            -- ORDER BY, o LIMIT 1 poderia trazer uma cancelada antiga e a tela
            -- mostraria o plano errado.
            ORDER BY CASE WHEN s.status IN ('trialing','active','past_due') THEN 0 ELSE 1 END,
                     s.created_at DESC
            LIMIT 1
        ),
        'parceiro', (
            SELECT json_build_object(
                'parceiro_id', p.id, 'nome', p.nome,
                'convertido_em', pa.convertido_em, 'modelo', pa.modelo
            )
            FROM public.parceiro_atribuicoes pa
            JOIN public.parceiros p ON p.id = pa.parceiro_id
            WHERE pa.corretor_id = c.id AND pa.status = 'convertida'
            LIMIT 1
        ),
        'atividade_recente', COALESCE((
            SELECT json_agg(json_build_object('tipo', a.tipo, 'rota', a.rota, 'criado_em', a.criado_em)
                            ORDER BY a.criado_em DESC)
            FROM (SELECT * FROM public.atividade_eventos
                   WHERE corretor_id = c.id ORDER BY criado_em DESC LIMIT 20) a
        ), '[]'::json)
    ) INTO v_res
    FROM public.corretores c
    WHERE c.id = p_corretor_id;

    IF v_res IS NULL THEN
        RAISE EXCEPTION 'corretor não encontrado';
    END IF;

    RETURN v_res;
END $$;

-- ── 5. Auditoria ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_listar_auditoria(
    p_entidade TEXT DEFAULT NULL,
    p_acao     TEXT DEFAULT NULL,
    p_de       DATE DEFAULT NULL,
    p_ate      DATE DEFAULT NULL,
    p_limite   INT  DEFAULT 50,
    p_offset   INT  DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_total  BIGINT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT count(*) INTO v_total
      FROM public.admin_auditoria a
     WHERE (p_entidade IS NULL OR a.entidade = p_entidade)
       AND (p_acao     IS NULL OR a.acao = p_acao)
       AND (p_de       IS NULL OR a.criado_em >= p_de::TIMESTAMPTZ)
       AND (p_ate      IS NULL OR a.criado_em < (p_ate + 1)::TIMESTAMPTZ);

    SELECT COALESCE(json_agg(x ORDER BY x.criado_em DESC), '[]'::json) INTO v_itens
      FROM (
        SELECT a.id, a.ator_user_id, c.nome AS ator_nome, u.email AS ator_email,
               a.acao, a.entidade, a.entidade_id, a.dados_antes, a.dados_depois,
               a.motivo, a.criado_em
          FROM public.admin_auditoria a
          LEFT JOIN auth.users u      ON u.id = a.ator_user_id
          LEFT JOIN public.corretores c ON c.user_id = a.ator_user_id
         WHERE (p_entidade IS NULL OR a.entidade = p_entidade)
           AND (p_acao     IS NULL OR a.acao = p_acao)
           AND (p_de       IS NULL OR a.criado_em >= p_de::TIMESTAMPTZ)
           AND (p_ate      IS NULL OR a.criado_em < (p_ate + 1)::TIMESTAMPTZ)
         ORDER BY a.criado_em DESC
         LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $$;

-- ── 6. Parceiros com resultados ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_listar_parceiros(
    p_busca  TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_limite INT  DEFAULT 25,
    p_offset INT  DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_busca  TEXT := NULLIF(btrim(COALESCE(p_busca, '')), '');
    v_total  BIGINT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT count(*) INTO v_total FROM public.parceiros p
     WHERE (v_busca IS NULL OR p.nome ILIKE '%'||v_busca||'%'
            OR COALESCE(p.empresa,'') ILIKE '%'||v_busca||'%'
            OR p.email ILIKE '%'||v_busca||'%')
       AND (p_status IS NULL OR p.status = p_status);

    SELECT COALESCE(json_agg(x ORDER BY x.criado_em DESC), '[]'::json) INTO v_itens
      FROM (
        SELECT p.id, p.nome, p.empresa, p.documento, p.email, p.telefone,
               p.responsavel, p.status, p.data_inicio, p.janela_atribuicao_dias,
               p.observacoes, p.user_id, p.criado_em, p.atualizado_em,
               v.percentual AS percentual_vigente,
               v.base_calculo AS base_calculo_vigente,
               (SELECT count(*) FROM public.parceiro_cliques cq WHERE cq.parceiro_id = p.id) AS total_cliques,
               (SELECT count(*) FROM public.parceiro_atribuicoes a WHERE a.parceiro_id = p.id) AS total_atribuicoes,
               (SELECT count(*) FROM public.parceiro_atribuicoes a WHERE a.parceiro_id = p.id AND a.status = 'convertida') AS total_conversoes,
               COALESCE((SELECT sum(co.valor_base) FROM public.parceiro_comissoes co WHERE co.parceiro_id = p.id AND co.status <> 'estornada'), 0) AS receita_atribuida,
               COALESCE((SELECT sum(co.valor_comissao) FROM public.parceiro_comissoes co WHERE co.parceiro_id = p.id AND co.status IN ('pendente','em_validacao')), 0) AS comissao_pendente,
               COALESCE((SELECT sum(co.valor_comissao) FROM public.parceiro_comissoes co WHERE co.parceiro_id = p.id AND co.status = 'aprovada'), 0) AS comissao_aprovada,
               COALESCE((SELECT sum(co.valor_comissao) FROM public.parceiro_comissoes co WHERE co.parceiro_id = p.id AND co.status = 'paga'), 0) AS comissao_paga
          FROM public.parceiros p
          LEFT JOIN LATERAL (
              SELECT * FROM public.parceiro_percentuais pp
               WHERE pp.parceiro_id = p.id AND pp.vigencia_fim IS NULL
               LIMIT 1
          ) v ON TRUE
         WHERE (v_busca IS NULL OR p.nome ILIKE '%'||v_busca||'%'
                OR COALESCE(p.empresa,'') ILIKE '%'||v_busca||'%'
                OR p.email ILIKE '%'||v_busca||'%')
           AND (p_status IS NULL OR p.status = p_status)
         ORDER BY p.criado_em DESC
         LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $$;

-- ── 7. Percentual com vigência ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_definir_percentual(
    p_parceiro_id UUID,
    p_percentual  NUMERIC,
    p_base_calculo TEXT,
    p_valor_fixo  NUMERIC DEFAULT NULL,
    p_vigencia_inicio DATE DEFAULT NULL,
    p_motivo      TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inicio DATE := COALESCE(p_vigencia_inicio, CURRENT_DATE);
    v_atual  public.parceiro_percentuais;
    v_novo   UUID;
BEGIN
    PERFORM public.exigir_admin();

    IF p_base_calculo NOT IN ('receita_bruta','receita_liquida','primeiro_pagamento','valor_fixo') THEN
        RAISE EXCEPTION 'base de cálculo inválida: %', p_base_calculo;
    END IF;

    -- Vigência retroativa reescreveria a regra de comissões já geradas naquele
    -- intervalo, que é exatamente o que o versionamento existe para impedir.
    SELECT * INTO v_atual FROM public.parceiro_percentuais
     WHERE parceiro_id = p_parceiro_id AND vigencia_fim IS NULL;

    IF FOUND AND v_inicio <= v_atual.vigencia_inicio THEN
        RAISE EXCEPTION 'a nova vigência precisa começar depois de % (início da vigência atual)',
            to_char(v_atual.vigencia_inicio, 'DD/MM/YYYY');
    END IF;

    INSERT INTO public.parceiro_percentuais
        (parceiro_id, percentual, base_calculo, valor_fixo, vigencia_inicio, motivo, criado_por)
    VALUES
        (p_parceiro_id, p_percentual, p_base_calculo, p_valor_fixo, v_inicio, p_motivo, auth.uid())
    RETURNING id INTO v_novo;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'definir_percentual', 'parceiros', p_parceiro_id::TEXT,
         CASE WHEN v_atual.id IS NULL THEN NULL
              ELSE jsonb_build_object('percentual', v_atual.percentual, 'base_calculo', v_atual.base_calculo) END,
         jsonb_build_object('percentual', p_percentual, 'base_calculo', p_base_calculo, 'vigencia_inicio', v_inicio),
         p_motivo);

    RETURN json_build_object('id', v_novo, 'vigencia_inicio', v_inicio);
END $$;

-- ── 8. Transição de comissão ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_transicionar_comissao(
    p_comissao_id UUID,
    p_novo_status TEXT,
    p_motivo      TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_atual public.parceiro_comissoes;
    v_ok    BOOLEAN;
BEGIN
    PERFORM public.exigir_admin();

    -- Pagar e estornar mexem em dinheiro que sai: sobem de nível.
    IF p_novo_status IN ('paga', 'estornada') THEN
        PERFORM public.exigir_super_admin();
    END IF;

    SELECT * INTO v_atual FROM public.parceiro_comissoes WHERE id = p_comissao_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'comissão não encontrada';
    END IF;

    -- Máquina de estados. Espelha transicaoValida() em src/lib/admin/comissao.ts;
    -- o TypeScript existe para a interface não oferecer um botão que aqui seria
    -- recusado, mas a decisão que vale é esta.
    v_ok := CASE
        WHEN v_atual.status = 'pendente'     AND p_novo_status IN ('em_validacao','aprovada','cancelada') THEN TRUE
        WHEN v_atual.status = 'em_validacao' AND p_novo_status IN ('aprovada','cancelada')                THEN TRUE
        WHEN v_atual.status = 'aprovada'     AND p_novo_status IN ('paga','cancelada')                    THEN TRUE
        WHEN v_atual.status = 'paga'         AND p_novo_status = 'estornada'                              THEN TRUE
        ELSE FALSE
    END;

    IF NOT v_ok THEN
        RAISE EXCEPTION 'transição inválida: % → %', v_atual.status, p_novo_status;
    END IF;

    IF p_novo_status IN ('cancelada','estornada')
       AND length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    UPDATE public.parceiro_comissoes
       SET status = p_novo_status,
           aprovada_em  = CASE WHEN p_novo_status = 'aprovada' THEN now() ELSE aprovada_em END,
           aprovada_por = CASE WHEN p_novo_status = 'aprovada' THEN auth.uid() ELSE aprovada_por END,
           paga_em      = CASE WHEN p_novo_status = 'paga' THEN now() ELSE paga_em END,
           cancelada_em = CASE WHEN p_novo_status IN ('cancelada','estornada') THEN now() ELSE cancelada_em END,
           cancelada_por= CASE WHEN p_novo_status IN ('cancelada','estornada') THEN auth.uid() ELSE cancelada_por END,
           motivo_cancelamento = CASE WHEN p_novo_status IN ('cancelada','estornada')
                                      THEN btrim(p_motivo) ELSE motivo_cancelamento END
     WHERE id = p_comissao_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'transicionar_comissao', 'parceiro_comissoes', p_comissao_id::TEXT,
         jsonb_build_object('status', v_atual.status),
         jsonb_build_object('status', p_novo_status),
         p_motivo);

    RETURN json_build_object('status', p_novo_status);
END $$;

-- ── 9. Listagem de comissões ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_listar_comissoes(
    p_parceiro_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_de     DATE DEFAULT NULL,
    p_ate    DATE DEFAULT NULL,
    p_limite INT  DEFAULT 25,
    p_offset INT  DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 500);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_total  BIGINT;
    v_itens  JSON;
    v_totais JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT count(*),
           json_build_object(
               'valor_total', COALESCE(sum(co.valor_comissao), 0),
               'valor_base_total', COALESCE(sum(co.valor_base), 0)
           )
      INTO v_total, v_totais
      FROM public.parceiro_comissoes co
     WHERE (p_parceiro_id IS NULL OR co.parceiro_id = p_parceiro_id)
       AND (p_status IS NULL OR co.status = p_status)
       AND (p_de  IS NULL OR co.gerada_em >= p_de::TIMESTAMPTZ)
       AND (p_ate IS NULL OR co.gerada_em < (p_ate + 1)::TIMESTAMPTZ);

    SELECT COALESCE(json_agg(x ORDER BY x.gerada_em DESC), '[]'::json) INTO v_itens
      FROM (
        SELECT co.id, co.parceiro_id, p.nome AS parceiro_nome,
               co.corretor_id, c.nome AS corretor_nome,
               co.receita_evento_id, co.valor_base, co.percentual_aplicado,
               co.base_calculo, co.valor_comissao, co.status, co.competencia,
               co.gerada_em, co.aprovada_em, co.paga_em, co.motivo_cancelamento
          FROM public.parceiro_comissoes co
          JOIN public.parceiros p    ON p.id = co.parceiro_id
          LEFT JOIN public.corretores c ON c.id = co.corretor_id
         WHERE (p_parceiro_id IS NULL OR co.parceiro_id = p_parceiro_id)
           AND (p_status IS NULL OR co.status = p_status)
           AND (p_de  IS NULL OR co.gerada_em >= p_de::TIMESTAMPTZ)
           AND (p_ate IS NULL OR co.gerada_em < (p_ate + 1)::TIMESTAMPTZ)
         ORDER BY co.gerada_em DESC
         LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total, 'totais', v_totais);
END $$;

-- ── 10. Receita: registro e estorno ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_registrar_receita(
    p_corretor_id UUID,
    p_valor_bruto NUMERIC,
    p_confirmado_em TIMESTAMPTZ,
    p_tipo TEXT DEFAULT 'assinatura',
    p_valor_liquido NUMERIC DEFAULT NULL,
    p_competencia DATE DEFAULT NULL,
    p_motivo TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Registrar receita à mão é o ponto onde alguém poderia inventar
    -- faturamento. Fica com super_admin e sempre com justificativa.
    PERFORM public.exigir_super_admin();

    IF p_valor_bruto IS NULL OR p_valor_bruto <= 0 THEN
        RAISE EXCEPTION 'o valor precisa ser maior que zero';
    END IF;

    IF p_confirmado_em > now() THEN
        RAISE EXCEPTION 'não é possível registrar receita com data futura';
    END IF;

    IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    INSERT INTO public.receita_eventos
        (corretor_id, origem, tipo, valor_bruto, valor_liquido, status,
         confirmado_em, competencia, registrado_por, motivo)
    VALUES
        (p_corretor_id, 'manual_admin', p_tipo, p_valor_bruto, p_valor_liquido,
         'confirmado', p_confirmado_em,
         COALESCE(p_competencia, date_trunc('month', p_confirmado_em)::DATE),
         auth.uid(), btrim(p_motivo))
    RETURNING id INTO v_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
    VALUES
        (auth.uid(), 'registrar_receita', 'receita_eventos', v_id::TEXT,
         jsonb_build_object('valor_bruto', p_valor_bruto, 'corretor_id', p_corretor_id),
         btrim(p_motivo));

    RETURN json_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_estornar_receita(
    p_receita_id UUID,
    p_motivo     TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_atual public.receita_eventos;
BEGIN
    PERFORM public.exigir_super_admin();

    IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    SELECT * INTO v_atual FROM public.receita_eventos WHERE id = p_receita_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'evento de receita não encontrado';
    END IF;

    IF v_atual.status <> 'confirmado' THEN
        RAISE EXCEPTION 'só é possível estornar receita confirmada (atual: %)', v_atual.status;
    END IF;

    -- A trigger tr_estornar_comissao cuida da comissão vinculada.
    UPDATE public.receita_eventos
       SET status = 'estornado', estornado_em = now(),
           estornado_por = auth.uid(), motivo_estorno = btrim(p_motivo)
     WHERE id = p_receita_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'estornar_receita', 'receita_eventos', p_receita_id::TEXT,
         jsonb_build_object('status', v_atual.status, 'valor_bruto', v_atual.valor_bruto),
         jsonb_build_object('status', 'estornado'), btrim(p_motivo));

    RETURN json_build_object('id', p_receita_id, 'status', 'estornado');
END $$;

CREATE OR REPLACE FUNCTION public.admin_listar_receita(
    p_corretor_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_de     DATE DEFAULT NULL,
    p_ate    DATE DEFAULT NULL,
    p_limite INT  DEFAULT 25,
    p_offset INT  DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limite INT := LEAST(GREATEST(COALESCE(p_limite, 25), 1), 200);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_total  BIGINT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT count(*) INTO v_total FROM public.receita_eventos r
     WHERE (p_corretor_id IS NULL OR r.corretor_id = p_corretor_id)
       AND (p_status IS NULL OR r.status = p_status)
       AND (p_de  IS NULL OR r.confirmado_em >= p_de::TIMESTAMPTZ)
       AND (p_ate IS NULL OR r.confirmado_em < (p_ate + 1)::TIMESTAMPTZ);

    SELECT COALESCE(json_agg(x ORDER BY x.confirmado_em DESC), '[]'::json) INTO v_itens
      FROM (
        SELECT r.id, r.corretor_id, c.nome AS corretor_nome, r.origem, r.external_id,
               r.tipo, r.valor_bruto, r.valor_liquido, r.status, r.confirmado_em,
               r.competencia, r.motivo, r.criado_em
          FROM public.receita_eventos r
          LEFT JOIN public.corretores c ON c.id = r.corretor_id
         WHERE (p_corretor_id IS NULL OR r.corretor_id = p_corretor_id)
           AND (p_status IS NULL OR r.status = p_status)
           AND (p_de  IS NULL OR r.confirmado_em >= p_de::TIMESTAMPTZ)
           AND (p_ate IS NULL OR r.confirmado_em < (p_ate + 1)::TIMESTAMPTZ)
         ORDER BY r.confirmado_em DESC
         LIMIT v_limite OFFSET v_offset
      ) x;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $$;

-- ── 11. Pagamento de comissões em lote ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento(
    p_parceiro_id UUID,
    p_comissao_ids UUID[],
    p_metodo TEXT DEFAULT NULL,
    p_referencia TEXT DEFAULT NULL,
    p_pago_em DATE DEFAULT NULL,
    p_observacoes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total NUMERIC(12,2);
    v_qtd   INT;
    v_pag   UUID;
BEGIN
    PERFORM public.exigir_super_admin();

    IF p_comissao_ids IS NULL OR array_length(p_comissao_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'selecione ao menos uma comissão';
    END IF;

    -- Só comissão aprovada e do parceiro informado entra no lote. Sem este
    -- filtro, um id de outro parceiro entraria no pagamento por engano.
    SELECT COALESCE(sum(valor_comissao), 0), count(*)
      INTO v_total, v_qtd
      FROM public.parceiro_comissoes
     WHERE id = ANY(p_comissao_ids)
       AND parceiro_id = p_parceiro_id
       AND status = 'aprovada';

    IF v_qtd = 0 THEN
        RAISE EXCEPTION 'nenhuma comissão aprovada deste parceiro na seleção';
    END IF;

    IF v_qtd <> array_length(p_comissao_ids, 1) THEN
        RAISE EXCEPTION 'a seleção tem % comissões, mas só % estão aprovadas para este parceiro',
            array_length(p_comissao_ids, 1), v_qtd;
    END IF;

    INSERT INTO public.parceiro_pagamentos
        (parceiro_id, valor_total, metodo, referencia, pago_em, observacoes,
         registrado_por, competencia_inicio, competencia_fim)
    VALUES
        (p_parceiro_id, v_total, p_metodo, p_referencia,
         COALESCE(p_pago_em, CURRENT_DATE), p_observacoes, auth.uid(),
         (SELECT min(competencia) FROM public.parceiro_comissoes WHERE id = ANY(p_comissao_ids)),
         (SELECT max(competencia) FROM public.parceiro_comissoes WHERE id = ANY(p_comissao_ids)))
    RETURNING id INTO v_pag;

    UPDATE public.parceiro_comissoes
       SET status = 'paga', paga_em = now(), pagamento_id = v_pag
     WHERE id = ANY(p_comissao_ids) AND parceiro_id = p_parceiro_id AND status = 'aprovada';

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
    VALUES
        (auth.uid(), 'registrar_pagamento', 'parceiro_pagamentos', v_pag::TEXT,
         jsonb_build_object('valor_total', v_total, 'comissoes', v_qtd,
                            'parceiro_id', p_parceiro_id),
         p_observacoes);

    RETURN json_build_object('id', v_pag, 'valor_total', v_total, 'comissoes', v_qtd);
END $$;

-- ── 12. Grants ────────────────────────────────────────────────────────────
-- Executar é permitido a qualquer autenticado; o guard interno é que decide.
-- Assim um corretor comum recebe 42501 explícito em vez de "função não existe",
-- que seria pior de diagnosticar.
GRANT EXECUTE ON FUNCTION public.admin_metricas_visao_geral(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_usuarios(TEXT,TEXT,TEXT,UUID,DATE,DATE,TEXT,TEXT,INT,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_definir_status_corretor(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_usuario(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_auditoria(TEXT,TEXT,DATE,DATE,INT,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_parceiros(TEXT,TEXT,INT,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_definir_percentual(UUID,NUMERIC,TEXT,NUMERIC,DATE,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transicionar_comissao(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_comissoes(UUID,TEXT,DATE,DATE,INT,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registrar_receita(UUID,NUMERIC,TIMESTAMPTZ,TEXT,NUMERIC,DATE,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_estornar_receita(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_receita(UUID,TEXT,DATE,DATE,INT,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registrar_pagamento(UUID,UUID[],TEXT,TEXT,DATE,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exigir_admin()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.exigir_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_config_int(TEXT,INT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_config_texto(TEXT,TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.classificar_atividade(TIMESTAMPTZ,INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.percentual_vigente_em(UUID,DATE) TO authenticated;
