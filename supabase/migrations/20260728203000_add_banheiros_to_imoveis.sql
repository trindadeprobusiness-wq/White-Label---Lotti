-- Migration: Adiciona coluna banheiros na tabela imoveis

ALTER TABLE public.imoveis 
ADD COLUMN IF NOT EXISTS banheiros integer DEFAULT 0;

-- Comment for the column
COMMENT ON COLUMN public.imoveis.banheiros IS 'Número de banheiros do imóvel';
