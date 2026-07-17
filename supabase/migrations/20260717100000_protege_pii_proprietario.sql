-- ============================================================================
-- LGPD — Impede que o público (anon) leia PII dos proprietários
-- ============================================================================
-- PROBLEMA: a policy "Leitura pública de imóveis anunciados" libera as LINHAS
-- de imóveis anunciados para o papel `anon` (correto e intencional — é o
-- catálogo público). Mas RLS é row-level, não column-level: o `anon` tinha
-- privilégio de SELECT nas 29 COLUNAS, incluindo:
--     proprietario_nome, proprietario_cpf, proprietario_telefone, proprietario_email
-- Ou seja, qualquer um com a chave publishable (que é pública por design) podia
-- colher CPF/nome/telefone/e-mail dos proprietários dos imóveis anunciados.
--
-- Exposição medida antes do fix: 1 imóvel anunciado, com nome do proprietário
-- preenchido (CPF ainda vazio). Risco latente: o formulário já grava CPF.
--
-- SOLUÇÃO: privilégio por COLUNA. As linhas continuam liberadas pela RLS, mas o
-- `anon` só enxerga as colunas do catálogo. Nada quebra: os consumidores
-- públicos (Edge Functions public-imoveis e imovel-detalhe) usam SERVICE_ROLE e
-- já selecionavam exatamente estas colunas; nenhuma página pública lê a tabela
-- direto. O papel `authenticated` NÃO é afetado — o corretor continua vendo
-- tudo dos seus próprios imóveis (a RLS já o isola por corretor_id).
-- ============================================================================

REVOKE SELECT ON public.imoveis FROM anon;

GRANT SELECT (
  id,
  titulo,
  tipo,
  valor,
  area_m2,
  dormitorios,
  banheiros,
  garagem,
  endereco,
  bairro,
  cidade,
  estado,
  cep,
  descricao,
  descricao_curta,
  status_venda,
  finalidade,
  anunciado,
  ativo,
  created_at
) ON public.imoveis TO anon;

-- Colunas deliberadamente NÃO concedidas ao anon:
--   proprietario_nome, proprietario_cpf, proprietario_telefone,
--   proprietario_email, proprietario_id  -> PII do proprietário (LGPD)
--   corretor_id, exclusividade_ate, tracking_data, updated_at -> dados internos
