# Lotti AI Gateway — contrato de arquitetura

Status: fundação implementada no worktree; migration e Edge Functions ainda precisam de rollout no Supabase.
Data-base: 2026-08-20. Tenant atual: `corretor_id`.

## 1. Decisão

A Lotti adotará um gateway próprio e fino em TypeScript/Deno, compartilhado pelas
Supabase Edge Functions. Gemini 2.5 Flash permanece como modelo principal enquanto
for estável e adequado. Não será introduzido LangChain, LangGraph ou outro framework
de agentes nesta fase: os riscos prioritários são isolamento, validação, confirmação,
prompt injection, observabilidade e custo.

Os endpoints existentes continuam como adaptadores para não quebrar o frontend:

- `ai-assistant`: chat, streaming e ferramentas;
- `ai-action`: confirmação e execução autorizada;
- `analisar-contrato`: extração multimodal;
- `gerar-contrato`: geração de minuta;
- `analisar-foto` e `analisar-fotos-imovel`: mídia;
- `generate-whatsapp-message`: rascunho de comunicação.

Todos usam `supabase/functions/_shared/ai/provider.ts`. Uma troca futura de modelo ou
provedor acontece nessa fronteira, não em cada feature.

## 2. Diagnóstico anterior

| Área | Situação encontrada | Decisão |
|---|---|---|
| Provedor | Seis Edge Functions chamavam Gemini diretamente por dois protocolos | Centralizar política, segredo, modelo, timeout e retry |
| Modelo | Gemini 2.5 Flash em todas as funções; defaults e documentação ainda citavam Grok | Preservar Flash e corrigir divergências |
| Assistente | Tools de leitura e `suggest_action` já existiam | Preservar e validar schemas |
| Confirmação | A interface pedia confirmação, mas executava casts e writes no frontend | Executar somente em `ai-action`, usando proposta persistida |
| Contexto | Resumo genérico; sem módulo, intenção, entidades ou trace | Adotar `LottiAIRequest` e contexto mínimo |
| Documentos | `file_context` era concatenado no system prompt | Delimitar e escapar como dado externo hostil |
| Chaves | Fotos aceitavam BYOK e persistiam chave Gemini no navegador | Remover BYOK; segredo somente no backend |
| Histórico | O chat carregava as 20 mensagens mais antigas | Carregar as 20 mais recentes e reordenar |
| Loop | Tool calling não tinha teto | Máximo de quatro rodadas |
| Rate limit | Read/update não atômico; usuário podia alterar a própria linha | RPC atômico e tabela exclusiva de `service_role` |
| Anexos | Policies do bucket permitiam leitura de qualquer objeto por autenticado | Restringir ao primeiro segmento `auth.uid()` |
| Observabilidade | `total_tokens` existia, mas não era preenchido | Criar runs/tool calls/versionamento/feedback sem conteúdo bruto |
| n8n | Workflow antigo usa Gemini 1.5 e memória por telefone, sem tenant confiável | Migrar por último; não liberar multiempresa antes de propagar tenant |

## 3. Fluxo do gateway

```text
Frontend autenticado
  → Edge Function adaptadora
    → valida JWT e deriva userId/corretorId no servidor
      → normaliza LottiAIRequest
        → checa rate limit, cota, módulo e intenção
          → Context Builder consulta somente entidades autorizadas via RLS
            → Prompt Registry monta identidade + módulo + dados delimitados
              → AIProvider chama Gemini com política central
                → valida resposta/tool args
                  → leitura: executa e registra fonte
                  → escrita: persiste proposta e devolve preview
                    → usuário confirma
                      → ai-action reivindica idempotency key e executa uma vez
```

Falha de telemetria durante a implantação é best-effort e não derruba leitura. Falha
de persistência de uma proposta bloqueia a ação: escrita nunca opera em modo inseguro.

## 4. Contrato de entrada

O contrato vive em `_shared/ai/contracts.ts`:

```ts
type LottiAIRequest = {
  organizationId: string; // sempre derivado no servidor
  userId: string;         // sempre derivado no servidor
  module: LottiAIModule;
  intent: string;
  message: string;
  entityRefs: Array<{ type: string; id: string }>;
  locale: "pt-BR";
  timezone: string;
  outputMode: "text" | "structured" | "action_proposal";
  requiresConfirmation: boolean;
  traceId: string;
};
```

IDs de organização e usuário enviados pelo navegador são ignorados. Hoje,
`organizationId = corretor_id`. Isso preserva o isolamento existente, mas ainda não
modela uma imobiliária com vários membros. Antes de gestão real de equipe, criar
`organizations` e `organization_memberships` e migrar a autorização.

## 5. Política de provedor

Interface: chat OpenAI-compatible para streaming/tool calling e `generateContent`
para multimodal, ambos escondidos pelo mesmo `AIProvider`.

