# Contrato da API Lotti: módulo fachadas (placas com QR Code, leads e página pública)

Duas frentes trabalham em paralelo, sem conversar, e cada uma só toca os próprios arquivos. Tudo o que elas precisam combinar está fixado aqui: caminhos, DTOs, SQL, formato de resposta, códigos de erro, porte da Edge Function, nomes das funções do front, testes e pendências.

Base: contrato do módulo 2 (`docs/superpowers/specs/2026-10-04-api-lotti-modulo2-contrato.md`) e os contratos da onda 2 (`2026-10-05-api-lotti-contratos-contrato.md`, `-financeiro-`, `-rotina-`). **Tudo o que este contrato não redefine segue o módulo 2**: §0.2 (TenantDb, `Prisma.sql`, casts explícitos, `to_jsonb`, `FORMATO_UUID`, `presentes()` + `jsonb_populate_record`), §0.3 (formato de erro HTTP), §0.4 (tradutor de erros do banco) e §0.5 (os testes leem `.text`, fixtures em v4). Do contrato de rotina vem o padrão de **caminho do servidor** (§0.2 de lá) e o de **variável opcional lida de `process.env` com 503 de texto claro**.

Inventário de origem: `C:/Users/rafae/lotti-inventarios/14-fachadas-assinatura-onboarding.md` (seção "Fachadas") e `02-edge-functions.md`.

**Três coisas desta onda não podem mudar, em nenhuma hipótese:**

1. **O id da fachada e o caminho público.** O QR Code está impresso em placa apontando para `app.plataformalotti.com.br/p/<id>`. O `id` é gerado pelo banco no insert e o gatilho `tr_proteger_id_fachada` recusa qualquer UPDATE que o altere (23514). Nenhuma rota aceita `id` no corpo, nem na criação nem na edição. A rota do SPA `/p/:fachadaId` em `src/App.tsx:268` não muda.
2. **As rotas públicas ficam sem login**, com o mesmo limite de uso e as mesmas validações de hoje — porque hoje elas já são o gatilho `guard_public_fachada_insert` e a função `consume_public_request_limit` no próprio banco, e este contrato continua passando por eles (§0.3).
3. **A resposta pública não ganha coluna nenhuma.** A allowlist de colunas da §2.1 é a mesma da Edge Function `fachada-publica` (`supabase/functions/fachada-publica/index.ts:55-70`), nem uma coluna a mais. `mensagem_contato`, `total_escaneamentos`, `total_leads` e qualquer coluna futura de `public.fachadas` ficam fora.

Fotos continuam no Storage do Supabase: as rotas só leem e devolvem `imovel_fotos.arquivo_url` como texto. Nenhum upload, nenhuma URL assinada, nenhuma migração para o R2 nesta onda.

---

## 0. Regras comuns

### 0.1 Quem é dono de quê

| Frente | Arquivos (só estes) |
|---|---|
| **A** api-fachadas | cria tudo em `api/src/fachadas/**` (estrutura fixa em §1.1; classe `FachadasModule` em `api/src/fachadas/fachadas.module.ts`) e `api/test/sql-real/fachadas.test.ts`. |
| **F** front | cria `src/lib/api/fachadas.ts` e `src/lib/api/fachadas.test.ts`; edita `src/hooks/useFachadas.ts`, `src/hooks/useFachadaPublica.ts`, `src/pages/FachadasInteligentes.tsx`, `src/pages/FachadaPublica.tsx`, `src/components/fachadas/CriarFachadaDialog.tsx`, `src/components/fachadas/FachadaCard.tsx` e `src/components/fachadas/FachadaPreview.tsx`. |

Ninguém edita: `api/src/app.module.ts` (a integração liga o módulo, §5), `api/src/main.ts`, `api/src/prisma/*`, `api/src/auth/*`, `api/src/config/env.ts`, `api/prisma/*`, `api/test/sql-real/harness.ts`, `src/lib/api.ts`, `src/lib/api/http.ts`, `src/lib/api/crm.ts`, `src/types/fachada.ts`, `src/lib/publicBaseUrl.ts`, `src/lib/fachadas/mensagemContato.ts`, `src/components/fachadas/LeadsTable.tsx`, `src/components/fachadas/FachadaDashboard.tsx`, `src/components/fachadas/AssistenteTemplateDialog.tsx`, `src/components/fachadas/QRCodeGenerator.tsx`, `src/components/fachadas/QrCodePositioner.tsx`, `src/components/fachadas/FachadaMediaUpload.tsx`, `src/components/fachadas/fachadaExport.ts`, `src/hooks/useSubscription.ts`, `src/hooks/useFileUpload.ts`, `src/hooks/crm/*`, `supabase/**`, `AI_HANDOFF.md`, `docs/*` (fora deste arquivo).

`src/components/fachadas/LeadsTable.tsx` e `FachadaDashboard.tsx` ficam de fora porque **não têm nenhuma chamada ao Supabase**: recebem `leads`, `fachadas` e `metricas` por props e chamam `onDeleteLead`/`onDeactivate`. A conversão de lead em cliente (`crm_converter_lead`) já é do módulo CRM (`src/hooks/crm/useCrm.ts:486`, `converterLeadApi`) e **não entra neste escopo**.

Também valem: nenhuma migration aplicada (as propostas estão em §7.2, com o SQL, só descritas); nada de `prisma migrate`, `db push`, `db pull` ou `migrate reset`; nada de commit, stash ou troca de branch; nada contra Supabase, Railway, Storage ou rede (os testes não usam rede); segredos só por nome, nunca por valor.

### 0.2 Dois caminhos de banco

**1. Caminho do usuário (TenantDb).** Todas as rotas autenticadas (§1.3 a §1.6) passam por `this.db.run(claims, (tx) => tx.$queryRaw(Prisma.sql\`...\`))`. RLS, `auth.uid()`, `get_corretor_id()`, os gatilhos de contador e a trava de plano valem exatamente como no PostgREST hoje. As policies que mandam são:

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `fachadas` | `corretor_id in (corretores do auth.uid())` | igual | `corretor_id = get_corretor_id()` (USING e WITH CHECK) | `corretor_id in (...)` |
| `fachada_leads` | por fachada do corretor | policy pública (não usada por rota autenticada) | por fachada do corretor | `fachada_id in (fachadas com corretor_id = get_corretor_id())` |
| `fachada_escaneamentos` | por fachada do corretor | policy pública | — | — |
| `fachada_templates` | `corretor_id is null or corretor_id in (corretores do auth.uid())` | `corretor_id in (...)` | idem | idem |

Nenhuma rota autenticada filtra por corretor no SQL: quem decide é o RLS, como hoje. A única exceção é `POST /api/fachadas`, que precisa do `corretor_id` para gravá-lo (módulo 2 §0.2: `select public.get_corretor_id()::text as id` no mesmo `run`; null → 403 `corretor_nao_identificado`).

**2. Caminho público (role `anon`).** As três rotas públicas não têm sessão, então o TenantDb não serve (ele recusa claims sem `role: 'authenticated'`). Elas usam o `PrismaService` direto, dentro de `api/src/fachadas/publico/fachadas-publico.repo.ts`, e **só ali**. Duas formas, e a escolha de cada uma é deliberada:

- **Escrita (P2 escaneamento, P3 lead): dentro de uma transação com `set local role anon`.** É o que reproduz o comportamento de hoje linha por linha: a policy `"Publico registra escaneamento em fachada ativa"` / `"Publico cria lead em fachada ativa"` (`WITH CHECK public_fachada_active(fachada_id)`) continua valendo, o gatilho `guard_public_insert` continua rodando com `current_setting('role') = 'anon'` e, por causa disso, continua **forçando** `convertido = false`, `cliente_id = null`, `created_at = clock_timestamp()` e `ip_hash = null`. Se a escrita rodasse como dono do banco, esse `IF` do gatilho não entraria e a proteção contra forja sairia junto — é exatamente a trava que este contrato não pode perder.

  ```ts
  // fachadas-publico.repo.ts — a ÚNICA ocorrência de $executeRawUnsafe do módulo.
  private async comoAnonimo<T>(trabalho: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'anon' })}, true)`;
      await tx.$executeRawUnsafe('set local role anon'); // string constante; nenhum valor do cliente entra aqui
      return trabalho(tx);
    });
  }
  ```

  `set local role` não aceita parâmetro, e é por isso que o `TenantDb` de produção já usa `$executeRawUnsafe` na mesma linha (`api/src/prisma/tenant-db.ts`). A regra "nenhum `Unsafe`" do módulo 2 §0.2 continua valendo para todo o resto do módulo: **esta é a única exceção, com string constante, sem interpolação, e os testes de §4.1 conferem que ela é a única.**
- **Leitura (P1 ver fachada): como dono do banco, sem troca de role.** É o porte fiel da Edge Function, que usa `SERVICE_ROLE` justamente porque o RLS esconde do anônimo os imóveis não anunciados e a tabela `corretores` inteira. A proteção aqui não é o RLS, é a **allowlist de colunas escrita no SQL** (§2.1) mais o filtro `ativo = true`. Nenhum `select *`, nenhum `to_jsonb(f)`: coluna nova em `public.fachadas` não aparece sozinha nesta resposta.

Em todo o módulo: SQL por `tx.$queryRaw(Prisma.sql\`...\`)` / `tx.$executeRaw(Prisma.sql\`...\`)`; cast explícito em todo parâmetro (`::uuid`, `::text`, `::int`, `::boolean`, `::jsonb`, `::timestamptz`); nome de coluna só por `Prisma.raw` a partir de constante; `count(*)::int`; nenhum `$queryRawUnsafe`.

`FORMATO_UUID` é declarado em `api/src/fachadas/fachadas.dto.ts`, igual ao módulo 2 (8-4-4-4-12 hexadecimal, sem versão). `IsUUID` não é usado em nenhum DTO. Na URL: `ParseUUIDPipe` com `exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.')` — **inclusive nas rotas públicas**, onde ele substitui o `UUID_PATTERN.test(fachadaId)` da Edge Function.

`LIMITE_LISTA = 1000` (exportado de `fachadas.dto.ts`), sempre `limit ${LIMITE_LISTA}::int`. É o `max-rows` que o PostgREST aplica hoje, então o front não perde nem ganha linha. Vale para F1, F5 e F8. Toda ordenação desempata por `id`.

### 0.3 O limite de uso e as validações públicas: onde eles moram

Nada disso é reimplementado em Node. **A fonte continua sendo o banco**, e as rotas públicas passam por ela:

| Trava | Onde está hoje | Continua valendo porque |
|---|---|---|
| fachada tem de estar ativa | policy `WITH CHECK public_fachada_active(fachada_id)` + 1ª linha de `guard_public_fachada_insert` | o insert roda como `anon` |
| nome 2–120, telefone ≤32, e-mail ≤254 com formato | `guard_public_fachada_insert` | idem |
| telefone normalizado: tira não-dígitos, tira `55` de 12/13 dígitos, exige `^[1-9][0-9]{9,10}$` | `guard_public_fachada_insert` | idem |
| **limite de lead:** 300 por minuto no escopo global (`qr-lead-global`) e 5 por 10 minutos por telefone (`qr-lead-phone`, sha256 do telefone normalizado) | `consume_public_request_limit` | idem |
| **limite de escaneamento:** 1200 por minuto global (`qr-scan-global`) e 120 por minuto por fachada (`qr-scan-fachada`) | `consume_public_request_limit` | idem |
| visitante não forja `convertido`, `cliente_id`, `created_at`, `ip_hash` | `IF current_setting('role',true) IN ('anon','authenticated')` no gatilho | o insert roda como `anon` |
| `user_agent` cortado em 500 | gatilho | idem |
| `nome` com `trim()` | gatilho | idem |

Em cima disso, e **só em cima** (nunca em lugar dela), o DTO de P3 repete as mesmas regras para o visitante receber um 400 em português em vez de um 500: são as mesmas fronteiras (2–120, ≤32, ≤254, mesmo regex de e-mail, mesmo regex de telefone depois da normalização, feita por `normalizarTelefone()` em `fachadas-publico.dto.ts` com a tradução literal do gatilho). Se as duas discordarem, quem decide é o banco — e o teste de SQL real de §4.2 prova que o par concorda nos dois sentidos.

Além dos campos, as rotas públicas **não aceitam nenhuma chave extra**: o `ValidationPipe` global já roda com `whitelist` e `forbidNonWhitelisted`, então `convertido`, `cliente_id`, `created_at`, `ip_hash` ou `corretor_id` no corpo dão 400 antes de chegar ao banco. P2 nem lê o corpo (§2.2).

### 0.4 Erros (`api/src/fachadas/fachadas.erros.ts`)

Copia `ErroPg`, `erroPg`, `erroApi` e o esqueleto de `traduzirErroBanco` do módulo 2 §0.4, com estes casos próprios, **nesta ordem**:

| SQLSTATE / mensagem do Postgres | HTTP | `codigo` | `message` |
|---|---|---|---|
| P0001 `PLAN_LIMIT_REACHED:max_fachadas` | 402 | `PLAN_LIMIT_REACHED` | Limite de Fachadas Inteligentes atingido. Acesse Plano e Assinatura para liberar mais fachadas. (extra `recurso: 'max_fachadas'`) |
| P0001 `PLAN_LIMIT_REACHED:<outro>` | 402 | `PLAN_LIMIT_REACHED` | Limite do plano atingido. Acesse Plano e Assinatura. (extra `recurso`) |
| P0001 `Fachada indisponível` | 404 | `fachada_indisponivel` | Esta placa não está mais disponível. |
| P0001 `Dados de contato inválidos` | 400 | `contato_invalido` | Confira nome, telefone e e-mail e tente de novo. |
| P0001 `Telefone inválido` | 400 | `telefone_invalido` | Informe um telefone válido com DDD. |
| P0001 `Muitas tentativas. Aguarde alguns minutos.` | 429 | `muitas_tentativas` | Muitas tentativas. Aguarde alguns minutos. |
| P0001 `Configuração de limite inválida` | — | sobe como veio (500 do Nest: é bug do servidor, não do visitante) | |
| 23514 com `identificador da fachada` no bruto (gatilho `proteger_id_fachada`) | 409 | `id_imutavel` | O identificador da fachada é o QR Code impresso na placa e não pode mudar. Para um QR novo, exclua a fachada e crie outra. |
| 42501 `Atendimento expirado.` | 403 | `atendimento_expirado` | Atendimento expirado. |
| 42501 nas rotas públicas | 404 | `fachada_indisponivel` | Esta placa não está mais disponível. (não revela se a fachada existe) |
| 42501 nas rotas autenticadas | 403 | `sem_permissao` | Você não tem permissão para fazer esta alteração. |
| 23503 / 23001 | 422 | `referencia_invalida` | Um registro relacionado não existe mais. Recarregue a página e tente de novo. |
| 22P02, 22007, 22008, 22003, 22001, 23502, 23514 (demais) | 400 | `dados_invalidos` | Dados inválidos. Confira os campos e tente de novo. |
| outro | sobe como veio (500 do Nest) | | |

`traduzirErroBanco(e, op)` recebe `op: { publico?: boolean }` — é só isso que separa o 42501 em 404 e em 403. A ordem importa: `PLAN_LIMIT_REACHED` antes dos outros P0001; `id_imutavel` antes do 23514 genérico; `Atendimento expirado.` antes dos outros 42501; o 42501 público antes do autenticado.

**`Atendimento expirado.` não é teoria neste módulo.** As quatro tabelas do escopo (`fachadas`, `fachada_leads`, `fachada_escaneamentos`, `fachada_templates`) têm o gatilho `auditar_suporte` (`auditar_mutacao_suporte`) em INSERT, UPDATE e DELETE. Ele lê `auth.jwt()->>'session_id'` e, quando a sessão é de atendimento de suporte e já venceu, levanta 42501 com esse texto exato. O `TenantDb` passa as claims completas por `set_config('request.jwt.claims', ...)`, então o gatilho funciona pela API como funcionava pelo PostgREST — e sem esta linha do tradutor um atendimento vencido viraria um "Você não tem permissão" enganoso. Nas rotas públicas o gatilho sai sem fazer nada (não há `session_id`), e por isso o 42501 público segue sendo 404.

Erros fixos de serviço (sem passar pelo banco):

| HTTP | `codigo` | `message` | Quando |
|---|---|---|---|
| 404 | `nao_encontrado` | Fachada não encontrada. | F3/F4 que não acham linha visível |
| 404 | `lead_nao_encontrado` | Lead não encontrado. | F6 que não acha linha visível |
| 404 | `template_nao_encontrado` | Template não encontrado. | F10 que não acha linha visível |
| 404 | `fachada_indisponivel` | Esta placa não está mais disponível. | P1 sem linha ativa (é o 404 da Edge Function) |
| 400 | `nada_para_atualizar` | Nada para atualizar. | F3 com corpo vazio |
| 400 | `id_invalido` | Identificador inválido. | `ParseUUIDPipe` em qualquer rota, pública inclusive |
| 403 | `corretor_nao_identificado` | Não foi possível identificar o corretor. | F2 com `get_corretor_id()` null |

Nenhuma mensagem do Postgres é repassada ao cliente e nenhum log registra nome, telefone, e-mail, `user_agent` ou `meta.message`: só SQLSTATE e `codigo` (módulo 2 §0.2).

### 0.5 Variáveis do módulo

**Nenhuma.** O módulo fachadas não fala com serviço externo nenhum: não há chave de serviço, não há `fetch`, não há 503 de "não configurado". As fotos são lidas como texto de `imovel_fotos.arquivo_url` e o QR Code continua sendo montado no navegador por `src/lib/publicBaseUrl.ts` (`VITE_PUBLIC_BASE_URL`, que é do front e já existe). Esta seção fica aqui explicitamente para que ninguém invente uma variável nova: se alguma frente achar que precisa de uma, o caminho é uma pendência em §7, não uma variável.

A única coisa de infraestrutura a conferir na virada é **CORS**: as rotas públicas são chamadas pela landing em `https://app.plataformalotti.com.br`, que precisa estar em `CORS_ORIGINS` no Railway (§7.3). O `main.ts` não muda.

---

## 1. Frente A: API (`api/src/fachadas/`)

### 1.1 Estrutura (fixa)

```
api/src/fachadas/
  fachadas.module.ts              # classe FachadasModule
  fachadas.controller.ts          # @Controller('fachadas') + SupabaseAuthGuard  -> F1..F4
  fachadas.service.ts
  fachadas-leads.controller.ts    # @Controller('fachadas/leads') + guard        -> F5, F6
  fachadas-leads.service.ts
  fachadas-metricas.controller.ts # @Controller('fachadas/metricas') + guard     -> F7
  fachadas-metricas.service.ts
  fachadas-templates.controller.ts# @Controller('fachadas/templates') + guard    -> F8..F11
  fachadas-templates.service.ts
  fachadas-midias.controller.ts   # @Controller('fachadas/midias') + guard       -> F12
  fachadas-midias.service.ts
  fachadas.dto.ts                 # FORMATO_UUID, LIMITE_LISTA, DTOs autenticados
  fachadas.erros.ts               # erroPg, erroApi, traduzirErroBanco (§0.4)
  publico/
    fachadas-publico.controller.ts# @Controller('publico/fachadas') SEM guard    -> P1..P3
    fachadas-publico.service.ts
    fachadas-publico.repo.ts      # PrismaService: leitura como dono + escrita como anon (§0.2)
    fachadas-publico.dto.ts       # DTO do lead + normalizarTelefone()
  *.spec.ts                       # um spec por controller e por service
```

`fachadas.module.ts`:

```ts
@Module({
  controllers: [FachadasLeadsController, FachadasMetricasController, FachadasTemplatesController,
    FachadasMidiasController, FachadasPublicoController, FachadasController],
  providers: [SupabaseAuthGuard, FachadasService, FachadasLeadsService, FachadasMetricasService,
    FachadasTemplatesService, FachadasMidiasService, FachadasPublicoService, FachadasPublicoRepo],
})
export class FachadasModule {}
```

**Ordem dos caminhos.** `fachadas/leads`, `fachadas/metricas`, `fachadas/templates` e `fachadas/midias` colidem com `fachadas/:id`, e o Nest casa na ordem em que as rotas são registradas — que é a ordem do array `controllers`. Por isso `FachadasController` (o único com `:id`) é o **último** da lista, e os quatro prefixos literais vêm antes. Dentro de cada controller, rota estática antes de rota com `:id` (módulo 2 §0.2): em `fachadas-templates.controller.ts`, `templates/por-imagem` é declarada antes de `templates/:id`. O teste de §4.1 prova que `GET /api/fachadas/leads` não cai em `GET /api/fachadas/:id`.

### 1.2 Resumo das rotas

| # | Método e caminho | Login | Sucesso | Troca |
|---|---|---|---|---|
| F1 | `GET /api/fachadas` | sim | 200 lista | `useFachadas.fetchFachadas` |
| F2 | `POST /api/fachadas` | sim | 201 linha | `useFachadas.createFachada` |
| F3 | `PATCH /api/fachadas/:id` | sim | 200 linha | `useFachadas.updateFachada` |
| F4 | `DELETE /api/fachadas/:id` | sim | 204 | `useFachadas.deleteFachada` |
| F5 | `GET /api/fachadas/leads?fachada_id=` | sim | 200 lista | `useFachadas.fetchLeads` |
| F6 | `DELETE /api/fachadas/leads/:id` | sim | 204 | `useFachadas.deleteLead` |
| F7 | `GET /api/fachadas/metricas?dias=` | sim | 200 objeto | `useFachadas.fetchMetricas` |
| F8 | `GET /api/fachadas/templates?escopo=` | sim | 200 lista | `FachadasInteligentes.fetchCustomTemplates` |
| F9 | `POST /api/fachadas/templates` | sim | 201 linha | `FachadasInteligentes.handleSaveCustomTemplate`, `CriarFachadaDialog` |
| F10 | `DELETE /api/fachadas/templates/:id` | sim | 204 | `FachadasInteligentes.handleDeleteCustomTemplate` |
| F11 | `GET /api/fachadas/templates/por-imagem?imagem_url=` | sim | 200 objeto ou `null` | `FachadaPreview` (QR de template personalizado) |
| F12 | `GET /api/fachadas/midias/:imovelId` | sim | 200 objeto | `FachadaCard`, `FachadaPreview` |
| P1 | `GET /api/publico/fachadas/:id` | **não** | 200 `{ fachada, fotos }` | `useFachadaPublica.fetchFachadaPublica` |
| P2 | `POST /api/publico/fachadas/:id/escaneamentos` | **não** | 204 | `useFachadaPublica.registrarEscaneamento` |
| P3 | `POST /api/publico/fachadas/:id/leads` | **não** | 200 `{ registrado: true }` | `useFachadaPublica.enviarLead` |

### 1.3 F1–F4: a fachada

**Resposta.** F1 devolve um array; F2 e F3 devolvem a linha. O formato é o do PostgREST com embed, que é o que o front já consome: `to_jsonb(f)` (todas as colunas de `public.fachadas`, em snake_case, `created_at` com microssegundos e `+00:00`) mais as chaves `imovel` e `corretor`. **Em F2 e F3 o embed não vem** — o `.insert().select().single()` e o `.update()` de hoje também não traziam embed, e o front refaz a lista depois (`await fetchFachadas()`).

As colunas do embed são exatamente as de hoje (`src/hooks/useFachadas.ts:25-28`), que não são as mesmas da rota pública:

- `imovel`: `titulo, tipo, valor, area_m2, dormitorios, garagem, endereco, bairro, cidade, descricao`
- `corretor`: `nome, telefone, email, creci, foto_url, razao_social`

Quando `imoveis`/`corretores` não devolvem linha (RLS ou linha apagada), a chave vem `null`, como o embed do PostgREST — e o front já troca `null` por `undefined`.

**F1 — `GET /api/fachadas`** (`@Get()`):

```sql
select to_jsonb(f)
  || jsonb_build_object(
       'imovel', (select jsonb_build_object('titulo', i.titulo, 'tipo', i.tipo, 'valor', i.valor,
                          'area_m2', i.area_m2, 'dormitorios', i.dormitorios, 'garagem', i.garagem,
                          'endereco', i.endereco, 'bairro', i.bairro, 'cidade', i.cidade,
                          'descricao', i.descricao)
                   from public.imoveis i where i.id = f.imovel_id),
       'corretor', (select jsonb_build_object('nome', c.nome, 'telefone', c.telefone, 'email', c.email,
                            'creci', c.creci, 'foto_url', c.foto_url, 'razao_social', c.razao_social)
                     from public.corretores c where c.id = f.corretor_id)
     ) as linha
  from public.fachadas f
 order by f.created_at desc, f.id
 limit ${LIMITE_LISTA}::int
```

O `order by created_at desc` é o de hoje; `, f.id` é o desempate obrigatório do módulo 2.

**F2 — `POST /api/fachadas`** (`@Post()`, 201). `CriarFachadaDto`:

| Campo | Validação (mensagem em português em todo decorator) | Obrigatório |
|---|---|---|
| `imovel_id` | `@Matches(FORMATO_UUID, { message: 'Imóvel inválido.' })` | sim |
| `tipo_negocio` | `@IsIn(['VENDA','ALUGUEL','TEMPORADA','LANCAMENTO'], …)` | sim |
| `template_id` | `@IsString` + `@IsNotEmpty` + `@MaxLength(2048)` | sim |
| `cta_principal` | `@IsIn(['AGENDAR_VISITA','WHATSAPP','SOLICITAR_INFO','FAZER_PROPOSTA'], …)` | sim |
| `modo_conversao` | `@IsBoolean` | sim |
| `mensagem_whatsapp` | `@IsOptional` + `@IsString` + `@MaxLength(600)` | não |
| `mensagem_contato` | `@IsOptional` + `@IsString` + `@MaxLength(600)` | não |
| `logo_url` | `@IsOptional` + `@IsString` + `@MaxLength(2048)` | não |
| `foto_principal_url` | `@IsOptional` + `@IsString` + `@MaxLength(2048)` | não |
| `ativo` | `@IsOptional` + `@IsBoolean` | não |

`@IsIn` de `tipo_negocio` e `cta_principal` são os checks `fachadas_tipo_negocio_check` e `fachadas_cta_principal_check` em DTO. `template_id` aceita `2048` porque hoje ele guarda **a URL da arte** quando o template é personalizado (`CriarFachadaDialog.tsx`: `finalTemplateId = result.url`) — por isso também não há `@IsIn` aqui. `id`, `corretor_id`, `total_escaneamentos`, `total_leads` e `created_at` não existem no DTO: se vierem, o `forbidNonWhitelisted` dá 400. O `@MaxLength(600)` de `mensagem_contato` espelha o check `fachadas_mensagem_contato_tamanho`; `mensagem_whatsapp` não tem check no banco, e o 600 é escolha nossa (§7.2.1).

Um único `run`, três passos:

1. `select public.get_corretor_id()::text as id` — null → 403 `corretor_nao_identificado`.
2. Se `foto_principal_url` não veio, resolve como hoje (principal, senão a primeira por `ordem`):

   ```sql
   select arquivo_url from public.imovel_fotos
    where imovel_id = ${imovelId}::uuid
    order by principal desc, ordem asc nulls last, id
    limit 1
   ```

   Uma consulta no lugar das duas de hoje: `principal desc` já põe a principal na frente, e o resultado é o mesmo. Sem linha → grava `null`.
3. Insert pelo molde do módulo 2 (`presentes()` + `jsonb_populate_record`), com `COLUNAS_CRIACAO` constante:

   ```sql
   insert into public.fachadas as x (corretor_id, foto_principal_url, ${alvo})
   select ${corretorId}::uuid, ${fotoPrincipal}::text, ${origem}
     from jsonb_populate_record(null::public.fachadas, ${json}::jsonb) r
   returning to_jsonb(x) as linha
   ```

   `foto_principal_url` sai do `${alvo}` e entra fixo (o passo 2 decide o valor). `id` vem do `gen_random_uuid()` do banco — **a API nunca manda id** (ponto 1 da abertura).

O gatilho `fachadas_limite_plano` roda neste insert quando `ativo` é true (default) e pode levantar `PLAN_LIMIT_REACHED:max_fachadas` → 402 (§0.4). O front continua checando a cota antes (`podeCriarRecurso(checkLimit('max_fachadas'))` em `CriarFachadaDialog.tsx:150`), e agora o 402 vira a segunda linha de defesa com texto próprio em vez do `err.message` cru.

**F3 — `PATCH /api/fachadas/:id`** (200). `EditarFachadaDto` = os mesmos campos de F2, **todos opcionais**, menos `imovel_id` (hoje o front manda `Partial<Fachada>` e nada troca o imóvel de uma placa já impressa; trocar o imóvel mudaria o que o QR mostra sem mudar o QR). `COLUNAS_EDICAO = ['tipo_negocio','template_id','cta_principal','modo_conversao','mensagem_whatsapp','mensagem_contato','logo_url','foto_principal_url','ativo']`. Corpo sem nenhuma dessas chaves → 400 `nada_para_atualizar`.

```sql
update public.fachadas t
   set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.fachadas, ${json}::jsonb) r)
 where t.id = ${id}::uuid
returning to_jsonb(t) as linha
```

Sem linha → 404 `nao_encontrado` (é o que o RLS dá para fachada de outro corretor: `update` que não casa, não erro). `ativo: true` pode levantar `PLAN_LIMIT_REACHED` (o gatilho é `BEFORE UPDATE OF ativo, corretor_id`). O gatilho `tr_proteger_id_fachada` nunca dispara por aqui, porque `id` não é coluna de escrita — mas o 23514 dele está no tradutor (§0.4) de qualquer forma, como rede.

**F4 — `DELETE /api/fachadas/:id`** (`@HttpCode(204)`):

```sql
delete from public.fachadas where id = ${id}::uuid returning id::text as id
```

Sem linha → 404 `nao_encontrado`. O cascade apaga leads e escaneamentos da fachada (FKs `ON DELETE CASCADE`), como hoje. O front chama esta rota no botão rotulado "desativar" (`onDeactivate={deleteFachada}`): o nome da prop mente, o comportamento de hoje é apagar, e este contrato **mantém o apagar** (§7.1.7).

### 1.4 F5–F7: leads e métricas

**F5 — `GET /api/fachadas/leads?fachada_id=<uuid>`** (`@Get()` no controller `fachadas/leads`). `ListarLeadsDto`: `fachada_id` opcional, `@Matches(FORMATO_UUID, { message: 'Fachada inválida.' })`.

```sql
select to_jsonb(l) as linha
  from public.fachada_leads l
 where (${fachadaId}::uuid is null or l.fachada_id = ${fachadaId}::uuid)
 order by l.created_at desc, l.id
 limit ${LIMITE_LISTA}::int
```

`fachada_id` ausente → passa `null` e o filtro se anula (é o `if (fachadaId) query.eq(...)` de hoje, em SQL). O RLS devolve só os leads das fachadas do corretor.

**F6 — `DELETE /api/fachadas/leads/:id`** (204):

```sql
delete from public.fachada_leads where id = ${id}::uuid returning id::text as id
```

Sem linha → 404 `lead_nao_encontrado`. O gatilho `trg_dec_leads` decrementa `fachadas.total_leads`, como hoje.

**F7 — `GET /api/fachadas/metricas?dias=<int>`**. `MetricasDto`: `dias` opcional, `@Type(() => Number)` + `@IsInt({ message: 'Período inválido.' })` + `@Min(1, …)` + `@Max(365, …)`; padrão `30`. O front já só manda 7, 30 ou 90.

Resposta — **o mesmo objeto `FachadaMetricas` de `src/types/fachada.ts`**, montado no servidor:

```json
{ "totalFachadas": 3, "totalEscaneamentos": 42, "totalLeads": 7, "taxaConversao": 17,
  "fachadasMaisAcessadas": [],
  "leadsPorDia": [{ "data": "2026-09-20", "leads": 1, "escaneamentos": 5 }] }
```

Uma consulta só, no mesmo `run`:

```sql
with janela as (select (now() - make_interval(days => ${dias}::int)) as inicio),
 ativas as (select count(*)::int as n from public.fachadas where ativo = true),
 eventos as (
   select (l.created_at at time zone 'UTC')::date as dia, 1 as leads, 0 as scans
     from public.fachada_leads l, janela j where l.created_at >= j.inicio
   union all
   select (s.created_at at time zone 'UTC')::date, 0, 1
     from public.fachada_escaneamentos s, janela j where s.created_at >= j.inicio),
 dias as (select dia, sum(leads)::int as leads, sum(scans)::int as escaneamentos
            from eventos group by dia)
select (select n from ativas) as total_fachadas,
       coalesce((select sum(leads)::int from dias), 0) as total_leads,
       coalesce((select sum(escaneamentos)::int from dias), 0) as total_escaneamentos,
       coalesce((select jsonb_agg(jsonb_build_object('data', to_char(dia, 'YYYY-MM-DD'),
                 'leads', leads, 'escaneamentos', escaneamentos) order by dia) from dias), '[]'::jsonb) as leads_por_dia
```

O service calcula `taxaConversao = totalEscaneamentos > 0 ? Math.round(totalLeads / totalEscaneamentos * 100) : 0` — a mesma conta de hoje, no servidor — e devolve `fachadasMaisAcessadas: []`.

Quatro coisas sobre isto, todas deliberadas:

- `fachadasMaisAcessadas` **continua vazio**. Hoje é `[]` fixo (`useFachadas.ts:277`) e o dashboard já lida com isso. Preencher mudaria uma tela que ninguém pediu para mudar nesta onda: fica em §7.1.1.
- `(created_at at time zone 'UTC')::date` reproduz o `l.created_at.slice(0,10)` de hoje, que corta a string ISO em UTC. O servidor roda com `TimeZone = UTC` (Supabase e Railway), e o `at time zone 'UTC'` é explícito só para não depender disso.
- `now() - interval` substitui o `new Date(); setDate(getDate() - dias)` do navegador. A janela passa a ser do servidor, não do relógio do visitante — mesma intenção, fonte melhor.
- Não há `limit` aqui porque não há lista: são agregações. É a única rota do módulo sem `LIMITE_LISTA`, e é por isso que ela **corrige** o corte silencioso de hoje, em que o PostgREST devolvia no máximo 1000 leads e 1000 escaneamentos e o navegador contava `array.length` (§6.8).

### 1.5 F8–F11: templates

**F8 — `GET /api/fachadas/templates?escopo=meus|todos`**. `ListarTemplatesDto`: `escopo` opcional, `@IsIn(['meus','todos'], { message: 'Escopo inválido.' })`, padrão `'todos'`.

```sql
select to_jsonb(t) as linha
  from public.fachada_templates t
 where (${escopo}::text = 'todos' or t.corretor_id = public.get_corretor_id())
 order by t.created_at desc, t.id
 limit ${LIMITE_LISTA}::int
```

`escopo=meus` é o que `fetchCustomTemplates` faz hoje (`.eq('corretor_id', corretorId)` depois de resolver `get_corretor_id`) — e resolver o corretor passa a ser um detalhe do SQL, não uma chamada extra do front. `escopo=todos` cai no RLS, que já devolve os do corretor **mais os padrão** (`corretor_id is null`); nenhuma tela usa isso hoje, e a rota fica pronta sem mudar o que existe.

**F9 — `POST /api/fachadas/templates`** (201). `CriarTemplateDto`:

| Campo | Validação | Obrigatório |
|---|---|---|
| `nome` | `@IsString` + `@IsNotEmpty` + `@MaxLength(120)` | sim |
| `categoria` | `@IsIn(['VENDA','ALUGUEL','ALTO_PADRAO','COMERCIAL','RURAL','LANCAMENTO'], …)` | sim |
| `config` | `@IsObject({ message: 'Configuração inválida.' })` | sim |
| `padrao` | `@IsOptional` + `@IsBoolean` | não |

`@IsIn` de `categoria` é o check `fachada_templates_categoria_check` em DTO. `config` é `jsonb` livre (hoje guarda `imagem_url`, `qrPosition`, `qrSize`, cores, `estilo`, `layout`): valida que é objeto e nada mais — o front monta a forma, `src/types/fachada.ts` a tipa, e não é papel da API fixar as cores.

```sql
insert into public.fachada_templates as x (corretor_id, nome, categoria, config, padrao)
select public.get_corretor_id(), ${nome}::text, ${categoria}::text, ${config}::jsonb, ${padrao}::boolean
returning to_jsonb(x) as linha
```

`${config}` é `JSON.stringify(dto.config)`. `padrao` ausente → `false`. `get_corretor_id()` null → o WITH CHECK da policy dá 42501 → 403 `sem_permissao`; o front não chega aí (sem corretor não há sessão).

**F10 — `DELETE /api/fachadas/templates/:id`** (204):

```sql
delete from public.fachada_templates where id = ${id}::uuid returning id::text as id
```

Sem linha → 404 `template_nao_encontrado`. Um template padrão (`corretor_id is null`) é visível mas não apagável: o RLS de DELETE não casa, e a resposta é o mesmo 404.

**F11 — `GET /api/fachadas/templates/por-imagem?imagem_url=<texto>`** — rota **estática, declarada antes de `templates/:id`** neste controller. `PorImagemDto`: `imagem_url` `@IsString` + `@IsNotEmpty` + `@MaxLength(2048)`.

```sql
select to_jsonb(t) as linha
  from public.fachada_templates t
 where t.config->>'imagem_url' = ${imagemUrl}::text
 order by t.created_at desc, t.id
 limit 1
```

É o `.filter('config->>imagem_url','eq', …).limit(1).maybeSingle()` de `FachadaPreview.tsx:91`. Sem linha → **200 com corpo `null`**, não 404: hoje o `maybeSingle()` devolve `data: null` e a tela cai na posição padrão do QR sem erro. Trocar por 404 faria o `lerJson` do front lançar e mudaria a tela.

### 1.6 F12: mídias do imóvel

**F12 — `GET /api/fachadas/midias/:imovelId`**. Resposta:

```json
{ "foto_principal_url": "https://…/foto.jpg", "fotos": 8, "videos": 2 }
```

```sql
select (select arquivo_url from public.imovel_fotos
          where imovel_id = ${imovelId}::uuid
          order by principal desc, ordem asc nulls last, id limit 1) as foto_principal_url,
       (select count(*)::int from public.imovel_fotos where imovel_id = ${imovelId}::uuid) as fotos,
       (select count(*)::int from public.videos where imovel_id = ${imovelId}::uuid) as videos
```

Uma chamada no lugar das três de hoje (`FachadaCard.tsx:41-61`). O `FachadaPreview` usa só `foto_principal_url` e ignora o resto. A ordenação é a mesma de `FachadaCard` (`principal desc, ordem asc`) e, de quebra, resolve a divergência com `FachadaPreview`, que hoje faz `principal = true` e só depois a primeira por `ordem` — dois caminhos para a mesma pergunta, com a mesma resposta em todo caso real (§6.7). O RLS de `imovel_fotos` e `videos` já restringe ao corretor; imóvel de outro corretor devolve `{ foto_principal_url: null, fotos: 0, videos: 0 }`, como as consultas de hoje.

**Atenção, achado do levantamento: `public.videos` existe em produção mas NÃO existe no baseline do Prisma.** A tabela é criada em `supabase/migrations/20260115123324_*.sql:5` (com RLS `corretor_id = get_corretor_id()`), e `grep videos api/prisma/migrations/0_init/migration.sql` não devolve nada — o baseline que o harness aplica não a tem. Consequências, e o que a frente A faz com cada uma:

- **Em produção a rota funciona**, porque o banco real tem a tabela. O SQL acima fica como está e `videos` continua sendo contado: tirá-lo quebraria o `hasMidias = fotos > 0 || videos > 0` do `FachadaCard`.
- **No teste de SQL real a consulta falharia com 42P01**, porque a tabela não existe no PGlite. O teste **não** pode simplesmente ignorar isso: ele checa `select to_regclass('public.videos') is not null` por `banco.sqlSuperusuario` e, quando a tabela falta, **cria uma cópia mínima dela no próprio teste** (`create table public.videos (id uuid default gen_random_uuid() primary key, corretor_id uuid, imovel_id uuid)` com RLS e a policy do corretor, por `sqlSuperusuario`) antes de exercitar F12, deixando um comentário que aponta para esta seção e para §7.2.3. Nada de `skip` silencioso: a rota tem de ser exercitada.
- **A divergência em si é a pendência §7.2.3**, com o SQL proposto para trazer `videos` ao baseline. Enquanto ela existir, qualquer outro módulo que toque `videos` tropeça no mesmo lugar, e é por isso que ela está registrada aqui e não só resolvida de lado.

**Por que `imovel_fotos` e `videos` são lidos aqui e não no módulo imóveis:** as três perguntas (foto principal, quantas fotos, quantos vídeos) existem **só** para as telas de fachada, e o módulo imóveis não tem rota que as responda. Ler tabela de outro assunto por SQL é diferente de editar arquivo de outro módulo — este contrato não toca em `api/src/imoveis/**`. Se o módulo imóveis ganhar uma rota de mídias depois, F12 passa a ser um atalho redundante e pode sair (§7.1.3).

---

## 2. Porte da Edge Function `fachada-publica` (P1–P3)

A Edge Function `supabase/functions/fachada-publica/index.ts` **não é apagada nem editada nesta onda**: ela continua respondendo para qualquer front que ainda não tenha `VITE_API_URL`. O porte é rota nova na API, com o mesmo comportamento.

As três rotas públicas:

- **não têm `@UseGuards`** e nenhuma delas toca `claims`;
- validam o id com `ParseUUIDPipe` (o `UUID_PATTERN.test` da função);
- não devolvem detalhe de erro nenhum que diga se a fachada existe: fachada inexistente, inativa e barrada por RLS dão o mesmo 404 `fachada_indisponivel`;
- nunca logam `user_agent`, nome, telefone nem e-mail.

| Trecho da Edge Function | Vira |
|---|---|
| `corsHeaders` com `Allow-Origin: *` | `app.enableCors({ origin: env.corsOrigins })` do `main.ts`, que já roda. **Mudança de comportamento:** a API não responde a origem fora de `CORS_ORIGINS` (§6.1, §7.3) |
| `if (req.method === 'OPTIONS')` | o CORS do Nest/Express responde o preflight |
| `if (!['GET','POST'].includes(method)) → 405` | o Nest devolve 404 para método não casado. Diferença conhecida e sem efeito: nenhum cliente nosso manda outro método (§6.2) |
| `?id=` / `?fachadaId=` / corpo `{ fachadaId }` / `{ id }` — quatro portas para o mesmo id | **uma só:** o id no caminho, `GET /api/publico/fachadas/:id`. O front sempre usou o corpo `{ fachadaId }` (§6.3) |
| `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` | `PrismaService` como dono do banco (§0.2), **sem `SUPABASE_SERVICE_ROLE_KEY`**: a chave de serviço deixa de existir neste caminho. É a razão principal do porte |
| `.select('id, corretor_id, …')` com allowlist, `.eq('ativo', true).single()` | o `jsonb_build_object` de §2.1, com a allowlist escrita no SQL |
| `error || !fachada → 404 'Fachada não encontrada ou inativa'` | 404 `fachada_indisponivel`, mensagem "Esta placa não está mais disponível." |
| fotos de `imovel_fotos` ordenadas por `ordem` | §2.1, com `, id` de desempate (§6.6) |
| `catch → 500 'Não foi possível carregar os dados. Tente novamente.'` | o 500 padrão do Nest; o front já tem o texto de fallback |
| `PublicRequestError` / `readPublicJson` de `_shared/public-request.ts` | o `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`) e o `ParseUUIDPipe` |
| inserts de scan e lead, que hoje **não passam pela função** (o front insere direto como `anon`) | P2 e P3, que continuam rodando como `anon` (§0.2) — mesmas policies, mesmo gatilho, mesmo limite |

