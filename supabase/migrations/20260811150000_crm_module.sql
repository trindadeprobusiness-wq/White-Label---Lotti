-- ---------------------------------------------------------------------------
-- Módulo CRM — Etapas configuráveis, Oportunidades e Tarefas
--
-- O sistema já tinha contato (clientes), timeline (historico_contatos), imóveis
-- de interesse (cliente_imovel) e lembretes (alertas). Faltavam as três peças
-- que fazem um CRM de verdade: o NEGÓCIO separado do contato, a TAREFA com
-- prazo e responsável, e o pipeline como DADO em vez de ENUM.
--
-- Por que etapa vira tabela: hoje o funil é o enum `status_funil` mais um array
-- hardcoded em FunilVendas.tsx. Mudar uma etapa exige ALTER TYPE + edição em
-- quatro arquivos e um deploy. Como tabela, o corretor configura sozinho.
--
-- Nada é removido. `clientes.status_funil` continua intacto — o /funil antigo
-- segue funcionando enquanto a aba CRM não o substitui de vez.
--
-- Idempotente: pode rodar duas vezes sem duplicar seed nem backfill.
-- ---------------------------------------------------------------------------

-- ── 1. Etapas do pipeline (por corretor) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_etapas (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id  UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    nome         TEXT NOT NULL,
    ordem        INTEGER NOT NULL DEFAULT 0,
    cor          TEXT NOT NULL DEFAULT 'slate',
    -- ABERTA = em andamento; GANHO/PERDIDO encerram o negócio e alimentam a
    -- taxa de conversão. Sem isso não dá para calcular funil de verdade.
    tipo         TEXT NOT NULL DEFAULT 'ABERTA'
                 CHECK (tipo IN ('ABERTA', 'GANHO', 'PERDIDO')),
    ativo        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Evita etapa duplicada por corretor e torna o seed re-executável.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_etapas_corretor_nome
    ON public.crm_etapas (corretor_id, nome);
CREATE INDEX IF NOT EXISTS idx_crm_etapas_corretor_ordem
    ON public.crm_etapas (corretor_id, ordem);

-- ── 2. Oportunidades (o negócio) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_oportunidades (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id              UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    -- Um contato pode ter vários negócios (comprar um, vender outro). É a razão
    -- de a oportunidade não morar dentro de `clientes`.
    cliente_id               UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
    imovel_id                UUID REFERENCES public.imoveis(id) ON DELETE SET NULL,
    etapa_id                 UUID NOT NULL REFERENCES public.crm_etapas(id) ON DELETE RESTRICT,
    titulo                   TEXT NOT NULL,
    valor_estimado           NUMERIC(15,2) NOT NULL DEFAULT 0,
    probabilidade            INTEGER NOT NULL DEFAULT 0
                             CHECK (probabilidade BETWEEN 0 AND 100),
    data_prevista_fechamento DATE,
    motivo_perda             TEXT,
    origem                   TEXT,
    ordem                    INTEGER NOT NULL DEFAULT 0,
    observacoes              TEXT,
    fechada_em               TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Base do controle de concorrência do Kanban: o update exige o updated_at
    -- conhecido, então mover o mesmo card em duas abas não sobrescreve calado.
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_oport_corretor_etapa
    ON public.crm_oportunidades (corretor_id, etapa_id, ordem);
CREATE INDEX IF NOT EXISTS idx_crm_oport_cliente
    ON public.crm_oportunidades (cliente_id);

-- ── 3. Tarefas ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_tarefas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id     UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    oportunidade_id UUID REFERENCES public.crm_oportunidades(id) ON DELETE CASCADE,
    cliente_id      UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    tipo            TEXT NOT NULL DEFAULT 'OUTRO'
                    CHECK (tipo IN ('LIGACAO','WHATSAPP','EMAIL','REUNIAO','VISITA','PROPOSTA','OUTRO')),
    data_prevista   TIMESTAMPTZ,
    concluida       BOOLEAN NOT NULL DEFAULT FALSE,
    concluida_em    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice parcial: a consulta que importa é "o que está aberto e vencendo".
CREATE INDEX IF NOT EXISTS idx_crm_tarefas_abertas
    ON public.crm_tarefas (corretor_id, data_prevista)
    WHERE concluida = FALSE;

-- ── 4. updated_at automático nas oportunidades ────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_oport_updated_at ON public.crm_oportunidades;
CREATE TRIGGER trg_crm_oport_updated_at
    BEFORE UPDATE ON public.crm_oportunidades
    FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();

-- ── 5. RLS — mesmo padrão de 20260503114843 ───────────────────────────────
-- Isolamento entre corretores é garantido AQUI, no servidor. A feature flag do
-- frontend esconde a tela; ela não protege dado nenhum.
ALTER TABLE public.crm_etapas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_oportunidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tarefas       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Corretor gerencia suas etapas" ON public.crm_etapas;
CREATE POLICY "Corretor gerencia suas etapas" ON public.crm_etapas
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

DROP POLICY IF EXISTS "Corretor gerencia suas oportunidades" ON public.crm_oportunidades;
CREATE POLICY "Corretor gerencia suas oportunidades" ON public.crm_oportunidades
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

DROP POLICY IF EXISTS "Corretor gerencia suas tarefas" ON public.crm_tarefas;
CREATE POLICY "Corretor gerencia suas tarefas" ON public.crm_tarefas
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

-- anon não tem nada a fazer aqui.
REVOKE ALL ON public.crm_etapas, public.crm_oportunidades, public.crm_tarefas FROM anon;

-- ── 5b. fachada_leads: faltava policy de UPDATE ───────────────────────────
-- A tabela só tinha INSERT (público) e SELECT (corretor). Sem UPDATE, marcar o
-- lead como convertido afetaria ZERO linhas em silêncio: o lead voltaria para
-- sempre na caixa de entrada e cada tentativa criaria outro cliente.
-- O escopo é o mesmo do SELECT — leads das fachadas do próprio corretor.
DROP POLICY IF EXISTS "Corretor atualiza leads das suas fachadas" ON public.fachada_leads;
CREATE POLICY "Corretor atualiza leads das suas fachadas"
    ON public.fachada_leads FOR UPDATE TO authenticated
    USING (
        fachada_id IN (
            SELECT id FROM public.fachadas
            WHERE corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid())
        )
    )
    WITH CHECK (
        fachada_id IN (
            SELECT id FROM public.fachadas
            WHERE corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid())
        )
    );

