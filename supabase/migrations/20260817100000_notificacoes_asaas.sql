-- ---------------------------------------------------------------------------
-- Notificações do Asaas e baixa automática de repasse por transferência.
--
-- Duas lacunas que este arquivo fecha:
--
-- 1. O webhook do Asaas descarta transferências. A primeira linha do
--    processamento é `if (!payment?.id) { finalize('IGNORED'); return; }` —
--    e evento de transferência não tem `payment`, tem `transfer`. Resultado:
--    o PIX de repasse sai, o Asaas avisa, e o sistema não fica sabendo.
--
-- 2. `alertas` só distingue FOLLOWUP/DOCUMENTO/EXCLUSIVIDADE/GERAL. Não havia
--    como dizer "isto é dinheiro que entrou" nem apontar para o repasse ou a
--    fatura de origem, então o sino não teria o que mostrar além de texto solto.
--
-- Sobre a conciliação da transferência com o repasse: o `external_id` do
-- repasse existe desde 20260122130000 mas nunca foi preenchido — nada no
-- código cria transferência pelo Asaas. Na prática o corretor faz o PIX por
-- fora, e a transferência chega sem saber a que repasse pertence. A regra de
-- casamento está em `conciliar_transferencia_repasse()`, abaixo, e o critério
-- que a governa é: na dúvida, NÃO dar baixa. Repasse é dinheiro de terceiro.
--
-- Idempotente.
-- ---------------------------------------------------------------------------

-- ── 1. Vocabulário de alerta ──────────────────────────────────────────────
-- ADD VALUE IF NOT EXISTS não pode rodar junto do uso do valor na mesma
-- transação, mas aqui só declaramos — o uso acontece em runtime, pelo webhook.
DO $$
BEGIN
    ALTER TYPE public.tipo_alerta ADD VALUE IF NOT EXISTS 'PAGAMENTO';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE public.tipo_alerta ADD VALUE IF NOT EXISTS 'TRANSFERENCIA';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ── 2. Alerta ganha origem e vínculo ──────────────────────────────────────
-- Sem `entidade_tipo`/`entidade_id` o sino conseguiria mostrar o texto mas não
-- levar a lugar nenhum — e "recebemos R$ 2.300" sem link para a fatura obriga
-- o corretor a procurar à mão.
ALTER TABLE public.alertas ADD COLUMN IF NOT EXISTS origem TEXT
    CHECK (origem IS NULL OR origem IN ('sistema', 'asaas', 'cron', 'ia'));
ALTER TABLE public.alertas ADD COLUMN IF NOT EXISTS entidade_tipo TEXT
    CHECK (entidade_tipo IS NULL OR entidade_tipo IN ('fatura', 'repasse', 'contrato', 'cliente', 'imovel'));
ALTER TABLE public.alertas ADD COLUMN IF NOT EXISTS entidade_id UUID;
ALTER TABLE public.alertas ADD COLUMN IF NOT EXISTS metadata JSONB;

