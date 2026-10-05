# Contrato da API Lotti: módulo assinatura e onboarding (fase 4, onda 3)

Última onda da saída do Supabase. Duas frentes trabalham em paralelo e cada uma só toca os próprios
arquivos. Tudo o que elas precisam combinar está fixado aqui: caminhos, DTOs, respostas, códigos de
erro, o SQL de cada rota, o porte das funções do banco e os testes.

**Molde obrigatório:** `docs/superpowers/specs/2026-10-04-api-lotti-modulo2-contrato.md`
(§0.2 acesso ao banco, §0.3 formato de erro, §0.4 tradutor, §0.5 testes, §4 adaptadores do front atrás
de `apiDisponivel`). Tudo o que não estiver repetido aqui vale como está lá, sem exceção.
Os contratos da onda 2 (`...-contratos-`, `...-financeiro-`, `...-rotina-contrato.md`) são a referência
de porte de função do banco e de variável opcional com 503.

Três coisas decidem o desenho deste módulo:

1. **As cotas de verdade continuam no banco.** `checar_cota`, `conta_antiga_sem_limite` e os gatilhos de
   `imoveis`, `fachadas` e `contratos` (migration `20260925120000_billing_plan_enforcement.sql`) seguem
   intactos. Nenhuma rota desta onda afrouxa, recalcula ou contorna um limite: a API **lê** cota e
   **repassa** o `PLAN_LIMIT_REACHED` do gatilho como 402, igual ao molde §0.4.
2. **O catálogo de planos é público; o resto exige login.** `plans`, `plan_entitlements` e
   `pricing_campaigns` têm policy `FOR SELECT TO PUBLIC` e grant de `SELECT` para `anon`
   (`api/prisma/migrations/0_init/migration.sql:11670-11677`). As rotas de catálogo ficam num controller
   sem guard; todas as outras têm `SupabaseAuthGuard`.
3. **`onboarding_executar_acao` é portada como está.** Ela é atômica (um `SELECT` dentro da transação do
   `TenantDb`), idempotente (`progress.metadata->'action_ids'`) e tem vários efeitos colaterais. A API
   **chama** a função; não reescreve nada da lógica dela.

---

## 0. Regras comuns às duas frentes

### 0.1 Quem é dono de quê

| Frente | Arquivos (só estes) |
|---|---|
| **S** api-assinatura | cria em `api/src/assinatura/`: `assinatura.module.ts` (classe `AssinaturaModule`), `assinatura.dto.ts`, `assinatura.erros.ts`, `assinatura.service.ts`, `assinatura.controller.ts`, `catalogo.repo.ts`, `catalogo.service.ts`, `catalogo.controller.ts`, `onboarding/onboarding.dto.ts`, `onboarding/onboarding.service.ts`, `onboarding/onboarding.controller.ts` e os specs `assinatura.service.spec.ts`, `assinatura.controller.spec.ts`, `catalogo.service.spec.ts`, `onboarding/onboarding.service.spec.ts`, `onboarding/onboarding.controller.spec.ts`. Cria `api/test/sql-real/assinatura.test.ts`. |
| **T** front | cria `src/lib/api/assinatura.ts` e `src/lib/api/assinatura.test.ts`. Edita `src/hooks/useSubscription.ts`, `src/pages/PlanoAssinatura.tsx`, `src/hooks/useOnboarding.ts` e `src/pages/Onboarding.tsx`. |

Nenhuma frente edita: `api/src/app.module.ts` (quem liga o módulo é a integração, §8), `api/src/main.ts`,
`api/src/prisma/*`, `api/prisma/*`, `api/src/auth/*`, `api/test/sql-real/harness.ts`, `src/lib/api/http.ts`,
`src/lib/api.ts`, nem qualquer arquivo de outro módulo. `OnboardingChecklist.tsx`, `OnboardingTour.tsx`,
`OnboardingGate.tsx`, `LimitGuard.tsx`, `CriarFachadaDialog.tsx`, `NovoImovelDialog.tsx`,
`NewContractDialog.tsx` e `AutoContractDialog.tsx` **não são editados**: eles só consomem
`useOnboarding()` e `useCheckLimit()`, e a troca acontece dentro dos hooks.

Também valem: nenhuma migration aplicada (as propostas ficam em §7.2 com o SQL); nada de `prisma migrate`,
`db push`, `db pull` ou `migrate reset`; nada de commit, stash ou troca de branch; nada contra Supabase,
Railway ou rede nos testes; nenhum valor de segredo lido ou registrado (só nomes de variável).

**Sem `VITE_API_URL` nada muda no front** — byte a byte, inclusive chaves do React Query, `enabled`,
`staleTime`, `retry`, mensagens de toast e invalidações.

### 0.2 Acesso ao banco

Dois caminhos, e só dois:

1. **`TenantDb` (tudo o que exige login).** `this.db.run(claims, (tx) => ...)`, SQL por
   ``tx.$queryRaw(Prisma.sql`...`)``. RLS, `get_corretor_id()` e os gatilhos valem como no PostgREST.
   Nunca `this.prisma.<modelo>`, `tx.<modelo>`, `$queryRawUnsafe` nem `$executeRawUnsafe`.
2. **`CatalogoRepo` (catálogo público).** O `TenantDb` recusa claims que não sejam `authenticated`
   (`api/src/prisma/tenant-db.ts:25`), então as três rotas públicas usam um repo próprio sobre o
   `PrismaService`:

   ```ts
   @Injectable()
   export class CatalogoRepo {
     constructor(private readonly prisma: PrismaService) {}
     /** Mesma visibilidade do PostgREST anônimo: papel `anon` dentro da transação, RLS ligado. */
     async comoAnon<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
       return this.prisma.$transaction(async (tx) => {
         await tx.$executeRawUnsafe('set local role anon');
         return work(tx);
       });
     }
   }
   ```
   `'set local role anon'` é uma constante, sem interpolação; é a única chamada `Unsafe` do módulo e é a
   mesma forma que o `TenantDb` usa. As policies `plans_read_all`, `entitlements_read_all` e
   `campaigns_read_active` continuam sendo quem decide o que sai.

**Casts obrigatórios** (molde §0.2), sem exceção: `${id}::uuid`, `${n}::int`, `${b}::boolean`,
`${t}::text` (inclusive quando é null), `${json}::jsonb`, `${d}::date`.
`LIMITE_LISTA = 1000` entra sempre como `limit ${LIMITE_LISTA}::int`. Contagens usam `count(*)::int`.
Toda ordenação desempata por `id`. Nomes de coluna entram por `Prisma.raw`, só a partir de constantes.

**Formato de resposta.** Toda linha de tabela sai por `to_jsonb(x) as linha` e vai ao front sem
transformação, no formato do PostgREST (molde §0.2). As funções que devolvem `jsonb`
(`get_onboarding_contexto`, `salvar_onboarding`, `onboarding_executar_acao`,
`criar_convite_organizacao`, `aceitar_convite_organizacao`) saem por
`select public.<f>(...) as linha` — o Prisma já entrega `jsonb` como objeto.

**Função `void` vai por `$executeRaw`.** `registrar_onboarding_evento` e `salvar_onboarding_tour`
retornam `void`: por `$queryRaw` o Prisma falha ao desserializar a coluna (P2010 com `meta.code 'N/A'`,
ver o cabeçalho de `api/test/sql-real/harness.ts`). As duas usam
``tx.$executeRaw(Prisma.sql`select public.<f>(...)`)``, que tem os mesmos `.text` e `.values` para os testes.

**`checar_cota` devolve TABLE:**
`select to_jsonb(c) as linha from public.checar_cota(${corretor}::uuid, ${chave}::text) c`.

**`corretor_id` nunca vem do cliente.** Quem precisa dele resolve no mesmo `run` com
`select public.get_corretor_id()::text as id`. Null → `403 { codigo: 'corretor_nao_identificado' }`.
O mesmo vale para `profile_id`, `organization_id` e `user_id`: vêm de `auth.uid()` dentro das funções do
banco ou de `claims.sub`, nunca do corpo. A única exceção é O8, onde o `:id` da organização vai na URL —
e a policy `routine organizations: managers update` é quem autoriza.

