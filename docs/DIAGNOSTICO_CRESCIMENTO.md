# Diagnóstico de Crescimento — Gabriel Trindade

## Projeto e escopo

Módulo aditivo para a aplicação React 18 + TypeScript + Vite 6. Reutiliza Tailwind/shadcn, React Router, React Query, Zod, Supabase Auth, o backoffice e o provedor Gemini existente. Nenhuma dependência de produção foi adicionada. O Git local contém alterações anteriores de parceiros, suporte e Inbox, preservadas durante este trabalho.

O checkout possui configuração SPA Vercel; o handoff mais recente relata produção em Railway. Este módulo não muda o provedor de hospedagem. A captura imobiliária existente alimenta o CRM dos corretores e não é adequada para os leads da prestação de serviços de Gabriel: as tabelas `diagnostic_*` mantêm os dois usos separados.

## Rotas e arquitetura

- `/diagnostico`: conversa pública, sem cadastro.
- `/diagnostico/privacidade`: finalidade e funcionamento da captura.
- `/admin/diagnosticos`: filtros, métricas, origem e qualificação, com os papéis administrativos existentes.
- `/admin/diagnosticos/:id`: resumo, contato, respostas, notificações e eventos.

```text
Chat React → POST diagnostic → validação + motor de regras
                                  ↓
                          RPC transacional Postgres
                          respostas + lead + eventos + outbox
                                  ↓
                       notificação inicial única por sessão

Conclusão → score + resumo por regras → IA opcional com orçamento
                   ↓                          ↓ falha
            resumo persistido ←───────── fallback
                   ↓
        notificação final única + resultado + CTA
```

O UUID da sessão não é sua credencial. Um token aleatório separado é salvo somente no navegador; o banco recebe apenas seu hash SHA-256. As respostas pessoais são recuperadas do servidor. Não há `beforeunload`, persistência fictícia nem dependência do navegador aberto para guardar respostas enviadas.

O aceite aparece antes da primeira resposta pessoal. A confirmação de envio acontece somente depois do commit no banco. Erros mantêm a resposta no campo e oferecem nova tentativa. Editar uma resposta anterior invalida as etapas posteriores para impedir dados de ramos incompatíveis.

## Railway (API Lotti)

Desde a virada, a produção usa a API. O front escolhe sozinho: com `VITE_API_URL`, chama a API; sem ela, as Edge Functions abaixo.

- Banco: migration `api/prisma/migrations/20261008120000_diagnostico_conversacional` (o mesmo SQL das duas migrations do Supabase).
- Conversa: `POST /api/publico/diagnostico`, CORS público sem credenciais. Mesmo corpo, mesmos status e respostas `{ error }`.
- Worker: `POST /api/diagnostico/manutencao` com `Authorization: Bearer $DIAGNOSTIC_WORKER_SECRET` e `{ "action": "maintenance" }`.
- Painel: `GET /api/admin/diagnosticos-crescimento` (RPC `diagnostic_admin_list`) e `GET /api/admin/diagnosticos-crescimento/:id`, como `authenticated` com `is_admin()`.
- Variáveis: limite por IP com `DIAGNOSTIC_RATE_LIMIT_SECRET` ou `PUBLIC_RATE_LIMIT_SECRET`; IA com `DIAGNOSTIC_AI_ENABLED`, `DIAGNOSTIC_AI_DAILY_LIMIT` e `GEMINI_API_KEY`. O e-mail só sai com `DIAGNOSTIC_NOTIFICATIONS_ENABLED=true`, além de `EMAIL_API_KEY`/`RESEND_API_KEY`, `EMAIL_FROM`, `LEAD_NOTIFICATION_EMAIL` e, opcional, `DIAGNOSTIC_PUBLIC_URL`. O interruptor nasce desligado e a fila fica `pending`.
- Linhas gravadas no Supabase antes da troca: `COPIAR_TABELAS=diagnostico node api/scripts/dados/copiar.mjs` (com `DESTINO_URL`). Copia só as nove tabelas `diagnostic_*`, com `ON CONFLICT DO NOTHING`, e pode rodar mais de uma vez.

## Banco

Aplicar na ordem:

1. `supabase/migrations/20261007191137_diagnostic_conversational_mvp.sql`
2. `supabase/migrations/20261007191140_diagnostic_admin.sql`

Dependência: papéis Supabase `anon`, `authenticated`, `service_role` e a função de autorização `public.is_admin()` já utilizada pelo projeto.

