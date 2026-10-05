# Pendências da migração para a arquitetura do Clix

Lista viva: toda decisão adiada ou ponto em aberto entra aqui. Quem resolver risca
(`~~item~~`) e anota a data. Atualizada em 2026-10-04.

## Do Rafael (decisão ou acesso)

- [x] ~~**Ativar o backup (PITR) do Postgres do Railway antes da virada.**~~ Feito
  pelo Codex em 2026-10-05 com autorização do Rafael: backups diário (6 dias),
  semanal (27) e mensal (89), mais PITR `enabled` com bucket ligado (conferido em
  `railway postgres pitr status`). Custo por armazenamento e egress, sem taxa fixa.
- [ ] **Pedido ao suporte do Supabase** (linhas apagadas em 2026-10-02): confirmar se
  foi enviado (`pedido-suporte-supabase.md`). Até a resposta, o autovacuum segue
  **pausado** em `contratos`, `clientes`, `cliente_imovel` e `historico_contatos`.
  Não religar antes.
- [ ] **Produção (Supabase) sem backup nenhum: o projeto está no plano Free**
  (conferido pelo Codex no painel em 2026-10-05). O plano Free não tem backups, e a
  lista está zerada. Opções até a virada:
  - Pro (~US$25/mês): 7 dias de backups diários.
  - Exportar os dados por script: `copiar.mjs` hoje só copia para destino vazio.

  Decisão do Rafael.
- [ ] **Job de CI `api`:** commit `a7deff0` pronto em `C:\Users\rafae\lotti-api-ci`
  (só `.github/workflows/security.yml`). O push direto na `feat/api-lotti-fundacao`
  foi recusado em 2026-10-05: o token da conta do dono no gh não tem o escopo
  `workflow`. Falta o Rafael rodar `gh auth refresh -h github.com -s workflow`; depois
  o Claude sobe o job direto, sem PR.
- [ ] **Senha do banco do Supabase / `DATABASE_URL`.** Necessária se algum módulo da
  API precisar falar com a produção antes da virada.
- [ ] **E-mail da conta na plataforma**, para o canal sandbox do teste do agente.
- [ ] **Job de CI `api` no GitHub.** O token local não tem escopo `workflow`;
  adicionar pela conta do dono (conteúdo no plano da Etapa 1, Task 7).
- [ ] **Desligar a Vercel** a partir de 2026-10-11, se o front no Railway seguir
  estável.

## Técnicas (Claude/Codex)

- [ ] **A API aponta para a CÓPIA do banco (Railway), não para a produção.** Nada de
  tráfego real (front, agente) na API antes da virada. Na virada: refazer a cópia
  (`api/scripts/dados/copiar.mjs`) e trocar quem aponta para onde.
- [ ] **`VITE_API_URL` no front** (botão "Confirmar visita" e módulos da fase 4): só
  ligar quando a API apontar para o banco real.
- [ ] **Teste de ponta a ponta das visitas**, incluindo o gestor criando visita na
  agenda de outro corretor (a policy pode barrar).
- [ ] **Policy "Corretor gerencia imoveis" é `TO PUBLIC`** e chama
  `get_corretor_id()`, que `anon` não executa. A leitura pública de imóveis
  anunciados nunca funciona pela API do Supabase. Corrigir com migration
  (`TO authenticated`).
- [ ] **Virada da Parte 2 (WhatsApp no Railway).** `AGENT_WORKER_ENABLED=false` no
  Railway até lá. Checklist da virada com o Codex.
- [x] ~~**30 conversas esperando resposta da IA desde 2026-09-26.**~~ Resolvido sem
  ação em 2026-10-04. As 30 são de canais sandbox **desligados e arquivados**, e estão
  arquivadas também, então não aparecem no Inbox. O `lotti_agent_claim` só pega conversa
  de canal com `enabled`, então o worker nunca vai respondê-las. O script
  `lotti-inventarios\08-neutralizar-fila.sql` **não precisa rodar**. A única real
  (`1be72072-…`) está em modo `human` e também não é tocada pelo agente.
- [ ] **WhatsApp sem nenhuma mensagem desde 2026-10-02 19:36 UTC** (última `in` e
  `out`). O Codex não tem SSH da VPS para conferir a sessão. Conferir pela tela do
  WhatsApp no app (status da conexão) ou com uma mensagem de outro celular.
