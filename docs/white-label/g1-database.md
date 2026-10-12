# WL-G1-DATABASE — review de banco e isolamento

## Escopo e base verificada

- Tarefa: `WL-G1-DATABASE`, report review somente leitura.
- Snapshot G0 fixo: `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`.
- Checkout inspecionado: `C:\Users\Gabri\Documents\Codex\Engenharia\projetos\lotti-white-label`.
- `git rev-parse HEAD` retornou o SHA acima e `git status --short` não produziu saída antes da inspeção: árvore limpa.
- `sistema/lotti-white-label/snapshot-g0.json` confirma `main`, o mesmo HEAD, status vazio, sem submódulos e um único worktree.
- Instruções lidas de forma dirigida: `C:\Users\Gabri\Documents\Codex\Engenharia\AGENTS.md`, `projetos/lotti-white-label/AGENTS.md` e as entradas aplicáveis de `projetos/lotti-white-label/AI_HANDOFF.md`.
- Não foram lidos `.env`, segredos ou dados reais. Não houve conexão a banco, execução de SQL, migration, teste, instalação, staging, commit, push ou deploy. O relatório descreve o repositório no snapshot, não certifica o catálogo nem os dados de qualquer ambiente remoto.

## Conclusão executiva

O banco é **parcialmente reutilizável** para uma plataforma white-label. A base tem boa maturidade operacional: migrations SQL como fonte de verdade, RLS ampla, chaves e índices explícitos, `TenantDb` que reaplica claims e papel `authenticated`, duas views com `security_invoker`, separação de credenciais backend-only e cobertura específica da Rotina. Porém, o isolamento não usa um único conceito de tenant.

Existem hoje quatro eixos de ownership:

1. `corretor_id` na maior parte do domínio legado;
2. `organization_id` na Rotina, calendário e onboarding;
3. `owner_id = auth.users.id` na Central Comercial;
4. tabelas globais/admin/públicas, com autorização própria.

`routine_organizations.legacy_corretor_id` conecta o modelo organizacional novo ao legado em relação 1:1. `get_corretor_id()` resolve a conta efetiva a partir de onboarding + membership ativa e devolve esse `legacy_corretor_id`. Isso preserva compatibilidade e permite que membros operem sobre uma conta existente, mas não constitui ainda um tenant white-label canônico. A restrição parcial `uq_routine_membership_ativa_por_usuario` impede mais de uma membership ativa por usuário, e o código escolhe `LIMIT 1`; portanto o snapshot modela uma organização ativa por identidade, não seleção ou troca de organização.

O principal gap arquitetural é a ausência de uma fronteira única de tenant em todas as tabelas e consultas. Adicionar white-label multi-organização sem antes definir o identificador canônico, a seleção de contexto e a política para acessos owner-level criaria risco de mistura entre `corretor_id`, `organization_id` e `owner_id`.

## 1. Fontes de verdade e inventário de migrations

### Prisma/API — fonte vigente

- `api/prisma/README.md:3-6` declara `api/prisma/migrations/` como fonte de verdade desde 2026-10-04, `schema.prisma` gerado e `supabase/migrations` congelado.
- `api/prisma/README.md:8-10` define `0_init` como baseline extraída do catálogo, marcada como aplicada e imutável.
- `api/prisma/README.md:17-27` exige migration SQL manual, regeneração do schema e testes; funções, gatilhos, policies e grants ficam no SQL.
- `api/prisma/README.md:49-55` proíbe `migrate dev/reset`, `db push/pull` em produção, edição de migrations aplicadas e novos arquivos em `supabase/migrations`.
- O snapshot contém 26 diretórios/26 arquivos `migration.sql`: `0_init` + 25 migrations incrementais, de `20261004220000_menor_privilegio_papeis_publicos` a `20261011100000_central_comercial`.
- `api/prisma/schema.prisma:1-5` repete que o arquivo é gerado e que funções, gatilhos, RLS e checks só estão nas migrations. Logo o Prisma não é inventário completo de segurança.
- O schema gerado contém 122 models em `public`. Fora dele existem duas tabelas históricas sem PK, a tabela privada `suporte_privado.credenciais`, a compatibilidade `auth.users` e duas views.
- Leitura lexical das migrations Prisma encontrou 148 nomes distintos de índices, 236 nomes de funções, 81 nomes de triggers e 150 nomes de policies. Esses números servem como inventário estático do snapshot, não como prova do catálogo remoto; funções/policies redefinidas ao longo das migrations podem aparecer uma única vez na contagem distinta.

