-- ---------------------------------------------------------------------------
-- Ledger de receita da Lotti e comissões de parceiro.
--
-- Situação de fato: a Lotti ainda não cobra assinatura de ninguém. O gateway em
-- src/services/paymentProvider.ts é um MockPaymentProvider, PlanoAssinatura.tsx
-- está fora do grafo de rotas e nenhuma linha do repositório jamais criou uma
-- `subscriptions`. O Asaas que existe cobra o ALUGUEL dos inquilinos do
-- corretor — é receita do cliente, não da Lotti.
--
-- Portanto: nada de receita simulada. `receita_eventos` nasce vazia e só recebe
-- linha por lançamento administrativo auditado. Quando a cobrança real entrar,
-- o webhook insere na MESMA tabela com origem='asaas' e external_id, e o
-- UNIQUE (origem, external_id) já garante idempotência — sem refatoração.
--
-- Comissão nunca é recalculada. Ela nasce com percentual e base congelados na
-- própria linha, porque a regra que importa é a que valia quando o dinheiro
-- entrou. Alterar o percentual do parceiro amanhã não pode reescrever o que já
-- foi combinado ontem.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ── 1. Eventos de receita ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.receita_eventos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id   UUID REFERENCES public.corretores(id) ON DELETE SET NULL,
    subscription_id UUID,
    origem        TEXT NOT NULL CHECK (origem IN ('manual_admin', 'asaas', 'stripe')),
    -- Id da transação no gateway. Nulo só faz sentido em lançamento manual.
    external_id   TEXT,
    tipo          TEXT NOT NULL DEFAULT 'assinatura'
                  CHECK (tipo IN ('assinatura', 'addon', 'avulso')),
    valor_bruto   NUMERIC(12,2) NOT NULL CHECK (valor_bruto > 0),
    valor_liquido NUMERIC(12,2) CHECK (valor_liquido IS NULL OR valor_liquido >= 0),
    moeda         TEXT NOT NULL DEFAULT 'BRL',
    status        TEXT NOT NULL DEFAULT 'confirmado'
                  CHECK (status IN ('confirmado', 'estornado', 'cancelado')),
    -- Data em que o dinheiro foi confirmado. É esta data — não a de hoje — que
    -- escolhe qual percentual vale para a comissão.
    confirmado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    competencia   DATE,
    registrado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    motivo        TEXT,
    estornado_em  TIMESTAMPTZ,
    estornado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    motivo_estorno TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_manual_sem_external
        CHECK (origem <> 'manual_admin' OR external_id IS NULL)
);

-- Idempotência do webhook, pronta antes do webhook existir. Um PAYMENT_RECEIVED
-- reentregue pelo gateway não vira faturamento em dobro.
CREATE UNIQUE INDEX IF NOT EXISTS uq_receita_external
    ON public.receita_eventos (origem, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receita_corretor
    ON public.receita_eventos (corretor_id, confirmado_em DESC);
CREATE INDEX IF NOT EXISTS idx_receita_confirmado
    ON public.receita_eventos (confirmado_em DESC) WHERE status = 'confirmado';

COMMENT ON TABLE public.receita_eventos IS
    'Ledger de receita da Lotti (assinatura do SaaS). Não confundir com '
    'faturas_aluguel, que é a cobrança do inquilino do corretor.';

-- ── 2. Pagamentos ao parceiro ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parceiro_pagamentos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parceiro_id   UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE RESTRICT,
    valor_total   NUMERIC(12,2) NOT NULL CHECK (valor_total > 0),
    metodo        TEXT,
    referencia    TEXT,
    competencia_inicio DATE,
    competencia_fim    DATE,
    pago_em       DATE NOT NULL DEFAULT CURRENT_DATE,
    comprovante_url TEXT,
    observacoes   TEXT,
    registrado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_parceiro
    ON public.parceiro_pagamentos (parceiro_id, pago_em DESC);

-- ── 3. Comissões ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parceiro_comissoes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parceiro_id   UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE RESTRICT,
    atribuicao_id UUID NOT NULL REFERENCES public.parceiro_atribuicoes(id) ON DELETE RESTRICT,
    receita_evento_id UUID NOT NULL REFERENCES public.receita_eventos(id) ON DELETE RESTRICT,
    corretor_id   UUID REFERENCES public.corretores(id) ON DELETE SET NULL,

    valor_base    NUMERIC(12,2) NOT NULL CHECK (valor_base >= 0),
    -- Congelados. Não são lookup: são o valor que foi aplicado naquele momento.
    percentual_aplicado NUMERIC(5,2) NOT NULL CHECK (percentual_aplicado >= 0 AND percentual_aplicado <= 100),
    base_calculo  TEXT NOT NULL,
    percentual_id UUID REFERENCES public.parceiro_percentuais(id) ON DELETE SET NULL,
    valor_comissao NUMERIC(12,2) NOT NULL CHECK (valor_comissao >= 0),

    status        TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'em_validacao', 'aprovada',
                                    'paga', 'cancelada', 'estornada')),
    competencia   DATE,
    gerada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    aprovada_em   TIMESTAMPTZ,
    aprovada_por  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    paga_em       TIMESTAMPTZ,
    pagamento_id  UUID REFERENCES public.parceiro_pagamentos(id) ON DELETE SET NULL,
    cancelada_em  TIMESTAMPTZ,
    cancelada_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    motivo_cancelamento TEXT,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A trava contra comissão duplicada. Uma receita gera no máximo uma comissão —