### 2.1 P1 — `GET /api/publico/fachadas/:id`

Resposta, **idêntica à da Edge Function**:

```json
{ "fachada": { "id": "…", "corretor_id": "…", "imovel_id": "…", "tipo_negocio": "VENDA",
    "template_id": "venda-classica", "cta_principal": "WHATSAPP", "modo_conversao": false,
    "mensagem_whatsapp": null, "logo_url": null, "foto_principal_url": null,
    "ativo": true, "created_at": "2026-10-05T11:19:49.433456+00:00",
    "imovel": { "id": "…", "titulo": "…", "tipo": "…", "valor": 450000.5, "area_m2": 90,
      "dormitorios": 3, "banheiros": 2, "garagem": 1, "endereco": "…", "bairro": "…",
      "cidade": "…", "estado": "…", "descricao": "…" },
    "corretor": { "nome": "…", "telefone": "…", "email": "…", "creci": "…",
      "foto_url": null, "razao_social": null } },
  "fotos": [{ "id": "…", "arquivo_url": "…", "principal": true }] }
```

São 12 colunas de `fachadas`, 14 de `imoveis`, 6 de `corretores` e 3 por foto. **Nenhuma a mais.** Repare que o embed público tem `id`, `banheiros` e `estado`, que o embed autenticado de F1 não tem, e que `mensagem_contato`, `total_escaneamentos` e `total_leads` **não estão aqui** — a função atual não os devolve, e a abertura deste contrato diz que nada é acrescentado. Nenhum dado de proprietário (`proprietario_cpf`, `_nome`, `_telefone`, `_email`) existe nesta allowlist.

