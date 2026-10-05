# Contrato da API Lotti: login próprio (saída do Supabase Auth)

A parte mais sensível do projeto. Hoje **toda rota autenticada** confia no JWT do Supabase: o
`SupabaseAuthGuard` valida pelo JWKS (issuer `<supabaseUrl>/auth/v1`, audience `authenticated`) e grava
`request.claims = { sub, role, email, ... }`, que o `TenantDb` injeta em `request.jwt.claims` e que o RLS e
`get_corretor_id()` leem (`api/src/prisma/tenant-db.ts:21-28`). **Nada pode quebrar durante a transição.**

Este documento fixa o desenho para a API ganhar login próprio **sem** desligar o Supabase. Ele é o único
arquivo criado por esta fase. Molde de porte, formato de erro, tradutor e testes: os contratos da onda 2/3
(`2026-10-04-api-lotti-modulo2-contrato.md` §0.2–0.5, `2026-10-05-api-lotti-assinatura-contrato.md`).
Plano de referência: `C:/Users/rafae/lotti-inventarios/15-login-e-r2.md` (seção login).

**Fatos medidos na produção.** `auth.users` tem 3 contas; 2 têm senha com hash bcrypt (prefixo `$2`) e 1
não tem senha (entra só por OAuth/recuperação). O `id` de `auth.users` é o que o `TenantDb` usa como
`claims.sub` — e é ele que esta fase **preserva** byte a byte.

---

## 0. Invariantes (o que não pode mudar)

1. **`claims.sub` continua sendo o `auth.users.id`.** O access token próprio carrega `sub` igual ao id de
   `auth.users`. RLS, `get_corretor_id()` e o `TenantDb` seguem idênticos; não existe id novo.
2. **O guard nunca afrouxa.** Ele passa a aceitar **dois** tipos de token, cada um com verificação
   criptográfica completa e **issuer fixo**. Um token que falhe nas duas verificações é recusado como hoje.
   A validação do Supabase **não** é removida nesta fase.
3. **Sem `VITE_API_URL`, o front é idêntico a hoje**, byte a byte — segue 100% no `supabase.auth`.
4. **Nenhuma migration é aplicada.** O SQL das tabelas novas vive em §7, para rodar só na virada.
5. **A recuperação de senha e o convite ficam desabilitados** (resposta genérica 200, sem enviar nada e
   sem revelar existência de conta) enquanto o e-mail (Resend) não existir.
6. **Nenhum segredo é lido ou registrado** (só nomes de variável). Hash bcrypt nunca vai para log, resposta
   ou relatório.

### 0.1 Quem é dono de quê

| Frente | Arquivos |
|---|---|
| **API** | cria em `api/src/auth/`: `auth.module.ts` (classe `AuthModule`), `auth.controller.ts`, `auth.service.ts`, `auth.dto.ts`, `auth.erros.ts`, `usuarios.repo.ts`, `refresh-tokens.repo.ts`, `tokens.ts` (emissão/verificação do JWT próprio), `senha.ts` (bcrypt), `email/email.port.ts` + `email/resend.adapter.ts` (stub desligado). **Estende** `supabase-auth.guard.ts` para o modo duplo (único arquivo pré-existente de auth editado). Specs: `auth.service.spec.ts`, `auth.controller.spec.ts`, `tokens.spec.ts`, `supabase-auth.guard.spec.ts` (acrescenta casos). Cria `api/test/sql-real/auth.test.ts`. Edita `api/src/config/env.ts` para as variáveis novas. Liga `AuthModule` em `app.module.ts` (passo de integração, §8). |
| **Front** | cria `src/lib/api/auth.ts` (o `AuthClient`) e `src/lib/api/auth.test.ts`. Edita **somente** `src/hooks/useAuth.tsx` para rotear atrás de `apiDisponivel()`. |

**Não editar** (regra dura): `api/src/prisma/tenant-db.ts`, `api/prisma/*` (migrations são **criadas** novas,
nunca editadas), `api/test/sql-real/harness.ts`, `src/lib/api/http.ts`, `src/lib/api.ts`, `api/src/main.ts`,
nem arquivos de outros módulos. Nada de `prisma migrate/db push/db pull/migrate reset`. Nada de commit,
stash ou troca de branch. Nada contra Supabase, Railway ou rede nos testes.

---

