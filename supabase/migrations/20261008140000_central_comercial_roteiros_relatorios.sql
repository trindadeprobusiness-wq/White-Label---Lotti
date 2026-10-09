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
