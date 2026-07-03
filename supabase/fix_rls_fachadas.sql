-- ============================================================
-- FIX: Remover as policies de fachadas que estão bloqueando
-- as tabelas imoveis, imovel_fotos e corretores
-- 
-- EXECUTE IMEDIATAMENTE no SQL Editor do Supabase
-- ============================================================

-- 1. Remover policy "Publico ve imoveis de fachadas" da tabela imoveis
-- Esta policy está impedindo a listagem de imóveis no CRM
DROP POLICY IF EXISTS "Publico ve imoveis de fachadas" ON public.imoveis;

-- 2. Remover policy "Publico ve fotos de fachadas" da tabela imovel_fotos
-- Esta policy está impedindo a exibição de fotos dos imóveis
DROP POLICY IF EXISTS "Publico ve fotos de fachadas" ON public.imovel_fotos;

-- 3. Remover policy "Publico ve corretores de fachadas" da tabela corretores
-- Esta policy está impedindo a leitura dos dados do corretor
DROP POLICY IF EXISTS "Publico ve corretores de fachadas" ON public.corretores;

-- ============================================================
-- Verificação: confirme que os dados voltaram
-- ============================================================
-- Descomente e rode para conferir:
-- SELECT count(*) as total_imoveis FROM public.imoveis;
-- SELECT count(*) as total_corretores FROM public.corretores;
-- SELECT count(*) as total_contratos FROM public.contratos;