## 1. Tabelas novas (migration criada, NÃO aplicada)

Uma migration nova em `api/prisma/migrations/<timestamp>_auth_login_proprio/migration.sql`. **A migration
não é aplicada nesta fase** — o SQL fica fixado em §7 e roda só na virada. As tabelas **nascem vazias**; o
preenchimento a partir de `auth.users` é o passo de virada (§9), feito por script, **não agora**.

### 1.1 `public.usuarios`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | **Igual** ao `auth.users.id`. Não gerado aqui; copiado na virada. |
| `email` | `text` NOT NULL | Normalizado (trim + lower). `UNIQUE` sobre a forma normalizada. |
| `password_hash` | `text` NULL | bcrypt (`$2...`). NULL = conta sem senha (só OAuth/recuperação). |
| `status` | `text` NOT NULL DEFAULT `'ativo'` | `ativo` \| `bloqueado`. Qualquer valor ≠ `ativo` barra o login. |
| `session_version` | `integer` NOT NULL DEFAULT `0` | Incrementar invalida todos os access tokens já emitidos (§4.3). |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

- `CREATE UNIQUE INDEX usuarios_email_key ON public.usuarios (lower(email));` — unicidade pela forma
  normalizada, não pelo texto cru.
- **RLS:** a tabela é acessada **apenas** pelo `AuthService` com conexão de serviço (sem `TenantDb`), porque
  o login acontece antes de existir sessão. `ENABLE ROW LEVEL SECURITY` + **nenhuma** policy para
  `anon`/`authenticated`: ninguém lê/escreve via PostgREST. O `GRANT` é só para o papel da aplicação.

### 1.2 `public.auth_refresh_tokens`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK DEFAULT `gen_random_uuid()` | |
| `user_id` | `uuid` NOT NULL | FK → `public.usuarios(id)` ON DELETE CASCADE. |
| `family_id` | `uuid` NOT NULL | Mesma família a cada rotação; revogar a família mata a cadeia. |
| `token_hash` | `text` NOT NULL | SHA-256 do refresh opaco. **O token cru nunca é persistido.** |
| `expires_at` | `timestamptz` NOT NULL | TTL do refresh (§4.2). |
| `used_at` | `timestamptz` NULL | Preenchido na rotação. Reuso de token já usado ⇒ revoga a família. |
| `revoked_at` | `timestamptz` NULL | Logout, reuso detectado ou troca de senha. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | |

- `CREATE UNIQUE INDEX auth_refresh_tokens_hash_key ON public.auth_refresh_tokens (token_hash);`
- `CREATE INDEX auth_refresh_tokens_family_idx ON public.auth_refresh_tokens (family_id);`
- RLS habilitada, sem policy pública (mesma razão de §1.1).

---

## 2. Variáveis de ambiente novas (`api/src/config/env.ts`)

Adicionar à `AppEnv` e a `loadEnv`, lendo de `process.env`. Segredo nunca é logado; só o nome.

| Variável | Obrigatória | Default | Papel |
|---|---|---|---|
| `AUTH_JWT_SECRET` | sim se login próprio ligado | — | Segredo HS256 que assina/verifica o access token próprio. Mín. 32 chars; faltando, as rotas de login respondem **503** (como `agentApiToken`/arquivos). |
| `AUTH_ACCESS_TTL` | não | `900` (15 min) | TTL do access token em segundos (10–15 min). |
| `AUTH_REFRESH_TTL` | não | `2592000` (30 dias) | TTL do refresh em segundos. |
| `AUTH_ISSUER` | não | `lotti-api` | `iss` do token próprio. **Nunca** igual a `<supabaseUrl>/auth/v1` (§3). |
| `AUTH_COOKIE_DOMAIN` | não | vazio | Domínio do cookie de refresh (ex. `.plataformalotti.com.br`). |
| `RESEND_API_KEY` | não | — | E-mail transacional. Faltando ⇒ recuperação/convite **off** (§6). |
| `EMAIL_FROM` | não | — | Remetente (ex. `nao-responda@mail.plataformalotti.com.br`). |
| `EMAIL_REPLY_TO` | não | — | |
| `EMAIL_DOMAIN` | não | — | Subdomínio verificado no Resend. |
| `PASSWORD_RESET_URL` | não | — | Base do link de nova senha (ex. `https://app.plataformalotti.com.br/nova-senha`). |

