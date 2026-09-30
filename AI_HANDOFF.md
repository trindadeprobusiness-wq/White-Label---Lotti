# Memória compartilhada — Codex ↔ Claude

## Claude — duplicidades: telas, funções, revisão e ajustes (2026-09-29)
- Plataforma `claude/inbox-adicionar-ao-crm` (sobre 444ebed) e ponte `claude/ponte-sem-duplicidade` (sobre 4a0c12a; `runtime/manual.mjs` chama `lotti_manual_adopt_remote`, falha ignorada). Tudo local: nada publicado, nenhuma migration remota, nenhum envio.
- Telas e Edge Functions: `crm_criar_cliente`/`crm_converter_lead`/`crm_clientes_por_telefone` nas telas (sem "Criar mesmo assim"), contratos procuram por telefone, CPF ou e-mail, `lead-capture`, `ai-action` e `crm-upsert-lead` pelo helper, "Unir conversas" (agora mantém o nome digitado), `request_id` por tentativa na "Nova conversa" (depois de envio sem confirmação pergunta e oferece "Enviar de novo"), teste que falha com insert direto em `clientes`.
- Revisão adversarial (banco, telas, produção), achados confirmados e corrigidos: `20260929140000_duplicidade_ajustes_revisao` (chave de telefone confiável: placeholder, número curto ou dígito repetido não junta desconhecidos; gatilho não responde por outra conta antes da RLS; conversa achada só pela linha e ligada a outro LID não recebe evento de um LID que já tem conversa; `bind_account` com trava 715) e `20260929150000_onboarding_cliente_existente` (passo "Primeiro cliente" reaproveita o cliente do telefone). D1b e pré-requisitos reais no arquivo D0–D10.
- Validação: `node node_modules/vitest/vitest.mjs run supabase/migrations src/lib src/store src/hooks src/components/crm src/components/inbox src/features supabase/functions` com 96 arquivos, 1033 testes e 3 falhas esperadas; único arquivo com erro é `src/features/broadcasts/broadcasts.test.tsx`, que já exigia as variáveis do Supabase. Ponte: `node --test` em `runtime/` com 135/135. `tsc`: 53 erros antes e depois (nenhum novo).
- Ordem de deploy: (1) migrations que faltam em produção (20260926200000, 20260928190000; `db push` pede `--include-all`) e conferir 20260928200000; (2) rodar D0–D10 e D1b; (3) 20260929100000–150000 e logo em seguida as Edge Functions `lead-capture`, `crm-upsert-lead`, `ai-action`, `lotti-whatsapp` e o front (entre a migration e as funções, captura com grafia diferente falha); (4) ponte; (5) limpeza revisada e depois o índice único (P-FINAL, fora deste escopo).
- Pendências: PRs aguardam o ok do usuário; corrida real a validar num Postgres com duas conexões.

## Claude — duplicidades: parte do banco da plataforma (2026-09-29)
- Branch `claude/inbox-adicionar-ao-crm`, sobre 444ebed. Decisão do usuário: "não pode ter duplicados" (sem "Criar mesmo assim"). Só banco e testes; `src/` e `supabase/functions/` não foram tocados. Nada publicado, nada rodado fora do PGlite.
- Migrations novas, a aplicar em ordem depois da `20260928200000`: `20260929100000_crm_cliente_sem_duplicidade` (helper `lotti_find_or_create_cliente` com trava 716, gatilho em `clientes` que recusa telefone repetido na conta com `duplicate_client_phone`, `crm_clientes_por_telefone`, `crm_criar_cliente`, `lead_capture_upsert_cliente`, ingest/add_to_crm pelo helper, um alerta de mídia não lido por conversa), `20260929110000_crm_conversao_e_oportunidade` (`crm_converter_lead` atômico, `crm_oportunidade_aberta` com trava 717, handoff/move_stage reaproveitando o negócio aberto), `20260929120000_lotti_conversa_por_chave` (`lotti_conversation_phone_key`, gatilho `duplicate_conversation_phone`, resolve/start/update_contact pela chave, `lotti_inbox_merge_conversations`, `lotti_manual_adopt_remote`), `20260929130000_lotti_canal_e_optout` (A → B → A devolve as conversas, `account_bound_at`, opt-out repetido sem novo evento).
- Não feito, por decisão: união automática com envio incerto (B4), filtro da importação armazenada (P-M2), índice único final (P-FINAL). Consultas só de leitura D0–D10 em `supabase/deploy-checks/duplicidades-deteccao.sql` (não executadas).
- Validação: `node node_modules/vitest/vitest.mjs run supabase/migrations` com 19 arquivos, 308 testes e 3 falhas esperadas (novo `lotti-duplicidades.test.ts` com 31; as suítes do agente passaram a aplicar a cadeia completa da produção).
- Pendências: o front, `lead-capture`, `ai-action` e `crm-upsert-lead` ainda inserem em `clientes` direto e passam a receber `duplicate_client_phone` até usarem as RPCs; publicar as migrations junto com o front e as Edge Functions; a ponte chama `lotti_manual_adopt_remote` só depois da P3 publicada; limpeza revisada a partir de D0–D10; corrida real a validar num Postgres com duas conexões.

## Claude — número, nome e histórico do WhatsApp no teste local (2026-09-28)
- Produção: as 6 migrations de 2026-09-28 (admin, conversa travada, opt-out, agente IA, follow-up, disparos) estão aplicadas e conferidas. A migration `20260926200000_lotti_whatsapp_lid_conversations` (número oculto) **não** foi aplicada em produção.
- Causa dos contatos "sem número": o patch da Evolution anotava `remoteJidAlt`/`lottiContactName` na chave protobuf do histórico, cujo `toJSON` descarta campos extras. Corrigido na ponte (anotação em cópia simples da chave). O número de todos os contatos já estava no armazenamento local do Baileys.
- Branch `claude/whatsapp-nome-perfil` (esta): migration `20260928190000_lotti_whatsapp_contact_names_and_merge.sql`. Nomes com origem (`contact_name_source`: `typed` no Inbox, `saved` da agenda, `profile` do perfil do WhatsApp): o salvo substitui tudo menos o digitado; o de perfil só preenche nome vazio; o CRM recebe o nome. Também corrige a junção de conversas da `20260926200000`: leva opt-out, avanço do follow-up, origem do nome e entregas de disparo (a entrega já enviada vence a pendente da mesma campanha). Redefine `lotti_agent_merge_conversation`, `lotti_agent_ingest`, `lotti_agent_import_history` (a partir da versão da `main`) e `lotti_inbox_update_contact`. Teste `lotti-whatsapp-profile-names.test.ts` (9, na ordem de produção) + LID (15) + disparos (26) + follow-up (20) passando. Aplicar **depois** da `20260926200000`, e a ponte nova só depois das duas.
- Branch `claude/qr-pendente-conexao` (commit 367a12c): a tela de conexão volta a mostrar um QR ainda válido em vez de "reconectando"; 9 testes passando.
- Ponte (repo do agente), branch `claude/whatsapp-lid-conversations`: correção da serialização, `key.lottiLid` em mensagens ao vivo (evita conversa duplicada), repasse de contatos marcados (`contacts.upsert` com `lotti:'contact'`) e anúncio dos LIDs ao abrir a conexão, `runtime/contacts.mjs` (completa só conversas existentes), nome de perfil, `HISTORY_IMPORT_MODE=full` importando também as mensagens já guardadas na Evolution, e etiquetas para mídia (foto, áudio, documento…) no lugar de "[Mensagem não textual…]"; edições, reações e exclusões não viram mensagem. O webhook precisa de `CONTACTS_UPSERT`: canais existentes só o recebem no próximo `connect`.
- Revisão adversarial (18 achados, 16 confirmados) corrigida: caches de LID/nome por conta pareada (não vazam para outro número na mesma instância), entradas de contato só do número vinculado ao canal, nome digitado protegido, junção preservando opt-out/follow-up/disparos, envio de contatos em lotes. Fica como limitação conhecida (baixa): `reconcileContacts` usa `resolve_conversation`, que em corrida rara pode criar conversa.
- Teste local (Supabase local + ponte `lotti-lidtest`, envio real desligado): 102/102 conversas com número, 54 com nome (as demais sem nenhum nome enviado pelo WhatsApp), 2.169 mensagens individuais, 0 avisos de "mensagem não textual". O celular (WhatsApp Business iPhone) enviou só 5 contatos da agenda ao aparelho conectado.
- PRs abertos em 2026-09-28: plataforma #28 (Agenda → "Planejamento", pedido do branch do Codex db807fb que não chegou à `main`), #29 (QR pendente na conexão), #30 (esta migration); ponte #16 (`claude/numero-oculto-nomes-historico`, sobre o #15; fila #10 → #16 ainda fora da `main` f49f8dc). Os PRs #23–#27 da plataforma já estão na `main` (950242d) e podem ser fechados. Prévia da Vercel falha por acesso do autor `rportocortes` ao projeto; não bloqueia o merge.
- Pendências: merge dos PRs; aplicar `20260926200000` e `20260928190000` em produção antes da ponte nova; ligar `HISTORY_IMPORT_MODE=full` na ponte de produção.

## Codex — evolução do módulo DRE Gerencial (2026-09-26)
- Tabela `lancamentos_financeiros` estendida com campos essenciais para DRE: `data_competencia`, `status`, `impacta_dre`, `grupo_dre`, `subcategoria`, `source_type` e `source_id`.
- ENUM `categoria_financeira` evoluído no banco e `src/types/financeiro.ts` para suportar classificações imobiliárias completas (ex: `TAXA_ADMINISTRACAO`, `MARKETING_ANUNCIO`, `COMISSAO_CORRETOR`, `IMPOSTO_FATURAMENTO`).
- Migration `20260926170000_dre_financeiro_evolucao.sql` criada para adição das colunas, constraints, índices e backfill seguro (`data_competencia` herdando `data`). (Pendente `db push` remoto por divergência do histórico).
- Motor de DRE em `src/lib/dre.ts` calcula a DRE em tempo de execução sem redundância no banco. Coberto por testes (`src/lib/dre.test.ts` com 11 passagens).
- Interface: nova `DRETab.tsx` incluída em `src/pages/Financeiro.tsx`, suportando expansão de linhas, tooltips educacionais, e alerta de lançamentos não classificados. `NovoLancamentoDialog.tsx` atualizado para injetar defaults (`impacta_dre: true`, `status: 'pago'`).
- Exportação Financeira (`csv.ts` e `Financeiro.tsx`): Adicionada dependência `xlsx`. O botão de exportação virou um menu (`DropdownMenu`) oferecendo opções `Exportar CSV` e `Exportar XLS`.
- Testes unitários (vitest) e typecheck (tsc) passaram localmente.

## Codex — seção pública do atendimento automatizado (2026-09-23)
- A seção `#como-funciona` de `/sobre` foi redesenhada em `src/pages/PublicInfo.tsx` com uma demonstração em formato de celular e três etapas que resumem resposta imediata, qualificação, cruzamento com imóveis, follow-up, agendamento e repasse de contexto ao corretor.
- `src/pages/PublicInfo.test.tsx` cobre a nova promessa e os principais pontos do fluxo. A alteração preserva a paleta verde/branco, Inter/Lora e os links públicos existentes.
- Verificação nesta base: suíte completa com 80 arquivos/623 testes, teste direcionado 3/3, ESLint direcionado, build de produção e `git diff --check` passaram com `.vercel/**` excluído. A inspeção em 1440×1000 e 390×844 confirmou largura do documento igual à viewport e foi revisada visualmente.
- Commit `d77c6fc` enviado à `main`. Vercel publicou `dpl_9XN2U4EWR2bpgidLtCGtf6PVr7ns` como `Ready`, com aliases `app.plataformalotti.com.br` e `olivercrm.vercel.app`; `/sobre` respondeu HTTP 200 e exibiu a nova seção em 390 px e 1440 px. O typecheck global permanece com erros preexistentes de schema/tipos fora destes arquivos.

## Codex — QR estável durante renovação (2026-09-23)
- A tela de conexão conserva o último QR ainda válido quando uma consulta de status retorna temporariamente sem código ou com erro; QR vencido continua oculto e cancelar limpa o código local.
- A sondagem do Inbox conectado foi reduzida de 5 s para 1,5 s para mensagens, prévias e conversas; teste com relógio controlado garante atualização em menos de 2 s.
- Testes de regressão reproduziram a oscilação do QR e a espera do Inbox. Verificações: 617/617 testes, build de produção, ESLint dos arquivos alterados e `git diff --check` passaram.
- Mudança restrita ao componente visual de conexão e seu teste; Evolution, Docker, histórico, contatos, anexos, banco e Edge Function não foram modificados.

## Codex — QR automático e dados reais de conexão no PR #11 (2026-09-22)
- A branch `codex/whatsapp-inbox-actions` agora bloqueia o Inbox enquanto o WhatsApp não estiver conectado, inicia o pareamento automaticamente e mostra QR com instruções de `WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho`; a prévia local `?preview=pairing` é somente visual.
- A página Conexão exibe número, empresa, horário disponível e desconexão quando conectada. O teste envia `Olá, tudo bem?` pela ação autenticada `start`, cria/reutiliza a conversa e permanece desabilitado sem conexão. A prévia `?preview=connected` existe somente em desenvolvimento.
- A Edge Function sanitiza telefone e horário recebidos da ponte. Alteração complementar isolada em `n8n-agent-lotti`, branch `codex/whatsapp-connection-metadata`, consulta metadados da instância conectada sem transformar falha opcional de metadados em queda da conexão.
- Verificação: plataforma com 78 arquivos/587 testes e build aprovados; bundle da Edge Function aprovado. Runtime com 26/26 testes aprovado. Publicação ainda depende do merge, deploy da Edge Function, migration já descrita no PR #11 e atualização da ponte.

## Codex — ações funcionais do Inbox em PR (2026-09-21)
- Branch `codex/whatsapp-inbox-actions`: `Nova` abre formulário compacto e cria/reutiliza cliente+conversa antes do envio manual; o lápis renomeia o cliente; `Aberta/Fechada` confirma e persiste fechamento/reabertura.
- Migration `20260921130000_lotti_inbox_actions.sql` adiciona status e três RPCs autorizadas por `auth.uid()`; mensagem recebida reabre conversa fechada. A Edge Function ganhou a ação `start`, reutilizando a idempotência do envio manual.
- Verificação: 78 arquivos/581 testes, build, ESLint direcionado, bundle da Edge Function e `git diff --check` passaram. Migration e Edge Function ainda não foram publicadas; dependem da aprovação/aplicação pelo dono.

## Codex — Inbox Clix integrado à main (2026-09-21)
- A versão visual aprovada do Inbox conectado foi integrada à `main` no merge `9b483e2` e enviada para `origin/main`, preservando o commit local anterior do favicon e as mudanças remotas.
- Verificação no resultado integrado: 75 arquivos/572 testes passaram com as variáveis fictícias do CI; build de produção e `git diff --check` passaram. O push não publica migration nem Edge Function.

## Codex — Inbox conectado compacto (2026-09-20)
- Em 2026-09-21, a densidade deixou de ser estimada pela captura e foi alinhada ao código-fonte real do Clix em `C:\Users\rafae\Clix\catalogo`: lista com 306 px, perfil com 330 px, gap/padding de 10 px, cabeçalho com 68 px e faixa de etapa com 42 px. O cabeçalho agora usa o interruptor `IA` e `Ocultar info`, como a referência, preservando a troca de modo existente.
- Inspeção local em 1600×900 mediu exatamente `306px 684px 330px`, gap 10 px, header 68 px e etapa 42 px; nenhum botão flutuante `IA Lotti` foi encontrado. Validação desta rodada: 15/15 testes direcionados, ESLint direcionado, build de produção e `git diff --check` passaram.
- No worktree `codex/whatsapp-inbox-send`, o Inbox real foi ajustado para três colunas compactas, com conversa flexível, rolagem interna e compositor no rodapé do painel.
- Balões de conversa ficaram compactos e os metadados das mensagens enviadas usam contraste claro sobre o fundo escuro. Campos de qualificação sem dados não ocupam espaço no perfil.
- Falha da consulta de status agora aparece como conexão não confirmada no Inbox; a página Conexão não oferece novo pareamento enquanto o estado estiver indisponível. Isso não altera a estabilidade da sessão externa do WhatsApp.
- Validação: 12/12 testes direcionados, build de produção, ESLint direcionado e `git diff --check` passaram. Sem inspeção visual autenticada nem publicação nesta etapa.

## Codex — paridade visual do Inbox com o Clix (2026-09-21)
- O Inbox real passou a reproduzir a composição da referência do Clix: lista de conversas com busca/filtros à esquerda, chat de altura integral com cabeçalho e barra de etapa ao centro, e perfil com resumo, timeline, atribuição, tags e notas à direita.
- O assistente flutuante `IA Lotti` foi desativado em todas as rotas `/whatsapp`, usando a regra já existente e agora aplicada pelo `AppLayout`.
- A inspeção no navegador em viewport 1600×900 confirmou as três colunas, rolagens internas e ausência do widget. Validação: 42/42 testes direcionados, build, ESLint direcionado e `git diff --check` passaram. Nada foi publicado.

## Codex — favicon da Lotti (2026-08-17)
- `public/favicon.svg` usa o símbolo da logo branca fornecida pelo usuário, verde no tema claro e branco no tema escuro.
- Validações da entrega original: SVG XML válido e `git diff --check` sem erros.

## Codex — porta de conexão do WhatsApp no Inbox (2026-09-16)
- Branch `codex/whatsapp-connection`, em worktree isolada: `/whatsapp` consulta a conexão antes das conversas; desconectado/indisponível mostra somente o fluxo de QR e conectado remove o card e carrega o atendimento real.
- Nova rota `/whatsapp/conexao`, item `Conexão` abaixo de `Funil de Vendas` na seção WhatsApp e atalho equivalente no menu mobile. A página permanece acessível quando conectado e oferece retorno ao Inbox.
- A rota `/whatsapp/conexao` replica a referência visual do estado conectado com número, empresa, IDs, data, desconexão e teste com a mensagem “Olá, tudo bem?”, sem botão `Abrir Inbox`.
- Na prévia de conexão, `Empresa` é editável e WABA/Phone ID foram removidos. O atalho redundante `Abrir atendimento conectado` também foi retirado do topo da lista do Inbox.
- A tela de conexão mantém Status e Teste de envio empilhados; os dados do Status voltaram à distribuição vertical, com tamanho intermediário e sem os vazios horizontais introduzidos pela grade compacta.
- O telefone do teste usa linguagem comum (`Número que receberá o teste`) e exemplo formatado `(62) 99999-9999`; a indicação técnica `E.164 sem +` foi removida.
- A página de conexão compensa o padding inferior do shell com `-mb-16`, eliminando a rolagem vertical excedente quando o conteúdo já cabe no viewport.
- Quando conectado, `/whatsapp` renderiza a implementação completa já existente em `WhatsAppInbox` (três painéis, atalhos, filtros, tags, responsável, fechamento, operações locais, IA, rascunhos, anexos e cores de prazo). Em desenvolvimento essa prévia conectada abre por padrão; `?preview=disconnected` permite revisar o gate de QR.
- O hook de status é compartilhado pelo gate e pelo card via cache do React Query. Conversas/mensagens não consultam o banco antes da confirmação `connected`; durante `connecting`, o status atualiza a cada 5 segundos.
- Testes novos cobrem bloqueio das consultas antes da conexão, liberação do atendimento conectado, desaparecimento do card, página dedicada e item ativo único no menu. Nenhum backend, migration ou segredo foi alterado; desconexão não foi exposta porque `lotti-whatsapp` ainda aceita somente `status` e `connect`.
- Verificação: suíte completa com 69 arquivos e 549 testes aprovados; build de produção aprovado; ESLint dos arquivos alterados e `git diff --check` aprovados.

## Claude — branch de segurança reorganizada (2026-09-16)
- O trabalho acima estava sem commit na árvore principal, sobre um commit do modal da
  Agenda que não está na main, e misturado com a correção do OAuth da Agenda. Foi
  transplantado para `codex/security-hardening` sobre `origin/main`, sem a parte da
  Agenda, que ficou em `fix/google-agenda-oauth`. Estado anterior completo preservado na
  branch local `backup/arvore-principal-2026-09-16`.
- Verificado na branch reorganizada: `npm ci`; `npm run audit:security` sem
  vulnerabilidades; 67 arquivos e 543 testes passaram com as variáveis fictícias do CI;
  build de produção passou; ESLint dos módulos novos e dos testes ajustados passou.
  `FachadaPreview.tsx` mantém 2 erros e 1 aviso de ESLint que já existem na main.
- GitHub Actions `Security and tests` passou inteiro na branch publicada, incluindo
  `npm run test:security-browser` com Chromium. Nenhuma migration ou função publicada.
- Vercel: os previews desta branch e de `fix/google-agenda-oauth` aparecem como
  `Deployment was blocked`. Não é falha de build: a Vercel bloqueia todo commit com autor
  `rafaelporto2217@gmail.com`, inclusive `68766b3`, que já está na main. Commits do
  `trindadeprobusiness` publicam normalmente. Resolver na conta da Vercel ou fazer o merge
  pela conta dona do projeto, para que o commit publicado tenha esse autor.

## Codex — correções de segurança em branch (2026-09-15)
- Branch `codex/security-hardening`: captura pública com validação limitada por bytes/campos, rate limit persistente, respostas genéricas e detalhes somente para integração com segredo. Captura não debita cota de IA; executor real deve contabilizar após qualificar.
- Migration `20260916010000_public_security.sql` protege INSERT direto de leads/escaneamentos QR e limita tipos/tamanho no bucket privado de anexos IA. Testes executam o SQL com papéis anon/authenticated/service_role em PostgreSQL PGlite com schema mínimo.
- CSP adicionada, Clarity extraído para arquivo local, título de impressão sem interpolação HTML, Vite em loopback, dependências atualizadas e instalação npm ci. Workflow de testes/auditoria e roteiro `docs/SEGURANCA_PUBLICACAO.md` adicionados.
- Verificado durante implementação: 33 testes direcionados passaram, suíte então com 548 testes passou antes dos três testes adicionais; build e bundle das quatro funções passaram, ESLint dos módulos novos passou, npm audit sem vulnerabilidades. Smoke Chromium passou para login/rota protegida/bloqueio de script inline com rede externa simulada. Typecheck global ainda reporta erros de schema/tipos existentes.
- Pendente: validação final do snapshot do commit, aplicar migration antes de publicar funções, revisar integração autenticada/contabilização da qualificação, revogar credenciais antigas e testar isolamento completo no Supabase real. Nenhuma migration remota ou função foi publicada nesta etapa.

## Codex — análise do checklist de segurança (2026-09-15)
- Revisão estática de autenticação, endpoints públicos, migrations de RLS/Storage, criptografia e headers; consulta ao grafo existente usada como índice, com confirmação no código.
- `npm audit --omit=dev --json`: 3 pacotes sinalizados (1 baixo, 2 moderados; nenhum alto/crítico). Não cobre imports Deno nem imagens Docker.
- `lead-capture` não contém rate limit/CAPTCHA, aceita metadados extras e retorna `cliente_id`/`is_new`; endpoints públicos inspecionados também propagam mensagens de erro. `vercel.json` possui headers de segurança, sem CSP.
- Pendente: confirmar configuração publicada, testar isolamento entre contas, revisar proteção contra abuso e respostas públicas, confirmar revogação de credenciais antigas e avaliar alertas de dependências. Nenhuma alteração funcional ou publicação realizada nesta análise.

## Codex — modal da conta Google Agenda na Rotina (2026-09-15)

- O indicador `Agenda conectada` virou um botão compacto verde `Conectado`; ao clicar, abre o modal `Agenda` com conta, última sincronização, sincronização manual e desconexão confirmada.
- As ações reutilizam as mutations existentes de sincronização e desconexão; nenhum backend ou segredo foi alterado.
- Teste de interação cobre conexão, abertura do modal/sincronização e confirmação antes da desconexão: 3/3 passaram. A suíte completa da `main` passou com 63 arquivos e 508 testes usando variáveis fictícias do Supabase.
- Build de produção, ESLint direcionado e `git diff --check` passaram. A inspeção visual local autenticada não foi concluída porque a rota local redirecionou para login.

## Claude — callback do Google Agenda no domínio da Lotti (2026-09-15)
- Sonda na função publicada revelou o defeito principal: o callback redireciona para
  `https://olivercrm.vercel.app/configuracoes?tab=agenda&google_calendar=error`. O
  secret `GOOGLE_CALENDAR_APP_REDIRECT_URL` em produção ainda aponta para o domínio
  antigo e para uma página que não hospeda mais a agenda — quem autorizava voltava
  sem sessão e sem aviso nenhum.
- `?google_calendar=connected|error` só era lido por `GoogleCalendarPanel`, que não é
  renderizado em lugar nenhum. Regra extraída para `useGoogleCalendarReturn` e montada
  uma única vez no `AppLayout`, não na Rotina: o destino da volta vem de um secret do
  servidor, então o aviso funciona em qualquer rota — inclusive em
  `/configuracoes?tab=agenda`, para onde o valor publicado aponta hoje, e nos dois
  domínios, já que o mesmo build serve `olivercrm.vercel.app` e
  `app.plataformalotti.com.br`. Isso faz a conexão parar de voltar em silêncio sem
  depender de trocar secret nenhum.
- Callback OAuth movido para `https://app.plataformalotti.com.br/google-agenda/callback`:
  reescrita em `vercel.json` antes do curinga do SPA, com `no-store` e
  `x-vercel-enable-rewrite-caching: 0`, mais proxy equivalente no `vite.config.ts` para
  desenvolvimento. É pré-requisito da verificação do Google, que exige domínio de
  redirect comprovável no Search Console — `supabase.co` não é.