```sql
select jsonb_build_object(
    'id', f.id, 'corretor_id', f.corretor_id, 'imovel_id', f.imovel_id,
    'tipo_negocio', f.tipo_negocio, 'template_id', f.template_id, 'cta_principal', f.cta_principal,
    'modo_conversao', f.modo_conversao, 'mensagem_whatsapp', f.mensagem_whatsapp,
    'logo_url', f.logo_url, 'foto_principal_url', f.foto_principal_url,
    'ativo', f.ativo, 'created_at', f.created_at,
    'imovel', (select jsonb_build_object('id', i.id, 'titulo', i.titulo, 'tipo', i.tipo,
                 'valor', i.valor, 'area_m2', i.area_m2, 'dormitorios', i.dormitorios,
                 'banheiros', i.banheiros, 'garagem', i.garagem, 'endereco', i.endereco,
                 'bairro', i.bairro, 'cidade', i.cidade, 'estado', i.estado, 'descricao', i.descricao)
                from public.imoveis i where i.id = f.imovel_id),
    'corretor', (select jsonb_build_object('nome', c.nome, 'telefone', c.telefone, 'email', c.email,
                   'creci', c.creci, 'foto_url', c.foto_url, 'razao_social', c.razao_social)
                  from public.corretores c where c.id = f.corretor_id)
  ) as fachada,
  coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'arquivo_url', p.arquivo_url,
              'principal', p.principal) order by p.ordem asc nulls last, p.id)
             from public.imovel_fotos p where p.imovel_id = f.imovel_id), '[]'::jsonb) as fotos
from public.fachadas f
where f.id = ${id}::uuid and f.ativo = true
```

