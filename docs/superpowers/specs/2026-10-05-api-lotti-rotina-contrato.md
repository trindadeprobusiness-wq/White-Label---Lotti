# Contrato da API Lotti: módulo rotina (agenda, tarefas, inbox e Google Agenda)

Duas frentes trabalham em paralelo, sem conversar, e cada uma só toca os próprios arquivos. Tudo o que elas precisam combinar está fixado aqui: caminhos, DTOs, SQL, formato de resposta, códigos de erro, porte das Edge Functions e nomes das funções do front.

Base: inventário do módulo rotina (só leitura) e o contrato do módulo 2 (`docs/superpowers/specs/2026-10-04-api-lotti-modulo2-contrato.md`). **Tudo o que este contrato não redefine segue o módulo 2**: §0.2 (TenantDb, `Prisma.sql`, casts, `to_jsonb`, `FORMATO_UUID`, `presentes()` + `jsonb_populate_record`), §0.3 (formato de erro HTTP) e §0.4 (tradutor de erros), §0.5 (testes leem `.text`, fixtures v4).

---

## 0. Regras comuns

### 0.1 Quem é dono de quê

| Frente | Arquivos (só estes) |
|---|---|
| **R** api-rotina | cria tudo em `api/src/rotina/**` e `api/test/sql-real/rotina.test.ts`. Estrutura fixa em §1.1. Classe `RotinaModule` em `api/src/rotina/rotina.module.ts`. |
| **F** front | cria `src/lib/api/rotina.ts` e `src/lib/api/rotina.test.ts`; edita `src/hooks/routine/useRoutine.ts`, `src/hooks/routine/useGoogleCalendarReturn.ts` e `src/components/routine/RoutineCommandBar.tsx`. |

Ninguém edita: `api/src/app.module.ts` (a integração liga o módulo, §5), `api/src/main.ts`, `api/src/prisma/*`, `api/src/auth/*`, `api/src/config/env.ts`, `api/prisma/*`, `api/test/sql-real/harness.ts`, `src/lib/api.ts`, `src/lib/api/http.ts`, `src/lib/api/crm.ts`, `src/types/routine.ts`, `src/lib/routine/*`, `src/pages/Rotina.tsx`, `src/components/routine/RoutineComposerSheet.tsx`, `src/hooks/useOnboarding.ts`, `supabase/**`, `Caddyfile`, `AI_HANDOFF.md`, `docs/*`.

Também valem: nenhuma migration; nada de `prisma migrate/db push/db pull`; nada de commit, stash ou troca de branch; nada contra Supabase, Railway, Google ou rede (os testes simulam `fetch`); segredos só por nome.

### 0.2 Dois caminhos de banco

1. **Caminho do usuário (TenantDb).** Tudo em `routine_*` e as RPCs `routine_detect_conflicts` / `routine_register_completion` passam por `this.db.run(claims, tx => tx.$queryRaw(Prisma.sql\`...\`))`. RLS e `auth.uid()` valem como no PostgREST. É o que o front usa direto hoje, então o comportamento fica idêntico.
2. **Caminho do servidor (dono).** As tabelas `calendar_*` não têm grant para `authenticated`; o porte das Edge Functions (que usavam service_role) roda com `PrismaService` fora do TenantDb: `this.prisma.$queryRaw(Prisma.sql\`...\`)` / `$executeRaw`. Regras obrigatórias neste caminho:
   - só dentro de `rotina-google.repo.ts` e `rotina-comando.service.ts` (lista em §1.1); nenhum controller toca `PrismaService`;
   - todo SQL de uma requisição de usuário filtra por `organization_id = ${org}::uuid and user_id = ${uid}::uuid`, onde `org` vem da membership resolvida no TenantDb (§0.3), nunca do corpo;
   - os caminhos sem usuário (callback OAuth, webhook, job) só localizam a linha por segredo (hash do state, hash do token do canal) ou por id vindo do próprio banco.

Formato de resposta: `to_jsonb(t)` (ou `to_jsonb(t) - '<coluna>'`) como no módulo 2. Casts explícitos em todo parâmetro (`::uuid`, `::text`, `::int`, `::boolean`, `::timestamptz`, `::jsonb`, `::text[]`). Nenhum `$queryRawUnsafe`/`$executeRawUnsafe`. Colunas de escrita entram por `Prisma.raw` só a partir de constantes.

`FORMATO_UUID` é declarado em `rotina.dto.ts` igual ao módulo 2 (8-4-4-4-12 hex, sem versão). `IsUUID` não é usado. Na URL: `ParseUUIDPipe` com `exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.')`.

`LIMITE_LISTA = 1000` (exportado de `rotina.dto.ts`), sempre `limit ${LIMITE_LISTA}::int`. O valor é fixo e igual ao `max-rows` do PostgREST que o front recebe hoje (até 1000 linhas, sem corte no front). Vale para R2, R3, R4, R6 e a leitura de eventos do `syncConnection`. A frente F não corta nem pagina; os testes de R conferem `1000` em `.values` e os de F não dependem do número.

### 0.3 Membership (substitui `requireRoutineUser`)

`RotinaService.contexto(claims)` roda no TenantDb:

```sql
select to_jsonb(m) as membership, to_jsonb(o) as organization
from public.routine_memberships m
join public.routine_organizations o on o.id = m.organization_id
where m.user_id = ${claims.sub}::uuid and m.status = 'active'
limit 1
```

- Rotas que exigem rotina (todas menos `GET /rotina/contexto`): sem linha → `403 routine_membership_required` "Sua conta ainda não tem uma rotina ativa.".
- A organização do usuário é sempre `membership.organization_id`. O front não envia `organization_id` em lugar nenhum (ele é ignorado se vier: os DTOs usam `whitelist`, já global).

### 0.4 Erros (`rotina.erros.ts`)

Copia `erroPg`, `erroApi` e o esqueleto de `traduzirErroBanco` do funil (§0.4 do módulo 2), com estes casos próprios, nesta ordem:

| SQLSTATE / mensagem | HTTP | codigo | message |
|---|---|---|---|
| 42501 `routine_client_outside_organization` | 422 | `cliente_fora_da_organizacao` | Este cliente não pertence à sua organização. |
| 42501 `routine_property_outside_organization` | 422 | `imovel_fora_da_organizacao` | Este imóvel não pertence à sua organização. |
| 42501 outros `routine_*_outside_organization` | 422 | `vinculo_fora_da_organizacao` | Um registro vinculado não pertence à sua organização. |
| 42501 `routine_item_forbidden` | 403 | `sem_permissao` | Você não tem permissão para alterar esta atividade. |
| 42501 `acesso negado` (RPC de conflito) | 403 | `sem_permissao` | Você não tem acesso à agenda desta pessoa. |
| 42501 outros (RLS) | 403 | `sem_permissao` | Você não tem permissão para fazer esta alteração. |
| 22023 vindo de `routine_detect_conflicts` (R9 e passo 1 de R10) | 400 | `intervalo_invalido` | O horário de término precisa ser depois do início. |
| 22023 vindo de `routine_register_completion` (R14) | 400 | `tipo_invalido` | Tipo de atividade inválido. |
| 23514 com `routine_events_check`/`end_at` no bruto | 400 | `intervalo_invalido` | O horário de término precisa ser depois do início. |
| 23503 | 422 | `referencia_invalida` | Um registro relacionado não existe mais. Recarregue a página e tente de novo. |
| 22P02, 22007, 22008, 22003, 22001, 23502, 23514 | 400 | `dados_invalidos` | Dados inválidos. Confira os campos e tente de novo. |
| outro | sobe como veio (500 do Nest) | | |

