# WL-G2 F0 — Inventário de superfícies do backend (Engenharia de Backend)

- **Estado:** artefato documental F0, versão 2 (correção após REVIEW independente parcial de 2026-10-12). **Não fecha F0** e não libera rollout de nenhuma superfície. Nenhuma linha aqui autoriza implementação, migration ou mudança de autorização.
- **Responsável pelo artefato:** Engenharia de Backend.
- **Aprovador da nova revisão:** QA (+ Revisão independente). **Ainda não aprovado.**
- **Donos nas tabelas:** são atribuição operacional desta onda para classificar e propor a saída. Não confirmam decisão material já tomada. Ownership definitivo desconhecido continua bloqueado, conforme a matriz.
- **Base de código:** clone `projetos/White-Label---Lotti`, branch `docs/wl-g0-g1-handoff`, HEAD `ec4c928a15143de71df8beb29654d37d5acffdd0`.
  - `git status --short` mostrou só `?? api/prisma/tenant-foundation.md`, de outro responsável e preservado.
  - `git diff --name-only 40d7e84e… HEAD -- api supabase src` veio vazio, ou seja, código igual ao snapshot G0.
- **Documentos de referência (só leitura):**
  - contrato `api/prisma/tenant-foundation.md` em SHA-256 `667C8770229B76FAEECBD4217DE43E5EF33B047D7306E7C3370265AB2A21CB58` (a revisão parcial examinou `E16D44FA…81A9`, **não** `667C`);
  - matriz `sistema/lotti-white-label/g2-model-matrix.md` em `B4D7D9D37ADD6AF1FA7713FC26231E8E11FF4A261E4478E666F6037063DAC699`;
  - versão anterior deste inventário: `D847E8596265AF7D91324D8BF44936BD7C083A248A0A35C0EB8851D986F15F1F`.
- **Método:** leitura estática com os scripts do Apêndice A. Não li `.env`, segredos, dados reais nem catálogo remoto. Não executei app, SQL, migrations, testes, install, push ou deploy. Testes citados são **cenários futuros necessários**, não testes existentes.
- **Paths:** relativos a `api/src/`, salvo quando indicados como `supabase/…` ou `api/prisma/…`.

## 0. Escopo coberto, exclusões e condições

| Item | Coberto nesta versão | Excluído / bloqueado | Responsável | Condição de saída |
|---|---|---|---|---|
| Rotas HTTP/SSE da API | **Lista completa e verificável** dos handlers em todo `api/src/**/*.ts` não-spec que contém `@Controller` (47 arquivos, 286 handlers, §2.2). A contagem foi checada contra o total bruto de decorators `@(Get\|Post\|Put\|Patch\|Delete\|Sse)(` em `api/src` (286 = 286) e não há `@Controller` fora de `*.controller.ts` | Rotas registradas dinamicamente (não há `RouterModule`/`APP_GUARD`/`useGlobalGuards`: busca vazia). O guard de cada rota vem por heurística de proximidade (±3 linhas); as 48 rotas com guard diferente de `SupabaseAuthGuard` (26 `NENHUM`, 12 checkout, 6 agente, 4 n8n) foram conferidas manualmente | Backend | Revisão confere a tabela §2.2 contra o código; qualquer rota nova exige linha aqui |
| Funções SQL chamadas pela API | **105 funções**: todas as definidas nas migrations Prisma (235) que aparecem chamadas em `api/src`, **com ou sem** prefixo `public.` (§3). Inclui `conta_antiga_sem_limite`, que o regex antigo perdia | Corpos, `SECURITY DEFINER`, grants, `search_path` e RLS de cada função | Segurança + Banco | Revisão objeto a objeto sob brief próprio |
| Bypass `ServicoDb` e `PrismaService` | Todos os arquivos com chamada direta ou com o client repassado (§4), incluindo os oito antes não capturados, operação a operação | Papel efetivo de `DATABASE_URL`/`DIRECT_URL` (não visível no código) | Backend; papel: DevOps + Segurança | Papel confirmado sob autorização específica |
| Webhooks, callbacks, servidor-a-servidor, SSE | Todos os listados em §2.2 com guard ≠ `SupabaseAuthGuard`, mais a cadeia SSE (§5) | Runtime WhatsApp externo e entrada da Evolution (fora do snapshot) | Backend + Segurança | Brief próprio com acesso ao runtime |
| Storage | Seis buckets e todas as operações de `arquivos/*` e `whatsapp/runtime/storage/*` (§6) | Objetos reais; buckets do Supabase legado | Backend; legado: DevOps | Inventário de deploy/objetos sob autorização |
| Jobs e filas | BullMQ (`agendamentos`, `rotina-google`), fila Asaas, `setImmediate` (§7) | Configuração ativa em produção (`AGENDAMENTOS_ENABLED` etc.) | Backend + DevOps | Leitura de config sob autorização |
| Recursos órfãos | `calendar_webhook_receipts`, `leads_sem_destino`, `lotti_agent_bridge_endpoint`, `webhook_logs`, `job_queue` (§8) | Consumidores fora do repositório | Backend + Banco + Segurança | Ver §8 |
| Edge Functions | 31 funções classificadas por heurística (§9) | Leitura linha a linha; quais estão deployadas | Backend + DevOps | Inventário de deploy |
| Frontend | — | Fora deste artefato | Frontend | Inventário próprio |

## 1. Fronteiras de autenticação

| Guard | Evidência | Identidade | Observação | Est. |
|---|---|---|---|---|
| `SupabaseAuthGuard` | `auth/supabase-auth.guard.ts:45-68,93-100` | JWT próprio HS256 (`AUTH_JWT_SECRET`/`AUTH_ISSUER`), `role=authenticated`, `sub` | Nome legado: não aceita token do Supabase. Token de suporte conferido no banco por requisição (l.64-84, via `auth/sessao-suporte.ts:40-60`) | V |
| `AgentTokenGuard` | `auth/agent-token.guard.ts:11-17` | segredo único `x-lotti-agent` | Não identifica tenant | V |
| `CheckoutTokenGuard` | `checkout/checkout-token.guard.ts:24-36` | segredo `x-lotti-checkout` | Sem env → 503 | V |
| `N8nSegredoGuard` | uso em `crm/integracoes/crm-n8n.controller.ts:13` | segredo `x-n8n-secret` | Corpo do guard não lido (gap G9) | P |
| Worker do diagnóstico | `diagnostico-crescimento/diagnostico-crescimento.controller.ts:66-78` | `Bearer DIAGNOSTIC_WORKER_SECRET` (32+) | Inline | V |
| Nenhum | 26 rotas (§2.2, guard `NENHUM`) | autorização própria por rota | Todas classificadas em §2.1 | V |

**Legenda.**
- **Estado:** V = verificado por leitura estática do trecho citado; P = parcial; NV = não verificado.
- **GCI:** `get_corretor_id()` (`api/prisma/migrations/0_init/migration.sql:5488`).
- **LIMIT1:** `rotina/rotina.contexto.ts:13-20`.
- **Risco:** A (alta), M (média), B (baixa), I (info).

## 2. Superfícies e rotas

### 2.1 Superfícies (cada rota de §2.2 aponta para uma linha daqui)

