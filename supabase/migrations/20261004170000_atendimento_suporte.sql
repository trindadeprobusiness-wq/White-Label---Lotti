BEGIN;
CREATE TABLE public.admin_sessoes_suporte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ator_user_id UUID NOT NULL REFERENCES auth.users(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  corretor_id UUID NOT NULL REFERENCES public.corretores(id),
  auth_session_id UUID NOT NULL UNIQUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 minutes',
  encerrado_em TIMESTAMPTZ
);
ALTER TABLE public.admin_sessoes_suporte ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_sessoes_suporte FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_sessoes_suporte TO authenticated;
GRANT ALL ON public.admin_sessoes_suporte TO service_role;
CREATE POLICY "suporte: admin le" ON public.admin_sessoes_suporte
  FOR SELECT TO authenticated USING (public.is_admin());

-- Credenciais nunca saem da Edge Function nem ficam em um schema exposto.
CREATE SCHEMA suporte_privado;
REVOKE ALL ON SCHEMA suporte_privado FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA suporte_privado TO service_role;
CREATE TABLE suporte_privado.credenciais (
  sessao_id UUID PRIMARY KEY REFERENCES public.admin_sessoes_suporte(id),
  access_token TEXT NOT NULL
);
REVOKE ALL ON suporte_privado.credenciais FROM PUBLIC, anon, authenticated;
GRANT ALL ON suporte_privado.credenciais TO service_role;

CREATE FUNCTION public.admin_preparar_suporte(p_corretor_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.corretores;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.corretores WHERE id=p_corretor_id;
  IF c.id IS NULL OR c.status <> 'ativo' THEN
    RAISE EXCEPTION 'A conta precisa estar ativa para iniciar atendimento.' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id
            AND role IN ('admin','super_admin') AND revogado_em IS NULL) THEN
    RAISE EXCEPTION 'Contas administrativas nao podem ser abertas em modo de atendimento.' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('corretor_id',c.id,'user_id',c.user_id,'nome',c.nome);
END $$;

CREATE FUNCTION public.suporte_criar_sessao(p_ator UUID, p_corretor UUID, p_auth_session UUID, p_access TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.corretores; s public.admin_sessoes_suporte;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_ator
    AND role IN ('admin','super_admin') AND revogado_em IS NULL) THEN
    RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM public.corretores WHERE id=p_corretor AND status='ativo' FOR SHARE;
  IF c.id IS NULL OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=c.user_id
    AND role IN ('admin','super_admin') AND revogado_em IS NULL) THEN
    RAISE EXCEPTION 'conta indisponivel para atendimento' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_auth_session AND user_id=c.user_id) THEN
    RAISE EXCEPTION 'sessao de autenticacao invalida' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.admin_sessoes_suporte(ator_user_id,user_id,corretor_id,auth_session_id)
    VALUES(p_ator,c.user_id,c.id,p_auth_session) RETURNING * INTO s;
  INSERT INTO suporte_privado.credenciais VALUES(s.id,p_access);
  INSERT INTO public.admin_auditoria(ator_user_id,acao,entidade,entidade_id,dados_depois,motivo)
    VALUES(p_ator,'suporte_aberto','corretores',c.id::TEXT,
      jsonb_build_object('sessao_id',s.id,'expira_em',s.expira_em),'Atendimento pelo backoffice');
  RETURN to_jsonb(s);
END $$;

CREATE FUNCTION public.suporte_obter_credenciais(p_sessao UUID,p_ator UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.admin_sessoes_suporte; tokens JSONB;
BEGIN
  SELECT * INTO s FROM public.admin_sessoes_suporte WHERE id=p_sessao AND ator_user_id=p_ator
    AND encerrado_em IS NULL AND expira_em>now();
  IF s.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_ator
    AND role IN ('admin','super_admin') AND revogado_em IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.corretores WHERE id=s.corretor_id AND user_id=s.user_id AND status='ativo')
    OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=s.user_id
      AND role IN ('admin','super_admin') AND revogado_em IS NULL) THEN
    RAISE EXCEPTION 'Atendimento encerrado ou acesso revogado.' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('access_token',access_token)
    INTO tokens FROM suporte_privado.credenciais WHERE sessao_id=s.id;
  RETURN to_jsonb(s)||tokens;