Migrations incrementais com efeito estrutural relevante:

- `20261004220000_menor_privilegio_papeis_publicos/migration.sql:1-25`: revoga `TRUNCATE`, `REFERENCES`, `TRIGGER` e, em PostgreSQL 17+, `MAINTAIN` de `anon`/`authenticated`, inclusive em default privileges.
- `20261005140000_anon_sem_escrita/migration.sql:1-72`: revoga escrita de `anon` em tudo, exceto `fachada_leads` e `fachada_escaneamentos`, e corrige default privileges.
- `20261005171127_login_proprio/migration.sql:3-13`: introduz `usuarios` preservando o mesmo UUID de `auth.users`/`claims.sub`.
- `20261006120000_ajustes_modulos/migration.sql:11-38`: acrescenta `documentos.updated_at`, triggers de timestamp e índices de calendário.
- `20261006180000_tabelas_historicas/migration.sql:1-37`: incorpora duas tabelas históricas sem PK, com RLS sem policy e acesso apenas do dono/`service_role`.
- `20261007120000_tokens_senha` adiciona tokens de definição de senha; `20261008120000`/`130000` portam diagnóstico; `20261008150000` a `20261010220000` evoluem Inbox/agente/visitas; `20261011090000` acrescenta links de anúncio; `20261011100000` cria a Central Comercial.

### Supabase — histórico congelado e referência de paridade

- Existem 119 migrations `.sql` e 31 testes `.test.ts` em `supabase/migrations`. Elas registram a evolução anterior, mas não são a trilha de deploy vigente.
- `supabase/migrations/20260821004218_rotina_operacional.sql` é a origem legível do domínio Rotina; seus objetos foram absorvidos pela `0_init` da trilha Prisma.
- Migrations posteriores do Supabase continuam relevantes para entender decisões incorporadas na baseline, por exemplo `20260821130000_onboarding_ativacao.sql` (perfil organizacional/onboarding), `20260831140000_asaas_conta_por_inquilino.sql` (uma membership ativa por usuário) e `20260927110000_onboarding_corretor_ativo.sql` (resolução da conta ativa).
- Não se deve reaplicar a pasta Supabase sobre a baseline Prisma: há sobreposição extensa de tabelas, funções, policies e backfills. Ela é referência histórica/paridade, não uma segunda fila cumulativa.

## 2. Inventário e ownership por área

| Área | Tabelas principais | Chave de ownership/isolation | Classificação white-label |
|---|---|---|---|
| Identidade e conta | `auth.users`, `usuarios`, `corretores`, `user_roles`, `admin_sessoes_suporte` | `claims.sub`/`user_id`; `corretores.user_id` é único (`schema.prisma:1048-1052`) | **Adaptar**: identidade é reaproveitável, mas falta vínculo canônico identidade ↔ vários tenants/marcas |
| Organização, equipe e onboarding | `routine_organizations`, `routine_memberships`, `onboarding_*`, `organizacao_convites` | `organization_id`; ponte única `legacy_corretor_id` | **Reaproveitar como fundação**, adaptando para tenant selecionável |
| Rotina e calendário | `routine_events`, `routine_tasks`, `routine_*`, `calendar_*`, `external_calendars` | `organization_id` + `assigned_to`/`user_id`; itens privados por responsável/criador | **Reaproveitar**: é a área mais próxima do modelo alvo |
| CRM e operação imobiliária | `clientes`, `imoveis`, `imovel_fotos`, `proprietarios`, `crm_*`, `historico_contatos`, `alertas` | predominantemente `corretor_id`; leitura de equipe traduz `organization_id → legacy_corretor_id` | **Adaptar**: ownership legado 1:1 |
| Contratos, locação e financeiro | `contratos`, `faturas_aluguel`, `repasses_proprietario`, `lancamentos_financeiros`, `auditoria_financeira`, `asaas_*` | `corretor_id`; várias FKs cascateiam para conta/contrato | **Adaptar com alto cuidado**: dados financeiros e deleções têm impacto material |
| WhatsApp/agente | `lotti_agent_*`, `lotti_inbox_events`, `lotti_manual_sends`, `lotti_broadcast_*`, `lotti_automation_heartbeat` | `corretor_id`, canal e conversa; navegador tem grants majoritariamente de leitura | **Adaptar**: tenant ainda é conta/corretor |
| IA assistente | `ai_conversations`, `ai_messages`, `ai_attachments`, `ai_rate_limits` | `corretor_id`/conversa | **Parcial**: telemetria/propostas da fundação Supabase não foram portadas |
| Billing e checkout | `plans`, `plan_entitlements`, `subscriptions`, `subscription_addons`, `usage_counters`, `checkout_*`, `billing_legacy_accounts` | plano global + assinatura/cota por `corretor_id` | **Adaptar**: separar catálogo global de assinatura/configuração por tenant/marca |
| Fachadas e superfícies públicas | `fachadas`, `fachada_templates`, `fachada_leads`, `fachada_escaneamentos` | `corretor_id`/`fachada_id`; exceções públicas explícitas | **Reaproveitar com branding**, preservando limites e guards públicos |
| Parceiros/backoffice | `parceiros`, `parceiro_*`, `receita_eventos`, `admin_*`, `atividade_eventos`, `cancelamento_feedback` | global/admin ou vínculo com usuário/corretor | **Adaptar**: decidir o que pertence ao SaaS operador e o que é por tenant |
| Diagnósticos públicos | `commercial_diagnostics*`, `diagnostic_*`, `public_request_limits` | sessão/lead público; leitura administrativa; limites próprios | **Reaproveitar**, mantendo fora do tenant operacional quando intencional |
| Central Comercial | `central_comercial_*` | `owner_id = auth.users.id`, não `organization_id` nem `corretor_id` | **Parcial/risco**: isolamento por pessoa diverge do restante da organização |
| Arquivos | metadados em `imovel_fotos`, `documentos`, `ai_attachments`, mensagens; objetos no Garage/Supabase histórico | chave/prefixo + autorização da API ou policy de Storage | **Parcial**: backend Garage existe, mas a migração de todos os produtores/URLs não é uniforme |