Separação do 22023: o tradutor recebe a origem (`traduzirErroBanco(e, { origem?: 'conflitos' | 'conclusao' })`); sem origem, 22023 cai em `dados_invalidos`. Na prática `tipo_invalido` não chega ao cliente: R14 manda só `'event'`/`'task'` por constante e trata o erro da RPC como melhor esforço; ele aparece apenas no log (`registrado_no_crm:false`, código `tipo_invalido`).

Erros fixos de serviço:

| HTTP | codigo | message | Quando |
|---|---|---|---|
| 404 | `nao_encontrado` | Atividade não encontrada. | update/complete/remove que não acha a linha visível e não há token de concorrência |
| 409 | `CONCURRENCY_CONFLICT` | Esse compromisso mudou em outro lugar. Recarregue e tente de novo. | update com `expected_updated_at` que não bate |
| 409 | `CONFLICT` | Existe outro compromisso nesse horário. | criação de evento com conflito (corpo traz `conflicts`) |
| 409 | `google_nao_conectado` | Google Agenda não conectado. | sync/configure sem conexão `connected` (configure: qualquer conexão) |
| 400 | `nada_para_atualizar` | Nada para atualizar. | patch vazio |
| 503 | `google_nao_configurado` | A integração com o Google Agenda não está configurada no servidor. | falta `GOOGLE_CALENDAR_CLIENT_ID`, `_SECRET` ou `GOOGLE_TOKEN_ENCRYPTION_KEY`, só nas rotas marcadas na matriz de §0.5 |
| 503 | `ia_nao_configurada` | A interpretação por IA não está configurada no servidor. | falta `GEMINI_API_KEY` |
| 500 | `sync_pendente` | A sincronização ficou pendente e será tentada novamente. | falha no sync (grava `last_error_code`) |
| 500 | `conexao_falhou` | Não foi possível concluir a conexão. | falha em start/disconnect |
| 500 | `comando_falhou` | Não consegui interpretar agora. | falha do Gemini/validação |

`http.ts` (front) põe em `message` só os códigos de `CODIGOS_DO_BANCO`; por isso `rotina.ts` (§4.1) relança `CONFLICT` e `CONCURRENCY_CONFLICT` como `Error` próprio (§4.2), sem depender de `http.ts`.

### 0.5 Variáveis do módulo (lidas por `rotina.config.ts` de `process.env`, todas opcionais)

| Variável | Uso | Faltando |
|---|---|---|
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | OAuth | 503 `google_nao_configurado` só nas rotas marcadas na matriz abaixo; callback redireciona com `google_calendar=error` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | AES-256-GCM (hex 64 ou base64/base64url de 32 bytes) | idem |
| `GOOGLE_CALENDAR_REDIRECT_URI` | callback; padrão: `${SUPABASE_URL}/functions/v1/google-calendar-auth/callback` se `SUPABASE_URL` existir, senão 503 | |
| `GOOGLE_CALENDAR_APP_REDIRECT_URL` | volta ao app; padrão `http://localhost:8085/rotina` | |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | endereço público do webhook | sem watch (como hoje) |
| `GEMINI_API_KEY` | comando por IA | 503 `ia_nao_configurada` |
| `LOTTI_AI_FAST_MODEL` | modelo; padrão `gemini-2.5-flash` | |
| `ROUTINE_CALENDAR_MAINTAIN_ENABLED` (nova) | `'true'` liga o job de 30 min | job não é registrado |

Matriz de exigência (quem responde 503 `google_nao_configurado`):

| Rota | Exige client id/secret | Exige `GOOGLE_TOKEN_ENCRYPTION_KEY` | Sem a variável |
|---|---|---|---|
| G1 status | não | não | responde normalmente (só lê a tabela, como hoje) |
| G2 conectar | sim | sim | 503 |
| G3 desconectar | não | não | sempre apaga a conexão; `channels/stop` e `revoke` só rodam se houver chave e client (sem elas, pula o melhor esforço e apaga mesmo assim) |
| G4 privacidade, G5/G6 calendários | não | não | respondem normalmente |
| G7 sincronizar | sim | sim | 503 |
| P1 callback | sim | sim | redireciona com `google_calendar=error` (§2.2) |
| P2 webhook | sim | sim | 503 (o Google tenta de novo) |
| job `maintain` | sim | sim | não é registrado |
| `pushEventoEmSegundoPlano` | sim | sim | não faz nada (só log) |

A config é lida a cada uso (função `lerConfigRotina(env = process.env)`), para os testes trocarem variáveis sem reiniciar. `ROUTINE_INTERNAL_SECRET` deixa de ser usado (o webhook chama o serviço direto).

---

## 1. Frente R: API (`api/src/rotina/`)

### 1.1 Estrutura

| Arquivo | Conteúdo |
|---|---|
| `rotina.module.ts` | `RotinaModule`: imports `PrismaModule` (ou o provider que hoje entrega `TenantDb`/`PrismaService`, igual aos módulos do CRM) e `RedisModule`; controllers `RotinaController`, `RotinaGoogleController`, `RotinaGooglePublicoController`; providers abaixo. |
| `rotina.dto.ts` | `FORMATO_UUID`, `LIMITE_LISTA`, listas de valores e todos os DTOs (§1.2). |
| `rotina.erros.ts` | §0.4. |
| `rotina.config.ts` | §0.5. |
| `rotina.service.ts` | rotas de `routine_*` (TenantDb). |
| `rotina.controller.ts` | `@Controller('rotina')` + `SupabaseAuthGuard`. |
| `google/cripto.ts` | `cifrar`, `decifrar`, `sha256Base64Url`, `tokenAleatorio`, `compararSegredo` (§2.1). |
| `google/mapeamento.ts` | porte fiel de `calendar-mapping.ts`. |
| `google/google-http.ts` | `googleRequest` com backoff, usando `fetch` global injetável. |
| `google/rotina-google.repo.ts` | todo SQL do caminho do servidor. |
| `google/rotina-google.service.ts` | auth (start/status/configure/disconnect/callback), sync, webhook, maintain. |
| `google/rotina-google.controller.ts` | `RotinaGoogleController` (autenticado). |
| `google/rotina-google-publico.controller.ts` | `RotinaGooglePublicoController` (callback + webhook, sem guard). |
| `google/rotina-maintain.job.ts` | job BullMQ (§2.6). |
| `comando/rotina-comando.service.ts` | porte de `routine-command` (§2.5). |
| specs Jest | `rotina.service.spec.ts`, `rotina.controller.spec.ts`, `google/cripto.spec.ts`, `google/mapeamento.spec.ts`, `google/rotina-google.service.spec.ts`, `comando/rotina-comando.service.spec.ts`. |

