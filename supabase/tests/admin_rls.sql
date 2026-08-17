-- ---------------------------------------------------------------------------
-- Testes de autorização do back office.
--
-- COMO RODAR: cole no SQL Editor do Supabase, depois de aplicar as cinco
-- migrations 20260814*. Roda inteiro dentro de uma transação e faz ROLLBACK no
-- final — nenhum dado é criado de verdade.
--
-- Cada bloco prova uma porta que precisa estar fechada. Se algum falhar, a
-- transação aborta com a mensagem do teste e a implantação NÃO deve seguir.
--
-- Por que existe como SQL e não como vitest: o vitest deste projeto roda em
-- node, sem banco. Estas regras vivem em policies e triggers do Postgres, e o
-- único lugar honesto de verificá-las é dentro do Postgres.
-- ---------------------------------------------------------------------------

BEGIN;

-- ── Preparo: dois usuários e dois corretores ──────────────────────────────
-- IDs fixos para os asserts ficarem legíveis.
DO $$
DECLARE
    v_user_comum  UUID := '11111111-1111-4111-8111-111111111111';
    v_user_admin  UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
    INSERT INTO auth.users (id, email, instance_id, aud, role)
    VALUES
        (v_user_comum, 'comum@teste.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
        (v_user_admin, 'admin@teste.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
    ON CONFLICT (id) DO NOTHING;

    -- handle_new_user() já cria o corretor; garantimos caso o trigger não rode.
    INSERT INTO public.corretores (user_id, nome, email, creci, telefone)
    VALUES
        (v_user_comum, 'Corretor Comum', 'comum@teste.local', 'PENDENTE', ''),
        (v_user_admin, 'Corretor Admin', 'admin@teste.local', 'PENDENTE', '')
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role, motivo)
    VALUES (v_user_admin, 'admin', 'teste de RLS')
    ON CONFLICT DO NOTHING;
END $$;

-- ── 1. Corretor comum não enxerga o back office ───────────────────────────
DO $$
DECLARE
    v_visiveis INT;
BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
        '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', TRUE);

    SELECT count(*) INTO v_visiveis FROM public.parceiros;
    IF v_visiveis <> 0 THEN
        RAISE EXCEPTION 'FALHA 1a: corretor comum enxergou % parceiro(s)', v_visiveis;
    END IF;

    SELECT count(*) INTO v_visiveis FROM public.admin_auditoria;
    IF v_visiveis <> 0 THEN
        RAISE EXCEPTION 'FALHA 1b: corretor comum enxergou a auditoria administrativa';
    END IF;

    SELECT count(*) INTO v_visiveis FROM public.parceiro_comissoes;
    IF v_visiveis <> 0 THEN
        RAISE EXCEPTION 'FALHA 1c: corretor comum enxergou comissões';
    END IF;

    RESET ROLE;
    RAISE NOTICE 'OK 1: corretor comum não lê parceiros, auditoria nem comissões';
END $$;

-- ── 2. RPC administrativa recusa quem não tem papel ───────────────────────
DO $$
DECLARE
    v_erro TEXT;
BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
        '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', TRUE);

    BEGIN
        PERFORM public.admin_metricas_visao_geral(CURRENT_DATE - 30, CURRENT_DATE);
        RESET ROLE;
        RAISE EXCEPTION 'FALHA 2: admin_metricas_visao_geral respondeu a um corretor comum';
    EXCEPTION WHEN insufficient_privilege THEN
        v_erro := 'esperado';
    END;

    RESET ROLE;
    RAISE NOTICE 'OK 2: RPC de métricas levanta 42501 para quem não é admin';
END $$;

-- ── 3. Admin não se promove a super_admin ─────────────────────────────────
DO $$
BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
        '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', TRUE);

    BEGIN
        INSERT INTO public.user_roles (user_id, role, motivo)
        VALUES ('22222222-2222-4222-8222-222222222222', 'super_admin', 'tentativa');
        RESET ROLE;
        RAISE EXCEPTION 'FALHA 3: um admin conseguiu se promover a super_admin';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL; -- a policy recusou, que é o esperado
    END;

    RESET ROLE;
    RAISE NOTICE 'OK 3: admin não concede papel — só super_admin';
END $$;

-- ── 4. Auditoria é append-only, inclusive para o banco ────────────────────
DO $$
DECLARE
    v_id BIGINT;
