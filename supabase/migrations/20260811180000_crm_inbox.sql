-- ---------------------------------------------------------------------------
-- CRM caixa de entrada — destrava a escrita no histórico e cria notas e tags.
--
-- O PROBLEMA QUE ESTA MIGRATION RESOLVE:
-- `historico_contatos` tem hoje apenas duas policies — `historico_service_all`
-- (service role) e `historico_corretor_read` (SELECT). O corretor autenticado
-- NÃO consegue inserir. Ou seja: "Registrar contato" na tela sempre foi negado
-- pela RLS, e a timeline do cliente nunca preencheu.
--
-- Idempotente: pode rodar duas vezes.
-- ---------------------------------------------------------------------------

-- ── 1. Corretor passa a poder escrever no histórico dos SEUS clientes ─────
-- Mesmo escopo da policy de leitura que já existe: o vínculo é pelo dono do
-- cliente, porque esta tabela não tem coluna corretor_id.
DROP POLICY IF EXISTS "historico_corretor_insert" ON public.historico_contatos;
CREATE POLICY "historico_corretor_insert"
    ON public.historico_contatos FOR INSERT TO authenticated
    WITH CHECK (
        cliente_id IN (
            SELECT c.id FROM public.clientes c
            WHERE c.corretor_id IN (
                SELECT id FROM public.corretores WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "historico_corretor_update" ON public.historico_contatos;
CREATE POLICY "historico_corretor_update"
    ON public.historico_contatos FOR UPDATE TO authenticated
    USING (
        cliente_id IN (
            SELECT c.id FROM public.clientes c
            WHERE c.corretor_id IN (
                SELECT id FROM public.corretores WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        cliente_id IN (
            SELECT c.id FROM public.clientes c
            WHERE c.corretor_id IN (
                SELECT id FROM public.corretores WHERE user_id = auth.uid()
            )
        )
    );

-- A lista de conversas ordena por data_contato e filtra por cliente.
CREATE INDEX IF NOT EXISTS idx_historico_cliente_data
    ON public.historico_contatos (cliente_id, data_contato DESC);

-- ── 2. Notas internas ─────────────────────────────────────────────────────
-- `clientes.observacoes` é um campo de texto único: não dá para saber quem
-- escreveu nem quando, e cada edição apaga a anterior.
CREATE TABLE IF NOT EXISTS public.crm_notas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    cliente_id  UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    texto       TEXT NOT NULL,
    -- Distingue nota escrita pelo corretor de nota gerada por automação/IA,
    -- para a tela poder marcar o que é sugestão e o que é fato.
    autor       TEXT NOT NULL DEFAULT 'CORRETOR' CHECK (autor IN ('CORRETOR', 'IA', 'SISTEMA')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_notas_cliente
    ON public.crm_notas (cliente_id, created_at DESC);

-- ── 3. Tags ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_tags (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    nome        TEXT NOT NULL,
    cor         TEXT NOT NULL DEFAULT 'slate',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_tags_corretor_nome
    ON public.crm_tags (corretor_id, lower(nome));

CREATE TABLE IF NOT EXISTS public.crm_cliente_tags (
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    tag_id     UUID NOT NULL REFERENCES public.crm_tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cliente_id, tag_id)
);

-- ── 4. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_notas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_cliente_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Corretor gerencia suas notas" ON public.crm_notas;
CREATE POLICY "Corretor gerencia suas notas" ON public.crm_notas
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

DROP POLICY IF EXISTS "Corretor gerencia suas tags" ON public.crm_tags;
CREATE POLICY "Corretor gerencia suas tags" ON public.crm_tags
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

-- O vínculo não tem corretor_id: o escopo vem da tag, que já é do corretor.
-- Assim ninguém consegue etiquetar cliente alheio nem usar tag de outro.
DROP POLICY IF EXISTS "Corretor gerencia vinculos de tag" ON public.crm_cliente_tags;
CREATE POLICY "Corretor gerencia vinculos de tag" ON public.crm_cliente_tags
    FOR ALL TO authenticated
    USING (
        tag_id IN (SELECT id FROM public.crm_tags WHERE corretor_id = public.get_corretor_id())
        AND cliente_id IN (SELECT id FROM public.clientes WHERE corretor_id = public.get_corretor_id())
    )
    WITH CHECK (
        tag_id IN (SELECT id FROM public.crm_tags WHERE corretor_id = public.get_corretor_id())
        AND cliente_id IN (SELECT id FROM public.clientes WHERE corretor_id = public.get_corretor_id())
    );

REVOKE ALL ON public.crm_notas, public.crm_tags, public.crm_cliente_tags FROM anon;

COMMENT ON POLICY "historico_corretor_insert" ON public.historico_contatos IS
    'Sem esta policy o corretor nao conseguia registrar contato: a tabela so tinha SELECT para authenticated.';
