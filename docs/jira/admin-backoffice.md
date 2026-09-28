# Back office administrativo — SCRUM-26 a SCRUM-29

- **Data:** 2026-09-27 · **Base:** `main` em `052327d` · **Responsável pela verificação:** Claude
- **Método:** leitura do código e das migrations, testes locais (Vitest + PGlite). Nenhuma
  chamada ao Supabase de produção foi feita e nenhum código de produção foi alterado.
- **Arquivo de teste novo:** `supabase/migrations/admin-backoffice-authz.test.ts` (99 testes:
  92 passam como regressão e **7 falham de propósito**, marcados `[LACUNA ...]`, para demonstrar
  as brechas descritas abaixo. Eles devem ficar verdes quando a correção for aplicada).

| Tarefa | Status | Pendência principal |
|---|---|---|
| SCRUM-26 Rota administrativa | Concluído | Recomendado: teste de componente permanente para o `AdminRoute` |
| SCRUM-27 Endpoint administrativo | Parcial | 4 helpers `SECURITY DEFINER` sem guard executáveis por `authenticated` e `anon` |
| SCRUM-28 Contas, planos e status | Parcial | Rótulos e fontes divergentes, MRR por preço de tabela, validação em produção |
| SCRUM-29 Histórico de auditoria | Parcial | 5 caminhos de alteração administrativa não gravam em `admin_auditoria` |

## Validações executadas

```bash
# Suítes existentes ligadas ao back office e à sessão: 10 arquivos, 123 testes, todos passando
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key \
  npx vitest run src/lib/admin src/lib/auth src/pages/Auth.visual.test.tsx

# Novo teste PGlite (8 migrations reais do back office): 92 passam, 7 falham de propósito
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key \
  npx vitest run supabase/migrations/admin-backoffice-authz.test.ts
```

Detalhe das suítes existentes: `permissoes.test.ts` 16, `saas.test.ts` 19, `comissao.test.ts` 25,
`periodo.test.ts` 23, `csv.test.ts` 12, `isolamentoSessao.test.ts` 3, `Auth.visual.test.tsx` 4, demais
de `src/lib/auth` 21. Não havia teste PGlite para as RPCs administrativas. O único teste de banco
anterior, `supabase/tests/admin_rls.sql`, é manual (roda no SQL Editor) e não foi executado aqui.

Também rodei, **de forma temporária e sem versionar**, 6 testes de componente do `AdminRoute`
(renderização com `useAuth`/`usePapeis` simulados). Todos passaram e o arquivo foi apagado.

---

## SCRUM-26 — Bloquear rota administrativa para usuário comum

### Rotas e guard

- As rotas `/admin`, `/admin/usuarios`, `/admin/usuarios/:id`, `/admin/onboarding`, `/admin/parceiros`,
  `/admin/parceiros/:id`, `/admin/assinaturas`, `/admin/pagamentos`, `/admin/cancelamentos`,
  `/admin/comissoes`, `/admin/repasses`, `/admin/campanha`, `/admin/integracoes`, `/admin/receita` e
  `/admin/auditoria` ficam sob `<AdminRoute><AdminLayout/></AdminRoute>` em `src/App.tsx:193-215`.
  `/admin/configuracoes` usa `<AdminRoute recurso="configuracoes">`, que exige `super_admin`
  (`src/App.tsx:219-227`).
- As páginas são carregadas sob demanda (`lazy`, `src/App.tsx:77-92`). Só são baixadas quando o
  guard libera o `Outlet`. O `AdminLayout` e o `AdminRoute` entram no bundle principal
  (`src/App.tsx:14-15`), mas não carregam dados.
- O guard está em `src/components/admin/AdminRoute.tsx:21-65`:
  1. sessão ou papéis carregando: mostra "Verificando acesso..." (`:26-35`);
  2. sem sessão: `Navigate` para `/auth`, guardando o destino (`:40-42`);
  3. migrations ausentes: tela de diagnóstico (`:49-51`);
  4. **sem papel administrativo: `Navigate` para `/`** (`:56-58`);
  5. recurso não permitido ao papel: `Navigate` para `/admin` (`:60-62`).

### De onde vem o papel

O papel é **verificado no servidor**, não guardado no cliente:

- `usePapeis` chama a RPC `meus_papeis` (`src/hooks/admin/usePapeis.ts:45-54`). Qualquer erro vira
  lista vazia, ou seja, o guard fecha em caso de falha (`:56-60`).
- `meus_papeis()` é `SECURITY DEFINER` e devolve só os papéis ativos de `auth.uid()`
  (`supabase/migrations/20260814100000_admin_papeis_auditoria.sql:112-124`).
- `ehAdmin` só aceita `admin` e `super_admin` (`src/lib/admin/permissoes.ts:109-117`). Papéis
  desconhecidos são descartados.
- A troca de usuário limpa todo o cache do React Query, inclusive a chave `['admin','papeis']`
  (`src/lib/auth/isolamentoSessao.ts:13-25`, chamado em `src/hooks/useAuth.tsx:107`). Assim, o
  papel de um admin anterior não fica valendo para o próximo usuário do mesmo navegador.
- O guard cuida só da navegação. Se alguém forçar a renderização no cliente, todas as RPCs e
  tabelas continuam recusando o acesso (ver SCRUM-27).

### O que o usuário comum vê

Ao digitar `/admin`, vê o spinner "Verificando acesso..." e é redirecionado para `/` sem nenhuma
mensagem. A escolha é proposital, para não confirmar que a área existe (`AdminRoute.tsx:53-55`).
O back office não aparece na barra lateral (`src/components/layout/AppSidebar.tsx:44-55`). O link
"Acesso administrativo" também saiu da tela de login, e há teste garantindo isso
(`src/pages/Auth.visual.test.tsx:62`).

### Testes

- `src/lib/admin/permissoes.test.ts`: 16 testes, incluindo "sem papel, sem back office", "papel
  desconhecido não vira acesso" e "usuário sem papel não acessa nem a visão geral". Todos passaram.
- `admin-backoffice-authz.test.ts:204`: `meus_papeis` devolve `[]` para usuário comum e para anon,
  `['admin']` e `['super_admin']` para os papéis administrativos. Passou.
- A verificação temporária do `AdminRoute` confirmou que usuário comum, visitante sem sessão e papel
  desconhecido não renderizam o painel. Confirmou também que `admin` não abre `configuracoes` e que
  `super_admin` abre.

### Observações (não bloqueiam)

- Quando as migrations não estão aplicadas, **qualquer usuário autenticado**, inclusive comum, vê a
  tela "Back office ainda não instalado", com o SQL de `promover_primeiro_super_admin`
  (`AdminRoute.tsx:49-51, 73-145`). A função não pode ser executada por `anon`/`authenticated`
  (`20260814100000:364`, testado), mas a tela revela que `/admin` existe.
- `docs/BACKOFFICE.md:25-26` ainda diz que o item "Back office" aparece na barra lateral. O código
  diz o contrário (`AppSidebar.tsx:45`).
- Não existe teste permanente do componente `AdminRoute`, apenas das funções puras de permissão.

Status: Concluído

---

## SCRUM-27 — Bloquear endpoint administrativo para usuário comum

### Modelo de autorização

- Papéis ficam em `user_roles`. `is_admin()` e `is_super_admin()` são `SECURITY DEFINER` e checam
  `auth.uid()` com `revogado_em IS NULL` (`20260814100000:78-104`).
- Toda RPC administrativa é `SECURITY DEFINER` e começa com `PERFORM exigir_admin()` ou
  `exigir_super_admin()`, que levantam `42501 acesso negado`
  (`20260814140000_admin_rpcs.sql:24-48`). O `EXECUTE` fica aberto a `authenticated` de propósito,
  e o guard interno decide (`20260814140000:917-939`, `20260901160100:416-419`,
  `20260901160200:805-817`).
- As tabelas do back office têm RLS `is_admin()` na leitura e escrita restrita (detalhes abaixo).
- **Não há Edge Function administrativa.** `parceiro-clique` e `parceiro-atribuir` são públicas ou
  do usuário, usam service role, gravam só clique e atribuição, e devolvem apenas o nome do parceiro
  (`supabase/functions/parceiro-clique/index.ts:149-151`). Nenhuma função em `supabase/functions`
  referencia `is_admin`, `user_roles` ou `admin_*`.

