-- O cadastro público usa CNPJ no lugar de CRECI. A coluna `creci` permanece
-- preenchida com PENDENTE por compatibilidade com o schema legado, enquanto o
-- documento informado pelo usuário passa a ser gravado em `cnpj_cpf`.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.corretores (
    user_id,
    nome,
    email,
    creci,
    telefone,
    cnpj_cpf
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'nome'), ''),
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data->>'creci'), ''), 'PENDENTE'),
    COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data->>'telefone'), ''), ''),
    NULLIF(BTRIM(NEW.raw_user_meta_data->>'cnpj'), '')
  );

  RETURN NEW;
END;
$$;

-- Cobre contas criadas depois do deploy do frontend e antes da aplicação
-- desta migration, sem substituir documentos que já tenham sido confirmados.
UPDATE public.corretores AS c
SET cnpj_cpf = NULLIF(BTRIM(u.raw_user_meta_data->>'cnpj'), '')
FROM auth.users AS u
WHERE c.user_id = u.id
  AND NULLIF(BTRIM(c.cnpj_cpf), '') IS NULL
  AND NULLIF(BTRIM(u.raw_user_meta_data->>'cnpj'), '') IS NOT NULL;
