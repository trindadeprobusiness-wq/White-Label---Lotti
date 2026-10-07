-- Links de senha do login próprio (substituem o convite e a recuperação do Supabase Auth).
--
-- O checkout do site cria a conta SEM senha (password_hash nulo) e devolve um link
-- `${LOTTI_APP_PASSWORD_SETUP_URL}?token=...`; POST /api/auth/definir-senha consome o
-- token, grava o bcrypt e incrementa session_version. A mesma tabela serve depois para a
-- recuperação de senha (finalidade 'recuperar_senha'), quando o e-mail existir.
--
-- Guarda só o SHA-256 do token (token_hash), nunca o token cru. Uso único (used_at),
-- validade curta (expires_at). Consumir um token invalida os outros abertos do usuário.
--
-- RLS habilitada sem policy, como usuarios e auth_refresh_tokens: só o dono (a conexão
-- da API) lê e escreve.
create table public.auth_password_tokens (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  token_hash text not null,
  finalidade text not null default 'definir_senha',
  -- Pedido do checkout que gerou o link (rastreio). Sem FK: o pedido é do site e pode sumir.
  checkout_order_id uuid,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_password_tokens_pkey primary key (id),
  constraint auth_password_tokens_user_id_fkey foreign key (user_id)
    references public.usuarios(id) on delete cascade,
  constraint chk_auth_password_tokens_finalidade
    check (finalidade = any (array['definir_senha'::text, 'recuperar_senha'::text]))
);

create unique index auth_password_tokens_token_hash_key on public.auth_password_tokens (token_hash);
create index auth_password_tokens_user_id_idx on public.auth_password_tokens (user_id);

alter table public.auth_password_tokens enable row level security;
