# Back office administrativo da Lotti

Painel de operação da plataforma: usuários, parceiros comerciais, atribuição de
origem, comissões e auditoria. Vive dentro da mesma aplicação, com as mesmas
migrations e a mesma RLS — não é um app separado.

---

## 1. Como criar o primeiro administrador

Não existe admin semeado, nem credencial no código. A promoção é feita **uma
vez**, à mão, no SQL Editor do Supabase:

```sql
-- 1. A pessoa precisa ter criado a conta normalmente em /auth antes.
-- 2. Rode isto UMA vez:
SELECT public.promover_primeiro_super_admin('email-da-pessoa@exemplo.com');
```

A função recusa se já existir um `super_admin` — a partir daí, papéis são
concedidos pelo próprio painel, por quem já é super admin. Ela também está
revogada de `anon` e `authenticated`, então não é alcançável pela API: só roda
no SQL Editor, que executa como `postgres`.

Depois disso, entre normalmente em `/auth`. O item **Back office** aparece na
barra lateral, e `/admin` fica acessível.

---

## 2. Níveis de acesso

| | `admin` | `super_admin` |
|---|---|---|
| Visão geral, usuários, parceiros, comissões, receita, auditoria | ✅ | ✅ |
| Suspender / reativar conta | ✅ | ✅ |
| Criar e editar parceiro, alterar percentual, gerar e revogar link | ✅ | ✅ |
| Aprovar comissão | ✅ | ✅ |
| **Pagar e estornar comissão** | ❌ | ✅ |
| **Registrar e estornar receita** | ❌ | ✅ |
| **Conceder e revogar papéis** | ❌ | ✅ |
| **Configurações da plataforma** | ❌ | ✅ |

A divisão segue uma regra: `admin` opera, `super_admin` mexe em dinheiro que sai
e na própria hierarquia. Se um `admin` pudesse conceder papéis, ele se promoveria
e os dois níveis seriam um só.

A matriz existe em dois lugares — `src/lib/admin/permissoes.ts` (o que a
interface desenha) e as policies/guards no Postgres (o que de fato vale). A
primeira existe para não oferecer botão que o servidor recusaria.

---

## 3. Como a autorização funciona de verdade

Três camadas, e só as duas últimas são segurança:

1. **`AdminRoute`** (`src/components/admin/AdminRoute.tsx`) — navegação. Quem
   não tem papel é mandado para `/`. Isso é conveniência, não proteção.
2. **RLS** — as tabelas novas (`parceiros`, `parceiro_*`, `receita_eventos`,
   `admin_auditoria`, `user_roles`, `admin_config`) exigem `is_admin()` na
   policy. Um corretor comum que chame a API direto recebe zero linhas.
3. **Guard nas RPCs** — toda função `admin_*` começa com `PERFORM
   exigir_admin()` e levanta `42501`. É por elas que o painel lê dados de todos
   os inquilinos.

### Por que RPC e não policy nas tabelas existentes

O admin precisa ler dados de todos os corretores, e a RLS por `corretor_id`
proíbe. Havia duas saídas:

- adicionar `OR is_admin()` nas ~30 tabelas do corretor — **rejeitada**: mexeria
  em policies recém-endurecidas contra vazamento entre contas
  (`20260812090000_isolamento_multiusuario.sql`), com risco alto de regressão;
- concentrar a leitura em RPCs `SECURITY DEFINER` com guard — **escolhida**:
  superfície pequena e auditável, devolve só as colunas necessárias (menor
  privilégio, LGPD) e é o único caminho para `auth.users`.

### Suspensão de conta

`get_corretor_id()` passou a exigir `status = 'ativo'`. Como as ~30 policies do
produto comparam `corretor_id = get_corretor_id()`, um corretor suspenso recebe
`NULL` e perde acesso a **todas** as tabelas de uma vez, sem que nenhuma policy
tenha sido alterada. O corretor também não consegue reverter a própria suspensão:
a trigger `proteger_status_corretor()` bloqueia mudanças de `status` feitas por
quem não é admin.

---

## 4. Definição de "usuário ativo"

> Corretor com `status = 'ativo'` **e** `ultimo_acesso_em` dentro da janela
> configurada (padrão: **30 dias**).

Três categorias, e a terceira importa:

| Categoria | Significado |
|---|---|
| `ativo` | Teve acesso registrado dentro da janela. |
| `inativo` | Tem histórico de acesso, mas nada dentro da janela. |
| `sem_dados` | **Nunca teve acesso registrado.** |

`sem_dados` **não é** inativo. O registro de atividade nasceu com o back office;
ninguém tem histórico anterior. Contar essas contas como inativas produziria uma
métrica de retenção falsa no primeiro dia. A janela é ajustável em
**Configurações → Janela de atividade** e vale imediatamente, porque a
classificação é calculada na consulta.

