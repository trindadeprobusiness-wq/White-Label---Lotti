-- ═══════════════════════════════════════════════════════════════════════════
-- Back office — cancelamentos, repasses em lote, integrações e configuração
--
-- Continuação de 20260901160100. Mesmo contrato: SECURITY DEFINER, guard na
-- primeira linha, `SET search_path = public`.
--
-- Divisão de papéis, seguindo a que já vale no projeto: `admin` opera e
-- prepara; `super_admin` é quem confirma dinheiro que sai e quem altera a
-- configuração do programa.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Feedback de cancelamento ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_registrar_cancelamento(
    p_motivo      TEXT,
    p_corretor_id UUID DEFAULT NULL,
    p_contato_nome TEXT DEFAULT NULL,
    p_contato_email TEXT DEFAULT NULL,
    p_contato_telefone TEXT DEFAULT NULL,
    p_plano_anterior TEXT DEFAULT NULL,
    p_comentario  TEXT DEFAULT NULL,
    p_origem      TEXT DEFAULT 'outro',
    p_data        DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id    UUID;
    v_nome  TEXT := NULLIF(btrim(COALESCE(p_contato_nome, '')), '');
    v_email TEXT := NULLIF(btrim(COALESCE(p_contato_email, '')), '');
    v_fone  TEXT := NULLIF(btrim(COALESCE(p_contato_telefone, '')), '');
    v_plano TEXT := NULLIF(btrim(COALESCE(p_plano_anterior, '')), '');
BEGIN
    PERFORM public.exigir_admin();

    IF p_corretor_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.corretores WHERE id = p_corretor_id) THEN
            RAISE EXCEPTION 'conta não encontrada';
        END IF;
        -- Havendo conta, o contato sai do join. Descartar aqui é o que faz a
        -- constraint `cancelamento_feedback_sem_pii_duplicado` passar sem
        -- obrigar a tela a saber da regra — e evita uma segunda cópia de dado
        -- pessoal para localizar num pedido de exclusão.
        v_nome  := NULL;
        v_email := NULL;
        v_fone  := NULL;

        -- Plano anterior também é derivável, mas precisa ser congelado: a
        -- assinatura pode mudar de plano depois, e o feedback perderia o
        -- contexto de qual plano a pessoa estava pagando quando saiu.
        --
        -- O guard não é zelo excessivo: em 2026-09-02 o diagnóstico de
        -- produção mostrou `plans` e `subscriptions` ausentes. Sem ele,
        -- registrar um cancelamento de conta identificada estouraria 42P01 e
        -- o operador perderia o depoimento que acabou de colher.
        IF v_plano IS NULL
           AND to_regclass('public.subscriptions') IS NOT NULL
           AND to_regclass('public.plans') IS NOT NULL THEN
            SELECT p.code INTO v_plano
            FROM public.subscriptions s
            JOIN public.plans p ON p.id = s.plan_id
            WHERE s.corretor_id = p_corretor_id
            ORDER BY s.updated_at DESC
            LIMIT 1;
        END IF;
    END IF;

    INSERT INTO public.cancelamento_feedback
        (corretor_id, contato_nome, contato_email, contato_telefone,
         plano_anterior, motivo, comentario, origem, data_cancelamento, registrado_por)
    VALUES
        (p_corretor_id, v_nome, v_email, v_fone,
         v_plano, p_motivo, NULLIF(btrim(COALESCE(p_comentario, '')), ''),
         COALESCE(p_origem, 'outro'), COALESCE(p_data, CURRENT_DATE), auth.uid())
    RETURNING id INTO v_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_depois, motivo)
    VALUES
        (auth.uid(), 'registrar_cancelamento', 'cancelamento_feedback', v_id::TEXT,
         -- Sem o comentário: ele é a fala do cliente e já está na própria
         -- linha. Repeti-lo na trilha só multiplica onde o dado precisa ser
         -- apagado depois.
         jsonb_build_object('motivo', p_motivo, 'origem', COALESCE(p_origem, 'outro'),
                            'corretor_id', p_corretor_id),
         NULL);

    RETURN json_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_listar_cancelamentos(
    p_motivo  TEXT DEFAULT NULL,
    p_origem  TEXT DEFAULT NULL,
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
BEGIN
    PERFORM public.exigir_admin();

    v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 25), 1), 100);
    v_offset := (GREATEST(COALESCE(p_pagina, 1), 1) - 1) * v_limite;

    SELECT count(*) INTO v_total
    FROM public.cancelamento_feedback f
    WHERE (p_motivo IS NULL OR f.motivo = p_motivo)
      AND (p_origem IS NULL OR f.origem = p_origem)
      AND (p_plano  IS NULL OR f.plano_anterior = p_plano)
      AND (p_inicio IS NULL OR f.data_cancelamento >= p_inicio)
      AND (p_fim    IS NULL OR f.data_cancelamento <= p_fim);

    SELECT COALESCE(json_agg(linha), '[]'::JSON)
    INTO v_itens
    FROM (
        SELECT json_build_object(
            'id',      f.id,
            'corretor_id', f.corretor_id,
            -- COALESCE resolve os dois casos numa coluna só para a tela: conta
            -- identificada usa o cadastro, cancelamento avulso usa o que foi
            -- digitado no formulário.
            'nome',    COALESCE(c.nome, f.contato_nome),
            'email',   COALESCE(c.email, f.contato_email),
            'telefone',COALESCE(c.telefone, f.contato_telefone),
            'identificado', f.corretor_id IS NOT NULL,
            'plano_anterior', f.plano_anterior,
            'motivo',  f.motivo,
            'comentario', f.comentario,
            'origem',  f.origem,
            'data_cancelamento', f.data_cancelamento,
            'criado_em', f.criado_em
        ) AS linha
        FROM public.cancelamento_feedback f
        LEFT JOIN public.corretores c ON c.id = f.corretor_id
        WHERE (p_motivo IS NULL OR f.motivo = p_motivo)
          AND (p_origem IS NULL OR f.origem = p_origem)
          AND (p_plano  IS NULL OR f.plano_anterior = p_plano)
          AND (p_inicio IS NULL OR f.data_cancelamento >= p_inicio)
          AND (p_fim    IS NULL OR f.data_cancelamento <= p_fim)
        ORDER BY f.data_cancelamento DESC, f.criado_em DESC
        LIMIT v_limite OFFSET v_offset
    ) sub;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $$;

