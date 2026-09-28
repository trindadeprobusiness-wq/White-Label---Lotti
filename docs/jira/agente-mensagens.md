# Agente WhatsApp e Mensagens — SCRUM-30 a SCRUM-40 (exceto SCRUM-38)

Verificação feita por Claude em 2026-09-27. Nenhuma chamada foi feita à produção, à OpenAI ou à Evolution, e nenhuma mensagem foi enviada. Também não li nem copiei valores de segredos: do `.env` local conferi só nomes de variáveis e as flags booleanas `LIVE_SEND_ENABLED=false` e `HISTORY_IMPORT_ENABLED=false`.

## Base analisada

| Repositório | Branch / commit | Observação |
|---|---|---|
| Ponte/runtime `C:\Users\rafae\n8n-agent-lotti` | `codex/openai-whatsapp-agent` @ `2dda86c` (somente leitura) | Está 2 commits à frente de `main` (`f49f8dc`). A branch usa a OpenAI Responses; a `main` ainda usa o Gemini. O `.env` local declara `GEMINI_*`, mas não `OPENAI_API_KEY`. |
| Plataforma `C:\Users\rafae\claude-worktrees\jira-sprint` | `claude/jira-sprint-2026-09-27` @ `052327d` | Migrations do agente, Edge Function `lotti-whatsapp` e Inbox conectado. |

## Fluxo real (resumo)

- **Entrada.** A Evolution envia `MESSAGES_UPSERT` para o webhook n8n `lotti-evolution-inbound`, protegido por `headerAuth`. O n8n chama o runtime em `POST /ingest` com `x-lotti-token`. O runtime executa `normalizeEvent` e depois `lotti_agent_ingest`. O webhook só responde 200 depois que a mensagem é gravada: `workflows/lotti-agent.json` → `runtime/server.mjs:82-87` → `runtime/qualification.mjs:29-46` → `supabase/migrations/20260923120000_lotti_whatsapp_account_scope.sql:131-187`.
- **IA.** A cada 10 s, o n8n chama `/claim`, que executa `lotti_agent_claim`: reserva uma conversa e a franquia do mês. Em seguida vem `/qualify`, com 40 mensagens e até 80 imóveis da conta enviados à OpenAI. Por fim, `/deliver` executa `lotti_agent_prepare`, `lotti_agent_begin_send` e o `sendText` da Evolution, e termina com `lotti_agent_finish`. Em caso de erro, chama `lotti_agent_fail`: `runtime/server.mjs:35-70`, `20260912125137_lotti_agent_runtime.sql:125-244` e `20260912171307_lotti_agent_resume_guard.sql:25-45`.
- **Envio manual e nova conversa.** O caminho é Inbox → Edge Function `lotti-whatsapp` (o dono vem do JWT) → webhook n8n `lotti-whatsapp-connect` → runtime `/channel` → `lotti_manual_begin` → Evolution → `lotti_manual_finish`: `supabase/functions/lotti-whatsapp/index.ts:8-42`, `runtime/manual.mjs:21-46` e `20260916000100_lotti_manual_inbox.sql:60-99`.

## Validações executadas

| Comando | Resultado |
|---|---|
| Ponte: `node --test runtime/*.test.mjs` | **58/58** (bridge 5, channels 18, history 2, manual 10, openai 2, qualification 14, supabase-auth 2, today 5) |
| Ponte: `node --test evolution/history-patch.test.cjs` | 4/4. O `refresh-patch.test.cjs` falha por falta do fixture local `backups/socket-before-refresh.js`, que não está versionado e não tem relação com estas tarefas. |
| Ponte: `tests/*.sql` (`quota-and-isolation`, `delivery-races`, `runtime-transaction`) | **Não executados.** Exigem um PostgreSQL com o esquema da plataforma e contas reais, e não devem rodar em produção. Precisam de um banco de homologação. |
| Plataforma: `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key npx vitest run supabase/migrations/lotti-* supabase/migrations/public-security.test.ts supabase/functions/lotti-whatsapp` | 7 arquivos, **39 aprovados + 5 "expected fail"** (arquivo novo, abaixo) |
| Plataforma: `npx vitest run src/features/whatsapp-inbox src/pages/WhatsAppConnectionPage` (mesmas variáveis) | 14 arquivos, **87/87** |
| Verificação ad hoc em PGlite (script temporário fora do repositório, não versionado) com as 10 migrations reais do agente carregadas em ordem | **39/39 verificações confirmadas**. Os itens estão citados nas seções como "ad hoc". |

**Arquivo de teste novo:** `supabase/migrations/lotti-agent-lacunas.test.ts`. Ele carrega as mesmas 10 migrations sobre um esquema fictício e traz 5 testes `it.fails`, um para cada lacuna. As pré-condições do comportamento atual ficam no `beforeAll`, que derruba a suíte se o cenário quebrar. Troquei temporariamente `it.fails` por `it`, e os cinco falharam na asserção esperada, não por erro de harness:

- `expected 0 to be greater than 0` (fallback);
- `expected '{…}' to contain 'até 500 mil'` (lead);
- `expected null to be 'até 500 mil'` (merge);
- `expected '<id>' not to be '<id>'` (opt-out automático);
- `expected 'ready' not to be 'ready'` (opt-out manual).

