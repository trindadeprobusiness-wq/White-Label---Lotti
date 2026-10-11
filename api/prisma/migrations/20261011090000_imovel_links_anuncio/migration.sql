-- Links do anúncio do imóvel nos portais (OLX, ImovelWeb, Zap...), para o Assistente IA e a equipe.
ALTER TABLE public.imoveis ADD COLUMN IF NOT EXISTS links_anuncio text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.imoveis ADD CONSTRAINT imoveis_links_anuncio_limite CHECK (cardinality(links_anuncio) <= 10);