## 3. `routine_organizations`, memberships e `legacy_corretor_id`

### Estrutura, PK/FK, índices e constraints

- `supabase/migrations/20260821004218_rotina_operacional.sql:18-26`: `routine_organizations.id` é UUID PK; `legacy_corretor_id` é `NOT NULL UNIQUE`, FK de `corretores(id)` com `ON DELETE CASCADE`; nome e timezone são obrigatórios.
- `api/prisma/schema.prisma:2808-2845`: o estado gerado acrescenta atributos de onboarding/branding organizacional (`trade_name`, CNPJ, telefone, e-mail, cidade/UF, `logo_url`, tamanho/eixos de operação e tipo); a relação Prisma confirma `onDelete: Cascade`.
- `supabase/migrations/20260821004218_rotina_operacional.sql:28-47`: `routine_memberships.id` é UUID PK; `organization_id` referencia a organização com cascade; `user_id` referencia `auth.users` com cascade; há checks de sete papéis e quatro estados; `UNIQUE (organization_id,user_id)` e índices `(user_id,status,organization_id)` e `(organization_id,status,role)`.
- `api/prisma/migrations/0_init/migration.sql:10622`: `uq_routine_membership_ativa_por_usuario` é índice único parcial em `user_id WHERE status='active'`. Consequência: o banco impede duas organizações ativas para a mesma identidade.
- `api/prisma/schema.prisma:2783-2802` representa PK, unique composta e os dois índices comuns, mas não o índice parcial; o comentário do model registra esse objeto SQL-only.
- `api/prisma/schema.prisma:2805-2806` registra RLS e triggers de atualização/seeding na organização; `:2779-2780` registra RLS e triggers da membership.

### Bootstrap e resolução do tenant legado

- `supabase/migrations/20260821004218_rotina_operacional.sql:155-167` cria uma organização para cada corretor existente e uma membership `proprietario` ativa; é um backfill idempotente por `legacy_corretor_id`/membership.
- `:169-194` instala `tr_ensure_routine_organization` após insert em `corretores`, mantendo o espelho para novas contas.
- `api/prisma/migrations/0_init/migration.sql:5488-5504`: `get_corretor_id()` é `STABLE SECURITY DEFINER`; une `onboarding_profiles`, membership ativa, organização e corretor ativo e retorna `o.legacy_corretor_id` para `auth.uid()`.
- `api/src/rotina/rotina.contexto.ts:12-20`: a API busca a membership ativa com `LIMIT 1`, sem parâmetro de organização.
- Resultado: organização é uma camada sobre o tenant legado. O desenho funciona enquanto cada usuário possui no máximo uma membership ativa e cada organização aponta para exatamente um corretor-raiz.