| Tabela | Conteúdo |
|---|---|
| `diagnostic_leads` | Nome, telefone/e-mail, empresa, segmento, cidade e estado comercial |
| `diagnostic_sessions` | Sessão, hash do token, consentimento, origem, UTMs, datas, versão, score e temperatura |
| `diagnostic_answers` | Pergunta, resposta JSON, posição e timestamps; uma resposta vigente por pergunta |
| `diagnostic_events` | Início, nome, contato, respostas, conclusão, CTA e abandono |
| `diagnostic_summaries` | Resumo, gargalos, próximo passo, mensagem pública, origem rules/ai e payload |
| `diagnostic_notifications` | Fila durável, chave única sessão/tipo, tentativas, lease e resultado |
| `diagnostic_rate_limits` | Contadores por IP em hash, sessão e limite global |
| `diagnostic_ai_usage` | Reserva única de IA por sessão |
| `diagnostic_ai_budgets` | Contador diário atômico de chamadas |

Estados da sessão: `started`, `contact_captured`, `in_progress`, `completed`, `abandoned`. O lead nasce como `lead_iniciado` assim que o contato é recuperável e passa a `qualificado` na conclusão. Abandono significa 24 horas sem atividade; a leitura administrativa reconhece esse estado mesmo antes da manutenção, e a retomada o reverte.

Todas as tabelas têm RLS. `anon` não lê nem escreve. O acesso administrativo exige `is_admin()`; as funções de mutação ficam restritas à service role. A função pública verifica o token antes de retornar a conversa. Score, temperatura e notas internas não integram a resposta ao visitante.

## Configuração