### Inventário de RPCs (todas verificadas no PGlite)

| RPC | Guard | Evidência |
|---|---|---|
| `admin_metricas_visao_geral`, `admin_listar_usuarios`, `admin_detalhe_usuario`, `admin_listar_auditoria`, `admin_listar_parceiros`, `admin_listar_comissoes`, `admin_listar_receita` | admin | `20260814140000:72, 186, 347, 440, 488, 671, 823` |
| `admin_definir_status_corretor`, `admin_definir_percentual` | admin | `20260814140000:291, 546` |
| `admin_transicionar_comissao` | admin; `paga`/`estornada` exigem super_admin | `20260814140000:595-600` |
| `admin_registrar_receita`, `admin_estornar_receita`, `admin_registrar_pagamento` | super_admin | `20260814140000:726, 772, 868` |
| `admin_metricas_saas`, `admin_listar_assinaturas`, `admin_listar_pagamentos` | admin | `20260901160100:76, 242, 330` |
| `admin_registrar_cancelamento`, `admin_listar_cancelamentos`, `admin_metricas_cancelamento`, `admin_parceiros_elegiveis_repasse`, `admin_gerar_lote_repasse`, `admin_listar_lotes`, `admin_detalhe_lote`, `admin_marcar_lote_exportado`, `admin_listar_config`, `admin_status_integracoes` | admin | `20260901160200:36, 114, 174, 233, 300, 396, 435, 484, 694, 725` |
| `admin_marcar_lote_pago`, `admin_cancelar_lote`, `admin_salvar_config` | super_admin | `20260901160200:520, 614, 664` |
| `registrar_auditoria_admin` | admin | `20260814100000:215-217` |
| `admin_onboarding_metricas` | admin (`is_admin()` inline); `REVOKE` de PUBLIC/anon | `20260821130000_onboarding_ativacao.sql:978, 1025` (verificação estática, não carregada no PGlite) |
| `promover_primeiro_super_admin` | sem EXECUTE para anon/authenticated | `20260814100000:364` |

Resultado no PGlite (`admin-backoffice-authz.test.ts:221-243`):

- usuário comum recebe `acesso negado` nas **30** RPCs chamadas pelo front;
- `anon` é recusado nas 30;
- `admin` operacional recebe `42501` nas 7 ações de `super_admin`;
- `admin` consegue listar usuários;
- o bootstrap de `super_admin` dá `permission denied` para `anon` e `authenticated`.

Um teste de catálogo (`:211`) falha se aparecer uma nova função `admin_*` `SECURITY DEFINER` fora
da lista testada.

### Tabelas (RLS e GRANT)

| Tabela | Leitura | Escrita por `authenticated` | Evidência |
|---|---|---|---|
| `user_roles` | admin | INSERT/UPDATE só super_admin; DELETE revogado | `20260814100000:129-148` |
| `admin_auditoria` | admin | INSERT/UPDATE/DELETE revogados; trigger append-only | `:179-197` |
| `admin_config` | admin | UPDATE super_admin (policy direta) | `20260814110000:104-116` |
| `atividade_eventos` | a própria linha ou admin | revogada; grava via `registrar_atividade` | `20260814110000:37-46` |
| `parceiros`, `parceiro_links` | admin | INSERT/UPDATE admin; DELETE revogado | `20260814120000:179-224` |
| `parceiro_percentuais` | admin | INSERT admin | `20260814120000:195-205` |
| `parceiro_cliques`, `parceiro_atribuicoes` | admin | revogada (só service role) | `20260814120000:226-238` |
| `receita_eventos` | admin | INSERT/UPDATE super_admin | `20260814130000:133-150` |
| `parceiro_comissoes`, `parceiro_pagamentos` | admin | revogada | `20260814130000:152-164` |
| `parceiro_lotes`, `parceiro_lote_itens`, `cancelamento_feedback` | admin | `REVOKE ALL` + `GRANT SELECT` | `20260901160000:202-224` |

No PGlite, com dados semeados em todas as 15 tabelas, o usuário comum lê **0 linhas** de cada uma
(`:246`). Ele também não consegue:

- se promover em `user_roles`;
- criar parceiro;
- inserir auditoria;
- alterar comissão;
- apagar papel;
- alterar `admin_config`;
- mudar o próprio `corretores.status`, bloqueado pela trigger `proteger_status_corretor`
  (`20260814100000:295-316`).

Todos esses testes passaram (`:253-268`).

### Lacuna: helpers `SECURITY DEFINER` sem guard (falham em `:309-328`)

As quatro funções abaixo rodam como dono do banco, **contornam a RLS** e não têm guard. Elas nunca
passam por `REVOKE ... FROM PUBLIC`, então o `EXECUTE` padrão do Postgres/Supabase alcança
`authenticated` **e também `anon`** (confirmado no PGlite). No Supabase, isso significa que podem
ser chamadas por `POST /rest/v1/rpc/<nome>` usando só a chave pública.

| Função | O que vaza | Evidência |
|---|---|---|
| `admin_config_texto(_chave, _padrao)` / `admin_config_int` | Qualquer chave de `admin_config`, apesar da policy "admin le". O teste obteve `programa_comissao_padrao = 10` e `programa_saldo_minimo = 50` como usuário comum, além de `portal_publicado` como anon. | `20260814110000:133-157`; GRANT em `20260814140000:936-937` |
| `percentual_vigente_em(_parceiro_id, _data)` | A linha inteira da vigência: percentual, base, valor fixo, **motivo** e `criado_por`. O teste obteve `12.50` e o motivo "acordo comercial confidencial". Isso contraria `parceiro-clique/index.ts:150` ("percentual jamais sai daqui"). | `20260814120000:269-286`; GRANT em `20260814140000:939` |
| `has_role(_user_id, _role)` | Confirma se qualquer `user_id` é admin ou super_admin, justamente o que o comentário de `meus_papeis` diz evitar (`20260814100000:110-111`). | `20260814100000:64-75, 106` |

**Severidade: baixa.** Nenhuma ação administrativa pode ser executada. `percentual_vigente_em` e
`has_role` exigem conhecer um UUID, embora `user_id` de colegas de organização possa ser visível.
Hoje `admin_config` guarda só parâmetros do programa. Mesmo assim, as três quebram o contrato
documentado em `docs/BACKOFFICE.md:61-63`, que afirma "toda função `admin_*` começa com
`exigir_admin()`".

**Correção sugerida** (não aplicada): `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated`
nos quatro helpers. Eles só são usados dentro de outras funções `SECURITY DEFINER` e da trigger
`gerar_comissao_de_receita`, que rodam como dono do banco, então nada quebra. Depois, remover os
`GRANT` de `20260814140000:936-939`.

### Achado relacionado (fora do escopo estrito, já coberto por outra tarefa)

A policy `subscriptions_org_manage` é `FOR ALL` para o gestor da própria organização
(`20260821130000_onboarding_ativacao.sql:275-284`), e nenhuma migration revoga
`UPDATE`/`INSERT` em `subscriptions` de `authenticated`. Com isso, o dono da conta consegue trocar
o próprio `plan_id` ou `status` por chamada direta à API. É o dado que o back office mostra como
"plano" e "status" (SCRUM-28). O caso já está demonstrado em
`supabase/migrations/planos-cota-servidor.test.ts:247` (SCRUM-19/20). O front só lê essa tabela
(`src/hooks/useSubscription.ts:63-68`).

Status: Parcial — falta restringir `admin_config_texto`, `admin_config_int`, `percentual_vigente_em` e `has_role` (REVOKE de PUBLIC/anon/authenticated) e deixar verdes os 3 testes `[LACUNA SCRUM-27]`

---

## SCRUM-28 — Conferir exibição de contas, planos e status no backoffice

### Onde cada tela busca os dados

