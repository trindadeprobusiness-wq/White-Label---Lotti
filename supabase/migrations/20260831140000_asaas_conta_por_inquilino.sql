-- ===========================================================================
-- Asaas — cada imobiliária com a própria conta de recebimento
-- ===========================================================================
--
-- Mudança de modelo. Até aqui `ASAAS_API_KEY` era uma variável de ambiente
-- global: UMA conta Asaas para todos os inquilinos do SaaS. As consequências
-- não eram só de exibição:
--
--   1. `asaas-sync` cria pagador e cobrança (`POST /customers`, `POST /payments`).
--      Um corretor novo que emitisse uma cobrança a criava dentro da conta da
--      imobiliária-piloto — e o aluguel do cliente dele cairia lá. Isso é
--      custódia de dinheiro de terceiro, anterior a qualquer discussão de tela.
--   2. `action: 'saldo'` devolvia `GET /finance/balance` da conta-mãe para
--      qualquer usuário autenticado. Todo mundo via o mesmo saldo.
--
-- Neste modelo a credencial deixa de ser configuração de servidor e passa a ser
-- **dado do cliente**, como já acontece com o app da Meta em
-- `meta_connection_secrets`. Quem não conectou não vê saldo e não emite
-- cobrança: fail-closed, em vez de operar silenciosamente na conta alheia.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tenant ativo determinístico
-- ---------------------------------------------------------------------------
--
-- O onboarding introduziu organizações, mas `get_corretor_id()` escolhia a
-- primeira membership ativa com `LIMIT 1`. Se uma conta ficasse com duas
-- memberships ativas (bootstrap + convite interrompido, por exemplo), o banco
-- podia escolher operações diferentes entre chamadas. Além da RLS, isso
-- escolheria a credencial Asaas errada. O perfil de onboarding já é único por
-- usuário e registra a organização atual; ele passa a ser a fonte explícita.

-- IMPORTANTE — esta seção NÃO pode exigir `onboarding_profiles`.
--
-- A migration de onboarding (`20260821130000`) nunca foi aplicada em produção.
-- Escrever esta parte contra `public.onboarding_profiles` fazia o arquivo INTEIRO
-- abortar com `42P01: relation "public.onboarding_profiles" does not exist`,
-- antes de criar qualquer tabela da Asaas — o vazamento entre inquilinos
-- continuava aberto porque uma tabela de OUTRO módulo não existia.
--
-- O determinismo real vem do índice único abaixo, que não depende de nada: com
-- no máximo UMA membership ativa por usuário, o `LIMIT 1` que a função de
-- produção já usa deixa de ser ambíguo por construção. O perfil do onboarding é
-- um refinamento, aplicado só se a tabela existir.

-- Passo 1 — quando o onboarding EXISTE, o perfil manda: vínculos ativos que
-- apontam para outra organização são revogados. Sem a tabela, não há o que
-- reconciliar e o bloco não faz nada.
DO $tenant_perfil$
BEGIN
    IF to_regclass('public.onboarding_profiles') IS NULL THEN
        RAISE NOTICE 'Asaas: onboarding_profiles ausente — reconciliacao de vinculo ignorada.';
        RETURN;
    END IF;

    EXECUTE $reconcilia$
        UPDATE public.routine_memberships AS m
           SET status = 'revoked', updated_at = now()
          FROM public.onboarding_profiles AS p
         WHERE p.user_id = m.user_id
           AND m.status = 'active'
           AND m.organization_id <> p.organization_id
    $reconcilia$;
END $tenant_perfil$;

-- Passo 2 — se ainda sobrar usuário com duas operações ativas, parar é o certo:
-- a escolha do inquilino decidiria QUAL conta Asaas atende a cobrança, e errar
-- aí emite na conta de outro. A mensagem diz como resolver, senão o SQL vira um
-- beco sem saída.
DO $tenant_ambiguo$
DECLARE
    v_qtd INT;
