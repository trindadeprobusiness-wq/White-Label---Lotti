# Planos, assinatura e limites da Lotti

Data: 2026-09-04  
Status: aprovado pelo usuário

## Objetivo

Aplicar no aplicativo as mesmas regras comerciais dos cards públicos de planos. O
usuário verá sua assinatura e seu consumo em Configurações e receberá uma orientação
para upgrade ao tentar ultrapassar qualquer cota. O gateway de pagamento não faz parte
desta entrega; será mantida a abstração de pagamento existente.

## Planos e cotas

| Plano | Preço mensal | Imóveis ativos | Contratos de aluguel ativos | Fachadas | Operações/análises de contrato com IA por mês |
|---|---:|---:|---:|---:|---:|
| Essencial | R$ 129 | 5 | 5 | 5 | 10 |
| Profissional | R$ 249 | 20 | 15 | 20 | 20 |
| Imobiliária | R$ 499 | 100 | 100 | 100 | 60 |

CRM, clientes, funil e lançamentos financeiros permanecem sem limite quantitativo.
Essencial inclui Asaas, financeiro básico e suporte por e-mail. Profissional inclui
financeiro completo, gestão de aluguéis, Asaas, relatórios, automações e suporte
prioritário. Imobiliária inclui os recursos anteriores, onboarding orientado e suporte
prioritário.

## Experiência

Em **Configurações → Plano e Assinatura**, mostrar plano e status atuais, ciclo, barras
de consumo, alerta em 80%, comparação de planos e ações de upgrade, downgrade e
cancelamento. Essas ações continuarão usando o provedor de pagamentos existente.

Toda criação sujeita a cota verificará o limite antes de gravar. Ao esgotar a cota, a
operação será bloqueada e um modal mostrará recurso, consumo, limite e o próximo plano
capaz de liberá-lo, com ação para abrir a assinatura. A ação secundária apenas fecha o
modal. Recursos ilimitados continuam normalmente.

## Arquitetura e consistência

`plans` e `plan_entitlements` serão a fonte única. A migration refletirá a matriz acima;
a UI não repetirá números fixos. `useSubscription` fornecerá plano, uso e permissão;
`LimitGuard` e `UpgradePrompt` cuidarão da interação. Imóveis, contratos, fachadas e IA
usarão a mesma regra central.

A proteção visual será acompanhada por validação autoritativa no banco ou na função que
faz a escrita. Uma operação negada não pode criar registro parcial. Falhas de consulta e
contas sem assinatura não devem liberar criação silenciosamente em produção. Contagens
de recursos usam somente registros ativos; cotas mensais usam o ciclo da assinatura.

Downgrade incompatível deve explicar quais cotas excedem o plano de destino. O
cancelamento terá confirmação clara, motivo opcional e manterá acesso até o término do
período pago conforme o provedor, sem esconder ou impedir artificialmente a ação.

## Validação

Testar a matriz dos três planos, estados normal/80%/esgotado, cada recurso limitado,
recursos ilimitados, sugestão do próximo plano, ausência de assinatura, downgrade
incompatível e ausência de gravações parciais.