Quando uma lacuna for corrigida, o `it.fails` correspondente vai acusar erro, e basta trocá-lo por `it`.

---

## SCRUM-30 — Agente: conferir configuração do canal e recebimento do webhook

**Caminho no código**

- **Canal por conta.** O `manageChannel` procura `lotti_agent_channels` por `corretor_id` (`runtime/channels.mjs:10`). Se não houver canal, cria a instância `lotti-<corretor_id>` com `enabled:false, sandbox:false` (`channels.mjs:13-16`).
- **Configuração do webhook.** No `connect`, o runtime aplica `/settings/set` e `/webhook/set` (`channels.mjs:42-45`). O webhook recebe `url=N8N_INTERNAL_WEBHOOK_URL`, com fallback para `host.docker.internal:5678/webhook/lotti-evolution-inbound`, os eventos `MESSAGES_UPSERT` (mais `MESSAGES_SET` com histórico) e o header `x-lotti-webhook: WEBHOOK_TOKEN` (`channels.mjs:20-21`). A instância nunca vem do chamador (`channels.mjs:7`, `supabase/functions/lotti-whatsapp/index.ts:18-30`).
- **Número conectado.** Com a sessão `open`, o runtime lê o número e chama `lotti_agent_bind_account`, que arquiva conversas de outro número (`channels.mjs:51-65`; `…account_scope.sql:97-117`).
- **Recebimento.** O n8n autentica o header e chama `/ingest` (`server.mjs:17-20`, que exige `AGENT_TOKEN` com 32 caracteres ou mais, e `server.mjs:82-87`). O `normalizeEvent` aceita só conversas 1:1. LID só entra com telefone mapeado; grupos e status são descartados (`qualification.mjs:29-46`). O `lotti_agent_ingest` grava a mensagem de forma idempotente, cria ou vincula o cliente da conta e pausa a IA se a mensagem vier do próprio celular ou for mídia (`…account_scope.sql:136-186`).
- **Diagnóstico.** `GET /health` expõe `configured`, `aiConfigured` e `liveSendEnabled`, sem segredos (`server.mjs:74`).

**O que os testes provam**

- `channels.test.mjs` (18/18) prova que o runtime:
  - usa só a instância registrada da conta, nunca a instância ou a URL do chamador;
  - aplica settings e webhook no connect;
  - liga ou desliga `MESSAGES_SET` conforme `HISTORY_IMPORT_ENABLED`;
  - associa o número antes de importar e não importa se a associação falhar;
  - trata queda do provedor como indisponível, não como desconexão;
  - não devolve QR vencido;
  - faz um único socket em connects simultâneos.
- `qualification.test.mjs` (14/14) cobre a normalização: não confia em URL ou apikey do payload; ignora grupo, status, LID sem mapa e outros eventos; mídia vira "requer humano"; lê a conta a partir de `sender`.
- `lotti-whatsapp-account-scope.test.ts` (10/10) cobre o arquivamento por número, o nome do contato e o registro da ponte, aceito só para `trycloudflare.com` e só pelo runtime.
- `request.test.ts` (11/11) cobre o endereço da ponte e o contrato da Edge Function.
- Ad hoc: um evento de instância não registrada é recusado (`accepted:false`) sem criar conversa.

**O que ainda precisa de teste ao vivo** (sem envio real)

- Confirmar que a credencial "Lotti Webhook" do n8n usa o header `x-lotti-webhook` com o mesmo valor de `WEBHOOK_TOKEN`. Isso não é verificável pelo Git.
- Confirmar que a Evolution alcança `N8N_INTERNAL_WEBHOOK_URL` e que uma mensagem de um número de teste aparece no Inbox da conta correta.
- Consultar `/health` no runtime em execução.
- Descobrir qual build está rodando: `main` com Gemini ou esta branch com OpenAI.

**Lacunas**

1. **`WEBHOOK_TOKEN` ausente quebra o webhook sem aviso.** Com a variável indefinida, `headers:{'x-lotti-webhook':undefined}` vira `{}` no JSON e o connect "funciona", mas o n8n recusa todas as mensagens. O `.env.example` não lista `WEBHOOK_TOKEN`, `N8N_INTERNAL_WEBHOOK_URL`, `PAIRING_UI_TOKEN` nem `BRIDGE_TUNNEL_METRICS_URL`.
2. **Não existe UI nem RPC para habilitar o canal.** O canal nasce com `enabled=false` e não há `update … set enabled`. Isso afeta dois fluxos:
   - `lotti_inbox_start_conversation` exige canal `enabled` (`20260921130000_lotti_inbox_actions.sql:18-19`). Com o canal recém-criado, "Nova conversa" e o teste de envio da Conexão retornam `channel_unavailable`. Isso pode explicar a falha de envio de teste citada no handoff; precisa ser conferido.
   - Habilitar o canal também libera a fila da IA (`…runtime.sql:134`), então o envio manual fica acoplado à IA.