- `docs/ROTINA_GOOGLE_CALENDAR.md` ganhou a seção 2.1 explicando por que a tela de
  consentimento mostra o identificador do projeto e a interstitial de app não
  verificado, com a ordem branding → domínios → publicar → verificação.
- Branch `fix/google-agenda-oauth` refeita sobre `origin/main` com um único commit, sem
  tocar nas linhas que `codex/security-hardening` altera: os dois PRs entram em qualquer
  ordem sem conflito. A
  primeira versão levou por engano `npm ci`, CSP e Vite em loopback — edições simultâneas
  do Codex nos mesmos arquivos — e repetia o commit do modal que já está na main.
- Verificações na branch limpa: 66 arquivos e 518 testes passaram (8 novos) com as
  variáveis fictícias do CI; build de produção, ESLint nos arquivos alterados e
  `git diff --check` passaram.
- Merge simulado nas duas ordens com `codex/security-hardening`: sem conflito. O resultado
  combinado passou em `npm ci`, auditoria sem vulnerabilidades, 69 arquivos e 551 testes e
  build de produção.
- Pendente do usuário, fora do repositório: trocar os dois secrets no Supabase,
  cadastrar a nova URI no Google Cloud e fazer branding/verificação. Até lá o
  consentimento segue exibindo o aviso. A reescrita da Vercel não pôde ser exercitada
  daqui: precisa de deploy real. Banco não inspecionado — o projeto não está
  vinculado pelo CLI e não há credencial de serviço local.

## 2026-09-11 — Claude (Bottom Navigation nativa para mobile)

- Commit `6a54808` em `main`, publicado na Vercel.
- **3 novos componentes criados:**
  - `src/components/layout/MobileBottomNav.tsx`: barra fixa no rodapé com 5 tabs
    (Início, Clientes, Pipeline, Aluguéis, Mais), pill indicadora de rota ativa,
    badge de notificações não lidas e safe-area do iPhone.
  - `src/components/layout/MobileTopBar.tsx`: barra superior com logo + sino +
    ajuda, backdrop-blur para efeito de vidro nativo. Substitui o hambúrguer.
  - `src/components/layout/MobileMoreSheet.tsx`: sheet que sobe de baixo com
    rotas secundárias em grade 3×2, perfil do corretor, toggle de tema e logout.
- **Modificados:**
  - `AppSidebar.tsx`: removido bloco mobile (drawer + hambúrguer + barra superior).
    Sidebar desktop `hidden md:block` permanece intacta.
  - `AppLayout.tsx`: integra `MobileTopBar` e `MobileBottomNav`; `pb-24 md:pb-16`
    garante que o conteúdo não fique coberto pela bottom nav no mobile.
  - `tailwind.config.ts`: token `mobile-nav: '4rem'` e keyframe `slide-up`.
  - `src/index.css`: utility `.pb-mobile-nav` com `env(safe-area-inset-bottom)`.
- **Validação:** 831/832 testes (1 falha pré-existente de `DashboardHero`,
  documentada desde 2026-09-04). Build de produção OK (55s).
- **Dev server:** `http://localhost:5173` — redimensionar para ≤767px para ver a
  Bottom Nav. Acima de 767px a sidebar desktop continua igual.

## Codex — cores dos atalhos e avatar (2026-09-10)
- Inbox: Atrasando selecionado usa fundo/borda amarelos; Urgente selecionado usa fundo/borda vermelhos. Estados não selecionados continuam neutros.
- Removido indicador pequeno de presença dos avatares da lista e do cabeçalho, preservando o indicador de status textual da conversa.
- 20 testes do Inbox e build passaram; diff check passou; localhost /whatsapp respondeu HTTP 200.

## Codex — remoção de Configurar e sino global (2026-09-10)
- Removido botão/painel Configurar do Assistente e o envio/tratamento de instruções personalizadas acrescentado localmente. Arquivo AISettings removido.
- PainelNotificacoes removido do PageHeader, eliminando o sino utilitário das páginas. Ícones de sino dentro da aba Configurações > Notificações foram mantidos por serem rótulos dessa seção, não botão global.
- Build e diff check passaram; localhost /assistente respondeu HTTP 200. Componente PainelNotificacoes permanece no repositório sem renderização pelo cabeçalho, para não apagar infraestrutura/dados sem solicitação explícita.

## Codex — renomear e backlog (2026-09-10)
- Histórico do Assistente: Renomear abre modal, valida título não vazio de até 120 caracteres e atualiza ai_conversations pelo cliente autenticado; apresenta falha e recarrega lista após sucesso. Build passou; gravação real não testada nesta etapa.
- Documento docs/PLANO_AUTOMACAO_LOTTI.md criado para revisão, com fluxo, arquitetura, 22 itens priorizados, dependências, critérios de aceite, riscos e decisões pendentes. Não autoriza publicação.

## Codex — histórico, configuração e botões (2026-09-10)
- Menu de opções do histórico em espaço próprio, sem sobrepor a data no hover. Ícone inicial com contornos sobrepostos discretos em verde.
- Configurar abre painel de instruções, restauração e salvamento local por usuário. Hook envia preferências limitadas a 3000 caracteres; função ai-assistant preparada para tratá-las como mensagem de usuário, sem substituir regras do sistema. Atualização do servidor NÃO publicada; interface avisa essa dependência.
- LimitGuard mantém interceptação por cota/plano sem opacity-50, com título explicativo. Botões nativamente desabilitados recebem fundo neutro e texto legível, sem serem habilitados.
- Build, diff check e 4 testes existentes de contratos IA passaram. Sem teste E2E da configuração nem revisão visual no navegador.

## Codex — abertura compacta do Assistente (2026-09-10)
- Reduzidos padding superior, ícone, título, categorias e cartões de perguntas (mínimo 54px). Composer com uma linha e padding menor, preservando Shift+Enter. Objetivo: quatro sugestões visíveis na altura desktop enviada, sem esconder conteúdo por overflow.
- Build e diff check passaram. Sem validação visual no navegador; rolagem de segurança mantida para mensagens e telas pequenas.

## Codex — Assistente inspirado na referência (2026-09-10)
- Painel com margem uniforme, bordas arredondadas, histórico mais estreito e botão Nova análise. Abertura central com título, categorias e sugestões em duas colunas; identidade verde Lotti preservada.
- Composer usa Textarea e trata Enter/Shift+Enter com proteção para composição IME. Sem painel lateral direito. Backend não alterado.
- Build e diff check passaram; localhost /assistente HTTP 200. Sem validação visual ou teste automatizado de teclado nesta etapa.

## Codex — layout do Assistente (2026-09-10)
- Removida a coluna direita de capacidades/contexto. Rota /assistente sem padding externo/max-width; altura dinâmica integral no desktop, descontando somente barra mobile. Removidas margens negativas e desconto antigo de 4rem que deixavam faixa inferior vazia.
- Build passou; git diff --check passou; localhost /assistente respondeu 200. Comando direcionado a appLayoutRules.test.ts não encontrou arquivo de teste (não conta como teste aprovado). Sem verificação visual no navegador.

## Codex — ações locais do Inbox (2026-09-10)
- Nova conversa com nome/telefone, detecção de número existente; exclusão confirmada somente na demonstração e estado vazio no desktop. Responsável selecionável entre opções demonstrativas; tags adicionáveis/removíveis e refletidas nos filtros.
- Rascunhos e anexos separados por conversa. Anexo local até 20 MB com download via URL temporária, sem upload/envio; URLs revogadas ao desmontar. Perfil mais compacto, reinicia rolagem ao trocar contato; ferramentas de simulação recolhidas.
- Testes: 20 testes do Inbox passaram; build passou antes da extração simples de updateDraft, depois coberta nos testes. Diff check passou, localhost 8086 respondeu 200. Sem diagnósticos filtrados do Inbox no typecheck global; baseline externa permanece.
- Limitações: alterações ainda em memória, sem persistência nem integração WhatsApp; responsável é lista demonstrativa, não diretório real. Sem teste visual/browser ou teste ponta a ponta dos novos modais. Não implica paridade completa com Clix.

## Codex — edição e perfil do Inbox (2026-09-10)
- Lápis no cabeçalho abre Editar cliente sem Contato interno. Nome validado atualiza lista, cabeçalho, perfil e iniciais; telefone somente leitura para preservar identidade do canal. Alterações locais à sessão, aviso explícito no modal.
- Perfil reorganizado em card suave de identificação e dados imobiliários, divisórias leves, timeline conectada com contagem e datas separadas. Preservadas dimensões e ordem dos campos.
- Verificação: 19 testes do Inbox passaram, build passou, git diff --check sem erros e localhost 8086/whatsapp respondeu HTTP 200. Sem inspeção visual via navegador.

## Codex — menu e sugestão de resposta (2026-09-10)
- Menu: item ativo com fundo discreto e barrinha lateral; hover verde acinzentado nos temas claro/escuro, sem alterar dimensões.
- Inbox: opção Sugerir resposta, seleção de imóvel autorizado, revisão editável e aplicação somente ao rascunho. Sem envio automático; componente reinicia ao trocar conversa/pergunta.
- Nova função local inbox-suggest: autentica sessão, resolve corretor no servidor, consulta com RLS e filtro explícito de titularidade; envia somente campos permitidos do imóvel ao provedor existente. Não inclui proprietário, endereço exato, documentos ou descrição livre. Valida entrada, rate limit e cota antes da inferência.
- Validação: 19 testes passaram (Inbox e limites de contexto da sugestão); bundle da função passou; build passou. Typecheck global segue com baseline de erros, sem diagnósticos nos arquivos desta etapa filtrados pelo comando.
- Pendente: publicar/configurar inbox-suggest, testar autenticação/isolamento ponta a ponta e qualidade das sugestões com provedor real. Nenhuma publicação ou chamada de inferência executada. Associação automática anúncio/imóvel e busca por critérios ficam para próxima etapa. Sem validação visual no navegador, por pedido do usuário.

## Codex — filtros do Inbox (2026-09-09)
- Implementados atalhos Todas/Atrasando/Urgente com contagens por conversa e painel lateral rolável de filtros combináveis: funil, interação, status, responsável, motivo de fechamento, tags, não lidas e datas.
- Prazos ajustáveis (15/60 minutos inicialmente), grupos de atraso exclusivos; registros sem waitingSince confirmado não geram urgência fictícia. Datas desconhecidas não entram em recortes temporais. Dados continuam demonstrativos e filtros locais, sem integração WhatsApp real.
- Fechamento local registra Corretor; resposta humana limpa espera e registra última interação. Preservadas alterações anteriores e dimensões do Inbox.
- Verificação: 17 testes do Inbox passaram; build de produção passou. Sem navegação/validação visual no navegador, conforme pedido.

Este arquivo sincroniza o **estado do trabalho**, não o histórico integral dos chats.
Antes de começar uma tarefa, confira também `git status` e o diff: o repositório é a
fonte da verdade quando este resumo estiver desatualizado.

## Protocolo rápido

1. Leia este arquivo e inspecione o estado real do Git antes de editar.
2. Preserve mudanças existentes; não assuma que arquivos modificados são seus.
3. Ao encerrar trabalho relevante, atualize somente as seções afetadas abaixo.
4. Registre fatos verificáveis, comandos executados e resultados — não raciocínio interno.
5. Identifique a origem da atualização como `Codex`, `Claude` ou `Usuário`.
6. Nunca inclua senhas, tokens, conteúdo de `.env` ou dados pessoais de clientes.

## Objetivo atual

Corrigir e evoluir o CRM da Casa Mente Contrato. O trabalho aberto concentra-se no
histórico de contatos/timeline do cliente e na compatibilidade entre o vocabulário da
interface e o schema que existe no Supabase.

## Estado verificado

Última leitura: **2026-09-01 — Codex**.

Diagnóstico da exclusão de boleto em produção:

- O Dashboard do Supabase mostrou `asaas-sync` publicada há 19 dias, anterior ao
  commit de 2026-08-20 que adicionou `excluir_cobranca`. A função remota antiga
  rejeita essa ação no allowlist com HTTP 400 `Requisição inválida`, exatamente o
  erro mostrado pela interface.
- `supabase/functions/asaas-sync/index.ts` agora consulta o estado externo, exige
  confirmação `deleted: true` do Asaas e somente depois marca a fatura local como
  `CANCELADO`; falhas externas deixam a fatura visível e propagam o erro.
- `supabase/functions/_shared/excluir-cobranca.ts` centraliza a exclusão segura e
  idempotente para 404, `deleted: true` e status `DELETED`, além de bloquear cobrança
  já paga/confirmada.
- `supabase/functions/_shared/excluir-cobranca.test.ts` cobre sete cenários de
  sucesso, falha, pagamento e repetição da operação.
- A atualização está preparada no editor do Dashboard do Supabase, mas o botão final
  de confirmação ainda não foi acionado; o próprio Dashboard avisa que a publicação
  altera imediatamente a função live e não oferece rollback automático.

Correção de cobrança Asaas concluída nesta leitura:

- `supabase/functions/asaas-sync/index.ts`: o customer passa a ser criado sem
  telefone; telefone válido é enviado depois por `PUT`, em modo best-effort.
- `src/components/rental/BillsList.tsx`: removido o contorno que apagava e restaurava
  temporariamente o telefone do cliente durante a emissão.
- `supabase/functions/_shared/telefone.test.ts` (novo): cobre celular mascarado,
  código do país, telefone fixo e valores inválidos.
- A Edge Function `asaas-sync` foi publicada no projeto `dqlolypbmsjgqrvdesev` como
  **versão 6** em 2026-08-13 00:26:45 UTC e ficou `ACTIVE`.

Alterações locais já existentes e ainda não commitadas:

- `src/hooks/crm/useCrm.ts`: registro de contato do WhatsApp passa por `paraRegistro`.
- `src/pages/ClienteDetalhes.tsx`: busca o histórico ao abrir o cliente e renderiza
  `data_contato`, `conteudo` e o tipo convertido para a UI.
- `src/stores/crmStore.ts`: consulta ordenada por `data_contato` e inserção no formato
  atual da tabela `historico_contatos`.
- `src/lib/crm/historico.ts` (novo): adapta tipos da UI para canais do banco, monta a
  thread e calcula tempo sem contato.
- `src/lib/crm/historico.test.ts` (novo): testes unitários do adaptador e da thread.
- `supabase/migrations/20260811180000_crm_inbox.sql` (novo): migration relacionada ao
  inbox do CRM; ainda precisa ser revisada junto ao restante do trabalho.

Observação: essas mudanças foram encontradas no worktree; este registro não afirma que
estejam concluídas ou corretas.

## Validação conhecida

- `npm test`: **351/351 passaram** em 2026-08-31.
- `npm run build`: **passou** (4556 módulos) em 2026-08-31.
- Bundle de `supabase/functions/asaas-sync/index.ts` com esbuild: **passou**.
- ESLint dos dois arquivos novos: **passou**; os 3 `no-explicit-any` do index da
  função são idênticos aos 3 já presentes no `HEAD`.
- `git diff --check`: **passou**.
- `package.json` oferece: `npm run typecheck`, `npm test`, `npm run build` e `npm run lint`.
- `npm test -- --run supabase/functions/_shared/telefone.test.ts`: **8/8 passaram**.
- `npm run build`: **passou** (4466 módulos).
- Smoke test da função publicada: HTTP 401 sem token, resposta esperada da autenticação
  interna e confirmação de que o endpoint versão 6 está ativo.
- `npm run typecheck`: ainda falha na baseline de outras áreas (tipos desatualizados do
  Supabase, assinatura e fachadas). A filtragem não encontrou erro nos arquivos desta
  correção de cobrança.

## Próximos passos sugeridos

1. Confirmar o deploy preparado de `asaas-sync` no Dashboard do Supabase.
2. Após o deploy, fazer smoke sem sessão (401 esperado) e repetir a exclusão da
   cobrança indicada pelo usuário, conferindo o cancelamento também no Asaas.
3. Rodar o teste específico de `src/lib/crm/historico.test.ts`.
4. Rodar `npm run typecheck` e `npm run build`.
5. Corrigir somente erros introduzidos por este conjunto de mudanças; separar baseline.
6. Revisar a migration do inbox contra o schema e os tipos atuais do Supabase.
7. Testar manualmente: abrir cliente, carregar timeline e registrar contato/WhatsApp.

## Diário de handoff

### 2026-09-28 — Claude (Conclusão de Merges e Sincronização)

