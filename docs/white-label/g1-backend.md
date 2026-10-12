# WL-G1-BACKEND — Report review do backend (Lotti White Label)

- Responsável: Engenharia de Backend. Data: 2026-10-11.
- Fonte: `projetos/lotti-white-label`, snapshot G0 `main` `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86` (conferido com `git rev-parse HEAD`; `git status --short` vazio). Paths abaixo são relativos a esse repositório.
- Método: só leitura estática de código versionado (`git ls-files`, leitura dirigida). Não li `.env` nem segredos e não toquei em dados reais. Não executei build, teste, install, migration, deploy nem chamada externa. **Nada aqui foi verificado em execução.**
- Contexto lido: `AGENTS.md` (raiz e projeto), `CLAUDE.md` do projeto, seções B0–B6 e de 10/10 do `AI_HANDOFF.md` (usadas só como pista; os fatos abaixo vêm do código).

## 1. Topologia do backend no snapshot

| Camada | Onde | Situação |
|---|---|---|
| API NestJS (Railway) | `api/src/**` (25 módulos em `api/src/app.module.ts`), prefixo global `/api` (`api/src/main.ts:20`) | Caminho principal atual |
| Banco | Prisma + SQL bruto; schema em `api/prisma/migrations/0_init` + 24 migrations até `20261011100000_central_comercial` | Fonte de verdade do schema da API |
| Edge Functions Supabase | `supabase/functions/*` (31 funções + `_shared`) e `supabase/migrations/*` | Legado: ramo de fallback; parte já só repassa ao Railway (`_shared/repassar-railway.ts`) |
| Runtime do agente WhatsApp | **Fora do snapshot** (nenhum arquivo `runtime/` versionado; o handoff cita o branch externo `codex/railway-data-plane`) | Não auditável aqui |
| n8n | `infra/n8n-workflows/A..E.json` | Integração externa; entra na API por `integracoes/n8n` |
| Storage | Garage via S3 (`api/src/storage/storage.service.ts`) | Atual |
| Filas/agendas | BullMQ/Redis (`api/src/agendamentos/*`, `api/src/redis/*`), `setInterval` em `financeiro/asaas/asaas-fila.ts` | Atual, desligadas por padrão (`AGENDAMENTOS_ENABLED`, `processarFilaLigado()`) |

## 2. Fronteiras de autenticação (por controller)

| Guard | Controllers | Mecanismo |
|---|---|---|
| `SupabaseAuthGuard` (`api/src/auth/supabase-auth.guard.ts`) | quase todos os de usuário (arquivos, assinatura, onboarding, auth, perfil, central-comercial, contratos, documentos, clientes, crm, fachadas*, financeiro*, asaas/conexao, ia*, imoveis*, notificacoes, parceiros, admin, rotina*, suporte, visitas, whatsapp) | Apesar do nome, só aceita JWT próprio HS256 (`AUTH_JWT_SECRET`/`AUTH_ISSUER`, l.93-100); exige `role=authenticated` e `sub`; token de suporte conferido no banco a cada requisição (l.64-84). Falha fechada sem segredo. |
| `AgentTokenGuard` (`api/src/auth/agent-token.guard.ts`) | `whatsapp/runtime/storage`, `agente/visitas` | Segredo único compartilhado `x-lotti-agent` (`AGENT_API_TOKEN`), tempo constante. **Não identifica tenant.** |
| `CheckoutTokenGuard` (`api/src/checkout/checkout-token.guard.ts`) | `checkout` (12 rotas) | `x-lotti-checkout` = `CHECKOUT_API_TOKEN`, SHA-256 + `timingSafeEqual`; sem env → 503 |
| `N8nSegredoGuard` | `integracoes/n8n` (4 rotas) | `x-n8n-secret` (`N8N_SHARED_SECRET`) |
| Sem guard (públicas) | `planos`, `publico/leads`, `publico/diagnostico` + `diagnostico`, `publico/fachadas`, `publico/imoveis`, `financeiro/asaas/webhook`, `health`, `diagnostico-comercial`, `parceiros` (público), `google-agenda` (callback/webhook) | Autorização própria por rota (ex.: slug+token no Asaas; rate limit nos leads) |

