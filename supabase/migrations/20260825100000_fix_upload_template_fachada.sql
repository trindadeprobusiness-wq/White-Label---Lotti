-- ===========================================================================
-- Correção: enviar template de fachada voltou a ser possível
-- ===========================================================================
--
-- ── O defeito ──────────────────────────────────────────────────────────────
--
-- `20260812090000_isolamento_multiusuario.sql` fechou um IDOR real no bucket
-- `imoveis-fotos`: antes, qualquer usuário autenticado gravava arquivo dentro
-- da pasta de imóvel de outro corretor. A policy passou a exigir que o primeiro
-- segmento do caminho fosse o id de um imóvel do próprio corretor:
--
--     AND (storage.foldername(name))[1] IN (
--         SELECT id::text FROM public.imoveis WHERE corretor_id = get_corretor_id()
--     )
--
-- O comentário daquela migration dizia: "O caminho usado pelo app é
-- `<imovel_id>/<timestamp>_<nome>` (useImovelFotos), então dá para escopar sem
-- quebrar nada."
--
-- A varredura olhou só `useImovelFotos` e não viu que a tela de Fachadas usa o
-- MESMO bucket com outro prefixo: `fachadas/<arquivo>`. O primeiro segmento
-- vira a string literal 'fachadas', que nunca casa com um UUID de imóvel — e o
-- upload passou a ser negado com "new row violates row-level security policy".
--
-- Duas telas pararam: "Enviar Meu Template" (FachadasInteligentes) e o template
-- personalizado dentro de "Nova fachada" (CriarFachadaDialog). Nada avisou,
-- porque o INSERT em `fachada_templates` está dentro de um try/catch que engole
-- o erro — o que aparecia era só a falha do upload.
--
-- ── A correção ─────────────────────────────────────────────────────────────
--
-- Uma policy adicional para o prefixo `fachadas/`, escopada pelo corretor. O
-- caminho passa a ser `fachadas/<corretor_id>/<arquivo>`, então há o que
-- verificar — o caminho antigo, `fachadas/<arquivo>`, não carregava nenhuma
-- informação de dono e por isso não podia ser liberado sem reabrir o IDOR.
--
-- O código do app foi alterado junto, na mesma branch. Esta migration sozinha
-- não conserta nada: sem o caminho novo, o segundo segmento continua sendo o
-- nome do arquivo e a verificação falha.
--
-- Leitura NÃO é afetada: `imoveis-fotos` é um bucket público (catálogo de
-- anúncios), então os templates já enviados antes do bug continuam visíveis.
-- Nenhum arquivo existente precisa ser movido.
-- ===========================================================================

-- INSERT de template de fachada, escopado por corretor.
DROP POLICY IF EXISTS "imoveis-fotos: upload de template de fachada" ON storage.objects;
CREATE POLICY "imoveis-fotos: upload de template de fachada"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'imoveis-fotos'
        AND (storage.foldername(name))[1] = 'fachadas'
        -- O corretor só grava dentro da própria pasta. `get_corretor_id()`
        -- devolve NULL para quem não tem corretor ativo, e NULL nunca é igual
        -- a nada — o acesso fecha sozinho, sem cláusula extra.
        AND (storage.foldername(name))[2] = public.get_corretor_id()::text
    );

-- `useFileUpload` envia com `upsert: true`. Reenviar um template com o mesmo
-- nome vira UPDATE em storage.objects, e a policy de UPDATE existente exige
-- `owner = auth.uid()` — o que já cobre o dono. Esta policy adicional cobre o
-- caso de o arquivo ter sido gravado por outra sessão do MESMO corretor, em que
-- `owner` é outro usuário mas a pasta continua sendo a dele.
DROP POLICY IF EXISTS "imoveis-fotos: atualiza template da propria pasta" ON storage.objects;
CREATE POLICY "imoveis-fotos: atualiza template da propria pasta"
    ON storage.objects FOR UPDATE TO authenticated
    USING (
        bucket_id = 'imoveis-fotos'
        AND (storage.foldername(name))[1] = 'fachadas'
        AND (storage.foldername(name))[2] = public.get_corretor_id()::text
    )
    WITH CHECK (
        bucket_id = 'imoveis-fotos'
        AND (storage.foldername(name))[1] = 'fachadas'
        AND (storage.foldername(name))[2] = public.get_corretor_id()::text
    );

-- Apagar o próprio template. A policy existente ("dono deleta") cobre por
-- `owner = auth.uid()`; esta cobre por pasta, pelo mesmo motivo acima.
DROP POLICY IF EXISTS "imoveis-fotos: deleta template da propria pasta" ON storage.objects;
CREATE POLICY "imoveis-fotos: deleta template da propria pasta"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'imoveis-fotos'
        AND (storage.foldername(name))[1] = 'fachadas'
        AND (storage.foldername(name))[2] = public.get_corretor_id()::text
    );

-- ---------------------------------------------------------------------------
-- fachada_templates: a tabela existe em produção e não tem migration
-- ---------------------------------------------------------------------------
--
-- `fachada_templates` é lida e escrita em quatro pontos do app e NÃO é criada
-- por nenhuma migration deste repositório — foi criada à mão no painel. Isso
-- significa que um ambiente novo (staging, ou o próximo desenvolvedor rodando
-- `supabase db reset`) não tem a tabela, e a funcionalidade falha em silêncio,
-- porque o INSERT está dentro de um try/catch vazio.
--
-- Criada aqui de forma idempotente, no formato que o código já usa. Em produção
-- o IF NOT EXISTS não altera a tabela existente nem os dados.

CREATE TABLE IF NOT EXISTS public.fachada_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
    nome        TEXT NOT NULL,
    categoria   TEXT NOT NULL DEFAULT 'VENDA',
    padrao      BOOLEAN NOT NULL DEFAULT FALSE,
    -- imagem_url, cores, estilo, layout, qrPosition e qrSize. JSONB porque o
    -- formato do template ainda está mudando e cada campo novo viraria uma
    -- migration.
    config      JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fachada_templates_corretor
    ON public.fachada_templates (corretor_id, created_at DESC);

ALTER TABLE public.fachada_templates ENABLE ROW LEVEL SECURITY;

-- `WITH CHECK` presente de propósito: é a cláusula que faltava nas policies
-- corrigidas pela 20260812090000, e sem ela dá para gravar no tenant alheio.
DROP POLICY IF EXISTS "corretor gerencia seus templates" ON public.fachada_templates;
CREATE POLICY "corretor gerencia seus templates" ON public.fachada_templates
    FOR ALL TO authenticated
    USING (corretor_id = public.get_corretor_id())
    WITH CHECK (corretor_id = public.get_corretor_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fachada_templates TO authenticated;

COMMENT ON TABLE public.fachada_templates IS
    'Templates de fachada personalizados por corretor. A arte vive no bucket imoveis-fotos, em fachadas/<corretor_id>/.';