3. **Descartes silenciosos.** Uma mensagem de contato `@lid` sem `remoteJidAlt` vira `{ignored:true}` (`qualification.mjs:36-37`). Uma instância não registrada vira `accepted:false` com HTTP 200. Nos dois casos não há alerta nem contagem.
4. **Chave da OpenAI ausente no `.env` desta branch.** O `.env` local tem apenas `GEMINI_*`. Se o runtime for reconstruído desta branch, `aiConfigured=false` e ocorre o laço descrito no SCRUM-32.

**Status: Parcial.** Falta conferência ao vivo do header e da credencial do webhook, da chegada de uma mensagem de teste no Inbox e do `/health`, além de definir como e quem habilita o canal (`enabled`).

---

## SCRUM-31 — Agente: testar isolamento das conversas entre imobiliárias

**Caminho no código**

- **Chave do tenant.** O tenant é `corretor_id`. A conversa é única por `(channel_id, phone)` e herda o `corretor_id` do canal (`…runtime.sql:11-29`; `…account_scope.sql:139`).
- **RLS.** Canal, conversa e mensagem são lidos só pelo dono (`…runtime.sql:64-74`). A view `lotti_agent_latest_messages` usa `security_invoker` (`20260920000100_lotti_history_import.sql:163-167`), e `lotti_inbox_events` tem policy do dono (`20260924000200_lotti_inbox_events.sql:98-103`).
- **CRM.** A captura busca e cria o cliente sempre com `corretor_id` do canal (`…account_scope.sql:156-167`). A franquia é contada por conta, com lock por conta (`…runtime.sql:140-165`).
- **Ações do usuário.** `set_mode`, `update_contact`, `set_status` e `rename` validam `auth.uid()` (`…resume_guard.sql:7`; `20260923220000_lotti_inbox_update_contact.sql:15`; `…inbox_actions.sql:40,52`).
- **Catálogo e mensagens.** O runtime carrega mensagens por `conversation_id` e imóveis por `corretor_id` do job (`server.mjs:38-42`).

**O que os testes provam**

- `lotti-inbox-actions.test.ts` (4/4): o usuário B não renomeia nem edita a conversa de A.
- `lotti-whatsapp-account-scope.test.ts` (10/10): isolamento por número dentro da conta e RPCs internas fechadas ao navegador.
- `channels.test.mjs`: só a instância registrada da conta.
- Ad hoc (17 verificações):
  - o mesmo telefone em duas contas gera duas conversas e dois cadastros, cada um na sua conta;
  - com RLS, A vê só a própria conversa, as próprias mensagens, as próprias prévias e o próprio canal; `anon` não lê nada;
  - A não altera modo, contato nem status da conversa de B;
  - evento de instância desconhecida é recusado;
  - a franquia é cobrada só da conta que processou.

**Não coberto por teste versionado executável**

- A RLS entre contas de `lotti_agent_conversations` e `lotti_agent_messages` só é testada em `n8n-agent-lotti/tests/quota-and-isolation.sql`, que exige banco real.
- A verificação ad hoc acima pode virar um teste PGlite versionado; não o adicionei porque esta tarefa só permitia criar arquivos de teste de lacuna.

**O que ainda precisa de teste ao vivo:** duas contas de teste, cada uma com seu número conectado, mandando mensagem do mesmo telefone. Conferir o Inbox, o CRM, os alertas e a franquia de cada conta.

**Lacuna menor.** `/qualify` confia no `corretor_id` do corpo que o n8n repassa do `/claim` (`server.mjs:41`). Só quem tem `AGENT_TOKEN` pode forjá-lo, mas reler o dono pela conversa no banco eliminaria essa confiança.

**Status: Parcial.** Falta versionar o teste de RLS entre contas (o roteiro ad hoc está pronto), rodar `tests/quota-and-isolation.sql` em homologação e fazer o teste ao vivo com duas contas.

---

## SCRUM-32 — Agente: validar resposta de fallback quando o provedor falha

**Caminho no código**

- Qualquer erro na chamada à OpenAI cai no `catch` de `qualify`, que chama `lotti_agent_fail(…,'qualification_failed')` e devolve 502 (`server.mjs:36-48`). Entram aqui HTTP 4xx/5xx, timeout de 55 s (`server.mjs:22`), `status≠completed`, recusa, JSON inválido ou falha de validação (`openai.mjs:20-30`, `qualification.mjs:97-110`).
- O `lotti_agent_fail` reagenda a conversa em 30 s. Na 3ª falha (`attempts>=3`), coloca a conversa em `mode='human'` e cria o alerta "Conversa precisa de revisão humana após falha no atendimento", com `priority=alta` (`…runtime.sql:231-244`). O contador `attempts` sobe a cada `claim` e volta a zero a cada nova mensagem do lead (`…runtime.sql:166`; `…account_scope.sql:176-178`).
- **Nenhuma mensagem é enviada ao lead:** não existe texto de contingência no runtime nem no banco.

**O que os testes provam**

