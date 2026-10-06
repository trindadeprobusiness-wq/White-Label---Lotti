# Virada Supabase → Railway (roteiro do dia)

Estrutura final (padrão Clix): **app** (front) · **api** (NestJS + Prisma) · **Postgres** ·
**Redis** · **garage** (arquivos) · **agent** · WhatsApp (**evolution**, **evolution-db**,
**evolution-redis**). Os serviços `webhook-proxy` e `evolution-agent-proxy` saem na virada do WhatsApp (etapa F).

Marcação: **[VOCÊ]** é decisão ou clique seu · **[CODEX]** roda com a CLI do Supabase ·
**[CLAUDE]** fica comigo. Cada etapa tem como voltar atrás. Até a etapa D, nada muda para o usuário final.

---

## A. Antes de começar (manhã)

| # | Quem | O quê | Pronto quando |
|---|------|-------|---------------|
| A1 | [VOCÊ] | Decidir o backup: Supabase Pro (PITR) ou dump manual feito pelo Codex | um dos dois feito |
| A2 | [CODEX] | Diagnóstico do Gemini/geração de contratos (relatório 23) | causa conhecida e corrigida **no Supabase** |
| A3 | [CODEX] | `pg_dump` da produção (só leitura) guardado fora do repositório | arquivo + contagem por tabela |

> Sem A2 resolvido, a virada leva o defeito junto. O Gemini da API usa `GEMINI_API_KEY` no
> serviço **api** (referência a `${{agent.GEMINI_API_KEY}}`).

## B. Ensaio final (tarde, sem tocar na produção)

| # | Quem | O quê | Volta atrás |
|---|------|-------|-------------|
| B1 | [CLAUDE] | Migrações no Railway: **já aplicadas** (deploy `a2776b6` SUCCESS, health ok) | — |
| B2 | [CODEX] | Recriar o banco do ensaio e rodar `copiar.mjs` (exige destino vazio) | recriar de novo |
| B3 | [CODEX] | `preencher-usuarios.mjs` no mesmo banco → `usuarios == elegiveis`, `orfaos 0` | `truncate public.usuarios cascade` |
| B4 | [CODEX] | `copiar-storage.mjs` (Supabase → Garage, mesma chave, idempotente) | rodar de novo; a origem não é apagada |
| B5 | [CODEX] | `conferir-ensaio.mjs`: contagens iguais e mesma visão por usuário (RLS) | — |
| B6 | [VOCÊ] | Abrir o app com `VITE_API_URL` num deploy de teste e fazer login com a senha de sempre | apagar a variável |

## C. Noite: congelar

| # | Quem | O quê | Volta atrás |
|---|------|-------|-------------|
| C1 | [VOCÊ] | Avisar o dono: ~1h sem gravar nada | — |
| C2 | [CODEX] | Desligar o cron `routine-google-calendar-maintain` do Supabase | `cron.schedule` de novo |
| C3 | [CODEX] | Repetir B2–B5 com os dados do momento (cópia final) | Supabase segue intacto |

## D. Noite: virar

| # | Quem | O quê | Volta atrás |
|---|------|-------|-------------|
| D1 | [VOCÊ] | Definir `AUTH_JWT_SECRET` no serviço **api** (gerado, nunca colado em chat) | apagar |
| D2 | [VOCÊ] | Definir `VITE_API_URL=https://api.plataformalotti.com.br` no **app** e redeploy | **apagar a variável e redeploy: o front volta inteiro para o Supabase** |
| D3 | [VOCÊ] | Webhook do Asaas apontando para a API; reconectar Asaas (chave nova) | apontar de volta |
| D4 | [VOCÊ] | Google: callback `/google-agenda/callback` no Caddyfile/Console; as 2 contas reconectam | apontar de volta |
| D5 | [VOCÊ] | `ROUTINE_CALENDAR_MAINTAIN_ENABLED=true` e `ASAAS_PROCESSAR_FILA=true` na **api** | apagar |
| D6 | [CLAUDE] | Fumaça: login, listar imóveis/clientes, abrir foto, baixar documento, gerar contrato | — |

**Regra de rollback:** qualquer falha em D6 → apagar `VITE_API_URL` (D2) e religar o cron (C2).
O Supabase continua com os dados até a véspera; o que foi gravado na API durante o teste se perde.

## E. Dias seguintes

- Desligar as Edge Functions migradas, uma por vez, olhando os logs.
- Recuperação de senha: falta o Reply-To e o DNS do Resend (`mail.plataformalotti.com.br`). Sua autorização.
- Autovacuum: só religar quando o suporte do Supabase responder (irrelevante depois da virada).

## F. WhatsApp (separado, outro dia)

Mesclar os PRs #21/#22/#23 do runtime, conferir envio e recebimento, e só então remover
`webhook-proxy` e `evolution-agent-proxy`.

---

**Limites, sempre:** segredos só por nome · nada de mensagem para clientes · e-mail de teste só
para o dono · DNS, cobrança e escrita na produção só com o seu OK.
