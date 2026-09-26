# Assinaturas Lotti — integração e ativação

Referência comercial: print fornecido em 25/09/2026. Áudio (1min47s) e vídeo
(10min32s) foram transcritos localmente e analisados. Ambos descrevem criação da
cobrança pelo backend, retorno de Pix/cartão e confirmação pelo webhook antes de
registrar o acesso. Os materiais são referências de fluxo; não são instruções para
executar os workflows, comissões de afiliados ou integração Stripe da outra empresa.

## Contrato dos planos

| Recurso | Inteligente | Profissional | Eficazes |
|---|---:|---:|---:|
| Mensal no cartão | R$279 | R$399 | R$799 |
| Anual no Pix, 12 meses pelo preço de 10 | R$2.790 | R$3.990 | R$7.990 |
| Leads atendidos por IA/mês | 100 | 250 | 600 |
| Imóveis ativos | 250 | 1.500 | Ilimitado |
| Contratos de aluguel ativos | 5 | 30 | Ilimitado |
| Fachadas ativas | 15 | 60 | Ilimitado |
| Gerações + análises de contratos com IA/mês | 10 | 25 | 40 |

As cotas mensais usam o mês civil de São Paulo, inclusive no plano anual.
Os códigos técnicos existentes são `essencial`, `profissional` e `imobiliaria`.
CRM, clientes e lançamentos financeiros não recebem limite de quantidade novo.
O catálogo remoto já correspondia ao print; a migration versiona essa igualdade.

## Fluxo implementado

1. O site valida cadastro e forma de pagamento. O preço é calculado no servidor.
2. Um pedido interno identifica a tentativa. Repetir a mesma tentativa não cria outra assinatura.
3. O backend cria o cliente e a recorrência Asaas, usando a conta recebedora da Lotti.
4. O site exibe QR/copiar Pix ou aguarda processamento do cartão.
5. O webhook autentica o token e consulta o estado atual da cobrança no Asaas.
6. Cliente, assinatura, referência do pedido, valor e vencimento precisam corresponder.
7. O banco registra cada cobrança por ID e aplica o plano/período em uma transação.
8. O cliente recebe convite/recuperação de senha no e-mail e entra em `/nova-senha`.

Notificações CONFIRMED e RECEIVED do mesmo pagamento não concedem dois períodos.
Renovações atualizam as datas. Estorno de período antigo não cancela período posterior
pago. Estorno integral de todas as cobranças bloqueia os recursos pagos. Pagamento
com resultado incerto não é reenviado automaticamente; o webhook pode recuperar a
assinatura pela referência externa. Investigue tentativas que permaneçam pendentes.

## Proteção das cotas

- Banco conta imóveis, fachadas e contratos ativos, inclusive inserções em lote e reativações.
- Cliente autenticado somente lê assinatura, adicionais e consumo; não pode se promover de plano.
- Geração/análise reserva a cota antes de chamar IA. Falha conhecida devolve a reserva uma vez.
- Uma queda abrupta pode deixar reserva consumida; investigar `contract_quota_reservations` antes de liberar manualmente.
- O runtime de leads já possui reserva por conta, telefone e mês. Contatos continuam salvos quando não há cota.
- Contas anteriores sem assinatura conservam criação de recursos por uma lista de legado capturada na migration.
  Novas contas não entram nessa lista. Uma assinatura vencida/cancelada não ganha a isenção.
- A interface bloqueia recursos pagos com período vencido, plano desconhecido ou recurso desabilitado.

## Configuração externa necessária

### Asaas da Lotti

Na conta recebedora confirmada pelo usuário: menu do perfil → **Integrações** →
**Chaves de API**. Criar chave específica da integração do SaaS; manter exclusivamente
na variável de servidor `ASAAS_API_KEY` da Vercel do **lotti-site**.
Usar `ASAAS_ENVIRONMENT=sandbox` para homologação ou `production` para produção.
Não colocar segredos em `VITE_*`, `NEXT_PUBLIC_*`, Git ou chat.

Em **Webhooks**, cadastrar:

- URL de produção: `https://plataformalotti.com.br/api/webhooks/asaas`.
- Token: mesmo segredo de `ASAAS_WEBHOOK_TOKEN` do site; nunca a API Key.
- Entrega sequencial, webhook ativo, e-mail operacional escolhido pelo responsável.
- Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
  `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`,
  `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_DELETED`.

Os webhooks de cobranças de aluguel dos clientes são uma integração diferente.
Não substituir nem apagar esses endpoints existentes.

### E-mail de acesso

