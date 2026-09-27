# Custo por usuário — SCRUM-50

Data: 2026-09-27 · Responsável: Claude · Preços consultados hoje nas páginas oficiais (fontes no fim) · Câmbio: PTAX de venda de 25/09/2026, **US$ 1 = R$ 5,1991**.

## Resumo

Custo mensal estimado por conta **usando a cota inteira do plano**, com 30 contas na plataforma, IA do WhatsApp em `gpt-4o-mini` (o padrão atual) e pagamento por cartão. A faixa vai do uso típico ao uso pesado; as premissas estão abaixo.

| Plano | Preço | Infra (rateio) | IA WhatsApp | IA de contratos | Asaas (cartão) | **Custo total** | **Margem bruta** |
|---|---|---|---|---|---|---|---|
| Lotti Inteligente | R$ 279 | R$ 10–25 | R$ 4–25 | R$ 0,41–2,14 | R$ 8,83 | **R$ 23–61** | 78–92% |
| Lotti Profissional | R$ 399 | R$ 10–25 | R$ 10–62 | R$ 1,02–5,36 | R$ 12,42 | **R$ 33–105** | 74–92% |
| Lotti Eficazes | R$ 799 | R$ 10–25 | R$ 23–150 | R$ 1,63–8,57 | R$ 24,38 | **R$ 59–208** | 74–93% |

A margem é calculada **antes de impostos**: Simples Nacional ou outro regime, ISS e retenções não entram. Também ficam de fora suporte, marketing e custo de pessoal.

Os maiores riscos de custo são:
1. **Escolha do modelo de IA.** Com `gpt-4.1-mini` ou `gpt-5-mini`, o uso pesado do Eficazes chega a R$ 370–400 por mês (tabela abaixo). Se a tela do Agente permitir trocar o modelo, restrinja aos modelos baratos ou cobre a diferença.
2. **Catálogo inteiro em cada resposta.** Os imóveis enviados (até 80) são a maior parte da entrada. Mandar só os imóveis compatíveis com o pedido (por exemplo, 20) corta cerca de metade do custo pesado.
3. **Taxa do cartão.** É o maior custo fixo por cobrança: 2,99% + R$ 0,49. No Pix sai R$ 1,99 por cobrança, e no plano anual o Pix é cobrado uma vez por ano.

## Premissas

### Agente de IA do WhatsApp (OpenAI, runtime `n8n-agent-lotti`)
Cada mensagem nova do lead gera uma chamada ao modelo. Nela vão a instrução do sistema com o schema de saída (cerca de 1.300 tokens medidos no código), as últimas 40 mensagens, até 80 imóveis e o perfil já salvo. A saída tem limite de 1.600 tokens.

Estimativas de tamanho usadas (1 token ≈ 3,5 caracteres em português):
- mensagem: média de 207 caracteres, medida nas mensagens importadas no teste de SCRUM-49;
- imóvel: cerca de 375 caracteres em JSON, com as colunas enviadas pela ponte.

| Cenário | Mensagens no contexto | Imóveis | Entrada/chamada | Saída/chamada | Respostas por lead |
|---|---|---|---|---|---|
| Típico | 10 | 20 | ~4.350 tokens | ~450 | 8 |
| Pesado | 40 | 80 | ~13.200 tokens | ~700 | 20 |

Custo por lead e por plano na cota cheia (R$/mês). O cache de entrada não foi descontado; ele reduz um pouco o custo real.

| Modelo | US$/1M entrada · saída | Por lead | Inteligente (100) | Profissional (250) | Eficazes (600) |
|---|---|---|---|---|---|
| gpt-5-nano¹ | 0,05 · 0,40 | US$ 0,005–0,024 | R$ 3–12 | R$ 7–31 | R$ 16–74 |
| gpt-4.1-nano | 0,10 · 0,40 | US$ 0,005–0,032 | R$ 3–17 | R$ 6–42 | R$ 15–100 |
| **gpt-4o-mini (atual)** | 0,15 · 0,60 | US$ 0,007–0,048 | **R$ 4–25** | **R$ 10–62** | **R$ 23–150** |
| gpt-5-mini¹ | 0,25 · 2,00 | US$ 0,026–0,118 | R$ 13–61 | R$ 33–153 | R$ 80–368 |
| gpt-4.1-mini | 0,40 · 1,60 | US$ 0,020–0,128 | R$ 10–66 | R$ 26–166 | R$ 61–399 |

¹ Modelos com raciocínio: foram somados 600 tokens de raciocínio por resposta, cobrados como saída. A qualidade das respostas em português não foi avaliada nesta tarefa.