Uma consulta no lugar das duas da função. Sem linha → 404 `fachada_indisponivel`. `imovel`/`corretor` ausentes vêm `null`, como o `?? null` da função. `principal` sai como booleano (o `!!f.principal` da função). `fotos` vem `[]` quando não há foto — a função devolvia `[]` no mesmo caso, pelo `fotos || []`.

### 2.2 P2 — `POST /api/publico/fachadas/:id/escaneamentos`

`@HttpCode(204)`, **sem corpo**. O `user_agent` vem do cabeçalho `User-Agent` da própria requisição (`@Headers('user-agent')`), não do corpo. Hoje o navegador manda `navigator.userAgent` no corpo — a mesma informação, por um canal que o visitante não escolhe (§6.4). O controller não declara DTO nenhum; qualquer corpo é ignorado.

Dentro de `comoAnonimo` (§0.2):

```sql
insert into public.fachada_escaneamentos (fachada_id, user_agent)
values (${id}::uuid, ${userAgent}::text)
```

Sem `RETURNING`: `anon` tem `INSERT` em `fachada_escaneamentos`, mas a policy de `SELECT` é a do corretor, e um `RETURNING` daria 42501 — é por isso que hoje o front também insere sem `.select()`. `$executeRaw`, portanto (o módulo 2 §0.2 permite `$executeRaw` quando não há `RETURNING`; o objeto passado tem os mesmos `.text` e `.values`).

`user_agent` null (cabeçalho ausente) grava NULL, como a coluna permite. `ip_hash` nunca é enviado — e o gatilho o zera de qualquer forma. `created_at` vem do `clock_timestamp()` do gatilho.

O gatilho dispara, nesta ordem: fachada inativa → 404 `fachada_indisponivel`; limite estourado (1200/min global, 120/min por fachada) → 429 `muitas_tentativas`. O gatilho `trigger_increment_escaneamentos` incrementa `fachadas.total_escaneamentos`, como hoje.

**A falha continua silenciosa para o visitante.** Hoje `registrarEscaneamento` engole o erro de propósito — contar scan não pode atrapalhar quem acabou de apontar o celular para uma placa. O front mantém esse `catch` (§3.2). A API responde o erro correto; é o front que o ignora.

### 2.3 P3 — `POST /api/publico/fachadas/:id/leads`

`@HttpCode(200)`, resposta `{ "registrado": true }`. Não devolve a linha: `anon` não pode ler `fachada_leads`, e o front de hoje só olha se houve erro (`setLeadCapturado(true)`).

`EnviarLeadDto` (`publico/fachadas-publico.dto.ts`), com as fronteiras de `guard_public_fachada_insert` (§0.3):

| Campo | Validação | Obrigatório |
|---|---|---|
| `nome` | `@Transform(trim)` + `@IsString({ message: 'Informe seu nome.' })` + `@IsNotEmpty({ message: 'Informe seu nome.' })` + `@MinLength(2, { message: 'Informe seu nome completo.' })` + `@MaxLength(120, { message: 'Nome muito longo.' })` | sim |
| `telefone` | `@IsString` + `@IsNotEmpty({ message: 'Informe seu telefone.' })` + `@MaxLength(32, { message: 'Telefone muito longo.' })` + `@TelefonePublico({ message: 'Informe um telefone válido com DDD.' })` | sim |
| `email` | `@IsOptional` + `@IsString` + `@MaxLength(254, { message: 'E-mail muito longo.' })` + `@Matches(EMAIL_PUBLICO, { message: 'Informe um e-mail válido.' })` | não |

`@Transform` faz o `trim` antes do `@MinLength`, para `'  a  '` ser recusado como o gatilho recusa (`length(trim(NEW.nome)) NOT BETWEEN 2 AND 120`). `@TelefonePublico` é um `ValidatorConstraint` próprio do arquivo que normaliza antes de comparar — a tradução literal do gatilho:

```ts
/** Tradução literal de guard_public_fachada_insert: tira não-dígitos e o 55 de 12/13 dígitos. */
export function normalizarTelefone(valor: string): string {
  const digitos = valor.replace(/\D/g, '');
  return (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55') ? digitos.slice(2) : digitos;
}
const TELEFONE_VALIDO = /^[1-9][0-9]{9,10}$/;      // aplicado ao resultado de normalizarTelefone
const EMAIL_PUBLICO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // o mesmo do gatilho, em sintaxe JS
```

`EMAIL_PUBLICO` é o `'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'` do gatilho, com `[:space:]` virando `\s`. `email: ''` **não** passa pelo `@IsOptional` (string vazia não é `undefined`), então o `@Matches` recusa com 400, enquanto o gatilho aceitaria `''` (ele só valida quando `email <> ''`). Diferença deliberada, a mais restritiva das duas, e o front já não manda `email` quando o campo está vazio (§3.2, §6.5).

**O telefone gravado é o que o visitante digitou**, não o normalizado: `normalizarTelefone` só valida. É o que acontece hoje — o gatilho normaliza para checar o limite por telefone e para o regex, mas grava `NEW.telefone` como veio. Mudar isso mudaria o que o corretor vê no `LeadsTable` e o link de WhatsApp que ele monta.

Dentro de `comoAnonimo`:

```sql
insert into public.fachada_leads (fachada_id, nome, telefone, email)
values (${id}::uuid, ${nome}::text, ${telefone}::text, ${email}::text)
```

Quatro colunas, e só essas. `convertido`, `cliente_id` e `created_at` **não aparecem no SQL**: ficam com o default, e o gatilho os reforça porque o role é `anon`. `email` ausente → `null`. Sem `RETURNING`, pelo mesmo motivo de P2 — `$executeRaw`.

Erros do gatilho: fachada inativa → 404 `fachada_indisponivel`; nome ou e-mail fora da faixa → 400 `contato_invalido`; telefone → 400 `telefone_invalido`; limite (300/min global, 5/10min por telefone) → 429 `muitas_tentativas`. O gatilho `trigger_increment_leads` incrementa `fachadas.total_leads`.

---

## 3. Frente F: front

### 3.1 `src/lib/api/fachadas.ts` (novo)

Segue o molde de `src/lib/api/crm.ts` e `rotina.ts`: tipos crus (`Record<string, unknown>`), `lerJson`/`corpoJson`/`escolher` de `./http`, listas de chaves que espelham os DTOs (chave fora delas dá 400, então o front só manda as aceitas).

As rotas autenticadas usam `chamarApi` de `@/lib/api`. **As três públicas não podem**: `chamarApi` exige sessão do Supabase e lança "Sua sessão expirou" quando não há — e na landing nunca há. Como `src/lib/api.ts` não é editável nesta onda, `fachadas.ts` tem seu próprio acesso público, lendo a mesma variável:

```ts
const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');
/** Chamada SEM sessão (landing do QR Code). Mesma base de src/lib/api.ts, sem Authorization. */
async function chamarApiPublica(caminho: string, init: RequestInit = {}): Promise<Response> {
  if (!API_URL) throw new Error('API Lotti indisponível no momento.');
  return fetch(`${API_URL}${caminho}`, init);
}
```

Duas linhas duplicadas de propósito, em vez de editar `src/lib/api.ts`, que é de outra frente (§7.1.2). `apiDisponivel()` continua vindo de `@/lib/api` — **a mesma variável decide os dois caminhos**, então não existe estado em que a landing use a API e o painel não, ou o contrário.

Chaves exportadas (espelham os DTOs de §1.3 e §1.5):

```ts
export const CHAVES_CRIAR_FACHADA = ['imovel_id','tipo_negocio','template_id','cta_principal','modo_conversao',
  'mensagem_whatsapp','mensagem_contato','logo_url','foto_principal_url','ativo'] as const;
export const CHAVES_EDITAR_FACHADA = ['tipo_negocio','template_id','cta_principal','modo_conversao',
  'mensagem_whatsapp','mensagem_contato','logo_url','foto_principal_url','ativo'] as const;
export const CHAVES_CRIAR_TEMPLATE = ['nome','categoria','config','padrao'] as const;
```

`CHAVES_EDITAR_FACHADA` **não** tem `imovel_id` (§1.3) e nenhuma das duas tem `id`, `corretor_id`, `total_escaneamentos`, `total_leads` ou `created_at`. `updateFachada` recebe `Partial<Fachada>` e passa por `escolher(dados, CHAVES_EDITAR_FACHADA)`, então uma linha inteira vinda do estado não leva 400 — o `escolher` descarta o que a rota não aceita.

