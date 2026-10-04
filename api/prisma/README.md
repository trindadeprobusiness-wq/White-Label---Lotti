# Banco da Lotti: migrations no padrão do Clix

Desde 2026-10-04, a fonte da verdade do banco é `api/prisma/migrations/`, em SQL.
O `schema.prisma` é **gerado** delas. A pasta `supabase/migrations` está
**congelada**: não crie mais nada nela.

- `0_init` é a baseline: o banco de produção inteiro, extraído do catálogo.
  Ela está marcada como aplicada na produção (checksum `4821a428…6580`) e
  **nunca muda**.
- O teste (`npm test`) aplica todas as migrations em ordem num Postgres novo
  (PGlite) e confere três coisas:
  - cadastro;
  - RLS;
  - que o `schema.prisma` é exatamente o que as migrations geram.

## Mudar o banco

1. Crie `api/prisma/migrations/<AAAAMMDDHHMMSS>_<nome_em_snake_case>/migration.sql`.
   O SQL é escrito à mão e vale tudo: tabela, coluna, índice, função, gatilho,
   policy, grant. Escreva de forma que rode num banco novo também (o teste
   prova isso).
2. `cd api && npm run schema:gerar`. Aplica as migrations no Postgres local e
   regenera o `prisma/schema.prisma`.
3. `npm test`.
4. Commite a migration **e** o `schema.prisma` no mesmo PR. Sem o schema, o
   teste falha.

## Aplicar na produção

- **Padrão (Clix):** o container da API roda `prisma migrate deploy` ao subir
  (`npm run start:prod`). Precisa de duas variáveis:
  - `DATABASE_URL`: pooler de transação, porta 6543, com `?pgbouncer=true`;
  - `DIRECT_URL`: pooler de **sessão**, porta 5432, host `pooler.supabase.com`
    (no painel: Connect → Session pooler). A conexão direta do Supabase é só
    IPv6 e pode não ser alcançável do Railway.
- **Enquanto a API não estiver ligada ao banco**, aplique e registre à mão, pela
  CLI (não precisa da senha do banco):
  ```bash
  C:/Users/rafae/bin/supabase db query --linked -f api/prisma/migrations/<nome>/migration.sql
  node api/scripts/schema/marcar-aplicada.mjs api/prisma/migrations/<nome>/migration.sql > marcar.sql
  C:/Users/rafae/bin/supabase db query --linked -f marcar.sql
  ```
  O segundo e o terceiro comando gravam o mesmo registro que o
  `prisma migrate deploy` gravaria.

## Conferir se a produção mudou por fora

```bash
C:/Users/rafae/bin/supabase db query --linked -f api/scripts/schema/catalogo.sql > catalogo.json
node api/scripts/schema/conferir-producao.mjs catalogo.json
```

Qualquer diferença em "só na produção" é mudança feita direto no banco. Ela
precisa virar migration.

## Nunca

- `prisma migrate dev`, `prisma migrate reset`, `prisma db push` ou
  `prisma db pull` contra a produção.
- Editar a `0_init` ou qualquer migration já aplicada. Corrija com uma
  migration nova.
- Criar arquivo em `supabase/migrations`.
- Escrever segredo (chave, token, senha) em migration. Segredo fica em
  variável de ambiente.
