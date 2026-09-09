-- ═══════════════════════════════════════════════════════════════════════════
-- Back office — operação do SaaS Lotti (schema)
--
-- Completa o back office existente (20260814*) com o que faltava para
-- administrar a EMPRESA Lotti, e não a operação imobiliária do cliente:
-- repasse a parceiros em lote, feedback de cancelamento e os dados de
-- pagamento que o programa de parceiros precisa congelar.
--
-- Três decisões que valem ser lidas antes do código:
--
-- 1. NADA aqui cria uma segunda fonte de verdade. Assinatura continua em
--    `subscriptions`, plano em `plans`, pedido do checkout em
--    `checkout_orders` (criada pelo repositório do site) e comissão em
--    `parceiro_comissoes`. Este arquivo só acrescenta o que não existia.
--
-- 2. Campanha e portal do parceiro NÃO ganham tabela. `admin_config` já é
--    chave/valor JSONB com RLS pronta (admin lê, super_admin escreve) e os
--    helpers `admin_config_int`/`admin_config_texto`. Criar tabela nova para
--    guardar sete escalares seria schema a mais para manter e proteger.
--
-- 3. Não existe status `batched` em `parceiro_comissoes`. "Está em lote" é
--    derivado da existência da linha em `parceiro_lote_itens` — assim o
--    ciclo de vida da comissão continua tendo UM dono, a máquina de estados
--    que já existe, em vez de dois que podem divergir.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Dados de repasse do parceiro ───────────────────────────────────────
-- O programa paga por PIX. Sem chave gravada, o parceiro é inelegível para
-- lote — e é melhor que a tela diga isso do que exportar um CSV que o banco
-- recusa depois.
ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS chave_pix          TEXT;
ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS tipo_chave_pix     TEXT;
ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS cortesia_dias      INT;
ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS cortesia_expira_em DATE;
ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS tipo               TEXT;

DO $bloco$
BEGIN
    -- Constraint adicionada fora do CREATE TABLE precisa de guarda própria:
    -- ADD CONSTRAINT não aceita IF NOT EXISTS.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'parceiros_tipo_chave_pix_valido'
    ) THEN
        ALTER TABLE public.parceiros ADD CONSTRAINT parceiros_tipo_chave_pix_valido
            CHECK (tipo_chave_pix IS NULL OR tipo_chave_pix IN
                   ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria'));
    END IF;

    -- Chave sem tipo é chave que ninguém sabe como usar no banco.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'parceiros_pix_completo'
    ) THEN
        ALTER TABLE public.parceiros ADD CONSTRAINT parceiros_pix_completo
            CHECK (chave_pix IS NULL OR tipo_chave_pix IS NOT NULL);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'parceiros_tipo_valido'
    ) THEN
        ALTER TABLE public.parceiros ADD CONSTRAINT parceiros_tipo_valido
            CHECK (tipo IS NULL OR tipo IN
                   ('afiliado', 'influenciador', 'consultor', 'comercial'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'parceiros_cortesia_dias_valida'
    ) THEN
        ALTER TABLE public.parceiros ADD CONSTRAINT parceiros_cortesia_dias_valida
            CHECK (cortesia_dias IS NULL OR (cortesia_dias > 0 AND cortesia_dias <= 365));
    END IF;
END
$bloco$;

COMMENT ON COLUMN public.parceiros.chave_pix IS
  'Chave PIX de repasse. Sem ela o parceiro não entra em lote de pagamento.';
COMMENT ON COLUMN public.parceiros.cortesia_dias IS
  'Dias de acesso cortesia à Lotti concedidos ao parceiro. NULL = sem cortesia.';

-- Exclusão de parceiro continua sendo soft delete pelo `status = encerrado`
-- que já existe. Uma coluna `deleted_at` paralela criaria dois jeitos de
-- responder se o parceiro ainda vale, e as consultas atuais só conhecem um.

-- ── 2. Lotes de repasse ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parceiro_lotes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referencia    TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho', 'exportado', 'pago', 'falhou', 'cancelado')),
    valor_total   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
    total_parceiros INT NOT NULL DEFAULT 0 CHECK (total_parceiros >= 0),
    total_comissoes INT NOT NULL DEFAULT 0 CHECK (total_comissoes >= 0),
    saldo_minimo  NUMERIC(12,2),
    exportado_em  TIMESTAMPTZ,
    pago_em       DATE,
    referencia_pagamento TEXT,
    comprovante_url TEXT,
    observacoes   TEXT,
    motivo_cancelamento TEXT,
    criado_por    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.parceiro_lote_itens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote_id       UUID NOT NULL REFERENCES public.parceiro_lotes(id) ON DELETE CASCADE,
    parceiro_id   UUID NOT NULL REFERENCES public.parceiros(id) ON DELETE RESTRICT,
    comissao_id   UUID NOT NULL REFERENCES public.parceiro_comissoes(id) ON DELETE RESTRICT,
    valor         NUMERIC(12,2) NOT NULL CHECK (valor >= 0),

    -- Congelados no instante do lote, de propósito. O CSV que foi para o banco
    -- precisa continuar reproduzível meses depois, mesmo que o parceiro troque
    -- a chave PIX ou o nome amanhã. Ler do cadastro na hora da conferência
    -- mostraria um comprovante que não bate com o que foi pago.
    nome_beneficiario TEXT NOT NULL,
    documento_beneficiario TEXT,
    chave_pix     TEXT NOT NULL,
    tipo_chave_pix TEXT NOT NULL,

    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A trava que impede pagar a mesma comissão duas vezes. É unicidade de
    -- tabela, não checagem de aplicação: nenhuma branch futura consegue
    -- esquecer dela. Cancelar um lote apaga os itens (ver RPC), devolvendo as
    -- comissões ao conjunto elegível.
    CONSTRAINT parceiro_lote_itens_comissao_unica UNIQUE (comissao_id)
);