Regra de porte: `authLoginHabilitado = !!AUTH_JWT_SECRET` e `emailHabilitado = !!(RESEND_API_KEY &&
EMAIL_FROM && EMAIL_DOMAIN && PASSWORD_RESET_URL)`. Enquanto `emailHabilitado` for falso, `/forgot-password`
e `/reset-password` seguem o §6 (resposta genérica, nada enviado).

---

## 3. Guard duplo (crítico)

O `SupabaseAuthGuard` passa a aceitar os dois tokens. Desenho que **não afrouxa**:

```
token = Bearer do header            // igual a hoje
payload =
  tentarProprio(token)              // HS256 com AUTH_JWT_SECRET, issuer=AUTH_ISSUER, aud='authenticated'
  ?? tentarSupabase(token)          // exatamente o verify() de hoje (JWKS ou HS256), issuer=<supabaseUrl>/auth/v1
  ?? throw UnauthorizedException
```

Regras inegociáveis:

- **Issuer fixo em cada caminho.** `tentarProprio` só aceita `iss === AUTH_ISSUER`; `tentarSupabase` só
  aceita `iss === <supabaseUrl>/auth/v1`. Como `AUTH_ISSUER` **nunca** é o issuer do Supabase, um token
  emitido para um caminho não valida no outro, mesmo com algoritmos coincidentes (HS256 nos dois). Isso
  fecha confusão de issuer/algoritmo.
- **Algoritmo fixado.** `tentarProprio` passa `algorithms: ['HS256']` ao `jwtVerify`. `tentarSupabase`
  mantém o comportamento atual (sem relaxar). Nenhum caminho aceita `alg: none`.
- **Ordem e custo.** Tentar o próprio **primeiro** (verificação local, barata). Só cai no Supabase
  (possível ida ao JWKS, já cacheado por `createRemoteJWKSet`) se o próprio falhar. Falha nos dois ⇒
  `UnauthorizedException('Sessão inválida ou expirada.')`, mensagem igual à de hoje.
- **Pós-condição idêntica.** Qualquer caminho exige `payload.role === 'authenticated'` e
  `typeof payload.sub === 'string'`, e então grava `request.claims = payload as SupabaseClaims`. O
  `TenantDb` não distingue a origem do token.
- **Se `AUTH_JWT_SECRET` faltar**, `tentarProprio` é pulado silenciosamente (nunca lança por falta de
  segredo) e o guard se comporta exatamente como hoje — só Supabase. Assim ligar o módulo sem a variável
  não quebra as rotas existentes.

O `verify()` atual (`supabase-auth.guard.ts:31-38`) vira `tentarSupabase` sem mudança de lógica. O
`canActivate` ganha o encadeamento acima. `claims.decorator.ts` e `SupabaseClaims` ficam intactos.

---

## 4. Rotas de autenticação