- [ ] **PRs #21 e #22 do runtime prontos:** mesclam limpo com a `main` (Codex,
  2026-10-04: 157/157 e 162/162). Origens no Railway (`lotti-inventarios\07`):
  - Um merge na `main` reconstrói só o `evolution` do Railway. Conferido nos logs: é a
    instância de teste `lotti-railway-test`, sem WhatsApp conectado. Inofensivo.
  - `agent`, `webhook-proxy` e `evolution-agent-proxy` são buildados de
    `claude/webhook-direto`. **Não apagar essa branch ao mesclar.** Trocar esses
    serviços para a `main` só na virada.
- [x] ~~**Domínio `api.plataformalotti.com.br`.**~~ Ativo desde 2026-10-05, com
  certificado válido. `/api/health` responde 200 e `/api/notificacoes` sem login
  responde 401 (conferido). Na virada, os webhooks externos (Asaas, Google) passam a
  apontar para este domínio, nunca para o `*.up.railway.app`.
- [ ] **Backup da produção (Supabase).** O PITR do Supabase custa ~US$100/mês (7 dias)
  e o Supabase sai na virada, então não vale. Falta conferir o plano no Billing; a lista
  de backups vazia sugere o gratuito. Até a virada, a proteção é a cópia da produção no
  Postgres do Railway, que já tem backups. Refazer essa cópia quando precisar.
- [ ] **Limpeza do Railway depois da virada.** Ficam: `casa-mente-contrato`, `api`,
  `Postgres`, `Redis`, `agent`, `evolution`, `evolution-db` e `evolution-redis`. Saem:
  - `n8n`: tinha 0 fluxos. **Parado em 2026-10-05** (deployment removido, serviço e
    `n8n-volume` preservados). Falta apagar depois da virada.
  - `webhook-proxy`: o PR #21 manda a Evolution direto ao `agent`.
  - `evolution-agent-proxy`: só contorna o CORS da Evolution. Sai com o PR
    Lotti-ADM/n8n-agent-lotti#23 (rascunho, revisado pelo Claude em 2026-10-05: todas
    as chamadas à Evolution passam pelo helper; 164 testes). Na virada, preencher
    `EVOLUTION_ORIGIN` no `agent` e apontar `EVOLUTION_URL` direto para a Evolution.
  - Volumes soltos `redis-volume` (308 MB) e `postgres-volume` (vazio).
- [ ] **PRs abertos:**
  - Lotti-ADM/casa-mente-contrato#51 (API, rascunho);
  - Lotti-ADM/n8n-agent-lotti#20, #21 e #22 (proxies, webhook direto, visitas).
- [ ] **Índices duplicados em `alertas`.** `idx_alertas_corretor_lido` e
  `idx_alertas_corretor_nao_lidos` têm as mesmas colunas: um só custa escrita.
  Apagar um com migration.
- [ ] **Fase 4 fica "desligada" no front até a virada.** Os módulos novos (sino,
  visitas…) só passam a valer com `VITE_API_URL`. Na virada: ligar a variável e
  conferir o sino ao vivo (SSE) com um alerta real.
- [ ] **`VITE_API_URL` só com banco único** (contrato do módulo 2, §4.0 e §5.4). Antes
  de ligar em qualquer build, fazer a conferência de banco único: um "mover" pela API
  e a leitura do mesmo negócio pelo PostgREST precisam devolver o mesmo `updated_at`.
  Hoje dá diferente de propósito, porque a API aponta para a cópia.