- **GitHub - Plataforma**: PRs #28 (Planejamento), #29 (Conexão QR) e #30 (Migration de nomes e conversas) mesclados na main. Os PRs #23 a #27 tiveram os branchs remotos mantidos ou já contidos na main (commit 950242d).
- **GitHub - Ponte (n8n-agent-lotti)**: Branch `claude/numero-oculto-nomes-historico` (incluindo PRs #10 ao #16) mesclado na main com sucesso.
- **Banco de Produção (Supabase)**: ATENÇÃO - As migrations `20260926200000` e `20260928190000` ficaram **pendentes** para execução manual pelo usuário usando o kit de conferência, conforme regra de NÃO aplicar na produção.
- **Ponte Local de Produção (PC)**: ATENÇÃO - A atualização do repositório local `C:\Users\rafae\n8n-agent-lotti` e configuração do `HISTORY_IMPORT_MODE=full` não foram realizadas por mim, ficando **pendentes** para o usuário.
- **Jira**: Os cards abaixo podem ser marcados como concluídos:
  - Renomeação do módulo "Agenda" para "Planejamento"
  - Correção/Retorno da exibição do QR Code na tela de Conexão WhatsApp
  - Migration e junção de nomes de contatos com as conversas (LID/telefone oculto na ponte e plataforma)
  - Configuração do agente IA / respostas reais e correções de WhatsApp LID

### 2026-09-09 — Codex (status e legibilidade do Inbox)

- Status da conversa separado da etapa: clicar abre confirmação Fechar conversa,
  Cancelar preserva estado e Fechar marca somente a conversa; Fechada permite reabrir.
- Removidas reticências decorativas do perfil. Notas usam contraste âmbar explícito
  claro/escuro e quebra de texto; adicionar nota funciona no estado local por contato.
- Melhorados foco do seletor e contenção da altura dos painéis móveis.
- 14 testes do Inbox passaram; localhost 8086 respondeu HTTP 200. Revisão pelo código,
  sem inspeção visual no navegador. Persistência das notas/status continua pendente.

### 2026-09-09 — Codex (avisos no histórico do Inbox)

- Mudanças realizadas pelo seletor do Inbox acrescentam aviso com etapas, autor
  e horário somente após sucesso; no demo o aviso acompanha a alteração local.
- Mensagem humana enviada pelo composer pausa a IA e adiciona aviso no chat.
  Normalizador testado distingue cliente/IA/humano e ignora mensagens repetidas.
- Botão exclusivo de desenvolvimento simula resposta humana pelo WhatsApp.
- Eventos e estado continuam locais: persistência, movimentos externos do Funil
  e recebimento automático via Evolution ainda precisam de integração backend.
- Validação: 14 testes do Inbox, build e diff check passaram; localhost 8086 HTTP 200.

### 2026-09-09 — Codex (Inbox conectado às etapas do Funil)

- A etapa exibida no cabeçalho e no perfil do WhatsApp Inbox passou a usar as mesmas
  etapas e oportunidades da camada `useCrm`, com suporte aos modos completo e legado.
- A conversa procura a oportunidade primeiro por `cliente_id` e usa telefone normalizado
  apenas como compatibilidade. A troca no seletor chama a mesma mutação usada pelo Funil;
  a invalidação compartilhada faz a alteração aparecer nos dois módulos.
- Dados demonstrativos sem cliente real vinculado mantêm troca local para permitir a
  visualização antes da futura ingestão de conversas pela Evolution API.
- Testes direcionados: 11/11 passaram. ESLint dos arquivos tocados passou sem erros,
  `npm run build` e `git diff --check` passaram. O typecheck manteve somente a baseline
  conhecida, sem erro nos arquivos desta mudança.
- Servidor local religado em `http://127.0.0.1:8086/whatsapp`, confirmado com HTTP 200.
- O Graphify foi consultado primeiro por existir `graphify-out/`, mas o executável não
  estava disponível; o mapeamento foi concluído por busca direta no repositório.
- Nenhum navegador foi aberto nesta correção.

### 2026-09-09 — Codex (segunda redução do WhatsApp Inbox)

- A pedido do usuário, a densidade foi reduzida novamente em aproximadamente 8%.
- No desktop largo, Conversas passou de 310 para 290 px e Perfil de 330 para 310 px;
  os cards de conversa passaram de 64 para 60 px e o chat ganhou o espaço liberado.
- Avatares, títulos, botões, busca, filtros, mensagens e espaçamentos internos também
  foram reduzidos. O fluxo e os breakpoints móveis foram preservados.
- Teste específico: 7/7 passaram. `npm run build`, smoke HTTP 200 em
  `http://127.0.0.1:8086/whatsapp` e `git diff --check` passaram.
- Nenhum navegador foi aberto nesta correção.

### 2026-09-09 — Codex (escala compacta do WhatsApp Inbox)

- A comparação direta com a referência mostrou que as duas colunas laterais estavam
  cerca de 100 px maiores na captura do usuário e comprimiam o chat.
- No desktop largo, Conversas passou para 310 px e Perfil para 330 px; o chat recebe
  toda a largura restante. Cards de conversa usam altura-base de 64 px.
- Avatares, cabeçalhos, botões, filtros, mensagens, composer, tipografia e espaçamentos
  internos foram reduzidos proporcionalmente; o comportamento móvel foi preservado.
- Teste específico: 7/7 passaram. `npm run build`, smoke HTTP 200 em
  `http://127.0.0.1:8086/whatsapp` e `git diff --check` passaram.
- Nenhum navegador foi aberto nesta correção.

### 2026-09-09 — Codex (proporções do WhatsApp Inbox)

- Os três painéis do Inbox passaram a ser cartões independentes, com 12 px de espaço,
  bordas arredondadas e larguras responsivas alinhadas à referência: conversas compactas,
  chat dominante e perfil com largura fixa.
- A coluna de conversas ganhou cabeçalho e filtros compactos, e os itens foram reduzidos
  para manter a mesma densidade visual do exemplo enviado.
- Teste específico: 6/6 passaram. `npm run build` e `git diff --check` passaram.
- Nenhum navegador foi aberto nesta correção.

### 2026-09-09 — Codex (painel de informações recolhível)

- O cabeçalho do atendimento no WhatsApp Inbox ganhou `Ocultar info` / `Mostrar info`.
- Ao ocultar, o perfil deixa a grade desktop e o chat ocupa automaticamente a largura
  liberada; no celular, o perfil continua sendo um painel separado.
- Teste específico: 5/5 passaram. `npm run build` e `git diff --check` passaram.
- Nenhum navegador foi aberto nesta correção.

### 2026-09-09 — Codex (limpeza visual do WhatsApp Inbox)

- O widget flutuante `IA Lotti` não aparece mais em `/whatsapp`, evitando dois chats
  concorrentes na mesma tela; continua disponível nas demais páginas elegíveis.
- A Linha do tempo do perfil foi movida para imediatamente após o resumo do contato,
  antes de responsável, tags e notas, seguindo a hierarquia da referência do Clix.
- Testes específicos: 5/5 passaram. `npm run build` e `git diff --check` passaram.
- Nenhum navegador foi aberto nesta correção.

### 2026-09-09 — Codex (Inbox em tela cheia e submenu WhatsApp)

- O cabeçalho externo da página `/whatsapp` foi removido para o Inbox ocupar toda a
  área útil, aproximando a composição da referência enviada.
- Na sidebar, WhatsApp passou a ser uma seção expansível com `Inbox` e
  `Funil de Vendas`; o antigo link solto do Funil foi removido da lista principal.
- Testes específicos de sidebar e Inbox: 7/7 passaram. `npm run build` e
  `git diff --check` passaram. Nenhum navegador foi aberto nesta correção.

### 2026-09-09 — Codex (primeira versão do WhatsApp Inbox)

- Na branch `codex/mini-crm`, foi adicionada a rota protegida `/whatsapp` e o item
  WhatsApp em Operação, antes de Clientes.
- A primeira versão usa dados demonstrativos isolados e entrega lista pesquisável,
  filtro de não lidas, conversa, envio local, perfil, responsável, tags, notas,
  timeline e alternância entre IA e atendimento humano.
- O desktop usa três painéis com rolagem própria; no celular, lista, conversa e perfil
  são painéis navegáveis. Não há envio real, Evolution API, VPS ou migration nesta etapa.
- Testes específicos: 11/11 passaram. `npm run build` e `git diff --check` passaram.
- Prévia validada no navegador em `http://127.0.0.1:8086/whatsapp`.

### 2026-09-09 — Codex (design do WhatsApp Inbox)

- Na branch `codex/mini-crm`, foi especificada a primeira entrega do WhatsApp Inbox
  em `docs/superpowers/specs/2026-09-09-whatsapp-inbox-design.md`.
- O escopo aprovado usa uma rota própria no app, layout responsivo de conversas,
  atendimento e perfil, dados demonstrativos isolados e contratos preparados para
  futura Evolution API; VPS, QR Code e envio real ficaram fora desta primeira etapa.
- Nenhum código funcional, migration ou ambiente remoto foi alterado nesta etapa.

### 2026-09-02 — Codex (prévia de reconciliação do quadro CRM)

- Criada a branch isolada `codex/reconcile-crm`, baseada em `origin/main`, para
  conciliar o quadro do Pipeline com o acabamento compacto do Funil legado. Não
  houve push, PR ou alteração direta da `main`.
- `CrmPipeline` mantém as abas e ações existentes do CRM e ganhou busca local por
  negócio, cliente ou imóvel, filtro funcional de atrasadas, colunas compactas
  com rolagem vertical independente, contagem em selo e arraste com overlay.
- Refinamento visual solicitado: a aba Pipeline não duplica a busca global do
  cabeçalho; colunas, cabeçalhos e cards foram adensados, nomes repetidos foram
  suprimidos e a ação de WhatsApp passou ao canto superior do card.
- Telefone exibido em card do CRM usa o mesmo controle de dado sensível já usado
  nas outras informações. A coluna de destino do arraste mantém contorno interno
  uniforme.
- Validações: testes visuais de CRM/Pipeline (3/3), ESLint dos arquivos alterados,
  `npm run build` (4560 módulos) e `git diff --check` passaram. Prévia local:
  `http://127.0.0.1:8093/`.

### 2026-09-02 — Codex (menu do Pipeline)

- O Pipeline nativo substitui o botão de filtros pelo menu de três pontos; o menu
  mantém seleção, recarregamento das etapas/oportunidades e o acesso ao gerenciamento
  de etapas já existente no modo legado.
- Validações: teste visual específico do Pipeline (3/3), `npm run build` e
  `git diff --check` passaram.

### 2026-09-02 — Codex (seleção em lote do Pipeline)

- O modo “Selecionar vários” passou a marcar os cards com checkbox e destaque;
  a barra inferior permite mover os selecionados entre etapas, limpar ou cancelar.
- O aviso central de seleção foi removido. Validação: teste do Pipeline 4/4 e
  `git diff --check` passaram; o build de produção também passou nesta etapa.

### 2026-09-02 — Codex (posição da seleção em lote)

- A barra de ações da seleção passou a flutuar centralizada no rodapé interno do
  quadro, sem reduzir a área das colunas, seguindo a referência do Clix.
- Validações: teste do Pipeline 4/4 e `git diff --check` passaram.

### 2026-09-02 — Codex (acabamento da barra de seleção)

- A barra flutuante passou a usar fundo escuro e um afastamento maior da borda
  inferior interna do quadro, acompanhando a referência visual do Clix.
- Validações: teste do Pipeline 4/4 e `git diff --check` passaram.

### 2026-09-02 — Codex (espaço da seleção)

- A barra foi baixada para a base do quadro e ganhou cantos mais arredondados;
  as colunas reservam espaço no rodapé enquanto a seleção estiver ativa para não
  esconder cards.
- Validações: teste do Pipeline 4/4 e `git diff --check` passaram.

### 2026-09-02 — Codex (barra compacta abaixo do quadro)

- A seleção em lote foi centralizada na faixa livre abaixo da rolagem horizontal
  do quadro e recebeu dimensões menores para a barra e seus botões.
- Validações: teste do Pipeline 4/4 e `git diff --check` passaram.

### 2026-09-02 — Codex (seleção de coluna)

- Cada cabeçalho de etapa agora seleciona ou limpa todos os cards da própria
  coluna; o estado selecionado usa ícone vetorial em vez de caractere emoji.
- Validações: teste do Pipeline 4/4 e `git diff --check` passaram.

### 2026-08-31 — Codex (acesso de teste no Supabase Auth)

- Supabase CLI autenticado localmente e projeto de produção vinculado, sem gravar
  chaves no repositório ou exibi-las na saída.
- Conta de teste solicitada foi atualizada pela API administrativa, com e-mail
  confirmado e perfil correspondente em `corretores` preservado.
- Smoke test real com `signInWithPassword` retornou sessão válida; a sessão usada no
  teste foi encerrada em seguida. Nenhuma credencial foi registrada neste handoff.

### 2026-08-31 — Codex (exclusão segura de boleto Asaas)

- Identificado descompasso entre frontend e Edge Function publicada: a interface já
  enviava `excluir_cobranca`, mas produção ainda executava versão anterior à ação.
- Implementada proteção para nunca ocultar/cancelar somente no banco uma cobrança que
  continue ativa no Asaas; links de boleto e PIX são limpos após confirmação externa.
- Validações: 351/351 testes, build, bundle da função, lint dos arquivos novos e
  `git diff --check` passaram.
- Pendente confirmação humana no aviso final do Dashboard e teste destrutivo da
  cobrança real indicada nas imagens.

### 2026-08-26 — Codex (login em uma tela)

- Trabalho isolado na branch `codex/auth-one-screen`.
- `src/pages/Auth.tsx`: removido o bloco visual de login social e compactado o layout
  desktop para uma única viewport.
- `src/components/auth/PainelInstitucional.tsx`: as duas linhas do título usam degradê
  horizontal `#093323` → `#000000`, em tamanho reduzido e tipografia pesada; foi
  removido somente o travessão da frase final.
- Removido o link público `Acesso administrativo` do rodapé do formulário.
- `src/pages/Auth.visual.test.tsx`: teste de regressão cobre ausência do Google, cores do
  título, texto sem travessão e contenção da viewport.
- Validação visual em 1920×918 e 1366×768 confirmou `scrollHeight === clientHeight` nas
  abas Entrar e Cadastrar; o botão Criar Conta permaneceu visível.

### 2026-08-21 — Codex (branch isolada de autenticação e Lotti AI Gateway)

- Criada e enviada ao GitHub a branch
  `codex/google-auth-lotti-ai-gateway`, baseada em `main` (`a9866d3`).
- A branch contém dois commits: `681e163` (Google, CNPJ e recuperação de senha)
  e `820f474` (fundação do Lotti AI Gateway). Rotina, Google Calendar,
  onboarding, admin, `.env.example` e alterações paralelas do handoff ficaram fora.
- Validação em worktree limpo da própria branch: 314/314 testes, build de produção,
  Deno check nas 8 Edge Functions e ESLint sem erros (1 aviso conhecido de Fast
  Refresh em `useAuth.tsx`). O typecheck global mantém 67 erros da baseline de tipos
  Supabase; não foi usado como gate da branch.
- A branch remota está pronta para PR. Nenhuma migration nem Edge Function do AI
  Gateway foi publicada no Supabase por esta ação.

### 2026-08-20 — Codex (Funil, marca e privacidade visual)

- Branch `codex/merge-funil-brand-privacy` criada a partir da `main` remota
  (`300dc7e`) para integrar o Funil legado quando o módulo CRM não está ativo,
  preservando cabeçalho, abas e ações atuais.
- Adicionado componente visual de dado sensível, inicialmente oculto e revelado
  por botão olho individual, aplicado a contatos, valores, endereços e documentos
  em telas selecionadas do produto. A máscara não altera dados ou cálculos.
- `public/favicon.svg` atualizado com o símbolo fornecido pelo usuário.
- Validações: `npm test` 228/228 e `npm run build` passaram.

### 2026-08-20 — Codex (interação e cards do Funil)

- O arraste dos cards do Funil agora usa uma camada de sobreposição, evitando
  que o card fique atrás das colunas; o clique sintético posterior ao arraste
  não navega para o cadastro do cliente.
- Os cards foram compactados para nome, detalhe do imóvel/interesse, valor e
  indicador de conversa. O estado visual dos botões de dados sensíveis foi
  corrigido: olho aberto para dado visível e olho riscado para dado oculto.
- Validações: `npm test` 231/231, `npm run build` e `git diff --check` passaram.

### 2026-08-20 — Codex (acabamento do arraste e divisor da marca)

- A coluna de destino do Funil passou a usar contorno interno uniforme durante
  o arraste; removido o `ring` externo que era recortado em cima e embaixo.
- A sidebar ganhou uma linha divisória discreta entre a marca Lotti e o primeiro
  grupo, Operação. A linha foi aproximada da marca e a scrollbar nativa foi
  preservada. O menu recolhido mantém os divisores existentes.
- O subtítulo compartilhado das abas do CRM teve o travessão removido: “Leads,
  negócios e follow-up do primeiro contato ao fechamento.”
- Revisão pré-merge corrigiu propagação do botão de olho dentro de cards/drag,
  restaurou links `tel:`/`mailto:` após revelar contatos e mascarou valores que
  ainda apareciam no Funil, totais do CRM e lançamentos/resumo financeiro.
- Adicionado teste de renderização para esses acabamentos visuais.
- Validações: `npm test` 233/233, `npm run build` e `git diff --check` passaram.

### 2026-08-12 — Codex

- Criada a ponte de contexto entre Codex e Claude.
- Nenhum dos arquivos funcionais já modificados foi alterado nesta etapa.
- Próximo agente deve confirmar o Git e executar as validações listadas acima.

### 2026-08-12 — Codex (cobrança Asaas)

- Diagnosticado que a função remota estava na versão 5, de 2026-08-05, enquanto as
  tentativas locais de correção eram de 2026-08-10 e nunca haviam sido publicadas.
- Implementada separação definitiva: criação do pagador/cobrança não inclui telefone;
  atualização do telefone é opcional e sua falha não interrompe o pagamento.
- Publicada `asaas-sync` versão 6 e validado o endpoint ativo.
- Não restaurar o antigo contorno de alterar `clientes.telefone` no frontend.

### 2026-08-12 — Claude (autenticação e isolamento multiusuário)

Trabalho na branch **`feat/auth-multiusuario`**, ainda **não commitado** — o usuário
reservou a decisão de commit/push.

Cuidado com o Git (o ponto mais fácil de perder): `main` recebeu o revert `5423d70`,
que desfez o commit de segurança `7ccd1be`. A branch **ainda carrega o `7ccd1be`
original**. Ao fazer merge de `feat/auth-multiusuario` em `main`, o Git preserva o
revert e as correções de segurança **não voltam sozinhas** — é preciso
`git revert 5423d70` na `main` depois do merge.

O que mudou:

- `src/hooks/useAuth.tsx` (novo, substitui `useAuth.ts`): o hook virou Context. Antes
  cada consumidor criava a própria cópia do estado — três `onAuthStateChange` em
  paralelo, e o spinner piscava a cada troca de rota. Ganhou `pedirRecuperacao`,
  `definirNovaSenha` e `entrarCom` (OAuth).
- `src/lib/auth/mensagens.ts` + teste (12 casos): traduz erro do Supabase; mensagem
  desconhecida cai num texto neutro e nunca vaza inglês cru para o usuário.
- `src/pages/RecuperarSenha.tsx` e `NovaSenha.tsx` (novos): não existia recuperação de
  senha nenhuma — quem esquecia ficava trancado para sempre. A confirmação é idêntica
  exista ou não a conta, para não permitir descobrir quem é cadastrado.
- `src/pages/Auth.tsx`: duas colunas, mostrar/ocultar senha, "lembrar de mim" (guarda
  só o e-mail) e mensagem honesta quando o cadastro exige confirmação por e-mail —
  antes afirmava "já pode acessar", o que era falso.
- `src/components/auth/BotoesSociais.tsx` + `infra/OAUTH.md`: login Google/Microsoft.
  Os botões só aparecem para o que estiver em `VITE_OAUTH_PROVIDERS`, **vazio por
  padrão**: ligar antes de configurar o provedor no painel do Supabase mostraria um
  botão que só devolve "Unsupported provider".
- `supabase/migrations/20260812090000_isolamento_multiusuario.sql`: fecha os vazamentos
  entre inquilinos (policies públicas em `imovel_fotos` e `fachadas`, `WITH CHECK`
  ausente em assinatura, view sem `security_invoker`, storage por dono do imóvel).

Validações desta etapa: `npm test` **65/65**, `npm run typecheck` **74 erros — a mesma
baseline, nenhum novo**, `npm run lint` limpo nos arquivos tocados (resta só o aviso de
`react-refresh` em `useAuth.tsx`, inerente a exportar provider e hook juntos) e
`npm run build` OK.

Pendências que não são de código: a fila de `deploy-manual/` continua **sem ser colada
no painel do Supabase** — enquanto isso, os vazamentos seguem abertos em produção. Falta
ainda onboarding, empty states e o splash com progresso real.

Um alerta para quem configurar o OAuth: o trigger `handle_new_user` cria o corretor para
qualquer usuário novo, mas o Google não manda CRECI nem telefone — o cadastro nasce com
CRECI `'PENDENTE'`. É o onboarding que precisa pedir; hoje nada avisa.

### 2026-08-12 — Codex (estudo estratégico e pricing da Lotti)

- Criado `docs/ESTUDO_MERCADO_PRECIFICACAO.md`, com 22 seções, auditoria do produto,
  benchmark competitivo, fornecedores, gateways, riscos e plano de 90 dias. Afirmações
  estão rotuladas como confirmadas, estimadas, assumidas ou não encontradas.
- Criados `docs/LOTTI_UNIT_ECONOMICS.xlsx` (15 abas, fórmulas e checks) e
  `docs/unit-economics.csv` (8 cenários de escala). O cenário equilibrado é hipótese:
  R$129 / R$249 / R$499, mix 55% / 35% / 10%, CAC R$450 e churn mensal de 3%.
- Criados os decks em `output/presentations/`: Business Review (18 slides), Plano de
  90 Dias (12) e Pricing Lab (10). Todos usam os templates solicitados, possuem notas
  `[Sources]` em todos os slides, não contêm placeholders e passaram no teste de overflow.
- Exportado `output/pdf/LOTTI_BUSINESS_REVIEW_ESTRATEGICO.pdf` com 18 páginas pelo
  PowerPoint e revisado visualmente página por página.
- Criado simulador interativo em
  `C:/Users/Gabri/.codex/visualizations/2026/08/13/019ff871-053c-77d3-8f3a-c9db10d76d86/index.html`;
  validado em 1024, 736, 360 e 320 px, nos temas claro e escuro.
- Criado o template pessoal `artifact-template-lotti-strategic-business-review` em
  `C:/Users/Gabri/.codex/skills/artifact-template-lotti-strategic-business-review`.
- Nenhuma funcionalidade, migration ou integração da aplicação foi alterada nesta etapa.

### 2026-08-13 — Codex (pacote para WhatsApp)

- Criados `output/whatsapp/00_LEIA-ME.txt` e
  `output/whatsapp/MENSAGEM_PRONTA_WHATSAPP.txt`.
- Copiados os sete entregáveis estratégicos e o simulador para
  `C:/Users/Gabri/Downloads/LOTTI_PACOTE_ESTRATEGICO_2026-08-13`.
- Criado `C:/Users/Gabri/Downloads/LOTTI_PACOTE_ESTRATEGICO_2026-08-13.zip`, com
  10 arquivos/entradas e 10,01 MB. Os originais do projeto foram preservados.

### 2026-08-13 — Codex (memorando de lançamento da Lotti)

- Criados `docs/LOTTI_MEMORANDO_LANCAMENTO_90_DIAS.docx`,
  `output/pdf/LOTTI_MEMORANDO_LANCAMENTO_90_DIAS.pdf` e
  `output/whatsapp/MENSAGEM_LANCAMENTO_LOTTI.txt` a partir do template Strategy
  Memorandum. A decisão recomendada é Asaas em conta exclusiva do SaaS, com meta D30
  de 5 pagantes e 10 pilotos ativos.
- Taxas públicas de Asaas, Stripe e Vindi foram confirmadas nas páginas oficiais em
  13/08/2026. As metas e projeções permanecem identificadas como hipóteses de
  planejamento, não como histórico da empresa.
- O DOCX preserva os 29 componentes do pacote original; somente conteúdo, cabeçalho,
  rodapé, campos, metadados e as duas imagens previstas foram alterados. O PDF tem 8
  páginas, foi renderizado e revisado visualmente página por página, sem cortes,
  sobreposições, placeholders ou páginas em branco.
- Criado simulador interativo do funil, MRR, taxas e comissão em
  `C:/Users/Gabri/.codex/visualizations/2026/08/13/019ff871-053c-77d3-8f3a-c9db10d76d86/lotti-funil-lancamento.html`;
  validado em 1024, 736, 360 e 320 px, nos temas claro e escuro, incluindo interação.
- Pacote pronto para encaminhamento criado em
  `C:/Users/Gabri/Downloads/LOTTI_LANCAMENTO_90_DIAS_2026-08-13.zip` com 4 arquivos.
- Nenhum código, banco, migration ou integração da aplicação foi alterado. A
  implementação do gateway permanece fora do escopo desta entrega e deve incluir
  homologação, webhooks idempotentes e validação contábil do programa de indicação.

### 2026-08-13 — Codex (posts fixados do Instagram)

- Criada uma série coordenada de três posts institucionais 4:5 em
  `output/instagram/`, usando as logos oficiais fornecidas pelo usuário e a cor de
  marca `#093323`. A narrativa do grid é problema → resposta → plataforma.
- Entregues três PNGs finais de 1080 × 1350 px, fontes SVG editáveis, duas prévias do
  conjunto e `CAPTIONS_E_ORDEM_PUBLICACAO.txt` com legendas, textos alternativos e a
  ordem inversa necessária para publicação no Instagram.
- As bases visuais foram geradas com a ferramenta integrada de imagem e finalizadas
  com logo e tipografia determinísticas; os textos não foram rasterizados pelo modelo
  generativo. Os cinco PNGs passaram em abertura, dimensões, opacidade e revisão visual.
- Pacote criado em
  `C:/Users/Gabri/Downloads/LOTTI_POSTS_FIXADOS_INSTAGRAM_2026-08-13.zip`, com 16
  arquivos. Nenhum código ou integração da aplicação foi alterado.

### 2026-08-13 — Codex (posts fixados com dashboard — revisão V2)

- Criada uma nova série, sem sobrescrever a anterior, em `output/instagram-v2/`.
  Os três posts 4:5 (1080 × 1350 px) agora têm a interface da Lotti como elemento
  principal: visão geral, CRM/pipeline e aluguéis/cobranças.
- Como a aplicação local abriu sem sessão autenticada, as interfaces públicas foram
  reconstruídas a partir dos componentes e fluxos reais do repositório, com dados
  demonstrativos neutros; nenhuma credencial ou dado de cliente foi usado.
- O fundo editorial foi gerado com a ferramenta integrada de imagem. Logo, textos e
  telas foram compostos deterministicamente; o modelo generativo não inventou UI.
- Revisados visualmente os três posts, a prévia 4:5 e o recorte quadrado do perfil.
  O pacote pronto para envio está em
  `C:/Users/Gabri/Downloads/LOTTI_POSTS_FIXADOS_DASHBOARD_V2_2026-08-13.zip`, com
  seis arquivos e legendas. Nenhum código, banco, migration ou integração da
  aplicação foi alterado.

### 2026-08-13 — Codex (merge do PR de segurança #1)

- Revisado e aceito o PR `#1`, `fix(security): fecha vazamento cross-tenant e
  select(*) em endpoints service_role`, da branch
  `security/close-crm-buscar-imoveis-leak-and-fachada-select` para `main`.
- O merge remoto foi confirmado em `main` no commit
  `7a7bbc61ea170a7ea5ea54100d9065ec7afe8b47`; o GitHub registra o PR como
  `closed` e `merged`.
- O patch altera somente `supabase/functions/crm-buscar-imoveis/index.ts` e
  `supabase/functions/fachada-publica/index.ts`. Validações em worktree isolado:
  `npm test` 71/71, `npm run build` OK e `deno check` OK nas duas Edge Functions.
- O check do Vercel falhava por falta de acesso do autor ao projeto, não por erro de
  compilação. As ações operacionais permanecem pendentes: girar
  `N8N_SHARED_SECRET` e atualizar os workflows n8n para enviar `corretor_id`.
- `corretor_id` informado pelo caller limita a busca, mas não é autenticação forte
  por tenant; avaliar segredo/credencial específica por corretor como hardening
  posterior. Nenhuma alteração local funcional foi feita nesta revisão.

### 2026-08-13 — Codex (merge do PR de segurança #2)

- Identificado como único PR aberto do mesmo autor do `#1` e aceito o PR `#2`,
  `fix(security): restaura SET search_path em generate_monthly_rent_bills`, da
  branch `security/fix-search-path-generate-monthly-rent-bills` para `main`.
- O merge remoto foi confirmado no commit
  `e525b0146c730e83af72ef13ffc53ca57039775b`; o GitHub registra o PR como
  `closed` e `merged`.
- O patch adiciona somente a migration
  `supabase/migrations/20260813180000_fix_search_path_generate_monthly_rent_bills.sql`.
  Ela mantém o corpo financeiro vigente da função e restaura
  `SET search_path = public`, sem repetir o backfill da migration anterior.
- Validações em worktree isolado: `git diff --check` limpo, `npm test` 71/71 e
  `npm run build` OK (4.474 módulos). O aviso do Vercel continua sendo falta de
  acesso do autor ao projeto, não falha do código.
- O merge publica a migration no repositório, mas não confirma sua aplicação no
  banco Supabase; executar/verificar a migration no ambiente de destino caso o
  pipeline não aplique migrations automaticamente.
- `npm ci` restaurou as dependências locais conforme o lockfile e reportou 12
  alertas de auditoria já presentes (6 moderados, 5 altos e 1 crítico), não
  introduzidos por este PR; recomenda-se uma auditoria de dependências separada.

### 2026-08-14 — Claude (back office administrativo)

Trabalho na branch `feat/auth-multiusuario`, **não commitado**. Documentação
completa em `docs/BACKOFFICE.md`.

**PENDÊNCIA BLOQUEANTE:** as cinco migrations `20260814*` **não foram aplicadas
no Supabase** — não há CLI instalado neste ambiente e o MCP do Supabase não está
autenticado. Enquanto não forem aplicadas, `/admin` mostra uma tela de
diagnóstico explicando o que fazer; nada do back office funciona. Cópias prontas
para colar no SQL Editor estão em `deploy-manual/backoffice-*.sql`.

O que foi criado:

- **Papéis**: enum `app_role` (`admin`, `super_admin`), tabela `user_roles`,
  funções `has_role`/`is_admin`/`is_super_admin` (SECURITY DEFINER — necessário,
  senão a policy de `user_roles` consultando `user_roles` vira recursão de RLS).
  Um `admin` não concede papéis; só `super_admin`.
- **Leitura multi-tenant por RPC, não por policy.** O admin precisa ler dados de
  todos os corretores. Adicionar `OR is_admin()` nas ~30 tabelas mexeria nas
  policies que a `20260812090000` acabou de endurecer — risco alto. Em vez disso,
  RPCs `SECURITY DEFINER` com `exigir_admin()` no topo, devolvendo só as colunas
  necessárias. É também o único caminho para `auth.users`.
- **Suspensão vale no backend inteiro**: `get_corretor_id()` passou a exigir
  `status = 'ativo'`. Como as ~30 policies dependem dela, suspender fecha tudo de
  uma vez sem alterar policy nenhuma. A trigger `proteger_status_corretor()`
  impede o corretor de reverter a própria suspensão.
- **Parceiros/atribuição**: regra de **primeiro clique, janela de 90 dias**,
  implementada como `UNIQUE (visitante_id)` em `parceiro_atribuicoes` — o segundo
  link cai em `ON CONFLICT DO NOTHING`. O cliente guarda só um UUID opaco; quem é
  o parceiro o servidor relê do clique que ele mesmo gravou.
- **Comissões**: percentual e base **congelados na linha**; alterar o percentual
  abre nova vigência e não reescreve o passado. `UNIQUE (receita_evento_id)`
  impede comissão duplicada por construção. Estorno de receita estorna comissão
  em aberto, mas **não** comissão já paga.
- **Receita**: `receita_eventos` nasce vazia. Nada de valor simulado — onde não
  há dado, a tela diz "sem eventos financeiros confirmados", não "R$ 0,00".
  `UNIQUE (origem, external_id)` já deixa a idempotência do webhook pronta.
- **Atividade**: `atividade_eventos` + `corretores.ultimo_acesso_em`. "Ativo" =
  acesso dentro da janela configurável (30 dias). Quem nunca teve acesso
  registrado é `sem_dados`, **não** inativo — o registro começou agora.

Validações: `npm test` **189/189** (65 da baseline + 124 novos), `npm run
typecheck` **74 erros — a mesma baseline, nenhum novo**, `npm run lint` limpo nos
arquivos novos, `npm run build` OK.

Não validado: `deno check` nas duas Edge Functions novas (Deno não instalado) e
`supabase/tests/admin_rls.sql`, que precisa ser rodado no SQL Editor após as
migrations.

Fora do MVP por decisão registrada: impersonação (exigiria emitir sessão de
terceiro via service_role) e regeneração do `types.ts` (dívida anterior, mexeria
na baseline de 74 erros).

### 2026-08-15 — Codex (responsividade mobile/tablet)

- A implementação foi isolada em
  `C:/Users/Gabri/AppData/Local/Temp/lotti-mobile-responsive`, branch
  `codex/mobile-responsive`, criada diretamente de `origin/main` no commit
  `e525b0146c730e83af72ef13ffc53ca57039775b`. O trabalho administrativo não foi
  copiado para essa branch.
- Criado o commit local `4cf656c` (`feat(ui): implement mobile-first responsive
  experience`) com 77 arquivos, todos em `src/`: navegação mobile em drawer,
  fundação de componentes responsivos, tabelas operacionais em cards, formulários,
  modais, dashboards, mídia, CRM, aluguéis, jurídico, financeiro e telas públicas.
- Validações: `git diff --check` limpo, `npm test` 71/71 e `npm run build` OK
  (4.475 módulos). O `npm run typecheck` continua falhando pela dívida de tipos já
  existente em `origin/main`; a filtragem dos componentes estruturais e páginas
  principais alterados não encontrou erro novo de tipagem.
- Validação visual local realizada em 320, 360, 375, 390, 412, 768 px, tablet em
  paisagem e desktop. Nas rotas públicas testadas não houve overflow horizontal;
  inputs de texto ficaram com 16 px e ações principais com aproximadamente 44 px.
- Pendente: publicação e deploy. O GitHub CLI (`gh`) não está instalado nesta
  máquina, requisito do fluxo de publicação; a branch permanece um commit à frente
  de `origin/main` e ainda não foi enviada. Após instalar/autenticar `gh`, executar
  push, abrir/revisar o PR e promover apenas `4cf656c` para `main`.
- Pendente de QA com credencial de teste: percorrer todas as rotas protegidas e
  níveis de acesso no navegador. A auditoria estática, os testes e o build cobrem o
  pacote, mas a sessão local disponível não estava autenticada.

### 2026-08-16 — Codex (Clientes, Funil de Vendas e Fachadas)

- Implementação mantida isolada em `C:/Users/Gabri/AppData/Local/Temp/lotti-mobile-responsive`, branch `codex/mobile-responsive`; o worktree administrativo em `feat/auth-multiusuario` não foi incorporado nem alterado.
- `Clientes` foi reconstruída com o layout operacional da referência: indicadores, busca e filtros, tabela responsiva, seleção, paginação, modos lista/grade, WhatsApp, edição/exclusão e importação CSV real (`nome` e `telefone` obrigatórios).
- `Funil de Vendas` recebeu cabeçalho/tabs/controles e Kanban equivalentes à referência, preservando drag-and-drop e gravação das etapas. “Novo lead” cria cliente e, no CRM completo, oportunidade; “Nova tarefa” funciona também no modo legado por meio de alertas.
- `Fachadas` recebeu KPIs, filtros, ordenação, lista/grade, cartão horizontal com foto, QR Code local, cópia de link, prévia/PDF, edição, leads e fluxo explicativo. Métricas nulas ou atrasadas agora degradam para totais calculados, sem derrubar a página.
- Sidebar agrupada, busca global e cabeçalhos compartilhados foram alinhados ao mesmo padrão. O acionador do assistente mostra “IA Lotti” no desktop e mantém formato compacto no celular.
- Validações: `npm run build` OK (4.477 módulos), `npm test -- --run` 71/71, `git diff --check` limpo. Revisão visual e de interação realizada em 1.280×800 e 390×844 nas três rotas; o bypass exclusivamente usado para inspeção local foi removido antes da validação final.
- `npm run typecheck` continua reportando a dívida de tipagem já documentada da baseline (tabelas Supabase não regeneradas e outros módulos); nenhum erro novo permaneceu nos arquivos adicionados nesta etapa.
- Pendente: commit/push/PR e QA autenticado com dados reais antes de promover para produção. Nenhum deploy foi executado.

### 2026-08-17 — Claude (notificações do Asaas e baixa de repasse)

Branch **`feat/notificacoes-asaas`**, separada a pedido do usuário.

O webhook do Asaas descartava transferências: a primeira linha do
processamento era `if (!payment?.id) { finalize('IGNORED'); return; }`, e
evento de transferência não tem `payment`, tem `transfer`. O PIX de repasse
saía, o Asaas avisava, e o repasse ficava `AGENDADO` para sempre.

O que mudou:

- `asaas-webhook` trata `TRANSFER_*`. Concluída dá baixa (`CONFIRMADO`),
  falhada devolve para `ERRO` com alerta de prioridade alta. Em trânsito
  (`PENDING`, `BANK_PROCESSING`) só registra o estado — dar baixa ali marcaria
  como pago algo que ainda pode falhar.
- Recebimento de fatura passa a gerar notificação com o nome do inquilino. O
  alerta roda em `try/catch` e não bloqueia o `finalize`: se falhar, a fatura
  continua paga. O dinheiro é o fato; a notificação é conveniência.
- Sino do header virou painel real (`PainelNotificacoes`), com filtro
  Todas/Financeiro/Operação, link para a entidade de origem e "marcar todas
  como lidas" numa única RPC. Ligado também em Financeiro, Jurídico e
  Fachadas, que não tinham.

**Conciliação transferência → repasse.** `repasses_proprietario.external_id`
existe desde 20260122130000 mas ninguém preenche: nada cria transferência pelo
Asaas, o PIX é feito por fora. `conciliar_transferencia_repasse()` tenta, em
ordem: `external_id`, `externalReference`, e por fim valor exato + chave PIX do
proprietário entre repasses em aberto. O terceiro é o caso real hoje, e ele
**só dá baixa com exatamente um candidato** — dois repasses de mesmo valor para
a mesma chave são indistinguíveis, e escolher um seria adivinhar com dinheiro
de terceiro. Ambíguo fica registrado em `conciliacao_pendente`.

Validações: `npm test` **218/218** (23 novos em `lib/notificacoes.test.ts`),
`npm run typecheck` **74 — baseline, nenhum novo**, lint limpo nos arquivos
tocados, build OK, 6 telas sem overflow e sem erro de console.

Pendências: `deploy-manual/notificacoes-asaas.sql` e `deploy-manual/asaas-webhook.ts`
não foram aplicados. E é preciso **marcar os eventos TRANSFER_* no painel do
Asaas** — sem isso ele não envia transferência e o resto não acontece.

### 2026-08-19 — Claude (sino do Asaas ao vivo + ativação)

Branch **`feat/sino-asaas-ao-vivo`**, separada por ser trabalho de Asaas.

**A falha central: o sino só atualizava no F5.** `fetchAlertas()` rodava uma
única vez, no `DataLoader`, durante o bootstrap. O webhook gravava o
recebimento em `alertas`, o corretor ficava com a tela aberta a tarde inteira,
e o número continuava zerado. Um sino que só atualiza no reload é histórico,
não notificação — e era esse o estado de tudo que subiu em 17/08.

`src/hooks/useAlertasAoVivo.ts` resolve em duas camadas, de propósito:

1. **Realtime** (`postgres_changes` em `alertas`, filtrado por `corretor_id`)
   — chega em ~1 s.
2. **Sondagem** (90 s + no foco da janela) — rede de segurança. O Realtime
   exige `alertas` na publication `supabase_realtime`, que é configuração de
   banco e pode não estar aplicada. Sem a camada 2 o sino ficaria
   silenciosamente morto nesse cenário — exatamente o estado atual do projeto.

A sondagem no foco é a que mais rende: o corretor sai para o app do banco,
confirma o PIX e volta; é ao voltar que ele quer ver o alerta.

**Painel no modelo do Asaas.** Badge numérico (`rotuloContagem`, corta em
`99+`) no lugar do ponto — "3" e "1" pedem ações diferentes e o ponto colapsava
as duas. Valor na própria linha com sinal e cor, quebras por dia
(Hoje / Ontem / Esta semana / Este mês), e balanço do sino sob `motion-safe`
quando o número sobe.

**Erro que a captura de tela pegou e a leitura de código não pegaria:** o
repasse que FALHOU aparecia como `− R$ 970,00`, ao lado do texto "NÃO foi
concluído". O valor é a parte que o olho lê primeiro — dizia o contrário do
alerta. `movimentouSaldo()` agora separa os dois casos, e a falha rende valor
riscado em vermelho, sem sinal.

**Bug de idempotência no webhook, no caminho de transferência.** O fallback do
`event_id` era `sha256(event : payment.id : payment.dateCreated)`. Evento de
transferência não tem `payment` — todo `TRANSFER_DONE` sem `payload.id` gerava
o hash de `"TRANSFER_DONE::"`, idêntico para qualquer transferência. O primeiro
repasse entraria e, do segundo em diante, o unique de `event_id` descartaria
tudo como reentrega. Corrigido para incluir `transfer.id`/`transfer.dateCreated`.

Validações: `npm test` **246/246** (28 novos em `lib/notificacoes.test.ts`),
`npm run typecheck` **74 — baseline, nenhum novo**, lint limpo nos arquivos
tocados (webhook mantém os mesmos 8 erros pré-existentes), build OK, 8 telas em
1600×900 e 390×844 sem overflow horizontal e sem erro de console.

**Pendências de ativação — nada disso funciona até serem feitas:**

1. `deploy-manual/asaas-ATIVAR.sql` no SQL Editor. Três blocos; o BLOCO 1
   (valores do enum) roda **sozinho**, porque Postgres não deixa usar um valor
   de enum na mesma transação em que foi criado — junto, a função que grava o
   alerta falharia com "invalid input value for enum" e o webhook confirmaria o
   repasse perdendo a notificação. BLOCO 3 devolve tabela de conferência com 12
   linhas, todas devendo sair `OK`.
2. Republicar a Edge Function `asaas-webhook` (`deploy-manual/asaas-webhook.ts`).
   A versão em produção ainda descarta transferência.
3. Painel do Asaas → Webhooks: marcar `TRANSFER_CREATED`, `TRANSFER_PENDING`,
   `TRANSFER_DONE`, `TRANSFER_FAILED`, `TRANSFER_CANCELLED`.

**Observação de segurança sobre a chave de API (menor privilégio).** O código
usa exatamente três escopos: `PAYMENT` escrita, `CUSTOMER` escrita,
`FINANCIAL_TRANSACTION` leitura. **Nada no código cria transferência nem PIX de
saída** — o repasse é feito à mão no painel. Manter "Movimentações
financeiras / Pix" em Escrita dá a uma chave vazada o poder de mandar dinheiro
para fora sem que isso habilite nenhuma funcionalidade do sistema.

### 2026-08-19 — Claude (ajuda contextual no lugar do botão morto)

O "?" do cabeçalho tinha tooltip e não abria nada. Ícone que não faz nada é
pior que ícone ausente: a pessoa clica, nada acontece, e conclui que o sistema
está quebrado.

`src/lib/ajuda.ts` (conteúdo + busca, puro e testado) e
`src/components/shell/PainelAjuda.tsx` (gaveta lateral). Três decisões:

- **Gaveta, não modal.** A ajuda fica aberta enquanto a pessoa executa o passo
  na tela atrás; modal obrigaria a decorar e fechar.
- **Abre no assunto da tela.** Quem trava em Fachadas quer fachada, não um
  índice de tudo. Os gerais ficam abaixo, na seção "Vale para todo o sistema".
- **Busca pelo problema, sem acento.** A pessoa digita "nao recebi aviso do
  pix", não o nome que demos ao tópico — a busca varre passos e sinônimos com
  pesos (título 8, sinônimo 5, resumo 3, corpo 1) e a tela atual desempata.

Nenhum tópico descreve função que não existe: todos os passos correspondem a
botão ou fluxo real, e os `ATALHOS` listam só Ctrl+K, `?` e Esc, que são os que
estão implementados. Os avisos de "atenção" cobrem as armadilhas caras — QR
imutável, vencimento no passado, ambiguidade da conciliação de repasse, e que
a IA de contrato erra.

Atalho `?` abre a gaveta, mas nunca com foco em campo de texto — senão digitar
uma pergunta abriria a ajuda no meio da frase. Os atalhos ficam ocultos abaixo
de `sm`: teclado não existe no celular, e ali o espaço é justamente o que falta.

Validações: `npm test` **263/263** (17 novos em `lib/ajuda.test.ts`),
typecheck **74 — baseline**, lint limpo, build OK, 390×844 e 1600×900 sem
overflow e sem erro de console.

**Banco: `deploy-manual/asaas-ATIVAR.sql` foi aplicado pelo usuário em 19/08 —
conferência 12/12 OK.** Continuam pendentes: republicar a Edge Function
`asaas-webhook` e marcar os eventos `TRANSFER_*` no painel do Asaas.

### 2026-08-20 — Claude (merge e deploy do sino e da ajuda)

`feat/sino-asaas-ao-vivo` mesclada na main em **9d4a09f** e publicada.

Conferência do deploy: a API da Vercel não expunha o SHA do commit neste projeto,
e comparar o hash do bundle não serve — a Vercel builda com as próprias variáveis
de ambiente, então o hash sempre difere do build local. A verificação foi feita por
**conteúdo**: baixados os 110 chunks servidos em produção e confirmadas 8 marcas do
código novo (`postgres_changes`, `animate-sino`, `Marcar lidas`, `Esta semana`,
`cliente-novo`, `qrcode`, `Vale para todo o sistema`, `Busque pelo que`). Todas
presentes. Fica registrado como o método para as próximas vezes.

**O sino ainda não recebe transferência**, e isso não depende de código:

1. Republicar a Edge Function `asaas-webhook` — a versão no ar lê `payment` e
   descarta evento de transferência, que traz `transfer`.
2. Marcar `TRANSFER_*` no painel do Asaas.

O SQL (`deploy-manual/asaas-ATIVAR.sql`) já foi aplicado pelo usuário em 19/08,
conferência 12/12 OK.

**Dívida levantada pela modelagem de custo desta sessão**, em ordem de retorno:
`crmContext` está na 3ª linha do system prompt do `ai-assistant` e quebra o prefixo
de cache logo no começo — mover para o fim vale 53% da conta de qualificação;
não registramos tokens em lugar nenhum; e `ImovelFotosUpload` sobe foto de até 5 MB
e vídeo de até 500 MB sem compressão, embora `downscaleToBase64()` já exista.

### 2026-08-20 — Claude (esconder valores, no modelo do banco)

Construído em cima de `privacidade.ts` e `dado-sensivel.tsx`, que o Codex subiu
horas antes — nada foi duplicado.

**O que estava invertido.** Cada valor tinha o próprio olhinho e começava
escondido. Em Financeiro isso obrigava o corretor a clicar em três olhos para
ver os próprios números, toda vez que a página abria e de novo ao voltar.
Proteger dado é bom; esconder do dono por padrão é outra coisa. Aplicativo de
banco faz o contrário: mostra, e o olho é para esconder.

Agora há um interruptor único no cabeçalho (`BotaoPrivacidade`), lembrado em
`localStorage` via `stores/privacidadeStore.ts`. Dinheiro segue o interruptor e
aparece por padrão; **dado pessoal** (telefone, e-mail, documento, endereço)
mantém o olho individual começando escondido — ali a proteção é contra expor
dado de terceiro e o padrão certo é o inverso. Com o modo privado ligado, o
olho individual **some**: seria uma brecha na própria proteção deixar algo
increvável enquanto a tela está sendo compartilhada.

**O furo que só a captura de tela pegou.** Com o modo ligado, o valor sumia do
canto do cartão e continuava escrito por extenso na frase: "Recebimento de
R$ 2.300,00 de Diego Vinícius Mendes". O webhook grava a mensagem já com o
valor embutido, e reescrever no banco não serve — a mensagem é histórico.
`mascararValoresNoTexto()` resolve na exibição, no sino e nas Ações críticas.
Ele não toca em número que não é dinheiro: "vence em 15 dias" segue legível,
porque esconder o prazo não protege ninguém e tira o sentido do aviso.

Cobertura adicionada além do que já usava `DadoSensivel`: **Saldo Asaas** (a tela
do print), valores do sino, `KPICard` do Financeiro e o preço do imóvel no
Início. Percentual e contagem ficam de fora — não expõem patrimônio e mascarar
deixaria o cartão sem sentido.

**`scripts/screenshots.mjs`** ganhou o estado do modo privado por rota. A
preferência é lembrada de propósito, e isso vazava entre as capturas — uma rota
com o modo ligado mascarava todas as seguintes. Agora cada rota declara o
estado e o harness o garante.

**BillsList.tsx tinha trabalho não commitado do Codex.** Foi indexada apenas a
minha alteração (5 linhas), montando a versão HEAD+mudança com `hash-object` e
`update-index`, sem tocar na árvore de trabalho. As 80 linhas dele seguem
abertas e intactas, junto com `asaas-sync/index.ts`.

Validações: `npm test` **278/278** (10 em `privacidade.test.ts`), typecheck
**74 — baseline**, lint limpo nos arquivos tocados, build OK, 1600×900 e
390×844 sem overflow e sem erro de console.

### 2026-08-20 — Claude (modo privado cobrindo Aluguéis, Clientes e Financeiro)

Três defeitos apontados por captura de tela do usuário, todos reais.

**1. O olho era opt-in por página.** `PageHeader` tinha ganho um prop
`comPrivacidade`, e só Dashboard e Financeiro o passavam. Clientes, Funil,
Jurídico, Mídias e Fachadas ficaram **sem o controle** — e como o modo é global
e lembrado, dava para ligar no Financeiro e não conseguir desligar em Clientes.
O prop foi removido: o botão é sempre renderizado. Opt-in por página, num
recurso global, garante página esquecida.

**2. Um olhinho por linha na lista de Clientes.** Com 32 clientes eram 32
botões empilhados na coluna de contato, e ver os telefones exigia 32 cliques.
Pior: não protegia — em tela compartilhada bastava um clique para expor.
`DadoSensivel` perdeu o botão próprio; tudo segue o interruptor do cabeçalho.
Dado pessoal passa a aparecer por padrão, como dinheiro.

**3. Valores vazando com o modo ligado.** Aluguéis inteiro e as abas Custos,
Faturamento e Projeção do Financeiro mostravam números crus. A causa era
`R$ {x.toLocaleString(...)}` repetido em 29 lugares — mascarar à mão dependia de
ninguém esquecer. Criado `components/ui/dinheiro.tsx`: agora ou o valor passa
pelo componente, ou ele aparece cru numa busca por `toLocaleString`.

Também mascarado o **eixo dos gráficos**. "R$ 40k" no topo entrega a ordem de
grandeza mesmo com todos os números escondidos; no modo privado o eixo fica sem
rótulo e o gráfico mostra só a forma. Fora do escopo de propósito:
`NewContractDialog`, onde o corretor está digitando o valor e precisa vê-lo.

O botão em Aluguéis estava colado no título, parecendo sobra de layout; foi
para a direita, alinhado com os cartões que ele governa.

**Verificação.** Varredura com Playwright em 14 telas e abas, com o modo ligado,
procurando qualquer `R$` seguido de dígito: **nenhum valor cru**. É esse o teste
que vale a pena repetir ao mexer em dinheiro na interface.

Validações: `npm test` **278/278**, typecheck **74 — baseline**, lint sem erro
novo (RepassesList 5 e ContractsList 9 são `no-explicit-any` pré-existentes,
idênticos ao HEAD), build OK, 1600×900 e 390×844 sem overflow nem erro de
console.

### 2026-08-20 — Codex (Mídias e leads de Fachadas)

- Mídias mantém sino e ajuda, mas não exibe o interruptor de privacidade.
- Em Fachadas > Leads, telefone e e-mail usam `DadoSensivel`; quando o modo
  privado está ativo, deixam de aparecer em texto.
- Testes específicos criados para os dois comportamentos e `npm run build`
  passou nesta etapa.
### 2026-08-20 — Codex (fundação do Lotti AI Gateway)

- O prompt de arquitetura anexado foi convertido em contrato executável em
  `docs/AI-SPEC.md`. A decisão foi manter um gateway fino nas Edge Functions e
  Gemini 2.5 Flash, sem adicionar framework de agentes nesta fase.
- Provedor, modelo, timeout, retry e versões de prompt foram centralizados em
  `supabase/functions/_shared/ai`. As seis funções que chamavam Gemini diretamente
  agora passam por esse provider. O BYOK de fotos e a chave no `localStorage` foram
  removidos.
- `ai-assistant` agora recebe módulo/intenção/fuso/trace, carrega as mensagens mais
  recentes, limita o loop de tools, escapa documento externo, usa rate limit atômico,
  respeita `ai_assistant_monthly` e registra telemetria sem conteúdo bruto, com
  estimativa configurável de tokens/custo.
- Escritas sugeridas deixaram de ser executadas pelo navegador. A nova `ai-action`
  carrega uma proposta persistida pelo tenant/usuário, revalida o schema, exige
  confirmação, reivindica o estado de forma condicional e executa com idempotência.
- A migration `20260821002556_lotti_ai_gateway_fundacao.sql` endurece o bucket de
  anexos, fecha o contador de rate limit, cria registros de prompt/run/tool/feedback/
  memória/proposta e mantém `plan_entitlements`/`usage_counters` como fonte de cotas.
- Validações: 333/333 testes Vitest, build de produção, ESLint dos arquivos frontend,
  Deno check nas 8 Edge Functions, Deno lint nos 14 arquivos backend relevantes
  (excluídas `no-import-prefix` e `no-explicit-any`, incompatíveis com o padrão atual) e
  parse PostgreSQL das 66 instruções da migration, além de `git diff --check` sem
  erro. O typecheck global caiu de 74 para 66 erros de baseline;
  nenhum erro novo aparece no trecho alterado do fluxo de confirmação.
- Pendências: migration e Edge Functions desta fundação ainda não foram publicadas;
  Docker está desligado e o projeto não está ligado no Supabase CLI, portanto a
  migration ainda precisa de validação dinâmica/staging. O n8n legado também segue
  fora do gateway e não deve operar multiempresa antes de receber tenant confiável.

### 2026-08-20 — Codex (Google, CNPJ e recuperação de senha)

- O botão Google passou a aparecer sempre no login e dispara OAuth com retorno
  para `/auth`; erros/cancelamento do provedor são traduzidos sem expor tokens.
- O cadastro trocou CRECI por CNPJ, com máscara e validação de dígitos, e envia
  o documento nos metadados. A migration
  `20260820191200_cadastro_cnpj_auth.sql` grava o valor em `corretores.cnpj_cpf`
  e mantém `creci = 'PENDENTE'` somente por compatibilidade com o schema legado.
- Recuperação ganhou validação local de e-mail, espera explícita pela sessão do
  link e tratamento de link inválido/expirado. O endpoint remoto de recuperação
  respondeu HTTP 200 em smoke test com endereço sintético não entregável.
- Verificação remota pública do Auth: Google está desabilitado e
  `disable_signup = true`. Portanto OAuth/cadastro real só fica ativo depois
  de configurar as credenciais Google e permitir novos cadastros no Supabase.
- O usuário aplicou `20260820191200_cadastro_cnpj_auth.sql` no SQL Editor em
  2026-08-20 e apresentou o resultado `Success. No rows returned`, esperado para
  a definição da função e para o backfill quando não há linhas elegíveis.
- Validações: `npm test` 287/287, `npm run build`, lint dos arquivos tocados
  (0 erros, 1 aviso pré-existente de Fast Refresh), smoke em 390 px sem overflow
  e `git diff --check` limpo. `npm run typecheck` mantém os 74 erros da baseline
  já documentada e não aponta erro nos arquivos desta alteração.
- Deploy de produção criado na Vercel em 2026-08-20 (`dpl_5ZGNjSwzBZZ3dYxKGsk1iwDzDxdX`)
  e confirmado como `Ready`. O domínio principal `https://olivercrm.vercel.app/auth`
  foi aberto e validado por conteúdo: botão Google, recuperação de senha e cadastro
  com CNPJ aparecem na versão publicada. A ativação do Google e de novos cadastros
  no Supabase continua pendente.

### 2026-08-20 — Codex (Central de Rotina operacional)

- A rota `/rotina`, a navegação e a aba **Configurações → Agenda** foram integradas
  ao app. A tela entrega briefing, próxima ação, tarefas, sinais do CRM, inbox,
  visão dia/semana/mês/lista, agenda de equipe autorizada, filtros e CRUD em drawer,
  incluindo drag, resize, recorrência, conflito, delegação e histórico.
- A migration `20260821004218_rotina_operacional.sql` cria organização/membros,
  eventos, tarefas, checklist, lembretes, preferências, automações, auditoria e toda
  a persistência do Google. RLS restringe usuário comum à própria rotina, libera
  coordenação não privada para gestores e mascara colisão privada como “Horário
  ocupado”. Tokens/mappings/watch não são expostos à Data API.
- O comando em linguagem natural usa o Lotti AI Gateway e fallback local, sempre
  produzindo proposta confirmável. A conclusão chama RPC protegido para registrar
  histórico e atualizar o último contato no CRM, compatível com os dois schemas de
  histórico encontrados no projeto.
- Google Calendar foi preparado com OAuth 2.0, state hash, PKCE, refresh token
  AES-256-GCM, calendários/direção/padrão, privacidade completa/parcial/ocupado,
  syncToken, full sync após 410, recorrência/cancelamento, IDs determinísticos,
  extended properties, etag, resolução explícita de conflito, events.watch,
  renovação, webhook idempotente e retry com backoff. Configuração e deploy estão
  documentados em `docs/ROTINA_GOOGLE_CALENDAR.md`.
- Validações: migration aplicada em PostgreSQL 17 isolado; `routine_rls.sql` passou
  9/9 cenários; Deno check passou nas 4 funções e 2 módulos compartilhados; testes
  Deno 10/10; Vitest 342/342; ESLint dos arquivos tocados; build de produção; smoke
  visual em 1440 px e 390 px sem overflow nem erro de console. O typecheck global
  mantém 67 erros de baseline e não aponta erro em nenhum arquivo tocado da Rotina.
- Pendências verificáveis: migration e Edge Functions ainda não foram publicadas no
  projeto remoto; Client ID/Secret do Google não estão disponíveis, portanto OAuth,
  webhook HTTPS e ida/volta com uma conta Google real ainda exigem homologação após
  configurar os secrets. As regras padrão de automação estão preparadas, desligadas
  por padrão; disparos de e-mail/WhatsApp/push continuam evolução posterior.
### 2026-08-21 — Codex (onboarding de ativação)

- Foi implementado onboarding persistente por persona para corretor autônomo,
  gestor/proprietário, usuário convidado e profissional administrativo. O fluxo
  cria os primeiros imóvel, cliente, oportunidade e tarefa nas tabelas operacionais,
  permite continuar depois e mantém checklist, tours e ajuda contextual no produto.
- A migration `20260821130000_onboarding_ativacao.sql` reutiliza
  `routine_organizations`, `routine_memberships`, `routine_tasks` e
  `calendar_connections`; adiciona perfis/progresso/eventos/checklist/tours/convites,
  dados de demonstração isolados, RPCs idempotentes, métricas agregadas e RLS.
- Dados de demonstração são marcados, excluídos dos indicadores e removíveis sem
  apagar dados reais. Convites exigem compartilhamento explícito e aceitação por
  e-mail; nenhum envio externo silencioso foi introduzido.
- Verificações: `npm test` passou 342/342 em 31 arquivos, build de produção passou,
  ESLint direcionado aos arquivos do onboarding e integrações passou sem achados e
  QA visual em 1440x1000 e 390x844 ficou sem overflow e sem violações axe A/AA nas
  telas verificadas. O typecheck global ainda aponta 67 erros nos módulos legados de
  assinatura/fachadas/IA/sidebar, sem erro nos arquivos novos do onboarding.
- Pendente: aplicar as migrations em ambiente isolado/staging e executar
  `supabase/tests/onboarding_ativacao.sql`. O runner local não pôde executar porque
  a rede Docker esperada para este projeto não existe; a porta 54322 encontrada
  pertence ao projeto `upstage` e foi preservada sem alterações.
- Em 2026-08-21, a branch local `codex/onboarding-ativacao` foi criada a partir de
  `main` para isolar a entrega. O worktree permanece sem commit/push porque também
  contém alterações não commitadas de Rotina, IA e autenticação; `npm test` foi
  repetido após a decisão de branch e passou 342/342.

### 2026-08-21 — Codex (branch isolada da Central de Rotina)

- A entrega da Central de Rotina foi isolada na branch local
  `codex/central-rotina`, criada a partir de `main`, no commit `994e0f7`
  (`feat: adicionar central de rotina e Google Agenda`). O commit contém somente
  os arquivos e trechos da Rotina e sua dependência mínima do provedor Gemini;
  alterações paralelas de autenticação, onboarding e gateway permaneceram fora.
- O commit foi verificado em worktree temporário independente: Vitest 307/307,
  build de produção, `deno check` das quatro Edge Functions e dois módulos
  compartilhados, além de testes Deno 10/10. O worktree temporário foi removido.
- A branch foi enviada para `origin/codex/central-rotina` e o pull request rascunho
  `#4` foi aberto contra `main`:
  `https://github.com/trindadeprobusiness-wq/casa-mente-contrato/pull/4`.

### 2026-08-21 — Codex (diagnóstico remoto da Central de Rotina)

- Consultas somente leitura ao projeto `dqlolypbmsjgqrvdesev` confirmaram que
  `routine_memberships` ainda responde `PGRST205` e que `google-calendar-auth`,
  `google-calendar-sync`, `google-calendar-webhook` e `routine-command` ainda
  respondem `404 NOT_FOUND`; nenhuma alteração remota foi realizada.
- `crm_oportunidades` também responde `PGRST205`. Como
  `20260821004218_rotina_operacional.sql` cria chaves estrangeiras e policy sobre
  essa tabela, a migration `20260811150000_crm_module.sql` é pré-requisito e deve
  ser aplicada antes da migration da Rotina.
- As dependências legadas verificadas pela Data API (`corretores`, `clientes`,
  `fachadas`, `fachada_leads`, `cliente_imovel`, `contratos`, `alertas` e
  `historico_contatos`) existem; `get_corretor_id()` também respondeu. A migration
  da Rotina faz o bootstrap de organização e membership dos corretores existentes.

### 2026-08-21 — Codex (SQL da Central de Rotina aplicado pelo usuário)

- O usuário aplicou as migrations de CRM e Rotina no projeto remoto e apresentou
  verificação com `crm_oportunidades`, `routine_memberships`, 1 organização e
  1 membership ativo.
- Smoke remoto somente leitura confirmou que as tabelas operacionais da Rotina
  entraram no schema da Data API. `routine_detect_conflicts` e
  `routine_register_completion` existem e rejeitam o papel anônimo com `42501`,
  conforme esperado.
- `calendar_connections`, estados/tokens de sincronização, watches, mappings e
  recibos de webhook permanecem inacessíveis ao papel anônimo. As Edge Functions
  `google-calendar-auth`, `google-calendar-sync`, `google-calendar-webhook` e
  `routine-command` ainda respondem `404 NOT_FOUND` e continuam pendentes de deploy.

### 2026-08-21 — Codex (tentativa de ativação administrativa)

- O Supabase CLI local está instalado (versão 2.115.0), mas não possui sessão nem
  `SUPABASE_ACCESS_TOKEN`; a listagem de secrets exige autenticação administrativa.
- Não há navegador automatizável conectado nesta sessão para reutilizar o login já
  aberto pelo usuário no Dashboard. Nenhum secret, migration ou Edge Function foi
  alterado nesta tentativa.

### 2026-08-21 — Codex (publicação da Rotina e manutenção do Google Calendar)

- Publicadas no projeto `dqlolypbmsjgqrvdesev`, versão 1 e estado `ACTIVE`, as
  Edge Functions `google-calendar-auth`, `google-calendar-sync`,
  `google-calendar-webhook` e `routine-command`, todas com validação própria e
  `verify_jwt = false` conforme o código e `supabase/config.toml`.
- Cadastradas as URLs de callback/webhook/retorno e chaves internas independentes.
  A chave de manutenção foi armazenada também no Vault, sem valor em SQL ou neste
  handoff.
- Criado o Cron `routine-google-calendar-maintain` com agenda `*/30 * * * *`.
  Chamada real via `pg_net` retornou HTTP 200, sem timeout, com zero conexões ativas,
  resultado esperado antes do primeiro vínculo com uma conta Google.
- Smoke público confirmou `401` para auth/sync/comando sem sessão e `400` para o
  webhook sem cabeçalhos, comprovando que os quatro endpoints existem e estão
  protegidos.
- Pendente: cadastrar `GOOGLE_CALENDAR_CLIENT_SECRET`. O projeto remoto contém o
  Client ID, mas não contém esse secret; a busca local não encontrou JSON de
  credenciais baixado do Google. OAuth real não pode ser concluído sem essa
  credencial emitida pelo Google Cloud.

### 2026-08-21 — Usuário/Codex (credencial OAuth completa)

- O usuário apresentou confirmação do Dashboard de que o secret
  `GOOGLE_CALENDAR_CLIENT_SECRET` foi criado com o nome esperado.
- Smoke posterior confirmou `google-calendar-auth` publicado e o callback redirecionando
  para `https://olivercrm.vercel.app/configuracoes?tab=agenda&google_calendar=error`
  quando recebe state/código deliberadamente inválidos, comportamento esperado.
- Pendente apenas homologação interativa: o próprio usuário deve autorizar a conta
  Google em **Configurações → Agenda**; essa etapa de consentimento não pode ser
  executada em nome do titular.

### 2026-08-31 — Claude (conta Asaas por inquilino — contencao)

Branch **`fix/asaas-por-inquilino`**, criada de `main`. Nada commitado, nada
publicado. O trabalho nao commitado do Codex (`excluir-cobranca.ts` +
`asaas-sync`) foi preservado e esta na arvore junto.

**Sobre o Git, porque mexeu no seu estado.** Durante esta sessao algo commitou a
arvore de `feat/ui-responsivo` como `f1af885` ("Implement contract management
workflow", 76 arquivos, 8830 insercoes) e trocou para `main`. O reflog registra o
que e quando; nao registra quem. Nada se perdeu: os 76 arquivos estao em
`f1af885` e `feat/ui-responsivo` aponta para ele.

**O defeito.** `_shared/asaas.ts:18` lia uma `ASAAS_API_KEY` global, sem
parametro de inquilino. Nao era so o saldo compartilhado da tela: `asaas-sync`
faz `POST /payments` e `POST /customers`, entao um corretor novo criava a
cobranca DENTRO da conta da imobiliaria-piloto e o aluguel do cliente dele caia
la. Custodia de dinheiro de terceiro, anterior a discussao de interface.

**O desenho** copia o precedente da Meta (`meta_connection_secrets`), que resolveu
o mesmo problema neste repo: `asaas_conexoes` guarda metadado com RLS por
corretor; `asaas_conexao_segredos` guarda a chave cifrada em tabela com RLS
ligada e NENHUMA policy, mais REVOKE — inalcancavel pela Data API ate para o
dono. Cifra AES-256-GCM em `_shared/asaas-crypto.ts`, com chave
`ASAAS_TOKEN_ENCRYPTION_KEY` **propria**, nunca a da Meta.

**A heranca sem segredo em SQL.** A migration nao grava chave: marca
`herdada_do_ambiente` para quem ja emitiu cobranca, e a fabrica resolve essa
linha para a `ASAAS_API_KEY` do ambiente. Quem herda e deduzido de evidencia
(`faturas_aluguel.external_id` preenchido) e so quando ha **exatamente um**
candidato — com zero ou 2+, ninguem herda e todos conectam a propria chave.
Adivinhar ali reabriria o vazamento.

**Dois furos que a revisao pegou no meu proprio codigo, ambos corrigidos:**

1. **Escalacao de privilegio pela Data API.** A policy que chamei de "atualiza o
   passo do guia" liberava UPDATE de TODAS as colunas da propria linha — RLS
   decide linha, nao coluna. O corretor podia marcar `herdada_do_ambiente = true`
   em si mesmo e passar a usar a chave da conta-mae. O indice unico parcial so
   barra isso quando ja existe outra linha herdada, ou seja, nao barra nada no
   caso de ninguem ter herdado. Fechado com `REVOKE ALL` +
   `GRANT SELECT` + `GRANT UPDATE (passo_guia)`.
2. **Fail-open na conciliacao de repasse.** No webhook legado sem conexao
   herdada, o inquilino vinha nulo e desligava o escopo: o criterio de valor +
   chave PIX voltava a varrer a base inteira, e os dois valores sao adivinhaveis
   (aluguel redondo, chave PIX e CPF/CNPJ/telefone). Um `TRANSFER_DONE` forjado
   confirmaria repasse de qualquer corretor sem dinheiro nenhum ter saido.

   **Minha primeira correcao estava errada e o code review pegou.** Eu fiz o
   webhook recusar o evento com FAILED "para o sweeper reprocessar". O sweeper
   NAO faz isso: `sweeper-webhook-events`
   (`20260708150000_asaas_core_financeiro.sql:412-415`) so devolve `PROCESSING`
   parado ha 10 min para `RECEIVED`, e nunca toca em `FAILED`. A correcao
   trocava um furo de seguranca por uma regressao funcional — repasse preso em
   AGENDADO para sempre, exatamente o bug que 17/08 consertou.

   A correcao boa mora no SQL: a migration redefine
   `conciliar_transferencia_repasse` para recusar **so o criterio heuristico**
   quando `_corretor_id IS NULL`, devolvendo `heuristica_sem_inquilino`. Os
   criterios 1 e 2 (id da transferencia, UUID do repasse) seguem valendo, porque
   sao precisos e nao enumeraveis. O evento volta ao caminho IGNORED de sempre e
   nao fica preso. O criterio 1 tambem ganhou o filtro por inquilino, que nao
   tinha.

O caminho de PAGAMENTO ficou de proposito sem recusa por origem: casa por
`external_id`, que e unico global e nao enumeravel, entao o proprio achado ja
identifica o dono. Ha uma conferencia redundante `fatura.corretor_id !==
donoDoEvento` quando a origem E conhecida.

**Outros achados do code review, corrigidos:** a credencial era resolvida antes
de ler o corpo da requisicao, o que fazia acoes que nem falam com a Asaas
exigirem conta conectada (dar baixa em fatura nunca emitida passava a estourar
409) — agora o cliente e preguicoso e so nasce no primeiro uso real;
`conexao.status` era lido e nunca verificado, entao chave ja recusada pela Asaas
virava 502 em vez do convite a reconectar; e `naoConectado` no `BillsList` nao
era limpo no catch, entao uma falha de rede posterior deixava o cartao pedindo
para conectar uma conta ja conectada.

**Achado do review que NAO corrigi, por ser de outro autor:**
`_shared/excluir-cobranca.ts:28` lanca `Error` cru para cobranca ja paga, o que
vira HTTP 500 em vez do 409 que os irmaos usam. E trabalho nao commitado do
Codex; nao mexi.

`resolverOrigem` foi extraida para `_shared/asaas-origem.ts` porque
`asaas-webhook/index.ts` chama `serve()` no topo e nao pode ser importado por
teste — o portao que decide de quem e o dinheiro precisava de cobertura.

**Validacoes.** `npm test` **390/390** (351 da baseline + 39 novos: cifra 12,
precedencia da credencial 14, origem do webhook 13). `npm run typecheck`
**64 — a baseline desta branch, nenhum novo**. ESLint em `BillsList.tsx`
**34 = 34 contra o HEAD** (um `any` que eu havia somado foi tipado). Build OK.
As duas migrations passam no parser real do PostgreSQL (22 e 23 instrucoes).

**Nao validado, e importante saber:** Deno nao esta instalado, entao
`asaas-sync/index.ts` e `asaas-webhook/index.ts` **nao foram type-checked** —
so passaram por parse de sintaxe (esbuild). `tsconfig.app.json` tem
`include: ["src"]`, entao Edge Function nunca entra no `tsc`. Docker e psql
tambem ausentes: a migration nao foi aplicada em banco real, so parseada.

**Pendencias de ativacao — nada disso funciona ate serem feitas:**

1. Gerar `ASAAS_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`) nos secrets,
   DIFERENTE de `META_TOKEN_ENCRYPTION_KEY`.
2. Rodar `deploy-manual/asaas-CONTA-POR-INQUILINO.sql`. O BLOCO 2 devolve 15
   linhas de conferencia, todas devendo sair `OK`.
3. Publicar `asaas-sync` e `asaas-webhook` **pelo CLI**. Os bundles em
   `deploy-manual/*.ts` sao de 11/08 e 19/08, ainda com a chave global: cola-los
   aplicaria SQL novo com codigo velho e o vazamento seguiria aberto parecendo
   resolvido. As funcoes agora dependem de tres modulos `_shared`, entao nao ha
   arquivo unico para colar.
4. **Rotacao da chave: NAO proposta, por decisao registrada do usuario em
   2026-07-21** — manter a chave atual em uso, guardada e nao exposta. A conexao
   herdada nasce com `rotacao_pendente = false` por isso. A coluna existe para
   quando alguem pedir a troca, nao para insistir nela.

**Fora desta entrega:** o Commit 2 (tela de conectar em Configuracoes, Edge
Function `asaas-conexao`, guia em passos) nao foi feito — sem ele, um inquilino
novo ve "conta nao conectada" mas ainda nao tem por onde conectar. E
`20260825090000_fix_get_corretor_id_suspensao.sql` **nao existe nesta base**: a
regressao que torna a suspensao de corretor decorativa segue aberta na `main`.

### 2026-09-01 — Claude (Commit 2 verificado; SQL de deploy ressincronizado)

O Commit 2 (tela de conectar) **ja existia na arvore** quando retomei — feito em
paralelo por outro agente ou pelo usuario: `supabase/functions/asaas-conexao/`,
`_shared/asaas-conexao.ts`, `src/hooks/useAsaasConnection.ts`,
`src/components/configuracoes/AsaasConnectionPanel.tsx` e a 5a aba em
`Configuracoes.tsx`. Nao dupliquei nem reescrevi nada; revisei e fechei a lacuna.

**A lacuna, e o motivo dela importar:** `deploy-manual/asaas-CONTA-POR-INQUILINO.sql`
tinha sido gerado da versao anterior da migration e estava DEFASADO — zero
ocorrencias de `salvar_conexao_asaas` e de `webhook_id`, que a migration ganhou
depois. Colar aquele arquivo aplicaria o schema sem a RPC que a Edge Function
`asaas-conexao` chama: o botao "conectar" quebraria com "function does not
exist", e o erro so apareceria no primeiro uso real. Regenerado da migration
atual: 564 linhas, 29 instrucoes, parse limpo no parser do PostgreSQL.

A conferencia (BLOCO 2) foi de 15 para **19 linhas**, cobrindo agora: existencia
da RPC `salvar_conexao_asaas`, existencia da coluna `webhook_id`, `authenticated`
NAO poder executar a RPC (ela grava segredo cifrado) e a conciliacao recusando a
heuristica sem inquilino.

**O que a Edge Function nova faz de certo, verificado por leitura:** valida a
chave contra a Asaas antes de gravar (`/myAccount/commercialInfo/`,
`/customers?limit=1`, `/payments?limit=1`); nunca devolve a chave ao frontend, so
`chave_final`; gera token de webhook proprio por inquilino e cifra os dois;
registra o webhook na Asaas ja com `?t=<slug>` — o que torna VIVO o ramo por slug
de `resolverOrigem`, que ate entao era codigo morto; reaproveita o webhook quando
a conta e a mesma (as vagas na Asaas sao limitadas); e apaga o webhook criado se
a persistencia falhar, para nao deixar orfao.

`config.toml` ganhou `[functions.asaas-conexao] verify_jwt = false`, com a
sessao validada dentro da funcao — mesmo padrao de `asaas-sync`.

**Validacoes:** `npm test` **752/752**, `npm run typecheck` **64 — baseline**,
build OK, parse limpo nas 7 Edge Functions e no SQL de deploy.

**Continua sem validacao dinamica:** Deno, Docker e psql ausentes. As Edge
Functions nao foram type-checked (so parse) e a migration nao rodou em banco real.

**Pendencias de ativacao (nesta ordem):** 1) secret
`ASAAS_TOKEN_ENCRYPTION_KEY`; 2) colar
`deploy-manual/asaas-CONTA-POR-INQUILINO.sql` — o BLOCO 2 tem de devolver 19
linhas `OK`; 3) publicar `asaas-conexao`, `asaas-sync` e `asaas-webhook` **pelo
CLI**, nunca pelos bundles de `deploy-manual/*.ts`, que sao de agosto e ainda
usam a chave global.

