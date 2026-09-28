# Planos e limites — SCRUM-17 a SCRUM-20

> **Atualização (2026-09-27, depois do PR #19).** A `main` recebeu as migrations `20260925120000` a `20260925120300`, que foram aplicadas em produção pelo Codex. Elas deixam assinatura, adicionais e contadores somente leitura, tiram `incrementar_uso` do usuário e fazem `checar_cota` valer só para assinatura ativa ou trial vigente. Também passam a contar a troca de status/tipo de contrato e usam os limites do catálogo (250/1.500/ilimitado imóveis). As correções que este documento propunha para SCRUM-17 a SCRUM-19 ficaram cobertas pela `main`, e as migrations de planos desta branch foram retiradas para não desfazer regras mais rígidas. O diagnóstico abaixo descreve o estado **anterior** ao PR #19. SCRUM-20 continua dependendo de consulta ao banco de produção.

Data: 2026-09-27 · Base: branch criada da `main` em `052327d` · Responsável: Claude

Método: leitura das migrations, Edge Functions e telas do repositório, mais testes locais
em PGlite (PostgreSQL em memória). Nenhuma chamada à produção foi feita e nenhum código
de produção foi alterado. O único arquivo novo além deste documento é o teste
`supabase/migrations/planos-cota-servidor.test.ts` (ver SCRUM-19).

> **Atenção sobre o estado de produção.** Os gatilhos de cota e a versão atual de
> `checar_cota` existem apenas em `20260904100000_alinhar_cotas_planos_comerciais.sql`.
> O handoff registra que essa migration **não foi aplicada** (`AI_HANDOFF.md:1631` e
> `:1778`) e que seus valores conflitam com o catálogo publicado. Este documento indica,
> em cada ponto, o que muda com e sem essa migration. A confirmação depende de consulta
> ao banco (SCRUM-20, consulta C1).

---

## SCRUM-17 — Matriz de recursos e limites por plano

### Catálogo (`plans`)

| `code` | Nome atual | Mensal | Anual | `trial_days` | Fonte |
|---|---|---:|---:|---:|---|
| `essencial` | Lotti Inteligente | R$ 279 | R$ 2.790 | 14 | `20260909180000_planos_agente_ia.sql:5-13`; trial em `20260807120000_plans_subscriptions.sql:19,220-225` |
| `profissional` | Lotti Profissional | R$ 399 | R$ 3.990 | 14 | idem |
| `imobiliaria` | Lotti Eficazes | R$ 799 | R$ 7.990 | 14 | idem |

O `code` não mudou quando os nomes comerciais mudaram. `Essencial` e `Imobiliária` nas
telas e no código são, respectivamente, Inteligente e Eficazes.

### Cotas numéricas (`plan_entitlements`)

Coluna **A**: valores do catálogo vigente, ou seja, `planos_v2` com a correção de leads
de 09-09. São os mesmos números exibidos nos cards (`src/data/plansData.ts:123-129`,
fixados em `src/data/plansData.test.ts:11-19`). Coluna **B**: valores que passam a valer
se `20260904100000` for aplicada (`:3-26`).

| `feature_key` | A: Inteligente / Profissional / Eficazes | B: com 20260904100000 | Como o uso é medido | Fonte A |
|---|---|---|---|---|
| `leads_qualificados_monthly` | 100 / 250 / 600 | igual | `usage_counters`, 1 por telefone por mês no fuso de São Paulo (`20260912125137_lotti_agent_runtime.sql:126,153-164`) | `20260909180000:15-23` |
| `ai_assistant_monthly` | 60 / 200 / 500 | igual | `usage_counters` no mês UTC | `20260820100000_planos_v2.sql:60` |
| `ai_contracts_monthly` | 10 / 25 / 40 | 10 / 20 / 60 | `usage_counters` no mês UTC (geração e análise de contrato) | `planos_v2:61` |
| `max_imoveis` | 250 / 1.500 / ilimitado | 5 / 20 / 100 | A: `usage_counters`, que nunca é incrementado para esta chave. B: `COUNT` de `imoveis.ativo` (`20260904100000:85-87`) | `planos_v2:66` |
| `max_fachadas` | 15 / 60 / ilimitado | 5 / 20 / 100 | A: idem (sempre 0). B: `COUNT` de `fachadas.ativo` (`:92-94`) | `planos_v2:67` |
| `max_contratos_locacao` | 5 / 30 / ilimitado | 5 / 15 / 100 | A: idem (sempre 0). B: `COUNT` de `LOCACAO_RESIDENCIAL` com status `ATIVO` (`:88-91`) | `planos_v2:64` |
| `max_users` | 1 / 3 / 10 | igual | não é medido | `planos_v2:63` |
| `storage_gb` | 3 / 15 / 50 | igual | não é medido | `planos_v2:62` |

### Recursos booleanos (`planos_v2:71-84`)

| `feature_key` | Inteligente | Profissional | Eficazes |
|---|:-:|:-:|:-:|
| `rental_management`, `asaas_integration`, `full_financial` | sim | sim | sim |
| `ai_contract_analysis`, `contract_export`, `advanced_reports`, `automations`, `fachadas_analytics`, `priority_support` | não | sim | sim |
| `team_management`, `team_analytics`, `guided_onboarding` | não | não | sim |

### Adicionais e status que dão direito ao plano

- Adicionais somados por `checar_cota` (`20260904100000:104-114`; o front usa a mesma
  tabela em `src/hooks/useSubscription.ts:246-257`): `extra_user` +1 em `max_users`,
  `extra_fachadas_25` +25 em `max_fachadas`, `extra_ai_100` +100 em
  `ai_contracts_monthly` e `extra_storage_50` +50 em `storage_gb`.
- Status que dão direito ao plano em `checar_cota` e na interface: `trialing`,
  `active`, `past_due` e `read_only` (`20260904100000:54-58`;
  `useSubscription.ts:67`). O agente de WhatsApp aceita somente `active` e `trialing`, e
  apenas até `trial_ends_at`/`current_period_end` (`20260912125137:143-146`).

### Guardas por recurso: interface × servidor

| Recurso | Guarda na interface | Verificação no servidor |
|---|---|---|
| `max_imoveis` | `LimitGuard` em `src/pages/Imoveis.tsx:159,219`; `NovoImovelDialog.tsx:138`; `AutoContractDialog.tsx:147`. **Sem guarda:** `SeletorImovel.tsx:79-93` e `AnalisarContratoDialog.tsx:228-241` | Gatilho `imoveis_limite_plano` (`20260904100000:173-175`), **somente se a migration for aplicada**. Cobre também `ai-action` `create_property` (`ai-action/index.ts:93-107`) e o onboarding (`20260821130000:763-777`) |
| `max_fachadas` | `FachadasInteligentes.tsx:276,349`; `CriarFachadaDialog.tsx:144` | Gatilho `fachadas_limite_plano` (`:177-179`), com a mesma ressalva |
| `max_contratos_locacao` | `ContractsList.tsx:168`; `NewContractDialog.tsx:231`; `AutoContractDialog.tsx:144` | Gatilho `contratos_limite_plano` (`:181-183`), com a mesma ressalva e com as lacunas G5 |
| `ai_contracts_monthly` | `LimitGuard` apenas em "Gerar contrato com IA" (`src/pages/Juridico.tsx:319`). A análise (`contractExtractionService.ts:93,251`) não tem guarda | `gerar-contrato/index.ts:100-107,294`; `analisar-contrato/index.ts:328-335,391` |
| `ai_assistant_monthly` | nenhuma | `ai-assistant/index.ts:111-119,626-627,911`; `inbox-suggest/index.ts:27-29,38` |
| `leads_qualificados_monthly` | somente exibição (`useSubscription.ts:362`) | `lotti_agent_claim` (`20260912125137:140-165`, `service_role`). `lead-capture` apenas consulta e não debita (`lead-capture/handler.ts:189-196`) |
| `max_users`, `storage_gb`, todos os booleanos | nenhuma. As chaves existem só em tipos (`src/types/subscription.ts:55-72`) | nenhuma |

A interface não trata a resposta `402 PLAN_LIMIT_REACHED` das Edge Functions: não há
ocorrência de `402` nem de `PLAN_LIMIT` em `src/`. O plano previa convertê-la em
`UpgradePrompt` (`docs/superpowers/plans/2026-09-04-planos-limites.md`, Task 5).

### Inconsistências da matriz

1. **Cards × migration 20260904100000.** Os cards e seu teste mantêm 250/1.500/ilimitado
   imóveis, 15/60/ilimitado fachadas e 10/25/40 contratos com IA. Aplicar a migration
   reduziria esses limites para 5/20/100, 5/20/100 e 10/20/60 sem mudar os cards, e
   passaria a bloquear contas que hoje estão dentro do que foi vendido.
2. **`ai_contract_analysis`** está desligado no Inteligente (`planos_v2:75`), mas o card
   e o spec de 09-04 oferecem análise com IA nesse plano. Hoje a flag não é verificada
   em nenhum lugar.
3. **`extra_ai_100`** é descrito como "gerações ou análises de contratos + interações do
   assistente" (`plansData.ts:172-174`), mas só amplia `ai_contracts_monthly`.
4. **`extra_leads_50`** era somado em `planos_v2:225,236` e deixou de ser somado em
   `20260904100000:104-111`. O agente ignora qualquer adicional
   (`20260912125137:143-155`).
5. **Período mensal.** `checar_cota` e `incrementar_uso` usam o mês UTC
   (`20260904100000:100`; `planos_v2:273-274`), o agente usa o mês de São Paulo
   (`20260912125137:126`) e o spec pede o ciclo da assinatura
   (`docs/superpowers/specs/2026-09-04-planos-limites-design.md`, "Arquitetura").
6. **Contratos de locação comercial** com status `ATIVO` geram cobrança como aluguel
   (`20260813180000_fix_search_path_generate_monthly_rent_bills.sql:33`), mas não entram
   em `max_contratos_locacao` (`20260904100000:91,155`). É preciso decidir se devem
   contar.

**Status: Parcial — falta decisão de produto sobre o conjunto oficial de cotas (coluna A
ou B) e sobre os itens 2 a 6, além da confirmação no banco de produção de quais valores
estão gravados (consulta C2).**

---

## SCRUM-18 — Bloqueio de cota no endpoint do servidor

### Inventário de pontos de entrada

| Ponto de entrada | Consome | No servidor? | Evidência |
|---|---|---|---|
| Edge `gerar-contrato` | `ai_contracts_monthly` + IA | Sim, com corrida (G9) | `index.ts:100-107` verifica antes; `:294` registra depois |
| Edge `analisar-contrato` | `ai_contracts_monthly` + IA | Sim, com corrida (G9); não verifica `ai_contract_analysis` (G10) | `index.ts:328-335`, `:391` |
| Edge `ai-assistant` | `ai_assistant_monthly` + IA | Sim, com limite por minuto e corrida (G9) | `index.ts:626-627`, `:911` |
| Edge `inbox-suggest` | `ai_assistant_monthly` + IA | Sim, com limite por minuto e corrida (G9) | `index.ts:27-29`, `:38` |
| Edge `analisar-foto` | IA (Gemini) | **Não** (G8) | só autenticação `index.ts:81-90`; IA em `:106` |
| Edge `analisar-fotos-imovel` | IA (Gemini) | **Não** (G8) | `index.ts:93-104`; IA em `:136` |
| Edge `generate-whatsapp-message` | IA (Gemini) | **Não** (G8) | `index.ts:21-38`; IA em `:67` |
| Edge `routine-command` | IA (Gemini) | **Não** (G8) | `index.ts:44`; IA em `:78` |
| Edge `ai-action` (`create_property`) | `max_imoveis` | Indireto, pelo gatilho, se aplicado; o erro vira `create_property_failed` | `index.ts:93-107` |
| Edge `lead-capture` | leads | Apenas consulta, sem débito (por decisão: captura nunca é bloqueada) | `handler.ts:189-196` |
| RPC `lotti_agent_claim` (runtime WhatsApp) | `leads_qualificados_monthly` | Sim, atômico com trava por conta | `20260912125137:140-165`; `service_role` apenas em `:259-260` |
| n8n `D-qualificacao-gemini` → `crm-upsert-lead`/`crm-buscar-imoveis` | leads + IA no n8n | **Não** (G11) | `infra/n8n-workflows/D-qualificacao-gemini.json` não chama `checar_cota`/`incrementar_uso` |
| Edge `ai-process-file` | armazenamento | **Não**; `storage_gb` não é aplicado em nenhum lugar (G10) | `index.ts:77-82` |
| PostgREST `imoveis`/`fachadas`/`contratos` | `max_*` | Gatilhos com trava consultiva, **se aplicados** (G12); lacunas em contratos (G5) | `20260904100000:127-183` |
| PostgREST `usage_counters` | todas as cotas mensais | **Não, o usuário pode alterar** (G1) | `20260821130000_onboarding_ativacao.sql:286-289` |
| PostgREST `subscriptions` | plano | **Não, o gestor pode alterar** (G2) | `20260821130000:275-285` |
| PostgREST `subscription_addons` | teto | **Não, o gestor pode alterar** (G3) | `20260821130000:295-305` |
| RPC `incrementar_uso` | todas | **Sem verificação de tenant** (G4) | `20260820100000_planos_v2.sql:262-293` |
| RPC `checar_cota` | leitura | Sim, com verificação de tenant (somente na versão 20260904100000) | `20260904100000:48-52` |
| RPC `criar_convite_organizacao`/`aceitar_convite_organizacao` | `max_users` | **Não** (G10) | `20260821130000:647-674`, `:675-718` |

### Lacunas no servidor

- **G1 — Contador de uso gravável pelo próprio usuário.** A policy `usage_own` é
  `FOR ALL TO authenticated` (`20260821130000_onboarding_ativacao.sql:286-289`) e
  nenhuma migration revoga UPDATE ou DELETE. Um `PATCH`/`DELETE` em `usage_counters`
  zera `ai_contracts_monthly`, `ai_assistant_monthly` e `leads_qualificados_monthly`,
  inclusive a franquia do agente, que lê essa tabela (`20260912125137:154`). Há hook
  morto no front que já grava diretamente nessa tabela (`src/hooks/useSubscription.ts:287-335`).
  Os dois testes correspondentes falham.
- **G2 — Troca do próprio plano sem pagamento.** `subscriptions_org_manage` é `FOR ALL`
  para o gestor da organização, e o dono é criado como `proprietario`
  (`20260821130000:275-285,334`). É possível alterar `plan_id`, `status`,
  `trial_ends_at` e `current_period_end`. O teste correspondente falha.
- **G3 — Adicional gratuito.** `addons_org_manage` é `FOR ALL` (`20260821130000:295-305`).
  Inserir `extra_ai_100` amplia o teto em `checar_cota` (`20260904100000:104-114`). O
  teste correspondente falha e mostra o limite passando de 10 para 1.010.
- **G4 — `incrementar_uso` aceita outro corretor.** Tem `GRANT` para `authenticated`
  (`planos_v2:292-293`) e não compara `_corretor_id` com `get_corretor_id()`, ao
  contrário de `checar_cota` (`20260904100000:48-52`). Qualquer usuário consegue esgotar
  a cota de outra conta. O teste correspondente falha.
- **G5 — Furos no gatilho de contratos.** O gatilho dispara só em `UPDATE OF status`
  (`20260904100000:182`) e só verifica quando o status passa a `ATIVO` (`:152-159`).
  Criar `COMPRA_VENDA` como `ATIVO` e depois mudar `tipo` para `LOCACAO_RESIDENCIAL`
  deixa 6 contratos numa cota de 5. O teste correspondente falha. `LOCACAO_COMERCIAL`
  também fica fora da contagem (`:91,155`), o que depende de decisão de produto.
- **G6 — `read_only` com acesso completo.** `checar_cota` trata `read_only` como plano
  com direito (`20260904100000:57`), embora o enum o defina como somente leitura
  (`20260807120000:67`). O teste correspondente falha.
- **G7 — Trial vencido sem efeito nas cotas do plano.** `checar_cota` não considera
  `trial_ends_at` nem `current_period_end` (`20260904100000:54-58`), ao contrário do
  agente (`20260912125137:145-146`). Nenhuma rotina muda o status de `trialing` para
  `expired`: não há cron ou job no repositório. O teste correspondente falha.
- **G8 — IA sem cota e sem limite por minuto.** `analisar-foto` (`index.ts:74-106`),
  `analisar-fotos-imovel` (`:87-136`), `generate-whatsapp-message` (`:12-67`) e
  `routine-command` (`:40-78`) exigem apenas sessão válida. Não existe `feature_key` para
  esses custos, e qualquer conta, inclusive com trial vencido ou sem assinatura, chama o
  provedor sem teto.
- **G9 — Corrida entre verificar e registrar.** As funções de IA verificam a cota, chamam
  o provedor por segundos e só então incrementam: `gerar-contrato:100→294`,
  `analisar-contrato:328→391`, `ai-assistant:627→911`, `inbox-suggest:29→38` e
  `_shared/cotas.ts:95-107`. N requisições simultâneas passam com o mesmo saldo. Os
  gatilhos (`20260904100000:164`) e o agente (`20260912125137:142`) usam trava e não têm
  esse problema.
- **G10 — Cotas e recursos que não são aplicados em lugar nenhum.** `max_users` (convites
  em `20260821130000:647-718`), `storage_gb` (`ai-process-file`, buckets) e todas as
  flags booleanas, como `ai_contract_analysis`, que `analisar-contrato:328` não verifica.
- **G11 — Fluxo legado do n8n.** O workflow `D-qualificacao-gemini` chama o Gemini sem
  consultar nem debitar a franquia de leads. É preciso confirmar se ainda está ativo.
- **G12 — Implantação.** Sem `20260904100000`, a produção não tem bloqueio no servidor
  para imóveis, fachadas e contratos. A `checar_cota` de `planos_v2` lê `usage_counters`
  para essas chaves, que valem sempre 0 (`planos_v2:239-252`), e também não verifica o
  tenant. As duas Edge Functions de contrato também aguardam publicação
  (`AI_HANDOFF.md:1631`).

### Correção sugerida (não implementada)

1. Revogar INSERT, UPDATE e DELETE de `authenticated` em `usage_counters`,
   `subscriptions` e `subscription_addons`, mantendo apenas SELECT. As escritas devem
   passar por `service_role`, pelo webhook do gateway ou por RPC de administração.
2. Restringir `incrementar_uso` a `service_role`, ou exigir
   `_corretor_id = get_corretor_id()` quando o papel for `authenticated`.
3. Criar RPC atômica `consumir_cota(corretor, chave)`, com trava consultiva e
   verificação e incremento na mesma transação, usada pelas Edge Functions. Em caso de
   falha do provedor, estornar o consumo.
4. No gatilho de contratos: disparar em `UPDATE OF status, tipo` e verificar sempre que
   a linha nova é contável e a antiga não era. Decidir se `LOCACAO_COMERCIAL` conta.
5. Em `checar_cota`: tirar `read_only` dos status com direito à criação e aplicar
   `trial_ends_at`/`current_period_end` como no agente.
6. Aplicar cota e limite por minuto às quatro funções do G8, com uma nova chave ou
   reaproveitando `ai_assistant_monthly`.
7. Conciliar a coluna B com os cards antes de aplicar `20260904100000`.

**Status: Parcial — falta corrigir G1 a G11 (os pontos 1 a 6 acima) e aplicar ou
publicar `20260904100000` e as Edge Functions de contrato depois de conciliar as cotas
(G12).**

---

## SCRUM-19 — Testes de bloqueio por chamada direta à API

### Testes existentes executados

Comando:
`VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key npx vitest run <arquivos>`

- Planos e cotas: `src/lib/planos.test.ts`, `src/hooks/useSubscription.test.ts`,
  `src/components/subscription/UpgradePrompt.test.tsx`, `src/data/plansData.test.ts`,
  `src/pages/PlanoAssinatura.test.tsx`, `src/pages/PlanoAssinatura.visual.test.tsx`,
  `supabase/functions/_shared/cotas.test.ts` e
  `supabase/functions/lead-capture/handler.test.ts`: **8 arquivos, 46 testes, todos
  passaram.** Todos testam a interface ou o helper com `rpc` simulado. Nenhum deles
  exercita o banco.
- Migrations PGlite já existentes (`supabase/migrations/*.test.ts`): **5 arquivos, 28
  testes, todos passaram.** Nenhum cobre planos ou cotas.

### Teste novo: `supabase/migrations/planos-cota-servidor.test.ts`

Carrega as migrations reais `20260807120000`, `20260820100000`, `20260904100000` e
`20260909180000`, as policies vigentes de `20260821130000` e, em um bloco separado,
`20260912125137`. As chamadas diretas rodam como `authenticated`, com o JWT simulado,
como faz o PostgREST.

Resultado: **21 testes, 13 passam e 8 falham de propósito.**

Passam, porque o servidor bloqueia corretamente:

- 6º imóvel ativo no Inteligente por INSERT direto, sem gravação parcial.
- INSERT em lote (array) que ultrapassaria o teto.
- Reativação acima do teto, enquanto a edição continua permitida.
- 6ª fachada ativa.
- 6º contrato residencial ativo, inclusive na passagem de `RASCUNHO` para `ATIVO`.
- `checar_cota` de outro corretor não revela nem libera cota.
- Cota mensal de IA negada no teto.
- Downgrade mantém os dados e bloqueia novos ativos.
- Conta sem assinatura é bloqueada.
- Status `expired` e `canceled` perdem a cota.
- Agente: lead com franquia esgotada vai para atendimento humano e gera alerta.
- Agente: o débito ocorre uma vez por telefone no mês.
- Agente: trial vencido não é atendido pela IA.

Falham de propósito (cada falha demonstra uma lacuna): G1 ×2 (UPDATE e DELETE no
contador), G2, G3, G4, G5 (troca de `tipo`), G6 e G7. **O arquivo deixa `npm test`
vermelho até as correções.** Para mesclar antes disso, troque esses 8 casos por
`it.fails`.

Simplificações: `get_corretor_id()` resolve pelo `corretores.user_id`; o dono é gestor da
organização; e as tabelas recebem o `GRANT` padrão do Supabase, que nenhuma migration
revoga. Não há teste de concorrência (G9), porque o PGlite usa uma conexão só. As Edge
Functions não foram executadas em Deno: a análise delas é de código.

**Status: Parcial — falta corrigir o servidor para os 8 testes passarem, fazer um teste
HTTP das Edge Functions do G8/G9 em ambiente de homologação (nunca em produção) e fazer
um teste de concorrência em Postgres real.**

---

## SCRUM-20 — Trial e downgrade com dados existentes

### Regras como estão implementadas

**Trial**

- `plans.trial_days = 14` (`20260807120000:19`). Este repositório não cria assinaturas
  nem calcula `trial_ends_at`: `MockPaymentProvider.createSubscription` não é usado
  (`src/services/paymentProvider.ts:49-55`), e o provisionamento vem do site
  (`20260901160100_backoffice_operacao_saas_rpcs.sql:104-107`).
- Durante `trialing`, a conta tem todos os limites do plano (`20260904100000:57`).
- Ao vencer, nenhum job muda o status. Com `trialing` e `trial_ends_at` no passado:
  - cotas de imóveis, fachadas, contratos, IA de contratos e assistente continuam
    liberadas (G7, teste vermelho);
  - o agente de leads para, porque `no_active_entitlement` passa a valer
    (`20260912125137:145-152`, teste verde);
  - a tela mostra "0 dias" (`useSubscription.ts:386-391`) e não bloqueia nada.
- Com `expired` ou `canceled`: não há plano. Criar recurso ativo e usar IA é negado, os
  dados existentes ficam intactos (teste verde) e a leitura continua possível. Com
  `read_only`, o acesso continua completo (G6). Com `past_due`, o plano vale em
  `checar_cota`, mas o agente para, porque só aceita `active` e `trialing`.
- Cancelamento: o enum diz "acesso até o fim do ciclo" (`20260807120000:65`), mas
  `checar_cota` corta o acesso assim que o status vira `canceled`. O botão da tela chama
  um mock que não faz nada (`PlanoAssinatura.tsx:157-167`, `paymentProvider.ts:57-59`).

**Downgrade**

- Interface: impede o downgrade quando algum uso, inclusive os contadores do mês, supera
  o limite do plano de destino (`PlanoAssinatura.tsx:129-133`, `src/lib/planos.ts:124-134`).
  Em seguida chama `changePlan` do mock, que também não faz nada
  (`PlanoAssinatura.tsx:136-140`). O FAQ promete "downgrade a partir do próximo ciclo"
  (`plansData.ts:219`), mas `subscriptions` não tem campo de plano agendado
  (`20260807120000:70-87`).
- Servidor: não valida troca de plano (G2). Depois de `plan_id` mudar:
  - nada é apagado nem desativado;
  - a conta fica acima do limite;
  - criar ou reativar recurso ativo fica bloqueado até o uso cair abaixo do limite;
  - editar e desativar continuam permitidos;
  - cotas mensais já consumidas acima do novo teto bloqueiam a IA até o fim do mês.

  Todos esses comportamentos foram verificados pelos testes verdes.

**Conta sem assinatura (legada ou criada pelo cadastro do app)**

- A interface libera tudo (`useSubscription.ts:203-215`).
- Com `20260904100000` aplicada, o banco bloqueia qualquer imóvel, fachada ou contrato
  ativo (`:60-63`, teste verde). Isso inclui o passo `first_property` do onboarding
  (`20260821130000:723,763-777`) e `ai-action`. Nenhum trecho do repositório insere em
  `subscriptions`.
- O agente trata a conta como sem plano de IA (`20260912125137:148-152`).

**Dados de exemplo:** os imóveis de exemplo do onboarding (`is_sample_data`) contam na
cota, porque a contagem não os exclui (`20260904100000:86-87`).

**Efeito de aplicar `20260904100000` sobre os dados atuais:** funciona como um downgrade
geral imposto pelo sistema. Contas no Inteligente com mais de 5 imóveis ou fachadas
ativos, no Profissional com mais de 20 e no Eficazes com mais de 100 ficam bloqueadas
para criar. Contas sem assinatura ficam bloqueadas totalmente.

### Verificações que exigem dados reais (somente leitura, resultados agregados)

- **C1 — Migration e gatilhos aplicados:**
  `select version from supabase_migrations.schema_migrations where version in ('20260820100000','20260904100000','20260909180000','20260912125137');`
  e `select tgname from pg_trigger where tgname like '%\_limite\_plano';`.
- **C2 — Cotas gravadas:**
  `select p.code, e.feature_key, e.enabled, e.limit_value, e.unlimited from plan_entitlements e join plans p on p.id = e.plan_id order by p.display_order, e.display_order;`
- **C3 — Status e trials vencidos:**
  `select status, count(*), count(*) filter (where status = 'trialing' and trial_ends_at < now()) as trial_vencido from subscriptions group by status;`
- **C4 — Corretores sem assinatura com direito:**
  `select count(*) from corretores c where not exists (select 1 from subscriptions s where s.corretor_id = c.id and s.status in ('trialing','active','past_due','read_only'));`
- **C5 — Mais de uma assinatura com direito por corretor.** O índice único exclui
  `read_only` (`20260807120000:92-93`) e `checar_cota` usa `LIMIT 1` sem ordenação:
  `select count(*) from (select corretor_id from subscriptions where status in ('trialing','active','past_due','read_only') group by 1 having count(*) > 1) x;`
- **C6 — Contas acima do limite, com a coluna A e com a coluna B.** Por plano, contar
  `imoveis.ativo`, `fachadas.ativo` e contratos `ATIVO` separados em
  `LOCACAO_RESIDENCIAL` e `LOCACAO_COMERCIAL`, e comparar com `plan_entitlements` e com
  5/20/100 (imóveis e fachadas) e 5/15/100 (contratos).
- **C7 — Contadores do mês acima do teto:** juntar `usage_counters` do `period_start`
  atual com `plan_entitlements` do plano vigente, onde `used_quantity > limit_value`.
- **C8 — Indício de adulteração (G1):** `usage_counters` de leads menor que a contagem
  de `lotti_agent_usage` do mesmo mês e corretor.
- **C9 — Adicionais ativos por código,** para verificar se existe `extra_leads_50`:
  `select addon_code, count(*), sum(quantity) from subscription_addons where status = 'active' group by 1;`
- **C10 — Imóveis de exemplo ativos:** `select count(*) from imoveis where is_sample_data and ativo;`
- **C11 — Fora do banco:** se o workflow n8n `D-qualificacao-gemini` está ativo e como o
  checkout do site grava `trial_ends_at` e o status da assinatura.

**Status: Bloqueado — precisa de acesso somente leitura ao banco de produção (ou de uma
cópia anonimizada) para rodar C1 a C10, de acesso ao n8n e ao site (C11) e de uma
definição de produto sobre a expiração do trial (job de `trialing` para `expired` para
`read_only`), sobre o que `read_only` permite e sobre quando o downgrade passa a valer.**

## Correções aplicadas nesta branch (Claude, 2026-09-27)

- `supabase/migrations/20260927100000_planos_permissoes_servidor.sql` (independe da migration de limites; pode ir para produção após autorização): `subscriptions`, `subscription_addons` e `usage_counters` ficam somente leitura para o usuário (fecha G1, G2 e G3); `incrementar_uso` recusa conta de outro usuário quando há sessão (fecha G4). O hook `useIncrementUsage` (sem uso hoje) passou a chamar essa função em vez de gravar o contador pelo navegador.
- `supabase/migrations/20260927100100_planos_regras_cota.sql` (aplicar logo depois de `20260904100000`, que ainda depende da decisão de limites do SCRUM-17): assinatura `read_only` e trial vencido perdem a cota para criar recursos ativos (G6, G7); trocar o tipo de contrato ATIVO para locação residencial passa pelo limite (G5).
- `supabase/migrations/planos-cota-servidor.test.ts`: as 8 lacunas viraram testes de regressão; 21/21 passam.
- Continuam abertos: G8–G11 (Edge Functions sem cota, corrida checar→incrementar, recursos sem aplicação, n8n), G12 (aplicar as migrations em produção) e a decisão de limites do SCRUM-17.