CREATE OR REPLACE FUNCTION public.admin_metricas_cancelamento(
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
    v_resultado JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT json_build_object(
        'total_geral',  (SELECT count(*) FROM public.cancelamento_feedback),
        'no_periodo',   (SELECT count(*) FROM public.cancelamento_feedback
                          WHERE data_cancelamento BETWEEN p_inicio AND p_fim),
        'ultimos_30',   (SELECT count(*) FROM public.cancelamento_feedback
                          WHERE data_cancelamento >= CURRENT_DATE - 30),
        'motivo_principal', (
            SELECT f.motivo FROM public.cancelamento_feedback f
             WHERE f.data_cancelamento BETWEEN p_inicio AND p_fim
             GROUP BY f.motivo
             -- Desempate por nome do motivo: sem ele, dois motivos empatados
             -- alternariam a cada recarga e a tela pareceria instável.
             ORDER BY count(*) DESC, f.motivo ASC
             LIMIT 1
        ),
        'por_motivo', COALESCE((
            SELECT json_agg(json_build_object('motivo', m.motivo, 'total', m.total)
                            ORDER BY m.total DESC, m.motivo ASC)
            FROM (
                SELECT motivo, count(*) AS total
                FROM public.cancelamento_feedback
                WHERE data_cancelamento BETWEEN p_inicio AND p_fim
                GROUP BY motivo
            ) m
        ), '[]'::JSON),
        'por_origem', COALESCE((
            SELECT json_agg(json_build_object('origem', o.origem, 'total', o.total)
                            ORDER BY o.total DESC, o.origem ASC)
            FROM (
                SELECT origem, count(*) AS total
                FROM public.cancelamento_feedback
                WHERE data_cancelamento BETWEEN p_inicio AND p_fim
                GROUP BY origem
            ) o
        ), '[]'::JSON)
    ) INTO v_resultado;

    RETURN v_resultado;
END $$;

-- ── 2. Elegibilidade para repasse ─────────────────────────────────────────
-- Prévia do que entraria num lote. Existe separada da geração porque escolher
-- quem entra é decisão do operador, e ele precisa ver o valor antes.
CREATE OR REPLACE FUNCTION public.admin_parceiros_elegiveis_repasse(
    p_saldo_minimo NUMERIC DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_minimo NUMERIC;
    v_hold   INT;
    v_itens  JSON;
BEGIN
    PERFORM public.exigir_admin();

    v_minimo := COALESCE(p_saldo_minimo,
                         (SELECT (valor #>> '{}')::NUMERIC FROM public.admin_config
                           WHERE chave = 'programa_saldo_minimo'), 0);
    v_hold   := public.admin_config_int('programa_hold_dias', 0);

    SELECT COALESCE(json_agg(linha ORDER BY linha->>'nome'), '[]'::JSON)
    INTO v_itens
    FROM (
        SELECT json_build_object(
            'parceiro_id', p.id,
            'nome',        p.nome,
            'email',       p.email,
            'documento',   p.documento,
            'chave_pix',   p.chave_pix,
            'tipo_chave_pix', p.tipo_chave_pix,
            'comissoes',   count(c.id),
            'valor',       COALESCE(SUM(c.valor_comissao), 0),
            'elegivel',    COALESCE(SUM(c.valor_comissao), 0) >= v_minimo
        ) AS linha
        FROM public.parceiros p
        JOIN public.parceiro_comissoes c ON c.parceiro_id = p.id
        WHERE p.status = 'ativo'
          -- Sem PIX não há como pagar. Aparecer na lista e falhar na exportação
          -- seria pior que não aparecer: a tela informa o motivo.
          AND p.chave_pix IS NOT NULL
          AND p.tipo_chave_pix IS NOT NULL
          AND c.status = 'aprovada'
          -- Hold: comissão recém-gerada ainda pode ser desfeita por estorno ou
          -- chargeback da receita que a originou. Pagar antes disso é dinheiro
          -- que sai e não volta.
          AND c.gerada_em <= now() - make_interval(days => v_hold)
          AND NOT EXISTS (
              SELECT 1 FROM public.parceiro_lote_itens i WHERE i.comissao_id = c.id
          )
        GROUP BY p.id, p.nome, p.email, p.documento, p.chave_pix, p.tipo_chave_pix
    ) sub;

    RETURN json_build_object(
        'saldo_minimo', v_minimo,
        'hold_dias',    v_hold,
        'itens',        v_itens
    );
END $$;

-- ── 3. Geração do lote ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_gerar_lote_repasse(
    p_parceiro_ids UUID[],
    p_saldo_minimo NUMERIC DEFAULT NULL,
    p_observacoes  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_minimo NUMERIC;
    v_hold   INT;
    v_lote_id UUID;
    v_ref    TEXT;
    v_seq    INT;
    v_total  NUMERIC(12,2);
    v_qtd    INT;
    v_parceiros INT;
BEGIN
    PERFORM public.exigir_admin();

    IF p_parceiro_ids IS NULL OR array_length(p_parceiro_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'selecione ao menos um parceiro';
    END IF;

    v_minimo := COALESCE(p_saldo_minimo,
                         (SELECT (valor #>> '{}')::NUMERIC FROM public.admin_config
                           WHERE chave = 'programa_saldo_minimo'), 0);
    v_hold   := public.admin_config_int('programa_hold_dias', 0);

    -- Referência legível e única por mês. O UNIQUE da coluna é quem garante;
    -- a contagem só escolhe o próximo número.
    SELECT count(*) + 1 INTO v_seq
    FROM public.parceiro_lotes
    WHERE date_trunc('month', criado_em) = date_trunc('month', now());

    v_ref := 'LOTE-' || to_char(now(), 'YYYY-MM') || '-' || lpad(v_seq::TEXT, 4, '0');

    INSERT INTO public.parceiro_lotes (referencia, saldo_minimo, observacoes, criado_por)
    VALUES (v_ref, v_minimo, NULLIF(btrim(COALESCE(p_observacoes, '')), ''), auth.uid())
    RETURNING id INTO v_lote_id;

    -- Um INSERT..SELECT só. Se duas gerações concorrerem pela mesma comissão,
    -- a UNIQUE de `comissao_id` derruba a segunda inteira — a função é
    -- atômica, então não sobra lote pela metade.
    WITH elegiveis AS (
        SELECT c.id AS comissao_id, c.parceiro_id, c.valor_comissao,
               p.nome, p.documento, p.chave_pix, p.tipo_chave_pix,
               SUM(c.valor_comissao) OVER (PARTITION BY c.parceiro_id) AS saldo_parceiro
        FROM public.parceiro_comissoes c
        JOIN public.parceiros p ON p.id = c.parceiro_id
        WHERE c.parceiro_id = ANY (p_parceiro_ids)
          AND c.status = 'aprovada'
          AND p.status = 'ativo'
          AND p.chave_pix IS NOT NULL
          AND p.tipo_chave_pix IS NOT NULL
          AND c.gerada_em <= now() - make_interval(days => v_hold)
          AND NOT EXISTS (
              SELECT 1 FROM public.parceiro_lote_itens i WHERE i.comissao_id = c.id
          )
    )
    INSERT INTO public.parceiro_lote_itens
        (lote_id, parceiro_id, comissao_id, valor,
         nome_beneficiario, documento_beneficiario, chave_pix, tipo_chave_pix)
    SELECT v_lote_id, e.parceiro_id, e.comissao_id, e.valor_comissao,
           e.nome, e.documento, e.chave_pix, e.tipo_chave_pix
    FROM elegiveis e
    WHERE e.saldo_parceiro >= v_minimo;

    SELECT COALESCE(SUM(valor), 0), count(*), count(DISTINCT parceiro_id)
    INTO v_total, v_qtd, v_parceiros
    FROM public.parceiro_lote_itens WHERE lote_id = v_lote_id;

    IF v_qtd = 0 THEN
        -- Lote vazio não é registro: é ruído no histórico e um CSV em branco
        -- que alguém vai tentar entender depois.
        DELETE FROM public.parceiro_lotes WHERE id = v_lote_id;
        RAISE EXCEPTION 'nenhuma comissão elegível para os parceiros selecionados';
    END IF;

    UPDATE public.parceiro_lotes
       SET valor_total = v_total, total_comissoes = v_qtd, total_parceiros = v_parceiros
     WHERE id = v_lote_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_depois)
    VALUES
        (auth.uid(), 'gerar_lote_repasse', 'parceiro_lotes', v_lote_id::TEXT,
         jsonb_build_object('referencia', v_ref, 'valor_total', v_total,
                            'comissoes', v_qtd, 'parceiros', v_parceiros));

    RETURN json_build_object(
        'id', v_lote_id, 'referencia', v_ref, 'valor_total', v_total,
        'total_comissoes', v_qtd, 'total_parceiros', v_parceiros
    );
END $$;

-- ── 4. Consulta de lotes ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_listar_lotes(
    p_status TEXT DEFAULT NULL,
    p_pagina INT DEFAULT 1,
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

    v_limite := LEAST(GREATEST(COALESCE(p_por_pagina, 25), 1), 100);
    v_offset := (GREATEST(COALESCE(p_pagina, 1), 1) - 1) * v_limite;

    SELECT count(*) INTO v_total FROM public.parceiro_lotes
     WHERE (p_status IS NULL OR status = p_status);

    SELECT COALESCE(json_agg(linha), '[]'::JSON) INTO v_itens
    FROM (
        SELECT json_build_object(
            'id', l.id, 'referencia', l.referencia, 'status', l.status,
            'valor_total', l.valor_total, 'total_parceiros', l.total_parceiros,
            'total_comissoes', l.total_comissoes, 'saldo_minimo', l.saldo_minimo,
            'exportado_em', l.exportado_em, 'pago_em', l.pago_em,
            'referencia_pagamento', l.referencia_pagamento,
            'observacoes', l.observacoes, 'motivo_cancelamento', l.motivo_cancelamento,
            'criado_em', l.criado_em
        ) AS linha
        FROM public.parceiro_lotes l
        WHERE (p_status IS NULL OR l.status = p_status)
        ORDER BY l.criado_em DESC
        LIMIT v_limite OFFSET v_offset
    ) sub;

    RETURN json_build_object('itens', v_itens, 'total', v_total);
END $$;

CREATE OR REPLACE FUNCTION public.admin_detalhe_lote(p_lote_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lote  JSON;
    v_itens JSON;
BEGIN
    PERFORM public.exigir_admin();

    SELECT json_build_object(
        'id', l.id, 'referencia', l.referencia, 'status', l.status,
        'valor_total', l.valor_total, 'total_parceiros', l.total_parceiros,
        'total_comissoes', l.total_comissoes, 'saldo_minimo', l.saldo_minimo,
        'exportado_em', l.exportado_em, 'pago_em', l.pago_em,
        'referencia_pagamento', l.referencia_pagamento, 'comprovante_url', l.comprovante_url,
        'observacoes', l.observacoes, 'motivo_cancelamento', l.motivo_cancelamento,
        'criado_em', l.criado_em
    ) INTO v_lote
    FROM public.parceiro_lotes l WHERE l.id = p_lote_id;

    IF v_lote IS NULL THEN
        RAISE EXCEPTION 'lote não encontrado';
    END IF;

    -- Agrupado por parceiro: é assim que o PIX é feito e é assim que o CSV
    -- precisa somar. Uma linha por comissão obrigaria quem paga a somar à mão.
    SELECT COALESCE(json_agg(linha ORDER BY linha->>'nome'), '[]'::JSON) INTO v_itens
    FROM (
        SELECT json_build_object(
            'parceiro_id', i.parceiro_id,
            'nome',        i.nome_beneficiario,
            'documento',   i.documento_beneficiario,
            'chave_pix',   i.chave_pix,
            'tipo_chave_pix', i.tipo_chave_pix,
            'comissoes',   count(*),
            'valor',       SUM(i.valor)
        ) AS linha
        FROM public.parceiro_lote_itens i
        WHERE i.lote_id = p_lote_id
        GROUP BY i.parceiro_id, i.nome_beneficiario, i.documento_beneficiario,
                 i.chave_pix, i.tipo_chave_pix
    ) sub;

    RETURN json_build_object('lote', v_lote, 'itens', v_itens);
END $$;

-- ── 5. Ciclo de vida do lote ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_marcar_lote_exportado(p_lote_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
BEGIN
    PERFORM public.exigir_admin();

    SELECT status INTO v_status FROM public.parceiro_lotes WHERE id = p_lote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lote não encontrado'; END IF;
    IF v_status <> 'rascunho' THEN
        RAISE EXCEPTION 'apenas lote em rascunho pode ser exportado';
    END IF;

    UPDATE public.parceiro_lotes
       SET status = 'exportado', exportado_em = now()
     WHERE id = p_lote_id;

    RETURN json_build_object('status', 'exportado');
END $$;

CREATE OR REPLACE FUNCTION public.admin_marcar_lote_pago(
    p_lote_id   UUID,
    p_pago_em   DATE,
    p_referencia TEXT,
    p_comprovante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_ref    TEXT;
    v_pagamentos INT := 0;
    v_divergentes INT;
    r RECORD;
    v_pagamento_id UUID;
BEGIN
    -- Confirmar pagamento é dinheiro que saiu. Mesmo nível de
    -- `admin_transicionar_comissao` para 'paga'.
    PERFORM public.exigir_super_admin();

    IF length(btrim(COALESCE(p_referencia, ''))) < 3 THEN
        RAISE EXCEPTION 'informe a referência ou o comprovante do pagamento';
    END IF;

    SELECT status, referencia INTO v_status, v_ref
    FROM public.parceiro_lotes WHERE id = p_lote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lote não encontrado'; END IF;
    IF v_status NOT IN ('rascunho', 'exportado', 'falhou') THEN
        RAISE EXCEPTION 'lote % não pode ser marcado como pago', v_status;
    END IF;

    -- Entre gerar e pagar, uma comissão do lote pode ter sido cancelada ou
    -- estornada. O valor do item está congelado, então o `parceiro_pagamentos`
    -- registraria um total que inclui dinheiro que não é mais devido — e o
    -- UPDATE seguinte, filtrado por `status = 'aprovada'`, silenciosamente não
    -- marcaria aquela comissão. Divergência em repasse não se resolve
    -- adivinhando: o lote precisa ser cancelado e gerado de novo.
    SELECT count(*) INTO v_divergentes
    FROM public.parceiro_lote_itens i
    JOIN public.parceiro_comissoes c ON c.id = i.comissao_id
    WHERE i.lote_id = p_lote_id AND c.status <> 'aprovada';

    IF v_divergentes > 0 THEN
        RAISE EXCEPTION
            '% comissão(ões) deste lote deixaram de estar aprovadas. Cancele o lote e gere outro.',
            v_divergentes;
    END IF;

    -- Um `parceiro_pagamentos` por parceiro, reaproveitando a tabela que já
    -- existe desde 20260814130000 — o histórico de repasse continua tendo um
    -- lugar só, com ou sem lote.
    FOR r IN
        SELECT i.parceiro_id, SUM(i.valor) AS valor
        FROM public.parceiro_lote_itens i
        WHERE i.lote_id = p_lote_id
        GROUP BY i.parceiro_id
    LOOP
        INSERT INTO public.parceiro_pagamentos
            (parceiro_id, valor_total, metodo, referencia, pago_em,
             comprovante_url, observacoes, registrado_por)
        VALUES
            (r.parceiro_id, r.valor, 'pix', btrim(p_referencia),
             COALESCE(p_pago_em, CURRENT_DATE), p_comprovante_url,
             'Lote ' || v_ref, auth.uid())
        RETURNING id INTO v_pagamento_id;

        -- Mesma semântica de `admin_transicionar_comissao` para 'paga'. Feito
        -- em lote e com UMA linha de auditoria para o lote inteiro: a trilha
        -- por comissão fica reconstruível por `parceiro_lote_itens`, e 200
        -- linhas de auditoria idênticas afogariam a tela de auditoria.
        UPDATE public.parceiro_comissoes c
           SET status = 'paga', paga_em = now(), pagamento_id = v_pagamento_id
          FROM public.parceiro_lote_itens i
         WHERE i.lote_id = p_lote_id
           AND i.comissao_id = c.id
           AND i.parceiro_id = r.parceiro_id
           AND c.status = 'aprovada';

        v_pagamentos := v_pagamentos + 1;
    END LOOP;

    UPDATE public.parceiro_lotes
       SET status = 'pago', pago_em = COALESCE(p_pago_em, CURRENT_DATE),
           referencia_pagamento = btrim(p_referencia),
           comprovante_url = p_comprovante_url
     WHERE id = p_lote_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'marcar_lote_pago', 'parceiro_lotes', p_lote_id::TEXT,
         jsonb_build_object('status', v_status),
         jsonb_build_object('status', 'pago', 'pagamentos', v_pagamentos,
                            'referencia_pagamento', btrim(p_referencia)),
         p_referencia);

    RETURN json_build_object('status', 'pago', 'pagamentos', v_pagamentos);
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancelar_lote(
    p_lote_id UUID,
    p_motivo  TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_itens  INT;
BEGIN
    PERFORM public.exigir_super_admin();

    IF length(btrim(COALESCE(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'informe uma justificativa com ao menos 10 caracteres';
    END IF;

    SELECT status INTO v_status FROM public.parceiro_lotes WHERE id = p_lote_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'lote não encontrado'; END IF;
    IF v_status = 'pago' THEN
        -- Lote pago não volta atrás: o dinheiro saiu. O caminho é estornar as
        -- comissões individualmente, que deixa trilha própria.
        RAISE EXCEPTION 'lote já pago não pode ser cancelado; estorne as comissões';
    END IF;

    SELECT count(*) INTO v_itens FROM public.parceiro_lote_itens WHERE lote_id = p_lote_id;

    -- Apagar os itens é o que devolve as comissões ao conjunto elegível — a
    -- UNIQUE de `comissao_id` é global, então mantê-los travaria as comissões
    -- num lote morto para sempre. Os totais ficam congelados no lote como
    -- registro do que chegou a ser montado.
    DELETE FROM public.parceiro_lote_itens WHERE lote_id = p_lote_id;

    UPDATE public.parceiro_lotes
       SET status = 'cancelado', motivo_cancelamento = btrim(p_motivo)
     WHERE id = p_lote_id;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois, motivo)
    VALUES
        (auth.uid(), 'cancelar_lote', 'parceiro_lotes', p_lote_id::TEXT,
         jsonb_build_object('status', v_status, 'itens', v_itens),
         jsonb_build_object('status', 'cancelado'),
         btrim(p_motivo));

    RETURN json_build_object('status', 'cancelado', 'comissoes_liberadas', v_itens);
END $$;

-- ── 6. Configuração ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_salvar_config(
    p_chave TEXT,
    p_valor JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_antes JSONB;
BEGIN
    PERFORM public.exigir_super_admin();

    SELECT valor INTO v_antes FROM public.admin_config WHERE chave = p_chave;
    IF NOT FOUND THEN
        -- Só chaves semeadas por migration. Aceitar chave livre transformaria
        -- `admin_config` em depósito de qualquer coisa vinda do navegador.
        RAISE EXCEPTION 'configuração desconhecida: %', p_chave;
    END IF;

    UPDATE public.admin_config
       SET valor = p_valor, atualizado_em = now(), atualizado_por = auth.uid()
     WHERE chave = p_chave;

    INSERT INTO public.admin_auditoria
        (ator_user_id, acao, entidade, entidade_id, dados_antes, dados_depois)
    VALUES
        (auth.uid(), 'alterar_config', 'admin_config', p_chave,
         jsonb_build_object('valor', v_antes), jsonb_build_object('valor', p_valor));

    RETURN json_build_object('chave', p_chave, 'valor', p_valor);
END $$;

CREATE OR REPLACE FUNCTION public.admin_listar_config()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.exigir_admin();

    RETURN COALESCE((
        SELECT json_agg(json_build_object(
            'chave', chave, 'valor', valor, 'descricao', descricao,
            'atualizado_em', atualizado_em) ORDER BY chave)
        FROM public.admin_config
    ), '[]'::JSON);
END $$;

-- ── 7. Status das integrações ─────────────────────────────────────────────
-- Sinais medidos, não checklist estático. Cada item responde a uma pergunta
-- que já custou tempo neste projeto: a migration rodou? a RLS está ligada? o
-- webhook chegou a processar alguma coisa?
--
-- Nada aqui devolve segredo, payload ou chave — apenas contagens, datas e
-- booleanos. `last_error` é o único texto de erro exposto e vem truncado.
CREATE OR REPLACE FUNCTION public.admin_status_integracoes()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_checkout   JSON;
    v_asaas      JSON;
    v_tracking   JSON;
    v_repasse    JSON;
    v_rls        JSON;
BEGIN
    PERFORM public.exigir_admin();

    -- Checkout do site (repositório irmão). Ausente não é erro: significa que
    -- a base ainda não recebeu a migration do site.
    IF to_regclass('public.checkout_orders') IS NULL THEN
        v_checkout := json_build_object('instalado', FALSE);
    ELSE
        SELECT json_build_object(
            'instalado', TRUE,
            'pedidos',   count(*),
            'pagos',     count(*) FILTER (WHERE status = 'active'),
            'aguardando',count(*) FILTER (WHERE status IN ('creating', 'awaiting_payment')),
            'falhados',  count(*) FILTER (WHERE status = 'failed'),
            -- Pedido pago sem acesso enviado é o pior estado possível: alguém
            -- pagou e não entrou. Precisa ser um número na tela.
            'pagos_sem_acesso', count(*) FILTER (
                WHERE status = 'active' AND access_email_sent_at IS NULL)
        ) INTO v_checkout FROM public.checkout_orders;
    END IF;

    IF to_regclass('public.asaas_checkout_events') IS NULL THEN
        v_asaas := json_build_object('instalado', FALSE);
    ELSE
        SELECT json_build_object(
            'instalado', TRUE,
            'eventos',   count(*),
            'processados', count(*) FILTER (WHERE status = 'processed'),
            'falhados',  count(*) FILTER (WHERE status = 'failed'),
            'ultimo_processado_em', max(processed_at) FILTER (WHERE status = 'processed'),
            'ultimo_erro', left(max(error_code) FILTER (WHERE status = 'failed'), 120)
        ) INTO v_asaas FROM public.asaas_checkout_events;
    END IF;

    SELECT json_build_object(
        'cliques_total',    (SELECT count(*) FROM public.parceiro_cliques),
        'cliques_30d',      (SELECT count(*) FROM public.parceiro_cliques
                              WHERE criado_em >= now() - INTERVAL '30 days'),
        'links_ativos',     (SELECT count(*) FROM public.parceiro_links WHERE ativo),
        'atribuicoes',      (SELECT count(*) FROM public.parceiro_atribuicoes),
        'ultimo_clique_em', (SELECT max(criado_em) FROM public.parceiro_cliques)
    ) INTO v_tracking;

    SELECT json_build_object(
        'parceiros_ativos', (SELECT count(*) FROM public.parceiros WHERE status = 'ativo'),
        'parceiros_com_pix',(SELECT count(*) FROM public.parceiros
                              WHERE status = 'ativo' AND chave_pix IS NOT NULL),
        'comissoes_aprovadas', (SELECT count(*) FROM public.parceiro_comissoes
                                 WHERE status = 'aprovada'),
        'lotes_abertos',    (SELECT count(*) FROM public.parceiro_lotes
                              WHERE status IN ('rascunho', 'exportado')),
        'portal_publicado', COALESCE(
            (SELECT (valor #>> '{}')::BOOLEAN FROM public.admin_config
              WHERE chave = 'portal_publicado'), FALSE)
    ) INTO v_repasse;

    -- RLS das tabelas novas, lida do catálogo. Uma tabela do back office sem
    -- RLS é vazamento entre inquilinos, e é o tipo de coisa que só aparece
    -- quando alguém olha — então a tela olha.
    SELECT json_agg(json_build_object(
        'tabela', c.relname,
        'rls',    c.relrowsecurity,
        'policies', (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
    ) ORDER BY c.relname) INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('parceiro_lotes', 'parceiro_lote_itens', 'cancelamento_feedback',
                        'parceiros', 'parceiro_comissoes', 'receita_eventos',
                        'admin_config', 'admin_auditoria', 'user_roles');

    RETURN json_build_object(
        'checkout',  v_checkout,
        'webhook',   v_asaas,
        'tracking',  v_tracking,
        'repasse',   v_repasse,
        'rls',       COALESCE(v_rls, '[]'::JSON),
        'verificado_em', now()
    );
END $$;

GRANT EXECUTE ON FUNCTION public.admin_status_integracoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registrar_cancelamento(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_cancelamentos(TEXT, TEXT, TEXT, DATE, DATE, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_metricas_cancelamento(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_parceiros_elegiveis_repasse(NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gerar_lote_repasse(UUID[], NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_lotes(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_detalhe_lote(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marcar_lote_exportado(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marcar_lote_pago(UUID, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancelar_lote(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_salvar_config(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_config() TO authenticated;