END $$;

CREATE FUNCTION public.suporte_encerrar_sessao(p_sessao UUID,p_ator UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.admin_sessoes_suporte; token TEXT;
BEGIN
  SELECT * INTO s FROM public.admin_sessoes_suporte WHERE id=p_sessao AND ator_user_id=p_ator FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  SELECT access_token INTO token FROM suporte_privado.credenciais WHERE sessao_id=s.id;
  IF s.encerrado_em IS NULL THEN
    UPDATE public.admin_sessoes_suporte SET encerrado_em=now() WHERE id=s.id;
    DELETE FROM suporte_privado.credenciais WHERE sessao_id=s.id;
    INSERT INTO public.admin_auditoria(ator_user_id,acao,entidade,entidade_id,dados_depois)
      VALUES(p_ator,'suporte_encerrado','corretores',s.corretor_id::TEXT,jsonb_build_object('sessao_id',s.id));
  END IF;
  RETURN token;
END $$;

-- RLS existente decide o escopo do cliente; registramos ator real e campos,
-- sem copiar o conteudo pessoal dos registros para a auditoria.
CREATE FUNCTION public.auditar_mutacao_suporte()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.admin_sessoes_suporte; antes JSONB; depois JSONB; campos JSONB;
BEGIN
  SELECT * INTO s FROM public.admin_sessoes_suporte
    WHERE auth_session_id=NULLIF(auth.jwt()->>'session_id','')::UUID;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF s.user_id <> auth.uid() OR s.encerrado_em IS NOT NULL OR s.expira_em<=now() THEN
    RAISE EXCEPTION 'Atendimento expirado.' USING ERRCODE='42501';
  END IF;
  antes := CASE WHEN TG_OP='INSERT' THEN '{}'::JSONB ELSE to_jsonb(OLD) END;
  depois := CASE WHEN TG_OP='DELETE' THEN '{}'::JSONB ELSE to_jsonb(NEW) END;
  SELECT COALESCE(jsonb_agg(k),'[]'::JSONB) INTO campos FROM
    (SELECT key k FROM jsonb_each(antes||depois)) ch WHERE antes->k IS DISTINCT FROM depois->k;
  INSERT INTO public.admin_auditoria(ator_user_id,acao,entidade,entidade_id,dados_depois,motivo)
    VALUES(s.ator_user_id,'suporte_'||lower(TG_OP),TG_TABLE_NAME,
      COALESCE(depois->>'id',antes->>'id'),
      jsonb_build_object('sessao_id',s.id,'corretor_id',s.corretor_id,'campos',campos),'Atendimento pelo backoffice');
  RETURN NULL;
END $$;
DO $$ DECLARE t RECORD; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename NOT IN ('admin_auditoria','admin_sessoes_suporte') LOOP
    EXECUTE format('CREATE TRIGGER auditar_suporte AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auditar_mutacao_suporte()',t.tablename);
  END LOOP;
END $$;

CREATE FUNCTION public.admin_opcoes_parceiros()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome,id),'[]'::JSONB) FROM public.parceiros);
END $$;