BEGIN
    INSERT INTO public.admin_auditoria (ator_user_id, acao, entidade, motivo)
    VALUES ('22222222-2222-4222-8222-222222222222', 'teste', 'teste', 'linha de teste')
    RETURNING id INTO v_id;

    BEGIN
        UPDATE public.admin_auditoria SET motivo = 'alterado' WHERE id = v_id;
        RAISE EXCEPTION 'FALHA 4a: UPDATE em admin_auditoria foi aceito';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
    END;

    BEGIN
        DELETE FROM public.admin_auditoria WHERE id = v_id;
        RAISE EXCEPTION 'FALHA 4b: DELETE em admin_auditoria foi aceito';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'FALHA%' THEN RAISE; END IF;
    END;

    RAISE NOTICE 'OK 4: auditoria não aceita UPDATE nem DELETE';
END $$;

-- ── 5. Corretor suspenso perde acesso a tudo ──────────────────────────────
-- O teste mais importante: prova que suspender vale no backend inteiro, e não
-- só na interface.
DO $$
DECLARE
    v_corretor UUID;
    v_id       UUID;
BEGIN
    SELECT id INTO v_corretor FROM public.corretores
     WHERE user_id = '11111111-1111-4111-8111-111111111111';

    UPDATE public.corretores SET status = 'suspenso' WHERE id = v_corretor;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
        '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', TRUE);

    SELECT public.get_corretor_id() INTO v_id;
    IF v_id IS NOT NULL THEN
        RESET ROLE;
        RAISE EXCEPTION 'FALHA 5: get_corretor_id() devolveu % para corretor suspenso', v_id;
    END IF;

    RESET ROLE;
    UPDATE public.corretores SET status = 'ativo' WHERE id = v_corretor;
    RAISE NOTICE 'OK 5: suspenso recebe NULL de get_corretor_id() e perde acesso via RLS';
END $$;

-- ── 6. Corretor não altera o próprio status ───────────────────────────────
DO $$
DECLARE
    v_corretor UUID;
BEGIN
    SELECT id INTO v_corretor FROM public.corretores
     WHERE user_id = '11111111-1111-4111-8111-111111111111';

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
        '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', TRUE);

    BEGIN
        UPDATE public.corretores SET status = 'ativo' WHERE id = v_corretor;
        -- Sem mudança de valor a trigger não dispara; forçamos uma alteração real.
        UPDATE public.corretores SET status = 'inativo' WHERE id = v_corretor;
        RESET ROLE;
        RAISE EXCEPTION 'FALHA 6: corretor alterou o próprio status';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    RESET ROLE;
    RAISE NOTICE 'OK 6: mudança de status é bloqueada para quem não é admin';
END $$;

-- ── 7. Uma receita gera no máximo uma comissão ────────────────────────────
DO $$
DECLARE
    v_parceiro  UUID;
    v_corretor  UUID;
    v_atrib     UUID;
    v_receita   UUID;
    v_qtd       INT;
    v_valor     NUMERIC;
BEGIN
    SELECT id INTO v_corretor FROM public.corretores
     WHERE user_id = '11111111-1111-4111-8111-111111111111';

    INSERT INTO public.parceiros (nome, email, status)
    VALUES ('Parceiro Teste', 'parceiro@teste.local', 'ativo')
    RETURNING id INTO v_parceiro;

    INSERT INTO public.parceiro_percentuais
        (parceiro_id, percentual, base_calculo, vigencia_inicio)
    VALUES (v_parceiro, 10, 'receita_bruta', CURRENT_DATE - 30);

    INSERT INTO public.parceiro_atribuicoes
        (parceiro_id, visitante_id, corretor_id, user_id, janela_dias,
         expira_em, status, convertido_em)
    VALUES (v_parceiro, gen_random_uuid(), v_corretor,
            '11111111-1111-4111-8111-111111111111', 90,
            now() + INTERVAL '90 days', 'convertida', now())
    RETURNING id INTO v_atrib;

    INSERT INTO public.receita_eventos
        (corretor_id, origem, valor_bruto, status, confirmado_em)
    VALUES (v_corretor, 'manual_admin', 1000, 'confirmado', now())
    RETURNING id INTO v_receita;

    SELECT count(*), max(valor_comissao) INTO v_qtd, v_valor
      FROM public.parceiro_comissoes WHERE receita_evento_id = v_receita;

    IF v_qtd <> 1 THEN
        RAISE EXCEPTION 'FALHA 7a: esperava 1 comissão, encontrei %', v_qtd;
    END IF;
    IF v_valor <> 100 THEN
        RAISE EXCEPTION 'FALHA 7b: 10%% de 1000 deveria ser 100, veio %', v_valor;
    END IF;

    -- Segunda tentativa de gerar a mesma comissão (simula webhook reentregue).
    BEGIN
        INSERT INTO public.parceiro_comissoes
            (parceiro_id, atribuicao_id, receita_evento_id, valor_base,
             percentual_aplicado, base_calculo, valor_comissao)
        VALUES (v_parceiro, v_atrib, v_receita, 1000, 10, 'receita_bruta', 100);
        RAISE EXCEPTION 'FALHA 7c: a mesma receita gerou uma segunda comissão';
    EXCEPTION WHEN unique_violation THEN
        NULL; -- o índice único segurou, que é o esperado
    END;

    RAISE NOTICE 'OK 7: comissão gerada uma única vez, no valor correto';

    -- ── 8. Alterar percentual não reescreve comissão já gerada ────────────
    PERFORM public.admin_config_int('janela_atividade_dias', 30); -- no-op
    INSERT INTO public.parceiro_percentuais
        (parceiro_id, percentual, base_calculo, vigencia_inicio)
    VALUES (v_parceiro, 5, 'receita_bruta', CURRENT_DATE + 1);

    SELECT valor_comissao INTO v_valor
      FROM public.parceiro_comissoes WHERE receita_evento_id = v_receita;

    IF v_valor <> 100 THEN
        RAISE EXCEPTION 'FALHA 8: comissão mudou para % depois de alterar o percentual', v_valor;
    END IF;
    RAISE NOTICE 'OK 8: comissão consolidada não muda ao alterar o percentual';

    -- ── 9. Estorno da receita estorna a comissão em aberto ────────────────
    UPDATE public.receita_eventos
       SET status = 'estornado', motivo_estorno = 'teste'
     WHERE id = v_receita;

    SELECT count(*) INTO v_qtd
      FROM public.parceiro_comissoes
     WHERE receita_evento_id = v_receita AND status = 'estornada';

    IF v_qtd <> 1 THEN
        RAISE EXCEPTION 'FALHA 9: estorno da receita não estornou a comissão';
    END IF;
    RAISE NOTICE 'OK 9: estorno da receita estorna a comissão em aberto';