**Erro dentro do `run` aborta a transação (25P02).** Nunca capture erro do banco para seguir dentro do
`run`. Traduza fora: `try { return await this.db.run(...) } catch (e) { traduzirErroAssinatura(e, op) }`.
`HttpException` lançada dentro do `run` passa intacta.

**Logs:** só SQLSTATE e código. Nunca nome, telefone, e-mail, CPF, token de convite, `meta.message`,
nem valor de variável de ambiente.

**Estrutura do Nest:** `@UseGuards(SupabaseAuthGuard)` nos controllers autenticados e
`@Claims() claims: SupabaseClaims` em cada rota; `providers: [AssinaturaService, CatalogoService,
CatalogoRepo, OnboardingService, SupabaseAuthGuard]`; `TenantDb` e `PrismaService` vêm do `PrismaModule`
global. Ids de rota por `new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido',
'Identificador inválido.') })`. Rotas estáticas antes das rotas com `:id`. POST que não cria registro
usa `@HttpCode(200)`; rota sem corpo de resposta usa `@HttpCode(204)`.

### 0.3 Formato de erro HTTP

Igual ao molde §0.3: `{ statusCode, codigo, message, ...extras }` por `new HttpException(corpo, status)`,
`message` sempre em português. `extras` pode trazer `recurso` (402 de cota) e `sqlstate`.
O 400 de validação é o do `ValidationPipe`: `{ statusCode: 400, message: string[], error }`.
Todo decorator de validação leva `{ message: '<português>' }` (IsString, IsNotEmpty, MaxLength, IsIn,
IsInt, Min, Max, IsBoolean, IsObject, IsEmail, IsArray, ArrayMaxSize, Matches);
`IsOptional`, `ValidateIf` e `Type` não levam mensagem.

### 0.4 `assinatura.erros.ts`

`ErroPg`, `erroPg`, `erroApi` e `DADOS_INVALIDOS` vão **idênticos** ao molde §0.4 (juntar os tradutores
num arquivo só continua pendência, §7.2.6). O tradutor deste módulo é `traduzirErroAssinatura` e
acrescenta as mensagens P0001 das funções de onboarding e de convite, que hoje chegam ao usuário em
português cru pelo supabase-js:

```ts
export interface OpcoesErro { padrao?: string }

/** [mensagem exata do RAISE, HTTP, codigo, texto para o usuário] */
const P0001: Array<[string, number, string, string]> = [
  ['perfil de onboarding não encontrado', 404, 'perfil_nao_encontrado', 'Seu onboarding ainda não foi criado. Recarregue a página.'],
  ['onboarding não encontrado',           404, 'onboarding_nao_encontrado', 'Seu onboarding ainda não foi criado. Recarregue a página.'],
  ['organização indisponível',            403, 'corretor_nao_identificado', 'Não foi possível identificar a sua conta. Entre novamente.'],
  ['título, cidade e valor são obrigatórios', 422, 'dados_incompletos', 'Informe título, cidade e valor do imóvel.'],
  ['nome e telefone ou e-mail são obrigatórios', 422, 'dados_incompletos', 'Informe o nome e um telefone ou e-mail.'],
  ['cliente inválido',                    422, 'cliente_invalido', 'Este cliente não existe mais. Recarregue a página.'],
  ['imóvel inválido',                     422, 'imovel_invalido', 'Este imóvel não existe mais. Recarregue a página.'],
  ['pipeline não configurado',            422, 'pipeline_nao_configurado', 'Seu funil ainda não tem etapas. Recarregue a página e tente de novo.'],
  ['responsável inválido',                422, 'responsavel_invalido', 'Escolha um responsável da sua equipe.'],
  ['ação de onboarding inválida',         400, 'acao_invalida', 'Esta ação de onboarding não existe.'],
  ['evento de onboarding inválido',       400, 'evento_invalido', 'Este evento de onboarding não existe.'],
  ['somente gestores podem convidar',     403, 'sem_permissao_convite', 'Somente gestores da organização podem convidar.'],
  ['e-mail inválido',                     422, 'email_invalido', 'Informe um e-mail válido.'],
  ['papel inválido',                      422, 'papel_invalido', 'Escolha uma função válida para o convite.'],
  ['convite inválido ou expirado',        404, 'convite_invalido', 'Este convite não é válido ou já expirou.'],
  ['este convite pertence a outro e-mail',403, 'convite_de_outro_email', 'Este convite foi enviado para outro e-mail.'],
];
```

`traduzirErroAssinatura(e, op)` na ordem:

| Postgres | HTTP | codigo | message |
|---|---|---|---|
| P0001 presente em `P0001` | ver tabela | ver tabela | ver tabela |
| P0001 `PLAN_LIMIT_REACHED:<recurso>` | 402 | `PLAN_LIMIT_REACHED` | `max_imoveis` → 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.'; senão 'Limite do plano atingido. Acesse Plano e Assinatura.' (+ `recurso`) |
| P0001 `forbidden` | 403 | `forbidden` | 'Não foi possível identificar a sua conta. Entre novamente.' |
| outro P0001 | 422 | `regra_do_banco` | `op.padrao ?? 'Não foi possível concluir esta ação.'` (o texto do Postgres **não** é repassado) |
| 42501 | 403 | `sem_permissao` | 'Você não tem permissão para fazer esta alteração.' |
| 42883, 42P01, 42703 (função/tabela ausente) | 503 | `onboarding_indisponivel` | 'Onboarding temporariamente indisponível.' |
| 23503 / 23001 | 422 | `referencia_invalida` | 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.' |
| 23505 | 409 | `registro_repetido` | 'Já existe um registro igual.' |
| 22P02, 22007, 22008, 22003, 22001, 23502, 23514 | 400 | `dados_invalidos` | 'Dados inválidos. Confira os campos e tente de novo.' |
| qualquer outro | — | — | sobe como veio (500 padrão do Nest) |

O 503 existe porque `useOnboarding` hoje trata `42P01`/`42883`/`PGRST202`/`PGRST205` como "recurso ainda
não aplicado" e devolve `null` sem travar o produto (`src/hooks/useOnboarding.ts:18-35`). A rota devolve
503 e o front mantém o mesmo silêncio (§4.3).

### 0.5 Variáveis do módulo (opcionais, lidas de `process.env` pelo próprio módulo)

Nenhuma chave de serviço externo é necessária para as rotas deste contrato: troca de plano,
cancelamento e checkout continuam no `paymentProvider` do front e no webhook do Asaas (módulo
financeiro, já migrado). Fica uma variável só, lida a cada uso por `lerConfigAssinatura(env = process.env)`
em `assinatura.dto.ts`:

| Variável | Uso | Faltando |
|---|---|---|
| `BILLING_USAGE_TIMEZONE` (nova, opcional) | fuso do período de cota; padrão `America/Sao_Paulo`, o mesmo de `checar_cota` e de `src/lib/billingPeriod.ts` | usa o padrão |

Se um dia existir rota de alteração de assinatura, a chave do provedor entra como variável opcional e a
rota responde `503 { codigo: 'checkout_nao_configurado', message: 'Alterações de assinatura
temporariamente indisponíveis.' }` — o mesmo texto que `PlanoAssinatura.tsx` já mostra quando
`billingIntegrationReady` é falso. Isso é pendência (§7.2.5), não rota desta onda.

---

## 1. Frente S: rotas de catálogo (públicas, sem guard)

`CatalogoController`, `@Controller('planos')`, **sem** `SupabaseAuthGuard`. Todas usam
`CatalogoRepo.comoAnon`. Ordem de declaração: `GET ''`, `GET 'entitlements'`, `GET 'campanha'`.