### 1.2 DTOs (`rotina.dto.ts`)

Listas exportadas:

```ts
export const PRIORIDADES = ['low', 'medium', 'high', 'urgent'] as const;
export const VISIBILIDADES = ['team', 'private'] as const;
export const ORIGENS_EVENTO = ['lotti', 'google', 'automation', 'ai', 'other_user'] as const;
export const ORIGENS_TAREFA = [...ORIGENS_EVENTO, 'inbox'] as const;
export const TIPOS_INBOX = ['idea', 'note', 'request', 'task', 'audio', 'message', 'service_extract'] as const;
export const MODOS_PRIVACIDADE = ['full', 'partial', 'busy_only'] as const;
export const ACOES_SYNC = ['sync', 'push_event', 'resolve_conflict_lotti', 'resolve_conflict_google'] as const;
```

`activity_type`: `@IsString() @Length(1, 60)` (o banco não tem CHECK; manter o comportamento atual — decisão §6.4).

| DTO | Campos e validação (mensagens em português) |
|---|---|
| `ListarEventosDto` (query) | `inicio`, `fim`: `@IsISO8601()` obrigatórios ("Informe o período."); `responsavel?`: `@Matches(FORMATO_UUID)` ("Responsável inválido."). |
| `ListarTarefasDto` (query) | `responsavel?` idem. |
| `CriarEventoDto` | `title` `@IsString() @Length(1,180)` após `@Transform(trim)` ("Informe o título."); `description?` string\|null; `activity_type` (acima); `priority` `@IsIn(PRIORIDADES)`; `assigned_to` uuid obrigatório; `visibility` `@IsIn(VISIBILIDADES)`; `start_at`, `end_at` `@IsISO8601()`; `all_day` boolean; `recurrence_rule?` string\|null (máx. 500); `location?` string\|null (máx. 300); `source?` `@IsIn(ORIGENS_EVENTO)` (padrão `'lotti'`); `client_id?`, `property_id?` uuid\|null; `reminder_minutes?` `@IsInt() @Min(0) @Max(525600)` ou null. |
| `CriarTarefaDto` | iguais aos de evento sem start/end/all_day/location/reminder; `due_at?` ISO\|null; `source?` `@IsIn(ORIGENS_TAREFA)`. |
| `EditarEventoDto` | todos opcionais (mesmas regras), só: title, description, activity_type, priority, assigned_to, visibility, start_at, end_at, all_day, recurrence_rule, location, client_id, property_id; mais `expected_updated_at?` `@IsISO8601()`. |
| `EditarTarefaDto` | opcionais: title, description, activity_type, priority, assigned_to, visibility, due_at, recurrence_rule, client_id, property_id; `expected_updated_at?`. |
| `ConflitosDto` | `assigned_to` uuid; `start_at`, `end_at` ISO; `exclude_event_id?` uuid\|null. |
| `CriarInboxDto` | `content` string 1..5000 após trim ("Escreva a anotação."); `kind?` `@IsIn(TIPOS_INBOX)` (padrão `'note'`). |
| `ConfigurarPrivacidadeDto` | `privacy_mode` `@IsIn(MODOS_PRIVACIDADE)` ("Modo de privacidade inválido."). |
| `ConfigurarCalendarioDto` | `selected?`, `is_default?` boolean; `sync_direction?` `@IsIn(['import_only','export_only','bidirectional','disabled'])`. |
| `SincronizarDto` | `action` `@IsIn(ACOES_SYNC)` (padrão `'sync'`); `event_id?` uuid, obrigatório (`@ValidateIf`) quando a ação não é `sync` ("Informe a atividade."). |
| `ComandoDto` | `command` string 1..2000 após trim ("Escreva o que deseja organizar."); `timezone?` string máx. 80 (padrão `America/Sao_Paulo`). |

Os campos com null explícito usam `@ValidateIf((_, v) => v !== null && v !== undefined)`.

Colunas de escrita (constantes no service):

```ts
const COLUNAS_EDICAO_EVENTO = ['title','description','activity_type','priority','assigned_to','visibility','start_at','end_at','all_day','recurrence_rule','location','client_id','property_id'] as const;
const COLUNAS_EDICAO_TAREFA = ['title','description','activity_type','priority','assigned_to','visibility','due_at','recurrence_rule','client_id','property_id'] as const;
```

### 1.3 Rotas de `routine_*` (`RotinaController`, prefixo global `/api`)

Todas com `SupabaseAuthGuard` e `@Claims()`. Resposta 200 salvo indicação. "Linha" = `to_jsonb(t)` sem alteração.

| # | Método e caminho | Resposta | Substitui (inventário §1) |
|---|---|---|---|
| R1 | `GET /api/rotina/contexto` | `{ organization: Linha, membership: Linha } \| null` | 1 |
| R2 | `GET /api/rotina/membros` | `Linha[]` | 2 |
| R3 | `GET /api/rotina/eventos?inicio&fim&responsavel` | `Linha[]` (sem expandir recorrência) | 3 |
| R4 | `GET /api/rotina/tarefas?responsavel` | `Linha[]` | 4 |
| R5 | `GET /api/rotina/atividade` | `Linha[]` (40) | 5 |
| R6 | `GET /api/rotina/inbox` | `Linha[]` | 6 |
| R7 | `POST /api/rotina/inbox` (201) | `Linha` | 7 |
| R8 | `POST /api/rotina/inbox/:id/arquivar` (200) | `{ arquivado: true }` | 8 |
| R9 | `POST /api/rotina/conflitos` (200) | `Conflito[]` | 11, 20 |
| R10 | `POST /api/rotina/eventos` (201) | `{ evento: Linha, lembrete_criado: boolean }` | 11–13 |
| R11 | `POST /api/rotina/tarefas` (201) | `Linha` | 14 |
| R12 | `PATCH /api/rotina/eventos/:id` | `Linha` | 15 |
| R13 | `PATCH /api/rotina/tarefas/:id` | `Linha` | 16 |
| R14 | `POST /api/rotina/eventos/:id/concluir`, `POST /api/rotina/tarefas/:id/concluir` (200) | `{ item: Linha, registrado_no_crm: boolean }` | 17, 9 |
| R15 | `DELETE /api/rotina/eventos/:id`, `DELETE /api/rotina/tarefas/:id` (200) | `{ removido: true }` | 18 |

`Conflito = { event_id, title, start_at, end_at, is_private }` (saída da RPC por `to_jsonb`).

**SQL de cada rota** (todas dentro de `db.run(claims, …)`; `org` = membership de §0.3 resolvida no mesmo `run` com a consulta de §0.3):

- **R1**: a consulta de §0.3. Sem linha → `null` (200). Erro 42P01 → `null` (paridade com `42P01/PGRST205`). Sem 403.
- **R2**:
  ```sql
  select to_jsonb(m) from public.routine_memberships m
  where m.organization_id = ${org}::uuid and m.status = 'active'
  order by m.display_name asc nulls last limit ${LIMITE_LISTA}::int
  ```
