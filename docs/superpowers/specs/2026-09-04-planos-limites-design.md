# Planos, assinatura e limites da Lotti

Data: 2026-09-04  
Status: aprovado em conversa, aguardando conferência do documento

## Objetivo

Fazer o aplicativo aplicar as mesmas regras comerciais exibidas nos cards públicos de
planos. O usuário deve enxergar sua assinatura e seu consumo em Configurações e receber
uma orientação clara para upgrade quando tentar ultrapassar qualquer cota.

O gateway e o processamento financeiro da assinatura não fazem parte desta entrega. A
interface usará a abstração de pagamento existente, sem criar uma segunda integração.

## Planos e cotas

| Plano | Preço mensal | Imóveis ativos | Contratos de aluguel ativos | Fachadas Inteligentes | Operações/análises de contrato com IA por mês |
|---|---:|---:|---:|---:|---:|
| Essencial | R$ 129 | 5 | 5 | 5 | 10 |
| Profissional | R$ 249 | 20 | 15 | 20 | 20 |
| Imobiliária | R$ 499 | 100 | 100 | 100 | 60 |

CRM, clientes, funil e lançamentos financeiros não terão limite quantitativo.

Os demais recursos qualitativos devem seguir os cards comerciais:

- Essencial: integração com Asaas, financeiro básico e suporte por e-mail.
- Profissional: financeiro completo, gestão de aluguéis, integração com Asaas,
  relatórios, automações e suporte prioritário.
- Imobiliária: inclui os recursos dos níveis anteriores, onboarding orientado e suporte
  prioritário.

## Experiência no aplicativo

### Configurações — Plano e Assinatura

A área mostrará:

- nome, situação e ciclo do plano atual;
- barras de consumo para todas as cotas quantitativas;
- aviso preventivo ao alcançar 80% de uma cota;
- comparação com os demais planos;
- ação de upgrade, downgrade e cancelamento.

Upgrade e downgrade serão encaminhados à abstração de pagamento existente. O
cancelamento terá confirmação explícita e registro do motivo opcional, sem esconder a
ação ou impedir artificialmente sua conclusão.

### Bloqueio contextual

Toda ação sujeita a cota verificará o limite antes de criar o recurso. Exemplos:

- sexto imóvel no Essencial;
- sexto contrato de aluguel ativo no Essencial;
- sexta Fachada Inteligente no Essencial;
- décima primeira operação de IA do ciclo no Essencial.

Quando a cota estiver esgotada, a operação não será executada. Um modal informará o
recurso, o consumo atual, o limite do plano e recomendará o próximo plano que libera
capacidade. A ação principal levará para a área de assinatura; a secundária fechará o
modal sem modificar dados.

Recursos ilimitados e cotas ainda não esgotadas seguem o fluxo normal.

## Arquitetura e dados

`plans` e `plan_entitlements` serão a fonte única das cotas. A migration de planos será
ajustada para refletir a tabela comercial acima. A interface não repetirá números fixos:
`useSubscription` fornecerá plano, uso e permissão, enquanto `LimitGuard` e
`UpgradePrompt` cuidarão do bloqueio visual e da mensagem contextual.

Os pontos de criação de imóveis, contratos, fachadas e operações de IA usarão a mesma
regra central. A proteção no navegador será acompanhada por validação no backend ou RPC
responsável pela escrita, evitando que uma requisição direta contorne a cota. Contadores
mensais terão o ciclo da assinatura como referência; recursos ativos usarão a quantidade
ativa atual.

Contas sem assinatura não deverão receber liberação silenciosa em produção. Estados de
carregamento, falha de consulta ou assinatura inválida devem impedir a criação limitada e
mostrar uma mensagem recuperável.

## Erros e consistência

- Uma operação negada por limite não pode criar registro parcial.
- Falhas do provedor de pagamento não alteram o plano exibido até confirmação externa.
- Downgrade incompatível com o consumo atual deve explicar quais cotas precisam ser
  reduzidas antes da troca.
- Cancelamento mantém o acesso até o fim do período já pago, conforme o estado retornado
  pelo provedor.
- Mensagens devem usar o nome amigável do recurso e nunca expor códigos internos.

## Validação

Serão adicionados testes para:

- matriz de cotas dos três planos;
- estados abaixo de 80%, em atenção e esgotado;
- bloqueio de cada tipo de recurso limitado;
- recursos ilimitados;
- recomendação do próximo plano;
- conta sem assinatura e falha ao carregar limites;
- downgrade acima da cota e cancelamento;
- renderização da área de assinatura e do modal contextual.

Ao final serão executados a suíte completa, o build de produção e um teste visual no
localhost da própria branch.