| Tela | Fonte | Campos exibidos |
|---|---|---|
| Visão geral (`AdminVisaoGeral.tsx`) | `admin_metricas_visao_geral` (`20260814140000:51-157`) | Contas: total, novas, ativas, inativas, sem dados e suspensas. Assinaturas por status em `subscriptions`. Receita e parceiros. |
| Usuários (`AdminUsuarios.tsx:202-255`) | `admin_listar_usuarios` (`20260814140000:160-275`) | Tabela com nome, contato, status da conta, atividade, cadastro e parceiro. O CSV (`:75-86`) inclui também CRECI, plano, clientes e imóveis. |
| Detalhe do usuário (`AdminUsuarioDetalhe.tsx:147-148, 231-232`) | `admin_detalhe_usuario` (`20260814140000:336-417`) | Status da conta, plano e status da assinatura. |
| Assinaturas (`AdminAssinaturas.tsx`) | `admin_metricas_saas` e `admin_listar_assinaturas` (`20260901160100:50-302`) | Conta, e-mail, plano (nome), ciclo, status, valor/mês, próxima cobrança; cards de MRR, ativas e trials. |
| Pagamentos | `admin_listar_pagamentos` (`checkout_orders`) | Pagador, plano (código), método, valor, status. |

Há dois conceitos diferentes de "status":

- **status da conta:** `corretores.status`, com valores `ativo`, `suspenso` e `inativo`
  (`20260814100000:231-253`);
- **status da assinatura:** `subscriptions.status`, com valores `trialing`, `active`, `past_due`,
  `canceled`, `expired` e `read_only` (`20260807120000_plans_subscriptions.sql:61-68`).

A suspensão da conta vale no backend porque `get_corretor_id()` exige `c.status = 'ativo'`
(`20260831140000_asaas_conta_por_inquilino.sql:109-127`). Na versão intermediária
`20260821130000:194-201`, essa exigência tinha caído. A versão final restaura a checagem quando
`onboarding_profiles` existe.

### Inconsistências encontradas

1. **Rótulos divergentes para o mesmo status.**
   - `past_due` aparece como "Vencida" em `src/lib/admin/saas.ts:23` e como "Em atraso" em
     `AdminVisaoGeral.tsx:19`.
   - O status da conta aparece cru, em minúsculas (`ativo`/`suspenso`), em `AdminUsuarios.tsx:233`
     e `AdminUsuarioDetalhe.tsx:148`. O CSV exporta o valor cru (`AdminUsuarios.tsx:79`).
   - O status da assinatura no detalhe aparece cru (`active`, `trialing`) em
     `AdminUsuarioDetalhe.tsx:232`.
2. **Plano e status da assinatura ausentes na lista de usuários.** O RPC devolve `plano_nome` e
   `assinatura_status` (`src/integrations/supabase/admin-types.ts:40-41`). A tabela não mostra
   nenhum dos dois, e o CSV traz só o plano. O detalhe recebe ciclo, período e fim do trial
   (`20260814140000:377-381`), mas mostra apenas plano e status.
3. **"Inativo" com dois significados.** Na mesma tela, "inativo" pode ser o status da conta ou a
   classe de atividade (`AdminUsuarios.tsx:135-137` contra `:152-154`). Contas com
   `status = 'inativo'` também não entram em nenhum card da visão geral: só o total as inclui
   (`20260814140000:100-103`).
4. **Nome e código do plano misturados.**
   - Usuários e Assinaturas exibem `plans.name`, hoje "Lotti Inteligente", "Lotti Profissional" e
     "Lotti Eficazes" (`20260909180000_planos_agente_ia.sql:5-13`).
   - Cancelamentos grava e exibe `plans.code`, como `essencial`
     (`20260901160200:61`, `AdminCancelamentos.tsx:272`).
   - Pagamentos exibe `checkout_orders.plan_code`.
5. **MRR e "Valor/mês" calculados pelo preço de tabela atual**
   (`plans.monthly_price`/`annual_price`, `20260901160100:95-102, 277`), e não pelo valor
   contratado. Os preços foram reajustados duas vezes (`20260820100000_planos_v2.sql:32-45`,
   `20260909180000:5-13`), e a migration diz que "não altera cobranças ou contratos já emitidos no
   Asaas". Com isso, o MRR de clientes antigos fica superestimado e não concilia com
   `checkout_orders.amount`.
6. **Uma linha por assinatura, não por conta.** `admin_listar_assinaturas` faz `JOIN` sem
   deduplicar (`20260901160100:289-298`). Uma conta com uma assinatura cancelada e uma ativa
   aparece duas vezes. Já `admin_listar_usuarios` escolhe a vigente por `LATERAL ... LIMIT 1`
   (`20260814140000:234-241`), e `admin_registrar_cancelamento` escolhe por `updated_at DESC`
   (`20260901160200:61-66`). São três critérios diferentes para "o plano da conta".