CREATE INDEX IF NOT EXISTS idx_alertas_corretor_lido
    ON public.alertas (corretor_id, lido, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_entidade
    ON public.alertas (entidade_tipo, entidade_id);

COMMENT ON COLUMN public.alertas.metadata IS
    'Dados de exibição do alerta (valor, nome do proprietário, id no Asaas). '
    'Não é fonte de verdade: o dado oficial está na entidade apontada.';

-- ── 3. Repasse: rastro da transferência ───────────────────────────────────
ALTER TABLE public.repasses_proprietario
    ADD COLUMN IF NOT EXISTS transferencia_status TEXT;
ALTER TABLE public.repasses_proprietario
    ADD COLUMN IF NOT EXISTS transferencia_efetivada_em TIMESTAMPTZ;
ALTER TABLE public.repasses_proprietario
    ADD COLUMN IF NOT EXISTS transferencia_payload JSONB;
-- Quando a conciliação é ambígua, o repasse NÃO é baixado e o motivo fica
-- registrado aqui para o corretor resolver à mão.
ALTER TABLE public.repasses_proprietario
    ADD COLUMN IF NOT EXISTS conciliacao_pendente TEXT;

CREATE INDEX IF NOT EXISTS idx_repasses_status_valor
    ON public.repasses_proprietario (corretor_id, status, valor_liquido_repasse);

-- ── 4. Conciliação transferência → repasse ────────────────────────────────
-- Devolve o repasse que a transferência quita, ou NULL quando não dá para
-- afirmar com segurança.
--
-- Ordem de tentativa, da mais forte para a mais fraca:
--   1. external_id  — a transferência foi criada pelo sistema. Prova direta.
--   2. externalReference — o corretor colou o id do repasse ao criar o PIX
--      no painel do Asaas. Também é prova direta.
--   3. valor + chave PIX do proprietário — heurística, e SÓ vale se houver
--      exatamente UM candidato. Dois repasses de mesmo valor para a mesma
--      chave são indistinguíveis: baixar um deles seria adivinhar com o
--      dinheiro do proprietário.
--
-- O terceiro caso é o real hoje, porque nada preenche external_id.
CREATE OR REPLACE FUNCTION public.conciliar_transferencia_repasse(
    _corretor_id   UUID,
    _transfer_id   TEXT,
    _external_ref  TEXT,
    _valor         NUMERIC,
    _chave_pix     TEXT
)
RETURNS TABLE (repasse_id UUID, criterio TEXT, ambiguidade INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id    UUID;
    v_qtd   INT;
BEGIN
    -- 1. Transferência criada pelo sistema.
    IF _transfer_id IS NOT NULL THEN
        SELECT id INTO v_id FROM public.repasses_proprietario
         WHERE external_id = _transfer_id LIMIT 1;
        IF v_id IS NOT NULL THEN
            RETURN QUERY SELECT v_id, 'external_id'::TEXT, 1;
            RETURN;
        END IF;
    END IF;

    -- 2. Referência externa preenchida à mão no Asaas.
    IF _external_ref IS NOT NULL AND _external_ref ~ '^[0-9a-f-]{36}$' THEN
        SELECT id INTO v_id FROM public.repasses_proprietario
         WHERE id = _external_ref::UUID
           AND (_corretor_id IS NULL OR corretor_id = _corretor_id)
         LIMIT 1;
        IF v_id IS NOT NULL THEN
            RETURN QUERY SELECT v_id, 'external_reference'::TEXT, 1;
            RETURN;
        END IF;
    END IF;

    -- 3. Heurística: valor exato + chave PIX do proprietário, entre repasses
    --    ainda em aberto. `round(...,2)` porque o Asaas manda o valor como
    --    número e a coluna é NUMERIC — comparar sem normalizar erra por
    --    dízima em casos como 1633.333.
    IF _valor IS NOT NULL AND _chave_pix IS NOT NULL THEN
        SELECT count(*) INTO v_qtd
          FROM public.repasses_proprietario r
          JOIN public.proprietarios p ON p.id = r.proprietario_id
         WHERE r.status IN ('AGENDADO', 'ENVIADO')
           AND round(r.valor_liquido_repasse, 2) = round(_valor, 2)
           AND regexp_replace(COALESCE(p.chave_pix, ''), '\D', '', 'g')
             = regexp_replace(_chave_pix, '\D', '', 'g')
           AND (_corretor_id IS NULL OR r.corretor_id = _corretor_id);

        IF v_qtd = 1 THEN
            SELECT r.id INTO v_id
              FROM public.repasses_proprietario r
              JOIN public.proprietarios p ON p.id = r.proprietario_id
             WHERE r.status IN ('AGENDADO', 'ENVIADO')
               AND round(r.valor_liquido_repasse, 2) = round(_valor, 2)
               AND regexp_replace(COALESCE(p.chave_pix, ''), '\D', '', 'g')
                 = regexp_replace(_chave_pix, '\D', '', 'g')
               AND (_corretor_id IS NULL OR r.corretor_id = _corretor_id)
             LIMIT 1;
            RETURN QUERY SELECT v_id, 'valor_e_chave_pix'::TEXT, 1;
            RETURN;
        END IF;

        -- Mais de um candidato: devolve a contagem para o chamador registrar
        -- pendência em vez de escolher no chute.
        IF v_qtd > 1 THEN
            RETURN QUERY SELECT NULL::UUID, 'ambiguo'::TEXT, v_qtd;
            RETURN;
        END IF;
    END IF;

    RETURN QUERY SELECT NULL::UUID, 'sem_correspondencia'::TEXT, 0;
END $$;

REVOKE ALL ON FUNCTION public.conciliar_transferencia_repasse(UUID, TEXT, TEXT, NUMERIC, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conciliar_transferencia_repasse(UUID, TEXT, TEXT, NUMERIC, TEXT)
    TO service_role;

-- ── 5. Alerta de dinheiro, com nome de gente ──────────────────────────────
-- "Transferência de R$ 1.840,00 confirmada" não diz para quem. O corretor
-- administra vários proprietários e precisa saber qual foi quitado — é a
-- primeira pergunta que ele faz ao ver a notificação.
CREATE OR REPLACE FUNCTION public.registrar_alerta_financeiro(
    _corretor_id   UUID,
    _tipo          TEXT,
    _mensagem      TEXT,
    _entidade_tipo TEXT,
    _entidade_id   UUID,
    _metadata      JSONB DEFAULT NULL,
    _prioridade    TEXT DEFAULT 'MEDIA'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF _corretor_id IS NULL THEN
        RETURN NULL; -- sem dono, o alerta não seria visível por ninguém
    END IF;

    INSERT INTO public.alertas
        (corretor_id, tipo, prioridade, mensagem, lido,
         origem, entidade_tipo, entidade_id, metadata)
    VALUES
        (_corretor_id, _tipo::public.tipo_alerta, _prioridade::public.prioridade_alerta,
         _mensagem, FALSE, 'asaas', _entidade_tipo, _entidade_id, _metadata)
    RETURNING id INTO v_id;

    RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.registrar_alerta_financeiro(UUID, TEXT, TEXT, TEXT, UUID, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_alerta_financeiro(UUID, TEXT, TEXT, TEXT, UUID, JSONB, TEXT)
    TO service_role;

-- ── 6. Marcar alertas como lidos em lote ──────────────────────────────────
-- O sino precisa de "marcar todas como lidas"; sem isto o front faria N
-- updates, um por alerta.
CREATE OR REPLACE FUNCTION public.marcar_alertas_lidos(_ids UUID[] DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_corretor UUID := public.get_corretor_id();
    v_qtd INT;
BEGIN
    IF v_corretor IS NULL THEN
        RETURN 0;
    END IF;

    -- A RLS de alertas já limita ao corretor; o filtro explícito é defesa em
    -- profundidade, não substituto dela.
    UPDATE public.alertas
       SET lido = TRUE
     WHERE corretor_id = v_corretor
       AND lido = FALSE
       AND (_ids IS NULL OR id = ANY(_ids));

    GET DIAGNOSTICS v_qtd = ROW_COUNT;
    RETURN v_qtd;
END $$;

GRANT EXECUTE ON FUNCTION public.marcar_alertas_lidos(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.conciliar_transferencia_repasse(UUID, TEXT, TEXT, NUMERIC, TEXT) IS
    'Casa uma transferência do Asaas com o repasse correspondente. Devolve NULL '
    'quando há mais de um candidato — repasse é dinheiro de terceiro, e baixar '
    'o errado é pior que não baixar.';
