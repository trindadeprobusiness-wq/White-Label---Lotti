# Arquitetura da Lotti no padrão do Clix, a partir do banco

**Decisão (Rafael, 2026-10-04):** a Lotti passa a ter a mesma arquitetura do Clix
(`C:\Users\rafae\Clix\catalogo\apps\api`):

- API NestJS + Prisma + Postgres + Redis/BullMQ no Railway;
- `schema.prisma` como retrato fiel do banco;
- um módulo da API por área do sistema.

O Supabase self-hosted foi descartado (cerca de 10 serviços, uns US$ 75/mês, e
continuaria sendo "o Supabase").

## Onde estamos

| Peça | Hoje | Alvo (Clix) |
|---|---|---|
| Front | React no Railway (`app.plataformalotti.com.br`) | igual, falando com a API |
| API | `api/` NestJS no Railway (PR #51): health, busca de imóveis, visitas | todos os módulos abaixo |
| Schema | `api/prisma/migrations` é a fonte da verdade (baseline `0_init` + novas); `schema.prisma` gerado delas: 103 modelos, 16 enums, 147 relações | ✅ igual ao Clix (`migrate deploy` no start da API) |
| Banco | Postgres do Supabase (38 MB, 3 usuários) | Postgres no Railway |
| Login | Supabase Auth | JWT próprio (como o Clix). 2 das 3 contas têm senha em bcrypt e migram sem trocar senha; a terceira recebe link de criar senha |
| Arquivos | Supabase Storage (89 arquivos, cerca de 90 MB) | R2/S3 (o Clix usa R2) |
| Regras no banco | 216 funções, 181 gatilhos, 141 policies RLS, checks | ficam no SQL das migrations e migram para código aos poucos |
| Agendamentos | 5 jobs `pg_cron` | `@nestjs/schedule` (como o Clix) |
| Tempo real | Supabase Realtime (sino) | SSE da API + Redis |
| Funções | 27 Edge Functions (Deno) | módulos da API |
| Agente WhatsApp | runtime Node + n8n (em migração para o Railway) | módulo `whatsapp` com BullMQ |

O gerador do schema fica em `api/scripts/schema/`: `catalogo.sql` lê o catálogo do
Postgres, sem escrever nada, e `gerar-schema.mjs` escreve o Prisma no padrão de
nomes do Clix. Para regenerar depois de qualquer migration:

```bash
C:/Users/rafae/bin/supabase db query --linked -f api/scripts/schema/catalogo.sql > catalogo.json
cd api && npm run schema:gerar -- ../catalogo.json prisma/schema.prisma && npx prisma format && npx prisma validate
```

## Módulos da API, derivados do banco

Cada tabela tem um dono só. As 103 estão cobertas, conferido por script.

| Módulo | Tabelas | De onde vem a lógica hoje |
|---|---|---|
| `conta` | corretores, user_roles, admin_auditoria, admin_config, admin_sessoes_suporte, atividade_eventos | front direto + RPCs de admin |
| `organizacao` | routine_organizations, routine_memberships, organizacao_convites | front direto |
| `onboarding` | onboarding_* (8) | front direto + RPCs |
| `imoveis` | imoveis, imovel_fotos, proprietarios | front direto, `public-imoveis`, `imovel-detalhe` |
| `crm` | clientes, cliente_imovel, historico_contatos, crm_etapas, crm_oportunidades, crm_tarefas, leads_sem_destino | front direto, `crm-upsert-lead`, `crm-buscar-imoveis`, `crm-anexar-historico`, `lead-capture` |
| `contratos` | contratos, contratos_renegociacoes, documentos, contract_quota_reservations | front direto, `gerar-contrato`, `analisar-contrato` |
| `financeiro` | faturas_aluguel, lancamentos_financeiros, repasses_proprietario, auditoria_financeira, receita_eventos | front direto + funções/cron de faturas |
| `asaas` | asaas_conexoes, asaas_conexao_segredos, asaas_webhook_events, asaas_checkout_events, webhook_logs | `asaas-conexao`, `asaas-sync`, `asaas-webhook` |
| `assinatura` | plans, plan_entitlements, subscriptions, subscription_addons, usage_counters, pricing_campaigns, billing_legacy_accounts, checkout_orders, checkout_payments, checkout_rate_limits, cancelamento_feedback | front direto + gatilhos de cota |
| `parceiros` | parceiros, parceiro_* (8) | `parceiro-atribuir`, `parceiro-clique` |
| `fachadas` | fachadas, fachada_templates, fachada_leads, fachada_escaneamentos | front direto, `fachada-publica` |
| `rotina` | routine_* (10), calendar_* (5), external_calendars | front direto, `google-calendar-auth/-sync/-webhook`, `routine-command` |
| `whatsapp` | lotti_agent_* (7), lotti_broadcast_* (3), lotti_inbox_events, lotti_manual_sends, lotti_automation_heartbeat | runtime (n8n-agent-lotti), `lotti-whatsapp`, `inbox-suggest`, `generate-whatsapp-message` |
| `ia` | ai_conversations, ai_messages, ai_attachments, ai_rate_limits | `ai-assistant`, `ai-action`, `ai-process-file`, `analisar-foto(s)` |
| `notificacoes` | alertas | front direto + Realtime |
| `diagnostico` | commercial_diagnostics, commercial_diagnostic_events | `commercial-diagnostic` |
| `infra` | job_queue, public_request_limits | vários |

Fora do Prisma: `_backfill_comissoes_20260727` e `_backup_lancamentos_dup_20260727`
(backups avulsos, sem chave) e a view `v_leads_whatsapp`.

## Fases

Cada fase deixa o sistema funcionando. O banco só sai do Supabase no fim, porque
login, arquivos, Realtime e as Edge Functions dependem do Supabase rodando em cima
dele.

1. **Schema completo no Prisma.** ✅ Feito (`a57d78b`).
2. **Baseline SQL e Prisma como dono do schema.** ✅ Feito.
   - `api/prisma/migrations/0_init` tem o banco inteiro (1.740 comandos),
     extraído do catálogo por `api/scripts/schema/ddl.sql`.
   - Está marcada como aplicada na produção (`_prisma_migrations`, trancada com
     RLS e sem acesso público).
   - Prova no PGlite: a baseline sozinha recria o banco, e o schema gerado dela é
     idêntico, linha por linha, ao da produção.
   - `supabase/migrations` está congelada. Fluxo em `api/prisma/README.md`.
3. **Ensaio do banco no Railway, sem tocar a produção.** ✅ Feito (2026-10-04).
   - Serviço `Postgres` (PostgreSQL 18.6) no projeto Lotti.
   - Estrutura aplicada pelo próprio `prisma migrate deploy` (as 2 migrations).
   - Dados copiados por `api/scripts/dados/copiar.mjs`: 7.342 linhas, 62 tabelas
     com dados, contagens iguais nas 105. Leitura pela CLI do Supabase e
     gravação direta da memória, sem dado pessoal em disco.
   - `api/scripts/dados/conferir-ensaio.mjs` confirmou três coisas: schema
     idêntico ao `schema.prisma`, contagens iguais e a mesma visão pelo RLS
     para os 3 usuários.
   - A API (`api`) aponta para esse banco pela rede interna
     (`${{Postgres.DATABASE_URL}}`). **Até a virada (fase 6), o banco do Railway
     é cópia, não produção:** nada de tráfego real na API antes disso.
   - Para atualizar a cópia antes da virada:
     1. recriar o banco do ensaio;
     2. `prisma migrate deploy`;
     3. `copiar.mjs`, com o TCP proxy reaberto
        (`railway tcp-proxy create --service Postgres --port 5432`).
   Plano original desta fase:
   - Postgres no Railway com a baseline e os dados copiados. A baseline já foi
     provada fora do Supabase (PGlite): cadastro, RLS no padrão TenantDb e trava
     de plano funcionam com a compatibilidade `auth.uid()`/papéis da `0_init`.
   - Um schema `auth` mínimo (`auth.uid()`, `auth.role()`, `auth.jwt()` lendo
     `request.jwt.claims`, como o Supabase faz) e os papéis `anon`,
     `authenticated` e `service_role`. Assim as 141 policies e o `TenantDb`
     continuam funcionando fora do Supabase.
   - API de staging apontando para ele.
4. **Módulos na API, um por vez.** Em andamento.
   - Molde de cada módulo:
     1. rotas na API com o mesmo comportamento de hoje, consultando pelo
        `TenantDb`;
     2. no front, um adaptador que só liga com `VITE_API_URL` (desligado até a
        virada);
     3. testes nos dois lados.
   - ✅ `notificacoes`:
     - `GET /api/notificacoes`, `POST /api/notificacoes/lidas` e SSE
       `/api/notificacoes/eventos`;
     - gatilho `alertas_avisar_mudanca` (migration `20261004233000`) avisando no
       canal `lotti_alertas`, e listener pelo `DIRECT_URL`;
     - front: sino lê, marca e escuta pela API quando ligado.
   - ✅ `imoveis` + `crm` (`d062954`, contrato em
     `2026-10-04-api-lotti-modulo2-contrato.md`):
     - `/api/imoveis` (CRUD, interessados, venda), `/api/clientes` (CRUD, status,
       candidatos, histórico, vínculo) e `/api/crm` (etapas, oportunidades com mover
       por token, exclusão em lote, tarefas);
     - front: adaptadores em `src/lib/api/{http,imoveis,crm}.ts` e nas telas;
     - o que ainda lê ou grava imóveis e clientes pelo Supabase está na §7.1 do
       contrato e sai com os próximos módulos (a virada depende de zerar essa lista).
   - O front troca as chamadas diretas ao Supabase pela API, e as Edge Functions
     viram módulos.
   - Ordem por valor: `notificacoes` (SSE), `imoveis`, `crm`, `rotina`,
     `whatsapp` (BullMQ), `contratos`, `financeiro` + `asaas`, `assinatura`,
     `parceiros`, `fachadas`, `onboarding`, `ia`, `diagnostico`.
5. **Login próprio e arquivos.**
   - JWT da API com os hashes bcrypt de `auth.users`, copiados para uma tabela
     `usuarios` do public.
   - Arquivos copiados para R2.
6. **Virada do banco.**
   - Janela à noite e dump final (38 MB, minutos).
   - `DATABASE_URL` da API aponta para o Railway.
   - Supabase fica parado 7 dias como volta de segurança e depois é desligado.

## Regras que valem em todas as fases

- Nada de `prisma migrate dev`, `db push` ou `db pull` contra o banco de produção. O
  schema só é regenerado pelo gerador, que só lê.
- Consulta de usuário passa pelo `TenantDb` (RLS) até a fase 6. O Clix isola só no
  código; a Lotti mantém as duas camadas.
- `jobId` do BullMQ sem `:`.
- Logs sem telefone, e-mail, token ou conteúdo de mensagem.