- **R3** (uma consulta, mesma união das duas do front):
  ```sql
  select to_jsonb(e) from public.routine_events e
  where e.organization_id = ${org}::uuid and e.deleted_at is null
    and (${resp}::uuid is null or e.assigned_to = ${resp}::uuid)
    and e.start_at <= ${fim}::timestamptz
    and (e.end_at >= ${inicio}::timestamptz or e.recurrence_rule is not null)
  order by e.start_at asc limit ${LIMITE_LISTA}::int
  ```
  O escopo `mine` é resolvido no front (manda `responsavel = user.id`), como hoje.
- **R4**: `... from public.routine_tasks t where t.organization_id = ${org}::uuid and t.deleted_at is null and (${resp}::uuid is null or t.assigned_to = ${resp}::uuid) order by t.due_at asc nulls last limit ${LIMITE_LISTA}::int`.
- **R5**: `routine_activity_log` da org, `order by created_at desc limit 40` (40 escrito como `${40}::int` por constante `LIMITE_ATIVIDADE`).
- **R6**: `routine_inbox where organization_id = org and user_id = ${claims.sub}::uuid and status = 'unprocessed' order by created_at desc limit LIMITE_LISTA`.
- **R7**: `insert into public.routine_inbox (organization_id, user_id, kind, content) values (${org}::uuid, ${uid}::uuid, ${kind}::text, ${content}::text) returning to_jsonb(routine_inbox.*)`.
- **R8**: `update public.routine_inbox set status = 'archived' where id = ${id}::uuid and user_id = ${uid}::uuid returning id`. Nenhuma linha → 404 `nao_encontrado` "Anotação não encontrada.".
- **R9**: `select to_jsonb(c) from public.routine_detect_conflicts(${assigned}::uuid, ${start}::timestamptz, ${end}::timestamptz, ${excl}::uuid) c`. Erros pelo tradutor (22023 → `intervalo_invalido`, 42501 → `sem_permissao`).
- **R10** (um só `run`, nesta ordem):
  1. conflito (SQL de R9 com `excl = null`); se houver linha → `throw erroApi(409, 'CONFLICT', 'Existe outro compromisso nesse horário.', { conflicts })` (rollback, nada gravado).
  2. insert com `jsonb_populate_record(null::public.routine_events, ${json}::jsonb)`, onde o JSON tem: as colunas do DTO, `organization_id = org`, `created_by = claims.sub`, `timezone = organization.timezone`, `source` (padrão `'lotti'`), `sync_status = 'pending'`; `returning to_jsonb(routine_events.*)`.
  3. se `reminder_minutes != null`: insert em `routine_reminders (organization_id, user_id, event_id, remind_at, minutes_before)` com `user_id = assigned_to`, `remind_at = start_at - make_interval(mins => ${min}::int)`, protegido por **SAVEPOINT** (sem checagem prévia):
     ```sql
     savepoint lembrete;
     insert into public.routine_reminders (...) values (...);
     -- sucesso: release savepoint lembrete;                 lembrete_criado = true
     -- erro 42501, 23514 ou 23503: rollback to savepoint lembrete;  lembrete_criado = false
     ```
     Cada comando é um `tx.$executeRaw` separado dentro do mesmo `run`. Só 42501, 23514 e 23503 são engolidos, sempre com `rollback to savepoint lembrete` antes de seguir; qualquer outro erro sobe e aborta o `run` inteiro. Assim `lembrete_criado = false` exatamente quando a policy/constraints recusariam o insert no PostgREST hoje, sem reproduzir a policy em SQL e sem deixar a transação abortada (`commitsAbortados` continua 0; o savepoint é a exceção permitida à regra do módulo 2 de "erro engolido aborta a transação"). Para referência, a assinatura conferida no baseline é `private.routine_member_has_role(_organization_id uuid, _roles text[]) returns boolean`, mas a frente R **não** a chama.
  4. Depois do commit: dispara `google.pushEventoEmSegundoPlano(eventId, assignedTo)` (§2.3), sem `await`, erro só em log.
- **R11**: insert de tarefa (mesmo padrão, sem conflito/lembrete), `returning to_jsonb(...)`.
- **R12/R13**: `presentes(dto, COLUNAS_EDICAO_*)`; vazio → 400 `nada_para_atualizar`. SQL:
  ```sql
  update public.routine_events t set (<cols>) = (select <r.cols> from jsonb_populate_record(null::public.routine_events, ${json}::jsonb) r)
  where t.id = ${id}::uuid and t.organization_id = ${org}::uuid and t.deleted_at is null
    and (${esperado}::timestamptz is null or t.updated_at = ${esperado}::timestamptz)
  returning to_jsonb(t)
  ```
  Nenhuma linha: com `expected_updated_at` → 409 `CONCURRENCY_CONFLICT`; sem → 404. Evento: depois do commit, push em segundo plano.
- **R14**: `update ... set status = 'completed', completed_at = now() where id and org and deleted_at is null returning to_jsonb(t)`; nenhuma linha → 404. Se `item.client_id` não for null: `select public.routine_register_completion(${'event'|'task'}::text, ${id}::uuid) as ok` **em outro `run`** depois do commit (melhor esforço, como hoje: erro vira `registrado_no_crm: false` e log com o SQLSTATE; a conclusão não volta). Evento: push em segundo plano.
- **R15**: `update ... set deleted_at = now() where id and org and deleted_at is null returning id`; nenhuma linha → 404. Evento: push em segundo plano.

`updated_at` sai do `to_jsonb` com microssegundos; o front devolve o mesmo texto em `expected_updated_at`, e o cast `::timestamptz` compara exato (é o que o PostgREST faz hoje com `eq updated_at`).

### 1.4 Rotas do Google (`RotinaGoogleController`, autenticado)

| # | Método e caminho | Resposta | Substitui |
|---|---|---|---|
| G1 | `GET /api/rotina/google/status` | `{connected:false, status:'not_connected'}` ou `{connected, status, provider_email, privacy_mode, last_sync_at, last_error_code}` | 21 |
| G2 | `POST /api/rotina/google/conectar` | `{ authorization_url }` | 23 |
| G3 | `POST /api/rotina/google/desconectar` | `{disconnected:true}` / `{disconnected:true, idempotent:true}` | 25 |
| G4 | `PATCH /api/rotina/google/privacidade` | `{configured:true, privacy_mode}` | 27 |
| G5 | `GET /api/rotina/google/calendarios` | `Linha[]` de `external_calendars` (sem colunas sensíveis; a tabela não tem nenhuma) `order by is_primary desc` | 22 |
| G6 | `PATCH /api/rotina/google/calendarios/:id` | `Linha` | 26 |
| G7 | `POST /api/rotina/google/sincronizar` | `{synced:true, imported, cancelled, pushed, conflicts}` ou resultado da ação | 10, 19, 24, 28 |