### RLS e papel dos membros

- Os helpers `private.routine_is_member`, `routine_member_has_role`, `routine_user_is_member`, `routine_can_view_item` e `routine_can_write_item` são `SECURITY DEFINER`, fixam `search_path`, verificam `auth.uid()` e têm execução revogada de `PUBLIC` (`supabase/.../20260821004218_rotina_operacional.sql:49-153`). Isso evita recursão de RLS em memberships.
- O conjunto de Rotina habilita RLS em 18 tabelas (`:931-944`). O navegador autenticado recebe CRUD apenas onde necessário; `routine_automation_runs` e `routine_activity_log` são leitura; credenciais/mappings/webhooks de calendário têm `REVOKE ALL` para `anon, authenticated` (`:946-963`).
- Organização: membros leem; apenas proprietário/administrador atualizam (`:965-970`). Memberships: organização lê; proprietário/administrador inserem/atualizam (`:972-980`). Não há policy de delete nem insert direto da organização no navegador.
- Eventos/tarefas: visibilidade e escrita passam pelos helpers; colaborador atua no que é seu e gestores podem operar itens de equipe não privados (`:982-1008`).
- As policies de compatibilidade concedem leitura de `clientes`, `imoveis`, `crm_oportunidades`, `contratos` e `alertas` a papéis da organização cujo `legacy_corretor_id` coincide com o `corretor_id` do registro (`:1094-1125`). Escritas legadas continuam ancoradas em `get_corretor_id()`.
- `supabase/tests/routine_rls.sql:52-56` cobre outsider sem leitura; `:64-72` cobre título privado mascarado; `:79-94` impede delegação por colaborador; `:101-115` prova tabelas de calendário backend-only; `:165-186` impede vínculo de tarefa com cliente de outra organização. Esses testes existem no repositório, mas não foram executados neste review.

### Lacuna para white-label

O vínculo `legacy_corretor_id UNIQUE` é útil como etapa de compatibilidade, mas mistura “organização”, “conta comercial”, “tenant de dados” e “corretor proprietário”. Para white-label multi-organização, é preciso decidir se:

- `routine_organizations.id` vira o `tenant_id` canônico de todo o produto;
- haverá outra entidade `tenant/account` acima da organização operacional;
- marca/domínio/configuração pertencem à organização ou a um revendedor/white-label acima dela.

Sem essa decisão, remover o unique de membership ou permitir troca de organização faria `get_corretor_id()` e queries com `LIMIT 1` se tornarem ambíguas.

## 4. Queries e fronteiras de isolamento

### Caminho protegido por RLS

- `api/src/prisma/tenant-db.ts:13-28` abre transação, grava `request.jwt.claims` com escopo local e executa `SET LOCAL ROLE authenticated`; todas as queries no callback ficam sujeitas às policies existentes.
- `api/src/auth/tokens.ts:7-8` documenta que tokens próprios preservam `sub`, `role` e `email` justamente para RLS e `get_corretor_id()` não distinguirem o emissor.
- Serviços de Rotina usam `TenantDb` (`api/src/rotina/rotina.service.ts:3,38`; `api/src/rotina/comando/rotina-comando.service.ts:3,57`). O contexto é derivado da membership, não aceito diretamente do cliente.
- Vantagem para reuso: o isolamento reside no banco e acompanha a migração de PostgREST para NestJS.

### Caminho owner-level/bypass

- `PrismaService` usa a conexão dona; esse caminho pode contornar RLS. Portanto cada repositório fora de `TenantDb` precisa de filtro explícito e revisão independente.
- `api/src/rotina/google/rotina-google.repo.ts:7-12` explicita essa exceção: tabelas `calendar_*` sem grant a `authenticated` são acessadas pelo dono; requisições de usuário filtram `organization_id` e `user_id`, enquanto callback/webhook/job localizam por segredo/ID interno.
- O repositório usa allowlists de colunas antes de interpolar identificadores SQL (`api/src/rotina/google/rotina-google.repo.ts:42-79`). Isso reduz risco de coluna arbitrária, mas não substitui a verificação de tenant em cada `WHERE`.
- A futura camada white-label deve classificar formalmente todas as queries em: `TenantDb/RLS`, backend global, job interno ou acesso público. Hoje essa disciplina existe em módulos importantes, mas não é expressa como um contrato único no schema.