O que alimenta isso: `registrar_atividade()` é chamada no `SIGNED_IN`, com
throttle de 30 minutos (`src/lib/admin/atribuicao.ts`), gravando em
`atividade_eventos` e atualizando `corretores.ultimo_acesso_em`.

---

## 5. Regra de atribuição de parceiro

**Primeiro clique, janela de 90 dias**, configurável por parceiro.

```
Dia 0   → visitante clica no link do Parceiro A   → A grava a atribuição
Dia 3   → clica no link do Parceiro B             → A permanece
Dia 12  → cria a conta                            → crédito: A
Dia 95  → cria a conta                            → sem parceiro (expirou)
```

A regra não está em código de aplicação: é o `UNIQUE (visitante_id)` em
`parceiro_atribuicoes`. O segundo link cai em `ON CONFLICT DO NOTHING`. Regra
que vive numa constraint não tem como ser esquecida numa branch.

Primeiro clique foi escolhido por ser o mais defensável numa disputa: quem gerou
a descoberta recebe o crédito, e ninguém "rouba" a indicação no último instante.
`modelo` e `janela_dias` são congelados em cada linha — mudar a configuração
depois não reescreve atribuição nenhuma.

### Por que o cliente não consegue forjar

O navegador guarda **apenas** um `visitante_id`: um UUID opaco, sem privilégio.
Quem é o parceiro, quanto vale e se a janela está aberta, tudo isso o servidor lê
do clique que **ele mesmo** gravou (`parceiro_cliques`). Forjar um
`visitante_id` só permite se atribuir a um clique próprio. `parceiro_id` e
percentual nunca trafegam pelo cliente.

### O que é bloqueado

Parceiro inativo, suspenso ou encerrado; janela expirada; e-mail do novo corretor
igual ao do parceiro; conta do parceiro igual à do corretor; reconversão do mesmo
usuário (`UNIQUE (user_id)`). Tentativas de autoindicação ficam registradas com
`status = 'invalidada'` e o motivo — apagar esconderia justamente o que interessa
auditar.

---

## 6. Regra de comissão

Comissão nasce de **evento de receita confirmado**, nunca de expectativa.

Bases de cálculo disponíveis por parceiro:

| Base | Comportamento |
|---|---|
| `receita_bruta` | Percentual sobre o valor bruto (padrão). |
| `receita_liquida` | Sobre o líquido; sem líquido informado, cai para o bruto. |
| `primeiro_pagamento` | Só a primeira receita confirmada do cliente. |
| `valor_fixo` | Valor fixo por cliente, ignorando o percentual. |

**Percentual e base são congelados na linha da comissão.** Alterar o percentual
do parceiro abre uma nova vigência (`parceiro_percentuais`) e vale apenas para
receitas futuras. A comissão de março continua sendo 10% depois de o parceiro
renegociar para 5% em junho.

Fluxo de status:

```
pendente → em_validacao → aprovada → paga → estornada
    ↓            ↓            ↓
cancelada    cancelada    cancelada
```

`cancelada` e `estornada` são terminais. Um valor desfeito não volta à vida —
registra-se um evento novo, e o histórico do parceiro continua legível.

Estornar a receita estorna automaticamente as comissões **em aberto** ligadas a
ela. Comissão já **paga** não é revertida automaticamente: o dinheiro saiu, e
desfazer é decisão humana (acerto no pagamento seguinte), não efeito colateral de
uma trigger.

### Estado atual da receita

A Lotti **ainda não cobra assinatura de ninguém**: o gateway em
`src/services/paymentProvider.ts` é um `MockPaymentProvider`, `PlanoAssinatura.tsx`
está fora do grafo de rotas e nenhuma `subscriptions` é criada pelo código. O
Asaas que existe cobra o **aluguel dos inquilinos do corretor** — receita do
cliente, não da Lotti.

Por isso `receita_eventos` nasce vazia e só recebe linha por lançamento
administrativo, sempre com justificativa e auditoria. **Nenhum valor é simulado**:
onde não há dado, a tela diz "sem eventos financeiros confirmados", não "R$ 0,00".

Quando a cobrança entrar, o webhook insere na **mesma** tabela com
`origem = 'asaas'` e `external_id`. O `UNIQUE (origem, external_id)` já garante
idempotência — nada precisa ser refeito.

---

## 7. Migrations

Aplicar **nesta ordem**:

| Arquivo | Conteúdo |
|---|---|
| `20260814100000_admin_papeis_auditoria.sql` | `app_role`, `user_roles`, `has_role`/`is_admin`/`is_super_admin`, `admin_auditoria` append-only, `corretores.status`, `get_corretor_id()` com status, bootstrap do primeiro super admin |
| `20260814110000_atividade_e_config.sql` | `atividade_eventos`, `registrar_atividade()`, `admin_config`, `classificar_atividade()` |
| `20260814120000_parceiros_atribuicao.sql` | `parceiros`, `parceiro_percentuais` (vigência), `parceiro_links`, `parceiro_cliques`, `parceiro_atribuicoes` |
| `20260814130000_receita_comissoes.sql` | `receita_eventos`, `parceiro_comissoes`, `parceiro_pagamentos`, triggers de geração e estorno |
| `20260814140000_admin_rpcs.sql` | Todas as RPCs `admin_*` com guard |

Cópias prontas para colar no SQL Editor estão em `deploy-manual/backoffice-*.sql`.

**Edge Functions a publicar:** `parceiro-clique` (pública, `verify_jwt = false`)
e `parceiro-atribuir` (exige JWT).

---

## 8. Variáveis de ambiente

Nenhuma nova é obrigatória. Duas são recomendadas:

| Variável | Onde | Para quê |
|---|---|---|
| `VITE_PUBLIC_BASE_URL` | Frontend | Domínio nos links de parceiro. Sem ela, cai no fallback de produção. Já era usada pelos QR Codes das fachadas. |
| `PARCEIRO_ORIGENS_PERMITIDAS` | Edge Functions | Lista de origens (separadas por vírgula) aceitas no CORS de `parceiro-clique`/`parceiro-atribuir`. Vazio = qualquer origem, como as funções antigas. **Defina em produção.** |
| `IP_HASH_SALT` | Edge Functions | Salt do hash de IP. Sem ela, usa a service role key como salt. |

---

## 9. Como testar

```bash
npm run lint        # limpo nos arquivos do back office
npm run typecheck   # 74 erros — a mesma baseline anterior, nenhum novo
npm test            # 189 testes
npm run build
```

**Testes de RLS** (`supabase/tests/admin_rls.sql`): cole no SQL Editor depois das
migrations. Roda em transação com `ROLLBACK` no fim e prova, entre outras coisas,
que corretor comum não lê parceiros nem auditoria, que `admin` não se promove,
que a auditoria recusa UPDATE/DELETE, que suspenso perde acesso, que uma receita
gera no máximo uma comissão e que alterar percentual não reescreve o passado.

**Manual:** promova o primeiro super admin → entre → confirme que um corretor
comum digitando `/admin` cai em `/` → crie um parceiro, gere o link, abra
`/r/slug` em aba anônima, cadastre-se e veja a conversão aparecer → registre uma
receita e confira a comissão → altere o percentual e confirme que a comissão já
gerada não mudou → estorne e veja a comissão estornar junto.

---

## 10. Decisões registradas

**Impersonação ficou fora.** Implementá-la com segurança exigiria emitir sessão
de terceiro via `service_role`, ampliando muito a superfície de risco. A visão
read-only de uso no detalhe do usuário cobre o caso de suporte que motivaria o
recurso. Se voltar à pauta, precisa vir com aviso visual permanente, duração
limitada, auditoria de cada ação e bloqueio de operações sensíveis.

**`types.ts` não foi regenerado.** O arquivo gerado cobre 11 de ~35 tabelas e é a
origem dos 74 erros de typecheck da baseline. Regenerá-lo exige acesso ao projeto
Supabase e mexeria nessa baseline. Enquanto isso, `src/integrations/supabase/admin-types.ts`
dá tipagem real ao código novo, e `src/lib/admin/api.ts` concentra num único
ponto o cast que o resto do projeto espalha.

---

## 11. Dívida anterior encontrada (não tratada aqui)

Achados da auditoria que **não** foram alterados, por estarem fora do escopo:

- `imoveis.anunciado` é usada por policies, Edge Functions e frontend, mas
  **não é criada por nenhuma migration** — foi aplicada fora do versionamento.
- As 4 tabelas `fachadas*` vivem em `supabase/migration_fachadas.sql`, fora de
  `supabase/migrations/`, e não entram num `supabase db push`.
- Os enums `tipo_alerta` e `prioridade_alerta` são criados com valores
  **diferentes** em três migrations; guardas de exceção mascaram o conflito e a
  primeira a rodar vence.
- `webhook_logs` tem duas definições distintas, ambas com `IF NOT EXISTS`.
- `src/lib/supabase.ts` é um segundo cliente Supabase sem nenhum importador.
- `scripts/verify_prod_schema.js` aponta para um projeto Supabase **diferente**
  do resto do repositório.