G5 e G6 rodam no TenantDb (há grant e policy em `external_calendars`). G6, numa transação só: se `is_default === true`, `update external_calendars set is_default = false where connection_id = (select connection_id from external_calendars where id = ${id}::uuid) and id <> ${id}::uuid and user_id = ${uid}::uuid`; depois o patch por `jsonb_populate_record`. Nenhuma linha → 404 "Calendário não encontrado.". (Corrige a falta de transação, defeito 9.)

Demais rotas (G1–G4, G7) usam o caminho do servidor com `org` e `uid` da membership.

### 1.5 Rotas públicas (`RotinaGooglePublicoController`, sem guard)

| # | Método e caminho | Comportamento |
|---|---|---|
| P1 | `GET /api/google-agenda/callback` | §2.2 callback; responde `302 Location`. |
| P2 | `POST /api/google-agenda/webhook` | §2.4; responde `200 {received:true}` / `{received:true, duplicate:true}`, 400, 401, 500. |

Virada (fora das frentes, §5): o Caddy passa a mandar `/google-agenda/callback` para `api/google-agenda/callback` da API; o redirect URI cadastrado no Google não muda.

---

## 2. Porte das Edge Functions (frente R)

Porte fiel da lógica Deno do inventário §2. Onde o Deno usava cliente admin, usa o caminho do servidor (§0.2.2). Onde usava cliente do usuário, usa TenantDb. `fetch` é o global do Node 20+, injetado no construtor (`private readonly fetcher: typeof fetch = fetch`) para os testes.

### 2.1 `google/cripto.ts` (compatível byte a byte)

- Chave: hex de 64 caracteres → 32 bytes; senão base64/base64url que decodifique em exatamente 32 bytes; senão `Error('invalid_encryption_key')` (vira 503).
- `cifrar(texto)`: iv 12 bytes aleatórios, `aes-256-gcm`, saída `'v1.' + base64(iv ‖ ciphertext ‖ tag16)` (base64 padrão, com `=`).
- `decifrar(s)`: exige prefixo `v1.`; `iv = buf[0..12)`, `tag = últimos 16`, `ciphertext = meio`; `setAuthTag(tag)`. Falha → `Error('token_decrypt_failed')`.
- `sha256Base64Url(texto)`, `tokenAleatorio(n)` (base64url sem `=`), `compararSegredo(a, b)` com `timingSafeEqual` sobre os hashes (defeito 15).
- Teste obrigatório: um vetor fixo gerado pelo WebCrypto (`crypto.subtle` existe no Node) com chave e iv fixos é decifrado pelo `decifrar`, e o inverso.

### 2.2 `google-calendar-auth`

- **G2 start**: igual ao Deno (state 32, verifier 64, challenge S256, `oauth_expires_at = now() + interval '10 minutes'`, scopes e parâmetros idênticos). **Mudança (§6.2):** se a conexão existente está `connected`, não troca `status`; grava só `oauth_state_hash`, `pkce_verifier_ciphertext`, `oauth_expires_at`. O callback aceita então `status in ('pending','connected')` com state válido.
  SQL: `insert into public.calendar_connections (organization_id, user_id, provider, status, oauth_state_hash, pkce_verifier_ciphertext, oauth_expires_at, last_error_code) values (${org}::uuid, ${uid}::uuid, 'google', 'pending', ${hash}::text, ${ver}::text, now() + interval '10 minutes', null) on conflict (organization_id, user_id, provider) do update set oauth_state_hash = excluded.oauth_state_hash, pkce_verifier_ciphertext = excluded.pkce_verifier_ciphertext, oauth_expires_at = excluded.oauth_expires_at, last_error_code = null, status = case when calendar_connections.status = 'connected' then 'connected' else 'pending' end, updated_at = now()`.
- **G1 status**: `select status, provider_email, privacy_mode, last_sync_at, last_error_code from calendar_connections where organization_id and user_id and provider='google'`. `connected = status === 'connected'`. Datas como texto ISO do `to_jsonb`.
- **G4 configure**: sem conexão → 409 `google_nao_conectado`; update por id+org+user.
- **G3 disconnect**: idêntico ao Deno (melhor esforço: token, `channels/stop` de cada canal ativo, `revoke`; depois `delete from calendar_connections where id and organization_id and user_id`). Sem client/chave (matriz §0.5) o melhor esforço é pulado e o delete acontece. Falha no delete → 500 `conexao_falhou`.
- **P1 callback**: passos 1–7 do inventário §2.2, com o upsert de `external_calendars` **preservando** `selected`/`is_default` existentes (§6.3): `on conflict (connection_id, external_calendar_id) do update set summary = excluded.summary, color = excluded.color, access_role = excluded.access_role, is_primary = excluded.is_primary, sync_direction = excluded.sync_direction, updated_at = now()`. Redirecionamento final `?google_calendar=connected`.
- **URL de retorno (conferida no Deno, `appRedirect`):** um único parâmetro, `google_calendar`, com valor `connected` ou `error`, gravado com `url.searchParams.set('google_calendar', ...)` sobre `GOOGLE_CALENDAR_APP_REDIRECT_URL`. Nenhum outro parâmetro (sem `reason`); o código do erro fica só em `last_error_code` e no log. `useGoogleCalendarReturn` (frente F) lê só `google_calendar`.
- **P1 com erro (mudança §6.2):** em qualquer falha depois de achar a conexão pelo state (inclusive `error=access_denied` com state válido, quando a pessoa desiste):
  - se a conexão estava `connected` (o start a manteve assim): `update public.calendar_connections set oauth_state_hash = null, pkce_verifier_ciphertext = null, oauth_expires_at = null, updated_at = now() where id = ${id}::uuid`. **Não** troca `status` nem `last_error_code`; os tokens anteriores seguem valendo;
  - se estava `pending`: igual ao Deno, `status = 'error'`, `last_error_code = safeErrorCode(e)` (ou `oauth_denied` quando veio `error`) e zera state, verifier e expiração.
  - Sem `state` ou sem linha que case: só redireciona com `google_calendar=error`, sem gravar nada.

### 2.3 `google-calendar-sync`

`RotinaGoogleService.sincronizar(claims, dto)` (G7) e `syncConnection(conn, target?, force)` interno, com estas regras:

- `sync` → `syncConnection` completo. `push_event` → só o evento. `resolve_conflict_lotti` → só o evento, `force`. `resolve_conflict_google` → `acceptGoogleVersion`.
- **Conexão do push (mudança §6.1):** para `push_event`/`resolve_conflict_*`, a conexão usada é a do **responsável** do evento (`routine_events.assigned_to`), não a do chamador. Antes, o service confirma no TenantDb que o chamador enxerga o evento (`select 1 from routine_events where id and organization_id = org`); sem linha → 404. Sem conexão `connected` do responsável: `push_event` devolve `{skipped:true}` (200); `resolve_*` → 409 `google_nao_conectado`.
- `pushEventoEmSegundoPlano(eventId, assignedTo, responsavelAnterior?)` (usado por R10/R12/R14/R15) faz o mesmo sem a checagem do TenantDb (o evento acabou de ser gravado pelo próprio usuário).
- **Troca de responsável (R12 com `assigned_to` diferente do anterior):** R12 lê o `assigned_to` anterior no mesmo `run` (`select assigned_to from public.routine_events where id = ${id}::uuid and organization_id = ${org}::uuid for update`, antes do update) e, se mudou, passa `responsavelAnterior`. Antes do push na conexão nova, o serviço busca `calendar_event_mappings` do evento em conexões que não são a do novo responsável (`where routine_event_id = ${id}::uuid and organization_id = ${org}::uuid and connection_id <> ${connNova}::uuid and deleted_at is null`; sem conexão nova, todas). Para cada uma: se a conexão está `connected`, `DELETE` do evento no Google dela (404/410 = sucesso) e `deleted_at = now()` no mapeamento; se não está `connected` ou o DELETE falha, marca o mapeamento como apagado mesmo assim e registra no log (o evento pode ficar na agenda antiga; aceito e registrado em §6.1). Depois, push normal na conexão nova, que cria mapeamento novo (o índice único é por `(connection_id, routine_event_id)`, então não há colisão).
- **Leitura de eventos no `syncConnection` (correção do defeito 3):**
  ```sql
  select to_jsonb(e) from public.routine_events e
  left join public.calendar_event_mappings m on m.routine_event_id = e.id and m.connection_id = ${conn}::uuid
  where e.organization_id = ${org}::uuid and e.assigned_to = ${uid}::uuid
    and (e.deleted_at is null and e.status <> 'cancelled' or (m.id is not null and m.deleted_at is null))
    and (m.id is null or e.sync_version > m.sync_version or e.deleted_at is not null or e.status = 'cancelled')
  order by e.updated_at asc limit ${LIMITE_LISTA}::int
  ```
  Com `target`: `and e.id = ${target}::uuid` e sem a última condição quando `force`.
- **Isolamento por evento (defeito 4):** cada `pushEvent` em `try/catch`; erro grava `routine_events.sync_status='error'` daquele evento e conta em `errors`; não aborta a conexão. Eventos mapeados para um calendário que não é o destino ou é `import_only` não recebem PUT: o push usa o `external_calendar_id` do mapeamento quando ele é `export_only`/`bidirectional`, e pula (`skipped`) quando é `import_only`. O upsert do mapeamento nunca troca `external_calendar_id`.
- Resposta: `{synced:true, imported, cancelled, pushed, conflicts, errors}` (campo `errors` novo, número).
- Falha geral → grava `last_error_code = safeErrorCode(e)` e 500 `sync_pendente`.
- `pullCalendar`, `ensureWatch`, `pushEvent`, `acceptGoogleVersion`, `accessTokenForConnection`, `googleRequest`, `safeErrorCode`: porte linha a linha, mesmas URLs, cabeçalhos (`If-Match`), códigos (`refresh_token_missing`, `refresh_token_revoked`, `refresh_failed`, `sync_token_invalid`, `google_upsert_failed_404`) e colunas gravadas. Todo SQL no `rotina-google.repo.ts`, com casts. As escritas em `routine_events` feitas pelo sync (caminho do servidor) mantêm `source='google'`/`sync_status` como no Deno. Observação: o gatilho de log grava `actor = auth.uid()` = null no caminho do servidor, igual ao service_role hoje.

### 2.4 `google-calendar-webhook` (P2)

Igual ao Deno, com duas trocas: o `fetch` interno vira `await this.webhookCalendario(channel.external_calendar_id)`; e a comparação do hash usa `compararSegredo`.

`webhookCalendario(externalCalendarId)` porta o ramo `action:'webhook'` do Deno e **não usa `syncConnection`**: carrega o calendário e a conexão dona (`from public.external_calendars ec join public.calendar_connections c on c.id = ec.connection_id where ec.id = ${id}::uuid and c.status = 'connected'`); sem linha → erro interno `google_nao_conectado` (o webhook apaga o recibo e responde 500, como acontecia com o 409 do sync no Deno). Com linha: obtém o access token da conexão e chama `pullCalendar(conn, calendario, token)` direto. Não faz push e não filtra por `selected`/`sync_direction` (o Deno também não filtrava nesse ramo). Falha no pull grava `last_error_code` na conexão. Se o sync falhar, apaga o recibo e responde 500. Recibo duplicado (23505 no insert, capturado **fora** de transação: o caminho do servidor usa `$executeRaw` sem `$transaction`) → `{received:true, duplicate:true}`.

### 2.5 `routine-command` → `POST /api/rotina/comando`