### Divergência Central Comercial

- `api/prisma/migrations/20261011100000_central_comercial/migration.sql:5-42` cria leads com `owner_id → auth.users(id)`, índices por owner/status/telefone e policy `owner_all`.
- Interações, vendas, recebimentos, despesas, projeção e roteiros repetem `owner_id` e RLS por `auth.uid()` (`:44-175`). Há FKs/cascades coerentes dentro do módulo e uniques úteis (`interacao(id,owner_id)`, venda por lead, roteiro por owner/nome/versão).
- Para uma equipe, dois membros da mesma `routine_organization` não compartilham automaticamente esses dados. É uma fronteira diferente do `legacy_corretor_id` e deve ser adaptada antes de prometer operação organizacional compartilhada.

## 5. PK, FK, índices e constraints — leitura transversal

- O schema gerado modela PKs UUID na maioria das tabelas; há PKs bigint autoincrementais em logs/auditoria e chaves compostas em rate limits/preferências. O inventário completo de models começa em `api/prisma/schema.prisma:163` e termina em `:3068`.
- As relações usam cascades para filhos estritamente dependentes, `SET NULL` para referências históricas e `RESTRICT/NO ACTION` onde a remoção deve ser bloqueada. Exemplo material: `contratos.cliente_id` e `imovel_id` estão `Restrict` no estado atual (`schema.prisma:1007-1009`), enquanto filhos de contrato seguem cascade/set-null conforme finalidade (`:1010-1017`).
- Checks e índices parciais não cabem integralmente no Prisma; os comentários gerados avisam “só no SQL”. Exemplos: filas e WhatsApp têm índices parciais de claim/due/pending; Rotina possui `idx_routine_events_calendar`, `idx_routine_tasks_due`, uniques condicionais de links e membership ativa (`schema.prisma:2615-2957`).
- `routine_events` e `routine_tasks` validam status/prioridade/visibilidade/origem, intervalo e vínculos; FKs de entidades operacionais usam `SET NULL`, preservando atividade quando cliente/imóvel/negócio/contrato desaparece (`supabase/.../20260821004218_rotina_operacional.sql:200-268`).
- `routine_reminders` exige exatamente um entre `event_id` e `task_id` (`:280-295`); `routine_automation_runs` deduplica por `(organization_id,dedupe_key)` (`:330-342`).
- As duas tabelas históricas `_backfill_comissoes_20260727` e `_backup_lancamentos_dup_20260727` deliberadamente não têm PK/FK (`20261006180000_tabelas_historicas/migration.sql:1-37`). São preservação, não domínio para novas queries.

Risco estrutural: FKs para `auth.users` continuam centrais mesmo após login próprio. A baseline cria/compatibiliza `auth.users`, e o cadastro da API ainda escreve nela antes de `usuarios` (`api/src/auth/usuarios.repo.ts:131-172`). Isso é compatibilidade intencional, mas mantém acoplamento ao schema `auth`; não deve ser removido sem mapear todas as FKs e triggers.

## 6. Grants, RLS, views, funções e triggers

### Grants e RLS

- Os 122 models públicos registram “RLS ligado” no schema gerado; as duas tabelas históricas também habilitam RLS sem policy. Não há ocorrência de `DISABLE ROW LEVEL SECURITY` nem `FORCE ROW LEVEL SECURITY` nas migrations Prisma.
- Ausência de `FORCE RLS` significa que o dono da tabela continua podendo contornar policies. Isso é esperado para jobs/migrations, mas torna crítico o uso disciplinado de `TenantDb` nas requisições de usuário.
- A baseline herdou grants amplos da fase Supabase; as migrations de 2026-10-04/05 reduzem privilégios de `anon` e privilégios DDL/maintenance. `authenticated` ainda conserva CRUD onde o frontend/rotas legadas precisam, condicionado por RLS.
- Exceções públicas de escrita permanecem apenas em `fachada_leads` e `fachada_escaneamentos` (`20261005140000_anon_sem_escrita/migration.sql:1-31`). Leitura pública de imóvel/foto exige ativo, anunciado e disponível (`0_init/migration.sql:11483-11502`).
- Ponto de higiene: `v_leads_whatsapp` recebeu grants DML amplos na baseline (`0_init/migration.sql:12308-12311`). As migrations posteriores removem escrita de `anon`, mas não revogam `INSERT/UPDATE/DELETE` de `authenticated` nessa view. A definição com agregações/subqueries tende a não ser atualizável, mas o grant excede o necessário; deve ser normalizado para `SELECT` em uma futura migration revisada.