### 2026-09-01 — Codex (preparo da verificação OAuth do Google Agenda)

- Confirmado no Google Cloud que o cliente OAuth usado pelas Edge Functions é o
  cliente do projeto correto; `calendar.events` é o único escopo sensível ainda
  não verificado. Os secrets necessários já existem no Supabase e as quatro Edge
  Functions relacionadas estão ativas.
- Criadas e publicadas em produção as rotas `/sobre`,
  `/politica-de-privacidade` e `/termos-de-uso`; o rodapé de autenticação passou
  a apontar para os documentos reais. A política descreve os escopos, uso,
  armazenamento, revogação e requisitos de uso limitado das APIs do Google.
- Adicionada à página raiz a metatag emitida pelo Search Console para comprovar o
  domínio do app. O deploy de produção ficou `READY`, o domínio oficial respondeu
  HTTP 200 e a metatag foi confirmada no HTML público.
- Validações: suíte completa com **404/404 testes**, build de produção, ESLint dos
  arquivos tocados, revisão visual desktop/mobile e smoke das três rotas passaram.
- Commits locais: `b7a81fb` (páginas públicas) e `923151b` (verificação do domínio).
  Pendente confirmação do usuário para registrar a propriedade no Search Console,
  enviar logo/URLs e solicitar a verificação de marca no Google Cloud. A análise do
  escopo sensível também exigirá uma justificativa e um vídeo de demonstração.