END $$;

-- ── 10. Primeiro clique vence o segundo ───────────────────────────────────
DO $$
DECLARE
    v_p1  UUID;
    v_p2  UUID;
    v_vis UUID := gen_random_uuid();
    v_dono UUID;
BEGIN
    INSERT INTO public.parceiros (nome, email) VALUES ('P1', 'p1@teste.local') RETURNING id INTO v_p1;
    INSERT INTO public.parceiros (nome, email) VALUES ('P2', 'p2@teste.local') RETURNING id INTO v_p2;

    INSERT INTO public.parceiro_atribuicoes
        (parceiro_id, visitante_id, janela_dias, expira_em)
    VALUES (v_p1, v_vis, 90, now() + INTERVAL '90 days');

    -- O segundo parceiro tenta reivindicar o mesmo visitante.
    INSERT INTO public.parceiro_atribuicoes
        (parceiro_id, visitante_id, janela_dias, expira_em)
    VALUES (v_p2, v_vis, 90, now() + INTERVAL '90 days')
    ON CONFLICT (visitante_id) DO NOTHING;

    SELECT parceiro_id INTO v_dono
      FROM public.parceiro_atribuicoes WHERE visitante_id = v_vis;

    IF v_dono <> v_p1 THEN
        RAISE EXCEPTION 'FALHA 10: o segundo clique sobrescreveu o primeiro';
    END IF;
    RAISE NOTICE 'OK 10: primeiro clique mantém a atribuição';
END $$;

-- ── 11. Uma vigência aberta por parceiro ──────────────────────────────────
DO $$
DECLARE
    v_p    UUID;
    v_qtd  INT;
BEGIN
    INSERT INTO public.parceiros (nome, email) VALUES ('P3', 'p3@teste.local') RETURNING id INTO v_p;

    INSERT INTO public.parceiro_percentuais (parceiro_id, percentual, base_calculo, vigencia_inicio)
    VALUES (v_p, 10, 'receita_bruta', CURRENT_DATE - 10);
    INSERT INTO public.parceiro_percentuais (parceiro_id, percentual, base_calculo, vigencia_inicio)
    VALUES (v_p, 5, 'receita_bruta', CURRENT_DATE);

    SELECT count(*) INTO v_qtd
      FROM public.parceiro_percentuais WHERE parceiro_id = v_p AND vigencia_fim IS NULL;

    IF v_qtd <> 1 THEN
        RAISE EXCEPTION 'FALHA 11: % vigências abertas ao mesmo tempo', v_qtd;
    END IF;
    RAISE NOTICE 'OK 11: a vigência anterior fechou sozinha';
END $$;

-- Nada é persistido: os testes provam comportamento, não deixam dado.
ROLLBACK;