### IA de contratos (Gemini 2.5 Flash, Edge Functions)
Preço: US$ 0,30 de entrada e US$ 2,50 de saída por 1M tokens. O raciocínio ("thinking") é cobrado como saída e vem ligado por padrão nesse modelo.
- `analisar-contrato`: PDF de 15 a 40 páginas (258 tokens por página) e saída de até 8.192 tokens, com raciocínio desligado no código. Custa US$ 0,008–0,024 por análise.
- `gerar-contrato`: não define raciocínio no código, então ele fica ligado. Estimativa de US$ 0,026–0,041 por contrato gerado.
- Cotas mensais de 10, 25 e 40 operações por plano: no máximo R$ 2,14, R$ 5,36 e R$ 8,57.
- **Atenção:** o Google informa que está limitando o acesso aos modelos 2.5 a quem já os usava. Em um projeto novo, o equivalente é o Gemini 3.5 Flash-Lite, pelo mesmo preço do 2.5 Flash.

### Pagamento (Asaas, fora do período promocional)
- Cartão, inclusive assinatura: 2,99% + R$ 0,49 por cobrança, com recebimento em D+32. Por mês: R$ 8,83, R$ 12,42 e R$ 24,38.
- Pix: R$ 1,99 por cobrança; no plano anual, uma vez por ano. Boleto: R$ 1,99.
- Sem mensalidade. Contas novas pagam 1,99% + R$ 0,49 (cartão) e R$ 0,99 (Pix) nos 3 primeiros meses.

### Infraestrutura fixa, rateada pelo número de contas

| Item | Enxuto | Robusto |
|---|---|---|
| Supabase | Pro US$ 25 (compute Micro, 1 GB) | Pro + Medium (4 GB), US$ 75 |
| Vercel | Pro US$ 20 (1 assento) | Pro US$ 20 |
| VPS para Evolution, runtime, n8n, Postgres e Redis | Hetzner CX33, 8 GB, US$ 9,99 | DigitalOcean 8 GB, US$ 48 |
| Cloudflare Tunnel | grátis | grátis |
| **Total/mês** | **≈ US$ 55 (R$ 286)** | **≈ US$ 143 (R$ 743)** |

| Contas na plataforma | Infra por conta/mês |
|---|---|
| 10 | R$ 29–74 |
| 30 | R$ 10–25 |
| 50 | R$ 6–15 |
| 100 | R$ 3–7, mais uma VPS a cada ~30 números conectados (estimativa a confirmar em teste de carga) |

Hoje a ponte roda no PC do Rafael, com custo zero de VPS e sem garantia de disponibilidade. A migração para uma VPS está nas tarefas SCRUM-41 a 48.

## O que não entrou
- **Impostos e taxas bancárias fora do Asaas.**
- **SMTP próprio** para convites e recuperação de senha: pendente de escolha do fornecedor.
- **Funções de IA sem cota** (assistente, análise de fotos, sugestão de resposta, mensagens do CRM e comando da rotina), todas em Gemini. O custo delas depende do uso; meça pela tabela `ai_runs`, abaixo.
- **Anexos e áudios** no Storage do Supabase, cobertos pelos 100 GB do Pro no início.

## Como medir o custo real (recomendado depois de 30 dias de uso)
1. **Funções de IA da plataforma.** Elas gravam tokens e custo estimado em `public.ai_runs`. Consulta somente leitura, para rodar no painel do Supabase:
   ```sql
   select corretor_id, date_trunc('month', created_at) as mes, module,
          count(*) as chamadas, sum(input_tokens) as entrada, sum(output_tokens) as saida,
          round(sum(estimated_cost_usd)::numeric, 4) as custo_usd
   from public.ai_runs
   where status = 'completed'
   group by 1, 2, 3
   order by mes desc, custo_usd desc;
   ```
   Confira antes se a tabela existe em produção: ela vem da migration `20260821002556_lotti_ai_gateway_fundacao.sql`.
2. **Agente do WhatsApp.** A ponte passou a registrar no log, a cada resposta, o evento `lotti.ai_usage` com modelo e tokens de entrada, cache e saída, sem conteúdo nem contato. Está na branch `claude/agent-webhook-and-claims` do `n8n-agent-lotti`. Somando o log do mês e dividindo pelos leads da conta (`usage_counters`, `leads_qualificados_monthly`), sai o custo real por lead.

## Fontes (consultadas em 2026-09-27)
- OpenAI: https://developers.openai.com/api/docs/pricing
- Gemini: https://ai.google.dev/gemini-api/docs/pricing (atualizado em 24/09/2026), https://ai.google.dev/gemini-api/docs/thinking
- Supabase: https://supabase.com/pricing, https://supabase.com/docs/guides/platform/compute-and-disk
- Vercel: https://vercel.com/pricing, https://vercel.com/docs/plans/pro-plan
- Hetzner: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ (preços de 15/06/2026)
- DigitalOcean: https://www.digitalocean.com/pricing/droplets
- Cloudflare Tunnel: https://developers.cloudflare.com/tunnel/
- Asaas: https://www.asaas.com/precos-e-taxas, https://www.asaas.com/cobranca-cartao
- Câmbio: API PTAX do Banco Central (https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/)
- Planos e cotas: migrations `20260909180000_planos_agente_ia.sql` e `20260925120000_billing_plan_enforcement.sql`

**Status: Concluído como estimativa.** O custo real depende de 30 dias de uso medido por `ai_runs` e `lotti.ai_usage`.