- `openai.test.mjs` (2/2): recusa ou saída vazia gera erro em vez de texto inventado.
- `qualification.test.mjs`: evidência inventada ou falta de imóvel rebaixam a etapa.
- Ad hoc: três falhas seguidas deixam a conversa em `ai/1`, `ai/2` e depois `human/3`, com um alerta, **0 mensagens de saída e 0 registros na outbox**, e a franquia já reservada.
- **Teste de lacuna:** `lotti-agent-lacunas.test.ts` › *"ESPERADO: o lead recebe uma resposta de contingência…"*.

**Lacunas**

1. **Sem fallback para o lead.** O lead fica sem resposta. Depois de cerca de 1 a 1,5 min (3 tentativas com intervalo de 30 s e sondagem de 10 s), a conversa vai para humano apenas com um alerta. Sem o `entidade_tipo`, esse alerta não é clicável no sino (`src/lib/notificacoes.ts:82-100`). É preciso decidir entre uma mensagem curta de contingência, que passaria pela outbox para manter a idempotência, e o silêncio com repasse ao corretor.
2. **Falhas que não chamam `fail` entram em laço.** Isso inclui `ai_not_configured` (`/qualify` devolve 503 sem chamar `fail`, `server.mjs:89`), queda do runtime depois do `claim` e timeout do n8n. O lease expira em 2 min, a conversa é reservada de novo, `attempts` cresce indefinidamente e a conversa **nunca vai para humano nem gera alerta** (ad hoc: a conversa volta à fila depois que o lease expira).
3. **A franquia é consumida mesmo sem nenhuma resposta** (reserva no primeiro `claim`). Isso já está documentado em `docs/OPERACAO.md`.

**O que ainda precisa de teste ao vivo:** com um canal sandbox e uma chave inválida ou ausente, confirmar a passagem para humano e o alerta. Depois, repetir sem a variável para observar o laço.

**Status: Parcial.** Falta definir e implementar a resposta de contingência ao lead e tratar `ai_not_configured` e o lease expirado com `fail`/alerta. O comportamento atual (humano e alerta após 3 falhas) está provado.

---

## SCRUM-33 — Agente: consultar imóveis atuais da imobiliária correta

**Caminho no código.** A consulta é `imoveis?corretor_id=eq.<job.corretor_id>&ativo=eq.true&select=id,titulo,tipo,valor,bairro,cidade,dormitorios,garagem,banheiros,area_m2,finalidade,descricao_curta&limit=80` (`server.mjs:41`). O `job.corretor_id` vem do `claim` (`…runtime.sql:167`). A consulta usa a chave de serviço, então o único isolamento é o filtro `corretor_id`. A projeção explícita exclui dados do proprietário. Em canal sandbox, a lista vai vazia (`server.mjs:41`).

**O que os testes provam**

- `qualification.test.mjs` › *"requires a known property for visit qualification"*: um `propertyId` fora do contexto rebaixa a etapa.
- **A montagem da consulta não tem teste.** `qualify` não é exportado e `server.mjs` sobe o servidor ao ser importado.
- As colunas usadas existem no esquema: `20260104131559…sql:107-130`, `20260519140000_add_finalidade_and_public_policies.sql:14-24`.

**Lacunas**

1. **"Atuais" não é filtrado.** O runtime não aplica `status_venda=eq.DISPONIVEL`. Marcar um imóvel como vendido só muda `status_venda` e mantém `ativo=true` (`src/components/imoveis/VendaImovelDialog.tsx:41-45`). A consulta pública já filtra os dois campos (`supabase/functions/public-imoveis/index.ts:135-139`). O `status_venda` também não está na projeção, então o modelo não tem como saber que o imóvel foi vendido. O mesmo filtro está em `main`.
2. **Imóveis de demonstração entram no catálogo.** Os imóveis do onboarding são criados com `ativo=TRUE` e `is_sample_data` (`20260821130000_onboarding_ativacao.sql:763-777`), e o runtime não filtra `is_sample_data=eq.false`.
3. **Subconjunto arbitrário.** `limit=80` sem `order`: em contas com mais de 80 imóveis, a IA recebe um subconjunto sem critério.
4. **Sandbox não testa catálogo.** Com `sandbox`, a IA nunca vê imóveis, então a validação em sandbox não exercita esta tarefa.

**Teste proposto para a ponte** (não adicionado: repositório somente leitura). Extrair `propertyQuery(corretorId)` de `server.mjs` e verificar:

- a URL contém `corretor_id=eq.<id>`, `ativo=eq.true`, `status_venda=eq.DISPONIVEL`, `is_sample_data=eq.false` e um `order` determinístico;
- a projeção não inclui `proprietario_*` nem `endereco`;
- `qualify({corretor_id:B,…})` com um `sb` falso nunca consulta a conta A.

Alternativa na plataforma: uma RPC ou view `lotti_agent_catalog(p_corretor)` testável em PGlite.

**O que ainda precisa de teste ao vivo:** um canal de teste não sandbox com `LIVE_SEND_ENABLED=false`. A resposta fica na `lotti_agent_outbox` em `prepared`, sem envio. Cadastrar um imóvel vendido e um de demonstração e conferir se aparecem na resposta. Atenção: nesse modo a conversa é requalificada a cada 2 min (SCRUM-39).

