ALTER TABLE public.parceiros
  ADD COLUMN IF NOT EXISTS convite_status TEXT NOT NULL DEFAULT 'nao_enviado'
    CHECK (convite_status IN ('nao_enviado', 'enviado', 'aceito', 'falhou'));

ALTER TABLE public.parceiro_percentuais
  ADD COLUMN IF NOT EXISTS teto_renovacoes INT
    CHECK (teto_renovacoes IS NULL OR teto_renovacoes >= 0);

CREATE OR REPLACE FUNCTION public.admin_criar_parceiro_completo(p_dados JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_slug TEXT := lower(btrim(p_dados #>> '{link,slug}'));
  v_email TEXT := lower(btrim(p_dados #>> '{parceiro,email}'));
  v_base TEXT := p_dados #>> '{comissao,base_calculo}';
  v_pct NUMERIC := NULLIF(p_dados #>> '{comissao,percentual}', '')::NUMERIC;
  v_teto INT := NULLIF(p_dados #>> '{comissao,teto_renovacoes}', '')::INT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE = '42501'; END IF;
  IF length(btrim(p_dados #>> '{parceiro,nome}')) < 2 OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'nome ou e-mail inválido';
  END IF;
  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' THEN RAISE EXCEPTION 'identificador do link inválido'; END IF;
  IF v_pct IS NULL OR v_pct < 0 OR v_pct > 100 THEN RAISE EXCEPTION 'percentual inválido'; END IF;
  IF v_base IS NULL OR v_base NOT IN ('receita_bruta', 'primeiro_pagamento') THEN RAISE EXCEPTION 'regra de renovação inválida'; END IF;
  IF v_base = 'primeiro_pagamento' THEN v_teto := 0; END IF;

  INSERT INTO public.parceiros (id, nome, empresa, documento, email, telefone, responsavel,
    status, janela_atribuicao_dias, observacoes, criado_por, convite_status)
  VALUES (v_id, btrim(p_dados #>> '{parceiro,nome}'), nullif(btrim(p_dados #>> '{parceiro,empresa}'), ''),
    nullif(regexp_replace(p_dados #>> '{parceiro,documento}', '\D', '', 'g'), ''), v_email,
    nullif(btrim(p_dados #>> '{parceiro,telefone}'), ''), nullif(btrim(p_dados #>> '{parceiro,responsavel}'), ''),
    'ativo', COALESCE(NULLIF(p_dados #>> '{parceiro,janela_atribuicao_dias}', '')::INT, 90),
    nullif(btrim(p_dados #>> '{parceiro,observacoes}'), ''), auth.uid(), 'nao_enviado');

  INSERT INTO public.parceiro_percentuais (parceiro_id, percentual, base_calculo, teto_renovacoes, criado_por, motivo)
    VALUES (v_id, v_pct, v_base, v_teto, auth.uid(), 'Regra definida no convite inicial');
  INSERT INTO public.parceiro_links (parceiro_id, slug, campanha, principal, criado_por)
    VALUES (v_id, v_slug, nullif(btrim(p_dados #>> '{link,campanha}'), ''), true, auth.uid());
  RETURN jsonb_build_object('parceiro_id', v_id, 'slug', v_slug);
END $$;

REVOKE ALL ON FUNCTION public.admin_criar_parceiro_completo(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_criar_parceiro_completo(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.parceiro_portal_registrar_aceite()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', '')); v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL OR v_email = '' THEN RAISE EXCEPTION 'autenticacao necessaria' USING ERRCODE = '42501'; END IF;
  UPDATE public.parceiros SET convite_aceito_em = coalesce(convite_aceito_em, now()),
    convite_status = 'aceito', atualizado_em = now()
   WHERE (user_id = v_user OR (user_id IS NULL AND lower(email) = v_email)) AND lower(email) = v_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'parceiro nao encontrado' USING ERRCODE = '42501'; END IF;
  UPDATE public.parceiros SET user_id = v_user WHERE lower(email) = v_email AND user_id IS NULL;
  RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION public.parceiro_portal_teto_renovacoes()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', '')); v_teto INT;
BEGIN
  SELECT r.teto_renovacoes INTO v_teto FROM public.parceiros p
  JOIN public.parceiro_percentuais r ON r.parceiro_id = p.id AND r.vigencia_fim IS NULL
  WHERE (p.user_id = auth.uid() OR (p.user_id IS NULL AND lower(p.email) = v_email))
    AND lower(p.email) = v_email LIMIT 1;
  RETURN v_teto;
END $$;

REVOKE ALL ON FUNCTION public.parceiro_portal_registrar_aceite() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_portal_teto_renovacoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_registrar_aceite() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_teto_renovacoes() TO authenticated;

CREATE OR REPLACE FUNCTION public.gerar_comissao_de_receita()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_atribuicao public.parceiro_atribuicoes;
  v_regra public.parceiro_percentuais;
  v_parceiro public.parceiros;
  v_base NUMERIC(12,2);
  v_valor NUMERIC(12,2);
  v_ja_houve BOOLEAN;
  v_comissoes_existentes INT;
BEGIN
  IF NEW.status <> 'confirmado' OR NEW.corretor_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_atribuicao FROM public.parceiro_atribuicoes
    WHERE corretor_id = NEW.corretor_id AND status = 'convertida';
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO v_parceiro FROM public.parceiros WHERE id = v_atribuicao.parceiro_id;
  IF v_parceiro.status = 'encerrado' THEN RETURN NEW; END IF;
  v_regra := public.percentual_vigente_em(v_atribuicao.parceiro_id, NEW.confirmado_em::DATE);
  IF v_regra.id IS NULL THEN RETURN NEW; END IF;

  PERFORM 1 FROM public.parceiro_percentuais WHERE id = v_regra.id FOR UPDATE;
  IF v_regra.base_calculo = 'primeiro_pagamento' THEN
    SELECT EXISTS (SELECT 1 FROM public.receita_eventos
      WHERE corretor_id = NEW.corretor_id AND status = 'confirmado'
        AND id <> NEW.id AND confirmado_em < NEW.confirmado_em) INTO v_ja_houve;
    IF v_ja_houve THEN RETURN NEW; END IF;
  END IF;
  SELECT count(*) INTO v_comissoes_existentes FROM public.parceiro_comissoes
    WHERE atribuicao_id = v_atribuicao.id AND status <> 'estornada';
  IF v_regra.base_calculo <> 'primeiro_pagamento' AND v_regra.teto_renovacoes IS NOT NULL
      AND v_comissoes_existentes >= v_regra.teto_renovacoes + 1 THEN RETURN NEW; END IF;

  v_base := CASE WHEN v_regra.base_calculo = 'receita_liquida'
    THEN COALESCE(NEW.valor_liquido, NEW.valor_bruto) ELSE NEW.valor_bruto END;
  v_valor := CASE WHEN v_regra.base_calculo = 'valor_fixo'
    THEN v_regra.valor_fixo ELSE round(v_base * v_regra.percentual / 100, 2) END;
  INSERT INTO public.parceiro_comissoes (parceiro_id, atribuicao_id, receita_evento_id, corretor_id,
    valor_base, percentual_aplicado, base_calculo, percentual_id, valor_comissao, status, competencia)
  VALUES (v_atribuicao.parceiro_id, v_atribuicao.id, NEW.id, NEW.corretor_id,
    v_base, v_regra.percentual, v_regra.base_calculo, v_regra.id, v_valor, 'pendente',
    COALESCE(NEW.competencia, date_trunc('month', NEW.confirmado_em)::DATE))
  ON CONFLICT (receita_evento_id) DO NOTHING;
  RETURN NEW;
END $$;