- Rota em `RotinaController` (autenticada). Membership (§0.3); falta de `GEMINI_API_KEY` → 503 `ia_nao_configurada` (checado antes de qualquer SQL).
- Leitura de clientes e imóveis **no TenantDb** (o RLS do corretor já restringe ao `legacy_corretor_id`, que é o mesmo dono): `select id, nome from public.clientes order by nome limit ${120}::int` e `select id, titulo, bairro, cidade, endereco from public.imoveis where ativo = true order by titulo limit ${120}::int`. (Mudança mínima: o Deno filtrava por `legacy_corretor_id` com admin; o resultado é o mesmo para o proprietário. Para membro não proprietário o RLS pode devolver menos: registrado em §6.5.)
- Prompt, chamada (`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, `Authorization: Bearer ${GEMINI_API_KEY}`, modelo, `temperature 0.1`, `response_format {type:'json_object'}`, `AbortSignal.timeout(30000)`, 1 retentativa em 408/429/5xx) e validação (inventário §2.5 passo 7–8): porte literal, inclusive a lista das 26 categorias copiada do Deno.
- Resposta 200: `{ proposal: {...} }` com exatamente as chaves do inventário §2.5 passo 9. Qualquer falha → 500 `comando_falhou`.

### 2.6 Job `maintain` (`rotina-maintain.job.ts`)

- Só registra se `ROUTINE_CALENDAR_MAINTAIN_ENABLED === 'true'` **e** o Google está configurado. Fila BullMQ `rotina-google`, job repetível `maintain` a cada 30 min (`repeat: { every: 1800000 }`, `jobId` fixo), conexão `RedisService.connection`.
- Processa: para cada `calendar_connections where status='connected'`, `syncConnection` isolado (mesmo resultado `{maintained, results}` em log). Ao final: `delete from public.calendar_webhook_receipts where received_at < now() - interval '7 days'` (sem migration; defeito 14).
- `onModuleDestroy` fecha fila e worker.

---

## 3. Testes obrigatórios (frente R)

### 3.1 Jest de texto (`*.spec.ts`, `.text` e `.values` do `Prisma.sql` passado ao tx falso)

- Cada rota R1–R15: o SQL contém os casts (`::uuid`, `::timestamptz`, `::int`, `::text`, `::jsonb`), `limit $n::int` com `LIMITE_LISTA` em `.values`, `to_jsonb(`, e o filtro `organization_id = $n::uuid` com o org da membership (nunca do corpo).
- R12/R13: patch vazio → 400 `nada_para_atualizar`; chave fora da lista de colunas não aparece no SQL; `expected_updated_at` presente → 409 `CONCURRENCY_CONFLICT` quando não volta linha; ausente → 404.
- R10: conflito → 409 `CONFLICT` com `conflicts` e nenhum insert chamado; insert do lembrete lançando 42501 → `rollback to savepoint lembrete` executado, `lembrete_criado:false` e evento devolvido; outro SQLSTATE no lembrete → sobe; push chamado só depois do run.
- R12 com troca de responsável: push recebe `responsavelAnterior`; o serviço faz DELETE no Google da conexão antiga e marca o mapeamento; sem conexão antiga `connected`, só marca.
- Callback com erro: conexão `connected` mantém `status` e só limpa state/verifier/expiração; conexão `pending` vira `error`; a URL de retorno tem só `google_calendar=error`.
- Webhook chama `pullCalendar` direto e nenhum push.
- Matriz §0.5: G1 e G3 sem chaves não respondem 503; G2 e G7 respondem.
- Tradutor: 22023 com origem `conflitos` → `intervalo_invalido`; com origem `conclusao` → `tipo_invalido`.
- Controller: paridade de uuid (`11111111-1111-1111-1111-111111111111` aceito na URL e no corpo; `abc` → 400 `id_invalido`/mensagem do DTO).
- Tradutor: cada linha da tabela §0.4.
- `cripto.spec.ts`: vetor WebCrypto ↔ Node; chave hex e base64url; tag adulterada → `token_decrypt_failed`; `compararSegredo`.
- `mapeamento.spec.ts`: casos de `googleTimes` (dia inteiro em America/Sao_Paulo), `activityFromGoogle`, `googleEventIdForRoutine`, `hasBidirectionalConflict`, `buildGoogleEventPayload` nos três modos.
- `rotina-google.service.spec.ts` (fetch falso): start sobre conexão `connected` não troca status; callback preserva `is_default`; refresh `invalid_grant` grava `refresh_token_revoked`; push 412 → `conflict`; push 404 sem mapeamento → POST com id determinístico; erro num evento não aborta os outros; webhook com token errado → 401, duplicado → `duplicate:true`, falha no sync apaga recibo e 500; falta de variável → 503.
- `rotina-comando.service.spec.ts`: sem chave → 503 sem SQL; resposta do modelo com tipo desconhecido → `outro`; fim ≤ início → 500 `comando_falhou`; casamento de cliente por nome normalizado.

### 3.2 SQL real (`api/test/sql-real/rotina.test.ts`, harness sem edição)

Usa `criarBanco()`, `banco.db`, `banco.prisma`, `contaA`/`contaB` (o gatilho de `corretores` já cria org e membership de proprietário). Obrigatórios:

1. R1 devolve organization e membership da conta A; formato (`UUID`, `TIMESTAMPTZ`).
2. Isolamento: eventos/tarefas/inbox de A não aparecem para B; PATCH/concluir/remover de B em item de A → 404.
3. R10 cria evento com `sync_status='pending'`, `timezone` da org e `created_by` = A; segundo evento sobreposto → 409 `CONFLICT`; `transacoes.commitsAbortados` continua 0.
4. R10 com `reminder_minutes` grava `routine_reminders` com `remind_at = start - n min`.
5. R12 com `expected_updated_at` igual ao devolvido por R10 grava; repetido com o antigo → 409 `CONCURRENCY_CONFLICT`; `sync_version` subiu (gatilho).
6. R3 traz evento recorrente que começou antes do período e não traz apagado.
7. R14 de evento com `client_id` de A → `registrado_no_crm: true` e linha em `historico_contatos`; sem cliente → `false`.
8. Cliente de B em evento de A → 422 `cliente_fora_da_organizacao`.
9. R9 com fim ≤ início → 400 `intervalo_invalido`.
10. Inbox: criar, listar, arquivar, some da lista.
11. Caminho do servidor: `rotina-google.repo` grava e lê `calendar_connections` com `banco.prisma` (superusuário), e o mesmo SELECT dentro de `banco.db.run` falha com 42501 (prova que o TenantDb não alcança `calendar_*`).
12. Start sobre conexão `connected` (inserida pelo repo) mantém `connected`.

Os testes de Google no SQL real usam `fetch` falso; nenhum acessa rede.

---

## 4. Frente F: front

### 4.0 Regra geral

Toda troca fica atrás de `apiDisponivel()` (de `src/lib/api.ts`). Sem `VITE_API_URL`, **nenhuma linha de comportamento muda**: o ramo Supabase atual fica intacto, inclusive mensagens, chaves do React Query, invalidações e `console.warn`. O import de `src/lib/api/rotina.ts` pode ser estático (não há ciclo como no CrmPipeline).

### 4.1 `src/lib/api/rotina.ts`

Usa `chamarApi` (de `src/lib/api.ts`) e `lerJson`/`ErroApi` (de `src/lib/api/http.ts`). Funções (todas `async`, nomes fixos):

| Função | Rota | Retorno |
|---|---|---|
| `contextoRotinaApi()` | R1 | `{organization, membership} \| null` |
| `listarMembrosApi()` | R2 | `RoutineMembership[]` |
| `listarEventosApi({inicio, fim, responsavel?})` | R3 | `RoutineEvent[]` |
| `listarTarefasApi({responsavel?})` | R4 | `RoutineTask[]` |
| `listarAtividadeApi()` | R5 | linhas |
| `listarInboxApi()` / `criarInboxApi({content, kind?})` / `arquivarInboxApi(id)` | R6–R8 | |
| `detectarConflitosApi({assigned_to, start_at, end_at, exclude_event_id?})` | R9 | `Conflito[]` |
| `criarEventoApi(dto)` | R10 | `RoutineEvent` (descarta `lembrete_criado` após `console.warn` se false) |
| `criarTarefaApi(dto)` | R11 | `RoutineTask` |
| `editarEventoApi(id, patch, expectedUpdatedAt?)` / `editarTarefaApi(...)` | R12/R13 | linha |
| `concluirItemApi(tipo, id)` | R14 | linha |
| `removerItemApi(tipo, id)` | R15 | `void` |
| `statusGoogleApi()`, `conectarGoogleApi()`, `desconectarGoogleApi()`, `configurarPrivacidadeApi(modo)`, `listarCalendariosApi()`, `configurarCalendarioApi(id, patch)`, `sincronizarGoogleApi(action?, eventId?)` | G1–G7 | |
| `interpretarComandoApi(command, timezone)` | `POST /rotina/comando` | `{proposal}` |

Erros: `CONFLICT` → `Object.assign(new Error('CONFLICT'), { conflicts })`; `CONCURRENCY_CONFLICT` → `new Error('CONCURRENCY_CONFLICT')` (as mesmas strings que `useRoutine.ts` já compara). Demais → `lerErroApi`.

### 4.2 Onde cada tela troca (`useRoutine.ts`)

| Item do inventário | Com API |
|---|---|
| 1 `useRoutineContext` | `contextoRotinaApi()` |
| 2, 3, 4, 5, 6 | funções de listagem; em 3 continua chamando `expandRecurringEvents` no front com o resultado |
| 7, 8 | inbox |
| 11–13 (`create` evento) | só `criarEventoApi` (conflito, insert, lembrete e push ficam no servidor); não chama `pushEventToGoogle` |
| 14 | `criarTarefaApi` |
| 15, 16 | `editar*Api`; sem push no front |
| 17 + 9 | `concluirItemApi`; sem RPC nem push no front |
| 18 | `removerItemApi` |
| 19 | `sincronizarGoogleApi('resolve_conflict_lotti'\|'resolve_conflict_google', id)` |
| 20 | `detectarConflitosApi` |
| 21–27 | funções do Google; 23 continua com `window.location.assign` |

Mensagens de toast, invalidações e `retry:false` iguais às atuais.

### 4.3 `useGoogleCalendarReturn.ts`

Com API, o `{action:'sync'}` vira `sincronizarGoogleApi('sync')`, mesmo `catch`, toasts e limpeza da URL.

### 4.4 `RoutineCommandBar.tsx`

Com API, `supabase.functions.invoke('routine-command')` vira `interpretarComandoApi(trim, timezone)`. Qualquer erro (inclusive 503) cai no `interpretRoutineCommandLocally`, como hoje.

### 4.5 Testes do front (`src/lib/api/rotina.test.ts`, Vitest)

- cada função chama o caminho e método fixos com o corpo esperado (mock de `chamarApi`);
- 409 `CONFLICT` vira `Error('CONFLICT')` com `.conflicts`; 409 `CONCURRENCY_CONFLICT` vira `Error('CONCURRENCY_CONFLICT')`;
- `listarEventosApi` monta a query com `inicio`, `fim` e `responsavel` só quando houver;
- com `apiDisponivel()` falso, `useRoutine` não chama nenhuma função de `rotina.ts` (um teste com mock).

---

## 5. Integração (orquestrador, depois das frentes)

1. Adicionar `RotinaModule` em `api/src/app.module.ts`.
2. Rodar `npm test` em `api/` (Jest + `node --test` do SQL real) e os testes do front.
3. Fumaça local: criar, arrastar, concluir e remover evento com `VITE_API_URL` apontando para a API local.
4. Virada de produção (manual, fora deste contrato): variáveis no Railway; Caddy `/google-agenda/callback` → API; `GOOGLE_CALENDAR_WEBHOOK_URL` para `/api/google-agenda/webhook`; **desligar o cron `routine-google-calendar-maintain` do pg_cron antes** de ligar `ROUTINE_CALENDAR_MAINTAIN_ENABLED`; os canais de watch antigos expiram sozinhos (até 6 dias) e continuam apontando para a Edge Function até lá, então ela fica no ar durante a transição.

---

## 6. Decisões que mudam comportamento (só com `VITE_API_URL`)

1. **Push pela conexão do responsável** (defeito 2): edição por gestor sobe para a agenda do responsável na hora. Na troca de responsável o evento é apagado da agenda Google do responsável anterior (melhor esforço) e o mapeamento antigo marcado como apagado (§2.3); hoje ele fica órfão lá.
2. **Conectar de novo não derruba conexão ativa** (defeito 6): o start mantém `connected`, e o callback com erro sobre conexão `connected` só limpa state, verifier e expiração, sem `status='error'` (inclui a desistência com `access_denied`).
3. **Reconectar preserva `selected`/`is_default`** (defeito 7).
4. `activity_type` continua sem lista fechada na API (como o banco); só limite de tamanho.
5. `routine-command` lê clientes/imóveis pelo RLS do usuário em vez do admin; para o proprietário o resultado é igual.
6. **Lembrete:** a criação do evento informa `lembrete_criado`; quando a policy não permite, o lembrete não é criado (como hoje), mas sem erro escondido; o front registra `console.warn`.
7. **Sync**: ignora apagados já removidos, ordena por `updated_at`, isola erro por evento e não faz PUT em calendário `import_only` ou de outro calendário (defeitos 3 e 4). Resposta ganha `errors`.
8. Push, RPC de CRM e lembrete saem do front e vão para o servidor, depois do commit.
9. Webhook compara token em tempo constante e faz só o pull do calendário avisado; recibos com mais de 7 dias são apagados pelo job.
10. `configureCalendar` com `is_default` vira uma transação.
11. G1, G3 e G4–G6 não dependem das chaves do Google (matriz §0.5); G3 sem chave apaga a conexão sem revogar.
12. O 22023 da RPC de conclusão vira `tipo_invalido` em vez de `intervalo_invalido` (só aparece no log).

Ficam **iguais** de propósito: arrastar ocorrência move a série (defeito 10), concluir/remover ocorrência afeta a série (11), RPC de conflito sem recorrência, eventos órfãos ao desconectar (8), `useRoutineActivity` e `GoogleCalendarPanel` sem tela (9), onboarding (item 30) continua no Supabase.

---

## 7. Fora do escopo e pendências

### 7.1 Fora do escopo

- `useOnboarding.ts` (`routine_organizations` update): módulo de onboarding.
- `api/src/visitas/visitas.repo.ts` sem push (defeito 18): a integração pode depois chamar `pushEventoEmSegundoPlano`; nenhuma frente edita visitas agora.
- Envio de lembretes (nenhum worker existe; defeito 1).
- `routine_preferences`, `routine_task_checklists`, `routine_entity_links`, `routine_automations*`.
- Desligar as Edge Functions e o cron no Supabase.

### 7.2 Pendências (inclui migrations propostas, NÃO aplicadas)

1. Um calendário padrão por conexão:
   ```sql
   create unique index if not exists uq_external_calendars_default
     on public.external_calendars (connection_id) where is_default;
   ```
2. Índice para a limpeza de recibos:
   ```sql
   create index if not exists idx_calendar_webhook_receipts_received_at
     on public.calendar_webhook_receipts (received_at);
   ```
3. Trazer o cron para o repositório ou removê-lo (hoje manual):
   ```sql
   select cron.unschedule('routine-google-calendar-maintain');
   ```
   (aplicar só na virada, junto com `ROUTINE_CALENDAR_MAINTAIN_ENABLED=true`).
4. `sync_status='pending'` também para eventos `source='google'` editados no Lotti (defeito 5): alterar `routine_touch_and_version` para usar `coalesce(current_setting('request.jwt.claims', true)::jsonb->>'sub', '') <> ''` (edição de usuário) em vez de `source <> 'google'`. SQL exato a escrever com a função atual em mãos.
5. CHECK de `activity_type` (defeito 16), opcional: `alter table public.routine_events add constraint routine_events_activity_type_len check (char_length(activity_type) between 1 and 60) not valid;` e o mesmo em `routine_tasks`.
6. Policy de inbox (defeito 17): `using (user_id = auth.uid() and private.routine_user_is_member(organization_id))`.
7. `retry_count`/`next_retry_at` de `calendar_sync_states` seguem sem uso.
8. Ocorrência recorrente (defeitos 10 e 11): exige exceções de série (`routine_event_exceptions`) — projeto à parte.
9. Corrigir `GOOGLE_CALENDAR_APP_REDIRECT_URL` em produção para `/rotina` (defeito 12).
10. `RotinaModule` precisa de `RedisModule` só se o job estiver ligado; se o import incondicional atrapalhar os testes de `app.module`, a integração decide registrar o job por provider condicional.