**Status: Parcial.** Falta filtrar `status_venda`/`is_sample_data` (com ordenação), cobrir a consulta com teste automatizado e fazer o teste ao vivo em canal não sandbox.

---

## SCRUM-34 — Agente: testar resposta sem oferta ou disponibilidade inventada

**Caminho no código**

- O prompt proíbe inventar imóvel, preço, disponibilidade, condição, desconto, link ou agendamento, e manda tratar o contexto como dado (`qualification.mjs:1-10`, em especial as linhas 2, 6 e 9).
- A saída é JSON com schema estrito (`openai.mjs:3-17,24-25`).
- O `validateQualification` confere só estrutura, etapa, evidências (trechos que precisam existir nas mensagens do lead) e `propertyId` para visita (`qualification.mjs:97-110`).
- **O texto de `response` não é validado contra o catálogo.** Ele segue para a outbox como veio (`…resume_guard.sql:42-43`).

**O que os testes provam**

- `qualification.test.mjs` (14/14): evidência inventada e imóvel inexistente rebaixam a etapa; falta de orçamento impede a qualificação.
- `openai.test.mjs` (2/2): recusa ou saída vazia gera erro.
- **Nenhum teste verifica o conteúdo da resposta.**
- `scripts/smoke-openai.mjs` (modelo real, 2 fixtures) não foi executado: exige chave e chamada ao provedor. Os fixtures também não cobrem "sem oferta".

**Lacunas**

1. **Sem verificação da resposta.** Não há checagem de que valores, títulos ou links na `response` existem no contexto.
2. **Catálogo errado leva a oferta "legítima" de imóvel indisponível.** Como a IA recebe vendidos e demonstrações (SCRUM-33), a resposta pode obedecer ao prompt e ainda oferecer um imóvel que não está disponível. Essa é a principal fonte de "disponibilidade inventada" hoje.
3. **Sem avaliação com modelo real.** Não há conjunto de avaliação para perguntas sem imóvel compatível.

**Testes propostos para a ponte** (não adicionados)

- Em `qualification.test.mjs`, dado `properties:[]` e uma resposta com "R$ 450.000", ou com um título ausente do contexto, `validateQualification` deve rejeitar ou marcar para humano.
- Em `smoke-openai.mjs`, acrescentar os fixtures:
  - "tem 3 quartos no Centro por 400 mil?" com catálogo vazio: a resposta não pode conter R$ nem nome de imóvel;
  - "está disponível para visita amanhã?": a resposta não pode confirmar horário.

**O que ainda precisa de teste ao vivo:** rodar esses fixtures com o modelo real num ambiente autorizado, com dados fictícios e sem WhatsApp.

**Status: Parcial.** Falta validar o texto da resposta contra o catálogo, corrigir o catálogo (SCRUM-33) e rodar a avaliação com o modelo real.

---

## SCRUM-35 — Agente: salvar faixa de preço, prazo e necessidades no lead

**Caminho no código**

- O modelo devolve `profile.{budget,timeframe,needs,nextStep,payment,region,intent}` (`openai.mjs:9-11`). O `lotti_agent_prepare` grava o resultado inteiro em `lotti_agent_conversations.qualification` com `qualification=p_result` (`…resume_guard.sql:35`).
- Na qualificação ou no pedido de humano, cria um alerta com `metadata.qualification` (`…resume_guard.sql:36-41`).
- O cadastro `clientes` só recebe nome e telefone na captura (`…account_scope.sql:156-171`) e as mensagens em `historico_contatos`.
- O fluxo legado `crm-upsert-lead` gravava `faixa_valor_min/max`, `tempo_decisao` e `forma_pagamento` em `clientes.tracking_data` (`supabase/functions/crm-upsert-lead/index.ts:77-89`). O agente atual não faz isso.

**O que os testes provam**

- Ad hoc: o orçamento, o prazo e as necessidades ficam só em `qualification`. O `row_to_json(clientes)` não contém nenhum dos três. Um turno seguinte com `budget:null` apaga o orçamento salvo.
- **Testes de lacuna:** `lotti-agent-lacunas.test.ts` › *"orçamento, prazo e necessidades… chegam ao cadastro do lead"* e *"um turno sem orçamento não apaga o orçamento…"*.

**Lacunas**

1. **O perfil não chega ao lead.** Ele não vai para `clientes` nem para `crm_oportunidades`. Fora do Inbox não é visível nem filtrável: o alerta leva a `/clientes/:id` (`src/lib/notificacoes.ts:94-95`), página que não lê a `qualification`.
2. **O perfil é sobrescrito a cada turno, sem merge.** A continuidade depende de o modelo repetir `previousProfile` (`server.mjs:43`).
3. **Os dados continuam em texto livre.** Não há conversão para faixa numérica (`faixa_valor_min/max`).

**Status: Parcial.** Falta persistir o perfil no cadastro do lead, por exemplo em `clientes.tracking_data`, seguindo as chaves do `crm-upsert-lead`, e fazer merge dos campos não nulos em `lotti_agent_prepare`. Hoje os dados ficam só em `conversation.qualification`.

---

## SCRUM-36 — Agente: exibir histórico e próximo passo no resumo ao corretor

