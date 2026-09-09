# Planos e Limites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o app aplicar e exibir as cotas comerciais de Essencial, Profissional e Imobiliária em todas as quatro operações limitadas.

**Architecture:** O banco permanece fonte única de planos e cotas. Regras puras calculam estado e recomendação; hooks carregam a decisão; componentes compartilhados mostram uso e bloqueio; os pontos de criação verificam a mesma chave antes de executar. Uma migration idempotente corrige os valores e fornece contagens ativas autoritativas.

**Tech Stack:** React 18, TypeScript, TanStack Query, Supabase/PostgreSQL, Vitest, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-04-planos-limites-design.md`

## Global Constraints

- Cotas: Essencial `5/5/5/10`, Profissional `20/15/20/20`, Imobiliária `100/100/100/60` para imóveis/contratos/fachadas/IA.
- CRM, clientes, funil e lançamentos financeiros permanecem sem limite quantitativo.
- A UI não contém números comerciais duplicados; lê `plan_entitlements`.
- Gateway real de pagamento está fora do escopo; ações usam `PaymentProvider` existente.
- Uma negação de cota não cria registro parcial.
- Alterações locais preexistentes e arquivos fora do escopo não serão incluídos nos commits.

---

### Task 1: Matriz comercial e regra pura de recomendação

**Files:**
- Modify: `src/lib/planos.ts`
- Modify: `src/lib/planos.test.ts`
- Create: `supabase/migrations/20260904100000_alinhar_cotas_planos_comerciais.sql`

**Interfaces:**
- Produces: `proximoPlanoParaCota(planos, planoAtualId, featureKey): PlanWithEntitlements | null`.
- Produces: cotas idempotentes em `plan_entitlements` para as quatro chaves comerciais.

- [ ] **Step 1: Escrever testes que fixem a matriz e a recomendação**

Adicionar casos que esperam a ordem `essencial → profissional → imobiliaria`, selecionam o primeiro plano posterior cujo `limit_value` seja maior e retornam `null` no último plano.

- [ ] **Step 2: Executar o teste e confirmar falha**

Run: `npm test -- src/lib/planos.test.ts --reporter=dot`
Expected: FAIL porque `proximoPlanoParaCota` ainda não existe.

- [ ] **Step 3: Implementar a função pura e a migration**

Na migration, atualizar por `plans.code` e `feature_key`:

```sql
-- essencial: 5, 5, 5, 10
-- profissional: 20, 15, 20, 20
-- imobiliaria: 100, 100, 100, 60
```

As chaves são `max_imoveis`, `max_contratos_locacao`, `max_fachadas` e `ai_contracts_monthly`.

- [ ] **Step 4: Rodar teste e verificação SQL estática**

Run: `npm test -- src/lib/planos.test.ts --reporter=dot`
Expected: PASS.

Run: `rg -n "'5'|'10'|'15'|'20'|'60'|'100'" supabase/migrations/20260904100000_alinhar_cotas_planos_comerciais.sql`
Expected: a matriz completa aparece na migration.

### Task 2: Estado central de limite e modal contextual

**Files:**
- Modify: `src/hooks/useSubscription.ts`
- Modify: `src/types/subscription.ts`
- Modify: `src/components/subscription/LimitGuard.tsx`
- Modify: `src/components/subscription/UpgradePrompt.tsx`
- Create: `src/components/subscription/UpgradePrompt.test.tsx`

**Interfaces:**
- Produces: `LimitCheck` com `allowed`, `used`, `limit`, `ratio`, `status`, `featureName`, `currentPlan`, `recommendedPlan` e `ready`.
- Produces: `LimitGuard` que aceita `onBlocked?: () => void` e abre um único modal contextual.

- [ ] **Step 1: Escrever testes do texto e da recomendação**

Cobrir `5 de 5 imóveis`, plano `Essencial`, recomendação `Profissional`, botão `Ver plano Profissional` e estado sem recomendação no plano Imobiliária.

- [ ] **Step 2: Executar e confirmar falha**

Run: `npm test -- src/components/subscription/UpgradePrompt.test.tsx --reporter=dot`
Expected: FAIL com propriedades/textos ainda ausentes.

- [ ] **Step 3: Implementar estado e modal**

O hook deve usar a função pura da Task 1. Carregamento ou erro não pode ser interpretado como cota ilimitada. O modal recebe os valores do hook e navega para `/plano`.

- [ ] **Step 4: Executar testes focados**

Run: `npm test -- src/lib/planos.test.ts src/components/subscription/UpgradePrompt.test.tsx --reporter=dot`
Expected: PASS.

### Task 3: Tela de assinatura em Configurações

**Files:**
- Modify: `src/pages/PlanoAssinatura.tsx`
- Modify: `src/components/subscription/PlanCard.tsx`
- Modify: `src/components/subscription/UsageBar.tsx`
- Create: `src/pages/PlanoAssinatura.test.tsx`

**Interfaces:**
- Consumes: `useSubscriptionSummary`, `paymentProvider.changePlan`, `paymentProvider.cancelSubscription`.
- Produces: plano atual, todas as quatro cotas, upgrade, downgrade e cancelamento confirmável.

- [ ] **Step 1: Escrever teste visual/comportamental**

Validar plano atual, quatro barras, aviso em 80%, rótulos `Upgrade`/`Downgrade`, confirmação de cancelamento e bloqueio de downgrade quando o uso excede o destino.

- [ ] **Step 2: Executar e confirmar falha**

Run: `npm test -- src/pages/PlanoAssinatura.test.tsx --reporter=dot`
Expected: FAIL nos controles ainda não implementados.

- [ ] **Step 3: Implementar a experiência**

Remover `console.log` de redirecionamento como única resposta. Usar toast de sucesso/erro para o mock, confirmação para cancelamento e mensagem com as cotas incompatíveis no downgrade.

- [ ] **Step 4: Executar o teste da página**

Run: `npm test -- src/pages/PlanoAssinatura.test.tsx --reporter=dot`
Expected: PASS.

### Task 4: Imóveis e Fachadas

**Files:**
- Modify: `src/pages/Imoveis.tsx`
- Modify: `src/components/imoveis/NovoImovelDialog.tsx`
- Modify: `src/pages/FachadasInteligentes.tsx`
- Modify: `src/components/fachadas/CriarFachadaDialog.tsx`
- Create: `src/components/subscription/limited-actions.test.tsx`

**Interfaces:**
- Consumes: `useCheckLimit()` com `max_imoveis` e `max_fachadas`.
- Produces: nenhuma abertura/gravação nova quando a cota estiver esgotada; edição continua permitida.

- [ ] **Step 1: Escrever testes das ações bloqueadas**

Simular Essencial com 5/5 e verificar que o sexto imóvel/fachada abre `UpgradePrompt`, não o formulário. Verificar também que editar registro existente continua permitido.

- [ ] **Step 2: Executar e confirmar falha**

Run: `npm test -- src/components/subscription/limited-actions.test.tsx --reporter=dot`
Expected: FAIL porque os dois fluxos ainda não usam a regra completa.

- [ ] **Step 3: Aplicar guardas nos gatilhos e submissões**

Proteger tanto o botão quanto `handleSubmit`; a segunda verificação reduz corrida entre duas abas. Não incrementar contador mensal: imóveis/fachadas usam contagem ativa.

- [ ] **Step 4: Executar testes focados**

Run: `npm test -- src/components/subscription/limited-actions.test.tsx src/pages/CRM.visual.test.tsx --reporter=dot`
Expected: PASS.

### Task 5: Contratos ativos e operações de IA

**Files:**
- Modify: `src/components/rental/NewContractDialog.tsx`
- Modify: `src/components/rental/AutoContractDialog.tsx`
- Modify: `src/pages/Juridico.tsx`
- Modify: `supabase/functions/analisar-contrato/index.ts`
- Modify: `supabase/functions/gerar-contrato/index.ts`
- Modify: `supabase/functions/_shared/cotas.ts`
- Modify: `supabase/functions/_shared/asaas.test.ts`

**Interfaces:**
- Consumes: `max_contratos_locacao`, `ai_contracts_monthly`, `checarCota` e `incrementarUso`.
- Produces: contratos novos bloqueados no teto; IA negada antes da chamada paga e contabilizada somente após sucesso.

- [ ] **Step 1: Escrever testes dos limites de contrato e IA**

Cobrir criação manual, importação automática, IA em 9/10, bloqueio em 10/10 e ausência de incremento quando o provedor falha.

- [ ] **Step 2: Executar e confirmar falha**

Run: `npm test -- src/lib/planos.test.ts supabase/functions/_shared/asaas.test.ts --reporter=dot`
Expected: pelo menos um caso novo falha antes da implementação.

- [ ] **Step 3: Implementar verificações antes de custo/gravação**

As funções retornam HTTP 402 com `{ code: 'PLAN_LIMIT_REACHED', featureKey, used, limit }`. O front converte esse contrato no mesmo `UpgradePrompt`.

- [ ] **Step 4: Executar testes focados**

Run: `npm test -- src/lib/planos.test.ts supabase/functions/_shared/asaas.test.ts --reporter=dot`
Expected: PASS.

### Task 6: Contagens autoritativas e verificação final

**Files:**
- Modify: `supabase/migrations/20260904100000_alinhar_cotas_planos_comerciais.sql`
- Modify: `src/hooks/useSubscription.ts`
- Modify: `AI_HANDOFF.md`

**Interfaces:**
- Produces: `checar_cota` contando imóveis ativos, contratos ativos e fachadas diretamente nas tabelas; contadores mensais somente para IA.

- [ ] **Step 1: Adicionar teste SQL de isolamento e fronteira**

Criar transações de teste para 4/5, 5/5 e operações de outro corretor, garantindo que uma conta não consuma a cota da outra.

- [ ] **Step 2: Implementar contagens ativas no banco**

Para cada chave de recurso, `checar_cota` calcula `COUNT(*)` filtrado por `corretor_id` e estado ativo. Para IA, continua lendo `usage_counters` do ciclo corrente.

- [ ] **Step 3: Rodar a suíte e o build**

Run: `npm test -- --reporter=dot`
Expected: todos os testes passam.

Run: `npm run build`
Expected: build Vite termina com código 0.

- [ ] **Step 4: Subir e validar localhost**

Run: `npm run dev -- --host 127.0.0.1`
Expected: `/plano`, `/imoveis`, `/alugueis`, `/fachadas` e `/juridico` carregam sem erro; modal aparece nas fronteiras configuradas.

- [ ] **Step 5: Registrar fatos no handoff**

Anotar somente arquivos alterados, testes executados, resultados e pendências de aplicação da migration/provider real.
