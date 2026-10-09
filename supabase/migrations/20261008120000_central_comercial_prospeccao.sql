-- Central Comercial — prospeccao manual de sites.
-- Registros pertencem ao usuario autenticado; nenhuma acao automatica de contato.
CREATE TABLE IF NOT EXISTS public.central_comercial_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_empresa text NOT NULL CHECK (length(trim(nome_empresa)) BETWEEN 1 AND 180),
  segmento text,
  cidade text,
  bairro text,
  telefone text,
  telefone_normalizado text,
  site text,
  verificacao_site text NOT NULL DEFAULT 'nao_informado'
    CHECK (verificacao_site IN ('nao_informado','presente','ausencia_confirmada')),
  rede_social text,
  nota_avaliacoes numeric(3,2) CHECK (nota_avaliacoes IS NULL OR nota_avaliacoes BETWEEN 0 AND 5),
  quantidade_avaliacoes integer CHECK (quantidade_avaliacoes IS NULL OR quantidade_avaliacoes >= 0),
  link_origem text,
  data_importacao timestamptz NOT NULL DEFAULT now(),
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  justificativa_score text,
  observacoes text,
  responsavel text,
  status_contato text NOT NULL DEFAULT 'novo'
    CHECK (status_contato IN ('novo','qualificado','ligacao_pendente','contato_realizado','retorno_agendado','demonstracao_autorizada','demonstracao_enviada','proposta_enviada','fechado_ganho','fechado_perdido','nao_contatar')),
  proxima_acao text,
  proxima_acao_em timestamptz,
  fila_pausada_ate timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS central_comercial_leads_owner_status_idx
  ON public.central_comercial_leads(owner_id, status_contato, proxima_acao_em);
CREATE INDEX IF NOT EXISTS central_comercial_leads_owner_phone_idx
  ON public.central_comercial_leads(owner_id, telefone_normalizado);
ALTER TABLE public.central_comercial_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS central_comercial_leads_owner_all ON public.central_comercial_leads;
CREATE POLICY central_comercial_leads_owner_all ON public.central_comercial_leads
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.central_comercial_leads TO authenticated;

CREATE TABLE IF NOT EXISTS public.central_comercial_interacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.central_comercial_leads(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('ligacao','demonstracao','proposta','nota')),
  resultado text CHECK (resultado IS NULL OR resultado IN ('nao_atendeu','numero_invalido','nao_responsavel','sem_interesse','retorno_solicitado','interessado','autorizou_whatsapp','demonstracao_enviada','proposta_enviada','venda_fechada','nao_contatar')),
  observacoes text,
  ocorreu_em timestamptz NOT NULL DEFAULT now(),
  proxima_acao text,
  proxima_acao_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT central_comercial_interacao_id_owner_unique UNIQUE(id, owner_id)
);
CREATE INDEX IF NOT EXISTS central_comercial_interacoes_owner_time_idx
  ON public.central_comercial_interacoes(owner_id, ocorreu_em DESC);
CREATE INDEX IF NOT EXISTS central_comercial_interacoes_lead_time_idx
  ON public.central_comercial_interacoes(lead_id, ocorreu_em DESC);
ALTER TABLE public.central_comercial_interacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS central_comercial_interacoes_owner_all ON public.central_comercial_interacoes;
CREATE POLICY central_comercial_interacoes_owner_all ON public.central_comercial_interacoes
  FOR ALL TO authenticated USING (
    owner_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.central_comercial_leads l
      WHERE l.id = lead_id AND l.owner_id = auth.uid()
    )
  ) WITH CHECK (
    owner_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.central_comercial_leads l
      WHERE l.id = lead_id AND l.owner_id = auth.uid()
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON public.central_comercial_interacoes TO authenticated;