**Caminho no código**

- O Inbox conectado lê `qualification` (`src/features/whatsapp-inbox/ConnectedInbox.tsx:20`) e mostra:
  - "Resumo do caso", que é `qualification.reason` (linha 251);
  - etapa, temperatura e prioridade (linha 254);
  - os campos do perfil com rótulos como "Orçamento", "Prazo" e "Próximo passo" (linhas 87 e 255).
- A linha do tempo junta as 200 mensagens mais recentes com os eventos de modo, etapa e status (linhas 135-153 e 196-198).
- Na qualificação, o alerta "Lead qualificado: pronto para atendimento do corretor" aponta para `/clientes/:id`.

**O que os testes provam**

- `ConnectedInbox.test.tsx` (dentro dos 87/87) verifica que o título "Resumo do caso" existe e cobre filtros, layout e prévia.
- `lotti-inbox-events.test.ts` (3/3) prova que os eventos de modo, etapa e fechamento são gravados.
- **Nenhum teste renderiza uma `qualification` preenchida**: não há asserção de "Próximo passo", "Orçamento" nem "Prazo". Os fixtures usam `qualification: {}`.

**Lacunas**

1. **`reason` não é um resumo do histórico.** O prompt pede `reason` como motivo da classificação ou do repasse (`qualification.mjs:8`). A UI o exibe como resumo do caso, e não existe resumo gerado das mensagens.
2. **O alerta não carrega o resumo.** O texto é genérico e leva ao cadastro do cliente, que não mostra resumo nem próximo passo. Os alertas de falha e de mídia não são clicáveis.
3. **O próximo passo pode sumir.** Como o perfil é sobrescrito a cada turno (SCRUM-35), o "Próximo passo" pode desaparecer.

**Teste proposto** (UI, fora do escopo de arquivos permitido aqui). Em `ConnectedInbox.test.tsx`, montar uma conversa com `qualification:{stage:'qualificado_busca',reason:'…',profile:{budget:'até 500 mil',nextStep:'enviar opções',timeframe:'3 meses'}}` e verificar os rótulos e valores no painel "Perfil do contato".

**O que ainda precisa de teste ao vivo:** conta de teste com conversa qualificada; conferir o painel, a linha do tempo e o clique no alerta.

**Status: Parcial.** Falta teste de UI com a qualificação preenchida, um resumo de verdade (e não o `reason`) e o destino do alerta mostrando resumo e próximo passo. A exibição básica no Inbox já existe.

---

## SCRUM-37 — Mensagens: confirmar consentimento e opt-out antes do envio

**Caminho no código.** Não existe registro de consentimento nem de opt-out.

- Nenhuma coluna ou tabela nas migrations do agente e nenhuma ocorrência de `opt-out`, `descadastr` ou `unsubscribe` nos dois repositórios.
- **Envio automático.** A IA responde a toda mensagem nova de conversa em `mode='ai'` (`…runtime.sql:133-137`). O prompt não trata pedido de descadastro (`qualification.mjs:1-10`).
- **Envio manual e nova conversa.** `lotti_manual_begin` só verifica dono, sandbox e envio em andamento (`…manual_inbox.sql:64-75`). A ação `start` permite enviar para qualquer número informado pelo corretor, sem consentimento (`lotti-whatsapp/index.ts:32-38`, `…inbox_actions.sql:7-32`).
- **Disparo em massa (broadcast).** Não existe no produto. Os links `wa.me` do CRM abrem o WhatsApp do próprio usuário, fora da plataforma.

**O que os testes provam**

- Ad hoc: depois de "SAIR", a conversa continua elegível para resposta automática e o envio manual é liberado (`ready`).
- **Testes de lacuna:** `lotti-agent-lacunas.test.ts` › *"depois do 'SAIR' a IA não reserva a conversa…"* e *"…um novo envio manual não é liberado…"*.

**Lacunas**

1. **Opt-out.** Falta detectar o pedido de descadastro (palavra-chave determinística e/ou campo do modelo), gravar o bloqueio por conta e telefone e verificá-lo em `lotti_agent_claim`, `lotti_manual_begin` e `lotti_inbox_start_conversation`.
2. **Consentimento.** Falta registrar a base de consentimento para conversas iniciadas pelo corretor (`start`) e decidir como tratar o contato que volta a escrever depois do opt-out.
3. **Risco adicional.** O canal é Baileys, ou seja, WhatsApp Web não oficial. Sem as regras de opt-in da API oficial, a proteção fica inteiramente na plataforma.

**Status: Bloqueado.** Precisa de uma definição de produto/LGPD da regra de consentimento e opt-out e da implementação nas três RPCs. Nada existe hoje; os testes de lacuna já descrevem o comportamento esperado.

---

## SCRUM-39 — Mensagens: testar nova tentativa sem duplicar o envio

**Caminho no código**