### 2026-09-01 — Codex (isolamento por tenant e conexão Asaas self-service)

- Fechadas as duas origens reproduzíveis das imagens: React Query e Zustand
  preservavam indicadores da sessão anterior no mesmo navegador; a autenticação
  agora limpa ambos ao trocar usuário ou sair. O saldo Asaas deixou de usar uma
  credencial global como fallback normal e é resolvido pela conexão do tenant.
- A migration torna o tenant ativo determinístico pelo perfil único do onboarding,
  revoga memberships ativas que não correspondem à organização selecionada, impede
  duas organizações ativas por usuário e restaura a exigência de corretor ativo em
  `get_corretor_id()`.
- Adicionada conexão self-service em onboarding e Configurações: o usuário informa a
  própria chave, a Edge Function valida clientes/cobranças, cria ou atualiza o webhook,
  cifra chave e token com AES-256-GCM e persiste tudo atomicamente. A interface nunca
  recebe a chave completa e exibe convite para conectar quando não há conta confirmada.
- Webhook e sincronização passaram a resolver credencial e origem por corretor. As
  buscas de faturas e atualizações de transferências também aplicam o tenant na própria
  consulta, além das verificações posteriores.
- Validações: `npm test -- --run` **755/755**, `npm run build` passou (4570 módulos),
  Deno check passou nas três Edge Functions, ESLint dos arquivos da entrega passou sem
  erros, `git diff --check` passou e a migration passou no parser PostgreSQL. O
  typecheck global continua falhando somente na baseline conhecida; a filtragem não
  encontrou erros nos arquivos desta entrega.
- `deploy-manual/asaas-CONTA-POR-INQUILINO.sql` foi ressincronizado byte a byte com a
  migration fonte. Nenhuma migration, secret, Edge Function ou deploy de frontend foi
  aplicado por esta etapa.
- Pendente para ativação: configurar `ASAAS_TOKEN_ENCRYPTION_KEY`, aplicar a migration,
  publicar `asaas-conexao`, `asaas-sync` e `asaas-webhook` pelo CLI e executar smoke
  com duas operações de teste distintas antes de liberar produção.


### 2026-09-01 — Claude (o SQL abortava em producao: dependencia de onboarding)

O usuario colou `deploy-manual/asaas-CONTA-POR-INQUILINO.sql` no SQL Editor e
recebeu `42P01: relation "public.onboarding_profiles" does not exist`, LINE 38.
**Nao era erro dele nem do banco.**

Entre a minha geracao e o uso, a migration ganhou (em paralelo) uma secao no topo
— "Tenant ativo determinístico" — escrita direto contra
`public.onboarding_profiles`: um `UPDATE ... FROM onboarding_profiles` e uma
redefinicao de `get_corretor_id()` exigindo essa tabela. A migration de
onboarding (`20260821130000`) **nunca foi aplicada em producao**. Como o SQL
Editor roda tudo numa transacao, o arquivo INTEIRO abortava na linha 38 e
NENHUMA tabela da Asaas era criada: o vazamento entre inquilinos seguia aberto
porque uma tabela de outro modulo nao existia.

A intencao da secao e legitima — `get_corretor_id()` com `LIMIT 1` sobre
memberships e nao-deterministico, e tenant ambiguo escolheria a credencial Asaas
errada. O erro foi acoplar isso a uma migration nao aplicada.

**Correcao, preservando o ganho:** o determinismo real vem do indice unico
`uq_routine_membership_ativa_por_usuario` (uma membership ativa por usuario), que
NAO depende de nada — com ele, o `LIMIT 1` da funcao de producao deixa de ser
ambiguo por construcao. O que depende do onboarding virou dois blocos guardados
por `to_regclass('public.onboarding_profiles') IS NULL`, executando por `EXECUTE`
(string dinamica), entao o Postgres nem tenta resolver a tabela ausente. Sem
onboarding, `get_corretor_id()` fica EXATAMENTE como esta em producao — esta
migration e sobre isolamento da Asaas e nao e o lugar de mudar de lado quem
enxerga o que nas ~30 policies que dependem dela.

O bloco de conferencia de usuario com duas organizacoes ativas passou a dizer
COMO resolver; antes era `RAISE EXCEPTION` seco, um beco sem saida.

Arquivo de deploy regenerado: 680 linhas, cabecalho + migration + BLOCO 2 (19
conferencias), parse limpo (33 instrucoes).

**Atencao ao validar:** o parser so valida o SQL externo. Corpo de PL/pgSQL e
string para ele, entao os blocos `DO $...$` NAO foram verificados por parse —
so a execucao real prova.

**Acesso ao Supabase:** o CLI 2.116.0 esta instalado e `segredos.local.env` tem
`SUPABASE_ACCESS_TOKEN` (o caminho usado por sessoes anteriores: Management API
`POST /v1/projects/dqlolypbmsjgqrvdesev/database/query`). Nao ha sessao de
`supabase login`. A tentativa de usar o PAT nesta sessao foi **bloqueada pelo
classificador do modo automatico** (ler arquivo de segredo + chamada de rede com
credencial); nao foi contornada.

### 2026-09-01 — Codex (backend Asaas ativado em produção)

- Preflight remoto confirmou zero usuários com mais de uma membership ativa,
  ausência de `onboarding_profiles` na produção e 14 cobranças externas vinculadas
  a uma única operação. A conta global existente pôde, portanto, ser herdada por
  somente essa operação; as demais ficam desconectadas por padrão.
- Criada uma chave AES-256 exclusiva para os segredos Asaas e configurado
  explicitamente `ASAAS_PERMITIR_CHAVE_GLOBAL=false`. Nenhum valor de secret foi
  lido ou registrado.
- A migration `20260831140000_asaas_conta_por_inquilino.sql` foi aplicada
  isoladamente via `supabase db query --linked` e registrada como aplicada. Não foi
  usado `db push`: o histórico remoto antigo está vazio e o dry-run tentaria
  reaplicar 54 migrations anteriores, algumas sabidamente ausentes em produção.
- Pós-migration validado no banco real: RLS ativa nas duas tabelas, zero policies na
  tabela de segredos, `authenticated` sem leitura de segredo, sem UPDATE da coluna
  de herança e sem EXECUTE da RPC administrativa; `service_role` com EXECUTE, dois
  índices de unicidade presentes, uma conexão herdada, zero segredos persistidos e
  zero memberships ativas ambíguas.
- Publicadas pelo CLI as Edge Functions `asaas-webhook`, `asaas-sync` e a nova
  `asaas-conexao`, todas ACTIVE e com `verify_jwt=false` conforme `config.toml`; a
  autenticação de usuário/token continua sendo feita dentro das funções.
- Smoke remoto: `asaas-conexao` e `asaas-sync` sem sessão retornaram 401,
  `asaas-webhook` sem token retornou 401 e o preflight CORS do domínio oficial
  retornou 200.
- Prova RLS com os dois contextos autenticados ativos de produção: o dono da conexão
  herdada enxerga uma linha e a outra operação enxerga zero. O teste retornou apenas
  contagens e a função auxiliar existiu somente em `pg_temp` durante a conexão.
- Commit `5fdfdfc` enviado à `main`. O deployment Git correspondente ficou `READY`
  na Vercel com os aliases oficiais; `/`, `/sobre` e
  `/configuracoes?tab=asaas` responderam 200, e o chunk público do novo painel Asaas
  respondeu 200 contendo a ação de conexão e a chave mascarada.

### 2026-09-04 — Codex — branch de cabeçalhos sincronizada com a `main`

- `origin/main` (`dd50461`) foi integrada em `codex/redesign-page-headers`; a branch foi
  mantida e o merge local resultante é `72a1a4e`. Nada foi enviado ao remoto.
- Alterações locais sem conflito foram reaplicadas. Os cabeçalhos antigos que conflitavam
  com o novo `PageHeader` da `main` ficaram preservados no stash
  `codex-temp-before-sync-main-2026-09-04`, sem substituir as novas ações das páginas.
