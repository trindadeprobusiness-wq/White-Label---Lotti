-- Adiciona a coluna `suites` (nº de suítes) à tabela imoveis.
-- Aplicada em produção em 2026-07-27.
--
-- Causa do bug: o commit 5040701 adicionou o campo "Suítes" ao formulário
-- (NovoImovelDialog) e ao type do frontend, e o Salvar já enviava `suites` — mas
-- a coluna nunca foi criada no banco. Resultado: PostgREST rejeitava todo save
-- com "Could not find the 'suites' column of 'imoveis' in the schema cache".
--
-- integer nullable, igual às colunas irmãs (dormitorios, garagem).

ALTER TABLE public.imoveis
    ADD COLUMN IF NOT EXISTS suites integer;

-- Recarrega o schema cache do PostgREST para a coluna aparecer imediatamente
-- (sem precisar redeploy nem esperar o watch).
NOTIFY pgrst, 'reload schema';
