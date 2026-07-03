-- ============================================================
-- Fachada Inteligente com QR Code — Migração Supabase
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- 1. Tabela de fachadas
CREATE TABLE IF NOT EXISTS public.fachadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corretor_id uuid NOT NULL REFERENCES public.corretores(id) ON DELETE CASCADE,
  imovel_id uuid NOT NULL REFERENCES public.imoveis(id) ON DELETE CASCADE,
  tipo_negocio text NOT NULL DEFAULT 'VENDA'
    CHECK (tipo_negocio IN ('VENDA', 'ALUGUEL', 'TEMPORADA', 'LANCAMENTO')),
  template_id text NOT NULL DEFAULT 'venda-classica',
  cta_principal text NOT NULL DEFAULT 'WHATSAPP'
    CHECK (cta_principal IN ('AGENDAR_VISITA', 'WHATSAPP', 'SOLICITAR_INFO', 'FAZER_PROPOSTA')),
  modo_conversao boolean NOT NULL DEFAULT false,
  mensagem_whatsapp text,
  logo_url text,
  foto_principal_url text,
  ativo boolean NOT NULL DEFAULT true,
  total_escaneamentos integer NOT NULL DEFAULT 0,
  total_leads integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Tabela de escaneamentos
CREATE TABLE IF NOT EXISTS public.fachada_escaneamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fachada_id uuid NOT NULL REFERENCES public.fachadas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip_hash text
);

-- 3. Tabela de leads
CREATE TABLE IF NOT EXISTS public.fachada_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fachada_id uuid NOT NULL REFERENCES public.fachadas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  telefone text NOT NULL,
  email text,
  convertido boolean NOT NULL DEFAULT false,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Tabela de templates personalizados
CREATE TABLE IF NOT EXISTS public.fachada_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corretor_id uuid REFERENCES public.corretores(id) ON DELETE CASCADE,
  nome text NOT NULL,
  categoria text NOT NULL DEFAULT 'VENDA'
    CHECK (categoria IN ('VENDA', 'ALUGUEL', 'ALTO_PADRAO', 'COMERCIAL', 'RURAL', 'LANCAMENTO')),
  config jsonb NOT NULL DEFAULT '{}',
  padrao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_fachadas_corretor ON public.fachadas(corretor_id);
CREATE INDEX IF NOT EXISTS idx_fachadas_imovel ON public.fachadas(imovel_id);
CREATE INDEX IF NOT EXISTS idx_fachada_escaneamentos_fachada ON public.fachada_escaneamentos(fachada_id);
CREATE INDEX IF NOT EXISTS idx_fachada_escaneamentos_created ON public.fachada_escaneamentos(created_at);
CREATE INDEX IF NOT EXISTS idx_fachada_leads_fachada ON public.fachada_leads(fachada_id);
CREATE INDEX IF NOT EXISTS idx_fachada_leads_created ON public.fachada_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_fachada_templates_corretor ON public.fachada_templates(corretor_id);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

-- Fachadas: corretor vê apenas as suas
ALTER TABLE public.fachadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corretor vê suas fachadas"
  ON public.fachadas FOR SELECT
  USING (corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid()));

CREATE POLICY "Corretor cria fachadas"
  ON public.fachadas FOR INSERT
  WITH CHECK (corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid()));

CREATE POLICY "Corretor atualiza suas fachadas"
  ON public.fachadas FOR UPDATE
  USING (corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid()));

CREATE POLICY "Corretor deleta suas fachadas"
  ON public.fachadas FOR DELETE
  USING (corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid()));

-- Leitura pública de fachadas ativas (para QR Code landing page)
CREATE POLICY "Publico ve fachadas ativas"
  ON public.fachadas FOR SELECT
  USING (ativo = true);

-- Escaneamentos: inserção pública, leitura pelo corretor
ALTER TABLE public.fachada_escaneamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Publico registra escaneamento"
  ON public.fachada_escaneamentos FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Corretor ve escaneamentos"
  ON public.fachada_escaneamentos FOR SELECT
  USING (
    fachada_id IN (
      SELECT id FROM public.fachadas
      WHERE corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid())
    )
  );

-- Leads: inserção pública, leitura pelo corretor
ALTER TABLE public.fachada_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Publico cria lead"
  ON public.fachada_leads FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Corretor ve leads"
  ON public.fachada_leads FOR SELECT
  USING (
    fachada_id IN (
      SELECT id FROM public.fachadas
      WHERE corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid())
    )
  );

-- Templates: corretor vê os seus + templates sem dono (padrão do sistema)
ALTER TABLE public.fachada_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corretor ve templates"
  ON public.fachada_templates FOR SELECT
  USING (
    corretor_id IS NULL
    OR corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid())
  );

CREATE POLICY "Corretor cria templates"
  ON public.fachada_templates FOR INSERT
  WITH CHECK (corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid()));

CREATE POLICY "Corretor atualiza templates"
  ON public.fachada_templates FOR UPDATE
  USING (corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid()));

CREATE POLICY "Corretor deleta templates"
  ON public.fachada_templates FOR DELETE
  USING (corretor_id IN (SELECT id FROM public.corretores WHERE user_id = auth.uid()));

-- ============================================================
-- Trigger: incrementar contadores automaticamente
-- ============================================================

-- Incrementar total_escaneamentos
CREATE OR REPLACE FUNCTION public.increment_escaneamentos()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.fachadas
  SET total_escaneamentos = total_escaneamentos + 1
  WHERE id = NEW.fachada_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_increment_escaneamentos
  AFTER INSERT ON public.fachada_escaneamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_escaneamentos();

-- Incrementar total_leads
CREATE OR REPLACE FUNCTION public.increment_leads()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.fachadas
  SET total_leads = total_leads + 1
  WHERE id = NEW.fachada_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_increment_leads
  AFTER INSERT ON public.fachada_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_leads();

-- ============================================================
-- NOTA: NÃO adicionar policies nas tabelas existentes
-- (imoveis, imovel_fotos, corretores) — elas já têm suas
-- próprias policies de RLS configuradas.
-- A landing page pública (/p/:id) fará fetch via RPC ou
-- join direto com a tabela fachadas que já tem policy pública.
-- ============================================================
