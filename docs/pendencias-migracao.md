# Pendências da migração para a arquitetura do Clix

Lista viva: toda decisão adiada ou ponto em aberto entra aqui. Quem resolver risca
(`~~item~~`) e anota a data. Atualizada em 2026-10-04.

## Do Rafael (decisão ou acesso)

- [ ] **Ativar o backup (PITR) do Postgres do Railway antes da virada.** Hoje está
  desligado (`railway postgres pitr status --service Postgres`). Pode ter custo no
  plano. Para o ensaio não é necessário; antes da virada é obrigatório. Comando:
  `railway postgres pitr enable --service Postgres`.
- [ ] **Pedido ao suporte do Supabase** (linhas apagadas em 2026-10-02): confirmar se
  foi enviado (`pedido-suporte-supabase.md`). Até a resposta, o autovacuum segue
  **pausado** em `contratos`, `clientes`, `cliente_imovel` e `historico_contatos`.
  Não religar antes.
- [ ] **Produção (Supabase) sem backup restaurável.** A lista de backups está vazia
  e o PITR desligado. Avaliar ativar no Supabase até a virada.
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
- [ ] **30 conversas esperando resposta da IA desde 2026-09-26**: investigar.
- [ ] **Volumes soltos no Railway** (`redis-volume` com 308 MB, `postgres-volume`
  vazio): apagar depois da virada.
- [ ] **PRs abertos:**
  - Lotti-ADM/casa-mente-contrato#51 (API, rascunho);
  - Lotti-ADM/n8n-agent-lotti#20, #21 e #22 (proxies, webhook direto, visitas).
- [ ] **Índices duplicados em `alertas`.** `idx_alertas_corretor_lido` e
  `idx_alertas_corretor_nao_lidos` têm as mesmas colunas: um só custa escrita.
  Apagar um com migration.
- [ ] **Fase 4 fica "desligada" no front até a virada.** Os módulos novos (sino,
  visitas…) só passam a valer com `VITE_API_URL`. Na virada: ligar a variável e
  conferir o sino ao vivo (SSE) com um alerta real.
- [ ] **Achado de segurança, anterior à migração:** `anon` e `authenticated` podiam
  executar todas as funções novas por padrão (default privileges do Supabase dão
  EXECUTE). Revisar quais funções o `anon` realmente precisa.

## Resolvidas

- ~~TRUNCATE/REFERENCES/TRIGGER/MAINTAIN para anon e authenticated~~: migration
  `20261004220000_menor_privilegio_papeis_publicos`, aplicada em 2026-10-04.