| # | Método e caminho | Resposta | Substitui |
|---|---|---|---|
| C1 | `GET /api/planos` | `Linha[]` (colunas de `public.plans`) | `useSubscription.ts:29-33` |
| C2 | `GET /api/planos/entitlements` | `Linha[]` (colunas de `public.plan_entitlements`) | `useSubscription.ts:37-40` |
| C3 | `GET /api/planos/campanha` | `Linha \| null` | `useSubscription.ts:158-163` |

SQL:

```sql
-- C1
select to_jsonb(p) as linha from public.plans p
 where p.active is true order by p.display_order, p.id limit $1::int

-- C2  (sem filtro: o front junta por plan_id, e entitlements_read_all libera todos)
select to_jsonb(e) as linha from public.plan_entitlements e
 order by e.display_order, e.id limit $1::int

-- C3  ($1 = 2: lê duas linhas de propósito, ver abaixo)
select to_jsonb(c) as linha from public.pricing_campaigns c
 where c.active is true order by c.created_at desc, c.id limit $1::int
```

- C1 repete `active is true` embora a policy devolva tudo: o filtro é o que o front faz hoje
  (`.eq('active', true)`), e `plans_read_all` não filtra `active`.
- C3: zero linhas → `null`; uma → a linha; **duas ou mais → `409 { codigo: 'campanha_ambigua',
  message: 'Há mais de uma campanha ativa. Avise o suporte.' }`**, porque hoje o `.maybeSingle()` do
  PostgREST também devolve erro nesse caso (PGRST116) e o `useActiveCampaign` fica com `data: undefined`;
  o resumo segue com `campaign || null` (§6.4). O índice único que impede o caso é pendência (§7.2.1).
- As três rotas não exigem login e não expõem nada novo: as colunas são as mesmas que o `anon` já lê
  pelo PostgREST hoje.

---

## 2. Frente S: rotas de assinatura (autenticadas)

`AssinaturaController`, `@Controller('assinatura')` + `SupabaseAuthGuard`. Ordem de declaração:
`GET ''`, `GET 'uso'`, `GET 'addons'`, `GET 'conta-antiga'`, `GET 'cota/:chave'`.

| # | Método e caminho | Resposta | Substitui |
|---|---|---|---|
| A1 | `GET /api/assinatura` | `Linha \| null` — linha de `subscriptions` com `plan` embutido | `useSubscription.ts:64-71` |
| A2 | `GET /api/assinatura/uso` | `{ period_start, period_end, contadores: Linha[], ativos: { max_imoveis: number; max_contratos_locacao: number; max_fachadas: number } }` | `useSubscription.ts:88-97` (as quatro consultas) |
| A3 | `GET /api/assinatura/addons` | `Linha[]` | `useSubscription.ts:141-145` |
| A4 | `GET /api/assinatura/conta-antiga` | `{ sem_limite: boolean }` | `useSubscription.ts:184-187` |
| A5 | `GET /api/assinatura/cota/:chave` | `{ permitido: boolean; usado: number; limite: number \| null; ilimitado: boolean; habilitado: boolean }` | `checar_cota` (hoje nenhuma tela chama; §6.6) |

**Nenhuma rota de escrita.** `subscriptions`, `subscription_addons`, `usage_counters` e
`pricing_campaigns` só mudam por webhook ou admin: `incrementar_uso` tem `GRANT EXECUTE` apenas para
`service_role` (`0_init/migration.sql:12808-12809`), então nenhuma rota autenticada poderia chamá-la sem
alargar o grant — proibido aqui e registrado em §7.2.3. Troca de plano e cancelamento continuam no
`paymentProvider` do front (`PlanoAssinatura.tsx:127-170`), que não toca nessas tabelas.

SQL:

```sql
-- A1  (sem filtro por corretor: quem decide é subscriptions_org_read, como no PostgREST)
select to_jsonb(s) || jsonb_build_object('plan', to_jsonb(p)) as linha
  from public.subscriptions s
  left join public.plans p on p.id = s.plan_id
 order by s.created_at desc, s.id limit 1

-- A2  período idêntico ao de checar_cota. $1 = fuso (BILLING_USAGE_TIMEZONE)
with periodo as (
  select date_trunc('month', now() at time zone $1::text)::date as inicio
)
select to_char((select inicio from periodo), 'YYYY-MM-DD') as period_start,
       to_char(((select inicio from periodo) + interval '1 month - 1 day')::date, 'YYYY-MM-DD') as period_end,
       coalesce((select jsonb_agg(to_jsonb(u) order by u.feature_key, u.id)
                   from public.usage_counters u
                  where u.period_start = (select inicio from periodo)), '[]'::jsonb) as contadores,
       (select count(*)::int from public.imoveis i where i.ativo is true) as max_imoveis,
       (select count(*)::int from public.contratos c
         where c.tipo in ('LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL') and c.status = 'ATIVO') as max_contratos_locacao,
       (select count(*)::int from public.fachadas f where f.ativo is true) as max_fachadas

-- A3
select to_jsonb(a) as linha from public.subscription_addons a
 where a.status = 'active' order by a.addon_code, a.id limit $1::int

-- A4
select coalesce(public.conta_antiga_sem_limite(public.get_corretor_id()), false) as sem_limite

-- A5
select to_jsonb(c) as linha
  from public.checar_cota(public.get_corretor_id(), $1::text) c
```

Notas de A2:
- as três contagens não filtram `corretor_id`: as policies de `imoveis`, `contratos` e `fachadas` já
  restringem ao corretor, e o número fica igual ao `head count` do PostgREST de hoje;
- `period_start`/`period_end` saem como `'YYYY-MM-DD'` por `to_char`, o mesmo formato de
  `monthlyUsagePeriod` e da coluna `date` no PostgREST;
- `contadores` não leva `limit` porque há no máximo uma linha por `feature_key` do período (unique
  `(corretor_id, feature_key, period_start)`).

Notas de A4/A5:
- as duas funções recebem `public.get_corretor_id()` **dentro do SQL**. O corretor nunca vem da URL nem
  do corpo, e a guarda interna delas (`get_corretor_id() is distinct from _corretor_id` → resposta
  negativa) continua valendo;
- `get_corretor_id()` null: A4 responde `{ sem_limite: false }` (igual ao `return false` da função);
  A5 responde `403 { codigo: 'corretor_nao_identificado' }`, porque `checar_cota` com null devolve zero
  linhas e a tela não pode confundir isso com "limite 0 liberado";
- A5 confere `:chave` contra `CHAVES_COTA` (§2.1). Fora da lista → `400 { codigo: 'recurso_invalido',
  message: 'Recurso de cota desconhecido.' }`, sem chegar ao banco;
- A5 **não** incrementa, reserva nem libera nada: é leitura.

### 2.1 Constantes e DTOs (`assinatura.dto.ts`)

```ts
export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIMITE_LISTA = 1000;
/** Igual ao FeatureKey de src/types/subscription.ts:50-72. */
export const CHAVES_COTA = [
  'leads_qualificados_monthly', 'max_contratos_locacao', 'max_users', 'max_imoveis', 'max_fachadas',
  'ai_contracts_monthly', 'ai_assistant_monthly', 'storage_gb', 'rental_management', 'asaas_integration',
  'ai_contract_analysis', 'contract_export', 'advanced_reports', 'team_management', 'team_analytics',
  'priority_support', 'guided_onboarding', 'automations', 'full_financial', 'fachadas_analytics',
] as const;
```

As rotas A1–A4 e C1–C3 não têm DTO (nenhum parâmetro). A5 recebe a chave pela URL e a confere contra
`CHAVES_COTA` no controller.

---

## 3. Frente S: rotas de onboarding (autenticadas)

`OnboardingController`, `@Controller('onboarding')` + `SupabaseAuthGuard`, todas no `TenantDb`.
Ordem: `GET 'contexto'`, `POST 'salvar'`, `POST 'acoes'`, `POST 'eventos'`, `PUT 'tours'`,
`PATCH 'checklist'`, `PATCH 'perfil'`, `POST 'convites'`, `POST 'convites/aceitar'`,
`PATCH 'organizacoes/:id'`.