## 3. Resolução de corretor/tenant

- **Tenant = corretor** (`corretores.id`). Não existe entidade de marca/white-label: busca por `white.?label|branding|x-forwarded-host|req.hostname` em código não retorna nada no backend (só menções em docs/handoff).
- Usuário → tenant: `public.get_corretor_id()` (`api/prisma/migrations/0_init/migration.sql:5488`): `onboarding_profiles` → `routine_memberships` (status `active`) → `routine_organizations.legacy_corretor_id` → `corretores` com `status='ativo'`, a partir de `auth.uid()`. Um usuário pertence a uma organização; vários usuários podem mapear para o mesmo corretor.
- `auth.uid()` é emulado lendo `request.jwt.claims` (`0_init`, bloco de criação de `auth.uid()/auth.role()`).
- Integrações servidor-a-servidor resolvem o tenant por dado do payload: Asaas pelo `webhook_slug` da conexão (`asaas-webhook.service.ts:82-99`); agente pelo `corretorId` + `conversationId` do corpo, conferindo que a conversa é do corretor (`visitas/visitas.service.ts:38-45`); checkout pelo e-mail/pedido.

## 4. Camadas de acesso ao banco (escopo e bypass)

| Camada | Arquivo | Papel efetivo | Escopo |
|---|---|---|---|
| `TenantDb.run(claims, …)` | `api/src/prisma/tenant-db.ts:21-27` | `set local role authenticated` + `request.jwt.claims` na transação | RLS + `get_corretor_id()` valem (paridade com PostgREST) |
| `ServicoDb.run(…)` | `api/src/financeiro/servico-db.ts` | `set local role service_role` (BYPASSRLS), sem `sub` | Filtro de dono precisa estar no SQL (Asaas faz: `asaas-webhook.service.ts:157-168`) |
| `PrismaService` direto | `api/src/prisma/prisma.service.ts` | Papel da conexão `DATABASE_URL` (comentários a chamam "dono do banco", ex. `agendamentos.repo.ts:9`; o papel real não é visível no código) | **Bypass de RLS presumido**; escopo depende de cada query |

Arquivos que usam `PrismaService` direto (contagem estática, sem specs): `agendamentos.repo`, `arquivos.repo` (só `lotti_manual_sends` filtrado por `get_corretor_id()` obtido no TenantDb, l.74-88), `assinatura/catalogo.repo`, `auth/sessao-suporte`, `auth/supabase-auth.guard`, `auth/usuarios.repo`, `checkout.repo/service`, `contratos/contratos-ia.service`, `contratos/ia/cota`, `crm/integracoes/captura-lead.repo`, `crm/integracoes/crm-n8n.repo`, `diagnostico-crescimento.repo`, `fachadas/publico/fachadas-publico.repo`, `financeiro/servico-db`, `health`, `ia/acao.service`, `ia/assistente.service`, `ia/cotas`, `ia/ferramentas.service`, `ia/mensagens.service`, `ia/telemetria`, `imoveis/imoveis-venda-evento.service`, `imoveis/publico/imoveis-publico.repo`, `parceiros/diagnostico/diagnostico.repo`, `parceiros/publico/parceiros-publico.repo`, `rotina/google/rotina-google.repo`, `suporte.service`, `visitas.repo`.

Padrão declarado e conferido em amostra: o `corretorId` usado no caminho privilegiado vem de `get_corretor_id()` resolvido antes no TenantDb (`ia/cotas.ts:5-9`; `arquivos.repo.ts:79-86`). Não auditei linha a linha todos os arquivos acima. Essa é a lacuna principal para G2.

## 5. Trace por domínio