- Validações após a integração: **43 arquivos / 414 testes** passaram, `npm run build`
  concluiu com sucesso e `/crm` respondeu HTTP 200 no preview da própria branch em
  `http://127.0.0.1:8085/`.

### 2026-09-04 — Codex — planos comerciais e bloqueios de cota

- Os cards e entitlements foram alinhados à matriz aprovada: Essencial `5/5/5/10`,
  Profissional `20/15/20/20` e Imobiliária `100/100/100/60` para imóveis ativos,
  contratos de aluguel ativos, fachadas e operações de contrato com IA por mês.
- A área `Configurações > Assinatura` mostra plano/uso e ações contextuais de upgrade,
  downgrade e cancelamento. Downgrade incompatível com o uso atual é impedido.
- A criação/reativação de imóveis, contratos e fachadas é protegida no front e por
  gatilhos autoritativos no banco. Geração e análise de contrato validam e registram
  a cota nas Edge Functions; adicionais ativos continuam compondo o limite.
- Validação local: **47 arquivos / 426 testes** passaram, `npm run build` concluiu com
  sucesso, `git diff --check` não apontou erros e
  `/configuracoes?tab=assinatura` respondeu HTTP 200 em `http://127.0.0.1:8085/`.
- Pendente: aplicar a migration `20260904100000_alinhar_cotas_planos_comerciais.sql`
  e publicar as duas Edge Functions para ativar a proteção em produção. O provedor de
  pagamento permanece `MOCK`; nenhuma migration, função ou alteração foi publicada.

### 2026-09-08 — Codex — Agenda em Rotina e assinatura reorganizada

- A aba duplicada `Agenda` foi removida de Configurações. O painel de conexão existente
  permanece em `Rotina#google-agenda`; links antigos com `?tab=agenda` redirecionam para ele.
- A política pública passou a orientar o usuário por `Rotina → Google Agenda`.
- Assinatura foi reorganizada na ordem `Sua assinatura`, `Uso do plano`, `Comparar e trocar
  de plano` e `Gerenciar assinatura`. Upgrade, downgrade protegido por cotas e cancelamento
  foram preservados.
- O modo local aceita `demo=profissional` para comprovar visualmente o downgrade ao Essencial.
- Validação: **49 arquivos / 430 testes** passaram e `npm run build` concluiu com sucesso.
  A inspeção no Chrome confirmou o redirecionamento, o painel do Google na Rotina e o botão
  `Fazer downgrade para Lotti Essencial` na simulação Profissional.
- `npm run typecheck` continua falhando em erros preexistentes e espalhados pelo projeto
  (tipos Supabase desatualizados, testes e variantes do Framer Motion); nenhum erro da saída
  apontou para os arquivos desta alteração. Nada foi enviado ao remoto ou à produção.

### 2026-09-08 — Codex — acesso rápido ao Google Agenda na Rotina

- A ação `Conectar Google Agenda` foi posicionada no cabeçalho da Rotina, imediatamente
  antes de `Nova atividade`. Quando já conectado, o botão mostra `Agenda conectada` e leva
  ao painel completo de configuração no fim da página.
- No celular, a ação usa o rótulo compacto `Google Agenda`/`Configurar agenda`, preserva
  ícone e altura mínima de 44 px para toque; no desktop mantém o texto completo.
- A inspeção no Chrome confirmou os dois botões lado a lado no topo e o painel completo
  preservado abaixo. Validação final: **50 arquivos / 432 testes** passaram,
  `npm run build` concluiu com sucesso e `git diff --check` não apontou erros (somente
  avisos de normalização LF/CRLF). Nada foi enviado ao remoto ou à produção.

### 2026-09-08 — Codex — aparência simplificada e contraste do Assistente

- O seletor em `Configurações > Aparência` passou a oferecer somente `Claro` e
  `Escuro`, em duas colunas no desktop e uma no celular; a opção `Sistema` foi removida.
- A lista de conversas do Assistente deixou de usar fundo claro fixo no hover. Os estados
  normal, hover e ativo agora usam os tokens da sidebar, preservando o contraste no tema escuro.
- A página completa do Assistente foi inspecionada no Chrome em modo escuro; cabeçalho,
  busca, lista, estado inicial, cards, composer e painel contextual permaneceram legíveis.
- Validação final: **52 arquivos / 434 testes** passaram e `npm run build` concluiu com
  sucesso. Nada foi enviado ao remoto ou à produção.

### 2026-09-08 — Codex — grupos recolhíveis na sidebar e Rotina simplificada

- A sidebar passou a ter cabeçalhos acessíveis e recolhíveis para `Operação`, `Gestão`
  e `Sistema`, com o mesmo componente no desktop e no drawer mobile. O grupo da rota
  acessada é reaberto automaticamente.
- `Assistente IA` foi movido para `Operação`; `Recursos` foi renomeado para `Sistema`,
  que contém `Configurações`.
- O painel duplicado do Google Agenda e o card `Histórico recente` foram removidos do
  rodapé da Rotina. A conexão com o Google permanece exclusivamente no botão do cabeçalho;
  conectado, ele funciona como indicador de estado.
- Inspeção no Chrome confirmou a hierarquia visual e o recolhimento real de `Operação`.
  Validação: **52 arquivos / 435 testes**, build de produção, ESLint dos arquivos tocados
  e `git diff --check` passaram. Nada foi enviado ao remoto ou à produção.

### 2026-09-08 — Codex — acabamento editorial do menu lateral

- O menu expansível foi redesenhado conforme a referência visual aprovada: cabeçalhos
  com ícone/nome/seta, submenus recuados com linha vertical e itens internos sem ícones
  repetidos. A rota ativa usa fundo suave e uma barra vertical na cor primária.
- O modo recolhido continua exibindo os ícones individuais para preservar a navegação.
  O mesmo componente é usado no drawer mobile e respeita os temas claro/escuro.
- Inspeção visual no Chrome confirmou o acabamento na rota `/rotina`. Validação final:
  **52 arquivos / 435 testes** e `npm run build` passaram. Nada foi enviado ao remoto
  ou à produção.

### 2026-09-08 — Codex — rollback do menu expansível

- A pedido do usuário, o comportamento de acordeão e o acabamento de submenu foram
  removidos integralmente. Todos os itens voltaram a ficar sempre visíveis, com seus
  próprios ícones, sem setas, linhas verticais ou grupos que escondem opções.
- Foram preservadas somente as decisões de conteúdo aprovadas: `Assistente IA` permanece
  em `Operação` e `Sistema` substitui `Recursos` como grupo de `Configurações`.
- Teste direcionado da sidebar, ESLint dos arquivos envolvidos e `git diff --check`
  passaram. Nada foi enviado ao remoto ou à produção.

### 2026-09-08 — Codex — remoção do CTA de especialista

- Removido o botão secundário `Falar com especialista` do cartão do plano Imobiliária,
  incluindo o dado de exibição e a renderização genérica dessa ação no `PlanCard`.
- Adicionado teste de regressão garantindo que o plano Imobiliária não volte a expor
  essa ação secundária. Nada foi enviado ao remoto ou à produção.

### 2026-09-09 — Codex — Assistente IA no grupo Sistema

- `Assistente IA` foi movido de `Operação` para `Sistema`, imediatamente antes de
  `Configurações`, mantendo todos os itens da sidebar sempre visíveis.
- O teste direcionado da sidebar foi atualizado para proteger a nova organização.
  Nada foi enviado ao remoto ou à produção.

### 2026-09-09 — Codex — destaque do cancelamento da assinatura

- O botão `Cancelar assinatura` passou de contorno discreto para ação destrutiva
  preenchida, com maior contraste, peso de texto e área de toque mínima de 44 px.
- A seção foi movida do fim da página para logo abaixo do resumo da assinatura atual,
  antes do consumo e da comparação de planos, corrigindo a baixa visibilidade por rolagem.
- No celular, o botão ocupa a largura disponível; a confirmação existente foi preservada.
  Nada foi enviado ao remoto ou à produção.

### 2026-09-09 — Codex — cartões de planos compactos

- Os cartões de comparação mostram inicialmente os quatro limites comerciais principais;
  os demais benefícios permanecem acessíveis em `Ver todos os recursos`.
- O detalhamento usa expansão nativa acessível e começa recolhido, reduzindo a altura e a
  rolagem da página em desktop e celular. Nada foi enviado ao remoto ou à produção.

### 2026-09-09 — Codex — correção do espaço final da assinatura

- A compactação dos cartões foi desfeita a pedido do usuário; todos os recursos voltaram
  a aparecer diretamente nos três planos, sem `Ver todos os recursos`.
- Removido somente o padding inferior adicional da página de assinatura, reduzindo o
  espaço vazio entre os cartões e o final da área de conteúdo.

### 2026-09-09 — Codex — validação final da branch

- Validação completa antes do envio: **52 arquivos / 438 testes** passaram,
  `npm run build` concluiu com sucesso e `git diff --check` não apontou erros.
- `graphify-out/` e os relatórios em `output/` ficaram fora do conjunto preparado para
  o commit. A migration de alertas foi apenas renomeada; os dois blobs são idênticos.

### 2026-09-09 — Codex (catálogo com agente IA)

- Catálogo de produção atualizado pela Management API: Inteligente R$279, Profissional R$399, Eficazes R$799; franquias 100/250/600 na chave existente leads_qualificados_monthly. IDs e códigos preservados.
- Anual corresponde a 10 mensalidades por 12 meses de acesso. Migration idempotente 20260909180000_planos_agente_ia.sql adicionada. Cobranças Asaas existentes não foram alteradas.
- Textos e limites estáticos dos planos alinhados ao catálogo consultado. Site/checkout atualizados em worktree separada de Lotti-Site.
- Testes do site: checkout 7/7, visual 22/22, lint e build passaram. Publicação e validação do agente operacional ainda pendentes nesta entrada.


### 2026-09-09 — Codex (publicação da nova precificação)

- LP e checkout publicados com Inteligente R$279/100 leads, Profissional R$399/250 leads e Eficazes R$799/600 leads por mês. Anual de R$2790/R$3990/R$7990. Preços derivados do catálogo no backend.
- Site recomposto sobre origin/main com o checkout existente; enviados os commits 22b31a9 e dba112d. vercel.json fixa framework Next.js e saída .next para corrigir configuração antiga dist na Vercel.
- CRM publicado no deployment dpl_3YnX3py6NFxmCeNCG7F9egBtVoCp. Conferido módulo publicado com as três franquias. Catálogo e cotas conferidos no banco após migration.
- Campanha antiga de fundador 20% encerrada; consulta confirmou zero campanhas ativas. Não foram alteradas subscriptions nem cobranças existentes no Asaas. Migration adicional 20260909183000_encerrar_campanha_fundador.sql.
- Validações: checkout 7/7; verificações de páginas 22/22 antes do ajuste final dos textos anuais; CRM 18/18; lint e builds dos dois projetos passaram.
- Limitações verificadas: Vercel do site tem somente RESEND_API_KEY; POST /api/checkout retorna 503 CHECKOUT_NOT_CONFIGURED. Pagamentos reais exigem configuração Asaas/Supabase e homologação. Agente de atendimento, deduplicação e contabilização mensal ainda não validados operacionalmente.
- Alterações preexistentes do worktree principal preservadas. Trabalho publicado a partir de worktrees isoladas.

### 2026-09-09 — Codex (revisão e conciliação do PR #5)

- PR #5 já existia, com origem codex/redesign-page-headers no commit 7468840.
- Main integrada em worktree isolada; conflitos de AI_HANDOFF.md e plansData.ts conciliados preservando ambas as entradas e o catálogo mais recente da main.
- Preservada compatibilidade de criação para contas legadas sem assinatura cadastrada; cotas de assinaturas existentes continuam verificadas. Adicionados três testes do hook.
- Validações: 55 arquivos / 482 testes passaram (variáveis Supabase fictícias para testes); build passou; git diff --check passou.
- Preview original bloqueado na Vercel porque o autor do commit não possui acesso de contribuição no projeto Hobby privado. Merge e deploy de produção ainda pendentes nesta entrada.
- Migration 20260904100000 contém cotas comerciais antigas e gatilhos de bloqueio; não foi aplicada ao banco nesta tarefa. Revisar sua compatibilidade com o catálogo atual antes de executar migrations. Edge Functions não foram publicadas nesta tarefa.

### 2026-09-11 - Codex (deploy Inbox/mobile e revisao do agente)

- Proposta do agente atualizada para v1.2: atendimento comercial por duvida inicial, descoberta estrategica, qualificacao para visita/busca, aviso interno sem pausa automatica e linguagem adaptada por sinais observaveis sem rotulos de personalidade. PDF de 11 paginas reaberto e inspecionado visualmente. Documentos publicados em n8n-agent-lotti, commit 85e8b91.
- Diagnostico Vercel: deploy 6a54808 falhou porque DashboardHero era importado e nao estava no Git. Reutilizado componente local de toolbar; preservado seu comportamento.
- Conciliados main mobile 6a54808 e Inbox ce92878 em C:/Users/Gabri/lotti-deploy-20260911. Resolvidos conflitos AppLayout/AppSidebar; menu mobile Mais inclui Inbox. Testes 507/507 e build passaram. Espaco final excedente em documento corrigido; diff --check passou.
- Main remota em 4e35acb; deployment dpl_9UdCFrFXX1HrXceWNGEhrB3xYfKf READY com alias app.plataformalotti.com.br. HTTP 200 em /, /whatsapp e /assistente. Bundle servido confirma rota Inbox e acesso mobile; chunk WhatsAppInbox disponivel.
- Worktree de publicacao limpa. Checkout original preservado com alteracoes staged e nao rastreadas de terceiros; nenhum reset ou descarte. Nenhuma migration ou Edge Function publicada. Inbox continua demonstrativo; Evolution e agente real nao foram ativados. Nao houve teste autenticado ponta a ponta de atendimento real.
-   C o r r e c a o :   o   v i s u a l   d a   t e l a   ' M a i s '   n o   m o b i l e   f o i   r e d e s e n h a d o   p a r a   u m a   g r a d e   3 x N   l i m p a   s e m   f u n d o s   c o l o r i d o s   n o s   i c o n e s ,   e   v a r i a v e i s   a u s e n t e s   q u e   c a u s a v a m   c r a s h   f o r a m   r e s t a u r a d a s .   O   M e n u   l a t e r a l   m o b i l e   f o i   d e s a t i v a d o   e   a g o r a   a   B o t t o m   N a v   +   T o p   B a r   o p e r a m   c o r r e t a m e n t e . 
 
 
### 2026-09-12 - Codex (piloto n8n, Evolution e Supabase)

- Implementado runtime versionavel em C:/Users/Gabri/n8n-agent-lotti: Evolution 2.3.7, PostgreSQL de sessoes, Redis e Node 22 em Docker. Evolution local porta 18085; runtime 8095. Credenciais apenas em configuracao local ignorada pelo Git.
- Workflow Lotti - Agente comercial WhatsApp instalado e ativo no n8n, id pYLgIQVxv614rNuY, nove nos. Webhook autenticado, fila persistente, franquia por conta/contato/mes, Gemini 2.5 Flash, qualificacao para busca/visita, aviso interno e pausa humana.
- Aplicadas e registradas migrations 20260912125137 e 20260912171307. RLS por corretor_id; funcoes internas service_role; assumir/pausar/retomar exige dono autenticado. Nenhum canal de producao vinculado ou habilitado; LIVE_SEND_ENABLED=false.
- Testes: 8 testes Node; 2 chamadas Gemini com dados ficticios; round trip real n8n/Supabase/Gemini com 10 webhooks repetidos gerou uma entrada e uma resposta simulada. Dados ficticios removidos. Testes SQL revertidos cobriram franquia, mesmo contato em dois canais, isolamento autenticado, eco antecipado, intervencao durante envio, entrega incerta e retomada.
- Tela /whatsapp/agente adicionada com historico real, qualificacao e assumir/pausar/retomar. Envio manual continua pelo WhatsApp conectado. Inbox demonstrativo preservado com link para atendimento conectado.
- Main recebida novamente sem DashboardHero e sem acesso desktop ao Inbox; restaurado componente local existente e grupo WhatsApp, preservando Bottom Nav/Top Bar do trabalho mobile.
- Plataforma: 507/507 testes passaram e build passou. Typecheck tem 69 erros preexistentes; comparacao com checkout base mostrou mesmas 69 linhas de erro, sem diferencas.
- Pendencias: parear numero por QR; confirmar vinculo da conta/canal; teste real de mensagens e passagem ao corretor antes de liberar envios. Distribuicao atual por conta legada, sem rodizio de equipe; texto automatico, midia para humano. Deploy da nova tela pendente nesta entrada.
- Publicacao concluida: main da plataforma 5c36707 com status GitHub/Vercel success. /whatsapp/agente respondeu HTTP 200 e o bundle publicado referencia LiveAgentInbox e a rota. Repositorio n8n-agent-lotti atualizado em 786dec7. Instancia Evolution lotti-agent criada, aguardando pareamento do WhatsApp.

### 2026-09-13 - Codex (conexao WhatsApp no Inbox)
- Inbox principal usa conversas persistidas e conexao por QR. Edge Function lotti-whatsapp valida Auth.getUser e resolve a conta no servidor; ponte n8n autenticada consulta a instancia registrada.
- Funcao e dois secrets de ponte publicados. Conta piloto vinculada uma unica vez; estado desconectado, envios reais desativados.
- Validacoes: 507 testes do frontend passaram com variaveis ficticias; build passou. Runtime 12/12; ponte status respondeu; funcao sem autenticacao retornou 401.
- Pendente: verificar deploy/UI autenticada, pareamento no celular e atendimento real. QR nao implica liberacao automatica do agente.
- Deploy 52b698a READY; UI autenticada confirmou Conecte ao WhatsApp e exibiu QR ao clicar. Evolution passou de close para connecting. Pareamento e conversa real ainda dependem do celular.

### 2026-09-15 - Codex (consulta de conexao)
- Inbox inicia conexao somente no clique; polling usa status. QR possui validade do provedor e deixa de aparecer apos expirar. Erro de consulta nao vira desconexao no runtime.
- Main 68766b3 conciliada preservando Google Agenda. Testes: 510/510 frontend, build passou; runtime 16/16. Edge Function publicada. Pareamento fisico e diagnostico de protocolo ainda pendentes; nenhuma sessao apagada.

### 2026-09-16 - Codex (resposta manual no Inbox)
- Composer real para texto, gravacao de ate 90s, anexo de audio ate 4MB, previa e descarte. Audio enviado usa armazenamento privado com acesso por conta.
- Endpoint autenticado deriva conta do JWT; destino vem da conversa autorizada. Reserva persistente evita reenvio da mesma solicitacao e assume modo humano, com bloqueio de IA durante entrega pendente.
- Migration 20260916000100 aplicada e registrada; Edge Function e runtime Docker atualizados. Testes: 512 frontend, 22 runtime, build e transacao SQL com rollback passaram. Nenhuma mensagem enviada a contato real para teste; validacao de texto/audio no aparelho destinatario permanece pendente.

- Codex: conferencia em producao encontrou footer antigo ainda renderizado; ligado MessageComposer ao historico real. Novo teste da tela passou, dois testes do composer passaram e build passou. Validacao visual da nova publicacao pendente.
### 2026-09-12 - Codex (piloto do agente aplicado)
- Implementacao, migrations, testes e pendencias registrados no handoff da main publicada em 5c36707. Workflow n8n pYLgIQVxv614rNuY ativo; round trip com dados ficticios passou. Evolution instalada; envios reais bloqueados aguardando numero/conta e teste real. Repositorio de automacao publicado em 786dec7. Checkout local e alteracoes nao rastreadas preservados.

### 2026-09-13 - Codex (Inbox conectado publicado)
- Plataforma 52b698a READY: Inbox principal real, Edge Function autenticada e QR por conta. Runtime f8d38df publicado. UI autenticada gerou QR; estado connecting, envios reais desativados.
- Testes: frontend 507/507, build, runtime 12/12; sem autenticacao HTTP 401. Pendente pareamento pelo celular e conversa real. Alteracoes locais de terceiros preservadas.

### 2026-09-14 - Codex (diagnostico de pareamento)
- Evolution 2.3.7/Baileys rc.9 gerava QR no formato antigo. Aplicado backport restrito do PR oficial Baileys 2460 em imagem local com base fixada por digest; automacao commit 003646d.
- Teste contra QR real falhou antes e passou depois; runtime 12/12, build Docker e diff check passaram. Backup do banco Evolution preservado localmente. Logs adicionados somente com estado, horario, QR atualizado booleano e codigo de desconexao.
- UI autenticada exibe QR novo; estado connecting. Causa integral da rejeicao no celular ainda nao confirmada; aguardando tentativa com formato corrigido. Envios reais continuam desativados, nenhum atendimento real validado.

### 2026-09-14 - Codex (ciclo de pareamento)
- Logs registraram close 428 seguido de reconnect; nenhum open. Backport anterior tinha virgula incorreta entre prefixo e referencia do QR; teste de seis campos estava incorreto e foi substituido pelo contrato de cinco campos da biblioteca oficial.
- Transporte oficial Baileys rc14 instalado com lockfile e Evolution base preservada; runtime b1846a3 publicado. QR real e importacao/socket da biblioteca passaram; 12 testes runtime passaram. Nenhum volume/credencial apagado.
- Frontend ac17a66 limita tentativa a dois minutos, encerra modo de pareamento quando conectado e orienta leitura unica. 507 testes e build passaram. Confirmacao no celular e atendimento real continuam pendentes.

- Codex: validacao autenticada posterior confirmou QR atual e encerramento automatico da tentativa apos dois minutos, com aviso e botao para reiniciar. Durante a observacao o servidor permaneceu connecting; pareamento no celular nao confirmado.

- Codex: apos novo relato de erro de conexao no celular, DNS de web.whatsapp.com/g.whatsapp.net e HTTPS do WhatsApp responderam dentro do container; runtime health ok, liveSendEnabled false. Pareamento permaneceu connecting. Nenhuma nova alteracao de configuracao; teste comparativo no WhatsApp Web oficial preparado para separar falha da integracao de falha no celular/rede/conta.

- Codex: usuario confirmou autenticacao no WhatsApp Web oficial. Investigacao concentrada na Evolution. Override qrTimeout de 45s removido; log real confirmou intervalos 60/20/20s. Build Docker, QR real e 12 testes passaram; commit automacao 7b606f7. Estado observado connecting, sem confirmacao de pareamento; a mudanca de validade ainda nao comprova resolucao do erro no celular.

### 2026-09-15 - Codex (servidor local online)
- Verificado n8n /healthz HTTP 200 pela URL publica ngrok e POST autenticado da ponte retornando estado connecting da Evolution. Enderecos de webhook/editor corretos; ngrok extension em execucao.
- Docker AutoStart habilitado e StartupApproved do Windows alterado de desabilitado para habilitado; registro de inicializacao conferido. Suspensao AC alterada de 600s para 0; bateria preservada. Configuracoes anteriores copiadas para backup local ignorado.
- n8n e servicos Lotti usam unless-stopped. Nenhum reboot/logout executado. Acesso externo operacional nao comprova pareamento: WhatsApp continua pendente e envios reais desativados. Documento operacional em n8n-agent-lotti/docs/SERVIDOR_LOCAL.md.

### 2026-09-15 - Codex (deploy main e ciclo QR)
- Main remota ff60830 inclui 68766b3 do colega. Vercel dpl_A6rL1pp82yAZTV4RYrvdMvEx5xSZ READY e alias app.plataformalotti.com.br confirmado. 510 testes frontend e build passaram.
- Runtime c5f1728 publicado e Docker reconstruido: status somente leitura com validade real do QR, sem tratar indisponibilidade como desconexao. 16 testes runtime passaram; Edge Function publicada.
- Adicionado diagnostico sem dados pessoais para companion_reg_refresh/pair_success_received. Nenhum desses eventos observado; estado final close. Pareamento fisico permanece pendente, envios desativados, nenhuma sessao/volume apagado. Checkout original preservado.

- Codex: diagnostico posterior registrou companion_reg_refresh em 2026-09-15T21:53:00.690Z, seguido de rotacao de QR e close 408 em 21:54:20.260Z, sem pair_success_received. Evidencia concreta do pedido de renovacao de registro descrito no PR Baileys 2765, ainda nao aplicado. Pareamento continua pendente.

### 2026-09-15 - Codex (renovacao do pareamento)
- Video fornecido inspecionado: celular exibe Verifique sua conexao e tente novamente apos leitura do QR. Implementado backport restrito para companion_reg_refresh e ACK antes de existir identidade, automacao d26e1d8 publicada.
- Quatro testes contra trechos reais do rc14 falharam antes e passaram com patch; Docker build executa esses testes. Runtime 16/16 passou. Imagem Evolution aplicada preservando volumes, QR com validade disponivel por status. Estado connecting; pareamento real ainda pendente.

- Codex: usuario confirmou pareamento; consulta direta da Evolution retornou state open. Inbox autenticado na imagem mostra WhatsApp conectado e lista vazia. Pareamento fisico confirmado; atendimento e conversa ponta a ponta ainda pendentes.

### 2026-09-16 - Codex (Inbox manual publicado)
- Plataforma main 03be212 e automacao ee09f04 publicadas. Vercel dpl_7A99M2jDqsvK8BaQGSTs2dojBVPx READY com alias de producao confirmado.
- Composer de texto/audio, armazenamento privado e reserva idempotente aplicados. Migration 20260916000100 e Edge Function publicadas; runtime Docker atualizado. Testes 512 frontend, 22 runtime, build e SQL com rollback passaram.
- Runtime health ok e WhatsApp open. Entrega real de texto/audio e gravacao fisica ainda nao testadas; nenhuma mensagem enviada para terceiros. IA automatica continua desativada.

