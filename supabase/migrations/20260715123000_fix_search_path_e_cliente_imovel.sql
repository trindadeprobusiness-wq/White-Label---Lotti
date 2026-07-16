-- ============================================================================
-- Correções da auditoria de segurança — P2
-- ============================================================================

-- 1) SECURITY DEFINER sem search_path fixo (CWE-426).
-- Auditoria: pg_proc.proconfig = null nestas duas; as outras 5 funções SECURITY
-- DEFINER do projeto já usam SET search_path=public. Sem search_path fixo, a
-- resolução de nomes fica sujeita ao search_path do chamador.
ALTER FUNCTION public.increment_leads() SET search_path = public;
ALTER FUNCTION public.increment_escaneamentos() SET search_path = public;

-- 2) cliente_imovel: RLS estava LIGADO com ZERO policies -> negava tudo.
-- Efeito: o vínculo cliente<->imóvel ficava silenciosamente invisível no app
-- (o frontend lê `clientes` com embed `cliente_imovel(imovel_id)`), enquanto as
-- Edge Functions (service_role) continuavam escrevendo normalmente.
-- Escopo pelo dono do cliente, seguindo o padrão get_corretor_id() do projeto.
DROP POLICY IF EXISTS "Corretor gerencia vinculos cliente_imovel" ON public.cliente_imovel;
CREATE POLICY "Corretor gerencia vinculos cliente_imovel" ON public.cliente_imovel
  FOR ALL TO authenticated
  USING (
    cliente_id IN (SELECT id FROM public.clientes WHERE corretor_id = public.get_corretor_id())
  )
  WITH CHECK (
    cliente_id IN (SELECT id FROM public.clientes WHERE corretor_id = public.get_corretor_id())
  );