- **Automático**, em quatro camadas:
  - a outbox tem `unique(conversation_id,revision)` e os estados `prepared → sending → sent|uncertain` (`…runtime.sql:47-56`);
  - o `begin_send` só libera `prepared` com lease válido (`…runtime.sql:192-211`);
  - erro ou timeout no envio marca `uncertain` e move a conversa para humano (`server.mjs:66-68`, `…runtime.sql:236-239`);
  - um worker que cai durante o `sending` tem o registro colocado em quarentena como `uncertain` no próximo `claim`, **nunca reenviado** (`…runtime.sql:129-132`). O eco da Evolution é conciliado pelo `external_id` (`…account_scope.sql:144-154`).
- **Webhook repetido:** `unique(conversation_id,external_id)` (`…runtime.sql:38`).
- **Manual**, também em camadas:
  - o `request_id` é chave, com `fingerprint`. Um pedido repetido devolve o status anterior sem enviar, e o mesmo id com conteúdo diferente gera `request_conflict` (`…manual_inbox.sql:69-73`);
  - um segundo envio concorrente devolve `busy` (`:74-75`);
  - um `sending` com mais de 2 min vira `uncertain` (`:68`);
  - o runtime marca `uncertain` quando o envio já foi disparado (`manual.mjs:39,45`);
  - a UI reaproveita o mesmo `request_id` em "Verificar envio" (`MessageComposer.tsx:43-56,61-62`).

**O que os testes provam**

- `manual.test.mjs` (10/10): pedido duplicado ou incerto nunca é reenviado; timeout vira `uncertain` sem nova tentativa automática.
- `MessageComposer.test.tsx` › *"reuses the same request after timeout rather than sending a duplicate"*.
- Ad hoc (11 verificações contra as migrations reais):
  - 10 webhooks iguais geram 1 mensagem;
  - um 2º `begin_send` da mesma revisão é cancelado;
  - lease expirado durante o `sending` gera `uncertain` e move a conversa para humano;
  - `request_id` repetido é tratado como duplicado; conteúdo diferente gera conflito; envio concorrente devolve `busy`;
  - nova tentativa de pedido incerto devolve `uncertain` sem liberar envio.
- `n8n-agent-lotti/tests/delivery-races.sql` cobre eco antecipado e intervenção durante o envio, mas não foi executado (exige banco real).

**Lacunas** (não geram duplicidade, mas afetam a operação)

1. **Não há conciliação de entrega incerta.** Não existe RPC nem UI para isso (ad hoc: nenhuma função `reconcil*`). Enquanto houver algo `uncertain`, a conversa fica **permanentemente** impedida de:
   - voltar para a IA (`reconcile uncertain delivery first` e `manual_delivery_pending`, `…resume_guard.sql:8`, `…manual_inbox.sql:104-109`);
   - ter o telefone corrigido (`delivery_pending`).

   Além disso, o composer fica travado em "Verificar envio" até recarregar a página.
2. **Requalificação em laço com `LIVE_SEND_ENABLED=false`.** Em canal habilitado e não sandbox, o `begin_send` devolve `blocked` sem soltar o lease. A cada 2 min a conversa é reservada e requalificada, com nova chamada à OpenAI (ad hoc: `attempts=2` após a expiração). Não há duplicidade de envio, mas há custo contínuo.
3. **O `deliver` automático não tem teste de unidade** para "Evolution respondeu, mas `finish` falhou" (`server.mjs` não é testável). O comportamento esperado já é `uncertain`.

**Status: Concluído** no requisito "sem duplicar". Testes: runtime `manual.test.mjs` 10/10, `MessageComposer.test.tsx` (reuso do `request_id`) e verificação PGlite ad hoc 11/11 contra as migrations reais. Ficam como pendências separadas a conciliação de entrega incerta, o laço com `LIVE_SEND` desligado e rodar `delivery-races.sql` em homologação.

---

## SCRUM-40 — Mensagens: confirmar isolamento do envio por imobiliária

**Caminho no código**

- O dono vem só do JWT verificado (`lotti-whatsapp/index.ts:8-21`). O corpo repassado à ponte usa `corretor_id: owner.id` (`index.ts:30`).
- O `lotti_manual_begin` exige `corretor_id=p_owner` na conversa. A instância e o telefone vêm do banco, não do chamador (`…manual_inbox.sql:64-80`; `manual.mjs:26,32,42`).
- **Automático.** A instância e o telefone vêm da conversa e do canal no `begin_send` (`…runtime.sql:210`; `server.mjs:58-61`).
- Existe uma instância Evolution por conta, `lotti-<corretor_id>` (`channels.mjs:14`). Um canal arquivado é `sandbox`, e o envio manual por ele é recusado (`…manual_inbox.sql:67`).
- As RPCs de envio são `service_role` apenas (`…manual_inbox.sql:100-101`; `…runtime.sql:259-260`).

**O que os testes provam**

- `manual.test.mjs`: o destino vem da conversa do dono (ignora `phone` e `instance` enviados); dono cruzado é recusado antes de storage ou provedor (com mock); caminho de arquivo de outro dono é bloqueado.
- `channels.test.mjs`: só a instância registrada.
- `request.test.ts`: o `start` monta o envio com o id do dono.
- Ad hoc (5 verificações):
  - A tentando enviar na conversa de B gera `forbidden`;
  - `begin` devolve a instância e o telefone da própria conta;
  - `begin_send` e o `claim` usam a instância do canal da conversa (`lotti-b` para B);
  - RPCs de envio negadas para `authenticated`.