- [ ] **Onda 2 (contratos, financeiro/Asaas e rotina/Google), entregue em `ce18dfd`.**
  Contratos das etapas em `docs/superpowers/specs/2026-10-05-api-lotti-*-contrato.md`.
  No Railway, todas as rotas novas respondem e recusam sem login (401). Falta:
  - **Variáveis no serviço `api` do Railway.** `GEMINI_API_KEY` ligada em 2026-10-05,
    por referência ao serviço `agent`. Faltam as do Asaas e do Google. **O Supabase
    não devolve o valor de um secret** (só nome e digest), então elas não podem ser
    copiadas de lá. Medido na produção em 2026-10-05, o que isso custa:
    - `ASAAS_TOKEN_ENCRYPTION_KEY`: **gerar nova.** `asaas_conexao_segredos` tem
      **0 linhas**, então ela não decifra nada hoje. A única conexão existente é
      `herdada_do_ambiente`, e o módulo novo removeu de propósito a chave global:
      essa conta reconecta uma vez pela tela, com a chave da própria Asaas.
    - `ASAAS_BASE_URL` e `ASAAS_WEBHOOK_URL_BASE`: opcionais, não são segredo.
    - `GOOGLE_CALENDAR_CLIENT_ID` e `GOOGLE_CALENDAR_CLIENT_SECRET`: ficam no Google
      Cloud Console (o secret, se não aparecer, se cria de novo no mesmo cliente).
    - `GOOGLE_TOKEN_ENCRYPTION_KEY`: **gerar nova.** Ela cifra os tokens de
      `calendar_connections`, que tem **2 linhas**: as duas contas reconectam o
      Google uma vez. `external_calendars` e `calendar_watch_channels` estão vazias.
    - `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_CALENDAR_APP_REDIRECT_URL` e
      `GOOGLE_CALENDAR_WEBHOOK_URL`: URLs, não são segredo.
    - `ROUTINE_CALENDAR_MAINTAIN_ENABLED` e `ASAAS_PROCESSAR_FILA`: só na virada.
  - **Migrations propostas, nenhuma aplicada** (estão nos contratos das etapas):
    `documentos.updated_at` com gatilho e policy de equipe; `'OUTRO'` no enum
    `tipo_contrato`; colunas `modelo_ia`, `tempo_geracao_ms` e `versao` em
    `contratos`; `revoke all on public.contratos from anon`; grants de
    `reserve_contract_quota` e `finish_contract_quota` para o papel da API; índices
    de `external_calendars` e `calendar_webhook_receipts`.
  - **Na virada:** desligar o cron `routine-google-calendar-maintain` do Supabase
    antes de ligar `ROUTINE_CALENDAR_MAINTAIN_ENABLED` na API, para não existirem
    dois.
  - Revisão por lentes e fumaça com login real não foram feitas: a máquina do Rafael
    desligou no meio. A validação foi por testes (485 Jest, 69 de SQL real nos
    módulos novos, 1435 no front, builds) e pelo smoke das rotas sem login.
- [ ] **Módulo 2 (imóveis e CRM), entregue em `d062954`.** Pendências (§7.2 do
  contrato `docs/superpowers/specs/2026-10-04-api-lotti-modulo2-contrato.md`):
  - ~~**Dois defeitos de produção.**~~ **Corrigidos em 2026-10-05** com a migration
    `20261005020000_corrige_funil_e_historico`, aplicada na produção com o OK do
    Rafael e registrada em `_prisma_migrations`. Prova na produção, desfeita no fim:
    como dono, trocar o status e registrar contato funcionam, sem sobras.
    `conferir-producao` igual. Os defeitos eram:
    - trocar o status do funil de um cliente falha sempre (22P02, gatilho
      `lotti_inbox_record_legacy_stage`). Conferido: o `coalesce` do enum com
      'Sem etapa' dá erro na própria produção;
    - "Registrar contato" falha sempre: `historico_contatos` não tem policy de INSERT
      para usuário logado.
  - ~~Rodar o SQL real das rotas.~~ **Feito em 2026-10-05.** `api/test/sql-real/`
    tem 108 testes no PGlite com todas as migrations, RLS e o TenantDb real, cobrindo
    todos os métodos de imóveis, clientes e funil. Eles entram no `npm test` e no CI.
    O que apareceu:
    - no Postgres 18 (o do Railway), apagar imóvel ou cliente com contrato dá 23001,
      não 23503, e a rota responderia 500. Corrigido nos três tradutores (409, como
      no contrato);
    - o membro que só lê o funil recebe 422 `etapa_invalida`, e não 409, ao mover.
      Nada é gravado; o texto do contrato foi corrigido;
    - trocar o nome entre duas etapas num mesmo salvar dá 409, porque o índice
      único não é adiável. Hoje o front ignora o erro.

    Ainda falta a fumaça com login real (§5.3), que precisa do token de uma conta.
  - Na venda, o `webhook_logs` falha sempre (coluna `endpoint_url` não existe e não
    há policy). Falta decidir o destino do evento de conversão (UTMify).
  - O SeletorImovel oferece o tipo RURAL, que não existe no enum.
  - O GerenciarEtapas não cria nem remove etapa de verdade.
  - Excluir negócios não avisa quando dá erro (falta `onError`).
  - Juntar os três `*.erros.ts` e as declarações de `FORMATO_UUID` num arquivo só.
  - Paginação no lugar do teto de 1000 por lista.
  - A virada depende de zerar a §7.1 do contrato: tudo o que ainda lê ou grava
    imóveis e clientes pelo Supabase.