| # | Método e caminho | Corpo | Resposta | Substitui |
|---|---|---|---|---|
| O1 | `GET /api/onboarding/contexto` | — | `jsonb \| null` cru de `get_onboarding_contexto()` | `useOnboarding.ts:28` |
| O2 | `POST /api/onboarding/salvar` | `SalvarOnboardingDto` | `jsonb \| null` (o contexto que a função devolve) | `useOnboarding.ts:81-86` |
| O3 | `POST /api/onboarding/acoes` | `AcaoOnboardingDto` | `jsonb` cru (`{ id?, reused?, removed? }`) | `useOnboarding.ts:100-103` |
| O4 | `POST /api/onboarding/eventos` `@HttpCode(204)` | `EventoOnboardingDto` | sem corpo | `useOnboarding.ts:147-152` |
| O5 | `PUT /api/onboarding/tours` `@HttpCode(204)` | `TourOnboardingDto` | sem corpo | `useOnboarding.ts:185-189` |
| O6 | `PATCH /api/onboarding/checklist` `@HttpCode(204)` | `ChecklistOnboardingDto` | sem corpo | `useOnboarding.ts:174-182` |
| O7 | `PATCH /api/onboarding/perfil` `@HttpCode(204)` | `PerfilProfissionalDto` | sem corpo | `useOnboarding.ts:106-119` |
| O8 | `PATCH /api/onboarding/organizacoes/:id` `@HttpCode(204)` | `OrganizacaoDto` | sem corpo | `useOnboarding.ts:121-139` |
| O9 | `POST /api/onboarding/convites` `@HttpCode(200)` | `ConviteDto` | `{ id, token, expires_in_days }` cru | `useOnboarding.ts:155-162` |
| O10 | `POST /api/onboarding/convites/aceitar` `@HttpCode(200)` | `AceitarConviteDto` | `{ organization_id, papel }` cru | `useOnboarding.ts:164-171` |

### 3.1 DTOs (`onboarding/onboarding.dto.ts`)

```ts
export const ACOES_ONBOARDING = ['first_property','first_client','first_deal','first_task',
  'sample_property','sample_client','sample_deal','sample_task','remove_samples'] as const;
export const EVENTOS_ONBOARDING = ['signup_completed','onboarding_started','persona_selected',
  'organization_created','profile_completed','first_property_created','first_client_created',
  'first_deal_created','first_task_created','calendar_connected','team_member_invited','ai_first_used',
  'onboarding_step_skipped','onboarding_completed','onboarding_abandoned','first_value_reached'] as const;
export const STATUS_ETAPA = ['iniciado','concluido','pulado','erro'] as const;
export const STATUS_TOUR = ['concluido','dispensado'] as const;
export const PAPEIS_CONVITE = ['gestor','corretor','financeiro','juridico','locacoes','marketing','suporte'] as const;
/** Campos que o hook já permite hoje (useOnboarding.ts:108-111). */
export const COLUNAS_PERFIL = ['nome','telefone','foto_url','cidade','estado','tipo_atuacao','creci',
  'regioes_atendidas','especialidade','fuso_horario','creci_status'] as const;
/** Chave do front → coluna de routine_organizations (useOnboarding.ts:123-127). */
export const MAPA_ORGANIZACAO = { nome:'name', nome_comercial:'trade_name', cnpj:'cnpj', telefone:'phone',
  email:'email', cidade:'city', estado:'state', logo_url:'logo_url', tamanho_equipe:'team_size',
  tipo_operacao:'operation_types', tipo_organizacao:'organization_type', fuso_horario:'timezone' } as const;
export const COLUNAS_ORGANIZACAO = Object.values(MAPA_ORGANIZACAO);
export const COLUNAS_CHECKLIST = ['minimized','dismissed_at','metadata','atualizado_em'] as const;
```

As listas de `ACOES_ONBOARDING`, `EVENTOS_ONBOARDING`, `STATUS_ETAPA`, `STATUS_TOUR` e
`PAPEIS_CONVITE` são as mesmas que as funções do banco aceitam
(`onboarding_executar_acao`, `registrar_onboarding_evento`, `salvar_onboarding`,
`salvar_onboarding_tour`, `criar_convite_organizacao`): o DTO recusa antes, a função recusa depois.

| DTO | Campos e validações |
|---|---|
| `SalvarOnboardingDto` | `profile?: object` (`@IsObject({ message: 'Dados do perfil inválidos.' })`), `progress?: object` (`@IsObject({ message: 'Dados de progresso inválidos.' })`), `stepKey?: string` (`@IsString`, `@MaxLength(80)`), `stepStatus?: string` (`@IsIn(STATUS_ETAPA, { message: 'Status de etapa inválido.' })`). Todos opcionais; ausentes viram `{}`/`null` no service. |
| `AcaoOnboardingDto` | `action: string` (`@IsIn(ACOES_ONBOARDING, { message: 'Ação de onboarding inválida.' })`), `payload?: object` (`@IsObject({ message: 'Dados da ação inválidos.' })`; ausente vira `{}`). |
| `EventoOnboardingDto` | `eventName: string` (`@IsIn(EVENTOS_ONBOARDING, { message: 'Evento de onboarding inválido.' })`), `stepKey?: string` (`@MaxLength(80)`), `source?: string` (`@MaxLength(40)`; padrão `'onboarding'`), `metadata?: object` (`@IsObject`). |
| `TourOnboardingDto` | `tourKey: string` (`@IsString`, `@IsNotEmpty({ message: 'Informe o tour.' })`, `@MaxLength(80)`), `status: string` (`@IsIn(STATUS_TOUR, { message: 'Status de tour inválido.' })`), `currentStep?: number` (`@IsInt`, `@Min(0)`, `@Max(999)`; padrão 0). |
| `ChecklistOnboardingDto` | `minimized?: boolean` (`@IsBoolean({ message: 'Valor inválido para minimizado.' })`), `dismissed?: boolean` (`@IsBoolean({ message: 'Valor inválido para dispensado.' })`). Os dois ausentes → 400 `nada_para_atualizar`. |
| `PerfilProfissionalDto` | uma propriedade por item de `COLUNAS_PERFIL`, todas `@IsOptional()` + `@IsString({ message: ... })` + `@MaxLength(200)`; `regioes_atendidas` `@MaxLength(500)`; `creci_status` também `@IsIn(['nao_informado','aguardando_validacao','validado'], { message: 'Situação de CRECI inválida.' })`. Nenhuma presente → 400 `nada_para_atualizar`. |
| `OrganizacaoDto` | uma propriedade por chave de `MAPA_ORGANIZACAO`, todas `@IsOptional()`; textos `@IsString` + `@MaxLength(200)`; `tipo_operacao` `@IsArray` + `@IsString({ each: true })` + `@ArrayMaxSize(20)`. Nenhuma presente → 400 `nada_para_atualizar`. |
| `ConviteDto` | `email: string` (`@IsEmail({}, { message: 'Informe um e-mail válido.' })`, `@MaxLength(254)`), `papel?: string` (`@IsIn(PAPEIS_CONVITE, { message: 'Escolha uma função válida para o convite.' })`; padrão `'corretor'`). |
| `AceitarConviteDto` | `token: string` (`@IsString`, `@IsNotEmpty({ message: 'Informe o código do convite.' })`, `@MaxLength(200)`). |

`FORMATO_UUID` é usado só no `:id` de O8 (pela URL, com `ParseUUIDPipe`): nenhum DTO deste módulo tem
campo uuid, então `IsUUID` não aparece em lugar nenhum (molde §0.2).

### 3.2 SQL de cada rota

