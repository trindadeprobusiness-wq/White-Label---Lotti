-- Login próprio da API (saída gradual do Supabase Auth).
--
-- Nasce VAZIA: o preenchimento (copiar id, email e o bcrypt de auth.users, com o
-- id PRESERVADO para claims.sub/RLS seguirem iguais) é um passo da virada, feito
-- por script depois de aplicar esta migration — NÃO aqui.
--
-- RLS habilitada sem policy pública nas duas tabelas: só o dono (a conexão da
-- API) enxerga e escreve; os papéis `authenticated`/`anon` não leem nem gravam
-- uma linha sequer. O login acontece antes de qualquer contexto de tenant.

-- ── public.usuarios ─────────────────────────────────────────────────────────
-- id = auth.users.id (o MESMO usado como claims.sub). Sem DEFAULT: o id é sempre
-- copiado de auth.users na virada, nunca gerado aqui.
create table public.usuarios (
  id uuid not null,
  email text not null,
  -- bcrypt ($2...). NULL = conta sem senha (a 3ª conta: só OAuth/recuperação).
  password_hash text,
  status text not null default 'ativo',
  -- Versão de sessão: a troca de senha a incrementa e derruba refresh tokens antigos.
  session_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usuarios_pkey primary key (id),
  constraint chk_usuarios_status check (status = any (array['ativo'::text, 'suspenso'::text, 'inativo'::text]))
);

-- E-mail único por forma normalizada (lower/trim): o login procura por lower(btrim(email)).
create unique index usuarios_email_normalizado_key on public.usuarios (lower(btrim(email)));

alter table public.usuarios enable row level security;

-- ── public.auth_refresh_tokens ──────────────────────────────────────────────
-- Guarda só o SHA-256 do refresh (token_hash), nunca o token cru. Rotação por
-- uso (used_at), revogação por família (family_id/revoked_at), e session_version
-- da emissão para a troca de senha invalidar a família.
create table public.auth_refresh_tokens (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  family_id uuid not null,
  token_hash text not null,
  session_version integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_refresh_tokens_pkey primary key (id),
  constraint auth_refresh_tokens_user_id_fkey foreign key (user_id)
    references public.usuarios(id) on delete cascade
);

create unique index auth_refresh_tokens_token_hash_key on public.auth_refresh_tokens (token_hash);
create index auth_refresh_tokens_family_id_idx on public.auth_refresh_tokens (family_id);
create index auth_refresh_tokens_user_id_idx on public.auth_refresh_tokens (user_id);

alter table public.auth_refresh_tokens enable row level security;

-- Sem GRANT para authenticated/anon de propósito: estas tabelas são da API, não
-- do PostgREST. Os default privileges já não dão escrita a anon (migration
-- 20261005140000); leitura pública também não é concedida aqui.
