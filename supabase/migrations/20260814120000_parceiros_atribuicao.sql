-- ---------------------------------------------------------------------------
-- Parceiros comerciais, links exclusivos e atribuição de origem.
--
-- Não existia nada disso: zero ocorrências de `ref`, `referral` ou `afiliado`
-- no repositório. Cuidado para não confundir com o que já existe e tem outro
-- dono: `categoria_financeira = 'COMISSAO_PARCEIRO'` é uma DESPESA que o
-- corretor lança à mão, e `COMISSAO_LOCACAO` é taxa de administração
-- imobiliária. Nenhuma das duas é tocada aqui.
--
-- A regra de atribuição escolhida é PRIMEIRO CLIQUE com janela de 90 dias,
-- configurável por parceiro. E ela não é implementada por lógica de aplicação:
-- é o UNIQUE em parceiro_atribuicoes(visitante_id). O segundo link cai em
-- ON CONFLICT DO NOTHING e não sobrescreve nada. Regra que vive numa constraint
-- não tem como ser esquecida numa branch de código.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ── 1. Parceiros ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parceiros (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome          TEXT NOT NULL CHECK (length(btrim(nome)) >= 2),
    empresa       TEXT,
    documento     TEXT,
    email         TEXT NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    telefone      TEXT,
    responsavel   TEXT,
    status        TEXT NOT NULL DEFAULT 'ativo'
                  CHECK (status IN ('ativo', 'inativo', 'suspenso', 'encerrado')),
    data_inicio   DATE NOT NULL DEFAULT CURRENT_DATE,
    janela_atribuicao_dias INT NOT NULL DEFAULT 90
                  CHECK (janela_atribuicao_dias BETWEEN 1 AND 730),
    observacoes   TEXT,
    -- Preenchido quando o parceiro também tem conta na Lotti. Serve para barrar
    -- autoindicação: ele não recebe comissão por indicar a si mesmo.
    user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    criado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_parceiros_email ON public.parceiros (lower(email));
CREATE INDEX IF NOT EXISTS idx_parceiros_status ON public.parceiros (status);

-- ── 2. Percentual com vigência ────────────────────────────────────────────
-- Alterar o percentual NUNCA faz UPDATE: fecha a vigência atual e abre outra.
-- Sem isso, mudar de 10% para 5% reescreveria retroativamente toda comissão já
-- calculada, e a conversa com o parceiro viraria discussão sobre o passado.
CREATE TABLE IF NOT EXISTS public.parceiro_percentuais (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parceiro_id   UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
    percentual    NUMERIC(5,2) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
    base_calculo  TEXT NOT NULL DEFAULT 'receita_bruta'
                  CHECK (base_calculo IN ('receita_bruta', 'receita_liquida',
                                          'primeiro_pagamento', 'valor_fixo')),
    valor_fixo    NUMERIC(12,2) CHECK (valor_fixo IS NULL OR valor_fixo >= 0),
    vigencia_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
    vigencia_fim  DATE,
    motivo        TEXT,
    criado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_vigencia_ordem
        CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
    -- valor_fixo só faz sentido — e é obrigatório — na base 'valor_fixo'.
    CONSTRAINT chk_valor_fixo_coerente
        CHECK ((base_calculo = 'valor_fixo' AND valor_fixo IS NOT NULL)
            OR (base_calculo <> 'valor_fixo'))
);

-- Uma única vigência aberta por parceiro. É o que impede duas regras ativas ao
-- mesmo tempo e torna "o percentual de hoje" uma pergunta com uma só resposta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_percentual_vigente
    ON public.parceiro_percentuais (parceiro_id) WHERE vigencia_fim IS NULL;
CREATE INDEX IF NOT EXISTS idx_percentual_parceiro
    ON public.parceiro_percentuais (parceiro_id, vigencia_inicio DESC);

-- ── 3. Links ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parceiro_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parceiro_id UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
    -- Formato travado: o slug entra na URL pública e é lido em voz alta ao
    -- telefone. Sem maiúscula, sem acento, sem espaço.
    slug        TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
    campanha    TEXT,
    principal   BOOLEAN NOT NULL DEFAULT FALSE,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE,
    revogado_em TIMESTAMPTZ,
    criado_por  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Slug único global e para sempre, inclusive depois de revogado: reaproveitar
-- um slug antigo faria cliques de uma campanha encerrada caírem no parceiro
-- errado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parceiro_links_slug ON public.parceiro_links (slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parceiro_link_principal
    ON public.parceiro_links (parceiro_id) WHERE principal AND revogado_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_parceiro_links_parceiro ON public.parceiro_links (parceiro_id);

-- ── 4. Cliques ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parceiro_cliques (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    link_id      UUID NOT NULL REFERENCES public.parceiro_links(id) ON DELETE CASCADE,
    parceiro_id  UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
    visitante_id UUID NOT NULL,
    -- Hash, nunca o IP cru: o IP é dado pessoal e não tem uso operacional aqui
    -- além de contar visitante distinto e limitar abuso. Mesmo tratamento já
    -- aplicado em fachada_escaneamentos.ip_hash.
    ip_hash      TEXT,
    user_agent   TEXT,
    referer      TEXT,
    utm          JSONB,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cliques_parceiro ON public.parceiro_cliques (parceiro_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_cliques_visitante ON public.parceiro_cliques (visitante_id);
CREATE INDEX IF NOT EXISTS idx_cliques_link ON public.parceiro_cliques (link_id, criado_em DESC);

COMMENT ON TABLE public.parceiro_cliques IS
    'Registro server-side do clique. É a fonte de verdade da atribuição: na '
    'conversão o servidor relê esta tabela pelo visitante_id, em vez de aceitar '
    'o parceiro que o cliente informar.';

-- ── 5. Atribuições ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parceiro_atribuicoes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parceiro_id  UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE CASCADE,
    link_id      UUID REFERENCES public.parceiro_links(id) ON DELETE SET NULL,
    visitante_id UUID NOT NULL,
    user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    corretor_id  UUID REFERENCES public.corretores(id) ON DELETE SET NULL,
    -- Regra congelada na linha. Mudar a configuração global depois não reescreve
    -- atribuição nenhuma.
    modelo       TEXT NOT NULL DEFAULT 'primeiro_clique'
                 CHECK (modelo IN ('primeiro_clique', 'ultimo_clique')),
    janela_dias  INT NOT NULL CHECK (janela_dias BETWEEN 1 AND 730),
    primeiro_clique_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em    TIMESTAMPTZ NOT NULL,
    convertido_em TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'pendente'
                 CHECK (status IN ('pendente', 'convertida', 'expirada', 'invalidada')),
    motivo_invalidacao TEXT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A regra de PRIMEIRO CLIQUE, expressa como constraint. O segundo parceiro que
-- o mesmo visitante tocar bate aqui e o INSERT vira no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_atribuicao_visitante
    ON public.parceiro_atribuicoes (visitante_id);

-- Um usuário pertence a um parceiro só. Sem isto, duas conversões do mesmo
-- cadastro gerariam duas comissões sobre a mesma receita.
CREATE UNIQUE INDEX IF NOT EXISTS uq_atribuicao_user
    ON public.parceiro_atribuicoes (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_atribuicao_corretor
    ON public.parceiro_atribuicoes (corretor_id) WHERE corretor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atribuicoes_parceiro
    ON public.parceiro_atribuicoes (parceiro_id, status, criado_em DESC);

-- ── 6. RLS ────────────────────────────────────────────────────────────────
-- Estas tabelas nasceram para o back office, então aqui o admin É o dono e a
-- policy é direta — diferente das ~30 tabelas do corretor, que continuam
-- intocadas e são lidas por RPC.
ALTER TABLE public.parceiros             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_percentuais  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_cliques      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_atribuicoes  ENABLE ROW LEVEL SECURITY;

-- SELECT/INSERT/UPDATE explícitos em vez de FOR ALL: FOR ALL inclui DELETE, e
-- apagar um parceiro levaria junto, por CASCADE, os cliques e as atribuições —
-- a evidência que decide disputa de origem. Encerrar parceria é `status =
-- 'encerrado'`, que preserva o histórico. Comissão e pagamento já barram a
-- exclusão por RESTRICT, mas só DEPOIS que existe dinheiro; antes disso a
-- janela ficava aberta para o nível administrativo mais baixo.
DROP POLICY IF EXISTS "parceiros: admin gerencia" ON public.parceiros;
DROP POLICY IF EXISTS "parceiros: admin le" ON public.parceiros;
CREATE POLICY "parceiros: admin le" ON public.parceiros
    FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "parceiros: admin cria" ON public.parceiros;
CREATE POLICY "parceiros: admin cria" ON public.parceiros
    FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "parceiros: admin edita" ON public.parceiros;
CREATE POLICY "parceiros: admin edita" ON public.parceiros
    FOR UPDATE TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE DELETE ON public.parceiros FROM anon, authenticated;

DROP POLICY IF EXISTS "percentuais: admin le" ON public.parceiro_percentuais;
CREATE POLICY "percentuais: admin le" ON public.parceiro_percentuais
    FOR SELECT TO authenticated USING (public.is_admin());

-- Percentual não se edita nem se apaga: só nasce. Sem UPDATE/DELETE, o
-- histórico de quanto valia cada regra é imutável por construção.
DROP POLICY IF EXISTS "percentuais: admin cria" ON public.parceiro_percentuais;
CREATE POLICY "percentuais: admin cria" ON public.parceiro_percentuais
    FOR INSERT TO authenticated WITH CHECK (public.is_admin());

REVOKE DELETE ON public.parceiro_percentuais FROM anon, authenticated;

-- Mesma razão: parceiro_cliques.link_id é ON DELETE CASCADE, então apagar um
-- link apagaria todos os cliques registrados por ele. A interface só revoga
-- (`revogado_em` + `ativo = false`), que mantém o rastro.
DROP POLICY IF EXISTS "links: admin gerencia" ON public.parceiro_links;
DROP POLICY IF EXISTS "links: admin le" ON public.parceiro_links;
CREATE POLICY "links: admin le" ON public.parceiro_links
    FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "links: admin cria" ON public.parceiro_links;
CREATE POLICY "links: admin cria" ON public.parceiro_links
    FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "links: admin edita" ON public.parceiro_links;
CREATE POLICY "links: admin edita" ON public.parceiro_links
    FOR UPDATE TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE DELETE ON public.parceiro_links FROM anon, authenticated;

DROP POLICY IF EXISTS "cliques: admin le" ON public.parceiro_cliques;
CREATE POLICY "cliques: admin le" ON public.parceiro_cliques
    FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "atribuicoes: admin le" ON public.parceiro_atribuicoes;
CREATE POLICY "atribuicoes: admin le" ON public.parceiro_atribuicoes
    FOR SELECT TO authenticated USING (public.is_admin());

-- Clique e atribuição são escritos apenas pelas Edge Functions (service_role).
-- Nenhuma policy de INSERT para authenticated: um usuário logado não pode
-- fabricar a própria origem.
REVOKE INSERT, UPDATE, DELETE ON public.parceiro_cliques     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.parceiro_atribuicoes FROM anon, authenticated;

-- ── 7. Fechamento de vigência automático ──────────────────────────────────
-- Inserir um percentual novo fecha o anterior na véspera. Evita o passo manual
-- que, esquecido, faria o índice único recusar a inserção e travar a tela.
CREATE OR REPLACE FUNCTION public.fechar_vigencia_percentual_anterior()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.parceiro_percentuais
       SET vigencia_fim = GREATEST(
               vigencia_inicio,
               NEW.vigencia_inicio - INTERVAL '1 day'
           )::DATE
     WHERE parceiro_id = NEW.parceiro_id
       AND id <> NEW.id
       AND vigencia_fim IS NULL;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_fechar_vigencia_anterior ON public.parceiro_percentuais;
CREATE TRIGGER tr_fechar_vigencia_anterior
    AFTER INSERT ON public.parceiro_percentuais
    FOR EACH ROW EXECUTE FUNCTION public.fechar_vigencia_percentual_anterior();

-- ── 8. Percentual vigente numa data ───────────────────────────────────────
-- Recebe a data em vez de usar now(): a comissão precisa da regra que valia
-- quando o pagamento foi confirmado, não da que vale hoje.
CREATE OR REPLACE FUNCTION public.percentual_vigente_em(
    _parceiro_id UUID,
    _data        DATE
)
RETURNS public.parceiro_percentuais
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
      FROM public.parceiro_percentuais
     WHERE parceiro_id = _parceiro_id
       AND vigencia_inicio <= _data
       AND (vigencia_fim IS NULL OR vigencia_fim >= _data)
     ORDER BY vigencia_inicio DESC
     LIMIT 1
$$;

-- ── 9. updated_at ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tocar_atualizado_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS tr_parceiros_atualizado ON public.parceiros;
CREATE TRIGGER tr_parceiros_atualizado
    BEFORE UPDATE ON public.parceiros
    FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

-- ── 10. Vínculo forte contra autoindicação ────────────────────────────────
-- A checagem de autoindicação tem dois controles: mesma conta (user_id) e mesmo
-- e-mail. O primeiro é o forte, mas só funciona se parceiros.user_id estiver
-- preenchido — e nada obrigava a preencher, deixando de pé só a comparação de
-- e-mail, que se evade cadastrando com outro endereço.
--
-- Esta trigger fecha o caso comum sem depender de ninguém lembrar: se já existe
-- conta na Lotti com o e-mail do parceiro, o vínculo é feito sozinho.
--
-- NÃO resolve o caso do parceiro usar um e-mail diferente do cadastrado — isso
-- não tem solução puramente técnica. O mitigante operacional é que a comissão
-- nasce 'pendente' e precisa de aprovação humana antes de virar dinheiro.
CREATE OR REPLACE FUNCTION public.vincular_conta_do_parceiro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.user_id IS NULL AND NEW.email IS NOT NULL THEN
        SELECT id INTO NEW.user_id
          FROM auth.users
         WHERE lower(email) = lower(btrim(NEW.email))
         LIMIT 1;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_vincular_conta_parceiro ON public.parceiros;
CREATE TRIGGER tr_vincular_conta_parceiro
    BEFORE INSERT OR UPDATE OF email ON public.parceiros
    FOR EACH ROW EXECUTE FUNCTION public.vincular_conta_do_parceiro();
