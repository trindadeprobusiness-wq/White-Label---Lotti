-- ---------------------------------------------------------------------------
-- Registro de atividade e configuração do back office.
--
-- Antes disto a plataforma não sabia dizer quem usa o produto. `analytics.ts`
-- é um console.log em dev e um no-op em produção, e `last_sign_in_at` mora
-- dentro de auth.users, sem espelho consultável. "Usuário ativo" era, literal-
-- mente, incalculável.
--
-- O que este arquivo NÃO faz: inventar histórico. O contador começa a valer no
-- deploy. Quem nunca registrou atividade fica em `sem_dados`, uma categoria
-- própria — chamar de "inativo" quem jamais teve chance de ser medido seria
-- fabricar uma métrica de retenção falsa logo no primeiro dia.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ── 1. Eventos de atividade ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.atividade_eventos (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    corretor_id UUID REFERENCES public.corretores(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('login', 'sessao', 'acao')),
    rota        TEXT,
    metadata    JSONB,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atividade_corretor
    ON public.atividade_eventos (corretor_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_atividade_data
    ON public.atividade_eventos (criado_em DESC);

COMMENT ON TABLE public.atividade_eventos IS
    'Sinal bruto de uso do produto. Retenção sugerida: 12 meses (LGPD — '
    'minimização). O agregado que a operação consulta é corretores.ultimo_acesso_em.';

ALTER TABLE public.atividade_eventos ENABLE ROW LEVEL SECURITY;

-- O corretor lê a própria trilha; escrita só pela RPC (SECURITY DEFINER), para
-- ninguém forjar atividade de outro e inflar a métrica de "ativos".
DROP POLICY IF EXISTS "atividade: corretor le a sua" ON public.atividade_eventos;
CREATE POLICY "atividade: corretor le a sua" ON public.atividade_eventos
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.atividade_eventos FROM anon, authenticated;

-- ── 2. Registro de atividade ──────────────────────────────────────────────
-- Chamada pelo app no SIGNED_IN e, com throttle, durante a navegação. Escreve o
-- evento e atualiza o agregado na mesma transação.
--
-- Nota sobre corretores.ultimo_acesso_em: o UPDATE aqui roda como DEFINER, logo
-- passa por cima da RLS de corretores de propósito — o corretor não tem (nem
-- deve ter) permissão de escrever nessa coluna por fora.
CREATE OR REPLACE FUNCTION public.registrar_atividade(
    p_tipo TEXT DEFAULT 'sessao',
    p_rota TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_corretor_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN; -- sem sessão não há o que registrar
    END IF;

    IF p_tipo NOT IN ('login', 'sessao', 'acao') THEN
        RAISE EXCEPTION 'tipo de atividade inválido: %', p_tipo;
    END IF;

    -- Não usa get_corretor_id(): um corretor suspenso deve continuar sendo
    -- medido. Se o acesso dele parasse de aparecer, a operação perderia
    -- justamente o sinal de que alguém suspenso segue tentando entrar.
    SELECT id INTO v_corretor_id FROM public.corretores WHERE user_id = auth.uid();

    INSERT INTO public.atividade_eventos (user_id, corretor_id, tipo, rota)
    VALUES (auth.uid(), v_corretor_id, p_tipo, left(coalesce(p_rota, ''), 200));

    IF v_corretor_id IS NOT NULL THEN
        UPDATE public.corretores
           SET ultimo_acesso_em = now()
         WHERE id = v_corretor_id;
    END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.registrar_atividade(TEXT, TEXT) TO authenticated;

-- ── 3. Configuração do back office ────────────────────────────────────────
-- Tabela chave-valor em vez de colunas: as opções são poucas, mudam raramente e
-- cada nova exigiria migration. O valor é JSONB para caber número, texto e
-- booleano sem inventar três colunas.
CREATE TABLE IF NOT EXISTS public.admin_config (
    chave       TEXT PRIMARY KEY,
    valor       JSONB NOT NULL,
    descricao   TEXT,
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_config: admin le" ON public.admin_config;
CREATE POLICY "admin_config: admin le" ON public.admin_config
    FOR SELECT TO authenticated USING (public.is_admin());

-- Só super_admin altera: estas chaves mudam como a receita é atribuída e como
-- a operação é medida.
DROP POLICY IF EXISTS "admin_config: super_admin escreve" ON public.admin_config;
CREATE POLICY "admin_config: super_admin escreve" ON public.admin_config
    FOR UPDATE TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

INSERT INTO public.admin_config (chave, valor, descricao) VALUES
    ('janela_atividade_dias', '30'::jsonb,
     'Dias sem acesso para um corretor deixar de ser contado como ativo.'),
    ('atribuicao_modelo', '"primeiro_clique"'::jsonb,
     'primeiro_clique | ultimo_clique. Congelado em cada atribuição no momento em que ela nasce.'),
    ('atribuicao_janela_dias', '90'::jsonb,
     'Dias entre o clique e o cadastro para o parceiro ainda receber o crédito. Padrão dos parceiros novos.')
ON CONFLICT (chave) DO NOTHING;

COMMENT ON TABLE public.admin_config IS
    'Parâmetros operacionais do back office. Mudanças aqui valem para o futuro: '
    'atribuições e comissões congelam a regra vigente na própria linha.';

-- Leitor tipado, com default embutido — se a chave sumir, a métrica continua
-- calculável em vez de virar NULL e contaminar toda a agregação.
CREATE OR REPLACE FUNCTION public.admin_config_int(_chave TEXT, _padrao INT)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT (valor #>> '{}')::INT FROM public.admin_config WHERE chave = _chave),
        _padrao
    )
$$;

CREATE OR REPLACE FUNCTION public.admin_config_texto(_chave TEXT, _padrao TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT valor #>> '{}' FROM public.admin_config WHERE chave = _chave),
        _padrao
    )
$$;

-- ── 4. Classificação de atividade ─────────────────────────────────────────
-- Uma função só, usada pelas métricas e pela listagem, para as duas telas nunca
-- discordarem sobre quem está ativo.
CREATE OR REPLACE FUNCTION public.classificar_atividade(
    _ultimo_acesso TIMESTAMPTZ,
    _janela_dias   INT
)
RETURNS TEXT
LANGUAGE sql
-- STABLE, não IMMUTABLE: depende de now(). Marcar como IMMUTABLE seria mentir
-- para o planner e o Postgres recusa a declaração.
STABLE
AS $$
    SELECT CASE
        WHEN _ultimo_acesso IS NULL THEN 'sem_dados'
        WHEN _ultimo_acesso >= now() - make_interval(days => _janela_dias) THEN 'ativo'
        ELSE 'inativo'
    END
$$;

COMMENT ON FUNCTION public.classificar_atividade(TIMESTAMPTZ, INT) IS
    'ativo | inativo | sem_dados. sem_dados NÃO é inativo: o registro de '
    'atividade começou com o back office e ninguém tem histórico anterior.';