```sql
-- O1
select public.get_onboarding_contexto() as linha

-- O2  $1 = JSON.stringify(profile ?? {}), $2 = progress, $3 = stepKey ?? null, $4 = stepStatus ?? null
select public.salvar_onboarding($1::jsonb, $2::jsonb, $3::text, $4::text) as linha

-- O3  (atômica e idempotente no banco; a API só chama)
select public.onboarding_executar_acao($1::text, $2::jsonb) as linha

-- O4  ($executeRaw: a função é void)
select public.registrar_onboarding_evento($1::text, $2::text, $3::text, $4::jsonb)

-- O5  ($executeRaw: a função é void)
select public.salvar_onboarding_tour($1::text, $2::text, $3::int)

-- O6  (profile_id vem de claims.sub, nunca do corpo)
update public.onboarding_checklist c set (<cols>) = (select <r.cols>
    from jsonb_populate_record(null::public.onboarding_checklist, $1::jsonb) r)
 where c.profile_id = (select p.id from public.onboarding_profiles p where p.user_id = $2::uuid)
 returning c.id

-- O7
update public.corretores t set (<cols>) = (select <r.cols>
    from jsonb_populate_record(null::public.corretores, $1::jsonb) r)
 where t.user_id = $2::uuid returning t.id

-- O8
update public.routine_organizations t set (<cols>) = (select <r.cols>
    from jsonb_populate_record(null::public.routine_organizations, $1::jsonb) r)
 where t.id = $2::uuid returning t.id

-- O9
select public.criar_convite_organizacao($1::text, $2::text) as linha

-- O10
select public.aceitar_convite_organizacao($1::text) as linha
```

- O6/O7/O8 seguem o modelo de escrita parcial do molde §0.2 (`presentes()` + `jsonb_populate_record` +
  `Prisma.raw` sobre constantes). As colunas vêm de `COLUNAS_CHECKLIST`, `COLUNAS_PERFIL` e
  `COLUNAS_ORGANIZACAO`; chave fora delas nunca chega ao SQL. Zero colunas → `400 { codigo:
  'nada_para_atualizar', message: 'Nada para atualizar.' }`.
- O6 traduz o DTO antes de montar o jsonb, exatamente como o hook faz hoje: `minimized` → `minimized`;
  `dismissed: true` → `dismissed_at = <ISO de agora>`; `dismissed: false` é ignorado (o hook também
  ignora); `atualizado_em` entra sempre.
- O6/O7/O8 com zero linhas → `404 { codigo: 'nao_encontrado' }`, com texto por rota: O6 'Seu onboarding
  ainda não foi criado. Recarregue a página.'; O7 'Perfil não encontrado.'; O8 'Organização não
  encontrada.'. Em O8 isso cobre id inexistente **e** a policy de gestor negando — hoje o PostgREST
  responde "0 linhas" sem erro e a tela mostrava sucesso (§6.5).
- O1 e O2 podem devolver `null` (a função retorna NULL sem perfil): a rota responde `200` com corpo
  `null`, igual ao `data` do supabase-js.
- O9 devolve o token do convite. Ele **nunca** é registrado em log nem repetido em mensagem de erro.
- Nenhuma dessas rotas grava `corretor_id`, `organization_id`, `profile_id` ou `user_id` vindos do
  cliente, e nenhuma delas toca `plans`, `plan_entitlements`, `subscriptions`, `usage_counters` ou
  `subscription_addons`: os imóveis, clientes, oportunidades e tarefas que O3 cria passam pelos gatilhos
  de cota como qualquer outro insert.

---

## 4. Frente T: front

### 4.0 Regra geral

Toda troca fica atrás de `apiDisponivel()` (de `@/lib/api`). Sem `VITE_API_URL`, o ramo Supabase atual
fica intacto no `else`, byte a byte. Os imports de `src/lib/api/assinatura.ts` podem ser estáticos (não
há o ciclo do `CrmPipeline`): `useSubscription.ts`, `useOnboarding.ts` e as duas páginas já importam o
cliente do Supabase de forma estática.

Comandos: `npx vitest run src/lib/api/assinatura.test.ts <demais arquivos>` e
`npx tsc --noEmit -p tsconfig.app.json` (só os erros dos próprios arquivos).

### 4.1 `src/lib/api/assinatura.ts`

Usa `chamarApi` de `@/lib/api` e `lerJson`/`escolher` de `./http`. Ids vão com `encodeURIComponent`.

| Função | Rota | Retorno | Texto padrão de erro |
|---|---|---|---|
| `listarPlanosApi()` | GET `/api/planos` | `Promise<Linha[]>` | 'Não foi possível carregar os planos.' |
| `listarEntitlementsApi()` | GET `/api/planos/entitlements` | `Promise<Linha[]>` | 'Não foi possível carregar os recursos dos planos.' |
| `campanhaAtivaApi()` | GET `/api/planos/campanha` | `Promise<Linha \| null>` | 'Não foi possível carregar a campanha.' |
| `assinaturaAtualApi()` | GET `/api/assinatura` | `Promise<Linha \| null>` | 'Não foi possível carregar a assinatura.' |
| `usoAssinaturaApi()` | GET `/api/assinatura/uso` | `Promise<UsoApi>` | 'Não foi possível carregar o consumo.' |
| `addonsApi()` | GET `/api/assinatura/addons` | `Promise<Linha[]>` | 'Não foi possível carregar os adicionais.' |
| `contaAntigaSemLimiteApi()` | GET `/api/assinatura/conta-antiga` | `Promise<boolean>` (lê `.sem_limite`) | 'Não foi possível verificar a sua conta.' |
| `cotaApi(chave: string)` | GET `/api/assinatura/cota/{chave}` | `Promise<CotaApi>` | 'Não foi possível verificar o limite do plano.' |
| `contextoOnboardingApi()` | GET `/api/onboarding/contexto` | `Promise<unknown \| null>`; **503 → `null`** | 'Não foi possível carregar o onboarding.' |
| `salvarOnboardingApi(input)` | POST `/api/onboarding/salvar` | `Promise<unknown \| null>` | 'Não foi possível salvar o onboarding.' |
| `executarAcaoOnboardingApi(action, payload)` | POST `/api/onboarding/acoes` | `Promise<{ id?: string; reused?: boolean; removed?: boolean }>` | 'Não foi possível concluir esta ação.' |
| `registrarEventoOnboardingApi(eventName, stepKey?, metadata?)` | POST `/api/onboarding/eventos` | `Promise<void>`; **503 → resolve** | 'Não foi possível registrar o evento.' |
| `salvarTourOnboardingApi(tourKey, status, currentStep)` | PUT `/api/onboarding/tours` | `Promise<void>` | 'Não foi possível salvar o tour.' |
| `salvarChecklistOnboardingApi({ minimized?, dismissed? })` | PATCH `/api/onboarding/checklist` | `Promise<void>` | 'Não foi possível salvar o checklist.' |
| `atualizarPerfilOnboardingApi(campos)` | PATCH `/api/onboarding/perfil` | `Promise<void>` | 'Não foi possível salvar o perfil.' |
| `atualizarOrganizacaoOnboardingApi(id, campos)` | PATCH `/api/onboarding/organizacoes/{id}` | `Promise<void>` | 'Não foi possível salvar a empresa.' |
| `criarConviteApi({ email, papel })` | POST `/api/onboarding/convites` | `Promise<{ id: string; token: string; expires_in_days: number }>` | 'Não foi possível preparar o convite.' |
| `aceitarConviteApi(token)` | POST `/api/onboarding/convites/aceitar` | `Promise<{ organization_id: string; papel: string }>` | 'Não foi possível aceitar o convite.' |

Constantes e tipos exportados:

```ts
export const CHAVES_PERFIL_ONBOARDING = ['nome','telefone','foto_url','cidade','estado','tipo_atuacao',
  'creci','regioes_atendidas','especialidade','fuso_horario','creci_status'] as const;
export const CHAVES_ORGANIZACAO_ONBOARDING = ['nome','nome_comercial','cnpj','telefone','email','cidade',
  'estado','logo_url','tamanho_equipe','tipo_operacao','tipo_organizacao','fuso_horario'] as const;
export interface UsoApi {
  period_start: string; period_end: string;
  contadores: Array<Record<string, unknown>>;
  ativos: { max_imoveis: number; max_contratos_locacao: number; max_fachadas: number };
}
export interface CotaApi {
  permitido: boolean; usado: number; limite: number | null; ilimitado: boolean; habilitado: boolean;
}
```