BEGIN
    SELECT count(*) INTO v_qtd
      FROM (
        SELECT user_id
          FROM public.routine_memberships
         WHERE status = 'active'
         GROUP BY user_id
        HAVING count(*) > 1
      ) duplicados;

    IF v_qtd > 0 THEN
        RAISE EXCEPTION
            '% usuario(s) com mais de uma organizacao ativa. Resolva antes: '
            'UPDATE public.routine_memberships SET status = ''revoked'' '
            'onde o vinculo nao for o atual, deixando um por usuario.', v_qtd;
    END IF;
END $tenant_ambiguo$;

-- Passo 3 — a trava definitiva. É ela que torna o `LIMIT 1` determinístico,
-- exista onboarding ou não.
CREATE UNIQUE INDEX IF NOT EXISTS uq_routine_membership_ativa_por_usuario
    ON public.routine_memberships (user_id)
    WHERE status = 'active';

-- Passo 4 — a função só passa a exigir o perfil se o perfil existir. Sem a
-- tabela, `get_corretor_id()` fica EXATAMENTE como está hoje em produção: esta
-- migration é sobre isolamento da Asaas e não é o lugar de mudar, de lado, quem
-- enxerga o quê nas ~30 policies que dependem dela.
DO $tenant_funcao$
BEGIN
    IF to_regclass('public.onboarding_profiles') IS NULL THEN
        RAISE NOTICE 'Asaas: get_corretor_id() mantida como esta; o indice unico ja garante o determinismo.';
        RETURN;
    END IF;

    EXECUTE $fn$
        CREATE OR REPLACE FUNCTION public.get_corretor_id()
        RETURNS UUID
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $tenant$
            SELECT o.legacy_corretor_id
              FROM public.onboarding_profiles p
              JOIN public.routine_memberships m
                ON m.organization_id = p.organization_id
               AND m.user_id = p.user_id
               AND m.status = 'active'
              JOIN public.routine_organizations o ON o.id = p.organization_id
              JOIN public.corretores c ON c.id = o.legacy_corretor_id
             WHERE p.user_id = (SELECT auth.uid())
               AND c.status = 'ativo'
        $tenant$
    $fn$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.get_corretor_id() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_corretor_id() TO authenticated';
    EXECUTE $c$
        COMMENT ON FUNCTION public.get_corretor_id() IS
            'Resolve o tenant pela organizacao do perfil unico do onboarding; '
            'exige membership ativa e corretor ativo, sem LIMIT 1 ambiguo.'
    $c$;
END $tenant_funcao$;

-- ---------------------------------------------------------------------------
-- Metadados: o que a interface precisa ler
-- ---------------------------------------------------------------------------
--
-- Nada aqui é segredo. `chave_final` são os 4 últimos dígitos e existe para a
-- pessoa conferir QUAL chave está conectada sem que a chave volte à tela.
-- `conta_nome`/`conta_email`/`conta_cpf_cnpj` são lidos da própria Asaas
-- (`GET /myAccount`) na validação: são a prova de que a chave é válida, do
-- mesmo jeito que `app_nome` prova o par id+secret da Meta.