Controller `AuthController` em `/api/auth`, **sem** `SupabaseAuthGuard** nas rotas públicas de entrada
(login/refresh/logout/forgot/reset); `/me` **com** guard. Formato de erro e tradutor: molde §0.3/§0.4. Todas
as respostas de erro de credenciais usam **a mesma** mensagem genérica e **o mesmo** status, sem revelar se o
e-mail existe.

Se `authLoginHabilitado` for falso (`AUTH_JWT_SECRET` ausente), **todas** as rotas de `/api/auth` respondem
`503 { codigo: 'auth_login_indisponivel' }`, exceto que o front, sem `VITE_API_URL`, nem chega aqui.

### 4.1 `POST /api/auth/login`

- **DTO:** `{ email: string; senha: string }`. `email` não-vazio; `senha` não-vazia. (Validação de formato
  mínima; não revela regras de senha.)
- **Lógica:** normaliza o e-mail; busca `usuarios` por `lower(email)`. Se não existir, ou `status !== 'ativo'`,
  ou `password_hash` for NULL, ou `bcrypt.compare(senha, hash)` falhar ⇒ resposta **idêntica** de erro
  (`401 { codigo: 'credenciais_invalidas' }`, mensagem "E-mail ou senha incorretos."). **Sempre** rodar um
  `bcrypt.compare` contra um hash fixo (dummy) quando a conta não existe/sem senha, para o tempo de resposta
  não vazar a existência da conta.
- **Sucesso (200):** emite access JWT (§4.3) e um refresh opaco (§4.2); grava o hash do refresh em
  `auth_refresh_tokens` (nova `family_id`). Corpo: `{ user: { id, email }, accessToken, expiresIn }`. O
  refresh vai **só** no cookie `HttpOnly`.
- **Cookie:** `Set-Cookie: lotti_refresh=<opaco>; HttpOnly; Secure; SameSite=Lax; Path=/api/auth;
  Max-Age=<AUTH_REFRESH_TTL>` (+ `Domain=AUTH_COOKIE_DOMAIN` se definido).

### 4.2 `POST /api/auth/refresh`

- **Entrada:** cookie `lotti_refresh`. Sem corpo.
- **Lógica (rotação obrigatória):** calcula SHA-256 do cookie; busca a linha por `token_hash`. Recusa
  (`401 { codigo: 'sessao_expirada' }`) se não achar, se `expires_at` passou, ou se `revoked_at` preenchido.
  **Detecção de reuso:** se `used_at` já estiver preenchido (token rotacionado sendo reusado), **revoga a
  família inteira** (`revoked_at = now()` em todas as linhas de `family_id`) e responde 401. Caso válido:
  marca `used_at = now()` na linha, insere uma linha nova na **mesma** `family_id` com o novo hash, emite
  novo access + novo refresh (cookie novo). Confere também `session_version` do usuário (§4.3).
- **Resposta (200):** `{ accessToken, expiresIn }` + cookie novo.

### 4.3 Formato do access JWT (claims iguais às do Supabase)

Assinado **HS256** com `AUTH_JWT_SECRET`. Claims, nesta ordem de exigência do guard e do `TenantDb`:

| Claim | Valor |
|---|---|
| `sub` | `usuarios.id` — **o mesmo** `auth.users.id`. |
| `role` | `'authenticated'` (literal; é o que o `TenantDb` exige e o `set local role` usa). |
| `email` | e-mail normalizado. |
| `aud` | `'authenticated'`. |
| `iss` | `AUTH_ISSUER` (ex. `lotti-api`). |
| `iat` / `exp` | `exp = iat + AUTH_ACCESS_TTL`. |
| `sv` | `usuarios.session_version` no momento da emissão. |

O guard **não** precisa checar `sv` (manter a verificação mínima e igual à do Supabase). O `sv` serve ao
`/refresh`: ao rotacionar, se `payload.sv !== usuarios.session_version`, recusa e revoga a família — é assim
que trocar senha / incrementar `session_version` mata sessões vivas dentro de um ciclo de access (≤15 min).

### 4.4 `POST /api/auth/logout`

Lê o cookie; se houver linha, `revoked_at = now()` na **família** inteira. Limpa o cookie
(`Max-Age=0`). Sempre responde `200 { ok: true }` (idempotente, não revela nada).

### 4.5 `GET /api/auth/me`

**Com** `SupabaseAuthGuard` (aceita token próprio **ou** Supabase). Usa `@Claims()`; devolve
`{ id: claims.sub, email: claims.email, role: claims.role }`. Não toca o banco (espelha o token). Serve ao
front para reidratar o usuário após refresh.

### 4.6 `POST /api/auth/forgot-password` e `POST /api/auth/reset-password`

Enquanto `emailHabilitado` for falso (estado desta fase), ver §6. A forma do contrato (para quando o e-mail
existir) fica fixada aqui:

- `forgot-password` — DTO `{ email }`. Gera token aleatório de uso único, guarda **só** o hash + expiração
  (tabela de reset, análoga a §1.2; criada junto quando o e-mail for ligado — fora do escopo desta migration),
  envia link `PASSWORD_RESET_URL?token=...`. **Resposta sempre** `200 { ok: true }` com a mesma mensagem
  genérica, exista a conta ou não.
- `reset-password` — DTO `{ token, senha }`. Consome o token (uso único), grava bcrypt novo, **incrementa
  `session_version`** (mata todas as sessões) e revoga todos os refresh da família do usuário.

---

## 5. Front: `AuthClient` atrás de `apiDisponivel()`

`src/lib/api/auth.ts` expõe um cliente que fala com `/api/auth` usando `VITE_API_URL` (mesma leitura de
`src/lib/api.ts`). Ele **não** usa `chamarApi` para login/refresh (não há token ainda); usa `fetch` com
`credentials: 'include'` para o cookie `HttpOnly` viajar. Guarda o `accessToken` **só em memória** (nunca
`localStorage`) e agenda refresh antes do `exp`.

`src/hooks/useAuth.tsx` é o único arquivo de front editado. A interface pública do `AuthContextValue` —
`user`, `session`, `loading`, `isAuthenticated`, `signUp`, `signIn`, `signOut`, `entrarCom`,
`pedirRecuperacao`, `definirNovaSenha` — **não muda**. Cada método ganha um ramo:

```
if (apiDisponivel()) { ...AuthClient... } else { ...supabase.auth de hoje, idêntico... }
```

- **`signIn`** → `POST /login`; em sucesso guarda `accessToken` + um `user`/`session` mínimos no formato que
  os consumidores já esperam (`session.access_token`, `session.user.id`, `user.id`, `user.email`).
- **`signOut`** → `POST /logout`; limpa estado em memória. O fluxo de **suporte** (`obterSuporte`/`admin-suporte`)
  fica **fora** do ramo da API nesta fase (continua no Supabase); documentado como pendência da virada.
- **`signUp`** → nesta fase **permanece** no Supabase mesmo com a API ligada (cadastro cria `auth.users` +
  trigger `handle_new_user`); só migra quando a rota de cadastro da API existir. Fixar isso evita contas
  órfãs sem corretor.
- **`entrarCom`** (OAuth) → permanece no Supabase nesta fase (API ainda não tem `/oauth/*`).
- **`pedirRecuperacao`** / **`definirNovaSenha`** → com a API ligada, chamam `/forgot-password` e
  `/reset-password`, que hoje devolvem a resposta genérica (§6). Sem `VITE_API_URL`, seguem no Supabase.

**Sem `VITE_API_URL`:** nenhum ramo da API roda; `useAuth.tsx` é funcionalmente idêntico a hoje (mesmo
`onAuthStateChange`, `getSession`, toasts, `isolarTrocaDeSessao`, telemetria, atribuição de parceiro).

---

## 6. Recuperação e convite: desabilitados com resposta genérica

Enquanto `emailHabilitado` for falso (estado atual — Resend ainda não configurado):

- `POST /api/auth/forgot-password` **não** gera token, **não** consulta se a conta existe de forma
  observável, **não** envia nada. Responde **sempre** `200 { ok: true, mensagem: 'Se existir uma conta,
  enviaremos instruções.' }`.
- `POST /api/auth/reset-password` responde `503 { codigo: 'recuperacao_indisponivel' }` (não há token válido
  a consumir), com mensagem neutra.
- O convite segue a mesma regra: rota existe, resposta genérica, nada enviado.

O adaptador de e-mail (`email/email.port.ts`) é uma interface; `resend.adapter.ts` só é instanciado quando
`emailHabilitado`. Sem as variáveis, o serviço injeta um stub que lança se chamado — e o `AuthService` nunca
o chama no estado desabilitado.

---

## 7. SQL da migration (pendência — NÃO aplicar)

```sql
-- api/prisma/migrations/<timestamp>_auth_login_proprio/migration.sql  (NÃO APLICADA)
CREATE TABLE public.usuarios (
  id              uuid PRIMARY KEY,
  email           text NOT NULL,
  password_hash   text,
  status          text NOT NULL DEFAULT 'ativo',
  session_version integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuarios_email_key ON public.usuarios (lower(email));
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;  -- sem policy p/ anon/authenticated

CREATE TABLE public.auth_refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  family_id  uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_refresh_tokens_hash_key ON public.auth_refresh_tokens (token_hash);
CREATE INDEX auth_refresh_tokens_family_idx ON public.auth_refresh_tokens (family_id);
ALTER TABLE public.auth_refresh_tokens ENABLE ROW LEVEL SECURITY;  -- sem policy pública

-- GRANT apenas ao papel da aplicação (nome real definido na virada); nunca a anon/authenticated.
```

O `schema.prisma` ganha os modelos correspondentes **na virada** (não editar `api/prisma/*` agora; os
modelos entram junto com a migration que será criada e aplicada no passo §9).

---

## 8. Integração (passo à parte, fora das frentes)

`app.module.ts` passa a importar `AuthModule`. O `SupabaseAuthGuard` continua provido **por módulo** (como
hoje: `arquivos.module.ts:13`, `assinatura.module.ts:15`, etc.) — a extensão do guard é interna ao arquivo e
não muda quem o provê. Nenhum módulo existente é tocado: todos passam a aceitar o token próprio
automaticamente, porque usam o mesmo `SupabaseAuthGuard`.

---

## 9. Sequência de virada (depois desta fase)

1. Aplicar a migration §7 (cria tabelas vazias).
2. Rodar script de povoamento: copiar de `auth.users` o `id`, o e-mail normalizado e o `encrypted_password`
   (bcrypt) para `usuarios` — **`id` preservado**. As 2 contas com bcrypt entram com a senha atual; a 3ª
   nasce com `password_hash` NULL (só OAuth/recuperação). O hash **nunca** aparece em log/relatório.
3. Definir `AUTH_JWT_SECRET` (+ TTLs/issuer) no ambiente da API. A partir daí o guard aceita os dois tokens.
4. Ligar `VITE_API_URL` no front: `signIn`/`signOut`/`refresh` passam a usar a API; o restante (OAuth,
   cadastro, suporte) segue no Supabase até suas rotas existirem.
5. Quando o Resend estiver verificado, definir as variáveis de e-mail: recuperação/convite saem do estado
   genérico e passam a enviar de verdade.
6. Só depois de todos os módulos virarem é que a emissão do Supabase é desligada (fora do escopo; mantém
   janela de rollback). Refresh tokens dos dois sistemas **nunca** são compartilhados.

---

## 10. Testes obrigatórios

**Unit / `jest` (API):**

- `tokens.spec.ts`: access emitido tem `sub/role/email/aud/iss/exp/sv` corretos; `role` sempre
  `authenticated`; verifica e rejeita `alg: none`, issuer errado, assinatura errada, expirado.
- `supabase-auth.guard.spec.ts` (acréscimos): (a) token próprio válido ⇒ `claims` com `sub` do usuário;
  (b) token Supabase válido ⇒ segue passando (não regredir); (c) token próprio com `iss` do Supabase ⇒
  recusado; (d) token Supabase com `iss` próprio ⇒ recusado; (e) `AUTH_JWT_SECRET` ausente ⇒ comportamento
  idêntico ao de hoje (só Supabase); (f) `role !== 'authenticated'` ⇒ 401.
- `auth.service.spec.ts`: login ok; senha errada / conta inexistente / `password_hash` NULL / `status`
  bloqueado ⇒ **mesma** resposta e tempo (dummy compare); rotação de refresh marca `used_at` e cria linha
  nova na mesma família; reuso de refresh revoga a família; logout revoga a família; `reset-password`
  incrementa `session_version` e revoga tudo.
- `auth.controller.spec.ts`: cookie `HttpOnly Secure SameSite=Lax Path=/api/auth`; `/me` exige guard;
  `authLoginHabilitado` falso ⇒ 503; `forgot-password` sempre 200 genérico.

**`api/test/sql-real/auth.test.ts`:** contra o schema real (sem rede externa), valida que `usuarios`/
`auth_refresh_tokens` existem com os índices e que RLS está habilitada sem policy pública; que uma linha de
`usuarios` com `id` dado resolve o mesmo `get_corretor_id()` que o token do Supabase resolveria para aquele
`sub` (prova de que `claims.sub` preservado mantém o tenant).

**Front / `vitest`:** `auth.test.ts` — com `VITE_API_URL`, `signIn` chama `/login`, guarda access só em
memória, manda `credentials:'include'`; `signOut` chama `/logout`; **sem** `VITE_API_URL`, nenhum fetch à
API e o caminho Supabase roda idêntico (bloco "sem VITE_API_URL nada muda", como nos outros módulos).

---

## 11. Resumo em 3 linhas

1. API ganha `/api/auth/login|refresh|logout|me` com access JWT curto (HS256, `sub` = `auth.users.id`) e
   refresh opaco rotativo em `auth_refresh_tokens`; tabelas criadas mas **não** aplicadas.
2. O guard passa a aceitar token próprio **e** Supabase, cada um com issuer fixo e verificação completa —
   nada afrouxa, e sem `AUTH_JWT_SECRET` o comportamento é o de hoje.
3. Recuperação/convite ficam desabilitados com resposta genérica até o Resend existir; o front só muda com
   `VITE_API_URL`, mantendo a interface do `useAuth` intacta.