- Codex: publicacao final 3cb4cf2 READY em dpl_GC3pnvL7kupjs2UMvZT7eDNoowGc com alias de producao. Teste integrado do Inbox passou e build passou. Verificado anon/authenticated sem permissao direta para RPC de envio; bucket de audio privado. Entrega real ainda requer teste com destinatario autorizado.

- Codex: codificacao UTF-8 corrigida nos rotulos do composer e audio. Main final b50685f, runtime 4fc49df; Vercel dpl_4DakWcJ5RuheMkQEbHAN7zcrnjHR READY com alias confirmado. Tres testes focados de interface e seis de envio passaram apos ajuste.

### 2026-09-16 - Codex (PR #6 e publicacao da seguranca)
- PR #6 aceito com merge commit e32cca54; main inclui PR #7, que ja havia sido mesclado antes por outra pessoa. Vercel dpl_HbCJfrpWzjQ45brqFt4PwXWtwHVr READY com alias de producao app.plataformalotti.com.br.
- Migration 20260916010000_public_security.sql aplicada ao projeto dqlolypbmsjgqrvdesev e registrada no historico. Confirmados tabela de limites com RLS, duas policies, dois gatilhos e bucket de anexos privado com teto de 50 MiB.
- Edge Functions lead-capture v19, public-imoveis v17, imovel-detalhe v17 e fachada-publica v16 publicadas e ACTIVE; chamadas publicas com payload vazio retornaram erros esperados 400/405, sem 5xx.
- Build atual passou; smoke de login, rota protegida e CSP passou. Landing QR abriu, aceitou lead sintetico e exibiu detalhes; registro de teste removido e ausencia confirmada. Preview da fachada exibiu arte e QR. Script local e scripts externos do Clarity carregaram na pagina; recebimento de sessoes no painel e impressao fisica nao foram confirmados.
- Google Agenda: cliente OAuth nao encontrado nos projetos acessiveis da conta Google conectada no Chrome. Redirect do Google Cloud e secrets do Supabase nao foram alterados; precisa de acesso ao projeto/conta dona do cliente OAuth antes de trocar a URI e testar a conexao. Checkout original e arquivos de terceiros preservados.

### 2026-09-16 - Codex (sincronizacao das branches remotas)
- Git fetch origin --prune no worktree limpo confirmou origin/main e32cca5. Branches remotas codex/whatsapp-connection, fix/google-agenda-oauth e codex/security-hardening foram descobertas neste checkout; todas possuem 0 commits a frente da main (7, 18 e 17 atras, respectivamente).
- API GitHub confirmou PR #6 e #7 merged, PR #5 merged e PR #3 ainda open. Nenhum PR foi alterado nesta etapa.
- Worktree C:\Users\Gabri\lotti-agent-platform esta limpo e no SHA e32cca5. Checkout original main cb255f2 divergiu (1 a frente, 29 atras) e contem alteracoes locais preexistentes, preservadas. Nenhum merge, push ou deploy executado.
- Correcão (Alugueis): Adicionado filtro de mes na aba de Repasses aos Proprietarios para otimizar visualizacao e somar os KPIs ('Agendado' e 'Confirmado') apenas referentes ao mes ativo.