- [ ] **Achado de segurança, anterior à migração:** `anon` e `authenticated` podiam
  executar todas as funções novas por padrão (default privileges do Supabase dão
  EXECUTE). Medido na produção em 2026-10-04: o `anon` executa 44 das 217 funções de
  `public`, 25 delas SECURITY DEFINER. Dessas 25, 18 são de gatilho (não dá para chamar
  direto) e 7 dão para chamar: `estornar_pagamento_fatura`, `registrar_atividade` e
  `lotti_inbox_event_actor` conferem identidade por dentro; `is_organization_member`,
  `is_organization_manager`, `fachada_esta_ativa` e `public_fachada_active` só devolvem
  booleano. **Gravidade baixa.** Correção: migration que revoga EXECUTE do `anon` em
  tudo, menos nas funções usadas por policies que o `anon` atravessa (fachada/imóvel
  público), e ajusta os default privileges para funções novas.
- [ ] **Virada: endereços cadastrados fora do sistema** (inventário do Codex em
  `lotti-inventarios\02-edge-functions.md`, conferido):
  - Asaas (aluguel): 1 conexão só, herdada, **sem webhook próprio**. Trocar 1 URL no
    painel do Asaas (`…supabase.co/functions/v1/asaas-webhook` → API).
  - Google OAuth: o Google conhece `app.plataformalotti.com.br/google-agenda/callback`,
    e o Caddy repassa ao Supabase. Na virada, trocar só o destino no `Caddyfile`; não
    mexer no Google Cloud.
  - Google Calendar push: `GOOGLE_CALENDAR_WEBHOOK_URL`; o cron renova os canais a cada
    30 min e pega a URL nova sozinho.
  - QR das fachadas: apontam para `app…/p/<id>` (domínio do front). Nada a trocar.
  - Link de captação em `ImovelDetalhes.tsx:224,424` mostra a URL do **Supabase**
    (`/functions/v1/lead-capture`), que pode ter sido colada em sites e anúncios.
    Passar a exibir uma URL no nosso domínio (rota no Caddy) **já**, para os links
    novos sobreviverem à virada. O arquivo é do módulo de imóveis: fazer depois do
    fluxo da fase 4.
- [ ] **Checklist da virada do WhatsApp** (`lotti-inventarios\06-virada-whatsapp.md`):
  faltam (1) o `agent` do Railway ser buildado do código dos PRs #21/#22 do runtime,
  não de `codex/railway-proxy-fixes`; (2) as flags `AGENT_WORKER_ENABLED` e
  `CATCHUP_ENABLED`, com um consumidor só; (3) criar antes da janela os domínios
  `bridge`/`evolution` no Railway e os TXT de verificação. Se o hostname continuar
  `bridge.plataformalotti.com.br`, o secret `LOTTI_CHANNEL_BRIDGE_URL` não muda.
- [ ] **Fase 5 (login e arquivos) é pequena:** 3 usuários, todos por e-mail; Storage
  com 89 objetos e ~85 MiB (80 MiB em `imoveis-fotos`).

## Resolvidas

- ~~TRUNCATE/REFERENCES/TRIGGER/MAINTAIN para anon e authenticated~~: migration
  `20261004220000_menor_privilegio_papeis_publicos`, aplicada em 2026-10-04.

## Resolvidas (continuação)

- ~~**`anon` com escrita em 64 objetos de `public`**~~ (INSERT/UPDATE/DELETE em
  `user_roles`, `admin_config`, `plans`, `corretores`, `clientes`, `contratos`,
  `faturas_aluguel` e outras). O RLS segurava quase tudo, mas bastava uma policy nova
  permissiva para virar escrita real, e os default privileges faziam **toda tabela nova
  nascer assim**. Migration `20261005140000_anon_sem_escrita`, aplicada na produção em
  2026-10-05: 161 permissões de escrita → **0**. Continuam intactas a leitura do `anon`
  (72), a escrita do `authenticated` (177) e o `service_role`. As duas escritas públicas
  de verdade (lead e escaneamento da fachada) foram preservadas e testadas.
  Sobraram 17 default privileges do `supabase_admin` e de outros esquemas (`storage`,
  `graphql`), que o papel `postgres` não pode alterar: só a Supabase mexe neles.
