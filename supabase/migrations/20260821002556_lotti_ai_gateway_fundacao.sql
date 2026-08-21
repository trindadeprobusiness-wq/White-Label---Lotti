-- Lotti AI Gateway — fundação de governança, isolamento e observabilidade.
-- O tenant atual da Lotti é `corretor_id`; ele representa organizationId até
-- existir uma entidade de organização/equipe própria.

BEGIN;

-- -------------------------------------------------------------------------
-- 1. Fecha acesso cruzado aos anexos. As policies antigas autorizavam qualquer
-- autenticado a inserir e ler qualquer objeto do bucket.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Corretor faz upload em ai-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Corretor lê seus uploads em ai-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Usuário insere seus anexos IA" ON storage.objects;
DROP POLICY IF EXISTS "Usuário lê seus anexos IA" ON storage.objects;
DROP POLICY IF EXISTS "Usuário atualiza seus anexos IA" ON storage.objects;
DROP POLICY IF EXISTS "Usuário exclui seus anexos IA" ON storage.objects;

CREATE POLICY "Usuário insere seus anexos IA"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ai-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

CREATE POLICY "Usuário lê seus anexos IA"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'ai-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

CREATE POLICY "Usuário atualiza seus anexos IA"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ai-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  )
  WITH CHECK (
    bucket_id = 'ai-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

CREATE POLICY "Usuário exclui seus anexos IA"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ai-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

-- O contador era gravável pelo próprio usuário, que podia zerá-lo. Agora só a
-- Edge Function (service_role) consome o limite por uma operação atômica.
DROP POLICY IF EXISTS "Corretor gerencia seu rate limit" ON public.ai_rate_limits;
REVOKE ALL ON TABLE public.ai_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consumir_rate_limit_ia(
  _corretor_id UUID,
  _limite INTEGER DEFAULT 30,
  _janela INTERVAL DEFAULT INTERVAL '1 minute'
)
RETURNS TABLE (
  permitido BOOLEAN,
  restante INTEGER,
  reinicia_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agora TIMESTAMPTZ := clock_timestamp();
  v_registro public.ai_rate_limits%ROWTYPE;
BEGIN
  IF _corretor_id IS NULL OR _limite < 1 OR _janela <= INTERVAL '0 seconds' THEN
    RAISE EXCEPTION 'Parâmetros de rate limit inválidos';
  END IF;

  INSERT INTO public.ai_rate_limits AS r (corretor_id, message_count, window_start)
  VALUES (_corretor_id, 1, v_agora)
  ON CONFLICT (corretor_id) DO UPDATE
    SET message_count = CASE
          WHEN r.window_start <= v_agora - _janela THEN 1
          ELSE r.message_count + 1
        END,
        window_start = CASE
          WHEN r.window_start <= v_agora - _janela THEN v_agora
          ELSE r.window_start
        END
  RETURNING * INTO v_registro;

  RETURN QUERY SELECT
    v_registro.message_count <= _limite,
    GREATEST(_limite - v_registro.message_count, 0),
    v_registro.window_start + _janela;
END;
$$;

REVOKE ALL ON FUNCTION public.consumir_rate_limit_ia(UUID, INTEGER, INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumir_rate_limit_ia(UUID, INTEGER, INTERVAL)
  TO service_role;

ALTER TABLE public.ai_conversations
  ALTER COLUMN model SET DEFAULT 'gemini-2.5-flash';

-- -------------------------------------------------------------------------
-- 2. Registro de prompts: guarda versão e checksum, não o system prompt.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_prompt_versions (
  id TEXT PRIMARY KEY,
  prompt_key TEXT NOT NULL,
  version TEXT NOT NULL,
  module TEXT NOT NULL,
  checksum TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prompt_key, version)
);

ALTER TABLE public.ai_prompt_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_prompt_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_prompt_versions TO service_role;

INSERT INTO public.ai_prompt_versions (id, prompt_key, version, module)
VALUES
  ('lotti-core@2026-08-20.1', 'lotti-core', '2026-08-20.1', 'core'),
  ('assistant.general@2026-08-20.1', 'assistant.general', '2026-08-20.1', 'assistant'),
  ('rentals.whatsapp@2026-08-20.1', 'rentals.whatsapp', '2026-08-20.1', 'rentals'),
  ('media.photo-enhancement@2026-08-20.1', 'media.photo-enhancement', '2026-08-20.1', 'media'),
  ('properties.photo-classification@2026-08-20.1', 'properties.photo-classification', '2026-08-20.1', 'properties'),
  ('contracts.extraction@2026-08-20.1', 'contracts.extraction', '2026-08-20.1', 'contracts'),
  ('contracts.generation@2026-08-20.1', 'contracts.generation', '2026-08-20.1', 'contracts')
ON CONFLICT (id) DO UPDATE SET
  active = EXCLUDED.active,
  module = EXCLUDED.module;

-- -------------------------------------------------------------------------
-- 3. Observabilidade sem conteúdo sensível integral.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL UNIQUE,
  corretor_id UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  module TEXT NOT NULL,
  intent TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  model TEXT NOT NULL,
  prompt_version_id TEXT REFERENCES public.ai_prompt_versions(id),
  output_mode TEXT NOT NULL CHECK (output_mode IN ('text', 'structured', 'action_proposal')),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'blocked')),
  input_chars INTEGER NOT NULL DEFAULT 0 CHECK (input_chars >= 0),
  output_chars INTEGER NOT NULL DEFAULT 0 CHECK (output_chars >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_cost_usd NUMERIC(14, 8) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  confirmation_required BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_tenant_created
  ON public.ai_runs (corretor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_user_created
  ON public.ai_runs (user_id, created_at DESC);

ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuário lê suas execuções IA" ON public.ai_runs;
CREATE POLICY "Usuário lê suas execuções IA"
  ON public.ai_runs FOR SELECT TO authenticated
  USING (
    corretor_id = public.get_corretor_id()
    AND user_id = (SELECT auth.uid())
  );
REVOKE ALL ON TABLE public.ai_runs FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.ai_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_runs TO service_role;

CREATE TABLE IF NOT EXISTS public.ai_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_kind TEXT NOT NULL CHECK (tool_kind IN ('read', 'proposal', 'write')),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'blocked')),
  entity_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_run ON public.ai_tool_calls (run_id, created_at);
