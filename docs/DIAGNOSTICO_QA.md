# QA — Diagnóstico de Crescimento

## Executado em 2026-10-07

- `npm run build`: aprovado (Vite, build de produção).
- ESLint nos arquivos do diagnóstico, no motor, handler, worker e rotas administrativas: aprovado.
- Testes direcionados: 14/14 aprovados em quatro arquivos.
- PGlite executou as duas migrations reais, sem aplicar migrations em produção.
- Navegador Playwright: rotas `/diagnostico` e `/diagnostico/privacidade` retornaram HTTP 200 em 375, 390, 430 e 1440 px; documento sem overflow horizontal; sem erros de JavaScript.
- A tela inicial, o aviso de falha de conexão e o link de privacidade foram conferidos visualmente em 390 px (`tmp/diagnostic-390.png`).
- `git diff --check`: aprovado.
- `npm run typecheck`: não passou, por erros anteriores de schema/tipos do Supabase e módulos existentes. O relatório completo deve ser consultado no terminal desta execução; erros fora do diagnóstico não foram corrigidos neste escopo.

## Cenários de fluxo

| Cenário | Resultado | Limite do teste |
|---|---|---|
| Iniciar, responder nome + telefone e abandonar | Handler HTTP + PostgreSQL/PGlite confirmaram lead `lead_iniciado`, sessão `contact_captured`, outbox inicial única, manutenção marca `abandoned` após 24 h e retomada restaura as respostas | O e-mail permaneceu na fila: este checkout não tem `VITE_SUPABASE_URL` nem segredo de Resend configurados. O destinatário foi informado pelo operador; entrega em caixa de entrada não foi testada. |
| Completar diagnóstico imobiliário | Conversa real do handler contra as migrations: branch de imobiliária, equipe/imóveis, entrada e controle de lead; sessão `completed`; score HOT 16; resumo por regras; UTMs persistidas; exatamente uma notificação `started` e uma `completed` na outbox | Provedor de IA e envio de e-mail externos não foram invocados. O resumo por regras é o fallback de produção quando IA está indisponível. |
| Selecionar prestação de serviços | Branch de negócio local solicita cidade e oferta e prossegue para faturamento; perguntas imobiliárias ausentes | Executado via handler e regra declarativa. |
| Atualizar/retomar sessão | Leitura `resume` no handler recuperou nome e telefone do servidor após estado `abandoned` | Testada diretamente contra PostgreSQL/PGlite; a UI demonstra uso da mesma ação ao remontar a rota. |
| API de IA indisponível | Testes verificaram resumo de regras quando IA está desligada, o orçamento não permite chamada ou o provedor lança erro | Falha injetada; nenhuma chave/consumo de API externa. |
| Email inicial e conclusão | Inserção transacional e unicidade por sessão/tipo verificadas na outbox | Destinatário informado; falta credencial do provedor e configuração remota; confirmação de recebimento real segue pendente. |

## Requer configuração antes de produção

1. Definir secrets das Edge Functions para e-mail e, caso seja usado, IA. Usar o destinatário informado pelo operador em `LEAD_NOTIFICATION_EMAIL`; o remetente também precisa estar verificado no provedor.
2. Configurar `DIAGNOSTIC_WORKER_SECRET` e agendar chamada autenticada ao worker. Sem esse agendamento, respostas são persistidas, mas notificações não configuradas permanecem na fila e abandono não é materializado automaticamente.
3. Aplicar as duas migrations e publicar as funções depois de reconciliar o histórico Supabase existente. Nenhuma migration ou function foi aplicada/publicada nesta execução.
4. Repetir os testes de ponta a ponta no ambiente conectado, confirmar entrega dos dois e-mails e provar login administrativo com uma conta autorizada.

O relatório local não afirma persistência ou envio em produção. Os testes locais usam banco embutido efêmero e dados fictícios; nenhum lead real foi criado.