Frontend: reutilizar `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Nenhuma chave de IA/e-mail deve ter prefixo `VITE_`.

Configurar exclusivamente nos secrets das Edge Functions:

| Variável | Uso |
|---|---|
| `LEAD_NOTIFICATION_EMAIL` | Destinatário operacional das notificações de lead |
| `EMAIL_PROVIDER` | `resend` |
| `EMAIL_API_KEY` | Chave de envio; alias `RESEND_API_KEY` aceito |
| `EMAIL_FROM` | Remetente verificado no Resend |
| `DIAGNOSTIC_PUBLIC_URL` | Origem pública HTTPS para links do painel |
| `DIAGNOSTIC_WORKER_SECRET` | Credencial exclusiva do worker de manutenção e reenvio |
| `DIAGNOSTIC_AI_ENABLED` | `true` habilita enriquecimento; desligada mantém regras |
| `DIAGNOSTIC_AI_DAILY_LIMIT` | Limite diário de chamadas, limitado a 1000 pelo banco |
| `GEMINI_API_KEY` | Provedor já existente, usado somente no backend |
| `LOTTI_AI_FAST_MODEL` | Modelo configurado pelo gateway existente |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Disponibilizadas pelo Supabase |

O adaptador de e-mail usa HTTP e não exige SDK novo. `EmailConfig` isola provedor, credencial, remetente e destino. Resend é a implementação efetiva do MVP; SMTP pode ser acrescentado por outro adaptador, sem trocar persistência ou templates. Convites Supabase Auth existentes não são reutilizados para mensagens comerciais.

## Fluxo declarativo

Fonte: `supabase/functions/_shared/diagnostic/questions.ts`, compartilhada pelo frontend e servidor.

Núcleo: nome → WhatsApp ou e-mail → empresa/projeto → segmento → receita → aquisição → mídia paga → investimento quando aplicável → conteúdo quando aplicável → gargalo → objetivo de 90 dias → urgência → decisão → interesse em conversar.

- Geral: 13–14 respostas.
- Negócios locais: cidade e oferta; 14–15 respostas.
- SaaS: modelo B2B/B2C, ticket, receita recorrente e CAC opcional; até 15 respostas. Investimento/conteúdo são substituídos por perguntas do produto.
- Imobiliário/construção: tipo de operação, corretores e imóveis para imobiliária, entrada dos leads, atribuição, tempo de resposta e acompanhamento de visita/proposta/venda. 18–21 respostas. É a exceção explícita ao fluxo habitual curto para manter a profundidade solicitada.

Não existem perguntas adicionais geradas por IA neste MVP. A sequência é determinística e finita. A fase seguinte pode introduzir até duas perguntas complementares validadas, mantendo o limite global.

## Lead scoring

| Sinal | Pontos |
|---|---:|
| Investe em mídia paga | 3 |
| Receita na faixa de R$50 mil ou superior | 3 |
| Urgência agora ou até 30 dias | 2 |
| Decide ou participa da decisão | 2 |
| Gargalo conhecido | 2 |
| Aceita conversar | 2 |
| Conteúdo ao menos semanal | 1 |
| Sinais de operação estruturada | 1 |

`COLD`: 0–5; `WARM`: 6–10; `HOT`: 11–16. Estrutura considera equipe/CRM/funil ou SaaS com receita. A classificação é operacional e não promete capacidade de compra ou resultado financeiro. O visitante recebe uma leitura dos gargalos e próximo passo, sem pontuação.

## IA e falhas

O diagnóstico funciona integralmente com regras. O enriquecimento usa o Gemini existente, uma reserva no Postgres por sessão e teto diário atômico, timeout de 8 segundos, resposta limitada a 700 tokens e JSON validado. Nome, contato, empresa e cidade são excluídos dos campos enviados ao modelo; textos livres ainda podem conter dados inseridos pelo próprio visitante.

O limite diário de chamadas é um orçamento operacional conservador; não é um teto exato de cobrança em moeda. Falha do modelo, JSON inválido, falta de configuração ou orçamento esgotado preservam o resumo por regras. A IA não escolhe a próxima pergunta, altera pontuação ou obriga um contato recusado.

## Notificações e operação

As notificações são criadas na mesma transação da captura/conclusão. `UNIQUE(session_id, kind)` evita novos e-mails a cada resposta. O worker usa claim com lease e idempotência do Resend, com retentativas limitadas dentro da janela de deduplicação. Falhas nunca apagam leads. Aceitação pelo provedor não equivale a entrega na caixa de entrada.

Publicar `diagnostic` e `diagnostic-notifications` depois das migrations. `verify_jwt=false` é intencional: a primeira usa token de sessão, a segunda usa segredo interno. O painel usa `diagnostic-admin`: o servidor valida a sessão e os papéis atuais na API Railway (`/api/admin/papeis`), aceita apenas admin/super_admin e consulta RPCs privadas. Sessões Supabase existentes também são verificadas pela mesma API. Configure `DIAGNOSTIC_AUTH_API_URL` com a URL HTTPS da API. RLS permanece ativa, sem acesso público aos leads. Não executar um `db push` amplo neste repositório sem reconciliar as migrations anteriores já registradas no handoff.

Agendar a execução do worker a cada minuto com a credencial interna, usando `supabase/operations/diagnostic-notifications-cron.sql` e Supabase Vault. Após 10 minutos sem atividade, sessões com contato geram um e-mail parcial com todas as respostas salvas (normalmente em 10–11 minutos, sujeito à disponibilidade do provedor). Cada sessão recebe no máximo uma notificação inicial, uma parcial por abandono e uma final. Retomar a conversa adia um parcial ainda não enviado; concluir cancela o parcial pendente. A manutenção marca abandonos, limpa contadores vencidos e processa notificações pendentes. Sem agendamento, a persistência continua funcionando; reenvio após falha e marcação materializada de abandono dependem da próxima execução. Nunca expor o segredo do cron no browser ou em arquivos versionados.

## Analytics

Os eventos são próprios e persistidos no banco. O painel apresenta início, contato recuperável, conclusão, abandono, CTA, temperaturas e qualidade por origem. As métricas respeitam os filtros e não dependem de carregar todas as linhas no browser. O abandono por pergunta mostra a última resposta salva, não afirma que essa pergunta causou a saída.

UTMs (`source`, `medium`, `campaign`, `content`, `term`) são capturadas no início. O referrer é guardado sem query string ou fragmento. A gravação de sessão do Clarity não inicia nas páginas públicas do diagnóstico; a conversa também é mascarada para navegações internas com o script já carregado. A taxa de visitantes que iniciam exige um denominador de visualizações consentidas da entrada, a adicionar numa fase de analytics.

## QA e publicação

O relatório de execução fica em `docs/DIAGNOSTICO_QA.md`. Testes de banco usam PostgreSQL/PGlite com as migrations reais. O teste do navegador usa a interface real e o handler real com banco local; provedores externos são controlados no ambiente de teste, sem enviar dados fictícios para clientes.

Confirmar em ambiente publicado: migrations aplicadas, functions ativas, secrets de e-mail, remetente validado, destinatário, cron autenticado, papéis administrativos e entrega dos e-mails inicial, parcial e final. Não declarar entrega real a partir de mock, fila ou HTTP 200 do provedor.

## Próximas fases

1. Até duas perguntas complementares por IA com schema e orçamento separados; avaliar a qualidade com diagnósticos autorizados.
2. Webhooks assinados via outbox para n8n, CRM, Lotti, WhatsApp e Meta CAPI, com consentimento específico quando necessário.
3. Retenção e exclusão operacionais, registro de entrega/bounce e alertas para filas com falha.
4. Testes A/B de extensão do fluxo imobiliário e medição consentida de visitas à entrada.

Referências oficiais consultadas: [segurança de Edge Functions](https://supabase.com/docs/guides/functions/auth), [envio com Resend](https://resend.com/docs/api-reference/emails/send-email), [idempotência de e-mails](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Acompanhamento comercial

O painel permite abrir WhatsApp ou um rascunho de e-mail, consultar a conversa inteira e registrar etapa (novo, contatado, reunião, ganho, perdido) e anotações privadas. Nenhuma mensagem é enviada automaticamente ao clicar no contato. O backend valida as alterações e registra evento de acompanhamento. As notas não entram em notificações ao visitante nem na listagem geral.