CREATE TABLE IF NOT EXISTS public.asaas_conexoes (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corretor_id            UUID NOT NULL UNIQUE
                           REFERENCES public.corretores(id) ON DELETE CASCADE,

    ambiente               TEXT NOT NULL DEFAULT 'producao'
                           CHECK (ambiente IN ('sandbox', 'producao')),

    -- nao_conectada: nunca houve chave. invalida: a Asaas recusou a chave.
    -- sem_permissao: chave boa, faltam escopos (ex.: leitura de saldo).
    status                 TEXT NOT NULL DEFAULT 'nao_conectada'
                           CHECK (status IN ('nao_conectada', 'conectada', 'invalida', 'sem_permissao')),

    conta_nome             TEXT,
    conta_email            TEXT,
    conta_cpf_cnpj         TEXT,
    chave_final            TEXT,
    escopos_faltando       TEXT[] NOT NULL DEFAULT '{}',
    validada_em            TIMESTAMPTZ,

    -- O webhook chega numa URL só para todos os inquilinos. O slug é o que
    -- permite descobrir de quem é o evento ANTES de conferir o token.
    -- Opaco e sem significado: não é credencial sozinho.
    webhook_id             TEXT,
    webhook_slug           TEXT UNIQUE,
    webhook_configurado_em TIMESTAMPTZ,

    -- Onde o guia parou. Sem isto, quem fecha a aba no meio recomeça do zero.
    passo_guia             SMALLINT NOT NULL DEFAULT 1,

    -- Marca opcional para a tela pedir a troca de uma chave. NÃO é ligada
    -- automaticamente na conexão herdada: existe decisão registrada do dono da
    -- conta (2026-07-21) de manter a chave atual em uso e não rotacionar. A
    -- coluna fica para quando alguém pedir a troca, não para insistir nela.
    rotacao_pendente       BOOLEAN NOT NULL DEFAULT false,

    -- Ponte de migração: usa ASAAS_API_KEY do ambiente enquanto não houver
    -- chave própria gravada. Vale para no máximo UMA linha (índice abaixo).
    herdada_do_ambiente    BOOLEAN NOT NULL DEFAULT false,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.asaas_conexoes
    ADD COLUMN IF NOT EXISTS webhook_id TEXT;

DO $chk$ BEGIN
    ALTER TABLE public.asaas_conexoes
        ADD CONSTRAINT asaas_conexoes_passo_guia_valido
        CHECK (passo_guia BETWEEN 1 AND 4);
EXCEPTION WHEN duplicate_object THEN NULL; END $chk$;

COMMENT ON TABLE public.asaas_conexoes IS
    'Metadados da conta Asaas do inquilino. NÃO guarda a chave: segredo mora em asaas_conexao_segredos.';
COMMENT ON COLUMN public.asaas_conexoes.chave_final IS
    'Últimos 4 dígitos da chave, só para conferência visual. A chave nunca volta ao frontend.';
COMMENT ON COLUMN public.asaas_conexoes.herdada_do_ambiente IS
    'Ponte de migração: resolve para ASAAS_API_KEY do ambiente. No máximo uma linha.';

-- Só uma conexão pode herdar a chave global. Sem isto, um segundo inquilino
-- marcado por engano voltaria a ver a conta-mãe — o bug que esta migration fecha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asaas_conexoes_herdada
    ON public.asaas_conexoes ((herdada_do_ambiente))
    WHERE herdada_do_ambiente;

CREATE INDEX IF NOT EXISTS idx_asaas_conexoes_webhook_slug
    ON public.asaas_conexoes (webhook_slug);

-- ---------------------------------------------------------------------------
-- Segredos: tabela inacessível por construção
-- ---------------------------------------------------------------------------
--
-- RLS ligada e NENHUMA policy, mais REVOKE para anon e authenticated. Não
-- existe caminho pela Data API — nem para o dono da conexão. Só as Edge
-- Functions, com service_role, leem daqui. É o mesmo desenho de
-- `meta_connection_secrets`, e é por isso que a chave não vive numa coluna
-- de `asaas_conexoes`.

CREATE TABLE IF NOT EXISTS public.asaas_conexao_segredos (
    conexao_id               UUID PRIMARY KEY
                             REFERENCES public.asaas_conexoes(id) ON DELETE CASCADE,
    -- AES-256-GCM produzido nas Edge Functions com ASAAS_TOKEN_ENCRYPTION_KEY.
    api_key_ciphertext       TEXT,
    -- Token que a Asaas devolve no header do webhook. Gerado pela Lotti, não
    -- escolhido pelo usuário: token fraco aqui deixa qualquer um forjar evento.
    webhook_token_ciphertext TEXT,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.asaas_conexao_segredos IS
    'Chave Asaas cifrada. RLS ligada sem policy: inacessível pela Data API por construção.';

ALTER TABLE public.asaas_conexao_segredos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asaas_conexao_segredos FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS dos metadados: o corretor lê e edita só a própria conexão
-- ---------------------------------------------------------------------------
--
-- Sem policy de INSERT/DELETE para `authenticated`: criar e apagar conexão
-- passa pela Edge Function, que valida a chave contra a Asaas antes de gravar.
-- Deixar o cliente inserir direto permitiria uma linha "conectada" que nunca
-- foi validada — e a interface acreditaria nela.

ALTER TABLE public.asaas_conexoes ENABLE ROW LEVEL SECURITY;

DO $pol$ BEGIN
    CREATE POLICY "Corretor vê sua conexão Asaas"
        ON public.asaas_conexoes FOR SELECT
        USING (corretor_id = public.get_corretor_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

DO $pol$ BEGIN
    CREATE POLICY "Corretor atualiza o passo do guia"
        ON public.asaas_conexoes FOR UPDATE
        USING (corretor_id = public.get_corretor_id())
        WITH CHECK (corretor_id = public.get_corretor_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $pol$;

-- ATENÇÃO — a policy acima NÃO basta, e o nome dela engana.
--
-- RLS no Postgres decide LINHA, não COLUNA. Sozinha, ela deixaria o corretor
-- escrever qualquer coluna da própria linha, inclusive `herdada_do_ambiente`.
-- Marcar-se como herdeiro faz a credencial resolver para a `ASAAS_API_KEY` da
-- conta-mãe: seria o vazamento desta migration reaberto pela Data API, e o
-- índice único parcial só barra isso quando já existe outra linha herdada —
-- ou seja, não barra nada quando ninguém herdou.
--
-- Também impede forjar `status`/`validada_em`/`conta_nome` para a interface
-- exibir "conta conectada e validada" sem que a Asaas tenha confirmado nada.
--
-- O privilégio por coluna é o que fecha: dá para escrever `passo_guia` e mais
-- nada. As Edge Functions usam service_role e não passam por aqui.
REVOKE ALL ON public.asaas_conexoes FROM anon, authenticated;
GRANT SELECT ON public.asaas_conexoes TO authenticated;
GRANT UPDATE (passo_guia) ON public.asaas_conexoes TO authenticated;

DROP TRIGGER IF EXISTS tr_asaas_conexoes_updated_at ON public.asaas_conexoes;
CREATE TRIGGER tr_asaas_conexoes_updated_at
    BEFORE UPDATE ON public.asaas_conexoes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS tr_asaas_conexao_segredos_updated_at ON public.asaas_conexao_segredos;
CREATE TRIGGER tr_asaas_conexao_segredos_updated_at
    BEFORE UPDATE ON public.asaas_conexao_segredos
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Escrita atômica da conexão validada pela Edge Function
-- ---------------------------------------------------------------------------
--
-- Metadados e segredo precisam mudar juntos. Dois upserts independentes
-- poderiam deixar o nome/webhook da conta nova apontando para a chave antiga
-- se a segunda escrita falhasse. A função só é executável por service_role; o
-- usuário nunca consegue marcar a própria linha como conectada sem a Asaas ter
-- validado a chave e criado o webhook.
CREATE OR REPLACE FUNCTION public.salvar_conexao_asaas(
    p_corretor_id              UUID,
    p_ambiente                 TEXT,
    p_status                   TEXT,
    p_conta_nome               TEXT,
    p_conta_email              TEXT,
    p_conta_cpf_cnpj           TEXT,
    p_chave_final              TEXT,
    p_escopos_faltando         TEXT[],
    p_webhook_id               TEXT,
    p_webhook_slug             TEXT,
    p_api_key_ciphertext       TEXT,
    p_webhook_token_ciphertext TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $salvar$
DECLARE
    v_conexao UUID;
BEGIN
    IF p_corretor_id IS NULL
       OR p_api_key_ciphertext IS NULL
       OR p_webhook_token_ciphertext IS NULL
       OR p_webhook_id IS NULL
       OR p_webhook_slug IS NULL THEN
        RAISE EXCEPTION 'conexão Asaas incompleta';
    END IF;

    INSERT INTO public.asaas_conexoes (
        corretor_id, ambiente, status, conta_nome, conta_email,
        conta_cpf_cnpj, chave_final, escopos_faltando, validada_em,
        webhook_id, webhook_slug, webhook_configurado_em, passo_guia,
        rotacao_pendente, herdada_do_ambiente
    ) VALUES (
        p_corretor_id, p_ambiente, p_status, p_conta_nome, p_conta_email,
        p_conta_cpf_cnpj, p_chave_final, COALESCE(p_escopos_faltando, '{}'), now(),
        p_webhook_id, p_webhook_slug, now(), 4,
        false, false
    )
    ON CONFLICT (corretor_id) DO UPDATE SET
        ambiente = EXCLUDED.ambiente,
        status = EXCLUDED.status,
        conta_nome = EXCLUDED.conta_nome,
        conta_email = EXCLUDED.conta_email,
        conta_cpf_cnpj = EXCLUDED.conta_cpf_cnpj,
        chave_final = EXCLUDED.chave_final,
        escopos_faltando = EXCLUDED.escopos_faltando,
        validada_em = EXCLUDED.validada_em,
        webhook_id = EXCLUDED.webhook_id,
        webhook_slug = EXCLUDED.webhook_slug,
        webhook_configurado_em = EXCLUDED.webhook_configurado_em,
        passo_guia = 4,
        rotacao_pendente = false,
        herdada_do_ambiente = false,
        updated_at = now()
    RETURNING id INTO v_conexao;

    INSERT INTO public.asaas_conexao_segredos (
        conexao_id, api_key_ciphertext, webhook_token_ciphertext
    ) VALUES (
        v_conexao, p_api_key_ciphertext, p_webhook_token_ciphertext
    )
    ON CONFLICT (conexao_id) DO UPDATE SET
        api_key_ciphertext = EXCLUDED.api_key_ciphertext,
        webhook_token_ciphertext = EXCLUDED.webhook_token_ciphertext,
        updated_at = now();

    RETURN v_conexao;
END $salvar$;

REVOKE ALL ON FUNCTION public.salvar_conexao_asaas(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_conexao_asaas(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- Herança da conta-mãe, sem segredo dentro do SQL
-- ---------------------------------------------------------------------------
--
-- A migration NÃO grava chave nenhuma: cifrar exige a chave AES, que vive só
-- na Edge Function. Ela apenas marca qual inquilino continua resolvendo para
-- `ASAAS_API_KEY` do ambiente, para que quem já cobra hoje não pare.
--
-- Quem é esse inquilino é deduzido de EVIDÊNCIA, não de UUID escrito à mão:
-- é o corretor que tem cobrança emitida na conta global (`external_id`
-- preenchido). Se houver zero ou mais de um, a migration não escolhe: todos
-- conectam a própria chave. Adivinhar aqui reabriria exatamente o vazamento
-- que estamos fechando.

-- ---------------------------------------------------------------------------
-- Conciliação de repasse: a heurística exige inquilino conhecido
-- ---------------------------------------------------------------------------
--
-- `conciliar_transferencia_repasse` tinha os três critérios escritos como
-- `(_corretor_id IS NULL OR corretor_id = _corretor_id)`, e o webhook passava
-- NULL. Com uma conta Asaas só isso era inofensivo; com várias, deixou de ser.
--
-- O critério 3 casa por VALOR + CHAVE PIX. Os dois são adivinháveis — aluguel
-- costuma ser redondo e chave PIX é CPF/CNPJ/telefone — então, sem inquilino,
-- um TRANSFER_DONE forjado confirmaria o repasse de qualquer corretor sem que
-- um centavo tivesse saído, creditando o proprietário errado.
--
-- Os critérios 1 e 2 continuam valendo com inquilino desconhecido: casam por
-- id da transferência e por UUID do repasse, que são precisos e não
-- enumeráveis. Só a adivinhação é desarmada, e não o evento inteiro — recusar
-- o evento o deixaria preso, porque o sweeper (`sweeper-webhook-events`) só
-- resgata PROCESSING e nunca reprocessa FAILED.
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
AS $conc$
DECLARE
    v_id    UUID;
    v_qtd   INT;
BEGIN
    -- 1. Transferência criada pelo sistema.
    IF _transfer_id IS NOT NULL THEN
        SELECT id INTO v_id FROM public.repasses_proprietario
         WHERE external_id = _transfer_id
           AND (_corretor_id IS NULL OR corretor_id = _corretor_id)
         LIMIT 1;
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

    -- 3. Heurística: valor exato + chave PIX, SÓ com inquilino conhecido.
    IF _corretor_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, 'heuristica_sem_inquilino'::TEXT, 0;
        RETURN;
    END IF;

    IF _valor IS NOT NULL AND _chave_pix IS NOT NULL THEN
        SELECT count(*) INTO v_qtd
          FROM public.repasses_proprietario r
          JOIN public.proprietarios p ON p.id = r.proprietario_id
         WHERE r.status IN ('AGENDADO', 'ENVIADO')
           AND round(r.valor_liquido_repasse, 2) = round(_valor, 2)
           AND regexp_replace(COALESCE(p.chave_pix, ''), '\D', '', 'g')
             = regexp_replace(_chave_pix, '\D', '', 'g')
           AND r.corretor_id = _corretor_id;

        IF v_qtd = 1 THEN
            SELECT r.id INTO v_id
              FROM public.repasses_proprietario r
              JOIN public.proprietarios p ON p.id = r.proprietario_id
             WHERE r.status IN ('AGENDADO', 'ENVIADO')
               AND round(r.valor_liquido_repasse, 2) = round(_valor, 2)
               AND regexp_replace(COALESCE(p.chave_pix, ''), '\D', '', 'g')
                 = regexp_replace(_chave_pix, '\D', '', 'g')
               AND r.corretor_id = _corretor_id
             LIMIT 1;
            RETURN QUERY SELECT v_id, 'valor_e_chave_pix'::TEXT, 1;
            RETURN;
        END IF;

        IF v_qtd > 1 THEN
            RETURN QUERY SELECT NULL::UUID, 'ambiguo'::TEXT, v_qtd;
            RETURN;
        END IF;
    END IF;

    RETURN QUERY SELECT NULL::UUID, 'sem_correspondencia'::TEXT, 0;
END $conc$;

COMMENT ON FUNCTION public.conciliar_transferencia_repasse(UUID, TEXT, TEXT, NUMERIC, TEXT) IS
    'Casa uma transferência do Asaas com o repasse. Devolve NULL quando há mais '
    'de um candidato, e nunca aplica a heurística de valor + chave PIX sem '
    'inquilino conhecido — os dois valores são adivinháveis.';

-- ---------------------------------------------------------------------------
-- Herança da conta-mãe, sem segredo dentro do SQL
-- ---------------------------------------------------------------------------

DO $herda$
DECLARE
    dono UUID;
    quantos INT;
BEGIN
    SELECT count(DISTINCT corretor_id) INTO quantos
      FROM public.faturas_aluguel
     WHERE external_id IS NOT NULL;

    IF quantos = 1 THEN
        SELECT DISTINCT corretor_id INTO dono
          FROM public.faturas_aluguel
         WHERE external_id IS NOT NULL;

        INSERT INTO public.asaas_conexoes
            (corretor_id, status, herdada_do_ambiente, rotacao_pendente, ambiente, conta_nome)
        VALUES
            (dono, 'conectada', true, false, 'producao', 'Conta configurada no ambiente')
        ON CONFLICT (corretor_id) DO NOTHING;

        RAISE NOTICE 'Asaas: conexao herdada criada para o corretor %', dono;
    ELSE
        RAISE NOTICE 'Asaas: % corretores com cobranca emitida; nenhuma conexao herdada criada.', quantos;
    END IF;
END $herda$;
