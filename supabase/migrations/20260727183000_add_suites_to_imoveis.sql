-- Add suites column to imoveis table
ALTER TABLE public.imoveis
ADD COLUMN IF NOT EXISTS suites INTEGER DEFAULT 0;