Funções (todas com erro por `lerJson`, que lança `ErroApi` com o `message` em português da API):

| Função | Rota |
|---|---|
| `listarFachadasApi()` | F1 |
| `criarFachadaApi(dados)` | F2 |
| `editarFachadaApi(id, dados)` | F3 |
| `excluirFachadaApi(id)` | F4 |
| `listarLeadsApi(fachadaId?)` | F5 |
| `excluirLeadApi(id)` | F6 |
| `obterMetricasApi(dias)` | F7 |
| `listarTemplatesApi(escopo?)` | F8 |
| `criarTemplateApi(dados)` | F9 |
| `excluirTemplateApi(id)` | F10 |
| `obterTemplatePorImagemApi(imagemUrl)` | F11 — devolve `Linha \| null` |
| `obterMidiasImovelApi(imovelId)` | F12 |
| `obterFachadaPublicaApi(fachadaId)` | P1 — `chamarApiPublica` |
| `registrarEscaneamentoApi(fachadaId)` | P2 — `chamarApiPublica`, `POST` sem corpo |
| `enviarLeadPublicoApi(fachadaId, dados)` | P3 — `chamarApiPublica` |

Todo id entra por `encodeURIComponent`, e `imagem_url`, `fachada_id`, `dias` e `escopo` por `URLSearchParams`.

### 3.2 Onde cada tela troca a chamada

Todas as trocas seguem o §4 do módulo 2: **ramo novo atrás de `apiDisponivel()`, ramo antigo intacto**. Sem `VITE_API_URL`, nada muda em lugar nenhum — e o teste de §4.3.9 prova isso tela por tela.

| Arquivo | Hoje | Passa a |
|---|---|---|
| `src/hooks/useFachadas.ts` `fetchFachadas` | `from('fachadas').select('*, imovel:…, corretor:…').order('created_at')` | `apiDisponivel() ? listarFachadasApi() : <igual>`; o `map` que troca `null` por `undefined` continua valendo para os dois ramos |
| `useFachadas.createFachada` | `rpc('get_corretor_id')` + até duas consultas a `imovel_fotos` + `insert(...).select().single()` | `criarFachadaApi(escolher(data, CHAVES_CRIAR_FACHADA))`. **As três consultas somem**: corretor e foto principal passam a ser resolvidos pela rota (§1.3). Devolve `row.id` igual. O `toast` e o `await fetchFachadas()` ficam |
| `useFachadas.updateFachada` | `update(data).eq('id', id)` | `editarFachadaApi(id, escolher(data, CHAVES_EDITAR_FACHADA))` |
| `useFachadas.deleteFachada` | `delete().eq('id', id)` | `excluirFachadaApi(id)` |
| `useFachadas.fetchLeads` | `from('fachada_leads').select('*')` (+ `eq` opcional) | `listarLeadsApi(fachadaId)`; o `leadsRequestId` (guarda contra resposta fora de ordem) continua igual |
| `useFachadas.deleteLead` | `delete().eq('id', id)` | `excluirLeadApi(id)`; segue tirando o lead do estado local |
| `useFachadas.fetchMetricas` | 3 consultas + agregação no navegador (`porDia`, `taxaConversao`) | `obterMetricasApi(periodoDias)` e `setMetricas(resposta)` direto — a resposta **já é** `FachadaMetricas` (§1.4). O ramo antigo mantém a agregação como está |
| `src/hooks/useFachadaPublica.ts` `fetchFachadaPublica` | `functions.invoke('fachada-publica', { body: { fachadaId } })` | `apiDisponivel() ? obterFachadaPublicaApi(fachadaId) : <invoke igual>`. O `{ fachada, fotos }` tem o mesmo formato nos dois ramos, então o `setFachada`/`setFotos` não muda |
| `useFachadaPublica.registrarEscaneamento` | `from('fachada_escaneamentos').insert({ fachada_id, user_agent: navigator.userAgent })` | `registrarEscaneamentoApi(fachadaId)` — sem `navigator.userAgent` (vai no cabeçalho, §2.2). O `catch` silencioso com `console.warn` **fica** |
| `useFachadaPublica.enviarLead` | `from('fachada_leads').insert({ fachada_id, ...dados })` | `enviarLeadPublicoApi(fachadaId, dados)`; segue `setLeadCapturado(true)` no sucesso e `return false` no erro. `email` vazio não é enviado (`dados.email \|\| undefined`), §2.3 |
| `src/pages/FachadaPublica.tsx` | só usa o hook (`fetchFachadaPublica`, `registrarEscaneamento`, `enviarLead`, `fotos`) | **nada muda** além do que vier do hook. Entra na lista da frente F só para o teste de fumaça da landing; se o diff ficar vazio, está certo |
| `src/pages/FachadasInteligentes.tsx` `fetchCustomTemplates` | `rpc('get_corretor_id')` + `from('fachada_templates').select('*').eq('corretor_id', …)` | `listarTemplatesApi('meus')`; o `map` para `CustomTemplate` (`config.imagem_url`, `qrPosition`, `qrSize`) continua igual. O `catch` que ignora "tabela pode não existir" fica |
| `FachadasInteligentes.handleSaveCustomTemplate` | `rpc('get_corretor_id')` (antes do upload) + `insert(...).select('id, created_at').single()` | o upload **não muda** (continua `fachadas/<corretor_id>/<arquivo>` no Storage, e por isso a chamada de `get_corretor_id` **continua existindo aqui**: o caminho do Storage precisa dela e a policy de Storage escopa por ela). Só o insert vira `criarTemplateApi({ nome, categoria: 'VENDA', padrao: false, config })`, e `salvo.id`/`salvo.created_at` saem da resposta. O erro continua **não** sendo engolido |
| `FachadasInteligentes.handleDeleteCustomTemplate` | `delete().eq('id', template.id)` | `excluirTemplateApi(id)`; a guarda `!id.startsWith('local-')` fica |
| `src/components/fachadas/CriarFachadaDialog.tsx` | `rpc('get_corretor_id')` (antes do upload) + `insert` em `fachada_templates` dentro de `try/catch` tolerante | mesma coisa: `get_corretor_id` fica (caminho do Storage), o insert vira `criarTemplateApi({ nome, categoria: tipoNegocio, padrao: false, config })`, e o `catch` tolerante **fica** — a fachada funciona pela arte em `finalTemplateId` mesmo sem o template salvo na biblioteca |
| `src/components/fachadas/FachadaCard.tsx` | 1 consulta de foto + 2 `count: 'exact', head: true` | `obterMidiasImovelApi(fachada.imovel_id)`: `setFotoPrincipal(r.foto_principal_url ?? <cache>)` e `setMediaCounts({ fotos: r.fotos, videos: r.videos })`. Três idas viram uma |
| `src/components/fachadas/FachadaPreview.tsx` | até 2 consultas a `imovel_fotos` + 1 a `fachada_templates` por `config->>imagem_url` | `obterMidiasImovelApi(imovelId)` para a foto e `obterTemplatePorImagemApi(fachada.template_id)` para `qrPosition`/`qrSize`. O `catch` que cai na posição padrão do QR fica, e a flag `ativo`/cleanup do `useEffect` continua igual |

**O que o front deixa de fazer e por quê:** as cinco chamadas a `rpc('get_corretor_id')` de hoje viram duas. As três que existiam só para montar uma consulta (`fetchCustomTemplates`, `createFachada`, e a do insert de template em `FachadasInteligentes`) somem, porque a rota resolve o corretor no servidor; as duas que montam **caminho de Storage** (`handleSaveCustomTemplate`, `CriarFachadaDialog`) ficam, porque o upload continua indo direto para o Supabase nesta onda e a policy de Storage escopa por `fachadas/<corretor_id>/`. Tirar essas duas é tarefa da etapa do R2 (§7.1.4).

**Nada no front muda o id nem o caminho do QR.** `src/lib/publicBaseUrl.ts` não é editado, `getFachadaPublicUrl` continua montando `<base>/p/<id>`, `QRCodeGenerator` e `fachadaExport` continuam usando essa URL, e a rota `/p/:fachadaId` de `src/App.tsx` não é tocada.

---

## 4. Testes obrigatórios

### 4.1 Frente A — Jest de texto (`*.spec.ts`, um por controller e por service)

Os testes de service usam um `TenantDb`/`PrismaService` falso que **guarda o objeto `Prisma.Sql` recebido** e leem `.text` e `.values` (nunca `.sql`, onde os parâmetros aparecem como `?`). Fixtures de uuid em v4 (módulo 2 §0.5).

Cobertura mínima:

1. **Caminho feliz, por rota:** `.text` tem as cláusulas esperadas e `.values` os parâmetros na ordem.
2. **Casts (§0.2):** `.text` casa `\$1::uuid`, `::text`, `::int`, `::boolean`, `::jsonb` onde a §1 manda. Um teste varre **todas** as consultas do módulo e falha se algum `$n` aparecer sem cast.
3. **`LIMITE_LISTA`:** F1, F5 e F8 têm `limit $n::int` e `1000` em `.values` — nunca `limit 1000` escrito no texto.
4. **Ordenação:** toda lista desempata por `id` em `.text`.
5. **`presentes()`/`jsonb_populate_record`:** F2 e F3 só põem no `${alvo}` as colunas presentes no DTO; chave `undefined` não entra; `null` entra e grava NULL; F3 com corpo vazio → 400 `nada_para_atualizar`.
6. **`corretor_id` nunca vem do cliente:** um teste por DTO de escrita prova que `corretor_id`, `id`, `total_escaneamentos`, `total_leads` e `created_at` levam 400 pelo `forbidNonWhitelisted`, e que o SQL de F2 pega o corretor de `get_corretor_id()`.
7. **Tradutor (§0.4):** um caso por linha da tabela, montando o `PrismaClientKnownRequestError` P2010 com o `meta.code`/`meta.message` de cada um — inclusive o prefixo `ERRO:` (servidor em português) e a linha `DETAIL:`. Prova a **ordem**: `PLAN_LIMIT_REACHED` antes dos outros P0001, `id_imutavel` antes do 23514 genérico, 42501 público → 404 e autenticado → 403.
8. **DTOs:** `plainToInstance` + `validateSync` com `{ whitelist: true, forbidNonWhitelisted: true }`; toda mensagem de erro é em português (um teste varre os `constraints` de todos os DTOs e falha se achar texto em inglês); `FORMATO_UUID` aceita `'11111111-1111-1111-1111-111111111111'` (paridade com o `ParseUUIDPipe` da URL) e recusa `'nao-e-uuid'`; `IsUUID` não aparece em nenhum DTO (varredura dos arquivos).
9. **Rotas públicas sem guarda:** `Reflect.getMetadata('__guards__', FachadasPublicoController)` é vazio e os três métodos também; os cinco controllers autenticados têm `SupabaseAuthGuard`. Nenhum método público recebe `@Claims()`.
10. **`normalizarTelefone` + `TELEFONE_VALIDO`** (§2.3): tabela de casos — `'(11) 99999-8888'` passa; `'+55 11 99999-8888'` passa (tira o 55 de 13 dígitos); `'5511999998888'` passa; `'011999998888'` recusa (12 dígitos sem 55, começa com 0); `'1199999888'` passa (10 dígitos); `'119999988'` recusa; `'0'.repeat(10)` recusa.
11. **Ordem dos caminhos** (§1.1): `FachadasController` é o último do array `controllers`; `templates/por-imagem` é declarada antes de `templates/:id`; um teste de e2e leve prova que `GET /api/fachadas/leads` chega no `FachadasLeadsController`, não no `:id`.
12. **Allowlist pública (§2.1):** um teste lê o `.text` de P1 e compara a lista de chaves de `jsonb_build_object` com a constante esperada, **caractere a caractere**. Ele falha se alguém acrescentar coluna — é a trava que protege a promessa da abertura. Outro teste prova que `mensagem_contato`, `total_escaneamentos`, `total_leads`, `proprietario_cpf`, `proprietario_nome`, `proprietario_telefone` e `proprietario_email` **não aparecem** no SQL de nenhuma rota pública.
13. **Nenhum `Unsafe` fora da exceção (§0.2):** varredura de `api/src/fachadas/**` — `$queryRawUnsafe` não aparece em lugar nenhum e `$executeRawUnsafe` aparece uma vez só, em `publico/fachadas-publico.repo.ts`, com a string constante `'set local role anon'`.
14. **P2 não lê o corpo:** o controller de P2 não tem `@Body()`; o `user_agent` vem de `@Headers('user-agent')` e um cabeçalho ausente manda `null`.

