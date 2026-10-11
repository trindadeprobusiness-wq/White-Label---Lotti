-- Central Comercial (prospecção, vendas e caixa, roteiros), agora no banco da Lotti e servida pela API,
-- dentro do back office. Mesmo SQL das migrations do Supabase (supabase/migrations/20261008120000/130000/140000).
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
-- Fase 2 da Central Comercial: vendas, execução e caixa por usuário.
CREATE TABLE IF NOT EXISTS public.central_comercial_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.central_comercial_leads(id) ON DELETE RESTRICT,
  valor_contratado numeric(12,2) NOT NULL CHECK (valor_contratado > 0),
  data_fechamento date NOT NULL DEFAULT CURRENT_DATE,
  percentual_entrada numeric(5,2) NOT NULL DEFAULT 50 CHECK (percentual_entrada BETWEEN 0 AND 100),
  prazo_recebimento_dias integer NOT NULL DEFAULT 0 CHECK (prazo_recebimento_dias BETWEEN 0 AND 3650),
  status_producao text NOT NULL DEFAULT 'contrato_fechado'
    CHECK (status_producao IN ('contrato_fechado','entrada_pendente','entrada_recebida','materiais_solicitados','materiais_recebidos','em_desenvolvimento','aguardando_aprovacao','revisoes','publicado','entregue','saldo_recebido')),
  prazo_entrega date,
  link_demonstracao text,
  link_final text,
  pendencias text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id)
);
CREATE INDEX IF NOT EXISTS central_comercial_vendas_owner_data_idx ON public.central_comercial_vendas(owner_id,data_fechamento DESC);
ALTER TABLE public.central_comercial_vendas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS central_comercial_vendas_owner_all ON public.central_comercial_vendas;
CREATE POLICY central_comercial_vendas_owner_all ON public.central_comercial_vendas FOR ALL TO authenticated
  USING (owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.central_comercial_leads l WHERE l.id=lead_id AND l.owner_id=auth.uid()))
  WITH CHECK (owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.central_comercial_leads l WHERE l.id=lead_id AND l.owner_id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.central_comercial_vendas TO authenticated;

CREATE TABLE IF NOT EXISTS public.central_comercial_recebimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venda_id uuid NOT NULL REFERENCES public.central_comercial_vendas(id) ON DELETE CASCADE,
  valor numeric(12,2) NOT NULL CHECK (valor > 0),
  data_prevista date,
  data_recebida date,
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS central_comercial_receb_owner_due_idx ON public.central_comercial_recebimentos(owner_id,data_prevista);
ALTER TABLE public.central_comercial_recebimentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS central_comercial_recebimentos_owner_all ON public.central_comercial_recebimentos;
CREATE POLICY central_comercial_recebimentos_owner_all ON public.central_comercial_recebimentos FOR ALL TO authenticated
  USING (owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.central_comercial_vendas v WHERE v.id=venda_id AND v.owner_id=auth.uid()))
  WITH CHECK (owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.central_comercial_vendas v WHERE v.id=venda_id AND v.owner_id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.central_comercial_recebimentos TO authenticated;

CREATE TABLE IF NOT EXISTS public.central_comercial_despesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  descricao text NOT NULL CHECK(length(trim(descricao)) BETWEEN 1 AND 180),
  categoria text NOT NULL CHECK(categoria IN ('ferramentas','prospeccao','dominio_hospedagem','producao','tributos','outros')),
  valor numeric(12,2) NOT NULL CHECK(valor > 0),
  data_competencia date NOT NULL DEFAULT CURRENT_DATE,
  data_pagamento date,
  venda_id uuid REFERENCES public.central_comercial_vendas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS central_comercial_despesas_owner_data_idx ON public.central_comercial_despesas(owner_id,data_competencia DESC);
ALTER TABLE public.central_comercial_despesas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS central_comercial_despesas_owner_all ON public.central_comercial_despesas;
CREATE POLICY central_comercial_despesas_owner_all ON public.central_comercial_despesas FOR ALL TO authenticated
  USING (owner_id=auth.uid()) WITH CHECK (owner_id=auth.uid() AND (venda_id IS NULL OR EXISTS(SELECT 1 FROM public.central_comercial_vendas v WHERE v.id=venda_id AND v.owner_id=auth.uid())));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.central_comercial_despesas TO authenticated;

CREATE TABLE IF NOT EXISTS public.central_comercial_projecao_config (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ligacoes_dia integer NOT NULL DEFAULT 30 CHECK(ligacoes_dia BETWEEN 0 AND 10000),
  dias_uteis integer NOT NULL DEFAULT 22 CHECK(dias_uteis BETWEEN 1 AND 31),
  taxa_atendimento numeric(5,2) NOT NULL DEFAULT 35 CHECK(taxa_atendimento BETWEEN 0 AND 100),
  taxa_decisor numeric(5,2) NOT NULL DEFAULT 50 CHECK(taxa_decisor BETWEEN 0 AND 100),
  taxa_autorizacao numeric(5,2) NOT NULL DEFAULT 30 CHECK(taxa_autorizacao BETWEEN 0 AND 100),
  taxa_proposta numeric(5,2) NOT NULL DEFAULT 60 CHECK(taxa_proposta BETWEEN 0 AND 100),
  taxa_fechamento numeric(5,2) NOT NULL DEFAULT 25 CHECK(taxa_fechamento BETWEEN 0 AND 100),
  ticket_medio numeric(12,2) NOT NULL DEFAULT 800 CHECK(ticket_medio > 0),
  percentual_entrada numeric(5,2) NOT NULL DEFAULT 50 CHECK(percentual_entrada BETWEEN 0 AND 100),
  prazo_recebimento_dias integer NOT NULL DEFAULT 15 CHECK(prazo_recebimento_dias BETWEEN 0 AND 3650),
  custo_operacional numeric(12,2) NOT NULL DEFAULT 0 CHECK(custo_operacional >= 0),
  meta_mensal numeric(12,2) NOT NULL DEFAULT 10000 CHECK(meta_mensal >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.central_comercial_projecao_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS central_comercial_projecao_owner_all ON public.central_comercial_projecao_config;
CREATE POLICY central_comercial_projecao_owner_all ON public.central_comercial_projecao_config FOR ALL TO authenticated
  USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.central_comercial_projecao_config TO authenticated;
-- Fase 3: roteiros versionados e atribuição manual por ligação para comparação.
CREATE TABLE IF NOT EXISTS public.central_comercial_roteiros (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 nome text NOT NULL CHECK(length(trim(nome)) BETWEEN 1 AND 100),
 versao text NOT NULL DEFAULT 'A',
 texto text NOT NULL CHECK(length(trim(texto)) BETWEEN 1 AND 5000),
 ativo boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,nome,versao)
);
ALTER TABLE public.central_comercial_roteiros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS central_comercial_roteiros_owner_all ON public.central_comercial_roteiros;
CREATE POLICY central_comercial_roteiros_owner_all ON public.central_comercial_roteiros FOR ALL TO authenticated
 USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.central_comercial_roteiros TO authenticated;

ALTER TABLE public.central_comercial_interacoes
 ADD COLUMN IF NOT EXISTS roteiro_id uuid REFERENCES public.central_comercial_roteiros(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS central_comercial_interacoes_roteiro_idx ON public.central_comercial_interacoes(roteiro_id,ocorreu_em DESC);
DROP POLICY IF EXISTS central_comercial_interacoes_owner_all ON public.central_comercial_interacoes;
CREATE POLICY central_comercial_interacoes_owner_all ON public.central_comercial_interacoes FOR ALL TO authenticated
 USING(owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.central_comercial_leads l WHERE l.id=lead_id AND l.owner_id=auth.uid()))
 WITH CHECK(owner_id=auth.uid()
   AND EXISTS(SELECT 1 FROM public.central_comercial_leads l WHERE l.id=lead_id AND l.owner_id=auth.uid())
   AND (roteiro_id IS NULL OR EXISTS(SELECT 1 FROM public.central_comercial_roteiros r WHERE r.id=roteiro_id AND r.owner_id=auth.uid())));