### 5.1 API de usuário (CRUD multi-tenant)
CRM, imóveis, contratos, financeiro, fachadas, rotina, notificações e WhatsApp do usuário passam por `SupabaseAuthGuard` → `TenantDb` (ex.: `whatsapp.service.ts:109-157` só chama RPCs `lotti_*` pelo TenantDb). Admin: `parceiros/admin/admin.service.ts:55-59` delega o papel a `exigir_admin()/exigir_super_admin()` e às policies `is_admin()`.

### 5.2 Webhooks e integrações de entrada
| Entrada | Arquivo | Autorização | Idempotência |
|---|---|---|---|
| Asaas (financeiro do corretor) | `financeiro/asaas/asaas-webhook.controller.ts`, `.service.ts` | `?t=<slug>` + token da conexão decifrado (`asaas-access-token`/`x-hook-token`), comparação `tokensIguais` | `uq_asaas_webhook_event UNIQUE(event_id)` (`0_init:9442`) → 23505 = `duplicate`; reserva `RECEIVED|FAILED → PROCESSING` (l.105-110); regras que ignoram reaplicação (fatura `PAGO`, repasse `CONFIRMADO`); fila de retry (`asaas-fila.ts`, até 5 tentativas) e sweeper de `PROCESSING` > 10 min (`agendamentos.config.ts:76-83`) |
| Checkout SaaS (site → API) | `checkout/*` | `CheckoutTokenGuard` | `claim_asaas_checkout_event`, `claim_checkout_order_provisioning`, `pg_advisory_xact_lock` por e-mail, `on conflict do nothing`, `PROVISIONING_RETRY` (`checkout.repo.ts:136-241`) |
| n8n | `crm/integracoes/crm-n8n.controller.ts` | `N8nSegredoGuard` | Não verificado em profundidade |
| Lead público | `crm/integracoes/captura-lead.controller.ts` | Público + `consume_public_lead_limit` (handoff B4) | Não verificado |
| Google Agenda | `rotina/google/rotina-google-publico.controller.ts` (`callback`, `webhook`) | Delegada a `RotinaGoogleService.webhook(headers)` | Não verificado (há `calendar_webhook_receipts` citado no handoff) |
| Evolution/WhatsApp (entrada de mensagens) | Não está na API; fica no runtime externo / n8n workflow A (`infra/n8n-workflows/A-evolution-webhook-router.json`) | — | Fora do snapshot |

### 5.3 Billing / Asaas
- Dois fluxos distintos: (a) **cobrança de aluguel do corretor** com conta Asaas por inquilino (`financeiro/asaas/*`, credencial cifrada em `asaas_conexao_segredos`, `asaas-crypto.ts`); (b) **assinatura SaaS da Lotti**, via checkout do site (`checkout/*`, `apply_checkout_payment`) e planos/cotas (`assinatura/*`, `checar_cota`/`incrementar_uso`).
- Restrição vigente em `CLAUDE.md` do projeto: "Não mexer em nada do Asaas nem da API do Gemini". Qualquer adaptação white-label nesses pontos exige decisão humana.

### 5.4 WhatsApp / IA
- Envio: `whatsapp.service.ts:172-201` cria a conversa pelo TenantDb (`lotti_inbox_start_conversation`) e chama a ponte `LOTTI_CHANNEL_BRIDGE_URL` com `x-lotti-connect`, `corretor_id` do dono e `request_id` UUID obrigatório. A idempotência do envio fica delegada à ponte externa (não visível).
- Runtime do agente: storage (`whatsapp-runtime.controller.ts`) e agenda (`agente-visitas.controller.ts`) com `AgentTokenGuard`.
- IA do app: `api/src/ia/*` (Gemini em `ia/gemini.ts`, `contratos/ia/gemini.ts`); dados pelo TenantDb; cota, rate limit e telemetria pelo PrismaService com `corretorId` de `get_corretor_id()`. Handoff B2: tabelas `ai_runs/ai_tool_calls/ai_action_proposals` ausentes na produção (telemetria vira no-op). Não confirmei isso contra o banco.