### 4.2 Frente A — SQL real (`api/test/sql-real/fachadas.test.ts`)

Usa `criarBanco()` do harness (`api/test/sql-real/harness.ts`): PGlite com **todas** as migrations, RLS ligado, gatilhos de verdade, contas A e B criadas pelo gatilho de `auth.users`, e o `TenantDb` de produção. Molde: `api/test/sql-real/rotina.test.ts` (`dto()` com `plainToInstance` + `validateSync`, `capturarErroHttp`, `falha(promessa, status, codigo)`, `banco.inserir`, `banco.sqlSuperusuario`, `banco.criarConta`).

O `FachadasPublicoRepo` é montado sobre `banco.prisma` (o `PrismaService` falso), que é o caminho de fora da transação do harness — é assim que a frente A testa o `comoAnonimo` com o `set local role anon` de verdade.

Casos obrigatórios:

**Autenticado: caminho feliz, isolamento e travas**

1. A cria imóvel + fachada (F2): o `id` volta em formato uuid, `corretor_id` é o de A, `created_at` casa `TIMESTAMPTZ`, `total_escaneamentos` e `total_leads` vêm 0.
2. F2 sem `foto_principal_url`, com duas fotos no imóvel (uma `principal`): grava a principal. Com nenhuma `principal`: grava a de menor `ordem`. Sem foto: grava `null`.
3. F1 devolve a fachada de A com `imovel` e `corretor` preenchidos e **não** devolve a de B (RLS). `imovel` vem `null` quando o imóvel foi apagado.
4. F3 muda `cta_principal` e `ativo`; F3 na fachada de B → 404 `nao_encontrado`; F3 com corpo vazio → 400 `nada_para_atualizar`.
5. **O id não muda:** um `update ... set id = <outro>` por `sqlSuperusuario` levanta 23514 com a mensagem do gatilho `proteger_id_fachada`, e o tradutor a transforma em 409 `id_imutavel`. Prova que a trava existe e que nenhuma rota do módulo a aciona.
6. F4 apaga a fachada de A e, por cascade, os leads e escaneamentos dela (contados por `sqlSuperusuario` antes e depois); F4 na de B → 404.
7. **Trava de plano:** conta com `max_fachadas` esgotado (plano e entitlement montados por `banco.inserir`) → F2 com `ativo` default levanta `PLAN_LIMIT_REACHED:max_fachadas` → 402 com `recurso: 'max_fachadas'`. F3 reativando (`ativo: false` → `true`) acima da cota → o mesmo 402. F3 com `ativo: false` acima da cota → passa (o gatilho só checa quando a linha vai ficar ativa).
8. F5 devolve os leads de A, mais novo primeiro, e nenhum de B; com `fachada_id` filtra; sem `fachada_id` traz todos. F6 apaga e decrementa `total_leads`; F6 no lead de B → 404 `lead_nao_encontrado`.
9. F7 com 2 leads e 5 escaneamentos dentro da janela e 1 de cada **fora** dela (inseridos com `created_at` antigo por `banco.inserir`): `totalLeads: 2`, `totalEscaneamentos: 5`, `taxaConversao: 40`, `leadsPorDia` agrupado por dia em `YYYY-MM-DD` e em ordem crescente, `totalFachadas` contando só as ativas, `fachadasMaisAcessadas: []`. Eventos de B não entram. `dias` inválido (0, 366, `'abc'`) → 400 do ValidationPipe.
10. F8 `escopo=meus` traz só os de A; `escopo=todos` traz os de A **mais** o padrão com `corretor_id is null`; nenhum de B nos dois casos. F9 grava com o corretor de A e `config` como objeto. F10 apaga o de A, dá 404 no de B e 404 no padrão. F11 acha pelo `config->>imagem_url` e devolve `null` quando não acha.
11. F12 devolve `foto_principal_url` da principal, `fotos` e `videos` contados; imóvel de B → `{ null, 0, 0 }`. A tabela `videos` é garantida pelo preparo descrito em §1.6 (ela falta no baseline), e um `assert` no começo do arquivo registra qual dos dois caminhos foi usado.

**Público — é aqui que a onda se prova**

12. **P1** na fachada ativa de A devolve `fachada` e `fotos` **sem sessão nenhuma** (o repo é chamado direto, sem claims). As chaves de `fachada`, de `fachada.imovel` e de `fachada.corretor` são comparadas com `deepEqual` contra as listas exatas de §2.1 — nem uma a mais. `fotos` em ordem de `ordem`, e `[]` quando não há foto.
13. **P1 não vaza:** uma coluna nova em `public.fachadas` (criada no teste por `sqlSuperusuario` com `alter table ... add column`, e removida no fim) **não aparece** na resposta. É o que um `select *` ou um `to_jsonb(f)` quebraria — e o motivo de a §2.1 ser escrita coluna por coluna.
14. **P1** em fachada `ativo = false` → 404 `fachada_indisponivel`; em id inexistente → o mesmo 404; nenhum dos dois diz qual é o caso.
15. **P2** insere o escaneamento **como `anon`** e incrementa `total_escaneamentos`. `ip_hash` fica `null`. `user_agent` de 600 caracteres é gravado com 500. `created_at` é do servidor.
16. **P2 em fachada inativa** → 404 `fachada_indisponivel` (a policy e o gatilho, nesta ordem).
17. **P2 limite:** 120 escaneamentos na mesma fachada passam; o 121º no mesmo minuto → 429 `muitas_tentativas`. Prova que `consume_public_request_limit('qr-scan-fachada', ...)` **continua valendo** pelo caminho novo — a promessa de "mesmo limite de uso".
18. **P3** grava o lead como `anon`, incrementa `total_leads`, e a linha gravada (lida por `sqlSuperusuario`) tem `convertido = false`, `cliente_id = null` e `telefone` **exatamente como digitado** (`'(11) 99999-8888'`).
19. **P3 não forja:** o `ValidationPipe` recusa com 400 um corpo com `convertido: true`, `cliente_id: <uuid>`, `created_at: <data>` ou `ip_hash: 'x'` (quatro casos). E, mesmo que passassem, um insert dessas colunas como `anon` é zerado pelo gatilho — provado por um insert direto via `comoAnonimo` no teste.
20. **P3 limite por telefone:** 5 leads com o mesmo telefone passam; o 6º em 10 minutos → 429 `muitas_tentativas`. Um telefone **diferente** passa na sequência (prova que o escopo é o hash do telefone normalizado, não global). E `'(11) 99999-8888'` e `'+55 11 99999-8888'` caem no **mesmo** balde (o gatilho normaliza antes do sha256).
21. **P3 em fachada inativa** → 404 `fachada_indisponivel`.
22. **DTO e gatilho concordam nos dois sentidos** (§0.3): para cada caso de fronteira (`nome` com 1 caractere, com 121, só espaços; `telefone` com 33 caracteres, `'011999998888'`, `'abc'`; `email` com 255 caracteres, `'sem-arroba'`), o DTO recusa **e** o insert como `anon` levanta a exceção do gatilho. Nenhum caso em que um aceita e o outro recusa — fora o `email: ''`, que é a divergência declarada em §2.3 e tem teste próprio.
23. **Nenhum atalho pelo caminho do usuário:** `TenantDb.run` com claims de `anon` (`role: 'anon'`) **lança** `claims_invalidas`, o que prova que as rotas públicas não poderiam usá-lo nem por engano.
24. **Contador de transação abortada:** `banco.transacoes.commitsAbortados` é 0 no fim de toda a suíte. É a trava do módulo 2 §0.2 contra erro de banco engolido dentro de um `run`.

### 4.3 Frente F — Vitest

`src/lib/api/fachadas.test.ts`:

1. Cada uma das 15 funções: caminho, método, cabeçalhos e corpo (`fetch` falso), com id por `encodeURIComponent` e query por `URLSearchParams`.
2. **As três públicas não mandam `Authorization`** e não chamam `supabase.auth.getSession()` (o módulo do Supabase é mockado e o teste prova zero chamadas).
3. `escolher` com `CHAVES_EDITAR_FACHADA`: uma `Fachada` inteira vinda do estado vira corpo só com as chaves aceitas — sem `id`, `corretor_id`, `imovel_id`, `total_*` nem `created_at`.
4. Erro: 404 → `ErroApi` com `codigo` e `message` da API; 402 `PLAN_LIMIT_REACHED` chega com `codigo` legível; 429 `muitas_tentativas` idem; 500 → texto padrão da função (o `lerErroApi` esvazia o texto em 5xx).
5. F11 com corpo `null` devolve `null` sem lançar.
6. Sem `VITE_API_URL`, `chamarApiPublica` lança "API Lotti indisponível no momento." e nenhum `fetch` acontece.

Testes de tela (um `.api.test.tsx` por hook, no molde de `src/hooks/useFinanceiro.api.test.tsx` e `useDocumentos.api.test.ts`):

7. `useFachadas.api.test.tsx`: com `apiDisponivel()` true, cada função do hook chama a função da API e **nenhuma** chamada ao Supabase acontece (`supabase.from`/`rpc` mockados com zero chamadas); `fetchMetricas` põe no estado exatamente o objeto que a API devolveu; `createFachada` devolve o `id` e refaz a lista; erro mostra o `toast` com o `message` da API.
8. `useFachadaPublica.api.test.tsx`: `fetchFachadaPublica` usa P1 e **não** `functions.invoke`; `registrarEscaneamento` falha em silêncio (o estado não muda, nada lança); `enviarLead` devolve `true`/`false` e seta `leadCapturado`; `email: ''` não vai no corpo.
9. **O teste que fecha a onda:** com `VITE_API_URL` **ausente**, todos os hooks e as três telas voltam a chamar o Supabase exatamente como antes — `from('fachadas')`, `functions.invoke('fachada-publica')`, `rpc('get_corretor_id')`, `from('fachada_escaneamentos')`, `from('fachada_leads')`, `from('fachada_templates')`, `from('imovel_fotos')`, `from('videos')` — e nenhuma chamada à API acontece. É a garantia de "sem `VITE_API_URL` o front se comporta exatamente como hoje", verificada por tela, não por afirmação.
10. `FachadaCard` e `FachadaPreview`: com a API ligada, uma chamada a `obterMidiasImovelApi` no lugar das três consultas; a foto principal cai no cache `fachada.foto_principal_url` quando a resposta vem `null`; `FachadaPreview` pede `obterTemplatePorImagemApi` só quando `template_id` começa com `http`.
11. `FachadasInteligentes` e `CriarFachadaDialog`: o upload para o Storage e a chamada a `rpc('get_corretor_id')` que monta o caminho **continuam acontecendo nos dois ramos**; só o insert do template troca. O `catch` tolerante do `CriarFachadaDialog` segue criando a fachada quando o template falha.

