-- Portal autenticado do programa de parceiros.
ALTER TABLE public.parceiros
  ADD COLUMN IF NOT EXISTS documento_beneficiario TEXT,
  ADD COLUMN IF NOT EXISTS convidado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS convite_aceito_em TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.parceiro_portal_resumo()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_parceiro public.parceiros;
  v_regra public.parceiro_percentuais;
  v_cliques BIGINT;
  v_cliques_30 BIGINT;
  v_cadastros BIGINT;
  v_comissoes JSONB;
  v_pagamentos JSONB;
  v_campanhas JSONB;
  v_link TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'autenticacao necessaria' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_parceiro FROM public.parceiros
   WHERE user_id = v_user OR (user_id IS NULL AND lower(email) = v_email)
   ORDER BY (user_id = v_user) DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'parceiro nao encontrado' USING ERRCODE = '42501'; END IF;
  IF lower(v_parceiro.email) <> v_email THEN RAISE EXCEPTION 'email divergente' USING ERRCODE = '42501'; END IF;

  UPDATE public.parceiros SET user_id = v_user, convite_aceito_em = coalesce(convite_aceito_em, now())
   WHERE id = v_parceiro.id AND user_id IS NULL;
  SELECT * INTO v_parceiro FROM public.parceiros WHERE id = v_parceiro.id;
  SELECT * INTO v_regra FROM public.parceiro_percentuais
   WHERE parceiro_id = v_parceiro.id AND vigencia_fim IS NULL LIMIT 1;

  SELECT count(*), count(*) FILTER (WHERE criado_em >= now() - interval '30 days')
    INTO v_cliques, v_cliques_30 FROM public.parceiro_cliques WHERE parceiro_id = v_parceiro.id;
  SELECT count(*) INTO v_cadastros FROM public.parceiro_atribuicoes
   WHERE parceiro_id = v_parceiro.id AND status = 'convertida';

  SELECT coalesce(jsonb_object_agg(status, valor), '{}'::jsonb) INTO v_comissoes FROM (
    SELECT CASE WHEN l.status IN ('rascunho', 'exportado') THEN 'em_repasse' ELSE c.status END AS status,
           sum(c.valor_comissao)::numeric(12,2) AS valor
      FROM public.parceiro_comissoes c
      LEFT JOIN public.parceiro_lote_itens i ON i.comissao_id = c.id
      LEFT JOIN public.parceiro_lotes l ON l.id = i.lote_id
     WHERE c.parceiro_id = v_parceiro.id
     GROUP BY 1
  ) totais;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'valor_total', p.valor_total, 'pago_em', p.pago_em,
    'referencia', p.referencia, 'competencia_inicio', p.competencia_inicio,
    'competencia_fim', p.competencia_fim
  ) ORDER BY p.pago_em DESC), '[]'::jsonb) INTO v_pagamentos
    FROM (SELECT * FROM public.parceiro_pagamentos WHERE parceiro_id = v_parceiro.id
          ORDER BY pago_em DESC LIMIT 50) p;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'campanha', coalesce(l.campanha, 'Sem identificador'), 'cliques', x.cliques,
    'indicacoes', x.indicacoes, 'assinaturas', x.assinaturas
  ) ORDER BY x.cliques DESC), '[]'::jsonb) INTO v_campanhas
    FROM public.parceiro_links l
    CROSS JOIN LATERAL (
      SELECT (SELECT count(*) FROM public.parceiro_cliques c WHERE c.link_id = l.id) AS cliques,
             (SELECT count(*) FROM public.parceiro_atribuicoes a WHERE a.link_id = l.id AND a.status = 'convertida') AS indicacoes,
             (SELECT count(*) FROM public.parceiro_comissoes c WHERE c.parceiro_id = l.parceiro_id AND c.atribuicao_id IN
                (SELECT a.id FROM public.parceiro_atribuicoes a WHERE a.link_id = l.id)) AS assinaturas
    ) x WHERE l.parceiro_id = v_parceiro.id AND l.ativo AND l.revogado_em IS NULL;
  SELECT slug INTO v_link FROM public.parceiro_links
   WHERE parceiro_id = v_parceiro.id AND principal AND ativo AND revogado_em IS NULL LIMIT 1;

  RETURN jsonb_build_object(
    'parceiro', jsonb_build_object('id', v_parceiro.id, 'nome', v_parceiro.nome,
      'email', v_parceiro.email, 'status', v_parceiro.status, 'comissao', coalesce(v_regra.percentual, 0),
      'valor_fixo', v_regra.valor_fixo,
      'base_calculo', coalesce(v_regra.base_calculo, 'receita_bruta'), 'renovacoes',
      CASE WHEN v_regra.id IS NULL THEN 'sem_regra' WHEN v_regra.base_calculo = 'primeiro_pagamento'
        THEN 'primeiro_pagamento' ELSE 'recorrente' END,
      'teto_renovacoes', NULL, 'documento', v_parceiro.documento_beneficiario,
      'chave_pix', v_parceiro.chave_pix, 'tipo_chave_pix', v_parceiro.tipo_chave_pix),
    'cliques_30_dias', v_cliques_30, 'cliques_total', v_cliques, 'cadastros', v_cadastros,
    'comissoes', v_comissoes, 'pagamentos', v_pagamentos, 'campanhas', v_campanhas,
    'link_principal', v_link
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.parceiro_portal_salvar_repasse(
  p_documento TEXT, p_tipo_chave TEXT, p_chave TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_parceiro public.parceiros; v_documento TEXT := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
BEGIN
  SELECT * INTO v_parceiro FROM public.parceiros
   WHERE user_id = auth.uid() OR (user_id IS NULL AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR lower(v_parceiro.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) THEN
    RAISE EXCEPTION 'parceiro nao encontrado' USING ERRCODE = '42501';
  END IF;
  IF p_tipo_chave NOT IN ('cpf','cnpj','email','telefone','aleatoria') OR length(btrim(coalesce(p_chave,''))) < 3 THEN
    RAISE EXCEPTION 'chave pix invalida' USING ERRCODE = '22023';
  END IF;
  IF length(v_documento) NOT IN (11,14) THEN RAISE EXCEPTION 'documento invalido' USING ERRCODE = '22023'; END IF;
  IF (p_tipo_chave = 'cpf' AND (length(regexp_replace(p_chave, '\D', '', 'g')) <> 11 OR regexp_replace(p_chave, '\D', '', 'g') <> v_documento))
     OR (p_tipo_chave = 'cnpj' AND (length(regexp_replace(p_chave, '\D', '', 'g')) <> 14 OR regexp_replace(p_chave, '\D', '', 'g') <> v_documento)) THEN
    RAISE EXCEPTION 'a chave precisa pertencer ao titular do documento' USING ERRCODE = '22023';
  END IF;
  UPDATE public.parceiros SET documento_beneficiario = v_documento,
    tipo_chave_pix = p_tipo_chave, chave_pix = btrim(p_chave), user_id = auth.uid(),
    convite_aceito_em = coalesce(convite_aceito_em, now()), atualizado_em = now()
   WHERE id = v_parceiro.id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.parceiro_portal_resumo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_portal_salvar_repasse(TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_resumo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_portal_salvar_repasse(TEXT,TEXT,TEXT) TO authenticated;

COMMENT ON FUNCTION public.parceiro_portal_resumo() IS
  'Devolve somente os dados do parceiro vinculado ao auth.uid()/e-mail autenticado.';