### Views

- `v_leads_whatsapp`: criada com `security_invoker=true` em `0_init/migration.sql:10628-10648`; deriva clientes/histórico e preserva RLS do chamador.
- `lotti_agent_latest_messages`: criada/reposta com `security_invoker=true`, `REVOKE ALL` de `public, anon` e `GRANT SELECT` a `authenticated, service_role` em `20261009180000_ultima_mensagem_da_conversa/migration.sql:1-12`.
- `schema.prisma:5` declara explicitamente que as duas views ficam fora do Prisma.

### Funções e triggers

- A baseline concentra regras de cota, onboarding, RLS helpers, auditoria, Asaas, CRM, Rotina e agente em funções SQL. Como o schema Prisma não as representa, qualquer fork white-label precisa portar a migration inteira ou extrair um catálogo dirigido; copiar só models perde comportamento e segurança.
- Rotina possui 16 funções nomeadas na migration histórica, incluindo helpers privados, validação de entidades, detecção de conflitos e registro no CRM. `routine_detect_conflicts` mascara evento privado como “Horário ocupado” e concede execução apenas a `authenticated` (`supabase/.../20260821004218_rotina_operacional.sql:801-852`).
- `routine_register_completion` é `SECURITY DEFINER`, valida autorização, suporta duas variantes históricas de `historico_contatos` e atualiza `clientes.ultimo_contato` apenas no `legacy_corretor_id` da organização (`:854-925`). É útil para compatibilidade, mas aumenta a superfície que deve ser reavaliada quando o tenant canônico mudar.
- Triggers relevantes de Rotina: bootstrap da organização, seed de automações, timestamps, versionamento/log de eventos/tarefas e validação de vínculos. O schema gerado registra também `auditar_suporte` em praticamente todas as tabelas operacionais.
- Funções `SECURITY DEFINER` devem manter `search_path` fixo, `REVOKE` de `PUBLIC` e validação explícita de ator/tenant. O padrão está presente nos helpers de Rotina; uma revisão futura deve procurar exceções em todas as 236 funções, pois este review não fez prova semântica individual de cada uma.

## 7. Storage e metadados de arquivo

### Supabase Storage histórico

- `supabase/migrations/20260106010609_...sql:7-138` cria buckets e policies iniciais de `imoveis-fotos`, `documentos` e `avatars`.
- `20260519150000_ai_assistant_tables.sql:62-64` cria `ai-attachments`.
- `20260115123324_...sql:37-62` cria `videos`; `20260916000100_lotti_manual_inbox.sql:54-55` cria `lotti-inbox-audio`.
- `20260715120000_fix_storage_idor.sql:4-89` documenta e corrige policies que antes filtravam apenas por bucket; passa a verificar `owner`/pasta. `20260812090000_isolamento_multiusuario.sql:108-113` mostra que o endurecimento continuou.
- Objetos `storage.buckets`/`storage.objects` não aparecem nas migrations Prisma atuais. Logo Supabase Storage não faz parte da baseline portátil do banco da API.

### Garage/API atual

- `api/src/arquivos/arquivos.controller.ts:31-35` reconhece seis buckets: `imoveis-fotos`, `videos`, `documentos`, `ai-attachments`, `lotti-inbox-files` e `lotti-inbox-audio`.
- As rotas de upload/download/delete passam pelo `StorageService` e por verificações do repositório (`arquivos.controller.ts:90-270`). Fotos/vídeos públicos são separados de documentos/anexos/inbox privados.
- `api/src/arquivos/arquivos.repo.ts:21-63` usa `get_corretor_id()` para prefixos privados e valida propriedade pela linha de metadados (`imovel_fotos`, `documentos`, `ai_attachments` etc.).
- `docs/superpowers/specs/2026-10-05-api-lotti-arquivos-garage-contrato.md:441-445` registra seis buckets, ordem de virada API → cópia → `VITE_API_URL`; `:448-463` registra URLs Supabase ainda gravadas e produtores pendentes na época do contrato.

Classificação: o desenho de autorização da API/Garage é **reaproveitável**, mas a migração está **parcial** como capacidade de repositório. Não foi conferido nenhum objeto, contagem, URL ou bucket real. `videos` é especialmente inconsistente: o bucket/rotas existem, mas não há model `Video` no schema atual; o handoff também registra que a tabela `videos` não existe. Tratar o recurso como ausente até haver migration/metadado canônico.