-- garantido pelo banco, não por um `if` que alguém pode reordenar depois.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comissao_por_receita
    ON public.parceiro_comissoes (receita_evento_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_parceiro
    ON public.parceiro_comissoes (parceiro_id, status, gerada_em DESC);
CREATE INDEX IF NOT EXISTS idx_comissoes_status
    ON public.parceiro_comissoes (status, gerada_em DESC);

COMMENT ON COLUMN public.parceiro_comissoes.percentual_aplicado IS
    'Congelado na geração. Alterar o percentual do parceiro abre nova vigência '
    'e afeta apenas receitas futuras — nunca esta linha.';

-- ── 4. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.receita_eventos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_comissoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_pagamentos  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "receita: admin le" ON public.receita_eventos;
CREATE POLICY "receita: admin le" ON public.receita_eventos
    FOR SELECT TO authenticated USING (public.is_admin());

-- Escrever receita é privilégio de super_admin. Enquanto não há gateway, este é
-- o ponto onde alguém poderia inventar faturamento — fica no nível mais alto e
-- sempre com auditoria.
DROP POLICY IF EXISTS "receita: super_admin registra" ON public.receita_eventos;
CREATE POLICY "receita: super_admin registra" ON public.receita_eventos
    FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "receita: super_admin estorna" ON public.receita_eventos;
CREATE POLICY "receita: super_admin estorna" ON public.receita_eventos
    FOR UPDATE TO authenticated
    USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Receita não se apaga. Estorno é uma mudança de status que preserva o rastro.
REVOKE DELETE ON public.receita_eventos FROM anon, authenticated;

DROP POLICY IF EXISTS "comissoes: admin le" ON public.parceiro_comissoes;
CREATE POLICY "comissoes: admin le" ON public.parceiro_comissoes
    FOR SELECT TO authenticated USING (public.is_admin());

-- Comissão nasce por trigger e muda por RPC (que valida a transição). Sem
-- policy de INSERT/UPDATE direto: escrever à mão contornaria as duas coisas.
REVOKE INSERT, UPDATE, DELETE ON public.parceiro_comissoes FROM anon, authenticated;

DROP POLICY IF EXISTS "pagamentos: admin le" ON public.parceiro_pagamentos;
CREATE POLICY "pagamentos: admin le" ON public.parceiro_pagamentos
    FOR SELECT TO authenticated USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.parceiro_pagamentos FROM anon, authenticated;

-- ── 5. Geração da comissão ────────────────────────────────────────────────
-- Dispara quando a receita é confirmada. Toda a decisão mora aqui, no banco,
-- perto do dado: assim vale para o lançamento manual de hoje e para o webhook
-- de amanhã, sem duas implementações que podem divergir.
CREATE OR REPLACE FUNCTION public.gerar_comissao_de_receita()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_atribuicao public.parceiro_atribuicoes;
    v_regra      public.parceiro_percentuais;
    v_parceiro   public.parceiros;
    v_base       NUMERIC(12,2);
    v_valor      NUMERIC(12,2);
    v_ja_houve   BOOLEAN;
BEGIN
    IF NEW.status <> 'confirmado' OR NEW.corretor_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_atribuicao
      FROM public.parceiro_atribuicoes
     WHERE corretor_id = NEW.corretor_id AND status = 'convertida';

    IF NOT FOUND THEN
        RETURN NEW; -- cliente sem parceiro: receita entra no ledger e para aí
    END IF;

    SELECT * INTO v_parceiro FROM public.parceiros WHERE id = v_atribuicao.parceiro_id;

    -- Parceiro encerrado não gera comissão nova. Ele mantém as antigas, que já
    -- estão consolidadas — encerrar a parceria não confisca o que foi ganho.
    IF v_parceiro.status = 'encerrado' THEN
        RETURN NEW;
    END IF;

    v_regra := public.percentual_vigente_em(
        v_atribuicao.parceiro_id,
        NEW.confirmado_em::DATE
    );

    IF v_regra.id IS NULL THEN
        RETURN NEW; -- sem regra vigente na data, não se inventa percentual
    END IF;

    -- 'primeiro_pagamento' só remunera a primeira receita confirmada daquele
    -- cliente; as recorrentes seguintes não geram nada.
    IF v_regra.base_calculo = 'primeiro_pagamento' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.receita_eventos
             WHERE corretor_id = NEW.corretor_id
               AND status = 'confirmado'
               AND id <> NEW.id
               AND confirmado_em < NEW.confirmado_em
        ) INTO v_ja_houve;

        IF v_ja_houve THEN
            RETURN NEW;
        END IF;
    END IF;

    v_base := CASE
        WHEN v_regra.base_calculo = 'receita_liquida'
            THEN COALESCE(NEW.valor_liquido, NEW.valor_bruto)
        ELSE NEW.valor_bruto
    END;

    v_valor := CASE
        WHEN v_regra.base_calculo = 'valor_fixo' THEN v_regra.valor_fixo
        ELSE round(v_base * v_regra.percentual / 100, 2)
    END;

    INSERT INTO public.parceiro_comissoes (
        parceiro_id, atribuicao_id, receita_evento_id, corretor_id,
        valor_base, percentual_aplicado, base_calculo, percentual_id,
        valor_comissao, status, competencia
    ) VALUES (
        v_atribuicao.parceiro_id, v_atribuicao.id, NEW.id, NEW.corretor_id,
        v_base, v_regra.percentual, v_regra.base_calculo, v_regra.id,
        v_valor, 'pendente',
        COALESCE(NEW.competencia, date_trunc('month', NEW.confirmado_em)::DATE)
    )
    -- Reentrega de webhook ou reprocessamento não duplica.
    ON CONFLICT (receita_evento_id) DO NOTHING;

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_gerar_comissao ON public.receita_eventos;
CREATE TRIGGER tr_gerar_comissao
    AFTER INSERT ON public.receita_eventos
    FOR EACH ROW EXECUTE FUNCTION public.gerar_comissao_de_receita();