7. **Falta de guarda para tabelas ausentes.**
   - As RPCs de agosto (`admin_metricas_visao_geral`, `admin_listar_usuarios`,
     `admin_detalhe_usuario`) consultam `subscriptions`/`plans` sem `to_regclass`, ao contrário das
     RPCs SaaS de setembro.
   - Se as tabelas não existirem, o erro `relation ... does not exist` cai na regex de
     `src/lib/admin/api.ts:51-56` e vira `BackOfficeNaoInstaladoError`. A tela passa a dizer que
     "as migrations do back office" não foram aplicadas, quando o que falta é
     `20260807120000_plans_subscriptions.sql`.
   - O cabeçalho de `20260901160100:10-13` registra que, em 2026-09-02, `plans`, `subscriptions` e
     `checkout_orders` estavam ausentes em produção.
8. **O dado exibido pode ter sido alterado pelo próprio cliente.** O dono da conta consegue
   alterar `subscriptions.plan_id`/`status` por API (ver achado relacionado em SCRUM-27), e o back
   office mostraria o valor adulterado como verdadeiro.

### Não verificado

O estado real do banco de produção (tabelas existentes, contagens, se os números da tela batem com
o Asaas) não foi verificado. A regra desta tarefa proíbe chamadas à produção.

Status: Parcial — falta unificar rótulos de status e nome de plano, exibir plano e status da assinatura na lista e no detalhe, calcular MRR pelo valor contratado, deduplicar assinaturas por conta, proteger as RPCs de agosto com `to_regclass`, e conferir em produção (com acesso autorizado) se `plans`, `subscriptions` e `checkout_orders` existem e batem com o Asaas

---

## SCRUM-29 — Registrar alterações administrativas no histórico de auditoria

### Como a trilha funciona

- Fica na tabela `admin_auditoria`, com ator, ação, entidade, antes/depois e motivo
  (`20260814100000:154-166`).
- É append-only: `REVOKE` de escrita (`:188`) e trigger que bloqueia UPDATE e DELETE até para o
  dono do banco (`:190-197`). O teste `:296` passou.
- A gravação é feita **dentro da própria RPC**, na mesma transação da alteração. Por isso a ação
  não acontece sem registro, e vice-versa.
- A leitura é feita por `admin_listar_auditoria` (admin) na tela `AdminAuditoria.tsx`.

### O que grava auditoria

| Ação | Registro | Evidência |
|---|---|---|
| Suspender/reativar conta | `definir_status_corretor`, antes/depois e motivo obrigatório | `20260814140000:324-330`, teste `:271` |
| Nova vigência de percentual | `definir_percentual` | `20260814140000:568-575` |
| Transição de comissão | `transicionar_comissao` | `20260814140000:638-644` |
| Registrar/estornar receita | `registrar_receita` / `estornar_receita` | `20260814140000:750-755, 793-798` |
| Pagamento de comissões | `registrar_pagamento` | `20260814140000:906-912` |
| Bootstrap do 1º super_admin | `conceder_papel` | `20260814100000:356-359` |
| Registrar cancelamento | `registrar_cancelamento`, sem o comentário do cliente | `20260901160200:79-88`, teste `:284` |
| Gerar lote de repasse | `gerar_lote_repasse` | `20260901160200:365-370` |
| Marcar lote pago / cancelar lote | `marcar_lote_pago` / `cancelar_lote` | `20260901160200:589-596, 640-646` |
| Salvar configuração via RPC (tela Campanha) | `alterar_config`, antes/depois | `20260901160200:677-681`, teste `:284` |

### O que **não** grava auditoria (falham em `:330-372`)

1. **Marcar lote como exportado.** `admin_marcar_lote_exportado` muda o status
   `rascunho → exportado` sem `INSERT` na trilha (`20260901160200:475-497`).
2. **Criar/editar parceiro e criar/revogar link.** A UI grava direto na tabela via RLS
   (`src/hooks/admin/useAdminDados.ts:203-204, 254-262, 284-286`), sem RPC e sem trigger. Os
   dados alterados incluem **chave PIX** e documento, que definem para onde vai o repasse.