**O que ainda precisa de teste ao vivo:** dois números conectados em contas diferentes; enviar manualmente de cada conta e conferir o remetente. Isso depende do envio real, **SCRUM-38**, fora deste escopo.

**Status: Parcial.** Falta teste ao vivo com dois números (depende do SCRUM-38) e versionar a verificação SQL de `lotti_manual_begin` entre contas. No código e nas RPCs, o isolamento está provado.

---

## Resumo

| Tarefa | Status | Principal pendência |
|---|---|---|
| SCRUM-30 | Parcial | Conferência ao vivo do webhook e da credencial; o canal nasce `enabled=false`, sem UI (o `start` exige `enabled`); `WEBHOOK_TOKEN` ausente quebra o webhook sem aviso |
| SCRUM-31 | Parcial | Versionar o teste de RLS entre contas; teste com duas contas reais |
| SCRUM-32 | Parcial | Laço corrigido (ver Correções); falta decidir a mensagem de fallback ao lead |
| SCRUM-33 | Parcial | Filtro e teste corrigidos na ponte (ver Correções); falta o teste ao vivo em canal não sandbox |
| SCRUM-34 | Parcial | `response` não é validada contra o catálogo; sem avaliação com modelo real |
| SCRUM-35 | Parcial | Perfil só em `conversation.qualification`, sobrescrito a cada turno |
| SCRUM-36 | Parcial | Sem teste de UI com perfil; `reason` ≠ resumo; alerta leva a tela sem resumo |
| SCRUM-37 | Parcial | Opt-out implementado (ver Correções); falta a regra de consentimento para conversas iniciadas pelo corretor |
| SCRUM-39 | Concluído | Sem duplicidade; pendentes a conciliação de `uncertain` e o laço com `LIVE_SEND` desligado |
| SCRUM-40 | Parcial | Teste ao vivo com dois números (depende do SCRUM-38) |

## Correções (2026-09-27, Claude)

Nada foi aplicado em produção nem publicado, e nenhuma mensagem foi enviada.

- **SCRUM-32, conversa presa.** A migration `20260927120000_lotti_agent_stalled_claims.sql` cria `lotti_agent_escalate_stalled()`, restrita ao `service_role`. Na 3ª reserva abandonada (lease vencido sem `fail`), a conversa vai para a equipe com alerta clicável e `last_error='processing_stalled'`. A ponte (branch `claude/agent-catalog-stalled`, commit `b280faa`) chama essa função antes de cada `claim` e, sem chave da IA, registra `fail('ai_not_configured')` antes do 503. Em banco sem a função, a reserva segue como antes. **Continua pendente** a decisão sobre a mensagem de fallback ao lead: hoje o repasse é silencioso.
- **SCRUM-33, catálogo.** A ponte passou a filtrar `status_venda=eq.DISPONIVEL` e `is_sample_data=eq.false` e a ordenar por `updated_at.desc`. Em bancos sem a coluna de demonstração (migration de onboarding ainda não aplicada), o filtro é pulado e tentado de novo a cada 10 min. A consulta tem teste (`runtime/catalog.test.mjs`).
- **SCRUM-37, opt-out.** A migration `20260927120100_lotti_agent_opt_out.sql` faz o seguinte:
  - reconhece "SAIR", "PARE", "PARAR", "STOP", pedidos de descadastro e frases explícitas sobre mensagens ou lista, sem confundir com "quero sair do aluguel";
  - marca `opted_out_at`, tira a conversa da IA, cancela a resposta preparada, registra o evento `consent` e avisa a equipe;
  - bloqueia religar a IA (`contact_opted_out`) e o envio manual até o lead escrever de novo;
  - permite ao dono liberar o contato com `lotti_inbox_clear_opt_out`, que registra o evento e não religa a IA sozinho.

  No histórico importado, só o pedido mais recente vale e pedidos antigos não geram alerta. O Inbox mostra "Não quer receber", um aviso com "Liberar contato", a IA bloqueada e o compositor oculto enquanto houver bloqueio. **Pendentes:**
  - a regra de consentimento para conversas iniciadas pelo corretor;
  - os Disparos futuros filtrarem `opted_out_at`;
  - a branch LID levar `opted_out_at` ao juntar conversas (`lotti_agent_merge_conversation`).
- **Testes.** `lotti-agent-protecoes.test.ts` tem 30 testes. As duas lacunas de opt-out em `lotti-agent-lacunas.test.ts` viraram `it`; seguem como falha esperada o fallback e os dois do perfil do lead. Soma-se o Inbox, com 3 testes de tela e 3 da regra (`optOut.test.ts`). Na ponte são 65/65.

## Como reproduzir

```bash
# Ponte (somente leitura)
cd C:/Users/rafae/n8n-agent-lotti && node --test runtime/*.test.mjs
# Plataforma
cd C:/Users/rafae/claude-worktrees/jira-sprint
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key \
  npx vitest run supabase/migrations/lotti-* supabase/functions/lotti-whatsapp src/features/whatsapp-inbox
```