-- ── 6. Seed das etapas para cada corretor existente ───────────────────────
INSERT INTO public.crm_etapas (corretor_id, nome, ordem, cor, tipo)
SELECT c.id, e.nome, e.ordem, e.cor, e.tipo
FROM public.corretores c
CROSS JOIN (VALUES
    ('Novo lead',         1, 'slate',  'ABERTA'),
    ('Primeiro contato',  2, 'sky',    'ABERTA'),
    ('Em qualificação',   3, 'blue',   'ABERTA'),
    ('Qualificado',       4, 'indigo', 'ABERTA'),
    ('Visita agendada',   5, 'amber',  'ABERTA'),
    ('Proposta enviada',  6, 'orange', 'ABERTA'),
    ('Negociação',        7, 'violet', 'ABERTA'),
    ('Fechado — ganho',   8, 'green',  'GANHO'),
    ('Fechado — perdido', 9, 'red',    'PERDIDO')
) AS e(nome, ordem, cor, tipo)
ON CONFLICT (corretor_id, nome) DO NOTHING;

-- Corretor novo já nasce com o pipeline pronto.
CREATE OR REPLACE FUNCTION public.crm_seed_etapas_novo_corretor()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.crm_etapas (corretor_id, nome, ordem, cor, tipo)
    SELECT NEW.id, e.nome, e.ordem, e.cor, e.tipo
    FROM (VALUES
        ('Novo lead',         1, 'slate',  'ABERTA'),
        ('Primeiro contato',  2, 'sky',    'ABERTA'),
        ('Em qualificação',   3, 'blue',   'ABERTA'),
        ('Qualificado',       4, 'indigo', 'ABERTA'),
        ('Visita agendada',   5, 'amber',  'ABERTA'),
        ('Proposta enviada',  6, 'orange', 'ABERTA'),
        ('Negociação',        7, 'violet', 'ABERTA'),
        ('Fechado — ganho',   8, 'green',  'GANHO'),
        ('Fechado — perdido', 9, 'red',    'PERDIDO')
    ) AS e(nome, ordem, cor, tipo)
    ON CONFLICT (corretor_id, nome) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_seed_etapas ON public.corretores;
CREATE TRIGGER trg_crm_seed_etapas
    AFTER INSERT ON public.corretores
    FOR EACH ROW EXECUTE FUNCTION public.crm_seed_etapas_novo_corretor();

-- ── 7. Backfill: cada cliente vira uma oportunidade, preservando a etapa ──
-- Ninguém perde o lugar no funil ao mudar de tela. O mapeamento é conservador:
-- VISITA_PROPOSTA cai em "Visita agendada" (mais atrás) em vez de "Proposta
-- enviada", para não inflar artificialmente o estágio do negócio.
INSERT INTO public.crm_oportunidades
    (corretor_id, cliente_id, imovel_id, etapa_id, titulo, valor_estimado, origem, fechada_em)
SELECT
    cl.corretor_id,
    cl.id,
    (SELECT ci.imovel_id FROM public.cliente_imovel ci
      WHERE ci.cliente_id = cl.id ORDER BY ci.created_at LIMIT 1),
    et.id,
    COALESCE(NULLIF(cl.nome, ''), 'Oportunidade'),
    COALESCE((SELECT i.valor FROM public.cliente_imovel ci
                JOIN public.imoveis i ON i.id = ci.imovel_id
               WHERE ci.cliente_id = cl.id ORDER BY ci.created_at LIMIT 1), 0),
    COALESCE(cl.tracking_data ->> 'origem', 'migracao_funil'),
    CASE WHEN cl.status_funil IN ('FECHADO_GANHO', 'FECHADO_PERDIDO') THEN NOW() END
FROM public.clientes cl
JOIN public.crm_etapas et
  ON et.corretor_id = cl.corretor_id
 AND et.nome = CASE cl.status_funil
        WHEN 'QUALIFICACAO'    THEN 'Em qualificação'
        WHEN 'VISITA_PROPOSTA' THEN 'Visita agendada'
        WHEN 'DOCUMENTACAO'    THEN 'Negociação'
        WHEN 'FECHADO_GANHO'   THEN 'Fechado — ganho'
        WHEN 'FECHADO_PERDIDO' THEN 'Fechado — perdido'
        ELSE 'Novo lead'
     END
WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_oportunidades o WHERE o.cliente_id = cl.id
);

COMMENT ON TABLE public.crm_oportunidades IS
    'Negócio, separado do contato — um cliente pode ter várias oportunidades. Pipeline vem de crm_etapas.';
COMMENT ON COLUMN public.crm_oportunidades.updated_at IS
    'Usado como token de concorrência otimista ao mover o card no Kanban.';