`atualizarPerfilOnboardingApi` e `atualizarOrganizacaoOnboardingApi` filtram o objeto com `escolher`
sobre essas constantes — a mesma allowlist que o hook aplica hoje, para o DTO nunca receber chave
desconhecida (que daria 400 em inglês, molde §0.3).

As duas tolerâncias a 503 (`contextoOnboardingApi`, `registrarEventoOnboardingApi`) reproduzem o
`recursoAindaNaoAplicado` atual: hoje a falta da migration devolve `null` sem travar o produto, e o
evento é engolido. Qualquer outro status vira `ErroApi` pelo `lerErroApi`.

### 4.2 Onde cada tela troca: `src/hooks/useSubscription.ts`

| Hook | Com API |
|---|---|
| `useAllPlans` | `const [plans, entitlements] = await Promise.all([listarPlanosApi(), listarEntitlementsApi()])` e o mesmo `map`/`filter` por `plan_id` de hoje. `queryKey`, `staleTime` e o formato `PlanWithEntitlements[]` não mudam. |
| `useCurrentSubscription` | `assinaturaAtualApi()`; `queryKey: ['subscription', corretorId]` e `enabled: !!corretorId` **continuam iguais** (a sequência de carregamento da tela não muda), mesmo a rota não precisando mais do id. |
| `useUsage` | `usoAssinaturaApi()` e a MESMA montagem de hoje: começa de `uso.contadores`, e para cada `['max_imoveis','max_contratos_locacao','max_fachadas']` sobrescreve `used_quantity` do contador existente ou acrescenta o sintético `{ id: 'active:<key>', corretor_id, feature_key, used_quantity, period_start: uso.period_start, period_end: uso.period_end, created_at, updated_at }`. Quatro consultas viram uma (§6.1). |
| `useAddons` | `addonsApi()` |
| `useActiveCampaign` | `campanhaAtivaApi()` |
| `useContaAntigaSemLimite` | `contaAntigaSemLimiteApi()` |
| `useCheckLimit`, `useSubscriptionSummary` | **não mudam uma linha.** Eles só compõem os hooks acima; `baseLimit`, `ratio`, `status`, `LEGADO`, `BLOQUEADO` e `aguardandoContaAntiga` ficam idênticos (§6.6). |

`cotaApi` não é chamada por nenhum hook nesta onda: ela existe para o servidor e para o módulo de
backoffice (§7.1).

### 4.3 `src/hooks/useOnboarding.ts`

Cada função do hook ganha o ramo `apiDisponivel()`; a assinatura externa, as `queryKey`, `retry: false`,
`staleTime: 30_000`, `invalidar()`, `setQueryData` e `normalizarContextoOnboarding` ficam iguais — por
isso `OnboardingChecklist.tsx`, `OnboardingTour.tsx` e `OnboardingGate.tsx` não precisam de edição.

| Função do hook | Com API |
|---|---|
| `buscarContexto` | `contextoOnboardingApi()`; `null` → `null`; objeto → `normalizarContextoOnboarding`. O `recursoAindaNaoAplicado` continua existindo e cobre só o ramo Supabase. |
| `salvar` | `salvarOnboardingApi({ profile, progress, stepKey, stepStatus })` |
| `executarAcao` | `executarAcaoOnboardingApi(action, payload)` |
| `atualizarPerfilProfissional` | `atualizarPerfilOnboardingApi(campos)` — sem `auth.getUser()`: o `user_id` sai de `claims.sub` no servidor (§6.3) |
| `atualizarOrganizacao` | `atualizarOrganizacaoOnboardingApi(id, campos)` (chaves em português; o mapa para as colunas inglesas passa a ser do servidor) |
| `registrarEvento` | `registrarEventoOnboardingApi(eventName, stepKey, metadata)` |
| `criarConvite` | `criarConviteApi({ email, papel })` |
| `aceitarConvite` | `aceitarConviteApi(token)` |
| `salvarChecklist` | `salvarChecklistOnboardingApi({ minimized, dismissed })` — mantém o `if (!profileId) return` de hoje |
| `salvarTour` | `salvarTourOnboardingApi(tourKey, status, currentStep)` e `await invalidar()` |

### 4.4 `src/pages/Onboarding.tsx` e `src/pages/PlanoAssinatura.tsx`

Nenhuma das duas fala com o Supabase direto: `Onboarding.tsx` só usa `useOnboarding()` e
`PlanoAssinatura.tsx` só `useSubscriptionSummary()`/`useAllPlans()` mais o `paymentProvider`. O que muda:

- `Onboarding.tsx:255-260` (`executar`) continua mostrando `error.message`. Com API esse texto passa a
  ser o `message` em português do §0.4 em vez da mensagem crua do Postgres — nenhuma mudança de código,
  e `src/pages/Onboarding.becos.test.tsx` segue passando (roda sem `VITE_API_URL`).
- Nenhum ponto da página decide algo pelo texto exato de um `RAISE` (conferido): nada a mudar.
- `PlanoAssinatura.tsx`: o aviso de `billingIntegrationReady` e os caminhos do `paymentProvider` ficam
  como estão. A edição é o comentário que registra que plano, consumo e campanha passam a vir da API
  quando `VITE_API_URL` existir, e que troca/cancelamento continuam fora deste contrato.

As duas estão na lista da frente porque são as telas donas do fluxo, não porque mudam muito: se ao fim
só o comentário mudar, é isso mesmo.

### 4.5 Testes do front (`src/lib/api/assinatura.test.ts`, Vitest)

1. Cada função chama caminho, método e corpo fixos (mock de `chamarApi`), com `encodeURIComponent` no
   `:id` de O8 e na chave de A5.
2. `contextoOnboardingApi` com 503 → `null`; com 500 → `ErroApi`.
3. `registrarEventoOnboardingApi` com 503 → resolve sem lançar; com 400 → `ErroApi` com o texto do corpo.
4. `atualizarPerfilOnboardingApi` manda só as chaves de `CHAVES_PERFIL_ONBOARDING` (chave fora da lista
   não vai no corpo); `atualizarOrganizacaoOnboardingApi` idem.
5. `contaAntigaSemLimiteApi` devolve `false` com `{ sem_limite: false }` e `true` no outro caso.
6. `campanhaAtivaApi` devolve `null` com corpo `null` e lança `ErroApi` com `codigo: 'campanha_ambigua'`
   no 409.
7. `usoAssinaturaApi` devolve o objeto cru; e um teste do `useUsage` provando que a montagem final tem
   os três `feature_key` ativos com a contagem viva e o id sintético `active:<key>`.
8. Com `apiDisponivel()` falso, `useSubscription` e `useOnboarding` não chamam nenhuma função de
   `assinatura.ts` (mock do módulo + mock do cliente do Supabase).
9. Fixtures de uuid em formato v4 (`'11111111-1111-4111-8111-111111111111'`, ...), molde §0.5.

---

## 5. Testes obrigatórios da API (frente S)

### 5.1 Jest de texto (`*.spec.ts`, com `TenantDb` falso)

```ts
const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
const db = { run: jest.fn(async (_c, w) => w(tx)) };
```
Leia `tx.$queryRaw.mock.calls[i][0].text` e `.values` (nunca `.sql`: nele os parâmetros são `?`).

1. **Casts e formato:** cada rota tem um caso conferindo no `.text` os casts (`::uuid`, `::int`,
   `::text`, `::jsonb`), `to_jsonb(` nas rotas de linha, e `limit $n::int` com `LIMITE_LISTA` em
   `.values` onde há lista (C1, C2, A3).