---

## 5. Integração (quem liga o módulo)

Fora das duas frentes, como nas ondas anteriores: `api/src/app.module.ts` passa a importar `FachadasModule`. Nenhuma outra mudança — sem variável nova (§0.5), sem migration (§7.2), sem mexer no `main.ts`.

Fumaça depois de ligado, com `VITE_API_URL` apontando para a API: criar fachada, abrir `/p/<id>` **no celular, pelo QR impresso de uma placa já existente**, ver a landing com foto e contato, mandar um lead, e achar esse lead na aba Leads do painel. O id da placa antiga tem de funcionar — é o teste que nenhum `.test.ts` substitui.

---

## 6. Decisões que mudam comportamento

Cada uma está justificada no corpo do contrato; esta é a lista fechada do que **não** é idêntico a hoje.

1. **CORS deixa de ser `*`** nas rotas públicas: a Edge Function respondia a qualquer origem, a API responde às de `CORS_ORIGINS`. A landing é servida pelo próprio domínio do app, então nada quebra — mas um embed da landing em outro domínio pararia. Ação de infra em §7.3.
2. **Método não previsto dá 404, não 405.** O Nest não tem o `405` explícito da função. Nenhum cliente nosso manda outro método.
3. **Uma porta para o id, não quatro.** `?id=`, `?fachadaId=`, corpo `{ id }` e corpo `{ fachadaId }` viram o id no caminho.
4. **`user_agent` vem do cabeçalho**, não do corpo. Mesma informação, por um canal que o visitante não escolhe.
5. **`email: ''` é recusado com 400** em P3, onde o gatilho aceitava. O front já não manda campo vazio.
6. **Fotos (P1) e foto principal (F2, F12) desempatam por `id`.** Sem isso, fotos com a mesma `ordem` trocavam de lugar entre requisições e a galeria da landing embaralhava.
7. **F12 unifica as duas regras de "foto principal"** (`FachadaCard` usava `principal desc, ordem asc`; `FachadaPreview` usava `principal = true` e depois a primeira por `ordem`). A resposta é a mesma em todo caso real; as duas telas passam a concordar por construção.
8. **As métricas são calculadas no servidor**, com a janela a partir do `now()` do banco (era o relógio do navegador) e **sem o corte de 1000 linhas** que o PostgREST aplicava silenciosamente — contas com mais de 1000 leads ou escaneamentos no período passam a ver o número certo. É correção de defeito, não mudança de intenção, e o número exibido pode subir.
9. **Três chamadas a `rpc('get_corretor_id')` somem** do front (as que só montavam consulta). As duas que montam caminho de Storage ficam.
10. **Erro com texto próprio em vez do `err.message` do PostgREST.** `createFachada` mostrava a mensagem crua do banco no `toast`; agora mostra a da §0.4 — em especial o 402 de limite de plano e o 429 de "muitas tentativas".
11. **F3 não aceita `imovel_id`.** Trocar o imóvel de uma placa já impressa mudaria o que o QR mostra sem mudar o QR.
12. **`mensagem_whatsapp` ganha `@MaxLength(600)`**, que o banco não exige. Escolha nossa, pelo mesmo motivo do check de `mensagem_contato`.
13. **A chave de serviço sai do caminho público.** `SUPABASE_SERVICE_ROLE_KEY` não é lida por nenhuma rota deste módulo; a leitura pública se protege por allowlist de colunas e `ativo = true`.

E o que **não** muda, de propósito: o `delete` no botão "desativar" (continua apagando); `fachadasMaisAcessadas` vazio; o erro de escaneamento silencioso; o `catch` tolerante do template avulso; o telefone gravado como digitado; as fotos no Storage do Supabase; o id e o caminho `/p/<id>`.

---

## 7. Pendências

### 7.1 Dívidas registradas (nenhuma ação nesta onda)

1. **`fachadasMaisAcessadas` continua `[]`.** Dá para preencher com um `order by total_escaneamentos desc limit 5` em F7, mas isso muda uma tela que ninguém pediu nesta onda. Fica para a onda do dashboard.
2. **`chamarApiPublica` duplica `chamarApi`.** Quando `src/lib/api.ts` estiver editável, o certo é exportar de lá uma `chamarApiPublica` única e `fachadas.ts` consumi-la.
3. **F12 lê `imovel_fotos` e `videos`, que são do assunto imóveis.** Se o módulo imóveis ganhar uma rota de mídias, F12 fica redundante e sai.
4. **`get_corretor_id` no front, duas vezes.** Sai junto com a migração do Storage para o R2, quando o caminho do objeto deixar de ser escopado por `fachadas/<corretor_id>/` no cliente.
5. **`foto_principal_url` em `fachadas` é cache de `imovel_fotos`** e pode ficar velho (as telas já resolvem ao vivo por isso). Candidata a coluna gerada, ou a simplesmente sair, na etapa do R2.
6. **`total_escaneamentos` e `total_leads` são contadores mantidos por gatilho** e podem divergir do `count(*)` depois de um delete fora dos gatilhos. Uma rotina de reconciliação resolveria.
7. **O botão "desativar" apaga.** `onDeactivate={deleteFachada}` destrói a placa e, por cascade, todos os leads dela. O conserto é trocar por `PATCH { ativo: false }` — mas é mudança de produto, não de migração.
8. **`traduzirErroBanco` está repetido** em imóveis, clientes, funil, contratos, financeiro, rotina e agora fachadas. Juntar num arquivo só segue pendente desde o módulo 2.
9. **O limite de uso público é por fachada e global, nunca por IP.** Um visitante só pode esgotar os 120 scans/min de uma fachada. Limite por IP exigiria `ip_hash` confiável, que depende do proxy do Railway (`X-Forwarded-For`) — ver §7.2.2.

### 7.2 Migrations propostas (SQL escrito, **nada aplicado**)

**7.2.1 — `mensagem_whatsapp` sem limite de tamanho.** `mensagem_contato` tem check de 600, `mensagem_whatsapp` não tem nenhum. Hoje só o DTO segura (§1.3), e o banco aceitaria um texto de qualquer tamanho vindo de outro caminho.

```sql
-- proposta; NÃO aplicada
alter table public.fachadas
  add constraint fachadas_mensagem_whatsapp_tamanho
  check (mensagem_whatsapp is null or char_length(mensagem_whatsapp) <= 600) not valid;
-- depois de conferir as linhas existentes:
--   select count(*) from public.fachadas where char_length(mensagem_whatsapp) > 600;
-- alter table public.fachadas validate constraint fachadas_mensagem_whatsapp_tamanho;
```

`not valid` porque pode haver linha antiga maior; a validação vem depois da contagem.

**7.2.2 — `ip_hash` de verdade no escaneamento.** A coluna existe e é sempre `null` (o gatilho a zera, e com razão: hoje é o visitante que a mandaria). Com a API no meio, o servidor passa a conhecer o IP de origem e poderia preenchê-la, o que habilitaria limite por IP (§7.1.9) e métrica de visitante único.

```sql
-- proposta; NÃO aplicada. Precisa ANTES: confirmar o X-Forwarded-For do proxy do Railway
-- e definir onde fica o sal (variável do servidor, nunca no banco).
create or replace function public.guard_public_fachada_insert() returns trigger
language plpgsql security definer set search_path to '' as $$
-- ... igual à versão atual, trocando `NEW.ip_hash := NULL;` por:
--   IF current_setting('role',true) = 'anon' THEN NEW.ip_hash := NULL; END IF;
-- (o dono do banco passa a poder gravar um hash que ELE calculou; anon continua sem poder)
$$;
```

Sem decidir sal e proxy, isto é um buraco de privacidade, não uma melhoria. Fica descrito e parado.

**7.2.3 — `public.videos` falta no baseline do Prisma.** O achado de §1.6: a tabela existe em produção (`supabase/migrations/20260115123324_*.sql`) e não existe em `api/prisma/migrations/0_init/migration.sql`. Não é problema só de fachadas — é uma divergência entre o baseline e o banco real, e ela morde qualquer módulo futuro que toque `videos`, além de todo teste de SQL real.

```sql
-- proposta; NÃO aplicada. O certo é regerar o baseline a partir do banco real
-- (como o 0_init foi gerado) em vez de escrever esta tabela à mão. O SQL abaixo é
-- o conteúdo esperado, copiado da migration de origem, só para dimensionar a correção:
create type public.tipo_video as enum ('TOUR_VIRTUAL','APRESENTACAO','DEPOIMENTO','DRONE','INSTITUCIONAL','OUTRO');
create table public.videos (
  id uuid not null default gen_random_uuid() primary key,
  corretor_id uuid not null references public.corretores(id) on delete cascade,
  imovel_id uuid references public.imoveis(id) on delete set null,
  titulo text not null, descricao text, video_url text not null, video_path text not null,
  thumbnail_url text, duracao_segundos integer,
  tipo public.tipo_video not null default 'OUTRO',
  visualizacoes integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.videos enable row level security;
create policy "Corretor gerencia seus videos" on public.videos for all
  using (corretor_id = public.get_corretor_id());
-- (conferir também os grants de anon/authenticated/service_role e o gatilho de updated_at
--  do original antes de considerar a correção completa)
```

**Antes de aplicar qualquer coisa, a pergunta certa é outra:** o que mais falta no baseline? A correção honesta é um diff do schema real contra o `0_init`, não uma tabela por vez. Isto fica registrado como o primeiro item achado, não como a lista completa.

**7.2.4 — Índice para o filtro de métricas.** F7 varre `fachada_leads` e `fachada_escaneamentos` por `created_at >= inicio`. Já existem `idx_fachada_leads_created` e `idx_fachada_escaneamentos_created` em `created_at`, que servem: **nenhum índice novo é proposto.** Esta entrada existe para registrar que a pergunta foi feita e respondida com "não precisa".

### 7.3 Virada (fora do código)

- `CORS_ORIGINS` no Railway tem de conter `https://app.plataformalotti.com.br` (a landing do QR) **antes** de `VITE_API_URL` existir no front — senão a página pública quebra no primeiro visitante, e quem percebe é quem está com o celular na frente da placa.
- `SUPABASE_SERVICE_ROLE_KEY` continua necessária para a Edge Function `fachada-publica`, que fica no ar como caminho antigo. Ela só pode ser revista quando `VITE_API_URL` estiver em produção, a landing estiver medida pela API e a função for desligada — outra etapa.
- Fumaça obrigatória com uma placa **já impressa**, não com um QR gerado na hora (§5).