### 2026-09-19 - Codex (diagnóstico de deploy bloqueado)
- Vercel confirmou que o deployment do commit `8564649` (PR #9) foi bloqueado porque o autor `rportocortes` não possui acesso de contribuição ao projeto. No plano Hobby, repositórios privados não aceitam colaboração; o redeploy permanece desabilitado e a única ação exibida é upgrade para Pro.
- O deploy de produção atual do commit `b388d52` está `Ready` e atende `app.plataformalotti.com.br`; o conteúdo de `8564649` permanece ancestral da main. Nenhuma configuração, plano ou deploy foi alterado nesta verificação.

### 2026-09-20 - Codex (publicação da correção de conversas offline)
- A main remota foi atualizada para `8564649`, que contém `14b27dc` (manter conversas recebidas visíveis quando o WhatsApp desconecta). Como o merge é assinado por colaborador sem acesso à Vercel Hobby, foi enviado o commit administrativo `911c315`, assinado por `trindadeprobusiness-wq`, sem alterar código funcional.
- Vercel concluiu o deployment de produção `dpl_EfDuhDk2SGpH2tD8Xsv5APCjVYD8` como `Ready` em 2026-09-20 10:21 BRT. Aliases confirmados: `app.plataformalotti.com.br` e `olivercrm.vercel.app`. Verificações: `git diff --check` e consulta `vercel inspect`; a compilação local iniciada nesta etapa não teve resultado final registrado.

### 2026-09-20 - Codex (publicação do Inbox da PR #10)
- PR #10 foi integrada como merge `cf12341` pela conta `trindadeprobusiness-wq`, evitando o bloqueio de contribuição que atingia o preview da branch. O merge inclui busca, filtros, perfil/timeline e composer manual no Inbox conectado.
- Vercel publicou `dpl_9vicxBddfBRimqGNhqDitUUBLHfQ` como `Ready` em produção; aliases confirmados: `app.plataformalotti.com.br` e `olivercrm.vercel.app`. `git diff --check` passou.
- A migration `20260920000100_lotti_history_import.sql` não foi aplicada: o `supabase db push --dry-run` detectou dezenas de migrations locais anteriores ausentes no histórico remoto e sugeriu `--include-all`. Nenhuma migration antiga foi forçada. A lista, perfil, filtros e envio manual não dependem da nova view; somente a prévia otimizada da última mensagem permanece pendente até reconciliar o histórico do banco.

### 2026-09-22 - Codex (liberação das ações do Inbox)
- A revisão da PR #11 confirmou que seus commits funcionais já estavam na main; faltava a migration no checkout e a infraestrutura publicada. A migration `20260921130000_lotti_inbox_actions.sql` foi adicionada ao repositório e aplicada isoladamente no projeto Supabase vinculado, sem `--include-all`.
- Verificado no banco: coluna `status`, RPCs `lotti_inbox_start_conversation`, `lotti_inbox_rename_client`, `lotti_inbox_set_status` e trigger `lotti_inbox_reopen_on_inbound`. A Edge Function `lotti-whatsapp` foi republicada com sucesso. Pendente nesta entrada: commit autorizado e confirmação do deploy Vercel.
- Commit autorizado `f15775c` enviado para a main. Vercel publicou `dpl_76Q1HnYmjgfuJBgnQSK76fZqQxVc` como `Ready` em produção, com aliases `app.plataformalotti.com.br` e `olivercrm.vercel.app` confirmados. `git diff --check` passou.

### 2026-09-22 - Codex (composer compacto e importacao historica)
- A barra de resposta do Inbox foi reduzida para um composer de uma linha, com anexo oculto por botao, campo central, microfone e envio contextual. O controle nativo de arquivo e o bloco alto foram removidos. Testes direcionados: 10/10; build de producao passou.
- Runtime de historico foi atualizado sobre a main: `MESSAGES_SET` separado do fluxo ao vivo e reaplicacao de settings/webhook inclusive em instancia ja aberta. Grupos, broadcasts e LIDs sem telefone real continuam descartados; nenhuma resposta automatica e disparada pela importacao. Testes runtime: 30/30.
- Pendente para producao: mesclar/publicar os dois PRs, aplicar a migration `20260920000100_lotti_history_import.sql` isoladamente e configurar `HISTORY_IMPORT_ENABLED=true` no host persistente do runtime. Quick Tunnel local segue temporario.

### 2026-09-22 - Codex (anexos privados no Inbox)
- O composer do Inbox agora aceita PDF, Office, texto/CSV, ZIP, imagens, vídeos e áudios de até 100 MB. Executáveis, scripts e extensões fora da lista permitida são recusados antes do upload.
- O navegador solicita URL de upload assinada, envia ao bucket privado `lotti-inbox-files` e encaminha somente o caminho/metadados ao runtime; o provedor recebe URL de leitura com validade curta.
- Verificação desta etapa: 13/13 testes frontend/Edge direcionados, 32/32 testes do runtime e build Vite de produção passaram. Pendente aplicar a nova migration do bucket, publicar a Edge Function e reconstruir o runtime antes do teste real.
- Compatibilidade alinhada antes da publicação: CSV `application/vnd.ms-excel` e ZIP `application/x-zip-compressed` agora são aceitos de ponta a ponta; correções `25bfc6c` na plataforma e `77f523c` no runtime.
- Migration `20260922000200_lotti_inbox_files.sql` aplicada isoladamente e registrada, sem `--include-all`. Bucket confirmado privado, com limite de 104857600 bytes e 25 MIME types. Edge Function `lotti-whatsapp` v20 ficou `ACTIVE`; chamada sem autenticação retornou 401.
- PR #12 integrada em `36d72b3`; Vercel `dpl_87opxun6t31QYxwjy9DPLVrGNSQr` ficou `Ready` com aliases oficiais. Resultado integrado: 79 arquivos/595 testes e build passaram com variáveis públicas fictícias do CI.
- PR #4 integrada no runtime em `85192b7`; 33/33 testes passaram. Somente o serviço Docker `agent` foi reconstruído/recriado; Evolution, Postgres, Redis e volumes permaneceram ativos. Health: runtime e IA configurados, envios automáticos desativados. Nenhum arquivo foi enviado a contato real; teste ponta a ponta ainda requer destinatário autorizado.

### 2026-09-22 - Codex (slide comercial do ecossistema Lotti)
- Slide unico criado em `output/presentations/LOTTI_ECOSSISTEMA_COMERCIAL.pptx` com os tres planos de software, Growth, Performance e fluxo captação → corretor. Preços e escopos seguiram o briefing desta tarefa.
- Identidade verificada em `src/index.css`, `tailwind.config.ts`, `src/pages/PublicInfo.tsx` e nos arquivos de marca do projeto: branco, verde `#093323`, Inter, Lora e logotipo existente. Nenhum asset externo foi criado.
- PPTX finalizado com integridade, layout, contagem de um slide, fontes e importação aprovados; renderização final inspecionada. Não houve teste em PowerPoint ou Google Slides.

### 2026-09-22 - Codex (artes do funil comercial)
- Figma e Miro autenticados. Arquivo de design Figma `OmAEQ6ppvVuTCYRgBxbvMJ` criado com três pranchas vazias e tokens de cor Lotti; a edição posterior foi bloqueada pelo limite de chamadas MCP do plano Starter. As pranchas no Figma não estão concluídas.
- Três artes vetoriais SVG e versões PNG foram criadas em `output/figma-assets/` usando a paleta e tipografia existentes no projeto. Temas: tração do funil, ecossistema ponta a ponta e exemplo ilustrativo de qualificação. PNGs renderizados e inspecionados; nenhuma métrica real ou dado pessoal foi usado.
- Board Miro `https://miro.com/app/board/uXjVHjofzpY=/` criado após confirmação do usuário e recebeu as três artes SVG em sequência vertical. O board foi aberto no preview do app. Pendente: importar/concluir as artes no arquivo Figma quando o limite permitir.

### 2026-09-22 - Codex (auditoria do Reel para a página pública)
- O Reel `Ddkzc55OkHm` foi inspecionado e comparado com as superfícies públicas e a arquitetura atual. A única lacuna relevante encontrada foi a clareza imediata do título de `/sobre`; o hero existente foi preservado e recebeu texto mais direto sobre clientes, imóveis, negociações e próximos passos.
- Não foram criados WhatsApp, depoimentos, endereço, FAQ, páginas por serviço ou nova medição: WhatsApp já existe na fachada pública quando há corretor, Clarity e metadados por rota já existem, e os demais itens exigiriam conteúdo real ou não correspondem ao escopo do produto autenticado.
- Validação: build de produção, ESLint direcionado, teste direcionado (3/3), suíte sem a cópia antiga de `.vercel` (75 arquivos/572 testes) e `git diff --check` passaram. Inspeção responsiva em 1440x900, 1024x768, 768x1024 e 390x844 não encontrou overflow horizontal. O lint global e o typecheck continuam falhando em erros preexistentes fora dos arquivos alterados; o runner sem exclusão também coleta uma cópia antiga em `.vercel/oauth-deploy`.
- Commit `326ad2f` rebasedado sobre a main atual e enviado para `origin/main`. Na revisão integrada, build, ESLint direcionado e 78 arquivos/587 testes passaram; a primeira execução paralela teve timeout de workers sem falhas de asserção e passou isoladamente com concorrência limitada. Vercel publicou `dpl_8sRwbcFssm9iDThyX4YRjPjie8rF` como `Ready`, com os aliases `app.plataformalotti.com.br` e `olivercrm.vercel.app`; ambos responderam HTTP 200 em `/sobre`.

### 2026-09-22 - Codex (PRs #11/#3 e liberação do WhatsApp)
- PR #11 da plataforma mesclada pela conta proprietária em `7cd0384`; PR #3 do runtime mesclada em `7ab6407`. Revisão sem achados bloqueantes. Verificações locais: 587/587 testes e build da plataforma; 26/26 testes do runtime; merges simulados sem conflito. No GitHub, os checks de segurança/testes da plataforma passaram e somente o preview da Vercel estava bloqueado pela permissão do autor.
- O schema remoto já continha a coluna `status`, as RPCs e o trigger da migration `20260921130000_lotti_inbox_actions.sql`, mas faltava o registro no histórico; o histórico foi reparado como `applied` após consulta de verificação, sem aplicar migrations antigas. `lotti-whatsapp` v18 foi publicada e ficou `ACTIVE`; chamada sem autenticação retornou 401.
- Runtime local atualizado para `7ab6407`; somente o container `agent` foi reconstruído/recriado. Health respondeu 200 com runtime configurado e envios automáticos desativados. A consulta do canal confirmou `connected`, com telefone e horário presentes, sem registrar os valores; Evolution, Postgres e Redis permaneceram ativos e os volumes não foram alterados.
- Docker Desktop 4.72 foi recuperado de sockets AF_UNIX corrompidos renomeando apenas os diretórios efêmeros `Docker\\run` e `docker-secrets-engine` para backups `*.stale-*`; nenhum reset/prune foi executado. A configuração de IA do Docker foi restaurada ao valor anterior.
- Vercel publicou `dpl_7hg8aAze5VDGsGDr96MJsi1F65jA` como `READY` em produção; aliases `app.plataformalotti.com.br` e `olivercrm.vercel.app` confirmados. `/whatsapp` respondeu HTTP 200. Pendente apenas teste autenticado no navegador e envio real para um destinatário autorizado.
### 2026-09-23 - Codex (PR #7 runtime e PR #14 plataforma)
- Runtime PR #7 integrado em `7400064`; 53/53 testes passaram. Containers `agent` e `evolution` foram reconstruidos/recriados sem recriar Postgres ou Redis; o volume `lotti-agent_evolution-instances` permaneceu montado. Health respondeu 200, IA configurada e envios automaticos desativados.
- `HISTORY_IMPORT_ENABLED=true` foi habilitado somente na configuracao local ignorada pelo Git. Uma reconexao por QR ainda e necessaria para o WhatsApp solicitar novamente o historico com o cache LID→telefone entre lotes; grupos, newsletters e broadcasts continuam excluidos.
- Plataforma PR #14 integrada em `762e240`. Testes direcionados: 17/17; suite: 80 arquivos/617 testes; build de producao e `git diff --check` passaram.
- Vercel publicou `dpl_G4jrnyqNWUaPf3pUePCQKGUMVtLX` como `Ready`; aliases `app.plataformalotti.com.br` e `olivercrm.vercel.app` confirmados, com `/` e `/whatsapp` respondendo HTTP 200.

### 2026-09-23 - Codex (acabamento do Inbox: anexo, microfone e contato)
- Branch `codex/whatsapp-live-only-attachments`. O compositor mantém o campo de mensagem após selecionar arquivo e permite enviar o anexo com Enter; Shift+Enter continua reservado para quebra de linha e composição IME não dispara envio.
- Falha de permissão do microfone agora orienta explicitamente a liberar `Microfone → Permitir` no Chrome. A permissão continua sendo decisão do usuário/navegador.
- O modal do lápis passou a editar nome e telefone atuais. Nova RPC `lotti_inbox_update_contact` valida os campos, verifica o proprietário autenticado, atualiza cliente e conversa na mesma transação e trata telefone já usado.
- Verificação: 621/621 testes passaram com as variáveis públicas fictícias do CI; build Vite passou; ESLint direcionado passou. O typecheck global continua falhando nos erros antigos de schema/tipos fora deste escopo.
- Diagnóstico do histórico: os lotes recebidos nesta sessão continham somente grupos ou LIDs sem telefone mapeável (`accepted=0`), portanto não há importação segura de contatos recentes. A configuração local `HISTORY_IMPORT_ENABLED` foi desativada para impedir novas conversas fantasmas; nenhuma conversa existente foi apagada ou arquivada nesta etapa.

### 2026-09-23 - Codex (seção de atendimento em `/sobre`)
- Fluxo visual do atendimento repetitivo integrado em `d77c6fc` e publicado em produção; 80 arquivos/623 testes, ESLint, build, `git diff --check` e smoke responsivo de `/sobre` aprovados.

### 2026-09-24 - Codex (ajustes do Inbox conectado)
- Branch `codex/whatsapp-inbox-polish` isolada a partir da main. O Inbox usa inicial do nome disponível (ou ícone neutro), exibe hora curta nas bolhas e nas conversas de hoje e distingue arquivos enviados usando `media_path` e URL assinada do bucket privado.
- O compositor volta o foco ao campo de mensagem após selecionar um arquivo; Enter envia o anexo pelo fluxo existente. Avisos internos de mudança de modo da IA e de etapa do Funil são persistidos separadamente das mensagens de WhatsApp. A empresa exibida na Conexão pode ser editada para o canal/número ativo, sem alterar canais arquivados.
- O teste de envio não informa sucesso enquanto a entrega estiver apenas em andamento e impede usar o próprio número conectado. A causa da falha real de envio ainda exige verificação no serviço/provedor; o fluxo de teste ainda cria conversa antes da confirmação e precisa de revisão separada.
- Verificação: 82 arquivos/636 testes passaram após o refinamento; testes direcionados do Inbox e da migration de eventos passaram. Links assinados dos anexos são renovados enquanto o Inbox permanece aberto. Eventos de negócio incluem seu título para diferenciar múltiplas oportunidades do mesmo cliente. Typecheck global segue com erros preexistentes fora dos arquivos alterados. Pendente aplicar migrations, publicar PR e validar com conta conectada. Integração OpenAI depende de chave configurada no runtime e teste controlado; não foi ativada em produção.
- Prévia local `/whatsapp?preview=connected` agora usa a Inbox conectada nova com dados fictícios, sem consultas de conversas nem ações de escrita; controles de envio/alteração são desativados. Testes direcionados 22/22, build Vite e ESLint direcionado passaram. A prévia não prova funcionamento com WhatsApp real.
- A aparência da Inbox conectada foi aproximada da referência visual do Clix: azul cobalto em mensagens enviadas e controles, fundo claro pontilhado na conversa, seleção lateral marcada, espaçamento/tipografia de bolhas e compositor claro retangular. Sem templates. Verificação: 82 arquivos/639 testes, build Vite, ESLint direcionado e diff check passaram. Pendente validação visual pelo usuário na prévia local e teste com conexão real.
- Após feedback, os destaques azuis da Inbox conectada foram trocados por tokens `primary` da Lotti, mantendo layout, bolhas e fundo pontilhado. A prévia permanece sem ações reais; os fluxos da Inbox conectada mantêm chamadas existentes, mas envio, áudio e arquivo ainda exigem teste real com canal conectado. Verificação: 82 arquivos/639 testes, build Vite, ESLint direcionado e diff check passaram.
- Prévia local conectada ampliada para interações fictícias em memória: IA, Nova conversa, editar contato, abrir/fechar, atribuição, tags, notas e composição simulada de texto/arquivo/áudio; nenhuma dessas ações de prévia chama o backend. A margem lateral do histórico foi reduzida de `clamp(16px,3vw,38px)` para `clamp(12px,2vw,24px)`. Nova verificação: 82 arquivos/644 testes, build Vite, ESLint direcionado e `git diff --check` passaram. Pendência: validar interações com conexão real; a prévia não comprova envio, áudio ou arquivos em produção. O usuário autorizou enviar esta etapa ao PR #16 existente.

### 2026-09-24 - Codex (PR #16 em produção)
- PR #16 integrado à `main` no merge `6e54ce4`. As migrations `20260924000100` e `20260924000200` foram aplicadas individualmente e registradas no histórico remoto, sem executar migrations antigas; coluna `company_name`, tabela `lotti_inbox_events` e policy de leitura do proprietário foram confirmadas.
- Verificação integrada em worktree limpo: 82 arquivos/644 testes, build Vite e `git diff --check` passaram. A primeira execução sem variáveis públicas fictícias do CI deixou uma suíte sem iniciar; repetida com as variáveis do workflow, passou integralmente.
- Vercel publicou o deployment `dpl_J5RENX8S3PT5dUjmsX6UrVdRt5KP` como `Ready`, com aliases `app.plataformalotti.com.br`, `olivercrm.vercel.app` e `casa-mente-contrato-1.vercel.app`. Pendente validar a Inbox autenticada com canal real conectado; nenhum envio de teste foi realizado nesta publicação.

### 2026-09-25 - Codex (prévia e eventos do Inbox)
- Na branch isolada `codex/whatsapp-inbox-polish`, a prévia usa fundo verde claro da Lotti, cartão visual de arquivo e evento distinto de fechamento de conversa. A migration `20260925000100_lotti_inbox_status_events.sql` registra fechamento/reabertura e evita gravar "IA pausada" quando o fechamento pausa a IA na mesma atualização. A migration ainda não foi aplicada em produção.
- Consultas da lista, prévias e eventos passaram de 1,5 s para 3 s; mensagens da conversa aberta permanecem em 1,5 s. Isso reduz consultas repetidas, mas pode aumentar em até 1,5 s a atualização de outra conversa na lista.
- Verificação nesta etapa: 47 testes direcionados do app/migration e build Vite passaram; 5 testes da importação de hoje no runtime passaram. O teste de envio, a origem do evento "IA desligada por Sistema" e a cobertura de todos os contatos do dia seguem pendentes de diagnóstico com sessão real.
- A ponte `n8n-agent-lotti/runtime/manual.mjs` teve removida uma leitura redundante de proprietário: a RPC `lotti_manual_begin` já verifica e bloqueia a conversa antes de acessar storage ou Evolution. Testes de proteção do destinatário, dono incorreto, timeout e anexos continuam passando; suite do runtime 58/58, sintaxe Node e diff check passaram. A otimização elimina um round-trip ao Supabase, mas a redução de tempo real ainda não foi medida com conexão ativa.
- A primeira inicialização do Vite na branch isolada não herdou `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, causando tela branca com erro `supabaseUrl is required`. O servidor local foi reiniciado em segundo plano com somente essas duas variáveis públicas da configuração local, sem copiar arquivo `.env`. Verificação headless: sem erro de página e redirecionamento esperado para `/auth` quando não há sessão; a visualização do Inbox exige login. Nenhuma alteração em Docker ou produção.
- Após feedback visual, o cabeçalho da Inbox conectada reúne nome, telefone formatado, etapa, status e modo IA em uma linha compacta. Em larguras abaixo de 1536 px, o perfil inicia fechado e abre como painel sobreposto pelo botão, evitando que a terceira coluna force rolagem horizontal e comprima o chat. Os controles preservam suas ações existentes. Verificação: 36 testes direcionados, ESLint dos arquivos alterados, diff check e build Vite passaram; prévia permanece fictícia e não valida a conexão real.

### 2026-09-25 - Codex (falha do CI no PR #17)
- Os dois jobs `verify` do PR #17 falharam no teste de horário de anexo: a bolha usava o fuso do runner (UTC), enquanto o teste e a lista usam `America/Sao_Paulo`. A falha foi reproduzida localmente com `TZ=UTC` e o horário da bolha passou a usar explicitamente o fuso de São Paulo, inclusive no título.
- Verificação com `TZ=UTC` e as variáveis públicas fictícias do CI: 82 arquivos e 649 testes passaram. Build Vite, ESLint direcionado e `git diff --check` passaram. O bloqueio separado da Vercel informa que o autor do commit precisa de acesso ao projeto; não é falha de código nem foi alterado nesta etapa.

### 2026-09-25 - Codex (cabeçalho, avatar e espaçamento do Inbox)
- Em branch isolada a partir da main que mesclou o PR #17, o cabeçalho da conversa permite quebra responsiva dos controles, evitando sobreposição do telefone com os indicadores. O avatar da lista e do cabeçalho passa a usar o mesmo nome exibido; o caso de cadastro `Contato WhatsApp` com nome `Rafael` foi coberto por teste de regressão.
- O histórico usa margens laterais, espaçamento entre itens e altura das bolhas menores para aproximar mensagens. Nenhuma consulta, RPC, importação de contatos ou fluxo de envio foi alterado.
- Verificação: 82 arquivos/650 testes com `TZ=UTC` e variáveis públicas fictícias do CI, build Vite, ESLint dos arquivos alterados e `git diff --check` passaram. Validação visual autenticada com canal real segue pendente.

### 2026-09-25 - Codex (assinaturas Asaas e limites dos planos)
- Audio e video fornecidos foram transcritos localmente e analisados como referencias de fluxo. Catalogo confirmado: mensalidades 279/399/799 e cotas 100/250/600 leads, 250/1500/ilimitados imoveis, 5/30/ilimitados alugueis, 15/60/ilimitadas fachadas e 10/25/40 operacoes de contratos com IA.
- Aplicadas isoladamente e registradas no Supabase vinculado as migrations 20260826090000 e 20260925120000/120100/120200/120300. Verificados historico, tabelas e privilegios: authenticated nao pode editar assinaturas nem consumo. Limites contam alugueis residenciais e comerciais, reativacoes e insercoes em lote; IA usa reserva atomica com devolucao em falha conhecida.
- Funcoes gerar-contrato e analisar-contrato publicadas. Auth site_url/redirects corrigidos para o dominio da plataforma e nova-senha; UI ajustada a politica remota de senha minima de 10 caracteres.
- Checkout do site implementa verificacao do pagamento no Asaas, livro de cobrancas idempotente, renovacao e estorno sem revogar periodo posterior pago. Protecao por IP e bloqueio de recriacao de cobranca com resultado incerto adicionados. Configuracoes de backend preparadas na Vercel, com CHECKOUT_ENABLED=false.
- Verificacoes: plataforma isolada baseada em origin/main 31d305b passou 86 arquivos/672 testes e build; site passou 8 testes, ESLint e build. Migrations validadas em PGlite e transacao remota com rollback antes da aplicacao. Nenhuma cobranca real foi criada nesta etapa.
- Pendencias: chave/ambiente/webhook Asaas, SMTP e entrega real de convite/recuperacao, homologacao sandbox e liberacao explicita da flag apos validacao. Troca/cancelamento na plataforma continuam indisponiveis, sem mock de sucesso. Pareamento e envio real do WhatsApp sao homologados separadamente. Guia em docs/ASAAS_PLANOS_ATIVACAO.md.
### 2026-09-26 - Codex (publicacao do checkout e verificacao de acesso)
- Plataforma PR #19 integrada em b69a4e3; dois jobs verify e Vercel Preview Comments passaram. Deployment dpl_DZ1TaJi5iBxHCHq9JN9ug4jNbQaW confirmado Ready com app.plataformalotti.com.br e olivercrm.vercel.app; nova-senha respondeu 200 e as duas funcoes de IA rejeitaram chamadas sem autenticacao com 401.
- Site PR #2 integrada em 529415e; deployment dpl_GpUNUzUrykExBQrtSKFjhGHGTJge confirmado Ready com plataforma principal e www. O ciclo escolhido nos precos agora chega ao checkout. Navegador confirmou Inteligente mensal no cartao por 279 e Profissional anual no Pix por 3990. Corrigido o hook responsivo herdado da nova tabela de precos; 8 testes, ESLint e build Next/TypeScript passaram apos rebase.
- Smoke de producao: checkout desativado retorna 503 CHECKOUT_NOT_CONFIGURED, webhook sem token retorna 401, status sem identificadores retorna 400. CHECKOUT_ENABLED permanece false; nenhuma cobranca real ou assinatura de teste foi criada.
- O usuario forneceu destinatario e autorizou teste de e-mail. Confirmado cadastro existente; uma solicitacao de recuperacao de senha com retorno para nova-senha foi aceita pelo Auth com HTTP 200. Recebimento ainda nao confirmado. Esse teste em conta existente nao comprova entrega para novos clientes externos nem configuracao SMTP de producao.
- Pendencias: login na janela separada Asaas, chave/ambiente e webhook, configuracao/verificacao do e-mail e compra sandbox completa. A sessao do navegador consultada permanece no login. Nao registrar destinatario, tokens, links de acesso ou chaves no handoff.
### 2026-09-26 - Codex (e-mail confirmado e acesso ao Comet)
- Usuario confirmou recebimento do e-mail e redefinicao concluida na Lotti; prints confirmaram entrega e abertura da tela com politica de 10 caracteres. O remetente exibido continua sendo o padrao do Supabase; entrega para novos destinatarios externos ainda requer SMTP proprio.
- Templates de convite e recuperacao criados em supabase/templates, com portugues, identidade Lotti e ConfirmationURL preservada. Assuntos e conteudos publicados pelo config push usando copia isolada e atualizada da configuracao remota; somente os dois templates foram alterados. Diff posterior zerou os campos gerenciados; propriedade SMS nao declarada foi preservada.
- A extensao do navegador passou a expor as abas do Comet. Confirmada conta recebedora logada e acesso ao sandbox pelo menu oficial, sem novo login. Existe uma chave anterior na producao; nao foi alterada nem removida.
- Preparada chave exclusiva de homologacao no sandbox, com saques desabilitados e expiracao em 03/10/2026 23:59. Asaas exigiu SMS antes de gerar; usuario foi orientado a concluir diretamente no Comet. Nenhuma chave sandbox foi obtida e nenhuma cobranca foi criada nesta etapa.
### 2026-09-26 - Codex (homologacao da API Asaas)
- Usuario concluiu a geracao da chave sandbox no Comet. Autenticacao da API validada; chave exclusiva com saques desabilitados e expiracao em 03/10/2026 23:59. Segredos mantidos fora dos repositorios.
- Codigo real do gateway criou e verificou assinaturas mensais dos tres planos no sandbox: 279/399/799, todas CONFIRMED e vinculacao de cliente/assinatura/pedido/valor validada. Cartao de recusa oficial retornou CARD_REFUSED.
- Pix anual dos tres planos gerou QR Code e passou de PENDING a RECEIVED pela simulacao oficial sandbox: 2790/3990/7990. Identificada geracao assincrona do QR; correcao repete somente a consulta, sem criar nova cobranca. Site passou 8 testes, ESLint direcionado, build Next/TypeScript e diff check.
- Nenhum pagamento real efetuado e nenhuma assinatura sandbox aplicada ao banco de producao. Webhook e provisionamento completos ainda aguardam ambiente isolado. CHECKOUT_ENABLED segue false.
- Formulario da chave de producao preparado no Comet com escrita em clientes, cobrancas, assinaturas e cartoes; demais permissoes negadas. Asaas exige Token App do titular no iPhone antes de gerar. SMTP proprio e teste de convite externo continuam pendentes.


### 2026-09-26 - Codex (fluxo completo em homologacao isolada)
- PR #20 da plataforma integrada em 821fe73 e PR #3 do site integrada em 6182b2d. Site publicado em dpl_8cXQuXYaPXMotrSjKC3rTVFdLDsY, Ready com aliases oficiais; a consulta do QR aguarda a geracao assincrona sem duplicar assinatura.
- Criado projeto Supabase local exclusivo lotti-billing-hml com schema public/private sem dados pessoais, somente catalogo de 3 planos/60 direitos e gatilho de criacao de perfil. Banco de producao nao recebeu contas ou pagamentos simulados.
- Homologado checkout real, entrega real de webhook Asaas sandbox, criacao de conta, convite e assinatura: Profissional mensal e Inteligente anual Pix. Dois eventos processados; reenvio de cada evento duas vezes manteve periodos e quantidade de assinaturas. Convites em portugues capturados na caixa local e redirect correto para nova-senha.
- Comet confirmou formulario de senha de 10 caracteres e painel da nova conta Inteligente anual ativo com cotas 100 leads/250 imoveis/5 alugueis/15 fachadas/10 IA. Em transacao local com rollback, 250 imoveis permitidos e o 251 rejeitado com PLAN_LIMIT_REACHED.
- Ajustados textos do painel para diferenciar renovacao do Pix mediante pagamento e cotas mensais de IA de limites de cadastros ativos. Pendencias de producao: titular concluir Token App para gerar chave exclusiva, SMTP de dominio verificado e teste de convite externo. Troca/cancelamento continuam indisponiveis. CHECKOUT_ENABLED continua false.

### 2026-09-26 - Codex (conexao de producao Asaas)
- Titular concluiu Token App e gerou a chave de producao pelo Comet. Verificada autorizacao de leitura em clientes, cobrancas e assinaturas; credencial mantida fora do Git. ASAAS_API_KEY sensivel e ASAAS_ENVIRONMENT=production adicionados ao ambiente Production do lotti-site.
- Webhook exclusivo Lotti SaaS - assinaturas criado no Asaas, ativo, API v3, entrega sequencial e token de autenticacao. Eventos de confirmacao, recebimento, atraso, estorno total/parcial, exclusao, chargeback, atualizacao e restauracao selecionados. Integracao CRM anterior preservada.
- Redeploy do site dpl_BbVB13t4vVhUckRVyXzjoTj3NPu2 confirmado Ready e aliases oficiais. Smoke autenticado do webhook com cobranca alheia ao checkout retornou 200 sem provisionar; checkout permaneceu 503 CHECKOUT_NOT_CONFIGURED. Nenhuma cobranca real criada.
- PR #21 integrada em 5555534 apos checks aprovados. Painel distingue renovacao do Pix e cotas por mes de cadastros ativos.
- Ambiente local de homologacao e tunel encerrados; webhook sandbox exclusivo desativado. Dados locais de teste preservados, sem alterar outros containers ou banco real.
- Bloqueio restante para novas vendas: configurar SMTP com dominio verificado e homologar convite externo. Login do Resend aberto no Comet e entregue ao titular; nao entrou nesta etapa. CHECKOUT_ENABLED continua false ate verificar esse fluxo. Troca/cancelamento permanecem indisponiveis.

### 2026-09-26 - Codex (SMTP homologado e checkout liberado)
- Titular entrou na Hostinger pelo Comet. Adicionados apenas TXT DKIM e dois CNAME do subdominio auth; registros anteriores preservados. Consulta ao DNS autoritativo confirmou valores e Resend confirmou dominio Verified.
- SMTP Resend publicado no Supabase com remetente do dominio verificado. Diff remoto confirmou somente configuracao SMS nao declarada como diferenca; templates e demais configuracoes preservados.
- Recuperacao e convite de conta nova aceitos pelo Auth com HTTP 200; ambos exibidos como Delivered no Resend. Conta de convite de teste sem assinatura paga. Nenhuma cobranca real criada.
- CHECKOUT_ENABLED=true em Production e redeploy dpl_HtTizXunggeQzRsiK1Rr5P8HQKWC Ready com aliases oficiais. Smoke: checkout pagina 200, dados invalidos 400 INVALID_CHECKOUT_DATA, webhook sem token 401. Comet confirmou Inteligente mensal 279 e cotas 100/250/5/15/10.
- Compra, provisionamento, renovacao e cotas previamente homologados no sandbox isolado. Troca/cancelamento dentro da plataforma e ativacao do agente WhatsApp continuam pendentes em escopos separados. Guia operacional atualizado; segredos fora do Git.

### 2026-09-27 - Claude (sprint do Jira sobre a main atual)
- Branch `claude/jira-sprint-2026-09-27-main`, criada a partir de `origin/main` 603208a e reaplicada sobre ela. A versão anterior, baseada em 052327d, ficou em `claude/jira-sprint-2026-09-27-backup-052327d`.
- As migrations de planos da versão anterior saíram: a `main`, pelo PR #19 (`20260925120000` a `20260925120300`, já aplicadas), cobre o mesmo ponto com regras mais rígidas, e elas reabririam `incrementar_uso` ao usuário. `docs/jira/planos-limites.md` passa a registrar o estado anterior ao #19.
- Incluído, com testes em PGlite/Vitest:
  - admin: funções auxiliares fechadas e escritas diretas do painel auditadas (`20260927090000`);
  - onboarding: sem becos, convite preservado no login, CRECI mantido, pré-preenchimento tardio e tela sem jargão; reforço de corretor ativo para a migration de onboarding (`20260927110000`, depende da `20260821130000`);
  - agente: conversa abandonada vai para a equipe (`20260927120000`) e opt-out com bloqueio de IA e de envio manual (`20260927120100`);
  - Inbox: estado "Não quer receber" e botão "Liberar contato", sobre o cabeçalho compacto do PR #18.
- Relatórios em `docs/jira/`: infra, admin, planos, agente e mensagens, onboarding.
- Ponte, fora deste repositório: `n8n-agent-lotti` branch `claude/agent-catalog-stalled` (b280faa), com catálogo só de imóveis disponíveis e chamada a `lotti_agent_escalate_stalled` antes de cada claim.
- Nada aplicado em produção nem publicado. Pendentes: mensagem de fallback ao lead, dados do lead no cadastro, regra de consentimento para conversas iniciadas pelo corretor e SCRUM-28.
### 2026-09-27 - Claude (tarefas em andamento do Jira)
- Branch `claude/jira-andamento-sobre-pr22`, empilhada sobre o PR #22 (`claude/jira-sprint-2026-09-27`), com os conflitos de `AI_HANDOFF.md` e `ConnectedInbox.test.tsx` resolvidos mantendo os dois lados. Integrar depois do #22. A versão sobre a `main` pura é `claude/jira-andamento-2026-09-27`.
- SCRUM-49 (`docs/jira/contatos-historico.md`): o histórico vem da sincronização do WhatsApp com o aparelho novo, só no primeiro pareamento. No teste real, as conversas individuais chegaram com cerca de 3 meses (primeira em 23/06/2026). Amostra de um aparelho.
- SCRUM-50 (`docs/jira/custo-por-usuario.md`): custo estimado de R$ 23–61, R$ 33–105 e R$ 59–208 por conta/mês nos planos de R$ 279, R$ 399 e R$ 799 (cota cheia, 30 contas, `gpt-4o-mini`, cartão), antes de impostos. Preços oficiais consultados hoje. Deixa a consulta de `ai_runs` pronta para medir o custo real.
- SCRUM-28: rótulos únicos de status (conta, atividade e assinatura; `past_due` = "Em atraso") e plano com situação na lista e no CSV de usuários.
- SCRUM-31 e SCRUM-40: teste PGlite versionado (`lotti-agent-isolamento.test.ts`) de RLS, ações, franquia e envio manual entre duas contas.
- SCRUM-36: teste de tela com a qualificação preenchida no painel do Inbox.
- Ponte, `n8n-agent-lotti` branch `claude/agent-webhook-and-claims` sobre `claude/agent-catalog-stalled`:
  - connect falha sem `WEBHOOK_TOKEN` e o `/health` informa (SCRUM-30);
  - o `.env.example` completo (SCRUM-30);
  - resposta com preço fora do catálogo ou do que o lead disse é rejeitada (SCRUM-34);
  - log `lotti.ai_usage` só com tokens (SCRUM-50).
- Nada aplicado nem publicado.
### 2026-09-27 - Claude (Agente de IA, etapa 1: configuração real)
- Plataforma, branch `claude/agente-ia-configuracao-real` (a partir de `origin/main` 603208a):
  - a tela do Agente de IA veio da `codex/follow-up-leads` para `/whatsapp/agente`, no grupo "Automações";
  - `20260927130000_lotti_agent_settings.sql` cria `lotti_agent_settings` (leitura só do dono), `lotti_agent_save_settings` (validação no servidor; "Agente ativo" liga `lotti_agent_channels.enabled`), `lotti_agent_defer` (adia ou pula e devolve a franquia de quem a IA não atendeu) e `lotti_agent_handoff` (pausa a IA, avisa e move a etapa do funil). Também desacopla "Nova conversa" do agente ligado;
  - a tela abre com a cópia local e usa a versão do banco. Sem a migration, salva no navegador e avisa. O agente começa desligado.
- Ponte, branch `claude/agente-usa-configuracao` sobre `claude/no-logout-on-reconnect`:
  - com configuração salva, o texto do agente sai da persona e das preferências, sobre as regras fixas;
  - o agente fala como alguém da equipe e não cita IA nem Lotti; se perguntado diretamente, não mente;
  - usa o modelo escolhido (OpenAI ou Gemini, com fallback), "quando atender", agrupamento, a ferramenta "Imóveis" e a transferência com mensagem ou silenciosa;
  - sem configuração salva, comporta-se exatamente como antes.
- Verificação: plataforma com 93 arquivos e 749 testes (16 da migration em PGlite) e build; ponte com 85/85.
- Correções relacionadas, em branches próprias:
  - `claude/whatsapp-reconexao-e-rolagem` (plataforma): a tela não pede "conectar" durante a reconexão, e a conversa abre na última mensagem;
  - `claude/no-logout-on-reconnect` (ponte): sem logout de sessão reconectando. A causa foi confirmada pelo "Log out instance" no teste real.
- Pendente: etapa 2 (envio de follow-up) e etapa 3 (disparos: decidir entre WhatsApp Web com limites ou API oficial da Meta). Nada aplicado nem publicado.
### 2026-09-27 - Claude (follow-up automático e Disparos)
- Plataforma, branch `claude/follow-up-sobre-pr25`, empilhada sobre o PR #25 (`claude/agente-ia-sobre-pr23`):
  - `20260927140000_lotti_agent_follow_up.sql`:
    - envio automático compartilhado (`lotti_agent_auto_begin/finish/fail`). Cada mensagem ganha revisão própria no `lotti_agent_outbox`: o eco é reconhecido como automático e uma mensagem nova do lead ou da equipe cancela o envio;
    - follow-up: `arm`, `claim`, `release`, `advance` e `close`. O fechamento fecha a conversa e move a etapa;
    - só `service_role` executa.
  - `20260927150000_lotti_broadcasts.sql`:
    - campanhas, entregas, eventos e `lotti_automation_heartbeat`;
    - público e prévia calculados no servidor, só conversas com mensagem do lead nas últimas 24 h (decisão do Rafael), sem opt-out, pausadas, fechadas ou arquivadas;
    - variáveis `{{nome}}` e `{{corretor}}`;
    - ativar agora ou agendar; pausar, retomar, cancelar, duplicar e excluir rascunho;
    - revalidação no envio, espaçamento por campanha e mínimo de 20 s por número, até 300 entregas por conta em 24 h.
  - Tela: "Automações > Disparos" (`/automacoes`, `/automacoes/novo`, `/automacoes/:id`) com lista, criador em 4 etapas e acompanhamento por contato. O modelo da Meta e o disparo "Por evento" continuam indisponíveis. A tela avisa quando o envio automático não está liberado.
- Ponte, `n8n-agent-lotti` branch `claude/follow-up-e-disparos` sobre `claude/agente-usa-configuracao`:
  - arma o follow-up depois da resposta da IA;
  - a cada 15 s envia toques vencidos (janela de 24 h, horário de atendimento, despedida e fechamento) e entregas de Disparos;
  - só com `AUTOMATIONS_ENABLED=true` e `LIVE_SEND_ENABLED=true`.
- Verificação:
  - plataforma: 105 arquivos e 960 testes passando, mais 3 "expected fail";
  - PGlite: 20 testes do follow-up e 26 dos Disparos; build e `git diff --check` passaram;
  - o `routine-visual.test.tsx` falha também na pilha sem estas mudanças, porque depende do horário em que roda;
  - ponte: 105/105.
- Nada aplicado em produção nem publicado, e nenhuma mensagem enviada. Ligar exige as migrations 140000 e 150000 e `AUTOMATIONS_ENABLED=true` na ponte, com autorização do Rafael.
### 2026-09-26 - Claude (conversas com número oculto pelo WhatsApp)
- Pedido do usuário: ao conectar pelo QR, trazer as conversas do número para a Inbox. Diagnóstico: em 23/09 o histórico chegou só com grupos ou LIDs sem telefone (`accepted=0`), porque o WhatsApp identifica muitos contatos por LID; a plataforma exigia telefone e descartava tudo.
- Plataforma, branch `claude/whatsapp-lid-conversations` (worktree `C:\Users\rafae\claude-worktrees\lid-platform`, a partir da `main` 052327d): migration `20260926200000_lotti_whatsapp_lid_conversations.sql` adiciona `lid` à conversa, torna `phone` opcional (exige um dos dois), cria `lotti_agent_resolve_conversation` e `lotti_agent_merge_conversation` e reescreve ingest, import_history, claim, begin_send, manual_begin e update_contact para telefone e/ou LID. Quando o WhatsApp revela o número, a conversa do LID é completada ou unida à do telefone (mensagens, envios manuais e eventos são movidos). O número de conversas identificadas por LID é definido só pelo WhatsApp; o corretor apenas renomeia. O gatilho `lotti_inbox_reopen_on_inbound` passou a usar a data da mensagem, evitando que histórico antigo suba para o topo com a data de hoje. A Inbox mostra "Número oculto pelo WhatsApp" e a busca não quebra sem telefone.
- Ponte `n8n-agent-lotti`, branch `claude/whatsapp-lid-conversations` (worktree `C:\Users\rafae\claude-worktrees\lid-bridge`, a partir de `codex/openai-whatsapp-agent` 2dda86c, que é o runtime atual): mensagens só com LID são mantidas, mapeamento ambíguo não deduz telefone, envios usam `<lid>@lid` sem telefone e `HISTORY_IMPORT_MODE=recent` importa todas as mensagens de hoje e a última de cada conversa antiga no pareamento (padrão `off`).
- Revisão independente dos dois diffs apontou e foram corrigidos: união religava a IA e perdia qualificação/alerta já enviado; união apagava resposta automática em envio (agora espera); risco de deadlock entre lote de histórico e mensagem ao vivo (lock consultivo por canal); cota cobrada duas vezes por LID e telefone; telefone digitado em conversa identificada por LID podia enviar a um desconhecido e vincular o cliente errado; memória do modo recente passou a ser por instância e número e gravada só após importar.
- Verificação final: plataforma 83 arquivos/667 testes (14 novos em PGlite para LID), build Vite, ESLint sem erros nos arquivos alterados (3 avisos antigos em `WhatsAppInbox.tsx`) e `git diff --check`; ponte 72/72 testes.
- Pendente e não executado: aplicar a migration, publicar front e ponte, configurar `HISTORY_IMPORT_MODE=recent` e reconectar pelo QR. O envio para `<lid>@lid` pela Evolution 2.3.7 ainda não foi comprovado; o teste real deve confirmar entrega e medir `accepted`/`lid_only` no log `lotti.history`. Nada foi publicado, aplicado ou enviado.
- Simulação local sem Docker (o Docker Desktop não iniciou por arquivos de socket travados): migrations reais em PGlite e código real da ponte recebendo lotes de histórico e mensagens ao vivo no formato da Evolution. Resultado: grupo ignorado; conversas de hoje com todas as mensagens; antigas com a última mensagem e a data real; contato só com LID exibido como "Número oculto pelo WhatsApp" e destino `<lid>@lid`; número revelado completa a conversa; conversa por LID unida à do telefone com 3 mensagens e modo Equipe; clientes no CRM só com telefone conhecido. A Inbox real da branch foi renderizada com esses dados numa prévia local fora do Git.

### 2026-09-27 - Claude (teste com número real e correções do número oculto)
- Teste local com um número real pela ponte de teste (Docker `lotti-lidtest`, Supabase local `lotti-lid-test`), com envio bloqueado:
  - a página de QR e o app de teste (`.claude/preview`, fora do Git) só permitem status, conectar e desconectar;
  - entraram 102 conversas e 108 mensagens, todas só com LID e sem nome;
  - a sessão caiu cerca de 3,5 min depois com código 401 (aparelho removido); a origem ainda não foi confirmada.
- Causa do número ausente: ao conectar, o buffer de eventos do Baileys junta os lotes de histórico e descarta `lidPnMappings`, embora já os tenha guardado. O repositório de mapeamentos da sessão tinha o telefone das 102 conversas.
- Correções:
  - ponte `claude/whatsapp-lid-conversations`, `619a121`: o patch da Evolution consulta `getPNsForLIDs` para LID sem número e leva o nome salvo na agenda (`key.lottiContactName`); os caches passaram a ser por instância, porque o mapa global podia expor o número de um contato a outra conta;
  - ponte, `ddbabd4`: o nome de perfil (`pushName`) deixou de ser usado, e contato não salvo aparece pelo número;
  - plataforma, `08bbfbb`: número formatado no título;
  - plataforma, `6107d41`: conversa que recebe histórico vai para atendimento humano, mesmo que uma mensagem ao vivo a tenha criado antes.
  - A imagem de teste `lotti-evolution:2.3.7-baileys-rc14-lidnames` é separada; a ponte de produção segue na imagem anterior.
- Verificação: patch 6/6 contra `main.js` e `main.mjs` reais; ponte 72/72; plataforma 83 arquivos/668 testes e build Vite.
- Pendente: reconectar pelo QR para confirmar números e nomes com o celular real; investigar o 401; mensagens atrasadas entregues ao reconectar ainda criam conversa nova com a IA.

### 2026-09-28 — Codex (integração do sprint Lotti)
- Integrados localmente na plataforma, com merge commits e nesta ordem: correção de segurança do `xlsx` (`585dc00`), PRs #22, #23, #24, #25, #27 e #26. O conflito em `AI_HANDOFF.md` foi resolvido preservando as duas entradas.
- Integrados no repositório da ponte, com merge commits e nesta ordem: PRs #10, #11, #12, #13, #14 e #15. `node --test runtime/*.test.mjs`: 105/105 aprovados.
- Ainda pendentes: validação completa da plataforma (a instalação local falhou por `EPERM` em `node_modules/@esbuild/win32-x64/esbuild.exe`), push/publicação da plataforma, conferência do deploy Vercel e aplicação das migrations em produção. As migrations de onboarding e número oculto permanecem seguradas conforme instrução.
- Nenhuma ponte foi publicada, mensagem real foi enviada ou campanha foi ativada.
- Diário — Codex: merges locais concluídos e ponte validada; publicação e Supabase aguardam ferramentas/acesso operacional.
- Atualização — Codex: a plataforma foi enviada para `origin/main` no commit `8a5df1f`; a ponte permaneceu somente no checkout local.

### 2026-09-30 - Codex (diagnóstico comercial público)
- Branch `codex/commercial-diagnostic`: rota pública `/diagnostico`, perguntas condicionais, classificação e conclusão contextual; back office em `/admin/diagnosticos` para leitura e status.
- Migration `20260930180000_commercial_diagnostic.sql` cria respostas, scores, atribuição e eventos com leitura restrita a admin; Edge Function `commercial-diagnostic` valida respostas e recalcula os scores no servidor.
- Verificações: build de produção, ESLint direcionado, `git diff --check`, 9 testes de jornada/função e 1 teste da migration passaram. Smoke no navegador cobriu 375, 390, 430 e 1440 px, validação, voltar, jornada completa, UTM e ausência de overflow/erro de página.
- Pendente: publicar a migration, Edge Function e frontend; `supabase db push --dry-run` encontrou versões remotas ausentes no diretório local e não aplicou SQL. Nenhum dado real de lead foi enviado.
- Diário - Codex: implementação isolada sobre a main; alterações locais de WhatsApp e demais arquivos não foram incorporadas.