CREATE FUNCTION public.admin_listar_atendimento(
  p_busca TEXT DEFAULT NULL, p_status TEXT DEFAULT NULL, p_parceiro_id UUID DEFAULT NULL,
  p_origem_direta BOOLEAN DEFAULT FALSE, p_campanha TEXT DEFAULT NULL, p_limite INT DEFAULT 25, p_offset INT DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE itens JSONB; total BIGINT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'acesso negado' USING ERRCODE='42501'; END IF;
  WITH filtrados AS MATERIALIZED (
    SELECT c.id corretor_id,c.nome,c.email,c.status,c.created_at criado_em,c.ultimo_acesso_em,
      pa.parceiro_id,p.nome parceiro_nome,l.campanha,pa.visitante_id,
      pa.primeiro_clique_em,pa.link_id,c.user_id
    FROM public.corretores c
    LEFT JOIN public.parceiro_atribuicoes pa ON pa.corretor_id=c.id AND pa.status='convertida'
    LEFT JOIN public.parceiros p ON p.id=pa.parceiro_id
    LEFT JOIN public.parceiro_links l ON l.id=pa.link_id
    WHERE (NULLIF(btrim(p_busca),'') IS NULL OR c.nome ILIKE '%'||btrim(p_busca)||'%' OR c.email ILIKE '%'||btrim(p_busca)||'%')
      AND (p_status IS NULL OR c.status=p_status)
      AND (p_parceiro_id IS NULL OR pa.parceiro_id=p_parceiro_id)
      AND (NOT COALESCE(p_origem_direta,FALSE) OR pa.id IS NULL)
      AND (NULLIF(btrim(p_campanha),'') IS NULL OR l.campanha ILIKE '%'||btrim(p_campanha)||'%')
  ), pagina AS (
    SELECT * FROM filtrados ORDER BY criado_em DESC,corretor_id
      LIMIT LEAST(GREATEST(COALESCE(p_limite,25),1),100) OFFSET GREATEST(COALESCE(p_offset,0),0)
  )
  SELECT (SELECT count(*) FROM filtrados), COALESCE((
    SELECT jsonb_agg(to_jsonb(x)-'visitante_id'-'user_id' ORDER BY criado_em DESC,corretor_id) FROM (
      SELECT pg.*,pl.name plano_nome,s.status assinatura_status,
        (SELECT count(*) FROM public.parceiro_cliques cl WHERE cl.visitante_id=pg.visitante_id AND cl.parceiro_id=pg.parceiro_id) total_cliques,
        (SELECT COALESCE(sum(r.valor_bruto),0) FROM public.receita_eventos r WHERE r.corretor_id=pg.corretor_id AND r.status='confirmado') receita_confirmada,
        op.completed_at onboarding_concluido_em,op.current_step onboarding_etapa
      FROM pagina pg
      LEFT JOIN LATERAL (SELECT sub.status::TEXT status,sub.plan_id FROM public.subscriptions sub WHERE sub.corretor_id=pg.corretor_id
        ORDER BY CASE WHEN sub.status IN ('trialing','active','past_due') THEN 0 ELSE 1 END,sub.created_at DESC,sub.id LIMIT 1) s ON TRUE
      LEFT JOIN public.plans pl ON pl.id=s.plan_id
      LEFT JOIN public.onboarding_profiles pr ON pr.user_id=pg.user_id
      LEFT JOIN public.onboarding_progress op ON op.profile_id=pr.id
    ) x
  ),'[]'::JSONB) INTO total,itens;
  RETURN jsonb_build_object('itens',itens,'total',total);
END $$;

REVOKE ALL ON FUNCTION public.admin_preparar_suporte(UUID),public.admin_opcoes_parceiros(),
  public.admin_listar_atendimento(TEXT,TEXT,UUID,BOOLEAN,TEXT,INT,INT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_preparar_suporte(UUID),public.admin_opcoes_parceiros(),
  public.admin_listar_atendimento(TEXT,TEXT,UUID,BOOLEAN,TEXT,INT,INT) TO authenticated;
REVOKE ALL ON FUNCTION public.suporte_criar_sessao(UUID,UUID,UUID,TEXT),
  public.suporte_obter_credenciais(UUID,UUID),public.suporte_encerrar_sessao(UUID,UUID),
  public.auditar_mutacao_suporte() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suporte_criar_sessao(UUID,UUID,UUID,TEXT),
  public.suporte_obter_credenciais(UUID,UUID),public.suporte_encerrar_sessao(UUID,UUID) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