2. **`db.run` recebe as claims** em todas as rotas autenticadas.
3. **O4 e O5 usam `$executeRaw`**, nunca `$queryRaw` (função `void`); e `$queryRaw` não foi chamado.
4. **O3 chama a RPC**, e o SQL **não** contém `insert into`, `update ` nem `delete from`: prova que a
   lógica não foi reescrita.
5. **O6/O7/O8:** corpo vazio → 400 `nada_para_atualizar` sem tocar o banco; chave fora da allowlist não
   aparece no `.text`; zero linhas no `returning` → 404 com o `codigo` e o texto da §3.2;
   `dismissed: true` vira `dismissed_at`, `dismissed: false` não entra no SQL.
6. **A2:** o SQL tem as três contagens com `count(*)::int`, usa
   `date_trunc('month', now() at time zone $n::text)` com o fuso em `.values`, e não contém `corretor_id =`.
7. **A4/A5:** o SQL passa `public.get_corretor_id()` à função (nunca um parâmetro do cliente);
   `get_corretor_id()` null em A5 → 403 `corretor_nao_identificado`; chave fora de `CHAVES_COTA` → 400
   `recurso_invalido` sem SQL.
8. **C3:** zero linhas → `null`; uma → a linha; duas → 409 `campanha_ambigua`.
9. **`CatalogoRepo`:** as três rotas públicas rodam `set local role anon` antes do SELECT e **não** usam
   o `TenantDb` (`db.run` não chamado).
10. **Tradutor:** um caso por linha da tabela §0.4, com o erro falso do molde §0.5:
    ```ts
    new Prisma.PrismaClientKnownRequestError('x', { code: 'P2010', clientVersion: 'teste',
      meta: { code: 'P0001', message: 'ERROR: cliente inválido' } });
    ```
    incluindo `PLAN_LIMIT_REACHED:max_imoveis` → 402 com `recurso`, `42501` → 403, `42883` → 503, e um
    P0001 fora da tabela → 422 `regra_do_banco` **sem** o texto do Postgres na resposta.
11. **Controllers** (supertest, guard sobrescrito, `ValidationPipe({ whitelist: true, transform: true,
    forbidNonWhitelisted: true })`, `setGlobalPrefix('api')`, service falso): pelo menos um caso por DTO
    conferindo que o array `message` do 400 traz o texto em português; `action`/`eventName` fora da lista
    → 400; `tourKey` vazio → 400; chave desconhecida no corpo → 400.
12. **Paridade URL × corpo (molde §0.5):**
    `PATCH /api/onboarding/organizacoes/11111111-1111-1111-1111-111111111111` com corpo válido chega ao
    service com esse id; `.../abc` → 400 `id_invalido`.
13. **Guard:** um caso do `CatalogoController` sem `Authorization` responde 200 (prova que não há guard)
    e um do `AssinaturaController` sem token responde 401.

### 5.2 SQL real (`api/test/sql-real/assinatura.test.ts`, harness sem edição)

Usa `criarBanco()`, `banco.db`, `banco.prisma`, `banco.contaA`/`contaB`, `banco.sqlSuperusuario`,
`banco.inserir`, `banco.criarConta` e `capturarErroHttp`. Nenhum acesso a rede. A conta A já nasce com
plano + entitlement `max_imoveis` + assinatura `active` (`LIMITE_IMOVEIS_A`); a conta B nasce sem
assinatura.

1. **C1/C2/C3 pelo `CatalogoRepo`:** o plano da conta A aparece em C1; um plano com `active = false`
   (inserido por `banco.inserir`) **não** aparece; C2 traz o entitlement `max_imoveis`; C3 com zero
   campanhas → `null`, com uma → a linha, com duas → 409 `campanha_ambigua`.
2. **A1 isola as contas:** com `claimsA` devolve a assinatura de A com `plan` embutido (`UUID`,
   `TIMESTAMPTZ`, `monthly_price` como número JSON); com `claimsB` devolve `null`.
3. **A2:** dois imóveis ativos e um inativo para A → `ativos.max_imoveis === 2`; um `usage_counters` do
   período atual aparece em `contadores` e um de outro período não; `period_start` casa com
   `date_trunc('month', now() at time zone 'America/Sao_Paulo')`; com `claimsB` as três contagens são 0
   e `contadores` é `[]`.
4. **A3:** addon `active` de A aparece; `canceled` não; addon de B não aparece para A.
5. **A4:** sem linha em `billing_legacy_accounts` → `false`; com a linha e assinatura `trialing` →
   `true`; com assinatura `active` → `false` (a mesma regra da função).
6. **A5 não afrouxa nada:** `max_imoveis` com uso abaixo do limite → `permitido: true`; com
   `limit_value = 1` e um imóvel ativo → `permitido: false, usado: 1, limite: 1`; `feature_key` sem
   entitlement no plano → `permitido: false, habilitado: false`; com `claimsB` → `permitido: false`.
7. **O gatilho de cota continua valendo pela API:** com `limit_value = 1` para `max_imoveis`, O3
   `first_property` cria o primeiro imóvel e o segundo responde **402 `PLAN_LIMIT_REACHED`** com
   `recurso: 'max_imoveis'`; `banco.transacoes.commitsAbortados` continua 0.
8. **O1:** contexto de A traz `profile`, `progress`, `organization`, `membership`, `evidence` e
   `subscription` com `plan_code`; uma conta nova cujo perfil foi removido como superusuário → `null`.
9. **O2:** `stepKey: 'persona'` + `stepStatus: 'concluido'` + `profile.persona` grava a etapa em
   `onboarding_steps`, o evento `persona_selected` em `onboarding_events` e devolve o contexto já com a
   persona; repetir não duplica o evento.
10. **O3 é idempotente:** `sample_client` duas vezes devolve o **mesmo `id`** (e `reused: true` na
    segunda), e `clientes` tem uma linha só; `remove_samples` apaga os registros de demonstração.
11. **O3 é atômico:** `first_deal` sem cliente → 422 (`cliente_invalido` ou `pipeline_nao_configurado`,
    conforme o estado) **e nada gravado**: `crm_oportunidades` segue vazia e `commitsAbortados` é 0.
12. **O4:** evento válido grava em `onboarding_events` e o `metadata` fora da allowlist da função é
    descartado (sobrevivem só `persona`, `organization_type`, `source`, `step`, `role`, `action`,
    `reused`).
13. **O5:** tour `concluido` grava `completed_at`; repetir como `dispensado` mantém `completed_at` e
    grava `dismissed_at` (o `coalesce` da função).
14. **O6:** `minimized: true` grava; `dismissed: true` grava `dismissed_at`; a mesma chamada com as
    claims de B não altera a linha de A (0 linhas → 404).
15. **O7/O8:** O7 atualiza `corretores` de A e nunca o de B; O8 com a organização de A pela conta A
    grava, e pela conta B → 404 (a policy `routine organizations: managers update` nega).
16. **O9/O10 ponta a ponta:** O9 pela conta A (proprietária) devolve `{ id, token, expires_in_days: 7 }`
    e grava `organizacao_convites` com `token_hash`; O9 por uma conta sem papel de gestão → 403
    `sem_permissao_convite`; O10 com token inexistente → 404 `convite_invalido`; O10 pela conta cujo
    e-mail não é o do convite → 403 `convite_de_outro_email`; O10 com o e-mail certo grava
    `routine_memberships` com `status = 'active'` e muda `organizacao_convites.status` para `'aceito'`.
17. **RLS de verdade:** o mesmo SELECT de A1 dentro de `banco.db.run(claimsB, ...)` não enxerga a
    assinatura de A (zero linhas), e um `select ... from public.billing_legacy_accounts` dentro do
    `TenantDb` falha com 42501 (prova que a tabela só é alcançável pela função `SECURITY DEFINER`).
18. **Formato PostgREST:** `monthly_price` como número JSON, `period_start` como `'YYYY-MM-DD'`,
    `trial_ends_at` como `'...+00:00'` com microssegundos, `metadata` como objeto.