### 5.5 Storage
- Garage/S3 com chave validada (`arquivos/arquivos.dto.ts` `validarKey`: sem `..`, `/` inicial, `\`).
- Dono do arquivo do usuário = existe linha visível via RLS que referencia a key (`arquivos.repo.ts:34-88`). O prefixo `fachadas/<corretor_id>` é conferido contra `get_corretor_id()`.
- Runtime: buckets `lotti-inbox-files|lotti-inbox-audio`, qualquer key (inspect/sign/upload) sem amarração a corretor (`whatsapp-runtime.controller.ts:7-37`).

### 5.6 Jobs
`agendamentos.config.ts`: `gerar-faturas-mensais`, `marcar-faturas-atrasadas`, `sweeper-webhook-events`, `gerar-alertas-vencimento`, `manutencao-diagnostico` (todo minuto), `lembrete-visita-corretor` (15 min). Todos rodam como dono, com `pg_try_advisory_xact_lock` e tz UTC (`agendamentos.repo.ts:20-31`), ou seja, **globais para todos os tenants**.

## 6. Riscos e achados (só código visível; não executado)

| # | Severidade | Achado | Evidência |
|---|---|---|---|
| R1 | Alta (WL) | O token do agente é global e o storage do runtime não tem escopo de tenant. Quem tiver `AGENT_API_TOKEN` lê, assina e grava qualquer key dos buckets de inbox de todos os corretores. Em white-label com runtimes/operadores separados, isso quebra o isolamento. | `auth/agent-token.guard.ts:11-17`; `whatsapp/whatsapp-runtime.controller.ts:19-37` |
| R2 | Média | `agente/visitas` confia no `corretorId` enviado pelo runtime. Há conferência conversa↔corretor, mas não há prova de que o chamador representa aquele corretor (mesmo token global). | `visitas/visitas.service.ts:38-45` |
| R3 | Média | Grande superfície com `PrismaService` direto (bypass presumido de RLS): ~30 arquivos. O isolamento depende de cada SQL filtrar o dono, e só uma amostra foi verificada. | Lista na §4 |
| R4 | Média (WL) | Não existe conceito de marca/tenant white-label (domínio, branding, credenciais por marca). CORS sempre inclui `ORIGEM_APP = 'https://app.plataformalotti.com.br'` (`api/src/config/env.ts:61`; extras só via `CORS_ORIGINS`, sem `*`, l.70-76) e a Edge `lotti-whatsapp` tem a origem hardcoded (`supabase/functions/lotti-whatsapp/index.ts:3`). | grep sem resultado em código; arquivos citados |
| R5 | Baixa | O sweeper recoloca `PROCESSING` em `RECEIVED` por `received_at` e não pelo início do processamento. Um retry tardio de evento antigo pode ser reaberto durante a execução. Os guards de estado (fatura `PAGO`, repasse `CONFIRMADO`) mitigam, mas `PAYMENT_REFUNDED` insere auditoria sem trava de duplicidade. | `agendamentos.config.ts:79-83`; `asaas-webhook.service.ts:201-209` |
| R6 | Baixa | `UNIQUE(event_id)` é global e não por `corretor_id`. Com várias contas Asaas, uma colisão de id (inclusive o fallback composto de `idDoEvento`) descartaria o evento como `duplicate`. | `0_init:9442`; `asaas-regras.ts` `idDoEvento` |
| R7 | Baixa | O webhook Asaas processa em `setImmediate`, dentro do processo. Se o processo cair, o evento depende da fila, que vem desligada por padrão. | `asaas-webhook.service.ts:50-52`; `asaas-fila.ts:21-24` |
| R8 | Info | Os jobs são globais (sem particionar por tenant). Escalar por marca exigiria particionamento ou fila por tenant. | `agendamentos.repo.ts` |
| R9 | Info | Nomenclatura legada: `SupabaseAuthGuard`/`SupabaseClaims` já não usam Supabase. | `supabase-auth.guard.ts:24-27` |

## 7. Classificação de funcionalidades

| Funcionalidade | Classe | Arquivo(s) | Nota |
|---|---|---|---|
| Login próprio JWT + refresh + suporte | **Reusar** | `api/src/auth/*` | Falha fechada; precisa de issuer/cookie por marca se houver domínios WL |
| Tenant por corretor via `get_corretor_id()` + `TenantDb` | **Adaptar** | `prisma/tenant-db.ts`, `0_init:5488` | Base boa; falta a camada "marca" acima do corretor |
| CRUD multi-tenant (CRM, imóveis, contratos, financeiro, fachadas, rotina) | **Reusar** | módulos com `SupabaseAuthGuard` + `TenantDb` | Depende de RLS |
| Admin/backoffice | **Reusar/Adaptar** | `parceiros/admin/*` | Papel global; WL pede admin por marca |
| Asaas cobrança do corretor (conexão, webhook, fila) | **Reusar** (restrição: não mexer) | `financeiro/asaas/*` | Idempotência sólida; ver R5–R7 |
| Assinatura SaaS / checkout / planos e cotas | **Adaptar** (restrição Asaas) | `checkout/*`, `assinatura/*` | Preço/plano por marca inexistente |
| WhatsApp do usuário (inbox, campanhas, ponte) | **Reusar** | `whatsapp/whatsapp.controller.ts`, `.service.ts` | Ponte única `LOTTI_CHANNEL_BRIDGE_URL` |
| Rotas do runtime do agente | **Adaptar** | `whatsapp-runtime.controller.ts`, `agente-visitas.controller.ts`, `auth/agent-token.guard.ts` | R1/R2 |
| Runtime do agente WhatsApp | **Ausente no snapshot** | — | Branch externo; não auditável |
| IA do app (assistente, fotos, sugestões) | **Parcial** (restrição Gemini) | `api/src/ia/*` | Tabelas de telemetria/propostas ausentes, segundo o handoff |
| Storage Garage + dono por RLS | **Reusar** | `storage/*`, `arquivos/*` | Bucket/prefixo por marca inexistente |
| Jobs BullMQ | **Reusar** | `agendamentos/*` | Globais (R8) |
| Rotas públicas (imóveis, leads, fachadas, diagnóstico, parceiros) | **Adaptar** | `*/publico/*`, `crm/integracoes/captura-lead.*` | CORS/origem por marca |
| Integração n8n | **Reusar** | `crm/integracoes/crm-n8n.*` | Segredo único global |
| Google Agenda | **Reusar** | `rotina/google/*` | Callback no domínio da Lotti (OAuth app único) |
| Tela white-label (branding/domínio/tema por marca) | **Ausente** | — | Sem código |
| Edge Functions Supabase | **Obsoleta** (fallback/legado) | `supabase/functions/*` | 7 só repassam ao Railway; demais são o ramo sem API |
| Scripts avulsos de sync (`scripts/force_sync*.js`, `sync_*.js`, `reset_*.ts`) | **Obsoleta** (provável) | `scripts/*` | Não lidos em detalhe; não verificado |
| Vídeos | **Ausente** | — | Handoff B1: a tabela `videos` não existe |

## 8. Limitações
- Nenhuma execução: as contagens de guards e de `PrismaService` vêm de regex sobre os `.ts` (sem specs) e podem ter falso positivo e falso negativo.
- Não li: o papel real da `DATABASE_URL`, as policies RLS tabela a tabela, `rotina-google.service` (webhook), `crm-n8n.repo`, `diagnostico-crescimento.repo` e o conteúdo dos workflows n8n.
- Fatos do handoff (tabelas ausentes em produção, estado da virada) não foram conferidos contra banco ou deploy.

## 9. Próximo passo sugerido (para o Orquestrador decidir)
1. G2 security: auditar linha a linha os ~30 arquivos com `PrismaService` direto e o papel da conexão.
2. Decisão de arquitetura WL: o que é "marca" (tenant acima de corretor?) e como resolvê-la (domínio/claim). Hoje está ausente.
3. Decidir o escopo do token do agente (por tenant ou assinado com `corretor_id`) antes de operar múltiplas marcas.
4. Confirmar com o humano a restrição "não mexer em Asaas/Gemini" frente ao white-label.