No Supabase vinculado, configurar SMTP para destinatários externos, remetente e
domínio verificado. Testar **Invite user** e **Reset password** com o endereço do
responsável antes de abrir as vendas. A configuração inicial consultada apontava
para localhost e não tinha redirect cadastrado; isso foi corrigido para o domínio
da plataforma e `/nova-senha`. A política remota exige senha de pelo menos 10 caracteres.

A existência da variável `RESEND_API_KEY` na Vercel não comprova SMTP configurado:
variáveis sensíveis não são reveladas por `env pull`. Não inferir validade/invalidez
da chave real a partir de um valor vazio exportado.

### Liberação

`CHECKOUT_ENABLED` começa em `false`. Só passar a `true` depois de validar chave,
webhook, entrega de e-mail e os casos abaixo. A presença de uma chave não habilita
cobranças automaticamente.

## Homologação final

1. Compra mensal e anual no sandbox: valor certo, Pix visível/cartão aprovado e nenhuma liberação antes da confirmação.
2. Confirmação: uma conta, uma assinatura, e-mail recebido, senha criada e acesso no plano correto.
3. Reenvio do webhook e CONFIRMED→RECEIVED: sem duplicar assinatura, período ou convite.
4. Renovação: nova cobrança estende o período; eventos antigos não derrubam o acesso.
5. Estorno e inadimplência: acesso pago bloqueado quando não há período válido.
6. Última vaga de imóvel/fachada/aluguel e última operação de IA: próxima operação negada pelo servidor.
7. Leads: reconectar WhatsApp e homologar runtime ao vivo separadamente. A compra não pareia o número do cliente;
   a flag global de envio do runtime não é ativada por esta integração.

Troca de plano e cancelamento dentro da plataforma ainda usam o provider indisponível.
Não habilitar esses botões com um mock. Precisam de operação autenticada no gateway
e política de vigência/prorrata definida. O escopo validado nesta etapa é compra,
provisionamento, renovação recebida por webhook e cotas.

## Operação e diagnóstico

- `checkout_orders`: estado do pedido e código de falha; acesso apenas pelo servidor/back office autorizado.
- `asaas_checkout_events`: ID/status/tentativas do evento, sem payload bruto.
- `checkout_payments`: cobrança, período e estado que sustentam o acesso.
- `contract_quota_reservations`: consumo reservado, concluído ou devolvido.
- `subscriptions`, `plan_entitlements`, `usage_counters`: plano vigente e consumo.

Não usar `supabase db push --include-all`: o histórico antigo tem divergências.
As migrations desta etapa são aplicadas isoladamente e registradas na mesma transação.

Fontes oficiais consultadas: [eventos de cobranças](https://docs.asaas.com/docs/webhook-para-cobrancas),
[webhooks](https://docs.asaas.com/docs/sobre-os-webhooks),
[assinaturas](https://docs.asaas.com/reference/criar-nova-assinatura),
[referência externa](https://docs.asaas.com/reference/listar-assinaturas).

## Estado verificado em 26/09/2026

Plataforma: PRs #19, #20 e #21 integradas. Site: PRs #2 e #3 integradas.
Banco, funcoes, templates Auth e dominios oficiais publicados. Validacoes anteriores:
672 testes da plataforma, 8 do site, builds e ESLint direcionado aprovados.

Homologacao isolada com Asaas sandbox confirmou mensal no cartao e anual no Pix,
webhook real, conta nova, convite, assinatura e limites. Reenvios nao duplicaram
assinaturas nem periodos; o 251o imovel do plano Inteligente foi bloqueado.
Pix tem consulta com repeticao limitada para aguardar geracao assincrona do QR,
sem criar outra cobranca. Ambiente e webhook sandbox encerrados ao terminar.

Asaas de producao conectado com chave sensivel no servidor e webhook exclusivo
ativo, autenticado e sequencial. Integracao anterior de alugueis preservada.
Dominio de envio auth.plataformalotti.com.br verificado no Resend; registros DKIM
e CNAME publicados na Hostinger. SMTP Resend configurado no Supabase; recuperacao
e convite para conta nova aceitos pelo Auth com HTTP 200 e registrados como
Delivered no Resend. Credenciais nao constam neste documento ou no Git.

CHECKOUT_ENABLED habilitado no ambiente Production apos essas verificacoes.
Deployment dpl_HtTizXunggeQzRsiK1Rr5P8HQKWC confirmado Ready com aliases oficiais.
Smoke publico: pagina de checkout 200; dados invalidos 400 INVALID_CHECKOUT_DATA;
webhook sem autenticacao 401. O endpoint de compra nao esta mais bloqueado por configuracao.
Nenhuma cobranca real foi criada. A conta de teste de convite nao recebeu
assinatura paga. Troca/cancelamento na plataforma continuam indisponiveis;
pareamento e envio real de WhatsApp continuam em homologacao separada.
