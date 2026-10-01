# Erros e ajustes reportados — para uma correção geral

Levantado em 2026-10-01, durante o uso real. Cada item traz a causa já diagnosticada, para a correção não precisar redescobrir.

---

## 1. Enviar mensagem demora ~3 segundos

**Causa, em duas partes.** O compositor só limpa o campo depois que a ponte confirma o envio — decisão consciente, por causa de entrega incerta. E a função faz duas idas e voltas de rede antes de falar com a ponte: `db.auth.getUser(token)` e a consulta a `corretores`.

**Conserto.** Envio otimista: o balão aparece na conversa na hora, marcado como enviando, e muda de estado quando a confirmação chega. A proteção contra duplicado continua intacta — ela vem do `request_id`, não da espera. Em segundo plano, verificar o JWT localmente em vez de chamar o serviço de auth a cada mensagem.

**Arquivos.** `src/features/whatsapp-inbox/MessageComposer.tsx`, `supabase/functions/lotti-whatsapp/index.ts`.

---

## 2. Painel do perfil do contato ficou desequilibrado

**Causa.** Na remoção de Atribuição, Tags e Notas internas (que só funcionavam em demonstração), o que sobrou não foi reequilibrado. A linha do tempo virou parágrafo solto, "Qualificação comercial" ficou com uma etiqueta órfã no vazio, e "Abrir cadastro do cliente" ficou um link cru sublinhado, sem peso de ação.

**Conserto.** Redesenhar o painel com o conteúdo que de fato existe: contato, resumo da IA, linha do tempo e qualificação. Dar hierarquia e espaçamento consistentes, e transformar "Abrir cadastro do cliente" em ação de verdade.

**Arquivo.** `src/features/whatsapp-inbox/ConnectedInbox.tsx`, bloco `<aside aria-label="Perfil do contato">`.

---

## 3. "Exibindo as 200 mensagens mais recentes" aparece no lugar errado

**Causa.** O aviso é sobre o corte do histórico **antigo**, mas é renderizado no fim da lista, junto da mensagem mais nova — onde não há corte nenhum. Ainda disputa espaço com o compositor.

**Conserto.** Mover para o topo da conversa, onde o corte está, com estilo discreto. Ou remover.

**Arquivo.** `ConnectedInbox.tsx`, linha do `{messages.data?.length === 200 && ...}`.

---

## 4. A pilula "ETAPA" mostra um rótulo que não existe no funil

**Causa.** O código mistura dois vocabulários diferentes e inventa um terceiro:

```js
{stages[q?.stage ?? ''] ?? (selected.cliente_id ? 'Em atendimento humano' : 'Sem cliente vinculado')}
```

`stages` é a **qualificação da IA** (`pre_qualificacao`, `qualificando`, `qualificado_busca`, `qualificado_visita`). O funil do CRM tem outro conjunto: Novo lead, Primeiro contato, Em qualificação, Qualificado, Visita agendada, Proposta enviada. E "Em atendimento humano" não é etapa de lugar nenhum — é só o texto que sobra quando a IA ainda não qualificou.

Observado na conversa do contato final 6396: pilula dizia "Em atendimento humano" enquanto a conversa estava em modo IA. O rótulo não descreve nem o funil nem o modo.

**Conserto.** Decidir o que a pilula representa e mostrar só isso. Se é etapa, deve vir do funil do cliente vinculado. Se é qualificação da IA, mudar o rótulo de "ETAPA" para algo honesto. Nunca inventar um valor que não existe em nenhum dos dois.

**Arquivo.** `ConnectedInbox.tsx`, `const stages` e `data-testid="conversation-stage-pill"`.

---

## 5. Imagem recebida não aparece como imagem

**Causa, nas duas pontas.** No front, `MessageBody` trata três casos: áudio vira `🎤 texto`, arquivo vira cartão com link, o resto vira texto puro — imagem nunca é renderizada. E na ponte, a mídia que **chega** não é baixada, só rotulada ("foto", "áudio", "documento"), então o arquivo nem existe do nosso lado.

Arquivo que o corretor **envia** funciona: fica em `lotti-inbox-files` com URL assinada.