CREATE INDEX IF NOT EXISTS parceiro_lote_itens_lote_idx
    ON public.parceiro_lote_itens (lote_id);
CREATE INDEX IF NOT EXISTS parceiro_lote_itens_parceiro_idx
    ON public.parceiro_lote_itens (parceiro_id);
CREATE INDEX IF NOT EXISTS parceiro_lotes_status_idx
    ON public.parceiro_lotes (status, criado_em DESC);

COMMENT ON TABLE public.parceiro_lotes IS
  'Lotes manuais de repasse a parceiros. Não executa PIX: prepara e concilia.';
COMMENT ON CONSTRAINT parceiro_lote_itens_comissao_unica ON public.parceiro_lote_itens IS
  'Uma comissão nunca entra em dois lotes. Cancelar o lote apaga os itens.';

-- ── 3. Feedback de cancelamento ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cancelamento_feedback (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id   UUID REFERENCES public.corretores(id) ON DELETE SET NULL,

    -- Só existem para o cancelamento que NÃO tem conta identificável (lead que
    -- desistiu no trial, contato que veio pelo WhatsApp). Havendo corretor_id,
    -- nome e contato saem do join: repetir aqui criaria uma segunda cópia de
    -- dado pessoal para manter atualizada e para localizar num pedido de
    -- exclusão da LGPD.
    contato_nome     TEXT,
    contato_email    TEXT,
    contato_telefone TEXT,

    plano_anterior TEXT,
    motivo        TEXT NOT NULL CHECK (motivo IN (
                      'preco_alto',
                      'pouco_uso',
                      'dificuldade_implantacao',
                      'faltam_funcionalidades',
                      'faltam_integracoes',
                      'problemas_tecnicos',
                      'outra_solucao',
                      'atendimento_ruim',
                      'encerrou_operacao',
                      'outro')),
    comentario    TEXT,
    origem        TEXT NOT NULL DEFAULT 'outro' CHECK (origem IN (
                      'whatsapp', 'suporte', 'ligacao', 'formulario', 'sistema', 'outro')),
    data_cancelamento DATE NOT NULL DEFAULT CURRENT_DATE,
    registrado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Feedback anônimo não serve para nada: ou aponta uma conta, ou traz ao
    -- menos um nome para quem for retomar o contato.
    CONSTRAINT cancelamento_feedback_identificado CHECK (
        corretor_id IS NOT NULL OR btrim(COALESCE(contato_nome, '')) <> ''
    ),
    -- Contrapartida da decisão acima, escrita como constraint para não
    -- depender de disciplina de quem escrever o próximo INSERT.
    CONSTRAINT cancelamento_feedback_sem_pii_duplicado CHECK (
        corretor_id IS NULL OR (contato_email IS NULL AND contato_telefone IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS cancelamento_feedback_data_idx
    ON public.cancelamento_feedback (data_cancelamento DESC);
CREATE INDEX IF NOT EXISTS cancelamento_feedback_motivo_idx
    ON public.cancelamento_feedback (motivo, data_cancelamento DESC);
CREATE INDEX IF NOT EXISTS cancelamento_feedback_corretor_idx
    ON public.cancelamento_feedback (corretor_id)
    WHERE corretor_id IS NOT NULL;

COMMENT ON TABLE public.cancelamento_feedback IS
  'Por que contas Lotti cancelam. Dado pessoal só é gravado quando não há conta ligada.';

-- ── 4. RLS ────────────────────────────────────────────────────────────────
-- Mesmo desenho das tabelas de 20260814: leitura para admin, escrita apenas
-- pelas RPCs SECURITY DEFINER. Nenhuma policy de INSERT/UPDATE para
-- `authenticated` — dinheiro e trilha de auditoria não entram pela Data API.
ALTER TABLE public.parceiro_lotes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parceiro_lote_itens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancelamento_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parceiro_lotes: admin le" ON public.parceiro_lotes;
CREATE POLICY "parceiro_lotes: admin le" ON public.parceiro_lotes
    FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "parceiro_lote_itens: admin le" ON public.parceiro_lote_itens;
CREATE POLICY "parceiro_lote_itens: admin le" ON public.parceiro_lote_itens
    FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "cancelamento_feedback: admin le" ON public.cancelamento_feedback;
CREATE POLICY "cancelamento_feedback: admin le" ON public.cancelamento_feedback
    FOR SELECT TO authenticated USING (public.is_admin());

-- Sem GRANT de escrita: as RPCs rodam como dono e não dependem destes grants.
REVOKE ALL ON TABLE public.parceiro_lotes        FROM anon, authenticated;
REVOKE ALL ON TABLE public.parceiro_lote_itens   FROM anon, authenticated;
REVOKE ALL ON TABLE public.cancelamento_feedback FROM anon, authenticated;
GRANT SELECT ON TABLE public.parceiro_lotes        TO authenticated;
GRANT SELECT ON TABLE public.parceiro_lote_itens   TO authenticated;
GRANT SELECT ON TABLE public.cancelamento_feedback TO authenticated;

-- ── 5. atualizado_em ──────────────────────────────────────────────────────
-- Reaproveita `tocar_atualizado_em()`, criada em 20260814120000. Redefini-la
-- aqui só para acrescentar `SET search_path` mudaria uma função de que a
-- trigger de `parceiros` já depende — endurecimento legítimo, mas de outra
-- migration. Este arquivo é sobre o back office do SaaS.
DROP TRIGGER IF EXISTS parceiro_lotes_atualizado_em ON public.parceiro_lotes;
CREATE TRIGGER parceiro_lotes_atualizado_em
    BEFORE UPDATE ON public.parceiro_lotes
    FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

DROP TRIGGER IF EXISTS cancelamento_feedback_atualizado_em ON public.cancelamento_feedback;
CREATE TRIGGER cancelamento_feedback_atualizado_em
    BEFORE UPDATE ON public.cancelamento_feedback
    FOR EACH ROW EXECUTE FUNCTION public.tocar_atualizado_em();

-- ── 6. Configuração da campanha e do portal ───────────────────────────────
-- Reaproveita `admin_config`. `ON CONFLICT DO NOTHING` porque reaplicar a
-- migration não pode reverter o que o operador ajustou na tela.
INSERT INTO public.admin_config (chave, valor, descricao) VALUES
    -- Sugestão para o formulário, NÃO fallback do motor de comissão.
    -- `gerar_comissao_de_receita` (20260814130000:210) decide de propósito não
    -- gerar comissão quando o parceiro não tem percentual vigente na data —
    -- "sem regra vigente, não se inventa percentual". Transformar esta chave em
    -- fallback silencioso passaria a criar dinheiro a pagar a partir de uma
    -- configuração global, que é exatamente o que aquela linha evita.
    ('programa_comissao_padrao',   '10'::JSONB,
     'Percentual pré-preenchido ao cadastrar a primeira vigência de um parceiro. Não é aplicado automaticamente a quem não tem vigência.'),
    -- A janela de atribuição já mora em `atribuicao_janela_dias`, criada em
    -- 20260814110000 e lida pela geração de atribuição. Não se duplica aqui.
    ('programa_comissao_recorrente', 'true'::JSONB,
     'Renovações elegíveis também geram comissão.'),
    ('programa_cortesia_ativa',    'false'::JSONB,
     'Conceder acesso cortesia automaticamente ao ativar um parceiro.'),
    ('programa_cortesia_dias',     '30'::JSONB,
     'Dias de cortesia concedidos quando a cortesia automática está ligada.'),
    ('programa_saldo_minimo',      '50'::JSONB,
     'Valor mínimo acumulado para o parceiro entrar em um lote de repasse.'),
    ('programa_ciclo_dia',         '10'::JSONB,
     'Dia do mês em que o lote de repasse é gerado.'),
    ('programa_hold_dias',         '7'::JSONB,
     'Dias entre a confirmação da receita e a liberação da comissão para repasse.'),
    ('portal_publicado',           'false'::JSONB,
     'Portal do parceiro visível publicamente.'),
    ('portal_titulo',              '"Programa de Parceiros Lotti"'::JSONB,
     'Título exibido no portal público do parceiro.'),
    ('portal_descricao',           '"Indique a Lotti para corretores e imobiliárias e receba comissão recorrente sobre cada assinatura ativa."'::JSONB,
     'Texto de abertura do portal do parceiro.'),
    ('portal_beneficios',
     '["Comissão recorrente enquanto a assinatura indicada continuar ativa","Acesso cortesia à Lotti durante a parceria","Repasse por PIX, sem burocracia","Acompanhamento transparente de cliques, cadastros e conversões"]'::JSONB,
     'Lista ordenada de benefícios do portal do parceiro.')
ON CONFLICT (chave) DO NOTHING;