- rápido/volume: Gemini 2.5 Flash;
- temperatura 0.1–0.2: extração, classificação e contratos;
- temperatura moderada: rascunhos de comunicação;
- timeout: 30–90 segundos por intenção;
- retry: no máximo uma vez e somente onde a operação é idempotente;
- fallback de modelo: desligado até existir falha medida que o justifique;
- `LOTTI_AI_FAST_MODEL`: permite troca controlada sem editar seis funções;
- chaves: apenas `GEMINI_API_KEY` em Supabase Secrets.

O endpoint OpenAI-compatible é mantido por compatibilidade. A documentação do Google
alerta que a camada não expõe todos os recursos nativos; migrar para o SDK/API nativa
somente quando essa limitação produzir custo operacional real.

Produção com dados de clientes deve usar uma modalidade contratual adequada: a tabela
oficial do Gemini informa que conteúdo do free tier pode ser usado para melhorar os
produtos, enquanto o paid tier não. Isso é um gate de privacidade, não só de escala.

Fontes: [preços Gemini](https://ai.google.dev/gemini-api/docs/pricing),
[compatibilidade OpenAI](https://ai.google.dev/gemini-api/docs/openai),
[structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[safety](https://ai.google.dev/gemini-api/docs/safety-guidance).

## 6. Prompts e versões

O registro inicial está em `_shared/ai/prompt-registry.ts` e na migration:

| Prompt | Versão |
|---|---|
| Identidade central | `lotti-core@2026-08-20.1` |
| Assistente geral/contextual | `assistant.general@2026-08-20.1` |
| WhatsApp de locações | `rentals.whatsapp@2026-08-20.1` |
| Tratamento de foto | `media.photo-enhancement@2026-08-20.1` |
| Classificação de fotos | `properties.photo-classification@2026-08-20.1` |
| Extração contratual | `contracts.extraction@2026-08-20.1` |
| Geração de minuta | `contracts.generation@2026-08-20.1` |

O banco guarda chave, versão, módulo e checksum, não o conteúdo integral do system
prompt. Novas versões são imutáveis; ativação é explícita.

## 7. Context Builder

Estado atual: o assistente carrega contagens e resumo financeiro pelo Supabase client
do usuário, portanto RLS continua sendo a fronteira principal. O frontend envia módulo,
intenção, fuso e trace.

Próxima evolução:

1. Resolver `entityRefs` da rota aberta.
2. Validar existência e permissão antes de buscar detalhes.
3. Usar selects explícitos; eliminar `select('*')` enviado ao modelo.
4. Incluir `source`, `entity_id` e `updated_at` no resultado de cada tool.
5. Aplicar orçamento de contexto por intenção e resumo incremental.
6. Pedir desambiguação para homônimos.

Documento, mensagem, nome e descrição vindos de usuários são dados não confiáveis.
Tags são escapadas e delimitadas por `<external_data>`.

## 8. Ferramentas e confirmação

Ferramentas de leitura atuais: clientes, imóveis, finanças, contratos, alertas, funil
e histórico. Elas consultam com RLS e não recebem acesso irrestrito ao banco.

`suggest_action` é ferramenta de proposta. Seus argumentos passam por schema antes de
serem persistidos em `ai_action_proposals`. O frontend não envia params novamente ao
confirmar; envia apenas o `proposal_id`.

`ai-action`:

- valida sessão e deriva tenant;
- carrega a proposta pelo par tenant/usuário;
- recusa proposta expirada ou já reivindicada;
- muda `pending → confirmed` de forma condicional;
- valida novamente o payload;
- verifica o ownership da entidade-alvo;
- executa uma vez e marca `executed` ou `failed`;
- retries retornam o resultado idempotente sem repetir a escrita.

A interface mostra descrição, campos envolvidos e a informação de que nenhuma
alteração ocorre antes da confirmação.

## 9. Observabilidade e retenção

A migration `20260821002556_lotti_ai_gateway_fundacao.sql` cria:

- `ai_prompt_versions`;
- `ai_runs`;
- `ai_tool_calls`;
- `ai_feedback`;
- `ai_memories`;
- `ai_action_proposals`.

`usage_counters`, `plan_entitlements`, `checar_cota` e `incrementar_uso` já cumprem o
papel de limites de consumo; não foi criada uma segunda fonte de verdade.

Runs guardam IDs, módulo, intenção, modelo, versão, latência, tamanhos e uma estimativa
de tokens/custo para fluxos textuais, além de status e códigos de erro. Não guardam mensagem, documento, CPF,
telefone ou resposta integral. Política de retenção e job de expurgo ainda são
pendências de rollout.

## 10. Custos e limites

As cotas existentes são mantidas:

- `ai_assistant_monthly` por plano;
- `ai_contracts_monthly` por plano;
- `leads_qualificados_monthly` para o principal driver de custo;
- rate limit curto por tenant;
- limite de entrada, arquivos, fotos, histórico e rodadas de tool calling.

Preços oficiais do Gemini 2.5 Flash em 2026-08-20: paid tier de US$ 0,30 por 1M
tokens de entrada de texto/imagem/vídeo e US$ 2,50 por 1M tokens de saída, incluindo
thinking. Os defaults configuráveis `LOTTI_AI_INPUT_USD_PER_MTOK` e
`LOTTI_AI_OUTPUT_USD_PER_MTOK` refletem essa referência; devem ser atualizados quando
o provedor mudar a tabela, e a fatura do provedor continua sendo a fonte real.

O free tier de IA não é recomendado para dados pessoais reais. Para reduzir custo:

- contexto mínimo por intenção;
- thinking desligado em extrações determinísticas;
- uma chamada para classificar o conjunto de fotos;
- sem fan-out para vários modelos;
- resumos incrementais e cache somente para dados sem mutação relevante;
- Flash-Lite pode ser avaliado para classificação após passar a suíte de eval.

## 11. Segurança e LGPD

Gates obrigatórios:

- zero acesso entre tenants;
- segredo apenas no backend;
- RLS em toda tabela exposta;
- conteúdo externo nunca vira instrução;
- tool args e structured outputs validados;
- escrita somente por proposta confirmada e idempotente;
- nenhuma ação crítica silenciosa;
- logs minimizados e mascarados;
- memória editável/excluível, com fonte, confiança e expiração;
- análise jurídica é extração/minuta para revisão, não parecer;
- cálculos financeiros críticos devem ser determinísticos.

Fontes de domínio: [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm),
[guia de segurança da ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-vf.pdf),
[dever de diligência do corretor](https://planalto.gov.br/ccivil_03/_ato2007-2010/2010/lei/l12236.htm),
[Código de Ética COFECI](https://intranet.cofeci.gov.br/arquivos/legislacao/resolucao_326_1992.pdf),
[Estatuto da Advocacia](https://planalto.gov.br/ccivil_03/leis/l8906.htm),
[OWASP Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).

## 12. Avaliação

Gates de liberação:

- 0 falhas: cross-tenant, bypass de permissão, escrita sem confirmação, prompt
  injection chamando ferramenta;
- 0 campos críticos inventados em imóvel, contrato, cobrança e dados pessoais;
- 100% de cálculos financeiros de referência exatos até o centavo;
- 100% das ações mutáveis com schema, confirmação e idempotency key;
- 100% das análises contratuais com fonte localizada e revisão humana;
- falha do provedor nunca pode ser apresentada como ação concluída.

Cenários mínimos automatizados/humanos:

1. lead novo incompleto;
2. dois clientes homônimos;
3. imóvel sem metragem;
4. imóvel com defeito registrado;
5. lead sem atividade;
6. classificação comercial com justificativa;
7. registro de outro tenant;
8. usuário sem permissão financeira;
9. contrato com data crítica;
10. prompt injection em contrato;
11. cobrança com multa/juros determinísticos;
12. alteração de valor com antes/depois;
13. agenda com conflito e fuso;
14. WhatsApp sem envio prévio;
15. retry após timeout sem duplicação;
16. resposta fora do schema;
17. provedor indisponível;
18. pedido ambíguo em lote;
19. dado desatualizado;
20. exclusão de memória.

## 13. Rollout

1. Aplicar a migration e executar sua consulta de conferência.
2. Publicar `ai-assistant`, `ai-action`, `ai-process-file`, `analisar-foto`,
   `analisar-fotos-imovel`, `analisar-contrato`, `gerar-contrato` e
   `generate-whatsapp-message`.
3. Smoke test por endpoint com uma conta de teste.
4. Testar cross-tenant e idempotência antes de liberar escrita.
5. Ativar telemetria; medir custo/latência sem conteúdo bruto.
6. Migrar n8n somente depois de tenant e credencial por organização estarem definidos.

## 14. Limitações abertas

- `corretor_id` ainda acumula usuário e organização; equipes exigem nova modelagem.
- O Context Builder inicial ainda é um resumo geral; entity refs precisam ser ligados
  às telas e selects mínimos.
- Tokens/custo textuais são estimados por caracteres; normalizar os campos de usage
  dos dois protocolos continua necessário para telemetria exata, sobretudo multimodal.
- Retenção/expurgo de runs, mensagens, anexos e memórias ainda precisa de política.
- Evals de domínio precisam de dataset rotulado por corretor sênior, locações,
  financeiro, advogado imobiliário e segurança/privacidade.
- n8n antigo permanece fora do gateway e não deve operar multiempresa sem tenant.

## 15. Arquivos da fundação

- `supabase/functions/_shared/ai/contracts.ts`
- `supabase/functions/_shared/ai/provider.ts`
- `supabase/functions/_shared/ai/prompt-registry.ts`
- `supabase/functions/_shared/ai/actions.ts`
- `supabase/functions/_shared/ai/telemetry.ts`
- `supabase/functions/ai-action/index.ts`
- `supabase/migrations/20260821002556_lotti_ai_gateway_fundacao.sql`
- adaptadores Edge Functions existentes
- `src/hooks/useAIChat.ts`
- `src/components/ai/AIActionCard.tsx`
- `src/components/midias/FotosIA.tsx`

Esta especificação é um contrato evolutivo. “Concluído” só significa que os gates
mensuráveis passaram no ambiente publicado; presença de arquivo ou tabela não basta.