## 8. Mapa reaproveitar / adaptar / parcial / ausente / obsoleto

| Classificação | Item | Evidência e decisão |
|---|---|---|
| Reaproveitar | Trilha `api/prisma/migrations` + schema gerado | Fonte única documentada em `api/prisma/README.md:3-27`; mantém SQL avançado fora do ORM |
| Reaproveitar | `TenantDb` | Claims + `SET LOCAL ROLE authenticated` em transação (`api/src/prisma/tenant-db.ts:13-28`) |
| Reaproveitar | Rotina/calendário por `organization_id` | 18 tabelas, RLS por membership/papel, credenciais backend-only e testes de isolamento |
| Reaproveitar | Views com `security_invoker` | `v_leads_whatsapp` e `lotti_agent_latest_messages` preservam RLS do chamador |
| Reaproveitar | Grants mínimos de `anon` | Escrita pública restrita a duas tabelas de fachada (`20261005140000...:1-31`) |
| Adaptar | `legacy_corretor_id` | Ponte 1:1 útil, mas deve deixar de ser a única resolução implícita do tenant |
| Adaptar | Domínio legado por `corretor_id` | CRM, imóveis, contratos, financeiro, billing e WhatsApp dependem da conta-raiz |
| Adaptar | Membership única ativa | `uq_routine_membership_ativa_por_usuario` bloqueia multi-organização; código usa `LIMIT 1` |
| Adaptar | Central Comercial por `owner_id` | Isolamento individual diverge da equipe/organização (`20261011100000...:5-175`) |
| Adaptar | Acessos por `PrismaService` dono | Precisam contrato explícito de escopo; RLS não protege o owner |
| Adaptar | Catálogo/assinatura/branding | Distinguir configuração global do operador, marca white-label e assinatura do tenant |
| Parcial | Storage Garage | API cobre seis buckets, mas metadados/produtores/URLs históricas não são uniformes |
| Parcial | IA gateway | `ai_conversations/messages/attachments` existem; `ai_runs`, `ai_tool_calls` e `ai_action_proposals` aparecem apenas em `supabase/migrations/20260821002556...:141-302`, não no schema/migrations Prisma |
| Parcial | Grants de views | `v_leads_whatsapp` conserva grants DML desnecessários para `authenticated` |
| Ausente | Tenant/brand canônico | Não há tabela/coluna universal que conecte todos os domínios à marca/tenant |
| Ausente | Seleção de organização | Nenhum `active_organization_id` confiável por sessão/request; contexto usa membership única |
| Ausente | `videos` relacional | Bucket e rotas existem, model/tabela atual não |
| Ausente | Prova de catálogo/dados G0 remoto | Não houve acesso a banco nem dados reais; aplicação/volumetria das migrations não foi validada |
| Obsoleto para novos deploys | `supabase/migrations` como fila | Pasta congelada; reaplicá-la duplicaria baseline/objetos (`api/prisma/README.md:3-10`) |
| Obsoleto como autorização primária | Policies de `storage.objects` para Garage | Continuam históricas no Supabase, mas não protegem objetos servidos pelo S3/Garage |
| Obsoleto como tenant final | “corretor proprietário = organização = tenant” | Compatibilidade atual, insuficiente para revenda/múltiplas marcas/organizações |

## 9. Lacunas e riscos priorizados

### Críticos antes de multi-organização/white-label

1. **Definir a entidade canônica de tenant e marca.** Sem isso, não há FK universal nem regra inequívoca para `corretor_id`, `organization_id` e `owner_id`.
2. **Tornar o contexto explícito por request.** A membership única e `LIMIT 1` evitam ambiguidade hoje; remover essa trava sem `active tenant` assinado/validado quebraria `get_corretor_id()` e caches/queries.
3. **Inventariar todos os caminhos owner-level.** Queries via `PrismaService` podem bypassar RLS. Cada caminho precisa filtro pelo tenant resolvido, não por ID recebido do cliente.
4. **Planejar a conversão das FKs e cascades.** Alterar ownership em tabelas financeiras, contratos, mensagens e arquivos exige backfill auditável e preservação de histórico.

### Altos