3. **Tela Configurações** (`/admin/configuracoes`). Faz `UPDATE` direto em `admin_config`
   (`src/pages/admin/AdminConfiguracoes.tsx:59-61`) em vez de usar `admin_salvar_config`. As chaves
   de atribuição e da janela de atividade mudam sem trilha. A tela Campanha usa a RPC e é auditada.
4. **Conceder/revogar papel.** Não há RPC nem tela. O caminho possível é `INSERT`/`UPDATE` direto
   em `user_roles` por super_admin (`20260814100000:136-145`), sem trilha. Mesmo assim,
   `AdminAuditoria.tsx:22-23` tem rótulos para `conceder_papel` e `revogar_papel`.
5. **Escritas diretas que a RLS ainda permite e que contornam as RPCs auditadas:**
   - `receita_eventos` INSERT/UPDATE por super_admin (`20260814130000:140-147`);
   - `parceiro_percentuais` INSERT por admin (`20260814120000:201-203`).

   A UI não usa esses caminhos, mas a API aceita.

### Outros pontos

- `registrarAuditoria` (`src/lib/admin/api.ts:94-110`) **nunca é chamado**. Com isso,
  `registrar_auditoria_admin` fica sem uso no front e ainda permite que qualquer admin grave
  entradas com `acao`/`entidade`/`dados` arbitrários, ou seja, forjar registros na trilha.
- `AdminAuditoria.tsx:15-33` não tem rótulo para `registrar_cancelamento`, `gerar_lote_repasse`,
  `marcar_lote_pago`, `cancelar_lote` e `alterar_config`. O filtro de entidade (`:110-114`) não
  oferece `cancelamento_feedback`, `parceiro_lotes` nem `admin_config`, então essas ações aparecem
  com o código cru e não podem ser filtradas.
- Exportações CSV com dados pessoais (usuários, assinaturas, pagamentos, cancelamentos, comissões)
  acontecem só no cliente e não deixam registro.
- As colunas `ip_hash` e `user_agent` de `admin_auditoria` nunca são preenchidas.

### Correção sugerida (não aplicada)

- Adicionar `INSERT` em `admin_marcar_lote_exportado`.
- Levar as escritas de parceiro, link e papel para RPCs auditadas, ou criar triggers `AFTER` de
  auditoria em `parceiros`, `parceiro_links`, `user_roles`, `admin_config`, `receita_eventos` e
  `parceiro_percentuais`. As triggers cobrem qualquer caminho, inclusive a API.
- Trocar `AdminConfiguracoes.tsx` para `admin_salvar_config` e revogar o `UPDATE` direto em
  `admin_config`.
- Remover ou restringir `registrar_auditoria_admin`.
- Completar os rótulos e filtros da tela de auditoria.

Status: Parcial — falta auditar a exportação de lote, a edição de parceiros e links, o UPDATE direto em `admin_config`, a concessão e revogação de papéis e as escritas diretas em `receita_eventos`/`parceiro_percentuais`, até os 4 testes `[LACUNA SCRUM-29]` ficarem verdes. Falta também completar os rótulos e filtros de `AdminAuditoria.tsx`

## Correções aplicadas nesta branch (Claude, 2026-09-27)

- Migration `supabase/migrations/20260927090000_admin_acesso_e_auditoria.sql`:
  - SCRUM-27: `admin_config_texto`, `admin_config_int`, `percentual_vigente_em` e `has_role` sem `EXECUTE` para `PUBLIC`, `anon` e `authenticated` (continuam usadas pelas funções `SECURITY DEFINER`, que rodam como dono).
  - SCRUM-29: gatilho `auditar_escrita_direta` em `parceiros`, `parceiro_links`, `parceiro_percentuais`, `admin_config`, `user_roles` e `receita_eventos` registra na trilha toda escrita feita direto pelo painel por um admin (as RPCs, que rodam como dono, já registram a própria auditoria e não duplicam); `admin_marcar_lote_exportado` passa a registrar `exportar_lote`.
- `supabase/migrations/admin-backoffice-authz.test.ts`: as 7 lacunas viraram testes de regressão; 99/99 passam.
- Pendente: aplicar a migration em produção (com autorização) e os ajustes de exibição do SCRUM-28.