ALTER TABLE public.ai_tool_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuário lê ferramentas de suas execuções IA" ON public.ai_tool_calls;
CREATE POLICY "Usuário lê ferramentas de suas execuções IA"
  ON public.ai_tool_calls FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ai_runs r
    WHERE r.id = ai_tool_calls.run_id
      AND r.corretor_id = public.get_corretor_id()
      AND r.user_id = (SELECT auth.uid())
  ));
REVOKE ALL ON TABLE public.ai_tool_calls FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.ai_tool_calls TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_tool_calls TO service_role;

-- Feedback é a única observabilidade gravável pelo usuário e continua presa ao run.
CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  corretor_id UUID NOT NULL DEFAULT public.get_corretor_id()
    REFERENCES public.corretores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, user_id)
);

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuário gerencia seu feedback IA" ON public.ai_feedback;
CREATE POLICY "Usuário gerencia seu feedback IA"
  ON public.ai_feedback FOR ALL TO authenticated
  USING (corretor_id = public.get_corretor_id() AND user_id = (SELECT auth.uid()))
  WITH CHECK (
    corretor_id = public.get_corretor_id()
    AND user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.ai_runs r
      WHERE r.id = ai_feedback.run_id
        AND r.corretor_id = public.get_corretor_id()
        AND r.user_id = (SELECT auth.uid())
    )
  );
REVOKE ALL ON TABLE public.ai_feedback FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_feedback TO authenticated;
GRANT ALL ON TABLE public.ai_feedback TO service_role;

-- -------------------------------------------------------------------------
-- 4. Memória explícita e propostas persistidas. Inferências não confirmadas
-- podem expirar; ações não são executadas por update direto do navegador.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corretor_id UUID NOT NULL DEFAULT public.get_corretor_id()
    REFERENCES public.corretores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  value JSONB NOT NULL,
  source TEXT NOT NULL,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  confirmed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (corretor_id, user_id, memory_type)
);

ALTER TABLE public.ai_memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuário gerencia suas memórias IA" ON public.ai_memories;
CREATE POLICY "Usuário gerencia suas memórias IA"
  ON public.ai_memories FOR ALL TO authenticated
  USING (corretor_id = public.get_corretor_id() AND user_id = (SELECT auth.uid()))
  WITH CHECK (corretor_id = public.get_corretor_id() AND user_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.ai_memories FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_memories TO authenticated;
GRANT ALL ON TABLE public.ai_memories TO service_role;

CREATE TABLE IF NOT EXISTS public.ai_action_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.ai_runs(id) ON DELETE SET NULL,
  corretor_id UUID NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  entity_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
  preview JSONB NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'executed', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  confirmed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_action_proposals_user
  ON public.ai_action_proposals (corretor_id, user_id, created_at DESC);
ALTER TABLE public.ai_action_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuário lê suas propostas IA" ON public.ai_action_proposals;
CREATE POLICY "Usuário lê suas propostas IA"
  ON public.ai_action_proposals FOR SELECT TO authenticated
  USING (corretor_id = public.get_corretor_id() AND user_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.ai_action_proposals FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.ai_action_proposals TO authenticated;
GRANT ALL ON TABLE public.ai_action_proposals TO service_role;

COMMENT ON TABLE public.ai_runs IS
  'Execuções do Lotti AI Gateway. Não armazena prompt ou documento integral; erros ficam em error_code/metadata.';
COMMENT ON TABLE public.usage_counters IS
  'Também cumpre o papel de ai_usage_limits junto de plan_entitlements e checar_cota.';
COMMENT ON TABLE public.ai_action_proposals IS
  'Propostas mutáveis com confirmação e idempotência; execução deve ocorrer em Edge Function autorizada.';

COMMIT;