5. **Central Comercial individual.** `owner_id=auth.uid()` impede compartilhamento natural na equipe e diverge da Rotina.
6. **Storage parcial.** É preciso um inventário de objetos por bucket, produtor, metadado e URL antes de desligar o Supabase ou trocar domínio/marca.
7. **Objetos SQL fora do Prisma.** Copiar apenas `schema.prisma` omite checks, índices parciais, funções, triggers, grants, policies, views e tabela privada.
8. **Telemetria/propostas de IA ausentes.** O código pode operar sem elas com no-op parcial, mas o produto perde auditoria/ações persistidas; decidir portar ou remover o legado conscientemente.

### Médios

9. **Grant excessivo em `v_leads_whatsapp`.** Reduzir a `SELECT` para `authenticated` numa migration futura.
10. **Acoplamento a `auth.users`.** Login próprio preserva compatibilidade, mas dezenas de FKs/triggers continuam dependentes do schema `auth`.
11. **Duas tabelas históricas sem PK.** Manter read-only/arquivo; não usar como origem de domínio.
12. **Nenhum `FORCE RLS`.** Aceitável para owner/jobs, mas aumenta a importância de separar conexão de tenant e conexão administrativa.

## 10. Compatibilidade, locks, ordem de deploy e recuperação

Nenhuma migration é proposta ou autorizada nesta tarefa. Para a fase que converter ownership, o estado mínimo a registrar antes de qualquer SQL é:

- catálogo real, versão e checksums das migrations aplicadas;
- contagens e nulos/órfãos por `corretor_id`, `organization_id`, `owner_id` e FKs de arquivo;
- usuários com memberships zero, uma ou múltiplas; organizações sem/múltiplos corretores-raiz;
- dependências de views, funções, triggers, policies, jobs e código que chamam `get_corretor_id()`;
- tamanho de tabelas e índices para estimar locks/backfills; nenhuma estimativa de downtime é possível só pelo snapshot.

Ordem segura recomendada, sujeita a decisão arquitetural e ensaio isolado:

1. **Expand:** criar entidade/coluna canônica e índices compatíveis, inicialmente nullable; não remover `corretor_id`/`legacy_corretor_id`.
2. **Backfill por lotes:** preencher tenant com validações de unicidade/orfandade e métricas; evitar `ALTER ... SET NOT NULL` ou validação pesada sem medir lock.
3. **Dual-read/dual-write controlado:** API resolve tenant explícito, preserva compatibilidade e compara resultados.
4. **RLS/grants/functions:** criar policies novas e testar como `authenticated`; revisar separadamente owner/jobs/service paths.
5. **Aplicação:** publicar backend que entende ambos os schemas antes de qualquer frontend com troca de organização.
6. **Cutover:** habilitar seleção/contexto, invalidar caches e observar erros/contagens.
7. **Contract posterior:** só após estabilidade remover ponte/constraints antigas; essa etapa é destrutiva e exige autorização específica.

Recuperação deve privilegiar **forward fix** nas fases expand/backfill. Rollback de código é viável enquanto colunas antigas continuam sendo escritas; rollback de dados depois de trocar/remover ownership pode não ser reversível. Não presumir DDL transacional universal quando houver comandos externos, storage, jobs ou deploys coordenados. Qualquer alteração destrutiva ou em produção exige checkpoint humano explícito.

## 11. Evidências e limites da revisão

Comandos de leitura executados e resultado principal:

- `maestri list`: identificou `DevOps e Release` como este agente e `Orquestrador de Engenharia` como agente conectado.
- `git -C <repo> rev-parse HEAD`: `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`.
- `git -C <repo> status --short`: sem saída.
- inventário de arquivos: 26 migrations Prisma, 119 SQL históricos Supabase, 31 testes TS junto às migrations Supabase.
- leitura lexical do schema: 122 models; todos os comentários de tabela modelada indicam RLS ligado.
- leitura lexical das migrations Prisma: duas views; sem referência a `storage.objects`/`storage.buckets`; sem `DISABLE/FORCE RLS`.

Não verificado:

- migrations aplicadas, dados existentes, volumetria, locks ou grants efetivos em produção/staging;
- comportamento dinâmico de RLS, funções, triggers e queries;
- testes `routine_rls.sql`, suites PGlite/Jest ou geração do schema;
- objetos/URLs/bytes reais no Supabase Storage ou Garage;
- paridade integral, função a função, das 119 migrations Supabase com a baseline Prisma.

O relatório é suficiente para o Gate 1 de inventário e decisão arquitetural; não é aceite para executar uma migration.