**Conserto.** Ponte: baixar e guardar a mídia recebida. Front: renderizar imagem inline, com clique para ampliar.

**Arquivos.** `ConnectedInbox.tsx` (`MessageBody`), e o runtime da ponte no repositório `n8n-agent-lotti`.

---

## 6. A função colapsa quatro causas diferentes num único 503

**Causa.** `lotti-whatsapp` devolve o mesmo `connection_service_unavailable` para situações que pedem consertos opostos:

```js
catch { ... return 503 }        // ponte inalcançável (URL errada, rede)
if (!response.ok) return 503    // ponte recusou (token errado)
if (!estadoValido) return 503   // ponte respondeu estado inesperado
if (!url || !secret) return 503 // segredo ausente
```

Isso transformou o diagnóstico de 2026-10-01 numa eliminação de hipóteses que durou horas. Com códigos distintos, a primeira captura de rede teria resolvido em segundos.

**Conserto.** Códigos separados (`bridge_unreachable`, `bridge_rejected`, `bridge_bad_state`, `bridge_not_configured`), e a tela dizendo o que cada um significa para o corretor.

**Arquivo.** `supabase/functions/lotti-whatsapp/index.ts`.

---

## 7. O token da ponte vive em dois lugares e nada confere

**Causa.** O mesmo segredo existe no Supabase (`LOTTI_CHANNEL_BRIDGE_TOKEN`) e na credencial `Lotti Connection Bridge` do n8n. Nada no sistema percebe quando divergem — só o corretor, quando clica e não funciona. Divergiu duas vezes em dois dias.

**Conserto.** Uma verificação de alinhamento que não exponha o valor: hash do token com um sufixo combinado, comparado entre os dois lados. Pode viver num endpoint de diagnóstico ou na tela de Conexão.

---

## 8. "IA desligada por Sistema" sem dizer o motivo

**Causa.** A conversa registra o evento, mas a tela não explica por quê. No caso observado, o motivo estava em `last_error`:

```
no_active_entitlement
```

A conta não tem assinatura ativa (zero registros em `subscriptions`), e o agente verifica o plano antes de reservar a conversa. Também desliga a IA quando o corretor envia mensagem — isso é por projeto, mas igualmente mudo na tela.

**Conserto.** O evento deve carregar e exibir o motivo: plano sem direito ativo, intervenção humana, opt-out, reserva abandonada. Hoje o corretor vê a IA desligar sozinha e conclui que é defeito.

**Arquivos.** `ConnectedInbox.tsx` (`eventText`), e a origem do evento nas migrations do agente.

---

## 9. A conversa não desce sozinha quando chega mensagem nova

**Causa.** A regra certa já existe: `followLatest` vira verdadeiro quando o corretor está a menos de 80px do fim e falso quando ele sobe para ler o histórico. O defeito é o gatilho do efeito:

```js
useLayoutEffect(() => {
  if (el && followLatest.current) el.scrollTop = el.scrollHeight;
}, [selected?.id, timeline.length]);
```

Ele depende do **comprimento** da lista. A consulta devolve no máximo 200 mensagens, então em conversa que bateu o teto a mensagem nova entra e a mais antiga sai: o comprimento continua 200, o efeito não roda, a tela não desce. Em conversa curta funciona; em conversa longa, nunca — e é justamente a conversa longa que o corretor usa o dia inteiro.

**Conserto.** Depender de algo que de fato muda a cada mensagem — o identificador ou o horário do último item da lista — em vez do comprimento. O comportamento desejado continua o mesmo: desce se o corretor está no fim, não desce se ele subiu para ler.

**Arquivo.** `ConnectedInbox.tsx`, o `useLayoutEffect` do `timelineRef`.

---

## Contexto que a correção precisa saber

- O canal de produção é a instância `lotti-agent`, número terminado em **2643**. As conversas estão amarradas a ele.
- O funil real da conta: Novo lead, Primeiro contato, Em qualificação, Qualificado, Visita agendada, Proposta enviada.
- Conversa com número passou a entrar no CRM automaticamente em `QUALIFICACAO` (migration `20260930190000`, aplicada em produção).
- A conta de teste não tem assinatura, o que bloqueia o agente de IA independentemente de configuração.