| Sup. | Superfície / arquivos | Categoria | Auth | Fonte de tenant | Camada | Efeito | Est. | Risco / dono | Cenário futuro necessário (ou dispensa) |
|---|---|---|---|---|---|---|---|---|---|
| S01 | Clientes `crm/clientes/*` | org | SupabaseAuth | GCI via RLS | TenantDb | CRUD cliente, histórico, conversão | P | M / Backend | lista A≠B; ID de B negado; org forjada negada |
| S02 | Funil `crm/funil/*` | org | SupabaseAuth | GCI | TenantDb | etapas, oportunidades, tarefas | P | M / Backend | pai cross-org (cliente/etapa) negado |
| S03 | Imóveis `imoveis/imoveis*.controller.ts` | org | SupabaseAuth | GCI | TenantDb; `venda/evento` grava `webhook_logs` por Prisma (§4) | CRUD imóvel/fotos | P | M / Backend | imóvel de B negado; evento de venda só do dono |
| S04 | Contratos e documentos `contratos/*` | org | SupabaseAuth | GCI | TenantDb; cota IA por Prisma (§4) | contratos, documentos, análise IA | P | M / Backend | cliente+imóvel+contrato do mesmo tenant |
| S05 | Financeiro `financeiro/{faturas,lancamentos,repasses}` | org | SupabaseAuth | GCI | TenantDb; `faturas/:id/asaas` usa ServicoDb | faturas, baixa, estorno, repasse | P | A / Backend+Segurança | fatura de B negada; estorno idempotente |
| S06 | Conexão Asaas `financeiro/asaas/asaas-conexao.*` | org | SupabaseAuth | GCI (`asaas-conexao.service.ts:58`) | TenantDb + ServicoDb (`:127`) | credencial cifrada | P | A / Backend+Segurança (Asaas: decisão humana) | conexão só do próprio tenant |
| S07 | Fachadas `fachadas/*` (não-públicas) | org | SupabaseAuth | GCI | TenantDb | fachadas, templates, leads, métricas | P | M / Backend | template/lead de B negado |
| S08 | Rotina `rotina/rotina.controller.ts` | org | SupabaseAuth | **LIMIT1** | TenantDb | eventos/tarefas/inbox/comando | V (contexto) | A / Backend (B4) | 2 memberships ativas sem seletor → nega; seletor B → só B |
| S09 | Google autenticado `rotina/google/rotina-google.controller.ts` | org | SupabaseAuth | LIMIT1 (`rotina-google.service.ts:92`) | TenantDb + Prisma (`rotina-google.repo.ts`) | OAuth, calendários, sync | P | A / Backend | conexão gravada na org selecionada |
| S10 | IA `ia/*` | org | SupabaseAuth | GCI (`corretorDaSessao`, `ia/conversas.service.ts:20`) | TenantDb + Prisma (§4) | assistente SSE, ações, anexos, cota, telemetria | P | M / Backend (Gemini: decisão humana) | proposta/anexo de B negado; cota no tenant de GCI |
| S11 | WhatsApp do usuário `whatsapp/whatsapp.controller.ts` (inclui `POST /api/whatsapp/bridge`) | org | SupabaseAuth | GCI dentro das RPCs `lotti_*` | TenantDb; **ponte** HTTP (`whatsapp.service.ts:172-201`) | inbox, campanhas, envio | P | M / Backend | conversa de B negada. **Ponte:** mesmo `request_id` enviado 2× não duplica a mensagem (depende da ponte externa: condição de saída = contrato de idempotência da ponte documentado); `corretor_id` enviado à ponte é sempre o de GCI |
| S12 | Visitas do usuário `visitas/visitas.controller.ts` | org | SupabaseAuth | GCI | TenantDb | confirmar visita | P | M / Backend | visita de B não confirmada por A; visita confirmada na org selecionada |
| S13 | Notificações + SSE `notificacoes/*` | org (ponte compat.) | SupabaseAuth; SSE recusa token de suporte | GCI | TenantDb | alertas lidos; SSE (§5) | V | M / Backend (B5) | ver §5 |
| S14 | Central Comercial `central-comercial/*` | **pessoal / user por `owner_id`** (não tenant organizacional) | SupabaseAuth | `owner_id` = usuário (contrato F0, matriz #24-30) | TenantDb | CRUD genérico por `:tabela` | P | M / Produto+Backend | owner A não lê B; `:tabela` fora da allowlist negada. Compartilhamento organizacional só sob contrato próprio e checkpoint humano |
| S15 | Assinatura `assinatura/assinatura.*` | org | SupabaseAuth | GCI (`assinatura.service.ts:105`) | TenantDb | uso, cota, addons, conta antiga | P | B / Backend (Gate 6) | cota do corretor certo; sem mudança de semântica comercial |
| S16 | Onboarding/organização `assinatura/onboarding/*` | org/identity | SupabaseAuth | `auth.uid()` + memberships | TenantDb | perfil, convites, organização | P | A / Backend+Banco (B4) | aceite de convite em B com membership ativa em A (hoje revoga A, `0_init:1752`): RED em F1 |
| S17 | Auth/perfil `auth/*` | identity | público, exceto `/me` (`auth.controller.ts:73-74`) e perfil | — / GCI | Prisma (`auth/usuarios.repo.ts`) + TenantDb | sessão, cadastro (gatilho cria corretor/org) | P | M / Backend+Segurança | cadastro não dá acesso a org existente; refresh não troca org |
| S18 | Admin `parceiros/admin/*` | global | SupabaseAuth + `exigir_admin()` SQL (`admin.service.ts:55-59,440-442`) | — | TenantDb | backoffice | P | M / Segurança | membro de org sem papel global negado |
| S19 | Suporte `suporte/*` | global (suporte) | SupabaseAuth (admin) | alvo `corretor_id`/`usuario_id` | TenantDb + Prisma (`suporte.service.ts:166`) | abrir/encerrar sessão | P | A / Segurança | sessão exige org explícita (contrato F0 item 8) |
| S20 | Portal do parceiro `parceiros/parceiros.controller.ts` | global/parceiro | SupabaseAuth | `claims.sub` (parceiro) | TenantDb (`parceiros/portal/portal.service.ts:29-44`) | portal, repasse, convites, atribuição | P | B / Backend | parceiro A não lê nem altera repasse/teto do parceiro B; membro de org não vira parceiro |
| S21 | Arquivos `arquivos/*` | org/public | misto | prefixo ou RLS | TenantDb + Prisma (l.84) | Storage | V | ver §6 | ver §6 |
| S22 | Health `health/health.controller.ts` | global | nenhum | — | Prisma (l.13), consulta trivial | ping DB | V | I | **Dispensa:** não lê nem escreve dado de tenant. Condição: rever se a resposta passar a incluir dado |
| S23 | Catálogo `assinatura/catalogo.*` | public/global | nenhum | — | Prisma (`catalogo.repo.ts:15`) | lê planos, entitlements, campanha | P | I / Backend (Gate 6) | **Dispensa de teste de isolamento:** catálogo global sem dado de tenant. Necessário só: resposta não contém dado de assinatura de corretor. Condição: Gate 6 decidir catálogo por marca |
| S24 | Vitrine pública `imoveis/publico/*` | public | nenhum | **nenhuma** (`imoveis-publico.repo.ts:26-46,67-90`) | Prisma | leitura | V | **A (B2)** / Produto+Arquitetura+Backend | vitrine da org/marca A não lista imóvel de B |
| S25 | Lead público `crm/integracoes/captura-lead.*` | public | nenhum + limite | dono do imóvel ou **único corretor** (`captura-lead.repo.ts:13,31-41`) | Prisma | cliente, alerta ou `leads_sem_destino` | V | **A (B1)** / Produto+Backend | sem imóvel e 2+ corretores → `leads_sem_destino` (comportamento atual descrito em `captura-lead.service.ts:20-26`), nunca outro tenant; imóvel de B não cria lead em A |
| S26 | Fachada pública `fachadas/publico/*` | public | nenhum | a própria fachada (`fachadas-publico.repo.ts:38-59`) | Prisma | leitura, escaneamento, lead | V/P | M / Backend | lead da fachada vai ao tenant da fachada |
| S27 | Diagnóstico público `publico/diagnostico`, `diagnostico-comercial` | public (fora do tenant) | nenhum + limites | sessão pública | Prisma | sessão/lead público | P | B / Backend | limite por IP/sessão; nenhum dado de tenant exposto |
| S28 | Clique de parceiro `parceiros/publico/*` | public/parceiro | nenhum | slug + visitante; `user_id` só de claims (`parceiros-publico.repo.ts:11-12,56-64`) | Prisma | telemetria | V | B / Backend | slug revogado negado |
| S29 | Webhook Asaas `financeiro/asaas/asaas-webhook.*` | internal (org derivada) | slug + token da conexão (`asaas-webhook.service.ts:82-99`) | conexão do slug | ServicoDb | eventos, faturas, repasses | V | M / Backend (Asaas: decisão humana) | evento do slug A não altera fatura de B; replay → `duplicate` |
| S30 | Checkout `checkout/*` | internal / identity | CheckoutToken | e-mail/pedido; cria conta+corretor+org via gatilho | Prisma (§4) | pedidos, provisionamento | P | M / Backend (Gate 6) | reprovisionar não cria 2ª org; e-mail de outra conta → 409 |
| S31 | n8n `crm/integracoes/crm-n8n.*` | internal | segredo global | `corretor_id` do payload (só existência) ou **único corretor** (`crm-n8n.repo.ts:8-10,30-40`) | Prisma | cliente, vínculo, alerta, busca | V | **A (B1)** / Backend+Segurança | `corretor_id` de B com o segredo global → precisa credencial por tenant |
| S32 | Agente: visitas `visitas/agente-visitas.controller.ts` | internal | token global | `corretorId` do corpo conferido contra a conversa (`visitas.service.ts:38-45`) | Prisma + TenantDb (`visitas.repo.ts:32-70,107`) | consulta horários, marca e cancela visita | V | **A (B3)** / Backend+Segurança | conversa de A com `corretorId` de B → 403; horário marcado só na agenda do corretor da conversa; cancelar visita de outra conversa negado; e o vínculo emissor↔tenant (credencial por tenant) |
| S33 | Agente: storage `whatsapp/whatsapp-runtime.controller.ts` | internal | token global | **nenhuma** (`:7-37`) | Storage | inspect/sign/upload | V | **A (B3)** / Backend+Segurança | ver §6 |
| S34 | Worker `POST /api/diagnostico/manutencao` | internal/global | Bearer do worker (`:66-78`) | global (sessões públicas) | Prisma (`diagnostico-crescimento.repo.ts:57-58`) | marca abandonos, limpa contadores, drena e-mail | V | B / Backend | sem/errado Bearer → 401; corpo ≠ `{action:"maintenance"}` → 400; duas execuções concorrentes não duplicam notificação (lease em `diagnostic_claim_notifications`) |
| S35 | Google público `rotina/google/rotina-google-publico.*` | internal | `state` (callback) / hash do `x-goog-channel-token` (webhook) | conexão pelo `state`; canal → calendário → org | Prisma | conectar; importar eventos | P | M / Backend | `state` de A não conecta em B; token errado → 401; mensagem repetida → `duplicate` (`inserirRecibo`, `calendar_webhook_receipts` §8) |

### 2.2 Lista completa de handlers (gerada pelo Apêndice A.1: 286 handlers, 47 arquivos)

| # | Verbo | Rota | Guard | Arquivo:linha | Sup. |
|---:|---|---|---|---|---|
| 1 | GET | `/api/admin/acessos` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:227` | S18 |
| 2 | GET | `/api/admin/assinaturas` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:197` | S18 |
| 3 | GET | `/api/admin/atendimento` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:192` | S18 |
| 4 | GET | `/api/admin/auditoria` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:35` | S18 |
| 5 | POST | `/api/admin/auditoria` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:40` | S18 |
| 6 | GET | `/api/admin/cancelamentos` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:207` | S18 |
| 7 | POST | `/api/admin/cancelamentos` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:212` | S18 |
| 8 | GET | `/api/admin/comissoes` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:94` | S18 |
| 9 | POST | `/api/admin/comissoes/:id/status` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:99` | S18 |
| 10 | GET | `/api/admin/config` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:264` | S18 |
| 11 | POST | `/api/admin/config/:chave` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:277` | S18 |
| 12 | PUT | `/api/admin/config/:chave` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:269` | S18 |
| 13 | GET | `/api/admin/config/linhas` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:259` | S18 |
| 14 | GET | `/api/admin/diagnosticos` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:285` | S18 |
| 15 | PATCH | `/api/admin/diagnosticos/:id` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:290` | S18 |
| 16 | POST | `/api/admin/diagnosticos-crescimento` | SupabaseAuthGuard | `parceiros/admin/diagnosticos-crescimento.controller.ts:20` | S18 |
| 17 | GET | `/api/admin/integracoes` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:253` | S18 |
| 18 | POST | `/api/admin/links/:id/revogar` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:87` | S18 |
| 19 | GET | `/api/admin/lotes` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:136` | S18 |
| 20 | POST | `/api/admin/lotes` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:141` | S18 |
| 21 | GET | `/api/admin/lotes/:id` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:146` | S18 |
| 22 | POST | `/api/admin/lotes/:id/cancelar` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:165` | S18 |
| 23 | POST | `/api/admin/lotes/:id/exportado` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:151` | S18 |
| 24 | POST | `/api/admin/lotes/:id/pago` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:157` | S18 |
| 25 | GET | `/api/admin/metricas` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:248` | S18 |
| 26 | GET | `/api/admin/metricas/cancelamento` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:238` | S18 |
| 27 | GET | `/api/admin/metricas/onboarding` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:243` | S18 |
| 28 | GET | `/api/admin/metricas/saas` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:233` | S18 |
| 29 | GET | `/api/admin/organizacoes` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:217` | S18 |
| 30 | GET | `/api/admin/organizacoes/:id` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:222` | S18 |
| 31 | GET | `/api/admin/pagamentos` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:202` | S18 |
| 32 | POST | `/api/admin/pagamentos-parceiro` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:107` | S18 |
| 33 | GET | `/api/admin/papeis` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:30` | S18 |
| 34 | GET | `/api/admin/parceiros` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:51` | S18 |
| 35 | POST | `/api/admin/parceiros` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:56` | S18 |
| 36 | GET | `/api/admin/parceiros/:id` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:61` | S18 |
| 37 | PATCH | `/api/admin/parceiros/:id` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:66` | S18 |
| 38 | POST | `/api/admin/parceiros/:id/links` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:80` | S18 |
| 39 | POST | `/api/admin/parceiros/:id/percentuais` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:73` | S18 |
| 40 | GET | `/api/admin/parceiros/opcoes` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:46` | S18 |
| 41 | GET | `/api/admin/receita` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:112` | S18 |
| 42 | POST | `/api/admin/receita` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:117` | S18 |
| 43 | POST | `/api/admin/receita/:id/estornar` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:122` | S18 |
| 44 | GET | `/api/admin/repasses/elegiveis` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:131` | S18 |
| 45 | POST | `/api/admin/suporte/abrir` | SupabaseAuthGuard | `suporte/suporte.controller.ts:20` | S19 |
| 46 | POST | `/api/admin/suporte/encerrar` | SupabaseAuthGuard | `suporte/suporte.controller.ts:27` | S19 |
| 47 | GET | `/api/admin/usuarios` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:174` | S18 |
| 48 | GET | `/api/admin/usuarios/:corretorId` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:179` | S18 |
| 49 | POST | `/api/admin/usuarios/:corretorId/status` | SupabaseAuthGuard | `parceiros/admin/admin.controller.ts:184` | S18 |
| 50 | POST | `/api/agente/visitas` | AgentTokenGuard | `visitas/agente-visitas.controller.ts:15` | S32 |
| 51 | POST | `/api/agente/visitas/cancelar` | AgentTokenGuard | `visitas/agente-visitas.controller.ts:25` | S32 |
| 52 | POST | `/api/agente/visitas/horarios` | AgentTokenGuard | `visitas/agente-visitas.controller.ts:20` | S32 |
| 53 | GET | `/api/arquivos/anexo-ia/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:207` | S21 |
| 54 | DELETE | `/api/arquivos/documento/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:259` | S21 |
| 55 | GET | `/api/arquivos/documento/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:192` | S21 |
| 56 | PUT | `/api/arquivos/documento/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:150` | S21 |
| 57 | DELETE | `/api/arquivos/foto/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:241` | S21 |
| 58 | PUT | `/api/arquivos/foto/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:122` | S21 |
| 59 | GET | `/api/arquivos/inbox/:bucket/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:222` | S21 |
| 60 | PUT | `/api/arquivos/inbox/:bucket/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:175` | S21 |
| 61 | POST | `/api/arquivos/inbox/preparar` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:163` | S21 |
| 62 | GET | `/api/arquivos/publico/foto/*` | NENHUM | `arquivos/arquivos.controller.ts:96` | S21 |
| 63 | GET | `/api/arquivos/publico/video/*` | NENHUM | `arquivos/arquivos.controller.ts:108` | S21 |
| 64 | DELETE | `/api/arquivos/video/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:250` | S21 |
| 65 | PUT | `/api/arquivos/video/*` | SupabaseAuthGuard | `arquivos/arquivos.controller.ts:137` | S21 |
| 66 | GET | `/api/assinatura` | SupabaseAuthGuard | `assinatura/assinatura.controller.ts:16` | S15 |
| 67 | GET | `/api/assinatura/addons` | SupabaseAuthGuard | `assinatura/assinatura.controller.ts:26` | S15 |
| 68 | GET | `/api/assinatura/conta-antiga` | SupabaseAuthGuard | `assinatura/assinatura.controller.ts:31` | S15 |
| 69 | GET | `/api/assinatura/cota/:chave` | SupabaseAuthGuard | `assinatura/assinatura.controller.ts:36` | S15 |
| 70 | GET | `/api/assinatura/uso` | SupabaseAuthGuard | `assinatura/assinatura.controller.ts:21` | S15 |
| 71 | POST | `/api/auth/cadastro` | NENHUM | `auth/auth.controller.ts:49` | S17 |
| 72 | POST | `/api/auth/definir-senha` | NENHUM | `auth/auth.controller.ts:90` | S17 |
| 73 | POST | `/api/auth/forgot-password` | NENHUM | `auth/auth.controller.ts:80` | S17 |
| 74 | POST | `/api/auth/login` | NENHUM | `auth/auth.controller.ts:37` | S17 |
| 75 | POST | `/api/auth/logout` | NENHUM | `auth/auth.controller.ts:65` | S17 |
| 76 | GET | `/api/auth/me` | SupabaseAuthGuard | `auth/auth.controller.ts:73` | S17 |
| 77 | POST | `/api/auth/refresh` | NENHUM | `auth/auth.controller.ts:57` | S17 |
| 78 | POST | `/api/auth/reset-password` | NENHUM | `auth/auth.controller.ts:98` | S17 |
| 79 | GET | `/api/central-comercial/:tabela` | SupabaseAuthGuard | `central-comercial/central-comercial.controller.ts:16` | S14 |
| 80 | PATCH | `/api/central-comercial/:tabela` | SupabaseAuthGuard | `central-comercial/central-comercial.controller.ts:26` | S14 |
| 81 | POST | `/api/central-comercial/:tabela` | SupabaseAuthGuard | `central-comercial/central-comercial.controller.ts:21` | S14 |
| 82 | GET | `/api/checkout/contas` | CheckoutTokenGuard | `checkout/checkout.controller.ts:93` | S30 |
| 83 | POST | `/api/checkout/eventos/concluir` | CheckoutTokenGuard | `checkout/checkout.controller.ts:86` | S30 |
| 84 | POST | `/api/checkout/eventos/reservar` | CheckoutTokenGuard | `checkout/checkout.controller.ts:79` | S30 |
| 85 | POST | `/api/checkout/limite` | CheckoutTokenGuard | `checkout/checkout.controller.ts:22` | S30 |
| 86 | GET | `/api/checkout/pedidos` | CheckoutTokenGuard | `checkout/checkout.controller.ts:35` | S30 |
| 87 | POST | `/api/checkout/pedidos` | CheckoutTokenGuard | `checkout/checkout.controller.ts:28` | S30 |
| 88 | GET | `/api/checkout/pedidos/:id` | CheckoutTokenGuard | `checkout/checkout.controller.ts:40` | S30 |
| 89 | PATCH | `/api/checkout/pedidos/:id` | CheckoutTokenGuard | `checkout/checkout.controller.ts:45` | S30 |
| 90 | POST | `/api/checkout/pedidos/:id/link-senha` | CheckoutTokenGuard | `checkout/checkout.controller.ts:72` | S30 |
| 91 | POST | `/api/checkout/pedidos/:id/pagamento` | CheckoutTokenGuard | `checkout/checkout.controller.ts:51` | S30 |
| 92 | POST | `/api/checkout/pedidos/:id/provisionamento/reservar` | CheckoutTokenGuard | `checkout/checkout.controller.ts:58` | S30 |
| 93 | POST | `/api/checkout/pedidos/:id/provisionar` | CheckoutTokenGuard | `checkout/checkout.controller.ts:65` | S30 |
| 94 | GET | `/api/clientes` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:26` | S01 |
| 95 | POST | `/api/clientes` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:42` | S01 |
| 96 | DELETE | `/api/clientes/:id` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:64` | S01 |
| 97 | GET | `/api/clientes/:id` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:54` | S01 |
| 98 | PATCH | `/api/clientes/:id` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:59` | S01 |
| 99 | POST | `/api/clientes/:id/completar-cpf` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:84` | S01 |
| 100 | GET | `/api/clientes/:id/historico` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:90` | S01 |
| 101 | POST | `/api/clientes/:id/historico` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:95` | S01 |
| 102 | PUT | `/api/clientes/:id/imovel-interesse` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:75` | S01 |
| 103 | PATCH | `/api/clientes/:id/status` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:70` | S01 |
| 104 | GET | `/api/clientes/candidatos` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:31` | S01 |
| 105 | POST | `/api/clientes/converter-lead` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:48` | S01 |
| 106 | GET | `/api/clientes/historico` | SupabaseAuthGuard | `crm/clientes/crm-clientes.controller.ts:37` | S01 |
| 107 | GET | `/api/contratos` | SupabaseAuthGuard | `contratos/contratos.controller.ts:19` | S04 |
| 108 | POST | `/api/contratos` | SupabaseAuthGuard | `contratos/contratos.controller.ts:45` | S04 |
| 109 | DELETE | `/api/contratos/:id` | SupabaseAuthGuard | `contratos/contratos.controller.ts:64` | S04 |
| 110 | PATCH | `/api/contratos/:id` | SupabaseAuthGuard | `contratos/contratos.controller.ts:59` | S04 |
| 111 | PATCH | `/api/contratos/:id/locacao` | SupabaseAuthGuard | `contratos/contratos.controller.ts:50` | S04 |
| 112 | GET | `/api/contratos/central` | SupabaseAuthGuard | `contratos/contratos.controller.ts:24` | S04 |
| 113 | POST | `/api/contratos/ia/analisar` | SupabaseAuthGuard | `contratos/contratos-ia.controller.ts:19` | S04 |
| 114 | POST | `/api/contratos/ia/gerar` | SupabaseAuthGuard | `contratos/contratos-ia.controller.ts:13` | S04 |
| 115 | GET | `/api/contratos/locacao` | SupabaseAuthGuard | `contratos/contratos.controller.ts:29` | S04 |
| 116 | POST | `/api/contratos/locacao` | SupabaseAuthGuard | `contratos/contratos.controller.ts:40` | S04 |
| 117 | POST | `/api/contratos/por-clientes` | SupabaseAuthGuard | `contratos/contratos.controller.ts:34` | S04 |
| 118 | GET | `/api/crm/etapas` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:18` | S02 |
| 119 | PATCH | `/api/crm/etapas` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:23` | S02 |
| 120 | GET | `/api/crm/oportunidades` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:28` | S02 |
| 121 | POST | `/api/crm/oportunidades` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:33` | S02 |
| 122 | PATCH | `/api/crm/oportunidades/:id/mover` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:44` | S02 |
| 123 | POST | `/api/crm/oportunidades/excluir` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:38` | S02 |
| 124 | GET | `/api/crm/tarefas` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:51` | S02 |
| 125 | POST | `/api/crm/tarefas` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:56` | S02 |
| 126 | PATCH | `/api/crm/tarefas/:id/concluir` | SupabaseAuthGuard | `crm/funil/crm-funil.controller.ts:61` | S02 |
| 127 | POST | `/api/diagnostico/manutencao` | NENHUM | `diagnostico-crescimento/diagnostico-crescimento.controller.ts:66` | S34 |
| 128 | POST | `/api/diagnostico-comercial` | NENHUM | `parceiros/diagnostico/diagnostico-publico.controller.ts:23` | S27 |
| 129 | GET | `/api/documentos` | SupabaseAuthGuard | `contratos/documentos.controller.ts:15` | S04 |
| 130 | POST | `/api/documentos` | SupabaseAuthGuard | `contratos/documentos.controller.ts:20` | S04 |
| 131 | DELETE | `/api/documentos/:id` | SupabaseAuthGuard | `contratos/documentos.controller.ts:30` | S04 |
| 132 | PATCH | `/api/documentos/:id` | SupabaseAuthGuard | `contratos/documentos.controller.ts:25` | S04 |
| 133 | GET | `/api/fachadas` | SupabaseAuthGuard | `fachadas/fachadas.controller.ts:19` | S07 |
| 134 | POST | `/api/fachadas` | SupabaseAuthGuard | `fachadas/fachadas.controller.ts:24` | S07 |
| 135 | DELETE | `/api/fachadas/:id` | SupabaseAuthGuard | `fachadas/fachadas.controller.ts:34` | S07 |
| 136 | PATCH | `/api/fachadas/:id` | SupabaseAuthGuard | `fachadas/fachadas.controller.ts:29` | S07 |
| 137 | GET | `/api/fachadas/leads` | SupabaseAuthGuard | `fachadas/fachadas-leads.controller.ts:15` | S07 |
| 138 | DELETE | `/api/fachadas/leads/:id` | SupabaseAuthGuard | `fachadas/fachadas-leads.controller.ts:20` | S07 |
| 139 | GET | `/api/fachadas/metricas` | SupabaseAuthGuard | `fachadas/fachadas-metricas.controller.ts:13` | S07 |
| 140 | GET | `/api/fachadas/midias/:imovelId` | SupabaseAuthGuard | `fachadas/fachadas-midias.controller.ts:13` | S07 |
| 141 | GET | `/api/fachadas/templates` | SupabaseAuthGuard | `fachadas/fachadas-templates.controller.ts:21` | S07 |
| 142 | POST | `/api/fachadas/templates` | SupabaseAuthGuard | `fachadas/fachadas-templates.controller.ts:26` | S07 |
| 143 | DELETE | `/api/fachadas/templates/:id` | SupabaseAuthGuard | `fachadas/fachadas-templates.controller.ts:31` | S07 |
| 144 | GET | `/api/fachadas/templates/por-imagem` | SupabaseAuthGuard | `fachadas/fachadas-templates.controller.ts:16` | S07 |
| 145 | DELETE | `/api/financeiro/asaas/conexao` | SupabaseAuthGuard | `financeiro/asaas/asaas-conexao.controller.ts:25` | S06 |
| 146 | GET | `/api/financeiro/asaas/conexao` | SupabaseAuthGuard | `financeiro/asaas/asaas-conexao.controller.ts:14` | S06 |
| 147 | POST | `/api/financeiro/asaas/conexao` | SupabaseAuthGuard | `financeiro/asaas/asaas-conexao.controller.ts:19` | S06 |
| 148 | GET | `/api/financeiro/asaas/saldo` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:27` | S05 |
| 149 | POST | `/api/financeiro/asaas/webhook` | NENHUM | `financeiro/asaas/asaas-webhook.controller.ts:10` | S29 |
| 150 | GET | `/api/financeiro/contratos-ativos` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:17` | S05 |
| 151 | GET | `/api/financeiro/faturas` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:32` | S05 |
| 152 | POST | `/api/financeiro/faturas` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:37` | S05 |
| 153 | POST | `/api/financeiro/faturas/:id/asaas` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:72` | S05 |
| 154 | POST | `/api/financeiro/faturas/:id/baixa` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:48` | S05 |
| 155 | POST | `/api/financeiro/faturas/:id/cancelar` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:60` | S05 |
| 156 | POST | `/api/financeiro/faturas/:id/estorno` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:54` | S05 |
| 157 | POST | `/api/financeiro/faturas/:id/reativar` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:66` | S05 |
| 158 | PATCH | `/api/financeiro/faturas/:id/vencimento` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:43` | S05 |
| 159 | GET | `/api/financeiro/lancamentos` | SupabaseAuthGuard | `financeiro/lancamentos.controller.ts:16` | S05 |
| 160 | POST | `/api/financeiro/lancamentos` | SupabaseAuthGuard | `financeiro/lancamentos.controller.ts:21` | S05 |
| 161 | DELETE | `/api/financeiro/lancamentos/:id` | SupabaseAuthGuard | `financeiro/lancamentos.controller.ts:31` | S05 |
| 162 | PATCH | `/api/financeiro/lancamentos/:id` | SupabaseAuthGuard | `financeiro/lancamentos.controller.ts:26` | S05 |
| 163 | GET | `/api/financeiro/locacao/resumo` | SupabaseAuthGuard | `financeiro/faturas.controller.ts:22` | S05 |
| 164 | GET | `/api/financeiro/repasses` | SupabaseAuthGuard | `financeiro/repasses.controller.ts:14` | S05 |
| 165 | POST | `/api/financeiro/repasses/:id/confirmar` | SupabaseAuthGuard | `financeiro/repasses.controller.ts:19` | S05 |
| 166 | GET | `/api/google-agenda/callback` | NENHUM | `rotina/google/rotina-google-publico.controller.ts:10` | S35 |
| 167 | POST | `/api/google-agenda/webhook` | NENHUM | `rotina/google/rotina-google-publico.controller.ts:15` | S35 |
| 168 | GET | `/api/health` | NENHUM | `health/health.controller.ts:9` | S22 |
| 169 | POST | `/api/ia/acao` | SupabaseAuthGuard | `ia/ia.controller.ts:84` | S10 |
| 170 | POST | `/api/ia/analisar-foto` | SupabaseAuthGuard | `ia/ia.controller.ts:103` | S10 |
| 171 | POST | `/api/ia/analisar-fotos-imovel` | SupabaseAuthGuard | `ia/ia.controller.ts:109` | S10 |
| 172 | POST | `/api/ia/anexos` | SupabaseAuthGuard | `ia/ia.controller.ts:91` | S10 |
| 173 | POST | `/api/ia/assistente` | SupabaseAuthGuard | `ia/ia.controller.ts:59` | S10 |
| 174 | GET | `/api/ia/conversas` | SupabaseAuthGuard | `ia/ia-conversas.controller.ts:17` | S10 |
| 175 | DELETE | `/api/ia/conversas/:id` | SupabaseAuthGuard | `ia/ia-conversas.controller.ts:32` | S10 |
| 176 | PATCH | `/api/ia/conversas/:id` | SupabaseAuthGuard | `ia/ia-conversas.controller.ts:27` | S10 |
| 177 | GET | `/api/ia/conversas/:id/mensagens` | SupabaseAuthGuard | `ia/ia-conversas.controller.ts:22` | S10 |
| 178 | PATCH | `/api/ia/imoveis/:id/descricao` | SupabaseAuthGuard | `ia/ia.controller.ts:115` | S10 |
| 179 | POST | `/api/ia/mensagem-whatsapp` | SupabaseAuthGuard | `ia/ia.controller.ts:120` | S10 |
| 180 | POST | `/api/ia/sugestao-inbox` | SupabaseAuthGuard | `ia/ia.controller.ts:131` | S10 |
| 181 | GET | `/api/ia/sugestao-inbox/imoveis` | SupabaseAuthGuard | `ia/ia.controller.ts:126` | S10 |
| 182 | GET | `/api/imoveis` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:30` | S03 |
| 183 | POST | `/api/imoveis` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:35` | S03 |
| 184 | DELETE | `/api/imoveis/:id` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:55` | S03 |
| 185 | GET | `/api/imoveis/:id` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:40` | S03 |
| 186 | PATCH | `/api/imoveis/:id` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:50` | S03 |
| 187 | GET | `/api/imoveis/:id/clientes-interessados` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:45` | S03 |
| 188 | GET | `/api/imoveis/:id/fotos` | SupabaseAuthGuard | `imoveis/imoveis-fotos.controller.ts:33` | S03 |
| 189 | POST | `/api/imoveis/:id/fotos` | SupabaseAuthGuard | `imoveis/imoveis-fotos.controller.ts:38` | S03 |
| 190 | PATCH | `/api/imoveis/:id/fotos/:fotoId/principal` | SupabaseAuthGuard | `imoveis/imoveis-fotos.controller.ts:48` | S03 |
| 191 | PATCH | `/api/imoveis/:id/fotos/ordem` | SupabaseAuthGuard | `imoveis/imoveis-fotos.controller.ts:43` | S03 |
| 192 | POST | `/api/imoveis/:id/venda` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:61` | S03 |
| 193 | POST | `/api/imoveis/:id/venda/evento` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:68` | S03 |
| 194 | GET | `/api/imoveis/busca` | SupabaseAuthGuard | `imoveis/imoveis.controller.ts:25` | S03 |
| 195 | DELETE | `/api/imoveis/fotos/:fotoId` | SupabaseAuthGuard | `imoveis/imoveis-fotos.controller.ts:27` | S03 |
| 196 | POST | `/api/imoveis/fotos/resumo` | SupabaseAuthGuard | `imoveis/imoveis-fotos.controller.ts:21` | S03 |
| 197 | POST | `/api/integracoes/n8n/crm-anexar-historico` | N8nSegredoGuard | `crm/integracoes/crm-n8n.controller.ts:35` | S31 |
| 198 | GET | `/api/integracoes/n8n/crm-buscar-imoveis` | N8nSegredoGuard | `crm/integracoes/crm-n8n.controller.ts:24` | S31 |
| 199 | POST | `/api/integracoes/n8n/crm-buscar-imoveis` | N8nSegredoGuard | `crm/integracoes/crm-n8n.controller.ts:29` | S31 |
| 200 | POST | `/api/integracoes/n8n/crm-upsert-lead` | N8nSegredoGuard | `crm/integracoes/crm-n8n.controller.ts:17` | S31 |
| 201 | GET | `/api/notificacoes` | SupabaseAuthGuard | `notificacoes/notificacoes.controller.ts:25` | S13 |
| 202 | SSE | `/api/notificacoes/eventos` | SupabaseAuthGuard | `notificacoes/notificacoes.controller.ts:40` | S13 |
| 203 | POST | `/api/notificacoes/lidas` | SupabaseAuthGuard | `notificacoes/notificacoes.controller.ts:30` | S13 |
| 204 | POST | `/api/onboarding/acoes` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:31` | S16 |
| 205 | PATCH | `/api/onboarding/checklist` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:49` | S16 |
| 206 | GET | `/api/onboarding/contexto` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:20` | S16 |
| 207 | POST | `/api/onboarding/convites` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:61` | S16 |
| 208 | POST | `/api/onboarding/convites/aceitar` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:67` | S16 |
| 209 | POST | `/api/onboarding/eventos` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:37` | S16 |
| 210 | PATCH | `/api/onboarding/organizacoes/:id` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:73` | S16 |
| 211 | PATCH | `/api/onboarding/perfil` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:55` | S16 |
| 212 | POST | `/api/onboarding/salvar` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:25` | S16 |
| 213 | PUT | `/api/onboarding/tours` | SupabaseAuthGuard | `assinatura/onboarding/onboarding.controller.ts:43` | S16 |
| 214 | POST | `/api/parceiros/atribuicao` | SupabaseAuthGuard | `parceiros/parceiros.controller.ts:21` | S20 |
| 215 | POST | `/api/parceiros/clique` | NENHUM | `parceiros/publico/parceiros-publico.controller.ts:10` | S28 |
| 216 | POST | `/api/parceiros/convites` | SupabaseAuthGuard | `parceiros/parceiros.controller.ts:38` | S20 |
| 217 | GET | `/api/parceiros/portal` | SupabaseAuthGuard | `parceiros/parceiros.controller.ts:27` | S20 |
| 218 | PUT | `/api/parceiros/portal/repasse` | SupabaseAuthGuard | `parceiros/parceiros.controller.ts:32` | S20 |
| 219 | POST | `/api/perfil/atividade` | SupabaseAuthGuard | `auth/perfil.controller.ts:30` | S17 |
| 220 | GET | `/api/perfil/corretor` | SupabaseAuthGuard | `auth/perfil.controller.ts:19` | S17 |
| 221 | PATCH | `/api/perfil/corretor` | SupabaseAuthGuard | `auth/perfil.controller.ts:24` | S17 |
| 222 | GET | `/api/planos` | NENHUM | `assinatura/catalogo.controller.ts:10` | S23 |
| 223 | GET | `/api/planos/campanha` | NENHUM | `assinatura/catalogo.controller.ts:20` | S23 |
| 224 | GET | `/api/planos/entitlements` | NENHUM | `assinatura/catalogo.controller.ts:15` | S23 |
| 225 | POST | `/api/publico/diagnostico` | NENHUM | `diagnostico-crescimento/diagnostico-crescimento.controller.ts:41` | S27 |
| 226 | GET | `/api/publico/fachadas/:id` | NENHUM | `fachadas/publico/fachadas-publico.controller.ts:16` | S26 |
| 227 | POST | `/api/publico/fachadas/:id/escaneamentos` | NENHUM | `fachadas/publico/fachadas-publico.controller.ts:22` | S26 |
| 228 | POST | `/api/publico/fachadas/:id/leads` | NENHUM | `fachadas/publico/fachadas-publico.controller.ts:28` | S26 |
| 229 | GET | `/api/publico/imoveis` | NENHUM | `imoveis/publico/imoveis-publico.controller.ts:17` | S24 |
| 230 | GET | `/api/publico/imoveis/detalhe` | NENHUM | `imoveis/publico/imoveis-publico.controller.ts:23` | S24 |
| 231 | POST | `/api/publico/leads` | NENHUM | `crm/integracoes/captura-lead.controller.ts:17` | S25 |
| 232 | GET | `/api/rotina/atividade` | SupabaseAuthGuard | `rotina/rotina.controller.ts:41` | S08 |
| 233 | POST | `/api/rotina/comando` | SupabaseAuthGuard | `rotina/rotina.controller.ts:110` | S08 |
| 234 | POST | `/api/rotina/conflitos` | SupabaseAuthGuard | `rotina/rotina.controller.ts:62` | S08 |
| 235 | GET | `/api/rotina/contexto` | SupabaseAuthGuard | `rotina/rotina.controller.ts:21` | S08 |
| 236 | GET | `/api/rotina/eventos` | SupabaseAuthGuard | `rotina/rotina.controller.ts:31` | S08 |
| 237 | POST | `/api/rotina/eventos` | SupabaseAuthGuard | `rotina/rotina.controller.ts:68` | S08 |
| 238 | DELETE | `/api/rotina/eventos/:id` | SupabaseAuthGuard | `rotina/rotina.controller.ts:100` | S08 |
| 239 | PATCH | `/api/rotina/eventos/:id` | SupabaseAuthGuard | `rotina/rotina.controller.ts:78` | S08 |
| 240 | POST | `/api/rotina/eventos/:id/concluir` | SupabaseAuthGuard | `rotina/rotina.controller.ts:88` | S08 |
| 241 | GET | `/api/rotina/google/calendarios` | SupabaseAuthGuard | `rotina/google/rotina-google.controller.ts:39` | S09 |
| 242 | PATCH | `/api/rotina/google/calendarios/:id` | SupabaseAuthGuard | `rotina/google/rotina-google.controller.ts:44` | S09 |
| 243 | POST | `/api/rotina/google/conectar` | SupabaseAuthGuard | `rotina/google/rotina-google.controller.ts:22` | S09 |
| 244 | POST | `/api/rotina/google/desconectar` | SupabaseAuthGuard | `rotina/google/rotina-google.controller.ts:28` | S09 |
| 245 | PATCH | `/api/rotina/google/privacidade` | SupabaseAuthGuard | `rotina/google/rotina-google.controller.ts:34` | S09 |
| 246 | POST | `/api/rotina/google/sincronizar` | SupabaseAuthGuard | `rotina/google/rotina-google.controller.ts:51` | S09 |
| 247 | GET | `/api/rotina/google/status` | SupabaseAuthGuard | `rotina/google/rotina-google.controller.ts:17` | S09 |
| 248 | GET | `/api/rotina/inbox` | SupabaseAuthGuard | `rotina/rotina.controller.ts:46` | S08 |
| 249 | POST | `/api/rotina/inbox` | SupabaseAuthGuard | `rotina/rotina.controller.ts:51` | S08 |
| 250 | POST | `/api/rotina/inbox/:id/arquivar` | SupabaseAuthGuard | `rotina/rotina.controller.ts:56` | S08 |
| 251 | GET | `/api/rotina/membros` | SupabaseAuthGuard | `rotina/rotina.controller.ts:26` | S08 |
| 252 | GET | `/api/rotina/tarefas` | SupabaseAuthGuard | `rotina/rotina.controller.ts:36` | S08 |
| 253 | POST | `/api/rotina/tarefas` | SupabaseAuthGuard | `rotina/rotina.controller.ts:73` | S08 |
| 254 | DELETE | `/api/rotina/tarefas/:id` | SupabaseAuthGuard | `rotina/rotina.controller.ts:105` | S08 |
| 255 | PATCH | `/api/rotina/tarefas/:id` | SupabaseAuthGuard | `rotina/rotina.controller.ts:83` | S08 |
| 256 | POST | `/api/rotina/tarefas/:id/concluir` | SupabaseAuthGuard | `rotina/rotina.controller.ts:94` | S08 |
| 257 | POST | `/api/visitas/:visitaId/confirmar` | SupabaseAuthGuard | `visitas/visitas.controller.ts:12` | S12 |
| 258 | POST | `/api/whatsapp/bridge` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:13` | S11 |
| 259 | GET | `/api/whatsapp/broadcasts` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:29` | S11 |
| 260 | DELETE | `/api/whatsapp/broadcasts/:id` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:37` | S11 |
| 261 | GET | `/api/whatsapp/broadcasts/:id` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:31` | S11 |
| 262 | POST | `/api/whatsapp/broadcasts/:id/ativar` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:34` | S11 |
| 263 | POST | `/api/whatsapp/broadcasts/:id/controlar` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:35` | S11 |
| 264 | POST | `/api/whatsapp/broadcasts/:id/duplicar` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:36` | S11 |
| 265 | GET | `/api/whatsapp/broadcasts/automacao` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:30` | S11 |
| 266 | POST | `/api/whatsapp/broadcasts/preview` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:33` | S11 |
| 267 | POST | `/api/whatsapp/broadcasts/salvar` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:32` | S11 |
| 268 | GET | `/api/whatsapp/canal` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:25` | S11 |
| 269 | PATCH | `/api/whatsapp/canal/empresa` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:26` | S11 |
| 270 | GET | `/api/whatsapp/configuracoes` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:27` | S11 |
| 271 | PUT | `/api/whatsapp/configuracoes` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:28` | S11 |
| 272 | GET | `/api/whatsapp/conversas` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:14` | S11 |
| 273 | PATCH | `/api/whatsapp/conversas/:id/contato` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:22` | S11 |
| 274 | GET | `/api/whatsapp/conversas/:id/eventos` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:18` | S11 |
| 275 | POST | `/api/whatsapp/conversas/:id/limpar-opt-out` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:21` | S11 |
| 276 | GET | `/api/whatsapp/conversas/:id/mensagens` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:17` | S11 |
| 277 | PATCH | `/api/whatsapp/conversas/:id/modo` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:19` | S11 |
| 278 | POST | `/api/whatsapp/conversas/:id/reconciliar` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:20` | S11 |
| 279 | PATCH | `/api/whatsapp/conversas/:id/status` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:24` | S11 |
| 280 | GET | `/api/whatsapp/conversas/contagem` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:15` | S11 |
| 281 | POST | `/api/whatsapp/conversas/mesclar` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:23` | S11 |
| 282 | GET | `/api/whatsapp/esperando` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:38` | S11 |
| 283 | GET | `/api/whatsapp/mensagens/ultimas` | SupabaseAuthGuard | `whatsapp/whatsapp.controller.ts:16` | S11 |
| 284 | PUT | `/api/whatsapp/runtime/storage/:bucket/*` | AgentTokenGuard | `whatsapp/whatsapp-runtime.controller.ts:32` | S33 |
| 285 | POST | `/api/whatsapp/runtime/storage/:bucket/inspect/*` | AgentTokenGuard | `whatsapp/whatsapp-runtime.controller.ts:19` | S33 |
| 286 | POST | `/api/whatsapp/runtime/storage/:bucket/sign/*` | AgentTokenGuard | `whatsapp/whatsapp-runtime.controller.ts:26` | S33 |

## 3. Funções SQL/RPC chamadas pela API (gerada pelo Apêndice A.2: 105 funções)

Corpos, RLS, grants e `search_path` ficam com Segurança (R6). A coluna Recurso/model/pai é derivada do nome da função e do consumidor; as tabelas efetivamente tocadas no corpo SQL são NV. Os donos são atribuição operacional desta onda.

| # | Função | Consumidor(es) | Camada | Recurso / model / pai | Dono da classificação | Cenário futuro ou bloqueio |
|---:|---|---|---|---|---|---|
| 1 | `aceitar_convite_organizacao` | `assinatura/onboarding/onboarding.service.ts:172` | TenantDb | OrganizacaoConvite → RoutineOrganization; RoutineMembership; OnboardingProfile | Banco+Backend | Aceitar convite de B com membership ativa em A (hoje revoga A, 0_init:1752) — RED em F1; criar convite só com capability aprovada. |
| 2 | `admin_cancelar_lote` | `parceiros/admin/admin.service.ts:272` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 3 | `admin_criar_parceiro_completo` | `parceiros/convite/convite.service.ts:111` | TenantDb (admin) | Parceiro/ParceiroLink/ParceiroPercentual (global) | Segurança | Só admin; parceiro não vira membro de org. |
| 4 | `admin_definir_percentual` | `parceiros/admin/admin.service.ts:167` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 5 | `admin_definir_status_corretor` | `parceiros/admin/admin.service.ts:292` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 6 | `admin_detalhe_lote` | `parceiros/admin/admin.service.ts:250` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 7 | `admin_detalhe_organizacao` | `parceiros/admin/admin.service.ts:340` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 8 | `admin_detalhe_usuario` | `parceiros/admin/admin.service.ts:287` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 9 | `admin_estornar_receita` | `parceiros/admin/admin.service.ts:232` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 10 | `admin_gerar_lote_repasse` | `parceiros/admin/admin.service.ts:255` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 11 | `admin_listar_acessos` | `parceiros/admin/admin.service.ts:346` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 12 | `admin_listar_assinaturas` | `parceiros/admin/admin.service.ts:305` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 13 | `admin_listar_atendimento` | `parceiros/admin/admin.service.ts:298` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 14 | `admin_listar_auditoria` | `parceiros/admin/admin.service.ts:80` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 15 | `admin_listar_cancelamentos` | `parceiros/admin/admin.service.ts:319` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 16 | `admin_listar_comissoes` | `parceiros/admin/admin.service.ts:200` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 17 | `admin_listar_config` | `parceiros/admin/admin.service.ts:381` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 18 | `admin_listar_lotes` | `parceiros/admin/admin.service.ts:245` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 19 | `admin_listar_organizacoes` | `parceiros/admin/admin.service.ts:334` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 20 | `admin_listar_pagamentos` | `parceiros/admin/admin.service.ts:312` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 21 | `admin_listar_parceiros` | `parceiros/admin/admin.service.ts:99` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 22 | `admin_listar_receita` | `parceiros/admin/admin.service.ts:219` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 23 | `admin_listar_usuarios` | `parceiros/admin/admin.service.ts:280` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 24 | `admin_marcar_lote_exportado` | `parceiros/admin/admin.service.ts:261` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 25 | `admin_marcar_lote_pago` | `parceiros/admin/admin.service.ts:266` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 26 | `admin_metricas_cancelamento` | `parceiros/admin/admin.service.ts:363` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 27 | `admin_metricas_saas` | `parceiros/admin/admin.service.ts:358` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 28 | `admin_metricas_visao_geral` | `parceiros/admin/admin.service.ts:353` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 29 | `admin_onboarding_metricas` | `parceiros/admin/admin.service.ts:368` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 30 | `admin_opcoes_parceiros` | `parceiros/admin/admin.service.ts:105` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 31 | `admin_parceiros_elegiveis_repasse` | `parceiros/admin/admin.service.ts:239` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 32 | `admin_preparar_suporte` | `suporte/suporte.service.ts:186` | TenantDb (admin) | AdminSessaoSuporte → Corretor | Segurança | Sessão de suporte exige organização explícita (contrato F0 item 8). |
| 33 | `admin_registrar_cancelamento` | `parceiros/admin/admin.service.ts:325` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 34 | `admin_registrar_pagamento` | `parceiros/admin/admin.service.ts:211` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 35 | `admin_registrar_receita` | `parceiros/admin/admin.service.ts:225` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 36 | `admin_salvar_config` | `parceiros/admin/admin.service.ts:409` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 37 | `admin_status_integracoes` | `parceiros/admin/admin.service.ts:373` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 38 | `admin_transicionar_comissao` | `parceiros/admin/admin.service.ts:206` | TenantDb (admin) | Backoffice global (Parceiro*, ReceitaEvento, Subscription, Corretor, RoutineOrganization, AdminConfig — por função) | Segurança | Regressão: não-admin negado; admin não ganha acesso operacional por membership. |
| 39 | `apply_checkout_payment` | `checkout/checkout.repo.ts:168` | Prisma | AsaasCheckoutEvent / CheckoutOrder / CheckoutPayment / Subscription | Backend (Gate 6; Asaas sob decisão humana) | Replay do evento → já reservado; reprovisionar não cria 2ª org; e-mail de outra conta → 409. |
| 40 | `checar_cota` | `assinatura/assinatura.service.ts:109`, `ia/cotas.ts:32`, `ia/cotas.ts:43` | TenantDb (assinatura) / Prisma (ia/cotas) | Subscription/PlanEntitlement/UsageCounter (pai: corretor) | Backend (Gate 6) | Cota consultada do corretor resolvido por GCI; corretorId nunca do corpo. Semântica de quota só sob Gate 6. |
| 41 | `claim_asaas_checkout_event` | `checkout/checkout.repo.ts:138` | Prisma | AsaasCheckoutEvent / CheckoutOrder / CheckoutPayment / Subscription | Backend (Gate 6; Asaas sob decisão humana) | Replay do evento → já reservado; reprovisionar não cria 2ª org; e-mail de outra conta → 409. |
| 42 | `claim_checkout_order_provisioning` | `checkout/checkout.repo.ts:152` | Prisma | AsaasCheckoutEvent / CheckoutOrder / CheckoutPayment / Subscription | Backend (Gate 6; Asaas sob decisão humana) | Replay do evento → já reservado; reprovisionar não cria 2ª org; e-mail de outra conta → 409. |
| 43 | `conciliar_transferencia_repasse` | `financeiro/asaas/asaas-webhook.service.ts:234` | ServicoDb | RepasseProprietario / Alerta (pai: corretor da conexão) | Backend (Asaas sob decisão humana) | Transferência do slug A não concilia repasse de B. |
| 44 | `consume_checkout_rate_limit` | `checkout/checkout.repo.ts:88` | Prisma | PublicRequestLimit / CheckoutRateLimit (público) | Backend | Limite por chave HMAC; excesso → 429. |
| 45 | `consume_public_lead_limit` | `crm/integracoes/captura-lead.repo.ts:27`, `parceiros/diagnostico/diagnostico.repo.ts:43` | Prisma | PublicRequestLimit / CheckoutRateLimit (público) | Backend | Limite por chave HMAC; excesso → 429. |
| 46 | `consume_public_request_limit` | `auth/usuarios.repo.ts:263`, `parceiros/diagnostico/diagnostico.repo.ts:37` | Prisma | PublicRequestLimit / CheckoutRateLimit (público) | Backend | Limite por chave HMAC; excesso → 429. |
| 47 | `conta_antiga_sem_limite` | `assinatura/assinatura.service.ts:98` | TenantDb | BillingLegacyAccount (pai: corretor) | Backend (Gate 6) | Preservar regra atual; mudança só sob Gate 6. |
| 48 | `criar_convite_organizacao` | `assinatura/onboarding/onboarding.service.ts:164` | TenantDb | OrganizacaoConvite → RoutineOrganization; RoutineMembership; OnboardingProfile | Banco+Backend | Aceitar convite de B com membership ativa em A (hoje revoga A, 0_init:1752) — RED em F1; criar convite só com capability aprovada. |
| 49 | `crm_clientes_por_telefone` | `crm/clientes/crm-clientes.service.ts:58` | TenantDb | Cliente / CrmOportunidade / CrmEtapa / FachadaLead (pai: corretor) | Backend | Telefone de cliente de B não é encontrado/convertido em A; cliente criado no tenant selecionado. |
| 50 | `crm_converter_lead` | `crm/clientes/crm-clientes.service.ts:74` | TenantDb | Cliente / CrmOportunidade / CrmEtapa / FachadaLead (pai: corretor) | Backend | Telefone de cliente de B não é encontrado/convertido em A; cliente criado no tenant selecionado. |
| 51 | `crm_criar_cliente` | `crm/clientes/crm-clientes.service.ts:65`, `ia/executar-acao.ts:56` | TenantDb | Cliente / CrmOportunidade / CrmEtapa / FachadaLead (pai: corretor) | Backend | Telefone de cliente de B não é encontrado/convertido em A; cliente criado no tenant selecionado. |
| 52 | `diagnostic_admin_detail` | `parceiros/admin/diagnosticos-crescimento.service.ts:72` | TenantDb (admin) | Diagnostic* (público, leitura admin) | Segurança | Só admin. |
| 53 | `diagnostic_admin_follow_up` | `parceiros/admin/diagnosticos-crescimento.service.ts:79` | TenantDb (admin) | Diagnostic* (público, leitura admin) | Segurança | Só admin. |
| 54 | `diagnostic_admin_list` | `parceiros/admin/diagnosticos-crescimento.service.ts:63` | TenantDb (admin) | Diagnostic* (público, leitura admin) | Segurança | Só admin. |
| 55 | `diagnostic_claim_notifications` | `diagnostico-crescimento/diagnostico-crescimento.repo.ts:48` | Prisma | DiagnosticSession/Answer/Event/Notification/AiBudget/RateLimit (público) | Backend | Sessão/token público; nenhum dado de tenant exposto; limite por IP/sessão. |
| 56 | `diagnostic_consume_limit` | `diagnostico-crescimento/diagnostico-crescimento.repo.ts:31` | Prisma | DiagnosticSession/Answer/Event/Notification/AiBudget/RateLimit (público) | Backend | Sessão/token público; nenhum dado de tenant exposto; limite por IP/sessão. |
| 57 | `diagnostic_finish_notification` | `diagnostico-crescimento/diagnostico-crescimento.repo.ts:53` | Prisma | DiagnosticSession/Answer/Event/Notification/AiBudget/RateLimit (público) | Backend | Sessão/token público; nenhum dado de tenant exposto; limite por IP/sessão. |
| 58 | `diagnostic_maintenance` | `agendamentos/agendamentos.config.ts:103`, `diagnostico-crescimento/diagnostico-crescimento.repo.ts:58` | Prisma | DiagnosticSession/Answer/Event/Notification/AiBudget/RateLimit (público) | Backend | Sessão/token público; nenhum dado de tenant exposto; limite por IP/sessão. |
| 59 | `diagnostic_mutate` | `diagnostico-crescimento/diagnostico-crescimento.repo.ts:36` | Prisma | DiagnosticSession/Answer/Event/Notification/AiBudget/RateLimit (público) | Backend | Sessão/token público; nenhum dado de tenant exposto; limite por IP/sessão. |
| 60 | `diagnostic_reserve_ai` | `diagnostico-crescimento/diagnostico-crescimento.repo.ts:42` | Prisma | DiagnosticSession/Answer/Event/Notification/AiBudget/RateLimit (público) | Backend | Sessão/token público; nenhum dado de tenant exposto; limite por IP/sessão. |
| 61 | `estornar_pagamento_fatura` | `financeiro/faturas.service.ts:90` | TenantDb | FaturaAluguel → LancamentoFinanceiro/AuditoriaFinanceira | Backend+Segurança | Estorno de fatura de B negado; repetição idempotente. |
| 62 | `finish_asaas_checkout_event` | `checkout/checkout.repo.ts:146` | Prisma | AsaasCheckoutEvent / CheckoutOrder / CheckoutPayment / Subscription | Backend (Gate 6; Asaas sob decisão humana) | Replay do evento → já reservado; reprovisionar não cria 2ª org; e-mail de outra conta → 409. |
| 63 | `finish_contract_quota` | `contratos/ia/cota.ts:29` | Prisma | ContractQuotaReservation/UsageCounter (pai: corretor) | Backend (Gate 6) | Reserva com corretor de GCI; finish(false) libera em erro. |
| 64 | `generate_monthly_rent_bills` | `agendamentos/agendamentos.config.ts:60` | Prisma (job, dono) | FaturaAluguel / Alerta / RoutineEvent (todos os tenants) | Banco+Backend | Job global: cada linha gerada no tenant do pai; execução dupla bloqueada pelo advisory lock. |
| 65 | `gerar_alertas_vencimento_contratos` | `agendamentos/agendamentos.config.ts:91` | Prisma (job, dono) | FaturaAluguel / Alerta / RoutineEvent (todos os tenants) | Banco+Backend | Job global: cada linha gerada no tenant do pai; execução dupla bloqueada pelo advisory lock. |
| 66 | `get_corretor_id` | `arquivos/arquivos.repo.ts:24`, `arquivos/arquivos.repo.ts:79`, `assinatura/assinatura.service.ts:68`, `assinatura/assinatura.service.ts:70`, `assinatura/assinatura.service.ts:73`, `assinatura/assinatura.service.ts:98`, `assinatura/assinatura.service.ts:105`, `assinatura/assinatura.service.ts:109`, `auth/perfil.service.ts:15`, `auth/perfil.service.ts:39`, `contratos/contratos.service.ts:30`, `crm/funil/crm-funil.service.ts:155`, `fachadas/fachadas-templates.service.ts:20`, `fachadas/fachadas-templates.service.ts:33`, `fachadas/fachadas.service.ts:25`, `financeiro/financeiro.erros.ts:111`, `financeiro/lancamentos.service.ts:58`, `financeiro/asaas/asaas-conexao.service.ts:58`, `ia/contexto-crm.ts:33`, `ia/conversas.service.ts:20`, `ia/ferramentas.service.ts:54`, `imoveis/imoveis-gestao.service.ts:87`, `notificacoes/notificacoes.service.ts:57` | TenantDb | Corretor ← RoutineOrganization.legacy_corretor_id ← RoutineMembership/OnboardingProfile | Banco+Backend | B4: seletor A/B devolve corretor da org selecionada; usuário com 2 memberships sem seletor → nega. Bloqueio até F3. |
| 67 | `get_onboarding_contexto` | `assinatura/onboarding/onboarding.service.ts:67` | TenantDb | Onboarding* → OnboardingProfile → RoutineOrganization | Backend | Perfil/evento gravado na org selecionada; perfil de outro usuário negado. |
| 68 | `incrementar_uso` | `ia/cotas.ts:51`, `ia/cotas.ts:53` | Prisma | UsageCounter (pai: corretor) | Backend (Gate 6) | Uso contabilizado no corretor de GCI. |
| 69 | `is_admin` | `parceiros/admin/diagnosticos-crescimento.service.ts:44` | TenantDb | UserRole / AdminAuditoria (global) | Segurança | Membro de org sem papel global negado; auditoria grava ator. |
| 70 | `lead_capture_upsert_cliente` | `crm/integracoes/captura-lead.repo.ts:54` | Prisma | Cliente/ClienteImovel (pai: corretor do imóvel ou fallback) | Produto+Backend | B1: sem imóvel e 2+ corretores → recusa; bloqueio até fonte de tenant validada. |
| 71 | `lotti_agent_reconciliar_envio` | `whatsapp/whatsapp.service.ts:114` | TenantDb | LottiAgentConversation → LottiAgentMessage/LottiInboxEvent; Cliente | Backend | Conversa de B negada; mesclar só conversas do mesmo tenant. |
| 72 | `lotti_agent_save_settings` | `whatsapp/whatsapp.service.ts:131` | TenantDb | LottiAgentSetting / LottiAgentChannel (pai: corretor) | Backend | Configuração/canal só do tenant selecionado. |
| 73 | `lotti_agent_set_mode` | `whatsapp/whatsapp.service.ts:113` | TenantDb | LottiAgentConversation → LottiAgentMessage/LottiInboxEvent; Cliente | Backend | Conversa de B negada; mesclar só conversas do mesmo tenant. |
| 74 | `lotti_broadcast_activate` | `whatsapp/whatsapp.service.ts:154` | TenantDb | LottiBroadcastCampaign → Delivery/Event (pai: corretor) | Backend | Campanha de B não é lida/ativada/duplicada em A. |
| 75 | `lotti_broadcast_control` | `whatsapp/whatsapp.service.ts:155` | TenantDb | LottiBroadcastCampaign → Delivery/Event (pai: corretor) | Backend | Campanha de B não é lida/ativada/duplicada em A. |
| 76 | `lotti_broadcast_delete_draft` | `whatsapp/whatsapp.service.ts:157` | TenantDb | LottiBroadcastCampaign → Delivery/Event (pai: corretor) | Backend | Campanha de B não é lida/ativada/duplicada em A. |
| 77 | `lotti_broadcast_duplicate` | `whatsapp/whatsapp.service.ts:156` | TenantDb | LottiBroadcastCampaign → Delivery/Event (pai: corretor) | Backend | Campanha de B não é lida/ativada/duplicada em A. |
| 78 | `lotti_broadcast_preview` | `whatsapp/whatsapp.service.ts:153` | TenantDb | LottiBroadcastCampaign → Delivery/Event (pai: corretor) | Backend | Campanha de B não é lida/ativada/duplicada em A. |
| 79 | `lotti_broadcast_save` | `whatsapp/whatsapp.service.ts:152` | TenantDb | LottiBroadcastCampaign → Delivery/Event (pai: corretor) | Backend | Campanha de B não é lida/ativada/duplicada em A. |
| 80 | `lotti_channel_set_company_name` | `whatsapp/whatsapp.service.ts:125` | TenantDb | LottiAgentSetting / LottiAgentChannel (pai: corretor) | Backend | Configuração/canal só do tenant selecionado. |
| 81 | `lotti_find_or_create_cliente` | `crm/integracoes/crm-n8n.repo.ts:45` | Prisma | Cliente (pai: corretor do payload n8n) | Backend+Segurança | B1: corretor_id do payload com segredo global; bloqueio até credencial por tenant. |
| 82 | `lotti_inbox_clear_opt_out` | `whatsapp/whatsapp.service.ts:115` | TenantDb | LottiAgentConversation → LottiAgentMessage/LottiInboxEvent; Cliente | Backend | Conversa de B negada; mesclar só conversas do mesmo tenant. |
| 83 | `lotti_inbox_merge_conversations` | `whatsapp/whatsapp.service.ts:117` | TenantDb | LottiAgentConversation → LottiAgentMessage/LottiInboxEvent; Cliente | Backend | Conversa de B negada; mesclar só conversas do mesmo tenant. |
| 84 | `lotti_inbox_set_status` | `whatsapp/whatsapp.service.ts:118` | TenantDb | LottiAgentConversation → LottiAgentMessage/LottiInboxEvent; Cliente | Backend | Conversa de B negada; mesclar só conversas do mesmo tenant. |
| 85 | `lotti_inbox_start_conversation` | `whatsapp/whatsapp.service.ts:183` | TenantDb | LottiAgentConversation → LottiAgentMessage/LottiInboxEvent; Cliente | Backend | Conversa de B negada; mesclar só conversas do mesmo tenant. |
| 86 | `lotti_inbox_update_contact` | `whatsapp/whatsapp.service.ts:116` | TenantDb | LottiAgentConversation → LottiAgentMessage/LottiInboxEvent; Cliente | Backend | Conversa de B negada; mesclar só conversas do mesmo tenant. |
| 87 | `lotti_visita_lembrete_corretor` | `agendamentos/agendamentos.config.ts:113` | Prisma (job, dono) | FaturaAluguel / Alerta / RoutineEvent (todos os tenants) | Banco+Backend | Job global: cada linha gerada no tenant do pai; execução dupla bloqueada pelo advisory lock. |
| 88 | `marcar_alertas_lidos` | `notificacoes/notificacoes.service.ts:50` | TenantDb | Alerta (pai: corretor) | Backend | Alerta de B não marcado por A. |
| 89 | `meus_papeis` | `parceiros/admin/admin.service.ts:72` | TenantDb | UserRole / AdminAuditoria (global) | Segurança | Membro de org sem papel global negado; auditoria grava ator. |
| 90 | `onboarding_executar_acao` | `assinatura/onboarding/onboarding.service.ts:87` | TenantDb | Onboarding* → OnboardingProfile → RoutineOrganization | Backend | Perfil/evento gravado na org selecionada; perfil de outro usuário negado. |
| 91 | `parceiro_portal_registrar_aceite` | `parceiros/portal/portal.service.ts:29` | TenantDb | Parceiro/ParceiroLink/ParceiroPagamento (pai: user do parceiro) | Backend | Portal de parceiro A não lê nem altera repasse do parceiro B. |
| 92 | `parceiro_portal_resumo` | `parceiros/portal/portal.service.ts:31` | TenantDb | Parceiro/ParceiroLink/ParceiroPagamento (pai: user do parceiro) | Backend | Portal de parceiro A não lê nem altera repasse do parceiro B. |
| 93 | `parceiro_portal_salvar_repasse` | `parceiros/portal/portal.service.ts:44` | TenantDb | Parceiro/ParceiroLink/ParceiroPagamento (pai: user do parceiro) | Backend | Portal de parceiro A não lê nem altera repasse do parceiro B. |
| 94 | `parceiro_portal_teto_renovacoes` | `parceiros/portal/portal.service.ts:33` | TenantDb | Parceiro/ParceiroLink/ParceiroPagamento (pai: user do parceiro) | Backend | Portal de parceiro A não lê nem altera repasse do parceiro B. |
| 95 | `registrar_alerta_financeiro` | `financeiro/asaas/asaas-webhook.service.ts:308` | ServicoDb | RepasseProprietario / Alerta (pai: corretor da conexão) | Backend (Asaas sob decisão humana) | Transferência do slug A não concilia repasse de B. |
| 96 | `registrar_atividade` | `auth/perfil.service.ts:68` | TenantDb | AtividadeEvento (user + corretor) | Backend | Atividade registrada com ator e tenant corretos. |
| 97 | `registrar_auditoria_admin` | `parceiros/admin/admin.service.ts:88` | TenantDb | UserRole / AdminAuditoria (global) | Segurança | Membro de org sem papel global negado; auditoria grava ator. |
| 98 | `registrar_onboarding_evento` | `assinatura/onboarding/onboarding.service.ts:97` | TenantDb | Onboarding* → OnboardingProfile → RoutineOrganization | Backend | Perfil/evento gravado na org selecionada; perfil de outro usuário negado. |
| 99 | `reserve_contract_quota` | `contratos/ia/cota.ts:23` | Prisma | ContractQuotaReservation/UsageCounter (pai: corretor) | Backend (Gate 6) | Reserva com corretor de GCI; finish(false) libera em erro. |
| 100 | `routine_detect_conflicts` | `rotina/rotina.service.ts:126`, `visitas/visitas.repo.ts:70` | TenantDb | RoutineEvent/RoutineTask (org) + FKs legadas (Cliente, Contrato, Imovel) | Backend+Banco | Conflito calculado só na org selecionada; conclusão não grava em legado de outro corretor. |
| 101 | `routine_register_completion` | `rotina/rotina.service.ts:256` | TenantDb | RoutineEvent/RoutineTask (org) + FKs legadas (Cliente, Contrato, Imovel) | Backend+Banco | Conflito calculado só na org selecionada; conclusão não grava em legado de outro corretor. |
| 102 | `salvar_conexao_asaas` | `financeiro/asaas/asaas-conexao.service.ts:127` | ServicoDb | AsaasConexao/AsaasConexaoSegredo (pai: corretor de GCI) | Backend+Segurança (Asaas sob decisão humana) | Conexão gravada só no corretor de GCI. |
| 103 | `salvar_onboarding` | `assinatura/onboarding/onboarding.service.ts:78` | TenantDb | Onboarding* → OnboardingProfile → RoutineOrganization | Backend | Perfil/evento gravado na org selecionada; perfil de outro usuário negado. |
| 104 | `salvar_onboarding_tour` | `assinatura/onboarding/onboarding.service.ts:104` | TenantDb | Onboarding* → OnboardingProfile → RoutineOrganization | Backend | Perfil/evento gravado na org selecionada; perfil de outro usuário negado. |
| 105 | `suporte_encerrar_sessao` | `suporte/suporte.service.ts:166` | Prisma (suporte/suporte.service.ts:166) | AdminSessaoSuporte | Segurança | Só o ator encerra; idempotente. Caminho owner-level: incluir no threat model. |

## 4. Bypass: `ServicoDb` e `PrismaService`, operação a operação

- **`ServicoDb`** (`financeiro/servico-db.ts:14-20`) roda com `set local role service_role` e faz bypass de RLS. Aparece só em `financeiro/asaas/*`: `asaas-cobranca.service.ts`, `asaas-conexao.service.ts:127`, `asaas-credencial.ts`, `asaas-fila.ts`, `asaas-webhook.service.ts`.
- **`PrismaService` direto** usa o papel da conexão `DATABASE_URL`, que não é visível no código. O contrato e o G1 Database registram que não há `FORCE ROW LEVEL SECURITY`, então o bypass de RLS é presumido.

R/W = leitura/escrita. "Fonte do tenant" é de onde sai o filtro de dono da operação.

### 4.1 Os oito arquivos antes não capturados, mais as fontes NV

| Arquivo:linhas | Operação | R/W e recurso (model) | Client | Fonte do tenant / filtro | Est. | Classificação / dono | Cenário futuro ou condição |
|---|---|---|---|---|---|---|---|
| `ia/acao.service.ts:44` | resolve corretor | R GCI | TenantDb | `corretorDaSessao` (GCI) | V | org / Backend | — |
| `ia/acao.service.ts:53-55` | lê proposta | R `ai_action_proposals` | Prisma | `id` + `corretor_id` (GCI) + `user_id = claims.sub` | V | org, privilegiado / Backend | proposta de B → 404 |
| `ia/acao.service.ts:65-67,82-85,95-97,101-103` | recusa / trava / marca executada / falha | W `ai_action_proposals` | Prisma | só `id` + `status`, **depois** da leitura filtrada da l.53 | V | org / Backend | sem a leitura filtrada não há update (ordem preservada); corrida: 2 confirmações → 1 executa |
| `ia/acao.service.ts:94` | executa a ação | W domínio (cliente, tarefa…) via `ia/executar-acao.ts` (`crm_criar_cliente`, l.56) | TenantDb | GCI | V | org / Backend | ação cai no tenant selecionado |
| `ia/assistente.service.ts:151` | resolve corretor | R GCI | TenantDb | GCI | V | org | — |
| `ia/assistente.service.ts:158,162,186,227,287,447,487` | limite/min, cota, telemetria (início, fim, ferramenta), uso | W `ai_rate_limits`, R/W `usage_counters` via `checar_cota`/`incrementar_uso`, W `ai_runs`/`ai_tool_calls` | Prisma (`this.sql`, l.141-143) | `corretorId` da l.151 | V | org, privilegiado / Backend | cota/uso no corretor de GCI. **`ai_runs`/`ai_tool_calls` ausentes nas migrations Prisma** (matriz, "Objetos SQL fora dos 122 models"): escrita vira no-op (`ia/telemetria.ts` comentário l.6-9). Condição: decisão portar/remover (Banco + Produto) |
| `ia/assistente.service.ts:264-265` | cria conversa | W `ai_conversations` | TenantDb | GCI/RLS | V | org | — |
| `ia/ferramentas.service.ts:120,160-576` | consultas das ferramentas | R `clientes`, `crm_oportunidades`, `crm_etapas`, `imoveis`, `fachadas`, `imovel_fotos`, `lancamentos_financeiros`, `contratos`, `alertas`, `historico_contatos` | TenantDb | RLS | V | org / Backend | ferramenta não devolve linha de B |
| `ia/ferramentas.service.ts:143-147` | grava proposta | W `ai_action_proposals` | Prisma | `ctx.corretorId` / `ctx.userId` (vindos da sessão do assistente) | V | org, privilegiado | tabela ausente nas migrations Prisma: mesma condição acima |
| `ia/mensagens.service.ts:88,97-121` | resolve corretor; lê imóveis | R GCI, R `imoveis` | TenantDb | GCI/RLS | V | org | — |
| `ia/mensagens.service.ts:132,135,162` | limite/min, cota, uso | `ai_rate_limits`, `usage_counters` | Prisma (`this.sql`, l.41) | `dono` = GCI (l.98) | V | org, privilegiado | cota no corretor de GCI |
| `contratos/contratos-ia.service.ts:37` | resolve corretor | R GCI | TenantDb | GCI | V | org | — |
| `contratos/contratos-ia.service.ts:48-68` + `contratos/ia/cota.ts:21-30` | reserva/finaliza cota de contrato | R/W `contract_quota_reservations`, `usage_counters` via `reserve_/finish_contract_quota` | Prisma (client repassado) | `corretorId` da l.37 (comentário `cota.ts:3-7`) | V | org, privilegiado / Backend (Gate 6) | erro libera a reserva (`finish(false)`) |
| `checkout/checkout.repo.ts:81-91` | limite | `consume_checkout_rate_limit` | Prisma (`this.db` = PrismaService, l.81-83) | chave do pedido | V | public / Backend | excesso → recusado |
| `checkout/checkout.repo.ts:95-176` | cria, lê, atualiza pedidos; claims; `apply_checkout_payment` | R/W `checkout_orders`, `checkout_payments`, `asaas_checkout_events`, `subscriptions` | Prisma | pedido / e-mail | V | identity + internal / Backend (Gate 6) | ver S30 |
| `checkout/checkout.repo.ts:186-241` | provisiona conta | R `usuarios`, `corretores`; W `usuarios` (`on conflict do nothing`); trava `pg_advisory_xact_lock` por e-mail | Prisma | e-mail de login | V | identity / Backend+Segurança | e-mail em perfil de outra conta → 409 |
| `auth/supabase-auth.guard.ts:74-76` → `auth/sessao-suporte.ts:40-60` | confere a sessão de suporte e audita escrita | R `admin_sessoes_suporte`, `user_roles`, `corretores`; W `admin_auditoria` | Prisma (repassado pelo guard) | `sessaoId` + `authSessionId` + ator + titular do token | V | global (suporte) / Segurança | sessão encerrada/vencida → 403; escrita sem linha de auditoria impossível (mesmo comando) |
| `auth/usuarios.repo.ts:38-263` | login, refresh, cadastro, token de senha, limite | R/W `usuarios`, `auth_refresh_tokens`, `auth_password_tokens`, `auth.users` (l.59,133,167,171,215,244,279); `consume_public_request_limit` | Prisma | identidade (`sub`/e-mail) | P | identity / Backend+Segurança | refresh de outra família revogado; cadastro cria só a própria org |
| `ia/telemetria.ts:29-30,56-57,79-80` | início/fim de run, ferramenta | W `ai_runs`, `ai_tool_calls` | client repassado (Prisma) | `organizationId`/`userId` passados pelo chamador (assistente, corretor de GCI) | V | org, privilegiado / Backend+Banco | tabelas ausentes nas migrations Prisma: no-op. Condição: decisão portar/remover |
| `diagnostico-crescimento/diagnostico-crescimento.repo.ts:30-68` | limite, mutação, reserva IA, notificações, manutenção | `diagnostic_*` (sessões públicas) | Prisma | sessão pública (`p_session`, `p_token_hash`) | V | public / Backend | ver S27/S34 |
| `imoveis/imoveis-venda-evento.service.ts:71-81` | lê imóvel e cliente | R `imoveis`, `clientes` | TenantDb | RLS (GCI) | V | org | imóvel de B → erro antes do insert |
| `imoveis/imoveis-venda-evento.service.ts:94-95` | enfileira evento UTMify | W `webhook_logs` | Prisma | nenhum `corretor_id` gravado (tabela sem coluna de tenant, matriz #122) | V | global/unknown / Backend+Segurança | ver §8 |

### 4.2 Demais arquivos com `PrismaService` direto (já mapeados na v1)

| Arquivo (linhas) | Fonte do tenant | Est. | Superfície |
|---|---|---|---|
| `rotina/google/rotina-google.repo.ts` (23 chamadas, l.100+; recibos l.398-414) | conexão/canal/`state` | P | S09/S35 |
| `crm/integracoes/crm-n8n.repo.ts` (l.31-95) | payload ou único corretor | V | S31 |
| `crm/integracoes/captura-lead.repo.ts` (l.26-78) | dono do imóvel ou único corretor | V | S25 |
| `visitas/visitas.repo.ts` (l.32-59,107-121) | corretor do agente conferido com a conversa | V | S32 |
| `parceiros/publico/parceiros-publico.repo.ts` (l.60-124) | slug + `claims.sub` | V | S28 |
| `suporte/suporte.service.ts` (l.102,165-176,198-216) | sessão de suporte | P | S19 |
| `parceiros/diagnostico/diagnostico.repo.ts` (l.36-60) | sessão pública | P | S27 |
| `ia/cotas.ts` (l.31,51,64) | GCI do chamador | V | S10 |
| `fachadas/publico/fachadas-publico.repo.ts` (l.30,39) | id da fachada | V | S26 |
| `imoveis/publico/imoveis-publico.repo.ts` (l.31,71) | nenhuma | V | S24 |
| `arquivos/arquivos.repo.ts` (l.84) | GCI | V | S21 |
| `agendamentos/agendamentos.repo.ts` (l.21) | global | V | §7 |
| `assinatura/catalogo.repo.ts` (l.15) | global | P | S23 |
| `health/health.controller.ts` (l.13) | — | V | S22 |

## 5. SSE: cadeia do `corretorId` (rastreabilidade resolvida com evidência atual)

| Elo | Evidência | Fato | Est. |
|---|---|---|---|
| Produtor | `api/prisma/migrations/20261004233000_alertas_aviso_ao_vivo/migration.sql:2,13-14` | gatilho em `alertas`: `pg_notify('lotti_alertas', corretor_id)` | V |
| Listener | `notificacoes/alertas-listener.ts:18,46,57,64` | `LISTEN lotti_alertas` em conexão de sessão (`DIRECT_URL`); payload UUID → `hub.avisar` | V |
| Hub | `notificacoes/alertas-hub.ts:19-26` | `avisar(corretorId)`; `observar` filtra `id === corretorId`; ping periódico | V |
| Resolução | `notificacoes/notificacoes.service.ts:55-57` | `select public.get_corretor_id()` no TenantDb | V |
| Rota | `notificacoes/notificacoes.controller.ts:21,40-43` | `@Sse('eventos')`, `SupabaseAuthGuard`, `@RecusaTokenSuporte()` | V |

- **Classificação:** org via ponte de compatibilidade (corretor). Não há organização no canal nem no filtro.
- **Dono:** Backend (B5).
- **Cenário futuro:** abas A e B, alerta de A não chega à aba B; sem contexto válido, nada é emitido.
- **Condição:** o canal ou filtro carrega usuário+organização, ou o 1:1 organização↔corretor (`schema.prisma:2810`) é mantido e testado.

## 6. Storage (Garage/S3): cenário por operação

Buckets: `imoveis-fotos`, `videos`, `documentos`, `ai-attachments`, `lotti-inbox-files`, `lotti-inbox-audio` (`arquivos/arquivos.controller.ts:31-35`). A key é validada por `validarKey` (`arquivos/arquivos.dto.ts`), que recusa `..`, `/` inicial e `\`.

| Operação (rota §2.2) | Evidência | Regra de dono | Est. | Risco / dono | Cenário futuro necessário (ou dispensa) |
|---|---|---|---|---|---|
| `GET arquivos/publico/foto/*` | `arquivos.controller.ts:96-106` | nenhuma (bucket público) | V | M / Produto | **Dispensa de isolamento** (público por desenho). Necessário: key inexistente → 404 e nenhum objeto privado nesse bucket. Condição: Produto confirmar que fotos são públicas por desenho |
| `GET arquivos/publico/video/*` | `:108-118` | nenhuma | V | M / Produto | mesma dispensa e condição; `videos` sem model relacional (matriz) |
| `PUT arquivos/foto/*` | `:122-135`; `arquivos.repo.ts:34-45` | imóvel visível pela RLS ou `fachadas/<GCI>/` | V | M / Backend | key `<imovel de B>/x.jpg` → 403; tipo não-imagem → recusado |
| `DELETE arquivos/foto/*` | `:241-248` | idem | V | M / Backend | apagar foto de imóvel de B → 403 |
| `PUT arquivos/video/*` | `:137-148,270-274` | prefixo `<GCI>/` | V | M / Backend | key `<B>/…` → 403 |
| `DELETE arquivos/video/*` | `:250-257` | prefixo `<GCI>/` | V | M / Backend | key `<B>/…` → 403 |
| `PUT arquivos/documento/*` | `:150-161` | prefixo `<GCI>/` | V | M / Backend | key `<B>/…` → 403 |
| `GET arquivos/documento/*` | `:192-205`; `arquivos.repo.ts:47-57` | linha visível em `documentos`/`contratos` | V | M / Backend | documento de B → 403 |
| `DELETE arquivos/documento/*` | `:259-266` | idem | V | M / Backend | documento de B → 403 |
| `GET arquivos/anexo-ia/*` | `:207-220`; `arquivos.repo.ts:59-66` | linha visível em `ai_attachments` | V | B / Backend | anexo de B → 403 |
| `POST arquivos/inbox/preparar` | `:163-173` | `<GCI>/<request_id>/<nome>` | V | M / Backend | path devolvido sempre com o corretor de GCI |
| `PUT arquivos/inbox/:bucket/*` | `:175-188` | prefixo `<GCI>/`; bucket só da allowlist | V | M / Backend | key `<B>/…` → 403; bucket fora da lista → 400 |
| `GET arquivos/inbox/:bucket/*` | `:222-239`; `arquivos.repo.ts:74-88` | mensagem visível ou `lotti_manual_sends` de GCI (Prisma l.84) | V | M / Backend | arquivo de conversa de B → 403 |
| `POST whatsapp/runtime/storage/:bucket/inspect/*` | `whatsapp-runtime.controller.ts:19-24` | **nenhuma** | V | **A (B3)** / Backend+Segurança | runtime de A não inspeciona key `<B>/…` |
| `POST whatsapp/runtime/storage/:bucket/sign/*` | `:26-30` | **nenhuma**; expira em 30-300 s | V | **A (B3)** | runtime de A não assina key `<B>/…` |
| `PUT whatsapp/runtime/storage/:bucket/*` | `:32-37` | **nenhuma** | V | **A (B3)** | runtime de A não grava em `<B>/…` |
| Buckets e objetos do Supabase legado | — | NV | NV | M / Backend+DevOps | **Excluído:** sem ler objetos reais. Condição: inventário de deploy sob autorização |

**Lacuna comum:** o prefixo é `corretor_id`, não `organization_id`. Hoje isso é equivalente pelo 1:1 da ponte. Se o 1:1 deixar de valer, cada linha acima volta a bloqueio.

## 7. Jobs e filas

| Job | Evidência | Escopo | Camada | Proteção | Est. | Risco / dono | Cenário futuro |
|---|---|---|---|---|---|---|---|
| `gerar-faturas-mensais`, `marcar-faturas-atrasadas`, `sweeper-webhook-events`, `gerar-alertas-vencimento`, `manutencao-diagnostico`, `lembrete-visita-corretor` | `agendamentos/agendamentos.config.ts:56-113`; `agendamentos.job.ts:71,86`; `agendamentos.repo.ts:20-31` | global; toca dados de todos os tenants | Prisma (dono) | `pg_try_advisory_xact_lock`, tz UTC, concorrência 1, `AGENDAMENTOS_ENABLED` | V | M (B5) / Banco+Backend | cada linha gerada herda o tenant do pai; duas réplicas não executam em dobro |
| `rotina-google` (manter) | `rotina/google/rotina-maintain.job.ts:29-31` | global | Prisma | NV | P | M / Backend | renovação de canal só da conexão dona |
| Fila Asaas (`setInterval` 60 s) | `financeiro/asaas/asaas-fila.ts:21-24` | global | ServicoDb | reserva condicional; desligada por padrão | V | B / Backend | — |
| `setImmediate` do webhook Asaas | `asaas-webhook.service.ts:50-52` | por evento | ServicoDb | perda coberta só com a fila ligada | V | B | — |
| `job_queue` / `claim_jobs` | §8 | — | — | — | NV | M / Banco | §8 |

Configuração ativa em produção: **excluída** (DevOps, sob autorização).

## 8. Reconciliação de recursos sem ownership definido (matriz "Unknowns" #1 e `JobQueue`)

Busca usada: `\b<tabela>\b` em `api/src`, `supabase/functions`, `infra`, `scripts`, `src` e `api/prisma/migrations/**/migration.sql`.

| Recurso (model) | Escritores encontrados | Leitores encontrados | Ownership conhecido | Grants (lexical, `0_init`) | Dono | Condição específica |
|---|---|---|---|---|---|---|
| `calendar_webhook_receipts` (`CalendarWebhookReceipt`) | API: `rotina/google/rotina-google.repo.ts:398` (insert), `:409` (delete do recibo), `:414` (limpeza > 7 dias); Edge legada `supabase/functions/google-calendar-webhook/index.ts:26,52` | só os mesmos (deduplicação) | sem tenant; chave `(channel_id, message_number)` (`0_init:9468`); tenant derivável só via `channel_id` → `calendar_watch_channels` → calendário → org | só `service_role` (`0_init:11935-11936`) | Backend + Segurança | Documentar como recibo técnico global de retenção curta **ou** vínculo determinístico ao canal. Não expor a usuário. Sem decisão comercial envolvida |
| `leads_sem_destino` (`LeadSemDestino`) | API: `crm/integracoes/captura-lead.repo.ts:46` (lead público sem dono resolvido; comentário `captura-lead.service.ts:25`); Edge legada `supabase/functions/lead-capture/handler.ts:81` | **nenhum consumidor encontrado** no repositório (atribuição `atribuido_a` sem leitor) | unknown/global até atribuição (matriz #66) | só `service_role` (`0_init:12059-12060`) | Produto + Arquitetura (regra comercial); Backend (fila) | **Bloqueado.** Quem lê, atribui e com qual regra depende de decisão de Produto/Gabriel. Não inferir. Exposição multi-org proibida até lá |
| `lotti_agent_bridge_endpoint` (`LottiAgentBridgeEndpoint`) | função `lotti_agent_register_bridge(p_host)` (`0_init:6916,6923`); **nenhum chamador** na API nem nas Edge | Edge legada `supabase/functions/lotti-whatsapp/index.ts:27` (lê `host`); a API usa só a env `LOTTI_CHANNEL_BRIDGE_URL` (`whatsapp.service.ts:186`) | global (linha única `id = true`, `0_init:9802`) | só `service_role` + policy `lotti_agent_bridge_service` (`0_init:11527`, `:12062-12063`) | Backend + Segurança | Consumidor provável é o runtime externo (NV). Condição: inspeção do runtime ou retirada documentada. Endpoint global não autoriza tenant |
| `webhook_logs` (`WebhookLog`) | API: `imoveis/imoveis-venda-evento.service.ts:94-95` (UTMify, `PENDING`); front legado `src/components/imoveis/VendaImovelDialog.tsx:108` (ramo Supabase; o comentário l.96 diz que sempre falhava) | **nenhum consumidor encontrado** (nenhum worker processa `PENDING`) | global/unknown; sem coluna de tenant | **GRANT DML a `anon`, `authenticated` e `service_role`** (`0_init:12314-12316`), RLS ligada sem policy própria (matriz #122 `P−G+`) | Segurança (grants) + Backend (fila) | Grant amplo vai para revisão de Segurança. Fila sem consumidor: decidir consumir ou remover. Payload pode conter dado de cliente: não usar como autorização |
| `job_queue` (`JobQueue`) | **nenhum produtor encontrado** (nenhum `insert into job_queue` nas migrations Prisma, na API ou nas Edge) | função `claim_jobs(p_limit)` (`0_init:4648-4657`), **sem chamador** na API/Edge; policy de leitura do corretor (`0_init:11504`) | legacy `corretor_id` (FK `0_init:10136`); tipos em `job_queue_job_type_check` (`0_init:9796`) | revoke geral (`0_init:12049`) + policy de SELECT | Banco + Backend | Consumo desconhecido (runtime externo ou morto). Condição: localizar produtor/consumidor fora do repo, ou declarar obsoleta com decisão explícita. Não adaptar antes disso |

## 9. Edge Functions Supabase (legado)

Classificação por regex sobre `supabase/functions/*/index.ts`. **Heurística**, sem leitura linha a linha.

| Grupo | Funções | Sinal | Equivalente na API | Est. | Risco / dono | Condição |
|---|---|---|---|---|---|---|
| Só repassam ao Railway (7 linhas, `_shared/repassar-railway.ts`) | `public-imoveis`, `imovel-detalhe`, `lead-capture`, `crm-upsert-lead`, `crm-buscar-imoveis`, `crm-anexar-historico`, `commercial-diagnostic` | repasse | S24, S25, S31, S27 | P | herdam B1/B2 / Backend | mesma saída de S24/S25/S31 |
| Service role + auth de usuário | `admin-suporte`, `ai-action`, `ai-assistant`, `analisar-contrato`, `asaas-conexao`, `asaas-sync`, `fachada-publica`, `gerar-contrato`, `inbox-suggest`, `lotti-whatsapp`, `parceiro-atribuir`, `parceiro-clique`, `parceiro-convidar`, `diagnostic-notifications` | `SERVICE_ROLE`/`SECRET_KEY` + auth | módulos correspondentes | NV | M / Backend+DevOps | Excluídas desta leitura. Condição: inventário de deploy + chamadas do front; desligar ou classificar uma a uma. `lotti-whatsapp`: origem fixa (`index.ts:3`), dono por `corretores.user_id` (l.18-19) |
| Service role sem auth de usuário | `asaas-webhook`, `diagnostic`, `diagnostic-admin` | SR (+ segredo) | S29, S27 | NV | M / Backend+Segurança | idem |
| Sem service role | `ai-process-file`, `analisar-foto`, `analisar-fotos-imovel`, `generate-whatsapp-message`, `google-calendar-auth`, `google-calendar-sync`, `google-calendar-webhook`, `routine-command` | auth ou segredo | S10, S09, S35, S08 | NV | B a M / Backend | idem |

## 10. Runtime externo

O agente WhatsApp não está no snapshot. Ele consome S32 e S33 e, provavelmente, `lotti_agent_bridge_endpoint` e `job_queue` (§8). Segundo o handoff, acessa o Postgres por `DATABASE_URL` próprio. Estado NV, **bloqueio A**. Saída: inspeção sob brief e autorização próprios. Esta onda não inspeciona.

## 11. Gaps residuais e condições

**Condições futuras (não exigem código verde em F0):**

| # | Gap | Condição objetiva para sair | Dono operacional |
|---|---|---|---|
| R1 | B1: fallback de "único corretor" em S25/S31 | tenant só por recurso validado (imóvel/fachada/credencial por tenant), fallback removido, cenários negativos de S25/S31 verdes | Produto + Backend |
| R2 | B2: vitrine pública S24 mistura tenants | escopo por org/marca decidido (Gate 5) + cenário A→B verde | Produto + Arquitetura + Backend |
| R3 | B3: token do agente global; storage do runtime sem tenant; runtime NV | credencial vinculada ao tenant; keys restritas ao prefixo do tenant; runtime inspecionado | Backend + Segurança |
| R4 | B4: seleção implícita (LIMIT1, GCI escalar, aceite que revoga) | contexto validado por requisição nos três pontos antes de remover `0_init:10622`; cenário multi-membership verde | Backend + Banco |
| R5 | B5: SSE, jobs e prefixos chaveados por corretor/globais | cada consumidor de §5-§7 classificado; SSE por usuário+org ou 1:1 testado | Backend + Banco |

**Dependem de brief/autorização própria (não são inspeção imediata desta onda):**

| # | Gap | Condição | Dono |
|---|---|---|---|
| R6 | Corpos das 105 funções, RLS, grants, `search_path`; papel efetivo de `DATABASE_URL`/`DIRECT_URL`; catálogo remoto; runtime e deploy | brief de Segurança/Banco e, para remoto, autorização específica de DevOps | Segurança + Banco + DevOps |
| R7 | `ai_runs`, `ai_tool_calls`, `ai_action_proposals` usados pela API (§4.1) mas ausentes nas migrations Prisma | decisão explícita portar ou remover | Banco + Produto |
| R8 | Recursos de §8 sem consumidor (`leads_sem_destino`, `webhook_logs`, `job_queue`, `lotti_agent_bridge_endpoint`) e grant DML amplo em `webhook_logs` | condição específica de cada linha de §8 | conforme §8 |
| R9 | Corpo do `N8nSegredoGuard`, linhas exatas do método `webhook` do Google, services de domínio além dos trechos citados (estados P) | leitura dirigida em brief próprio | Backend |
| R10 | Edge Functions só por heurística; deploy desconhecido | inventário de deploy e de chamadas do front | Backend + DevOps |

## 12. Limitações

- As contagens (286 handlers, 105 funções) vêm dos scripts do Apêndice A e foram checadas como descrito em §0. **Completude da lista não equivale a superfície segura.** Linhas com estado P/NV continuam bloqueadas para multi-org.
- **Guard por rota:** heurística de proximidade (±3 linhas). As 48 rotas com guard diferente de `SupabaseAuthGuard` (26 `NENHUM`, 12 checkout, 6 agente, 4 n8n) foram conferidas manualmente. Um `@UseGuards` com mais de um guard não ocorre (busca vazia).
- **Recurso/model das RPCs:** derivado do nome da função e do consumidor. As tabelas efetivamente tocadas no corpo SQL ficam NV (R6).
- Nada foi executado. V refere-se ao trecho lido, não ao comportamento em execução nem à RLS efetiva.
- Este artefato não fecha F0 e não libera rollout.

## Apêndice A. Buscas e scripts realmente usados

Todos foram executados localmente em PowerShell 5.1, só com leitura, contra o clone em `ec4c928`. As cópias ficam no scratchpad da sessão, fora do repositório.

### A.1 `rotas.ps1`: lista de handlers (gera §2.2)

- **O que faz:** para cada `api/src/**/*.ts` não-spec com `@Controller(`, registra o prefixo do controller e cada `@(Get|Post|Put|Patch|Delete|Sse)('<sub>')`, com arquivo:linha.
- **Guard efetivo:** `@UseGuards(X)` na mesma linha ou até 3 linhas do decorator; senão o guard de classe (±3 linhas do `@Controller`); senão `NENHUM`.
- **Checagem cruzada:** total de matches do regex `@(Get|Post|Put|Patch|Delete|Sse)\(` em `api/src` não-spec = 286, igual ao total da tabela. Busca por `@Controller(` fora de `*.controller.ts`: vazia. Busca por `APP_GUARD|useGlobalGuards|@UseGuards(\w+\s*,`: vazia.

### A.2 `rpcs.ps1`: funções chamadas (gera §3)

- **Definidas:** regex `create (or replace)? function (public.)?<nome>(` em `api/prisma/migrations/**/migration.sql`, com 235 nomes.
- **Chamadas:** em `api/src` não-spec, regex `(?<![A-Za-z0-9_.])(public\.)?<nome>\s*\(` restrito a nomes definidos e a linhas com marcador SQL (`select|perform|from|public.|${|::`), com 105 nomes.
- **Checagem:** todo `public.<x>(` da API que não é função definida é nome de tabela em `insert into public.<x> (` (35 casos) ou o enum `public.tipo_contrato` citado em comentário (`contratos/contratos.dto.ts:8`), ou seja, nenhuma chamada a função inexistente.

### A.3 `ops.ps1`: operações por arquivo (gera §4.1)

Por linha, marca `R:<tabela>` para `from|join public.<t>` e `W:<tabela>` para `insert into|update|delete from public.<t>`, além do client usado (`this.prisma`, `this.db.run`, `servico.run`, client repassado). Os trechos foram lidos em seguida para a fonte do tenant.

### A.4 `tabelas.ps1`: gera as tabelas markdown

Mapeia cada rota para Sxx pelo prefixo do arquivo (§2.1), e cada função para camada, recurso, dono e cenário por nome ou família de nome. Nenhuma rota ficou sem superfície e nenhuma função ficou `NV`.

### A.5 Buscas pontuais

- `\b(calendar_webhook_receipts|leads_sem_destino|lotti_agent_bridge_endpoint|webhook_logs|job_queue)\b`
- `claim_jobs|lotti_agent_register_bridge|bridge_endpoint`
- `Sse|corretorId|pg_notify|LISTEN`
- `BUCKET_`
- `insert into (public.)?job_queue`