-- ── 6. Estorno em cascata ─────────────────────────────────────────────────
-- Estornar a receita estorna a comissão. Nunca apaga: a linha permanece com
-- status 'estornada' e o motivo, porque o parceiro precisa conseguir auditar
-- por que aquele valor sumiu do extrato dele.
CREATE OR REPLACE FUNCTION public.estornar_comissao_da_receita()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'confirmado' OR OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    UPDATE public.parceiro_comissoes
       SET status = 'estornada',
           cancelada_em = now(),
           cancelada_por = auth.uid(),
           motivo_cancelamento = COALESCE(
               NEW.motivo_estorno,
               'Receita de origem passou para ' || NEW.status
           ),
           atualizado_em = now()
     WHERE receita_evento_id = NEW.id
       -- Comissão já paga não volta atrás sozinha: o dinheiro saiu, e desfazer
       -- isso é decisão humana (acerto no próximo pagamento), não automática.
       AND status <> 'paga';

    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_estornar_comissao ON public.receita_eventos;
CREATE TRIGGER tr_estornar_comissao
    AFTER UPDATE OF status ON public.receita_eventos
    FOR EACH ROW EXECUTE FUNCTION public.estornar_comissao_da_receita();

DROP TRIGGER IF EXISTS tr_comissoes_atualizado ON public.parceiro_comissoes;
CREATE TRIGGER tr_comissoes_atualizado
    BEFORE UPDATE ON public.parceiro_comissoes
    FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();