Comandos: `cd api && npx jest src/assinatura` e `cd api && npx tsc --noEmit` (só os erros dos próprios
arquivos); o SQL real roda pelo `node --test` já configurado em `api/`.

---

## 6. Decisões que mudam comportamento (só com `VITE_API_URL`)

1. **`useUsage` faz uma chamada em vez de quatro** (A2). O efeito é o mesmo de hoje — qualquer falha
   derruba o resumo inteiro —, mas sem quatro viagens e sem ler contagens de instantes diferentes.
2. **O período de cota passa a ser calculado pelo servidor** em `America/Sao_Paulo`
   (`BILLING_USAGE_TIMEZONE`), o mesmo fuso de `checar_cota`. Hoje vem do `Intl` do navegador
   (`src/lib/billingPeriod.ts`): relógio ou fuso errados no cliente podiam pedir o contador do mês errado.
3. **`atualizarPerfilProfissional` não chama mais `auth.getUser()`**: o `user_id` sai de `claims.sub` no
   servidor. Uma viagem menos e nenhuma chance de gravar no corretor de outra sessão.
4. **Campanha ambígua vira erro explícito** (409 `campanha_ambigua`) em vez do PGRST116 silencioso do
   `maybeSingle`. O resumo continua funcionando (`campaign || null`), mas o log diz o motivo.
5. **O6/O7/O8 respondem 404 quando nada foi atualizado.** Hoje o PostgREST aceita "0 linhas" calado e a
   tela mostrava sucesso sem ter gravado (por exemplo o checklist de um perfil inexistente).
6. **A conta de limite continua no front, de propósito.** `useCheckLimit` e `useSubscriptionSummary` não
   mudam uma linha: a tela segue mostrando o mesmo número de hoje, e a trava real continua no gatilho do
   banco, que a API repassa como 402. A rota A5 existe para quem precisa da resposta autoritativa
   (servidor, backoffice) sem reimplementar a regra. A divergência conhecida entre as duas contas
   (`extra_leads_50` existe em `checar_cota` e falta no `addonMap` do hook) fica registrada como
   pendência (§7.2.2) em vez de ser "corrigida" aqui: mexer nela mudaria o número mostrado na tela sem
   mudar o limite aplicado.
7. **Mensagem de erro do onboarding passa a ser texto nosso.** Os `RAISE EXCEPTION` em português das RPCs
   chegavam crus ao usuário pelo supabase-js ('pipeline não configurado'); agora cada um tem HTTP, código
   e frase de interface (§0.4). P0001 não mapeado responde texto genérico e **nunca** o texto do banco.
8. **O catálogo passa a ter rota pública.** Nada é exposto além do que o `anon` já lê pelo PostgREST, e o
   front continua chamando com token (`chamarApi` exige sessão, e as três telas que leem catálogo só
   existem logado). A rota é pública para o site de preços e o checkout futuros lerem sem sessão (§7.1).

Ficam **iguais** de propósito: `onboarding_executar_acao` monolítica (quebrá-la é projeto à parte);
contadores que misturam consumo mensal persistido com contagem viva (é o que `checar_cota` faz); a falta
de aviso na tela quando `useAllPlans` falha; `pricing_campaigns.current_customers` sem atualização
transacional; e `salvarChecklist` não fazer nada sem `profileId`.

---

## 7. Fora do escopo e pendências

### 7.1 Fora do escopo desta onda (continuam como estão, ninguém edita)

- **Fachadas** (`useFachadas.ts`, `useFachadaPublica.ts`, `FachadasInteligentes.tsx`, Edge
  `fachada-publica`): módulo próprio. A cota `max_fachadas` é só **lida** aqui (A2/A5).
- **Checkout, troca e cancelamento de plano:** `paymentProvider`, `asaas-webhook`, `asaas-sync`,
  `docs/ASAAS_PLANOS_ATIVACAO.md`. Nenhuma rota de escrita de assinatura nesta onda.
- **`incrementar_uso`** (grant só para `service_role`), `reserve_contract_quota` e
  `release_contract_quota`: pertencem ao módulo de contratos/IA, já migrado.
- **Backoffice e papéis** (`useAdminDados`, `useSaasDados`, `usePapeis`, `admin_config`,
  `exigir_super_admin`), **parceiros**, **IA**, **diagnóstico comercial** e **WhatsApp**: módulos
  próprios (inventário 14).
- `onboarding_preferences`, `onboarding_sample_data` (lida só pela RPC) e o site público de preços.
- Desligar as policies/grants de `anon` e as Edge Functions no Supabase: virada (fase 6). Nenhuma Edge
  Function do escopo desta onda existe — assinatura e onboarding sempre foram RPC e tabela direta
  (`supabase/functions/` não tem função de billing nem de onboarding), e é por isso que §3 porta funções
  do banco em vez de handlers Deno.

### 7.2 Pendências (migrations propostas, **NÃO** aplicadas)

1. Uma campanha ativa por vez (hoje nada impede duas, e o `maybeSingle` quebra):
   ```sql
   create unique index if not exists uq_pricing_campaigns_active
     on public.pricing_campaigns ((active)) where active;
   ```
2. Alinhar o `addonMap` do front com `checar_cota`: falta `extra_leads_50 → leads_qualificados_monthly`
   (`src/hooks/useSubscription.ts:262-275` × `0_init/migration.sql:4564`). Mudar o front muda o número
   mostrado; decidir junto com o produto.
3. Incremento de uso pela API exigiria
   `grant execute on function public.incrementar_uso(uuid,text,integer) to authenticated` — **não**
   fazer: o incremento é do servidor. Se virar rota, entra no módulo de webhook/admin com papel de
   serviço, nunca no `TenantDb`.
4. Grants largos de `anon` que só a RLS segura hoje (não há policy de escrita, mas o grant existe):
   ```sql
   revoke insert, update, delete on table public.plans, public.plan_entitlements,
     public.pricing_campaigns, public.onboarding_profiles, public.onboarding_progress,
     public.onboarding_steps, public.onboarding_tours, public.onboarding_checklist from anon;
   ```
5. Variável e rota de alteração de assinatura (§0.5): quando o checkout SaaS existir, `503
   checkout_nao_configurado` com o texto que `PlanoAssinatura.tsx` já mostra.
6. Juntar os `*.erros.ts` dos módulos num arquivo só (pendência herdada do molde §7.2): hoje
   `assinatura.erros.ts` repete `erroPg`/`erroApi`.
7. Quebrar `onboarding_executar_acao` em comandos (defeito "RPC monolítica" do inventário 14): exige
   migration e é projeto à parte; até então a API chama a função como está, que é o que preserva a
   atomicidade e a idempotência.
8. `organizacao_convites` sem índice único por `token_hash` e sem limpeza de expirados:
   ```sql
   create unique index if not exists uq_organizacao_convites_token_hash
     on public.organizacao_convites (token_hash);
   ```
   (conferir duplicatas antes de criar).
9. `usage_counters.period_end` nem sempre é escrito pela mesma expressão: conferir na virada que todas
   as funções usam `(period_start + interval '1 month - 1 day')::date`.

---

## 8. Integração (orquestrador, depois das duas frentes)

1. Acrescentar `AssinaturaModule` em `api/src/app.module.ts`.
2. `cd api && npm test` (Jest + `node --test` do SQL real) e os testes do front.
3. Fumaça local com `VITE_API_URL` apontando para a API local: abrir `/plano` (plano, consumo e
   campanha), rodar o onboarding de ponta a ponta (persona → perfil → empresa → primeiro imóvel →
   primeiro cliente → oportunidade → tarefa → convite → conclusão), minimizar e dispensar o checklist,
   concluir um tour, e conferir que o imóvel acima da cota responde 402 com a mesma frase de hoje.
4. Conferência de banco único do molde §4.0 antes de ligar `VITE_API_URL` em qualquer build.
