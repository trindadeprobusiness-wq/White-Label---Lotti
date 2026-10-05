# Contrato da API Lotti: módulo parceiros (atribuição, comissões, portal e backoffice)

Duas frentes trabalham em paralelo, sem conversar, e cada uma só toca os próprios arquivos. Tudo o que elas precisam combinar está fixado aqui: caminhos, DTOs, SQL, formato de resposta, códigos de erro, porte das Edge Functions e nomes das funções do front.

Base: inventário `14-fachadas-assinatura-onboarding.md` (seção **Parceiros** e seção **Diagnóstico comercial e admin/backoffice**), `02-edge-functions.md`, o contrato do módulo 2 (`docs/superpowers/specs/2026-10-04-api-lotti-modulo2-contrato.md`) e os contratos da onda 2 (`...-contratos-`, `...-financeiro-`, `...-rotina-contrato.md`).

**Tudo o que este contrato não redefine segue o módulo 2**: §0.2 (TenantDb, `Prisma.sql`, casts explícitos, `to_jsonb` no formato do PostgREST, `FORMATO_UUID`, `presentes()` + `jsonb_populate_record`), §0.3 (formato de erro HTTP), §0.4 (esqueleto do tradutor de erros), §0.5 (os testes leem `.text`, fixtures em formato v4).

Esta é a última onda da fase 4.

---

## 0. Regras comuns

### 0.1 Quem é dono de quê

| Frente | Arquivos (só estes) |
|---|---|
| **P** api-parceiros | cria tudo em `api/src/parceiros/**` (estrutura fixa em §1.1; classe `ParceirosModule` em `api/src/parceiros/parceiros.module.ts`) e `api/test/sql-real/parceiros.test.ts`. |
| **F** front | cria `src/lib/api/parceiros.ts` e `src/lib/api/parceiros.test.ts`; edita `src/pages/ParceiroPortal.tsx`, `src/pages/RedirectParceiro.tsx`, `src/lib/admin/api.ts`, `src/hooks/admin/useAdminDados.ts`, `src/hooks/admin/useSaasDados.ts`, `src/hooks/admin/useAtendimento.ts`, `src/hooks/admin/usePapeis.ts`, `src/pages/admin/AdminConfiguracoes.tsx`, `src/pages/admin/AdminDiagnosticos.tsx` e `src/pages/admin/AdminParceiroDetalhe.tsx`. |

Ninguém edita: `api/src/app.module.ts` (a integração liga o módulo, §5), `api/src/main.ts`, `api/src/prisma/*`, `api/src/auth/*`, `api/src/config/env.ts`, `api/prisma/*`, `api/test/sql-real/harness.ts`, `src/lib/api.ts`, `src/lib/api/http.ts`, `src/lib/api/crm.ts`, `src/lib/api/rotina.ts`, `src/lib/errors.ts`, `src/lib/admin/permissoes.ts`, `src/lib/admin/atribuicao.ts`, `src/integrations/supabase/*`, `src/hooks/useAuth.tsx` (§7.1), `src/pages/CommercialDiagnostic.tsx` (§7.1), `supabase/**`, `Caddyfile`, `AI_HANDOFF.md`, `docs/*`, nem arquivos de outro módulo.

Também valem: **nenhuma migration** (as propostas ficam em §7.2, com o SQL escrito e NÃO aplicado); nada de `prisma migrate/db push/db pull/migrate reset`; nada de commit, stash ou troca de branch; nada contra Supabase, Railway, provedor de e-mail ou rede (os testes simulam `fetch`); segredos só por nome, nunca por valor.

**Sem `VITE_API_URL` o front se comporta exatamente como hoje**: cada troca fica atrás de `apiDisponivel()` e o ramo Supabase atual permanece intacto, inclusive mensagens, chaves do React Query, invalidações, `retry: false` e `placeholderData`.

### 0.2 Dois caminhos de banco

Como no módulo rotina, há dois caminhos — e a escolha não é de gosto: ela sai dos *grants* conferidos em `api/prisma/migrations/0_init/migration.sql`.

**1. Caminho do usuário (TenantDb).** Tudo o que o front já faz hoje como `authenticated`, via PostgREST ou RPC, passa por `this.db.run(claims, (tx) => tx.$queryRaw(Prisma.sql\`...\`))`. RLS, `auth.uid()`, `auth.jwt()`, `is_admin()`, `is_super_admin()` e os gatilhos de auditoria continuam valendo exatamente como no PostgREST. Entram aqui:

- todas as RPCs `admin_*`, `meus_papeis()` e `registrar_auditoria_admin()` (são `SECURITY DEFINER` e decidem permissão por `exigir_admin()` / `exigir_super_admin()`, que leem `auth.uid()`);
- as RPCs `parceiro_portal_registrar_aceite()`, `parceiro_portal_resumo()`, `parceiro_portal_salvar_repasse()` e `parceiro_portal_teto_renovacoes()`;
- leitura e escrita direta nas tabelas onde `authenticated` tem grant: `SELECT` em `parceiros`, `parceiro_links`, `parceiro_percentuais`, `parceiro_atribuicoes`, `parceiro_cliques`, `parceiro_comissoes`, `parceiro_pagamentos`, `parceiro_lotes`, `parceiro_lote_itens`, `receita_eventos`, `admin_auditoria`, `admin_config`, `commercial_diagnostics`, `commercial_diagnostic_events`; `INSERT`/`UPDATE` em `parceiros`, `parceiro_links`, `parceiro_percentuais`, `admin_config` e `UPDATE` em `commercial_diagnostics`. As policies são todas `is_admin()`/`is_super_admin()`.

**2. Caminho do dono (`PrismaService`).** O que as Edge Functions faziam com `service_role` e para o que `authenticated`/`anon` **não** têm grant. Conferido: `parceiro_cliques` e `parceiro_atribuicoes` dão a `authenticated` apenas `REFERENCES, SELECT, TRIGGER, TRUNCATE` (sem `INSERT`/`UPDATE`); `commercial_diagnostics` dá `SELECT, UPDATE` e `commercial_diagnostic_events` só `SELECT`; `consume_public_request_limit` tem `EXECUTE` apenas para `service_role`. Então rodam fora do TenantDb, com `this.prisma.$queryRaw` / `$executeRaw`:

- o registro de clique e a atribuição (`parceiro-clique`, `parceiro-atribuir`);
- a gravação do diagnóstico comercial e seus eventos, mais o limite público.

Regras obrigatórias deste caminho:
- só dentro de `parceiros-publico.repo.ts` e `diagnostico.repo.ts` (lista em §1.1); **nenhum controller toca `PrismaService`**, e nenhum serviço do backoffice ou do portal o usa;
- nenhuma consulta deste caminho recebe `parceiro_id`, `corretor_id` ou `percentual` vindo do cliente. O cliente manda somente `slug` e `visitante_id` (opacos) ou `session_id`; quem é o parceiro o servidor lê do que ele mesmo gravou;
- na atribuição, o `user_id` vem **sempre** de `claims.sub` (o guard já validou o JWT), nunca do corpo.

Formato de resposta: `to_jsonb(t)` como no módulo 2, e o resultado das RPCs devolvido **sem transformar nada** (o Prisma desserializa `json`/`jsonb` em objeto; é o mesmo valor que o PostgREST entrega hoje).

Casts explícitos em todo parâmetro: `::uuid`, `::uuid[]`, `::text`, `::text[]`, `::int`, `::boolean`, `::numeric`, `::date`, `::timestamptz`, `::jsonb`. Nenhum `$queryRawUnsafe`/`$executeRawUnsafe`. Colunas de escrita entram por `Prisma.raw` só a partir de constantes do service.

**Tipos que precisam de cast na saída** (conferidos no topo de `api/test/sql-real/harness.ts`):
- `registrar_auditoria_admin()` devolve `bigint`, que o Prisma entrega como `BigInt` e o `JSON.stringify` do Nest não serializa: a rota usa `select public.registrar_auditoria_admin(...)::int as id`;
- `parceiro_portal_teto_renovacoes()` devolve `integer` → number\|null, sem cast;
- `meus_papeis()` devolve `text[]` → `string[]`, sem cast;
- contagens próprias usam `count(*)::int`;
- colunas `numeric` lidas por `to_jsonb` saem como número JSON (igual ao PostgREST); **nunca** selecionar `numeric` como coluna solta, que viraria `Prisma.Decimal`.

`FORMATO_UUID` é declarado em `parceiros.dto.ts`, idêntico ao módulo 2 (8-4-4-4-12 hexadecimal, sem versão). `IsUUID` não é usado em nenhum DTO. Na URL: `new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') })`.

`LIMITE_LISTA = 1000` e `POR_PAGINA = 25` são exportados de `parceiros.dto.ts`. `POR_PAGINA` é o mesmo `ITENS_POR_PAGINA` do front hoje; o teto de página aceito é `LIMITE_LISTA`.

**Exceção deliberada ao `FORMATO_UUID` no clique.** `visitante_id` continua validado pela regra **v4 canônica** (`/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`, exportada como `FORMATO_VISITANTE`), igual a `uuidValido` de `supabase/functions/_shared/parceiro.ts`. Motivo: o `visitante_id` **não** vem do banco nem de carga histórica — é sempre `crypto.randomUUID()` do navegador, gravado em `src/lib/admin/atribuicao.ts`. Afrouxar a regra aqui ampliaria de graça o espaço de identificadores que um atacante pode forjar para tentar casar com o clique de outra pessoa.

### 0.3 Papéis e autorização

**A API não reimplementa nenhuma regra de papel.** Quem decide é o banco, pelas mesmas funções de hoje:

| Quem | Como é verificado | Onde |
|---|---|---|
| admin / super_admin | `exigir_admin()` / `exigir_super_admin()` dentro de cada RPC, e as policies `is_admin()`/`is_super_admin()` nas tabelas | todas as rotas de `/api/admin/**` |
| parceiro | `parceiro_portal_*` casam `auth.uid()` **e** `lower(auth.jwt()->>'email')` com `public.parceiros` | `/api/parceiros/portal*` |
| usuário comum autenticado | só o guard | `POST /api/parceiros/atribuicao` |
| anônimo | nenhuma | `POST /api/parceiros/clique`, `POST /api/diagnostico-comercial` |

Consequências que a frente P precisa respeitar:
- **o `email` do JWT importa.** `parceiro_portal_*` lê `auth.jwt()->>'email'`. O `TenantDb` injeta as claims inteiras por `set_config('request.jwt.claims', ...)`, e o `SupabaseAuthGuard` põe o payload completo em `request.claims`, então o e-mail chega. Não montar claims reduzidas em nenhum lugar;
- **nenhuma rota consulta `meus_papeis()` para decidir se segue.** Isso duplicaria a regra: a RPC alvo já levanta `42501`. A rota `GET /api/admin/papeis` existe só para a UI pintar os menus, como hoje;
- `GET /api/admin/papeis` **não** é protegida por papel: todo autenticado pode ler os próprios papéis (hoje `meus_papeis()` devolve `[]` para quem não tem nenhum, e o painel usa isso para redirecionar para `/auth`).

### 0.4 Erros (`api/src/parceiros/parceiros.erros.ts`)

Copia `ErroPg`, `erroPg` e `erroApi` do módulo 2 §0.4 **idênticos**. O `traduzirErroBanco` deste módulo tem a assinatura `traduzirErroBanco(e, op: OpcoesErro = {})`, com `OpcoesErro = { origem?: 'portal' | 'backoffice' | 'publico' }`, e trata os casos abaixo **nesta ordem**:

| SQLSTATE / mensagem | HTTP | codigo | message |
|---|---|---|---|
| 42501 `acesso negado` | 403 | `sem_permissao` | Você não tem permissão para esta ação. |
| 42501 `autenticacao necessaria` | 403 | `sessao_invalida` | Não foi possível identificar a sua conta. Entre novamente. |
| 42501 `parceiro nao encontrado` ou `email divergente` (`origem: 'portal'`) | 403 | `parceiro_nao_vinculado` | Este e-mail ainda não está vinculado a um parceiro ativo. |
| 42501 `A conta precisa estar ativa para iniciar atendimento.` | 409 | `conta_inativa` | A conta precisa estar ativa para iniciar o atendimento. |
| 42501 `Contas administrativas nao podem ser abertas em modo de atendimento.` | 409 | `conta_administrativa` | Contas administrativas não podem ser abertas em modo de atendimento. |
| 42501 outros | 403 | `sem_permissao` | Você não tem permissão para esta ação. |
| 22023 (`origem: 'portal'`) | 422 | `dados_de_repasse_invalidos` | Confira o documento e a chave PIX do mesmo titular. |
| 22023 outros | 400 | `dados_invalidos` | Dados inválidos. Confira os campos e tente de novo. |
| P0001 na tabela `MENSAGENS_RPC` (abaixo) | 422 | o código da tabela | o texto da tabela |
| P0001 fora da tabela | 422 | `regra_do_backoffice` | Não foi possível concluir a operação. Confira os dados e tente de novo. |
| 23505 `uq_parceiros_email` no bruto | 409 | `parceiro_repetido` | Já existe parceiro com este e-mail. |
| 23505 `uq_parceiro_links_slug` ou `uq_parceiro_link_principal` no bruto | 409 | `link_repetido` | Este identificador de link já está em uso. |
| 23505 `uq_percentual_vigente` no bruto | 409 | `percentual_repetido` | Já existe uma vigência aberta para este parceiro. |
| 23505 `uq_atribuicao_visitante`, `uq_atribuicao_user` ou `uq_atribuicao_corretor` no bruto | 409 | `atribuicao_repetida` | Esta origem já foi registrada. |
| 23505 outros | 409 | `registro_repetido` | Já existe um registro igual. |
| 23503 ou 23001 | 422 | `referencia_invalida` | Um registro relacionado não existe mais. Recarregue a página e tente de novo. |
| 42P01 ou 42883 | 503 | `backoffice_nao_instalado` | As migrations do back office ainda não foram aplicadas neste banco. |
| 22P02, 22007, 22008, 22003, 22001, 23502, 23514 | 400 | `dados_invalidos` | Dados inválidos. Confira os campos e tente de novo. |
| outro | sobe como veio (500 do Nest) | | |

Uma `HttpException` lançada dentro do `run` (404, 409 etc.) passa intacta pelo tradutor. O tradutor é sempre chamado **fora** do `run`: `try { return await this.db.run(...) } catch (e) { traduzirErroBanco(e, op) }`.

**`MENSAGENS_RPC`: a lista fechada de regras do backoffice.** As RPCs `admin_*` levantam `RAISE EXCEPTION` sem `ERRCODE` (SQLSTATE `P0001`) com textos em português escritos para o operador — e hoje esses textos chegam ao toast do painel verbatim, via `mensagemDeErro(e, …)`. Para não mudar o comportamento e, ao mesmo tempo, nunca repassar texto do Postgres que a API não conhece, o tradutor usa uma **allowlist congelada**: a mensagem só é devolvida se casar com uma entrada desta tabela; qualquer outro `P0001` vira 422 `regra_do_backoffice` com o texto genérico, e o texto do Postgres não sai na resposta nem no log.

| Texto do `RAISE` (prefixo, comparado sem acento e sem caixa) | codigo | message devolvida |
|---|---|---|
| `acesso negado` | `sem_permissao` | Você não tem permissão para esta ação. |
| `informe uma justificativa com ao menos 10 caracteres` | `justificativa_curta` | Informe uma justificativa com ao menos 10 caracteres. |
| `voce nao pode alterar o status da propria conta` | `conta_propria` | Você não pode alterar o status da própria conta. |
| `voce nao pode revogar o proprio papel de super admin` | `papel_proprio` | Você não pode revogar o próprio papel de super admin. |
| `a plataforma precisa manter ao menos um super admin` | `ultimo_super_admin` | A plataforma precisa manter ao menos um super admin. |
| `o usuario ja possui esse papel` | `papel_repetido` | O usuário já possui esse papel. |
| `papel ativo nao encontrado` | `papel_nao_encontrado` | Papel ativo não encontrado. |
| `papel invalido` | `papel_invalido` | Papel inválido. |
| `usuario nao encontrado` / `conta nao encontrada` / `corretor nao encontrado` | `conta_nao_encontrada` | Conta não encontrada. |
| `organizacao nao encontrada` | `organizacao_nao_encontrada` | Organização não encontrada. |
| `comissao nao encontrada` | `comissao_nao_encontrada` | Comissão não encontrada. |
| `evento de receita nao encontrado` | `receita_nao_encontrada` | Evento de receita não encontrado. |
| `lote nao encontrado` | `lote_nao_encontrado` | Lote não encontrado. |
| `transicao invalida` | `transicao_invalida` | Transição de status não permitida para esta comissão. |
| `status invalido` | `status_invalido` | Status inválido. |
| `base de calculo invalida` | `base_invalida` | Base de cálculo inválida. |
| `percentual invalido` | `percentual_invalido` | Percentual inválido. |
| `regra de renovacao invalida` | `renovacao_invalida` | Regra de renovação inválida. |
| `identificador do link invalido` | `slug_invalido` | Identificador do link inválido. |
| `nome ou e-mail invalido` | `parceiro_invalido` | Confira o nome e o e-mail do parceiro. |
| `a nova vigencia precisa comecar depois de` | `vigencia_invalida` | A nova vigência precisa começar depois do início da vigência atual. |
| `selecione ao menos um parceiro` | `selecao_vazia` | Selecione ao menos um parceiro. |
| `selecione ao menos uma comissao` | `selecao_vazia` | Selecione ao menos uma comissão. |
| `nenhuma comissao elegivel para os parceiros selecionados` | `sem_comissao_elegivel` | Nenhuma comissão elegível para os parceiros selecionados. |
| `nenhuma comissao aprovada deste parceiro na selecao` | `sem_comissao_aprovada` | Nenhuma comissão aprovada deste parceiro na seleção. |
| `a selecao tem` | `selecao_divergente` | A seleção mudou. Recarregue a página e confira as comissões aprovadas. |
| `apenas lote em rascunho pode ser exportado` | `lote_nao_exportavel` | Apenas lote em rascunho pode ser exportado. |
| `lote ja pago nao pode ser cancelado` | `lote_pago` | Lote já pago não pode ser cancelado; estorne as comissões. |
| `lote ` + ` nao pode ser marcado como pago` | `lote_nao_pagavel` | Este lote não pode ser marcado como pago no status atual. |
| `informe a referencia ou o comprovante do pagamento` | `referencia_ausente` | Informe a referência ou o comprovante do pagamento. |
| `so e possivel estornar receita confirmada` | `receita_nao_confirmada` | Só é possível estornar receita confirmada. |
| `nao e possivel registrar receita com data futura` | `data_futura` | Não é possível registrar receita com data futura. |
| `o valor precisa ser maior que zero` | `valor_invalido` | O valor precisa ser maior que zero. |
| `periodo invalido` | `periodo_invalido` | Período inválido: o início está depois do fim. |
| `configuracao desconhecida` | `config_desconhecida` | Configuração desconhecida. |

A comparação normaliza a mensagem (minúsculas, sem acento) e usa `startsWith`, porque várias mensagens interpolam valores com `%`. A tabela mora em `parceiros.erros.ts` como constante `readonly`, e o teste de §3.1 confere que **toda** entrada é alcançada e que um `P0001` desconhecido cai no genérico.

**Erros fixos de serviço:**

| HTTP | codigo | message | Quando |
|---|---|---|---|
| 400 | `nada_para_atualizar` | Nada para atualizar. | PATCH com corpo vazio |
| 403 | `origem_nao_permitida` | Origem não permitida. | `POST /api/parceiros/clique` com `Origin` fora de `PARCEIRO_ORIGENS_PERMITIDAS` (§0.5) |
| 403 | `parceiro_nao_vinculado` | Este e-mail ainda não está vinculado a um parceiro ativo. | portal sem parceiro para o e-mail da sessão |
| 404 | `nao_encontrado` | Parceiro não encontrado. | detalhe/convite de parceiro inexistente |
| 404 | `diagnostico_nao_encontrado` | Diagnóstico não encontrado. | PATCH de status sem linha |
| 409 | `parceiro_inativo` | Ative o parceiro antes de enviar o convite. | convite com `status <> 'ativo'` |
| 409 | `convite_ja_aceito` | Este parceiro já aceitou o convite. | convite com `convite_status = 'aceito'` |
| 429 | `muitas_tentativas` | Muitas tentativas. Aguarde alguns minutos. | limite público do diagnóstico |
| 503 | `provedor_de_email_nao_configurado` | O envio de convites por e-mail ainda não está configurado no servidor. | porta de convite sem provedor (§2.3) |
| 503 | `diagnostico_nao_configurado` | A captura do diagnóstico comercial não está configurada no servidor. | falta `PUBLIC_RATE_LIMIT_SECRET` |
| 503 | `backoffice_nao_instalado` | As migrations do back office ainda não foram aplicadas neste banco. | 42P01/42883 (§0.4) |

`CODIGOS_DO_BANCO` de `src/lib/api/http.ts` **não** inclui nenhum código deste módulo, e `http.ts` não é editável: logo `lerErroApi` põe em `message` o texto em português da API, que é o que as telas já mostram. `src/lib/api/parceiros.ts` relança `backoffice_nao_instalado` como `BackOfficeNaoInstaladoError` e `sem_permissao` como `AcessoNegadoError` (§4.1), que são as duas classes que `usePapeis`/`chamarRpc` já distinguem.

**Logs:** nunca registrar nome, e-mail, telefone, documento, chave PIX, `ip_hash`, `user_agent`, conteúdo de resposta do diagnóstico nem `meta.message`. Registrar só SQLSTATE, `codigo` e, no caminho público, o nome da rota.

### 0.5 Variáveis do módulo

Lidas por `parceiros.config.ts` de `process.env`, **todas opcionais**, por uma função `lerConfigParceiros(env = process.env)` chamada a cada uso (para os testes trocarem variáveis sem reiniciar).

| Variável | Uso | Faltando |
|---|---|---|
| `PARCEIRO_ORIGENS_PERMITIDAS` | lista separada por vírgula; o clique recusa `Origin` fora dela | lista vazia → aceita qualquer `Origin` (mesmo efeito de hoje, em que a lista vazia ecoa a origem recebida) |
| `PARCEIRO_APP_URL` | monta o link do parceiro no convite; padrão `https://app.plataformalotti.com.br` | usa o padrão |
| `PARCEIRO_PORTAL_URL` | `redirectTo` do convite; padrão `https://app.plataformalotti.com.br/nova-senha?redirectTo=%2Fparceiro` | usa o padrão |
| `IP_HASH_SALT` | salt do `sha256` do IP no clique | `ip_hash` vai **null** (decisão §6.3) |
| `PUBLIC_RATE_LIMIT_SECRET` | HMAC das chaves de limite do diagnóstico | 503 `diagnostico_nao_configurado` |
| `PARCEIRO_EMAIL_PROVEDOR` (nova) | nome do provedor transacional escolhido | porta responde 503 `provedor_de_email_nao_configurado` (§2.3) |

Nenhum valor de segredo é lido ou registrado em log: a config só guarda, para cada variável, se **existe** e o valor estritamente necessário para montar URL pública (`PARCEIRO_APP_URL`, `PARCEIRO_PORTAL_URL`, `PARCEIRO_ORIGENS_PERMITIDAS`).

A `SUPABASE_SERVICE_ROLE_KEY` **deixa de ser usada** por este módulo: o caminho do dono é a própria conexão do Prisma. O fallback de hoje (`IP_HASH_SALT ?? SUPABASE_SERVICE_ROLE_KEY`) não é portado (§6.3).

### 0.6 Travas de segurança que não podem mudar

Estão listadas aqui porque a revisão final (§5) confere uma por uma:

1. **Primeiro clique com janela de 90 dias.** A janela vem de `parceiros.janela_atribuicao_dias` (default 90, CHECK 1–730) e nunca do cliente. `expira_em = now() + janela dias`.
2. **Unicidade por visitante.** A regra "primeiro clique vence" é o índice `uq_atribuicao_visitante` em `parceiro_atribuicoes(visitante_id)`. O `INSERT` da atribuição usa `on conflict do nothing` — nada é sobrescrito, nunca. A regra permanece em constraint, não em `if`.
3. **Idempotência da conversão.** `uq_atribuicao_user` e `uq_atribuicao_corretor` (parciais, onde não nulo). O `UPDATE` da conversão só muda a linha `status = 'pendente' and user_id is null`.
4. **Nenhum dado de parceiro sai no clique além do nome.** `parceiro_id`, `percentual`, `link_id` e `id` da atribuição jamais entram na resposta pública.
5. **Resposta uniforme para slug inexistente, link revogado e parceiro inativo:** `200 { ok: false }`. Nada permite enumerar slugs.
6. **Autoindicação continua barrada** pelas quatro regras de `motivoDeInvalidez` (status, janela, mesmo `user_id`, mesmo e-mail), e a tentativa é **registrada** (`status = 'invalidada'`, `motivo_invalidacao`), não apagada.
7. **Auditoria append-only.** `admin_auditoria` tem o gatilho `tr_admin_auditoria_imutavel` (BEFORE DELETE OR UPDATE → exceção) e, para `authenticated`, só grants de `SELECT`. **Nenhuma rota faz `UPDATE` ou `DELETE` em `admin_auditoria`**; a escrita só acontece por `registrar_auditoria_admin()` e pelos gatilhos `auditar_escrita_direta_admin` / `auditar_mutacao_admin_direta` / `auditar_mutacao_suporte`, que seguem disparando porque a escrita continua passando pelo TenantDb como `authenticated`.
8. **O percentual aplicado é congelado na comissão** pelos gatilhos `tr_gerar_comissao` / `tr_estornar_comissao` em `receita_eventos`. A API não calcula comissão em lugar nenhum: ela só insere receita (por RPC) e deixa o gatilho agir.
9. **Vigência de percentual** é fechada por `tr_fechar_vigencia_anterior`; a API nunca faz `UPDATE` em `parceiro_percentuais`.
10. **O convite nunca conta por que falhou.** Mensagem única para o operador; detalhe só em log sem dado pessoal.

---

## 1. Frente P: API (`api/src/parceiros/`)

### 1.1 Estrutura

| Arquivo | Conteúdo |
|---|---|
| `parceiros.module.ts` | `ParceirosModule`: `imports: [PrismaModule]`; `controllers: [ParceirosPublicoController, DiagnosticoPublicoController, ParceirosController, AdminController]`; `providers: [SupabaseAuthGuard, ParceirosPublicoRepo, ParceirosPublicoService, DiagnosticoRepo, DiagnosticoService, PortalService, ConviteService, AdminService, { provide: PORTA_CONVITE, useClass: ConviteSemProvedor }]`. |
| `parceiros.dto.ts` | `FORMATO_UUID`, `FORMATO_VISITANTE`, `FORMATO_SLUG`, `LIMITE_LISTA`, `POR_PAGINA`, listas de valores e todos os DTOs (§1.2). |
| `parceiros.erros.ts` | §0.4, incluindo `MENSAGENS_RPC`. |
| `parceiros.config.ts` | §0.5. |
| `publico/parceiros-publico.repo.ts` | **todo** o SQL do caminho do dono para clique e atribuição. |
| `publico/parceiros-publico.service.ts` | porte de `parceiro-clique` e `parceiro-atribuir` (§2.1, §2.2), incluindo `motivoDeInvalidez` e os utilitários portados. |
| `publico/parceiros-publico.controller.ts` | `ParceirosPublicoController`, `@Controller('parceiros')`, **sem guard**: só `POST clique`. |
| `publico/utilitarios.ts` | porte fiel de `supabase/functions/_shared/parceiro.ts`: `slugValido`, `visitanteValido`, `hashIp`, `ipDoRequest`, `limparUtm`, `truncar`, `motivoDeInvalidez`. |
| `portal/portal.service.ts` | rotas do portal do parceiro (TenantDb). |
| `convite/porta-convite.ts` | `PORTA_CONVITE`, `interface PortaDeConvite`, `ConviteSemProvedor` (§2.3). |
| `convite/convite.service.ts` | porte de `parceiro-convidar` (§2.3). |
| `parceiros.controller.ts` | `ParceirosController`, `@Controller('parceiros')` + `SupabaseAuthGuard`: atribuição, portal e convites. |
| `admin/admin.service.ts` | todas as rotas de backoffice (TenantDb). |
| `admin/admin.controller.ts` | `AdminController`, `@Controller('admin')` + `SupabaseAuthGuard`. |
| `diagnostico/diagnostico.ts` | porte fiel de `supabase/functions/_shared/commercial-diagnostic.ts` (`questions`, `validateAnswers`, `scoreDiagnostic`, `visibleQuestions`). |
| `diagnostico/diagnostico.repo.ts` | SQL do caminho do dono do diagnóstico e o limite público. |
| `diagnostico/diagnostico.service.ts` | porte de `commercial-diagnostic` (§2.4). |
| `diagnostico/diagnostico-publico.controller.ts` | `DiagnosticoPublicoController`, `@Controller('diagnostico-comercial')`, **sem guard**. |
| specs Jest | `parceiros.erros.spec.ts`, `publico/utilitarios.spec.ts`, `publico/parceiros-publico.service.spec.ts`, `portal/portal.service.spec.ts`, `convite/convite.service.spec.ts`, `admin/admin.service.spec.ts`, `admin/admin.controller.spec.ts`, `parceiros.controller.spec.ts`, `diagnostico/diagnostico.service.spec.ts`. |

Dois controllers com o prefixo `parceiros` (um com guard, outro sem) é o mesmo arranjo que o módulo rotina usa em `RotinaGoogleController` / `RotinaGooglePublicoController`. Rotas estáticas vêm declaradas **antes** das rotas com `:id`. DELETE usa `@HttpCode(204)`; POST que não cria registro usa `@HttpCode(200)`.

### 1.2 DTOs (`parceiros.dto.ts`)

Listas exportadas (todas conferidas contra os CHECKs do banco):

```ts
export const STATUS_PARCEIRO = ['ativo', 'inativo', 'suspenso', 'encerrado'] as const;
export const TIPOS_PARCEIRO = ['afiliado', 'influenciador', 'consultor', 'comercial'] as const;
export const TIPOS_CHAVE_PIX = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'] as const;
export const BASES_CALCULO = ['receita_bruta', 'receita_liquida', 'primeiro_pagamento', 'valor_fixo'] as const;
export const STATUS_COMISSAO = ['pendente', 'em_validacao', 'aprovada', 'paga', 'cancelada', 'estornada'] as const;
export const STATUS_LOTE = ['rascunho', 'exportado', 'pago', 'falhou', 'cancelado'] as const;
export const STATUS_RECEITA = ['confirmado', 'estornado', 'cancelado'] as const;
export const TIPOS_RECEITA = ['assinatura', 'addon', 'avulso'] as const;
export const STATUS_DIAGNOSTICO = ['novo', 'em_contato', 'concluido'] as const;
export const EVENTOS_DIAGNOSTICO = ['diagnostic_started', 'profile_selected', 'diagnostic_step_completed', 'diagnostic_abandoned', 'cta_clicked'] as const;
export const DIRECOES = ['asc', 'desc'] as const;
export const FORMATO_SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
```

Todo decorator de validação leva `{ message: '<português>' }`, como no módulo 2 §0.3. `IsOptional`, `ValidateIf` e `Type` não levam mensagem. Campos que aceitam `null` explícito usam `@ValidateIf((_, v) => v !== null && v !== undefined)`.

| DTO | Campos e validação |
|---|---|
| `CliqueDto` | `slug` `@Matches(FORMATO_SLUG)` ("Identificador de link inválido."); `visitante_id` `@Matches(FORMATO_VISITANTE)` ("Identificador de visitante inválido."); `utm?` `@IsObject()` \| null ("UTM inválido."); `referer?` `@IsString() @MaxLength(400)` \| null. |
| `AtribuirDto` | `visitante_id` `@Matches(FORMATO_VISITANTE)`. |
| `SalvarRepasseDto` | `documento` `@IsString() @Length(11, 18)` ("Informe o CPF ou CNPJ do titular."); `tipo_chave` `@IsIn(TIPOS_CHAVE_PIX)` ("Tipo de chave PIX inválido."); `chave` `@IsString() @Length(3, 140)` ("Informe a chave PIX."). |
| `ConviteDto` | `acao?` `@IsIn(['criar'])`; `parceiro_id?` `@Matches(FORMATO_UUID)`; `dados?` `@IsObject()`. `@ValidateIf(o => o.acao === 'criar')` exige `dados`; `@ValidateIf(o => o.acao !== 'criar')` exige `parceiro_id` ("Informe o parceiro."). |
| `PaginaDto` (base das listas) | `pagina?` `@Type(() => Number) @IsInt() @Min(1) @Max(10000)` (padrão 1); `por_pagina?` `@IsInt() @Min(1) @Max(LIMITE_LISTA)` (padrão `POR_PAGINA`). |
| `ListarParceirosDto` | `PaginaDto` + `busca?` `@IsString() @MaxLength(200)`; `status?` `@IsIn(STATUS_PARCEIRO)`. |
| `CriarParceiroDto` / `EditarParceiroDto` | só as colunas de `COLUNAS_PARCEIRO` (abaixo); `nome` `@IsString() @Length(2, 200)` após trim; `email` `@IsEmail()` ("Informe um e-mail válido."); `status` `@IsIn(STATUS_PARCEIRO)`; `tipo?` `@IsIn(TIPOS_PARCEIRO)` \| null; `janela_atribuicao_dias?` `@IsInt() @Min(1) @Max(730)`; `tipo_chave_pix?` `@IsIn(TIPOS_CHAVE_PIX)` \| null; `cortesia_dias?` `@IsInt() @Min(1) @Max(365)` \| null; `cortesia_expira_em?` `@IsISO8601()` \| null; demais textos `@MaxLength(300)` \| null. No `EditarParceiroDto` **todos** são opcionais e o corpo vazio dá 400 `nada_para_atualizar`. |
| `DefinirPercentualDto` | `percentual` `@IsNumber() @Min(0) @Max(100)`; `base_calculo` `@IsIn(BASES_CALCULO)`; `valor_fixo?` `@IsNumber() @Min(0)` \| null; `vigencia_inicio?` `@IsISO8601()` \| null; `motivo?` `@IsString() @MaxLength(500)` \| null. |
| `CriarLinkDto` | `slug` `@Matches(FORMATO_SLUG)`; `campanha?` `@IsString() @MaxLength(120)` \| null; `principal?` `@IsBoolean()`. |
| `ListarComissoesDto` | `PaginaDto` + `parceiro_id?` uuid; `status?` `@IsIn(STATUS_COMISSAO)`; `de?`, `ate?` `@IsISO8601()`. |
| `TransicionarComissaoDto` | `novo_status` `@IsIn(STATUS_COMISSAO)`; `motivo?` `@IsString() @MaxLength(500)` \| null. |
| `RegistrarPagamentoDto` | `parceiro_id` uuid; `comissao_ids` `@IsArray() @ArrayMinSize(1) @ArrayMaxSize(LIMITE_LISTA) @Matches(FORMATO_UUID, { each: true })`; `metodo?`, `referencia?`, `observacoes?` texto \| null; `pago_em?` `@IsISO8601()` \| null. |
| `ListarReceitaDto` | `PaginaDto` + `corretor_id?` uuid; `status?` `@IsIn(STATUS_RECEITA)`; `de?`, `ate?` ISO. |
| `RegistrarReceitaDto` | `corretor_id` uuid; `valor_bruto` `@IsNumber() @Min(0.01)`; `confirmado_em` `@IsISO8601()`; `tipo?` `@IsIn(TIPOS_RECEITA)` (padrão `'assinatura'`); `valor_liquido?` `@IsNumber() @Min(0)` \| null; `competencia?` ISO \| null; `motivo` `@IsString() @Length(10, 500)` ("Informe uma justificativa com ao menos 10 caracteres."). |
| `EstornarReceitaDto` | `motivo` `@IsString() @Length(10, 500)`. |
| `GerarLoteDto` | `parceiro_ids` lista de uuid 1..`LIMITE_LISTA`; `saldo_minimo?` `@IsNumber() @Min(0)` \| null; `observacoes?` texto \| null. |
| `MarcarLotePagoDto` | `pago_em` `@IsISO8601()`; `referencia` `@IsString() @Length(1, 200)`; `comprovante_url?` `@IsString() @MaxLength(500)` \| null. |
| `CancelarLoteDto` | `motivo` `@IsString() @Length(10, 500)`. |
| `SalvarConfigDto` | `valor` — **sem** decorator de tipo (o JSONB aceita número, texto, objeto); só `@IsDefined()` ("Informe o valor."). A chave vem na URL. |
| `ListarAuditoriaDto` | `PaginaDto` + `entidade?`, `acao?` texto `@MaxLength(80)`; `de?`, `ate?` ISO. |
| `ListarUsuariosDto` | `PaginaDto` + `busca?`, `status?`, `atividade?` texto; `parceiro_id?` uuid; `criado_de?`, `criado_ate?` ISO; `ordenar?` `@IsIn(['criado_em','nome','ultimo_acesso_em'])`; `direcao?` `@IsIn(DIRECOES)`. |
| `ListarAtendimentoDto` | `PaginaDto` + `busca?`, `campanha?` texto; `status?` texto; `parceiro_id?` uuid; `origem_direta?` `@IsBoolean()`. |
| `ListarAssinaturasDto` / `ListarPagamentosDto` / `ListarCancelamentosDto` / `ListarLotesDto` / `ListarOrganizacoesDto` / `ListarAcessosDto` | `PaginaDto` + os filtros de texto/data que cada RPC recebe hoje (um a um, com `@MaxLength(200)`). |
| `PeriodoDto` | `inicio`, `fim` `@IsISO8601()` obrigatórios ("Informe o período."). |
| `EventoDiagnosticoDto` | `session_id` `@Matches(FORMATO_VISITANTE)`; `event` `@IsIn(EVENTOS_DIAGNOSTICO)`; `step?` `@IsString() @MaxLength(40)`. |
| `SubmeterDiagnosticoDto` | `session_id` `@Matches(FORMATO_VISITANTE)`; `consent` `@IsBoolean()`; `name` `@IsString() @Length(2, 120)`; `phone` `@IsString() @MaxLength(32)`; `email?` `@IsEmail() @MaxLength(254)`; `city?`, `company?` `@MaxLength(120)`; `answers` `@IsObject()`; `attribution?` `@IsObject()`. |
| `StatusDiagnosticoDto` | `status` `@IsIn(STATUS_DIAGNOSTICO)`. |

Colunas de escrita (constantes no service, nunca chave vinda do cliente):

```ts
const COLUNAS_PARCEIRO = ['nome','empresa','documento','email','telefone','responsavel','status','data_inicio',
  'janela_atribuicao_dias','observacoes','chave_pix','tipo_chave_pix','cortesia_dias','cortesia_expira_em','tipo'] as const;
const COLUNAS_LINK = ['parceiro_id','slug','campanha','principal'] as const;
```

`user_id`, `criado_por`, `criado_em`, `atualizado_em`, `convite_status`, `convidado_em`, `convite_aceito_em` e `documento_beneficiario` **não** entram em `COLUNAS_PARCEIRO`: são do servidor ou do gatilho. Se vierem no corpo, o `ValidationPipe` (`forbidNonWhitelisted`, já global) recusa com 400.

### 1.3 Rotas públicas (`ParceirosPublicoController`, `DiagnosticoPublicoController`)

Sem guard. Prefixo global `/api`.

| # | Método e caminho | Corpo | Resposta | Substitui |
|---|---|---|---|---|
| P1 | `POST /api/parceiros/clique` (200) | `CliqueDto` | `{ ok: true, parceiro_nome: string }` ou `{ ok: false }` | Edge `parceiro-clique` |
| D1 | `POST /api/diagnostico-comercial` (200) | `EventoDiagnosticoDto` quando `action: 'event'`, `SubmeterDiagnosticoDto` quando `action: 'submit'` | `{ success: true }` ou `{ success: true, result: Scored }` | Edge `commercial-diagnostic` |

O `action` é lido antes da validação, por um `@Body()` cru tipado como `{ action?: unknown }`, e o DTO correspondente é validado à mão com `plainToInstance` + `validate` dentro do service (o mesmo truque que o módulo financeiro usa no webhook). `action` fora de `'event' | 'submit'` → 400 `acao_invalida` "Ação inválida.".

### 1.4 Rotas do parceiro e do convite (`ParceirosController`, autenticado)

| # | Método e caminho | Corpo | Resposta | Substitui (inventário 14) |
|---|---|---|---|---|
| T1 | `POST /api/parceiros/atribuicao` (200) | `AtribuirDto` | `{ ok: true, parceiro_nome?: string, ja_atribuido?: true }` ou `{ ok: false }` | Edge `parceiro-atribuir` |
| T2 | `GET /api/parceiros/portal` | — | `{ ...PortalData, teto_renovacoes: number \| null }` | `ParceiroPortal.tsx:49-76` |
| T3 | `PUT /api/parceiros/portal/repasse` (200) | `SalvarRepasseDto` | `{ salvo: true }` | `ParceiroPortal.tsx:111-123` |
| T4 | `POST /api/parceiros/convites` (200) | `ConviteDto` | §2.3 | Edge `parceiro-convidar` |

**SQL de T2** (um só `run`, nesta ordem — igual às três chamadas que o front faz hoje em `Promise.all` depois do aceite):

```sql
select public.parceiro_portal_registrar_aceite() as ok;
select public.parceiro_portal_resumo() as resumo;
select public.parceiro_portal_teto_renovacoes() as teto;
```

A resposta é `{ ...resumo, teto_renovacoes: teto }`, exatamente a forma que `PortalData` já tem. As três são `SECURITY DEFINER` e falham com `42501` quando não há parceiro para o e-mail da sessão → 403 `parceiro_nao_vinculado` (`origem: 'portal'`).

**SQL de T3:** `select public.parceiro_portal_salvar_repasse(${documento}::text, ${tipo}::text, ${chave}::text) as ok`. `22023` → 422 `dados_de_repasse_invalidos`.

### 1.5 Rotas do backoffice (`AdminController`, autenticado)

Toda rota é uma chamada de uma RPC existente dentro do TenantDb, ou uma leitura/escrita direta na tabela que o front já faz hoje. **Nenhuma regra é reescrita em TypeScript.** O resultado da RPC é devolvido sem transformação.

Modelo de SQL (vale para todas as linhas marcadas "RPC"):

```ts
const [linha] = await tx.$queryRaw<Array<{ resultado: unknown }>>(Prisma.sql`
  select public.admin_listar_parceiros(${busca}::text, ${status}::text, ${limite}::int, ${offset}::int) as resultado`);
return linha.resultado;
```

`offset` é sempre `(pagina - 1) * por_pagina`, calculado no service, e `limite` é `por_pagina`. As RPCs paginadas por `p_pagina`/`p_por_pagina` recebem `pagina` e `por_pagina` diretamente (a divisão é interna a elas). Todo argumento leva cast; `null` é passado como `${null}::text` (o Prisma manda sem tipo e o cast resolve).

**Papéis e auditoria**

| # | Rota | SQL |
|---|---|---|
| B1 | `GET /api/admin/papeis` | `select public.meus_papeis() as papeis` → `string[]` |
| B2 | `GET /api/admin/auditoria?entidade&acao&de&ate&pagina&por_pagina` | RPC `admin_listar_auditoria(p_entidade, p_acao, p_de::date, p_ate::date, p_limite, p_offset)`; o padrão de `por_pagina` desta rota é **50**, como hoje |
| B3 | `POST /api/admin/auditoria` (201) | `select public.registrar_auditoria_admin(${acao}::text, ${entidade}::text, ${entidadeId}::text, ${antes}::jsonb, ${depois}::jsonb, ${motivo}::text)::int as id` → `{ id: number }` |

**Parceiros, percentuais e links**

| # | Rota | SQL |
|---|---|---|
| B4 | `GET /api/admin/parceiros?busca&status&pagina&por_pagina` | RPC `admin_listar_parceiros` |
| B5 | `GET /api/admin/parceiros/opcoes` | RPC `admin_opcoes_parceiros()` |
| B6 | `GET /api/admin/parceiros/:id` | quatro consultas no mesmo `run`, as mesmas de `useParceiro` hoje (§abaixo) |
| B7 | `POST /api/admin/parceiros` (201) | `insert ... jsonb_populate_record(null::public.parceiros, ${json}::jsonb)` → `{ id }` |
| B8 | `PATCH /api/admin/parceiros/:id` | `update ... set (<cols>) = (select <r.cols> from jsonb_populate_record(...))` → `{ id }` |
| B9 | `POST /api/admin/parceiros/:id/percentuais` (201) | RPC `admin_definir_percentual` |
| B10 | `POST /api/admin/parceiros/:id/links` (201) | `insert into public.parceiro_links` → `{ id, slug }` |
| B11 | `POST /api/admin/links/:id/revogar` (200) | `update public.parceiro_links set ativo = false, revogado_em = now() where id = ${id}::uuid returning id` → `{ revogado: true }`; nenhuma linha → 404 `nao_encontrado` |

SQL de **B6** (ordem e limites idênticos aos de `useParceiro`):

```sql
select to_jsonb(p) as linha from public.parceiros p where p.id = ${id}::uuid;
select to_jsonb(pp) as linha from public.parceiro_percentuais pp
 where pp.parceiro_id = ${id}::uuid order by pp.vigencia_inicio desc, pp.id desc limit ${LIMITE_LISTA}::int;
select to_jsonb(l) as linha from public.parceiro_links l
 where l.parceiro_id = ${id}::uuid order by l.criado_em desc, l.id desc limit ${LIMITE_LISTA}::int;
select to_jsonb(a) || jsonb_build_object('corretores',
         case when c.id is null then null else jsonb_build_object('nome', c.nome, 'email', c.email) end) as linha
  from public.parceiro_atribuicoes a
  left join public.corretores c on c.id = a.corretor_id
 where a.parceiro_id = ${id}::uuid order by a.criado_em desc, a.id desc limit ${100}::int;
```

Resposta: `{ parceiro, percentuais, links, atribuicoes }`. Sem linha de parceiro → 404 `nao_encontrado`. O `jsonb_build_object('corretores', ...)` reproduz literalmente o shape do embed `corretores(nome, email)` do PostgREST, inclusive o `null` quando não há corretor — é o que `AtribuicaoParceiro` já espera.

**B7** monta o JSON só com `presentes(dto, COLUNAS_PARCEIRO)` e acrescenta `criado_por` de `${claims.sub}::uuid` no `insert`, fora do JSON (coluna fixa):

```sql
insert into public.parceiros as x (criado_por, ${alvo})
select ${claims.sub}::uuid, ${origem} from jsonb_populate_record(null::public.parceiros, ${json}::jsonb) r
returning x.id;
```

`convite_status` fica no default `'nao_enviado'`; `user_id` é preenchido pelo gatilho `tr_vincular_conta_parceiro`. **B8** com `cols.length === 0` → 400 `nada_para_atualizar`; nenhuma linha afetada → 404 `nao_encontrado`.

**Comissões, pagamentos e receita**

| # | Rota | SQL |
|---|---|---|
| B12 | `GET /api/admin/comissoes?parceiro_id&status&de&ate&pagina&por_pagina` | RPC `admin_listar_comissoes` |
| B13 | `POST /api/admin/comissoes/:id/status` (200) | RPC `admin_transicionar_comissao` |
| B14 | `POST /api/admin/pagamentos-parceiro` (201) | RPC `admin_registrar_pagamento` (`${ids}::uuid[]`) |
| B15 | `GET /api/admin/receita?corretor_id&status&de&ate&pagina&por_pagina` | RPC `admin_listar_receita` |
| B16 | `POST /api/admin/receita` (201) | RPC `admin_registrar_receita` (`${valor}::numeric`, `${confirmadoEm}::timestamptz`, `${competencia}::date`) |
| B17 | `POST /api/admin/receita/:id/estornar` (200) | RPC `admin_estornar_receita` |

**Repasses em lote**

| # | Rota | SQL |
|---|---|---|
| B18 | `GET /api/admin/repasses/elegiveis?saldo_minimo` | RPC `admin_parceiros_elegiveis_repasse(${saldo}::numeric)` |
| B19 | `GET /api/admin/lotes?status&pagina&por_pagina` | RPC `admin_listar_lotes` |
| B20 | `GET /api/admin/lotes/:id` | RPC `admin_detalhe_lote` |
| B21 | `POST /api/admin/lotes` (201) | RPC `admin_gerar_lote_repasse` |
| B22 | `POST /api/admin/lotes/:id/exportado` (200) | RPC `admin_marcar_lote_exportado` |
| B23 | `POST /api/admin/lotes/:id/pago` (200) | RPC `admin_marcar_lote_pago` |
| B24 | `POST /api/admin/lotes/:id/cancelar` (200) | RPC `admin_cancelar_lote` |

**Usuários, atendimento, assinaturas e métricas**

| # | Rota | SQL |
|---|---|---|
| B25 | `GET /api/admin/usuarios?...` | RPC `admin_listar_usuarios` |
| B26 | `GET /api/admin/usuarios/:corretorId` | RPC `admin_detalhe_usuario` |
| B27 | `POST /api/admin/usuarios/:corretorId/status` (200) | RPC `admin_definir_status_corretor` |
| B28 | `GET /api/admin/atendimento?...` | RPC `admin_listar_atendimento` (`${origemDireta}::boolean`) |
| B29 | `GET /api/admin/assinaturas?...` | RPC `admin_listar_assinaturas` |
| B30 | `GET /api/admin/pagamentos?...` | RPC `admin_listar_pagamentos` |
| B31 | `GET /api/admin/cancelamentos?...` | RPC `admin_listar_cancelamentos` |
| B32 | `POST /api/admin/cancelamentos` (201) | RPC `admin_registrar_cancelamento` |
| B33 | `GET /api/admin/organizacoes?...` / `GET /api/admin/organizacoes/:id` | RPCs `admin_listar_organizacoes` / `admin_detalhe_organizacao` |
| B34 | `GET /api/admin/acessos?busca&pagina&por_pagina` | RPC `admin_listar_acessos` |
| B35 | `GET /api/admin/metricas?inicio&fim` | RPC `admin_metricas_visao_geral(${inicio}::date, ${fim}::date)` |
| B36 | `GET /api/admin/metricas/saas?inicio&fim` | RPC `admin_metricas_saas` |
| B37 | `GET /api/admin/metricas/cancelamento?inicio&fim` | RPC `admin_metricas_cancelamento` |
| B38 | `GET /api/admin/metricas/onboarding?inicio&fim` | RPC `admin_onboarding_metricas(${inicio}::timestamptz, ${fim}::timestamptz)` |
| B39 | `GET /api/admin/integracoes` | RPC `admin_status_integracoes()` |

`B35`–`B37` recebem `inicio`/`fim` como data (`YYYY-MM-DD`) e `B38` como timestamp; o front já manda `${inicio}T00:00:00` e soma um dia no fim para a métrica de onboarding — isso continua no front, sem mudança.

**Configuração e diagnósticos**

| # | Rota | SQL |
|---|---|---|
| B40 | `GET /api/admin/config` | RPC `admin_listar_config()` — é o que `useConfigAdmin` chama hoje |
| B40b | `GET /api/admin/config/linhas` | `select to_jsonb(c) as linha from public.admin_config c order by c.chave asc limit ${LIMITE_LISTA}::int` — é o `tabelaAdmin('admin_config').select('*').order('chave')` de `AdminConfiguracoes.tsx` |
| B41 | `PUT /api/admin/config/:chave` (200) | `update public.admin_config set valor = ${json}::jsonb, atualizado_em = now() where chave = ${chave}::text returning to_jsonb(admin_config.*) as linha`; nenhuma linha → 404 `config_desconhecida` |
| B42 | `POST /api/admin/config/:chave` (200) | RPC `admin_salvar_config(${chave}::text, ${json}::jsonb)` |
| B43 | `GET /api/admin/diagnosticos?pagina&por_pagina` | `select to_jsonb(d) as linha from public.commercial_diagnostics d order by d.created_at desc, d.id desc limit ${por}::int offset ${off}::int` (padrão `por_pagina = 200`, como o `.limit(200)` de hoje) |
| B44 | `PATCH /api/admin/diagnosticos/:id` | `update public.commercial_diagnostics set status = ${status}::text where id = ${id}::uuid returning to_jsonb(commercial_diagnostics.*) as linha`; nenhuma linha → 404 `diagnostico_nao_encontrado` |

`:chave` de B41/B42 vai por `@Param('chave')` com `@Matches(/^[a-z0-9_]{1,80}$/)` (400 `chave_invalida` "Chave de configuração inválida."), nunca por `Prisma.raw`. **B40b/B41 são o caminho que `AdminConfiguracoes.tsx` usa hoje** (leitura e UPDATE diretos, policy `admin_config: super_admin escreve`, com o gatilho `auditar_escrita_direta`); **B40/B42 são o que `useConfigAdmin`/`useSalvarConfig` usam** (RPCs `admin_listar_config` e `admin_salvar_config`, que validam a chave contra a lista interna). Os quatro existem porque as duas telas existem e as duas têm comportamento diferente — unificar é pendência §7.2.5.

---

## 2. Porte das Edge Functions

### 2.1 `parceiro-clique` → P1

Porte fiel, passo a passo, no caminho do dono:

1. **Origem.** Se `PARCEIRO_ORIGENS_PERMITIDAS` não está vazia e o cabeçalho `Origin` existe e não está na lista → 403 `origem_nao_permitida`. Sem `Origin` (chamada servidor a servidor, `curl`) segue, como hoje. O CORS em si continua a cargo de `api/src/main.ts`, que nenhuma frente edita (§7.2.6).
2. **Validação** pelo `CliqueDto` (slug e visitante). 400 do `ValidationPipe`.
3. **Resolver o link e o parceiro** (uma consulta; a `maybeSingle` + embed de hoje):
   ```sql
   select l.id as link_id, p.id as parceiro_id, p.nome, p.janela_atribuicao_dias
     from public.parceiro_links l
     join public.parceiros p on p.id = l.parceiro_id
    where l.slug = ${slug}::text and l.ativo and l.revogado_em is null and p.status = 'ativo'
    limit 1
   ```
   Nenhuma linha → `200 { ok: false }`. Resposta idêntica para slug inexistente, link revogado e parceiro inativo (§0.6.5). As quatro condições que hoje estavam no `if` do TypeScript viram `where`: o resultado é o mesmo e não há ramo para esquecer.
4. **`ip_hash`**: `sha256(`${salt}:${ip}`)` em hexadecimal, com `salt = IP_HASH_SALT` e `ip` do primeiro valor de `x-forwarded-for`, senão `x-real-ip`. Sem IP **ou sem `IP_HASH_SALT`** → `null` (§6.3).
5. **Clique** (melhor esforço, como hoje):
   ```sql
   insert into public.parceiro_cliques (link_id, parceiro_id, visitante_id, ip_hash, user_agent, referer, utm)
   values (${linkId}::uuid, ${parceiroId}::uuid, ${visitante}::uuid, ${ipHash}::text,
           ${truncar(uaDoCabecalho, 400)}::text, ${truncar(dto.referer ?? refererDoCabecalho, 400)}::text, ${utm}::jsonb)
   ```
   `utm` passa por `limparUtm` (allowlist dos 7 campos conhecidos, cada um truncado em 200) e vira `null` quando fica vazio. Erro aqui é **capturado e só registrado em log** (SQLSTATE), como hoje: a visita vale mais que a métrica. Por estar no caminho do dono, cada comando é um `$executeRaw` próprio, **fora** de transação — não há `run` para abortar, então engolir o erro aqui é seguro (a regra do módulo 2 §0.2 fala de erro engolido *dentro* de uma transação).
6. **Atribuição** — o coração da regra:
   ```sql
   insert into public.parceiro_atribuicoes
     (parceiro_id, link_id, visitante_id, modelo, janela_dias, expira_em, status)
   values (${parceiroId}::uuid, ${linkId}::uuid, ${visitante}::uuid, 'primeiro_clique',
           ${janela}::int, now() + make_interval(days => ${janela}::int), 'pendente')
   on conflict (visitante_id) do nothing
   ```
   `janela = janela_atribuicao_dias` da linha do parceiro (default 90 na coluna). `on conflict (visitante_id) do nothing` substitui o "23505 esperado" de hoje: o segundo parceiro não sobrescreve nada e nenhum erro é levantado. Qualquer outro erro é capturado e logado, como hoje. O `expira_em` passa a ser calculado **pelo banco** (`now() + make_interval`) em vez de pelo relógio do processo — mesmo valor, uma fonte de tempo só (§6.2).
7. **Resposta:** `200 { ok: true, parceiro_nome: nome }`. Erro inesperado em qualquer ponto → `200 { ok: false }` e log sem dado pessoal, como hoje.

### 2.2 `parceiro-atribuir` → T1

Autenticado pelo `SupabaseAuthGuard`; `user_id = claims.sub` e `email = claims.email`. Caminho do dono, na ordem de hoje:

1. **Já atribuído?** `select id from public.parceiro_atribuicoes where user_id = ${uid}::uuid limit 1` → `200 { ok: true, ja_atribuido: true }`. Sucesso silencioso: o app chama a cada login.
2. **Localizar a atribuição do visitante:**
   ```sql
   select a.id, a.expira_em, a.status, a.user_id, p.id as parceiro_id, p.nome, p.status as parceiro_status,
          p.email as parceiro_email, p.user_id as parceiro_user_id
     from public.parceiro_atribuicoes a join public.parceiros p on p.id = a.parceiro_id
    where a.visitante_id = ${visitante}::uuid limit 1
   ```
   Sem linha, ou `a.user_id is not null`, ou `a.status <> 'pendente'` → `200 { ok: false }`.
3. **Corretor do usuário:** `select id, email from public.corretores where user_id = ${uid}::uuid limit 1` (pode não existir).
4. **`motivoDeInvalidez`** — porte **literal** de `_shared/parceiro.ts`, com os mesmos quatro motivos e os mesmos textos (eles vão para `motivo_invalidacao`, uma coluna de auditoria, não para o cliente). `emailCorretor = corretor?.email ?? claims.email ?? null`. Havendo motivo:
   ```sql
   update public.parceiro_atribuicoes set status = 'invalidada', motivo_invalidacao = ${motivo}::text
    where id = ${id}::uuid
   ```
   e `200 { ok: false }`. A tentativa fica registrada, o que importa quando o motivo é autoindicação.
5. **Converter**, com as mesmas duas guardas de corrida:
   ```sql
   update public.parceiro_atribuicoes
      set user_id = ${uid}::uuid, corretor_id = ${corretorId}::uuid,
          status = 'convertida', convertido_em = now()
    where id = ${id}::uuid and status = 'pendente' and user_id is null
   returning id
   ```
   Nenhuma linha → `200 { ok: false }` (outra chamada ganhou a corrida). `23505` (de `uq_atribuicao_user`/`uq_atribuicao_corretor`) também → `200 { ok: false }`.
6. **Resposta:** `200 { ok: true, parceiro_nome: nome }`. Qualquer erro inesperado → `200 { ok: false }` e log: a atribuição nunca quebra o login.

`convertido_em` passa a vir de `now()` do banco em vez do relógio do processo (§6.2).

### 2.3 `parceiro-convidar` → T4, e a porta de envio

O porte mantém tudo o que não é envio de e-mail, no TenantDb (as RPCs e as tabelas já exigem admin):

1. **Criar, quando `acao: 'criar'`:** `select public.admin_criar_parceiro_completo(${dados}::jsonb) as resultado`. Sem `parceiro_id` no retorno → o erro do banco já foi traduzido (`23505` → 409 `parceiro_repetido`; `P0001` pela `MENSAGENS_RPC`). O `parceiro_id` criado é guardado para a resposta de falha parcial, como o `persistedPartnerId` de hoje. **Não** há mais `is_admin()` chamado pela API: a RPC já o faz.
2. **Carregar o parceiro:** `select id, nome, email, status, user_id, convite_status from public.parceiros where id = ${id}::uuid`. Sem linha → 404 `nao_encontrado`. `status <> 'ativo'` → 409 `parceiro_inativo`. `convite_status = 'aceito'` → 409 `convite_ja_aceito`.
3. **Termos e link** (as duas consultas de hoje):
   ```sql
   select percentual, base_calculo, valor_fixo, teto_renovacoes from public.parceiro_percentuais
    where parceiro_id = ${id}::uuid and vigencia_fim is null limit 1;
   select slug from public.parceiro_links
    where parceiro_id = ${id}::uuid and principal and ativo and revogado_em is null limit 1;
   ```
   O texto da regra de renovação é montado com as mesmas três variantes de hoje (`primeiro_pagamento`, `teto_renovacoes is null`, `até N renovações`), e `link_parceiro = ${PARCEIRO_APP_URL}/r/${slug}` ou `''`.
4. **Envio — atrás de uma porta.**

```ts
export const PORTA_CONVITE = Symbol('PORTA_CONVITE');

export interface DadosDoConvite {
  email: string;
  redirectTo: string;
  metadados: {
    tipo_acesso: 'parceiro'; parceiro_id: string; nome_parceiro: string;
    comissao: string; regra_renovacao: string; link_parceiro: string;
  };
  /** Já existe conta para este e-mail: o provedor manda acesso, não convite novo. */
  contaExistente: boolean;
}

export interface ResultadoDoConvite {
  /** user_id da conta no provedor de identidade, quando ele cria ou localiza uma. */
  userId: string | null;
  contaExistente: boolean;
}

export interface PortaDeConvite {
  enviarConvite(dados: DadosDoConvite): Promise<ResultadoDoConvite>;
}

/** Implementação viva até alguém escolher o provedor (§7.2.1). */
@Injectable()
export class ConviteSemProvedor implements PortaDeConvite {
  async enviarConvite(): Promise<ResultadoDoConvite> {
    throw erroApi(503, 'provedor_de_email_nao_configurado',
      'O envio de convites por e-mail ainda não está configurado no servidor.');
  }
}
```

A porta é injetada por `@Inject(PORTA_CONVITE)`. **Nenhuma chamada a `auth.admin.inviteUserByEmail`, `generateLink`, `updateUserById` ou `signInWithOtp` existe na API.** O `redirectTo` vem de `PARCEIRO_PORTAL_URL`; `contaExistente` é `parceiro.user_id !== null` (hoje o caminho de conta existente era escolhido por isso ou pelo texto do erro do provedor — a API usa só o dado do banco, §6.5).

5. **Resultado do envio.** Dois comportamentos, para o front não mudar:

| Situação | Banco | Resposta |
|---|---|---|
| porta devolveu `{ userId }` | `update public.parceiros set user_id = coalesce(${userId}::uuid, user_id), convidado_em = now(), convite_status = 'enviado' where id = ${id}::uuid` | `200 { ok: true, email, parceiro_id, existing_account?: true }` |
| porta recusou **e** um parceiro foi criado ou já existia nesta chamada | `update public.parceiros set convite_status = 'falhou' where id = ${id}::uuid` (em `run` próprio, depois do primeiro confirmado) | `200 { ok: false, parceiro_id, email_enviado: false, error: 'Cadastro salvo. O envio de convites por e-mail ainda não está configurado no servidor.' }` |
| porta recusou **e** a chamada era só reenvio (`parceiro_id`, sem `acao: 'criar'`) | `convite_status = 'falhou'` | **503** `{ statusCode: 503, codigo: 'provedor_de_email_nao_configurado', message: 'O envio de convites por e-mail ainda não está configurado no servidor.' }` |

A primeira linha preserva o fluxo do `useCriarParceiroConvidar`, que só exige `parceiro_id` na resposta e trata `email_enviado: false` como aviso — o cadastro não pode ser perdido porque o e-mail não saiu. A terceira dá o 503 explícito que o botão "Reenviar convite" precisa mostrar. O `update` de `convite_status = 'falhou'` roda **fora** do `run` que criou o parceiro (segundo `run`, melhor esforço, erro só em log), pela regra do módulo 2 §0.2.

6. **Mensagem única.** Qualquer falha de envio dá o mesmo texto para o operador; o motivo vai para log só com o código, nunca com e-mail ou resposta do provedor (§0.6.10).

### 2.4 `commercial-diagnostic` → D1

Porte fiel, no caminho do dono. `diagnostico/diagnostico.ts` é a cópia de `supabase/functions/_shared/commercial-diagnostic.ts` (perguntas, `validateAnswers`, `scoreDiagnostic`, `visibleQuestions`) — **nada do cálculo muda**, e o teste de §3.1 confere que a pontuação do porte é igual à do arquivo compartilhado para as mesmas respostas.

Sem `PUBLIC_RATE_LIMIT_SECRET` → 503 `diagnostico_nao_configurado` (hoje o fallback era a service key, que a API não lê, §6.3).

**`action: 'event'`:**
1. `EventoDiagnosticoDto`; `step` precisa ser `null` ou o `id` de uma pergunta conhecida, senão 400 `evento_invalido` "Evento inválido.".
2. Limite: `chave = hmacSha256(PUBLIC_RATE_LIMIT_SECRET, `diagnostic-event:${sessionId}`)` em hexadecimal; `select public.consume_public_request_limit('commercial-diagnostic-event'::text, ${chave}::text, ${50}::int, ${3600}::int) as ok`. `false` ou erro → 429 `muitas_tentativas`.
3. `insert into public.commercial_diagnostic_events (session_id, event, step) values (${sessionId}::uuid, ${event}::text, ${step}::text)`.
4. `event = 'cta_clicked'` → `update public.commercial_diagnostics set cta_clicked_at = now() where session_id = ${sessionId}::uuid` (melhor esforço; `now()` em vez do relógio do processo).
5. `200 { success: true }`.

**`action: 'submit'`:**
1. `consent !== true` → 400 `consentimento_ausente` "Confirme o uso dos dados para contato.".
2. Normalizar telefone exatamente como hoje: só dígitos; se começa com `55` e tem 12 ou 13 dígitos, tira o `55`; o local tem de casar `/^[1-9]\d{9,10}$/`, senão 400 `contato_invalido` "Confira nome, WhatsApp e e-mail.". O gravado é `55${local}` (o CHECK `commercial_diagnostics_phone_check` exige isso).
3. `validateAnswers(dto.answers)` — erro de resposta → 400 `respostas_invalidas` com o texto da função portada (é texto nosso, em português, não do Postgres).
4. Limite de lead: `select public.consume_public_lead_limit(${hash}::text) as ok` com `hash = hmacSha256(secret, `lead:55${local}`)`; `false` → 429 `muitas_tentativas`; erro → 503 `diagnostico_nao_configurado`.
5. `attribution` filtrada pela allowlist de 7 chaves (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `landing_page`, `referrer`), cada uma truncada em 300.
6. `scored = scoreDiagnostic(answers)`; `insert into public.commercial_diagnostics (...) values (... ${answers}::jsonb, ${attribution}::jsonb, ${scores}::jsonb, ${scored.secondary_problems}::text[] ...)`, com `consent_at = now()`. `23505` em `commercial_diagnostics_session_id_key` é **engolido** (reenvio da mesma sessão), como hoje.
7. Só quando o insert gravou: `insert into public.commercial_diagnostic_events (session_id, event) values ...` com `'diagnostic_completed'` e, se `commercial_fit_score >= 60`, também `'qualified_lead'`.
8. `200 { success: true, result: scored }`.

Os três `insert`s e o limite vão como `$executeRaw` separados, fora de transação (caminho do dono, nenhum `run`), exatamente como a função faz hoje com quatro chamadas independentes.

---

## 3. Testes obrigatórios

### 3.1 Jest (texto do SQL e lógica), em `api/`

Os testes leem `.text` e `.values` do objeto passado a `$queryRaw`/`$executeRaw` — nunca `.sql`, onde os parâmetros aparecem como `?`.

**`parceiros.erros.spec.ts`**
- cada linha da tabela de §0.4 produz o `status`, `codigo` e `message` exatos, a partir de um `PrismaClientKnownRequestError` P2010 com `meta.code`/`meta.message` montados à mão;
- **toda** entrada de `MENSAGENS_RPC` é alcançada (o teste itera a constante e confere que nenhuma cai no genérico);
- um `P0001` desconhecido (`'mensagem que a API nunca viu'`) vira 422 `regra_do_backoffice` com o texto genérico, e o texto do Postgres **não** aparece em lugar nenhum da resposta;
- `42501 'acesso negado'` com e sem `origem: 'portal'`;
- `22023` com `origem: 'portal'` ≠ `22023` sem origem;
- erro que não é do banco sobe como veio.

**`publico/utilitarios.spec.ts`** — paridade com `_shared/parceiro.ts`: `slugValido`, `visitanteValido` (recusa `'11111111-1111-1111-1111-111111111111'`, aceita v4), `limparUtm` (allowlist, trim, corte em 200, `null` quando vazio), `truncar`, `hashIp` (hex de 64, `null` sem IP, `null` sem salt), `ipDoRequest` (primeiro do `x-forwarded-for`, depois `x-real-ip`), e `motivoDeInvalidez` nos quatro motivos e no caso válido.

**`publico/parceiros-publico.service.spec.ts`** (TenantDb/Prisma falso)
- P1: a consulta de resolução tem `l.ativo`, `l.revogado_em is null` e `p.status = 'ativo'` no `.text`; sem linha devolve `{ ok: false }` e **nenhum** insert é feito;
- P1: o insert da atribuição tem `on conflict (visitante_id) do nothing` e `make_interval(days =>` no `.text`, e `janela_dias` em `.values` é o da linha do parceiro (90 no default e 30 quando a coluna diz 30);
- P1: erro no insert do clique não impede a resposta `{ ok: true }`; erro no insert da atribuição também não;
- P1: a resposta tem **só** `ok` e `parceiro_nome` (teste de chaves, para `parceiro_id` nunca escapar);
- P1: `Origin` fora de `PARCEIRO_ORIGENS_PERMITIDAS` → 403 `origem_nao_permitida`; lista vazia aceita;
- T1: `user_id` em `.values` é `claims.sub`, e um `visitante_id` qualquer no corpo não muda isso;
- T1: já atribuído → `{ ok: true, ja_atribuido: true }` sem update;
- T1: atribuição de outro dono / não pendente / inexistente → `{ ok: false }`;
- T1: cada motivo de invalidez grava `status = 'invalidada'` com o motivo e devolve `{ ok: false }`;
- T1: o update de conversão tem `and status = 'pendente' and user_id is null` no `.text`; zero linhas → `{ ok: false }`.

**`portal/portal.service.spec.ts`** — T2 chama as três RPCs na ordem fixada e monta `{ ...resumo, teto_renovacoes }`; `42501 'parceiro nao encontrado'` → 403 `parceiro_nao_vinculado`; T3 passa os três argumentos com `::text` e traduz `22023`.

**`convite/convite.service.spec.ts`**
- com uma porta falsa que devolve `{ userId }`: o update tem `convite_status = 'enviado'` e `convidado_em = now()`;
- com a `ConviteSemProvedor` real e `acao: 'criar'`: a RPC de criação é chamada, a resposta é `200 { ok: false, email_enviado: false, parceiro_id }` e o segundo `run` grava `'falhou'`;
- com a `ConviteSemProvedor` real e só `parceiro_id`: **503** `provedor_de_email_nao_configurado`;
- `status <> 'ativo'` → 409 `parceiro_inativo`; `convite_status = 'aceito'` → 409 `convite_ja_aceito`; parceiro inexistente → 404;
- nenhuma mensagem de erro do provedor aparece na resposta.

**`admin/admin.service.spec.ts`**
- para **cada** rota B1–B44 (incluindo B40b): o `.text` tem o nome da função ou da tabela certa, e `.values` tem os argumentos na ordem e com os casts esperados (o teste é uma tabela de casos, uma linha por rota);
- `offset` é `(pagina - 1) * por_pagina` e `por_pagina` tem os padrões 25 (geral), 50 (auditoria) e 200 (diagnósticos);
- B3 tem `::int` depois de `registrar_auditoria_admin(...)` (senão a resposta seria `BigInt` e o Nest quebraria ao serializar);
- B8 com corpo vazio → 400 `nada_para_atualizar`; B8/B11/B41/B44 sem linha → 404 com o código certo;
- B7 não grava nenhuma coluna fora de `COLUNAS_PARCEIRO`, e `criado_por` vem de `claims.sub`;
- **nenhuma** rota emite `update`/`delete` em `admin_auditoria` (o teste varre todos os `.text` gerados procurando a tabela).

**`admin/admin.controller.spec.ts`** e **`parceiros.controller.spec.ts`** — guard aplicado nas rotas autenticadas e ausente nas públicas; `ParseUUIDPipe` devolve 400 `id_invalido`; paridade de uuid entre a URL e o corpo (um id `'11111111-1111-1111-1111-111111111111'` aceito nos dois, módulo 2 §0.5); 400 do `ValidationPipe` para chave desconhecida.

**`diagnostico/diagnostico.service.spec.ts`**
- `scoreDiagnostic` do porte devolve exatamente o mesmo objeto que `supabase/functions/_shared/commercial-diagnostic.ts` para um conjunto de respostas fixado (import dos dois no teste);
- `consent: false` → 400; `answers` manipuladas (`profile: 'Administrador'`) → 400 e **nenhum** insert;
- telefone `'11999999999'` grava `'5511999999999'`; `'5511999999999'` também;
- `attribution` com chave fora da allowlist (`is_admin: 'true'`) é descartada;
- limite negado → 429, limite com erro → 503; sem `PUBLIC_RATE_LIMIT_SECRET` → 503;
- `23505` de `session_id` é engolido e os eventos de conclusão **não** são inseridos;
- `commercial_fit_score >= 60` insere `'qualified_lead'`.

### 3.2 SQL real (`api/test/sql-real/parceiros.test.ts`, `node --test`)

Mesmo molde de `api/test/sql-real/rotina.test.ts`: `criarBanco()` do harness (PGlite com todas as migrations, RLS ligado, TenantDb de produção), contas A e B, `capturarErroHttp` para os erros HTTP, `sqlSuperusuario`/`inserir` para montar dados. Nenhuma rede: a porta de convite é a `ConviteSemProvedor` (ou uma falsa), e nenhum provedor externo é chamado.

Dados de apoio montados por superusuário: um parceiro ativo com link principal, uma vigência de percentual, e o papel `admin` para a conta A em `public.user_roles` (é o que faz `is_admin()` dar true). A conta B fica **sem** papel.

Casos obrigatórios:

1. **Primeiro clique vence.** P1 com o slug do parceiro 1 e um `visitante_id`; depois P1 com o slug do parceiro 2 e **o mesmo** `visitante_id`. A tabela `parceiro_atribuicoes` tem **uma** linha, com `parceiro_id` do primeiro, e `parceiro_cliques` tem **duas**. As duas respostas são `{ ok: true, parceiro_nome }`.
2. **Janela de 90 dias.** Com `janela_atribuicao_dias` no default, `expira_em - primeiro_clique_em` está entre 89 e 91 dias. Com a coluna em 30, está entre 29 e 31. `janela_dias` gravado é o da coluna.
3. **Slug inexistente, link revogado e parceiro inativo** dão as três a mesma resposta `{ ok: false }` e **zero** linhas novas em `parceiro_cliques` e `parceiro_atribuicoes`.
4. **A resposta do clique não traz id nenhum:** `Object.keys` é exatamente `['ok','parceiro_nome']`.
5. **Conversão.** T1 com as claims da conta A e o `visitante_id` do clique: a linha fica `status = 'convertida'`, `user_id = A`, `corretor_id` = o corretor de A, `convertido_em` não nulo. Chamar T1 de novo devolve `{ ok: true, ja_atribuido: true }` e não muda a linha.
6. **Autoindicação por e-mail.** Parceiro com o mesmo e-mail da conta B; T1 com B deixa a linha em `status = 'invalidada'` com `motivo_invalidacao` começando em `'autoindicação'`, e devolve `{ ok: false }`.
7. **Janela expirada.** `expira_em` no passado → `'invalidada'` com motivo `'janela de atribuição expirada'`.
8. **Unicidade por conta.** Dois visitantes com cliques de parceiros diferentes; T1 com a conta A converte o primeiro e, para o segundo, `uq_atribuicao_user` impede a segunda conversão: a resposta é `{ ok: true, ja_atribuido: true }` (o passo 1 já encontra a linha) e a segunda atribuição continua `'pendente'`.
9. **Comissão nasce do gatilho.** B16 (registrar receita) para o corretor convertido no caso 5 cria **uma** linha em `parceiro_comissoes` com `percentual_aplicado` igual à vigência, `valor_base` igual ao bruto e `status = 'pendente'`; a API não escreve nessa tabela em nenhum momento.
10. **Estorno.** B17 põe a receita em `'estornado'` e a comissão em `'estornada'`, pelo gatilho `tr_estornar_comissao`. B17 de novo → 422 `receita_nao_confirmada`.
11. **Vigência.** B9 com uma vigência nova fecha a anterior (`vigencia_fim` preenchido pelo gatilho) e **não** muda `percentual_aplicado` das comissões já geradas.
12. **Auditoria append-only.** Depois de B7, B8 e B10, há linhas novas em `admin_auditoria` (os gatilhos `auditar_escrita_direta`/`auditar_mutacao_admin_direta` dispararam porque a escrita passou pelo TenantDb). Um `update public.admin_auditoria set acao = 'x'` por superusuário falha com a exceção de `bloquear_mutacao_admin_auditoria`. B2 lê as linhas; nenhuma rota do módulo as altera.
13. **B3** grava a trilha e devolve `{ id: number }` — e `typeof id === 'number'` (prova do `::int`).
14. **Isolamento por papel.** Com as claims da conta **B** (sem papel), B4, B6, B7, B9, B12, B16, B19, B21, B40, B41, B42, B43 e B44 dão todas 403 `sem_permissao` (`42501` das RPCs e das policies), e nenhuma linha é criada ou alterada. B1 com B devolve `[]`.
15. **Portal.** Parceiro com o e-mail da conta A: T2 devolve o resumo, carimba `convite_status = 'aceito'` e `user_id = A`, e `teto_renovacoes` é o da vigência. T3 com documento e chave coerentes grava `documento_beneficiario`, `tipo_chave_pix` e `chave_pix`; com chave de CPF diferente do documento → 422 `dados_de_repasse_invalidos`. T2 com a conta B (sem parceiro) → 403 `parceiro_nao_vinculado`.
16. **Convite.** T4 com `parceiro_id` de um parceiro ativo e a `ConviteSemProvedor` → 503 `provedor_de_email_nao_configurado` e `convite_status = 'falhou'`. T4 com `acao: 'criar'` → `200 { ok: false, parceiro_id }`, o parceiro **existe** no banco com link e vigência (a RPC `admin_criar_parceiro_completo` rodou), e `convite_status = 'falhou'`. T4 com a conta B → 403 `sem_permissao`.
17. **Lote de repasse.** Com uma comissão aprovada e dados de PIX completos: B18 lista o parceiro, B21 gera o lote, B22 marca exportado, B23 marca pago (a comissão vira `'paga'` e nasce um `parceiro_pagamentos`), e B24 depois disso → 422 `lote_pago`.
18. **Formato do PostgREST.** As linhas de B6 têm `numeric` como número JSON (`percentual`), `date` como `'YYYY-MM-DD'` (`vigencia_inicio`, `data_inicio`) e `timestamptz` com fuso (`criado_em` casando `/\+00:00$/`); o embed `corretores` é objeto ou `null`.
19. **Diagnóstico.** D1 `submit` grava a linha com `phone = '55...'` e os eventos `diagnostic_completed` (+ `qualified_lead` quando pontua) e devolve `result`. Repetir a mesma `session_id` não cria linha nem evento novo e responde `{ success: true }`. D1 `event` grava o evento; o 51º evento da mesma sessão → 429 `muitas_tentativas` (o limite real de `consume_public_request_limit` roda no PGlite). B43 com a conta A lista; B44 muda o status; com a conta B, as duas dão 403.
20. **`commitsAbortados` continua 0** no fim do arquivo (nenhum `run` termina com transação abortada), e nenhum teste usa `$queryRawUnsafe`/`$executeRawUnsafe`.

### 3.3 Front (`src/lib/api/parceiros.test.ts`, Vitest)

- cada função chama o caminho e o método fixos com o corpo esperado (mock de `chamarApi`);
- a query das listas sai montada só com os filtros presentes (`busca` vazio não vira `busca=`);
- 403 `sem_permissao` vira `AcessoNegadoError`; 503 `backoffice_nao_instalado` vira `BackOfficeNaoInstaladoError`; os demais viram `ErroApi` com a `message` em português;
- com `apiDisponivel()` falso, nenhum hook de admin chama função de `parceiros.ts` (um teste com mock, como o do módulo rotina).

---

## 4. Frente F: front

### 4.0 Regra geral

Toda troca fica atrás de `apiDisponivel()` (de `src/lib/api.ts`). Sem `VITE_API_URL`, **nenhuma linha de comportamento muda**: o ramo Supabase atual fica intacto, inclusive mensagens, chaves do React Query (`adminKeys`), invalidações, `retry: false`, `placeholderData` e os `toast` existentes. O import de `src/lib/api/parceiros.ts` pode ser estático (não há ciclo).

### 4.1 `src/lib/api/parceiros.ts`

Usa `chamarApi` (de `src/lib/api.ts`), `lerJson`, `corpoJson`, `escolher` e `ErroApi` (de `src/lib/api/http.ts`). Todas `async`, nomes fixos.

```ts
/** Relança nos tipos que o painel já distingue, antes de qualquer outro tratamento. */
function traduzir(e: unknown): never {
  if (e instanceof ErroApi) {
    if (e.codigo === 'backoffice_nao_instalado') throw new BackOfficeNaoInstaladoError();
    if (e.codigo === 'sem_permissao') throw new AcessoNegadoError(e.message);
  }
  throw e;
}
```

`BackOfficeNaoInstaladoError` e `AcessoNegadoError` continuam exportados de `src/lib/admin/api.ts` (importados aqui, não redefinidos), para `usePapeis().naoInstalado` seguir funcionando.

| Função | Rota | Retorno |
|---|---|---|
| `registrarCliqueApi({ slug, visitante_id, utm?, referer? })` | P1 | `{ ok: boolean; parceiro_nome?: string }` |
| `reivindicarAtribuicaoApi(visitanteId)` | T1 | `{ ok?: boolean; ja_atribuido?: boolean }` |
| `portalParceiroApi()` | T2 | `PortalData & { teto_renovacoes }` |
| `salvarRepasseApi({ documento, tipo_chave, chave })` | T3 | `void` |
| `convidarParceiroApi(corpo)` | T4 | `{ ok: boolean; parceiro_id?: string; email?: string; email_enviado?: boolean; error?: string }` |
| `meusPapeisApi()` | B1 | `string[]` |
| `listarAuditoriaApi(filtros)` / `registrarAuditoriaApi(entrada)` | B2, B3 | |
| `listarParceirosApi(filtros)` / `opcoesParceirosApi()` / `parceiroApi(id)` / `criarParceiroApi(dados)` / `editarParceiroApi(id, dados)` | B4–B8 | |
| `definirPercentualApi(parceiroId, dados)` / `criarLinkApi(parceiroId, dados)` / `revogarLinkApi(linkId)` | B9–B11 | |
| `listarComissoesApi(filtros)` / `transicionarComissaoApi(id, dados)` / `registrarPagamentoApi(dados)` | B12–B14 | |
| `listarReceitaApi(filtros)` / `registrarReceitaApi(dados)` / `estornarReceitaApi(id, motivo)` | B15–B17 | |
| `elegiveisRepasseApi(saldo)` / `listarLotesApi(f)` / `loteApi(id)` / `gerarLoteApi(dados)` / `marcarLoteExportadoApi(id)` / `marcarLotePagoApi(id, dados)` / `cancelarLoteApi(id, motivo)` | B18–B24 | |
| `listarUsuariosApi(f)` / `usuarioApi(corretorId)` / `definirStatusCorretorApi(corretorId, dados)` / `listarAtendimentoApi(f)` | B25–B28 | |
| `listarAssinaturasApi(f)` / `listarPagamentosApi(f)` / `listarCancelamentosApi(f)` / `registrarCancelamentoApi(dados)` | B29–B32 | |
| `metricasApi(p)` / `metricasSaasApi(p)` / `metricasCancelamentoApi(p)` / `metricasOnboardingApi(p)` / `statusIntegracoesApi()` | B35–B39 | |
| `listarConfigApi()` (B40, RPC) / `listarLinhasConfigApi()` (B40b, tabela) / `atualizarConfigApi(chave, valor)` (B41) / `salvarConfigApi(chave, valor)` (B42) | B40–B42 | |
| `listarDiagnosticosApi(f)` / `atualizarStatusDiagnosticoApi(id, status)` | B43, B44 | |

As três de organizações/acessos (B33, B34) ficam declaradas também, para o painel não ter rota sem função — nenhuma tela as usa hoje fora de `AdminOnboarding`/`AdminIntegracoes`, que já consomem `useSaasDados`.

### 4.2 Onde cada tela troca

| Arquivo | Com `VITE_API_URL` |
|---|---|
| `src/lib/admin/api.ts` | `chamarRpc(nome, args)` ganha, **no topo**, um despachante: quando `apiDisponivel()` e `nome` está no mapa `ROTAS_DA_API` (nome da RPC → função de `parceiros.ts`), chama a função e devolve o resultado; senão segue o caminho Supabase atual, intacto. `tabelaAdmin` **não** muda: as três telas que a usam (`useParceiro`, `useSalvarParceiro`, `useCriarLink`, `useRevogarLink`, `AdminConfiguracoes`, `AdminDiagnosticos`) trocam por função nomeada nos próprios arquivos. O despachante é o que mantém `useSaasDados.ts`, `useAtendimento.ts` e as páginas que só chamam RPC sem precisar de edição linha a linha. |
| `src/hooks/admin/usePapeis.ts` | `queryFn` vira `apiDisponivel() ? meusPapeisApi() : chamarRpc('meus_papeis')` |
| `src/hooks/admin/useAdminDados.ts` | `useParceiro` → `parceiroApi(id)`; `useSalvarParceiro` → `criarParceiroApi`/`editarParceiroApi`; `useCriarParceiroConvidar` → `convidarParceiroApi({ acao: 'criar', dados })`; `useCriarLink` → `criarLinkApi`; `useRevogarLink` → `revogarLinkApi`. O resto do arquivo não muda: já passa por `chamarRpc`. |
| `src/hooks/admin/useSaasDados.ts`, `useAtendimento.ts` | sem mudança além do despachante; só o `useConfigAdmin`/`useSalvarConfig` ganham o par `listarConfigApi`/`salvarConfigApi` |
| `src/pages/admin/AdminConfiguracoes.tsx` | a leitura vira `listarLinhasConfigApi()` (B40b, mesma ordem e mesmas colunas de hoje) e o `salvar` vira `atualizarConfigApi(chave, valorJson)` (B41); a conversão de número/texto para JSONB e a mensagem de erro ("Só um super admin pode alterar.") ficam **iguais** |
| `src/pages/admin/AdminDiagnosticos.tsx` | leitura vira `listarDiagnosticosApi({ por_pagina: 200 })` e `updateStatus` vira `atualizarStatusDiagnosticoApi(id, status)`; os mesmos textos de erro |
| `src/pages/admin/AdminParceiroDetalhe.tsx` | o botão de convite vira `convidarParceiroApi({ parceiro_id: id })`; `503 provedor_de_email_nao_configurado` cai no mesmo `toast.error` com a `message` da API, e `{ ok: false, error }` segue mostrando `resposta.error` |
| `src/pages/ParceiroPortal.tsx` | a `queryFn` vira `portalParceiroApi()` (uma chamada em vez de três) e o `save` vira `salvarRepasseApi(...)`. O ramo de erro passa a comparar **código** em vez de texto: `e instanceof ErroApi && e.codigo === 'parceiro_nao_vinculado'` mostra "Este e-mail ainda não está vinculado a um parceiro ativo."; qualquer outro, "Não foi possível carregar seu painel." No ramo Supabase, o `includes('parceiro')` de hoje continua como está |
| `src/pages/RedirectParceiro.tsx` | `supabase.functions.invoke('parceiro-clique', …)` vira `registrarCliqueApi({ slug, visitante_id, utm, referer })`. A trava do `StrictMode`, o `catch` silencioso, o `marcarAtribuicaoPendente(resposta.parceiro_nome)` só quando `ok`, e o `navigate(destino, { replace: true })` ficam idênticos |

`ROTAS_DA_API` de `src/lib/admin/api.ts` é um mapa explícito (nome da RPC → função de `parceiros.ts`), não um `fetch` genérico por nome: uma RPC nova sem rota continua indo para o Supabase em vez de falhar com 404.

**Não precisam de edição** (consomem só os hooks acima, e o despachante já cobre): `AdminVisaoGeral.tsx`, `AdminUsuarios.tsx`, `AdminUsuarioDetalhe.tsx`, `AdminParceiros.tsx`, `AdminComissoes.tsx`, `AdminReceita.tsx`, `AdminRepasses.tsx`, `AdminAuditoria.tsx`, `AdminAssinaturas.tsx`, `AdminPagamentos.tsx`, `AdminCancelamentos.tsx`, `AdminCampanha.tsx`, `AdminOnboarding.tsx`, `AdminIntegracoes.tsx`. A revisão de §5 confirma isso varrendo `src/pages/admin/` por `tabelaAdmin(`, `supabase.` e `.from(` — hoje só `AdminConfiguracoes.tsx`, `AdminDiagnosticos.tsx` e `AdminParceiroDetalhe.tsx` aparecem, e os três estão na tabela acima.

---

## 5. Integração (orquestrador, depois das frentes)

1. Adicionar `ParceirosModule` em `api/src/app.module.ts`.
2. Rodar `npm test` em `api/` (Jest + `node --test` do SQL real) e os testes do front.
3. **Revisão das travas de §0.6, uma por uma**, contra o diff: janela, unicidade por visitante, `on conflict do nothing`, nenhum id de parceiro na resposta pública, resposta uniforme, autoindicação registrada, auditoria sem `update`/`delete`, percentual congelado, vigência pelo gatilho, mensagem única do convite.
4. Fumaça local com `VITE_API_URL` apontando para a API local: `/r/<slug>` → cadastro → login (atribuição) → painel do parceiro; e no backoffice: criar parceiro, definir percentual, registrar receita, aprovar comissão, gerar lote, marcar pago.
5. Virada de produção (manual, fora deste contrato): variáveis no Railway (§0.5); `PARCEIRO_ORIGENS_PERMITIDAS` com a origem da LP e do app; CORS de `api/src/main.ts` liberando as mesmas origens para as duas rotas públicas (§7.2.6); Caddy roteando `/r/:slug` para o front como hoje; escolher o provedor de e-mail e implementar a porta (§7.2.1) **antes** de desligar a Edge `parceiro-convidar`; as Edges `parceiro-clique`, `parceiro-atribuir` e `commercial-diagnostic` ficam no ar até que `useAuth.tsx` e `CommercialDiagnostic.tsx` troquem (§7.1).

---

## 6. Decisões que mudam comportamento (só com `VITE_API_URL`)

1. **A regra de elegibilidade do clique virou `where`.** As quatro condições que o TypeScript checava depois do `select` (`link.ativo`, `revogado_em`, `parceiro` existe, `status = 'ativo'`) passam a estar na consulta. Resultado idêntico; um ramo menos para esquecer.
2. **Tempo vem do banco.** `expira_em`, `convertido_em`, `consent_at` e `cta_clicked_at` passam a usar `now()`/`make_interval` em vez do relógio do processo Node. Elimina divergência de relógio entre o processo e o Postgres na borda da janela de 90 dias.
3. **Nenhum fallback para a service key.** Hoje `IP_HASH_SALT` cai em `SUPABASE_SERVICE_ROLE_KEY` e o segredo de limite do diagnóstico também. Na API, sem `IP_HASH_SALT` o `ip_hash` vai `null` (a métrica de visitante distinto perde precisão, nada mais), e sem `PUBLIC_RATE_LIMIT_SECRET` o diagnóstico responde 503 claro. Usar a chave de serviço como salt criptográfico acopla dois segredos de propósitos diferentes: rotacionar um invalidaria o outro.
4. **O portal é uma chamada só.** T2 faz aceite + resumo + teto no mesmo `run`; hoje são três chamadas, a primeira sequencial e as outras duas em paralelo. Fica atômico: não existe mais o estado "aceite carimbado, resumo falhou".
5. **O caminho de "conta já existe" no convite sai de `parceiros.user_id`,** e não mais do texto do erro do provedor (`/already|registered|exists/i`). Casar mensagem de provedor é frágil e muda com a versão da biblioteca.
6. **Mensagem do backoffice por allowlist** (§0.4). Toda regra conhecida mantém o texto que o operador já vê; uma regra nova no banco, sem entrada na tabela, passa a mostrar o texto genérico em vez do `RAISE` cru. É de propósito: a API nunca repassa texto do Postgres que não reconhece.
7. **`ParceiroPortal` distingue erro por código,** não por `message.includes('parceiro')`. O texto deixa de ser contrato.
8. **Diagnósticos do admin ficam paginados** (`pagina`/`por_pagina`, padrão 200 — o mesmo teto de hoje). O defeito "falta paginação real" deixa de ser estrutural, embora a tela só use a primeira página até alguém mexer nela.
9. **O clique ganha a trava de origem no próprio handler** (`PARCEIRO_ORIGENS_PERMITIDAS`), e não só no CORS. O CORS protege navegador; a trava no handler protege também chamada direta.

Ficam **iguais** de propósito: clique e atribuição continuam "melhor esforço" e nunca quebram a visita nem o login; a atribuição continua sendo chamada a cada `SIGNED_IN`; `parceiro_cliques` continua sem rate limit (§7.2.3); o portal continua sem paginação de pagamentos (teto 50 dentro da RPC); `fachadasMaisAcessadas` e os outros defeitos de módulos vizinhos não são tocados.

---

## 7. Fora do escopo e pendências

### 7.1 Fora do escopo

- **`src/hooks/useAuth.tsx`** (`reivindicarAtribuicaoDeParceiro`, que hoje chama a Edge `parceiro-atribuir`). A rota **T1 existe** e está testada, mas o arquivo não pertence a nenhuma frente deste contrato: é o provedor de sessão do app inteiro e um erro ali derruba o login. Troca proposta, de uma linha, atrás de `apiDisponivel()`:
  ```ts
  const resposta = apiDisponivel()
    ? await reivindicarAtribuicaoApi(obterVisitanteId())
    : ((await supabase.functions.invoke('parceiro-atribuir', { body: { visitante_id: obterVisitanteId() } })).data as { ok?: boolean; ja_atribuido?: boolean } | null);
  ```
  Enquanto isso não acontecer, **a Edge `parceiro-atribuir` precisa continuar no ar**.
- **`src/pages/CommercialDiagnostic.tsx`** (página pública que posta em `${VITE_SUPABASE_URL}/functions/v1/commercial-diagnostic` com `apikey`). A rota **D1 existe**; a troca é `const api = apiDisponivel() ? \`${API_URL}/api/diagnostico-comercial\` : …` e cair fora do cabeçalho `apikey`. Fica de fora porque a página é anônima e não usa `chamarApi` (que exige sessão) — ela precisa de um `fetch` público próprio, decisão de quem cuidar da LP. Até então, **a Edge `commercial-diagnostic` continua no ar**.
- Fachadas, assinatura/cotas, onboarding, IA e o worker (inventário 14, outras seções).
- `admin_preparar_suporte` e `admin_sessoes_suporte` (modo de atendimento): dependem de criar sessão no Auth, que é o mesmo problema do provedor de identidade da §7.2.1.
- `admin_conceder_papel` / `admin_revogar_papel`: nenhuma tela as chama hoje; rota só quando a tela existir.
- Desligar as Edge Functions no Supabase e remover `supabase/functions/parceiro-*`.

### 7.2 Pendências (migrations propostas, **NÃO aplicadas**)

1. **Escolher o provedor de e-mail transacional do convite.** É a única peça do módulo sem implementação: hoje o convite sai do Supabase Auth (`inviteUserByEmail` / `generateLink` / `signInWithOtp`), que a API não tem como chamar sem a service key. A porta `PortaDeConvite` (§2.3) está pronta e a implementação viva responde 503. Falta decidir **duas** coisas, que são separáveis: (a) o provedor de **e-mail** (Resend, SES, Postmark…), para o texto do convite; (b) o provedor de **identidade**, que cria a conta e o link de definição de senha — enquanto o login for Supabase Auth, isso exige uma chave de serviço no Railway, ou manter a Edge `parceiro-convidar` só para esse passo. Sem (b), nem o provedor de e-mail resolve: o convite precisa de um link válido. Nenhuma linha de código aqui assume uma resposta.
2. **Índice para a listagem de diagnósticos** (B43 ordena por `created_at desc, id desc` e não há índice):
   ```sql
   create index if not exists idx_commercial_diagnostics_created_at
     on public.commercial_diagnostics (created_at desc, id desc);
   ```
3. **Limite público no clique.** `parceiro_cliques` não tem rate limit: qualquer um pode inflar a métrica de um parceiro em loop (a atribuição está protegida pelo unique, a contagem de cliques não). Proposta, reusando o que já existe:
   ```sql
   -- nenhuma migration necessária; basta o módulo chamar, com um scope novo:
   select public.consume_public_request_limit('parceiro-clique', <hmac do ip_hash>, 60, 3600);
   ```
   e um `GRANT EXECUTE ON FUNCTION public.consume_public_request_limit(text,text,integer,integer) TO authenticated;` **não** é preciso (o caminho é o do dono). Fica como pendência porque muda a métrica e precisa de decisão de produto sobre o teto.
4. **Índice para a busca de atribuição por visitante.** `uq_atribuicao_visitante` já cobre o `where visitante_id = …` de T1; `parceiro_cliques` tem `idx_cliques_visitante`. Nada a fazer — registrado para a revisão não procurar de novo.
5. **Um caminho só para `admin_config`.** Hoje `AdminConfiguracoes.tsx` faz `UPDATE` direto (policy de super_admin + gatilho de auditoria) e `useSalvarConfig` chama `admin_salvar_config` (que valida a chave contra uma lista). As duas rotas (B41 e B42) existem para não mudar comportamento, mas uma delas deve sumir. Proposta: manter só a RPC e revogar a escrita direta:
   ```sql
   revoke insert, update, delete on table public.admin_config from authenticated, anon;
   drop policy if exists "admin_config: super_admin escreve" on public.admin_config;
   ```
   (aplicar **junto** com a remoção de B41 e da tela que a usa, nunca antes).
6. **CORS das duas rotas públicas em `api/src/main.ts`.** Nenhuma frente edita esse arquivo; a integração precisa liberar as origens da LP e do app para `POST /api/parceiros/clique` e `POST /api/diagnostico-comercial` (as outras rotas já são autenticadas e não são chamadas por outra origem).
7. **`anon` tem grants amplos em tabelas do programa de parceiros** (`INSERT, SELECT, UPDATE` em `parceiros`, `parceiro_links`, `parceiro_percentuais`, `receita_eventos` e `admin_config`), segurados apenas pelas policies de `is_admin()`/`is_super_admin()` — e `admin_config` dá a `anon` até `DELETE`. É defesa em profundidade que falta, não um furo conhecido. Proposta:
   ```sql
   revoke insert, update, delete on table public.admin_config from anon;
   revoke insert, update on table public.parceiros, public.parceiro_links,
     public.parceiro_percentuais, public.receita_eventos from anon;
   ```
   Conferir antes se nenhuma função `SECURITY INVOKER` chamada por `anon` depende disso.
8. **`parceiro_atribuicoes` não tem índice por `link_id`**, usado pela agregação de campanhas em `parceiro_portal_resumo` e por `admin_listar_atendimento`:
   ```sql
   create index if not exists idx_atribuicoes_link on public.parceiro_atribuicoes (link_id);
   ```
9. **Expirar atribuições pendentes.** `status = 'expirada'` existe no CHECK mas ninguém o escreve: uma atribuição pendente fica assim para sempre, e a invalidez só é apurada na conversão. Proposta (job, não migration): um comando diário `update public.parceiro_atribuicoes set status = 'expirada' where status = 'pendente' and expira_em < now()`. Fora deste contrato porque exige decidir onde o job mora (BullMQ, como o do Google, ou pg_cron).
10. **`parceiro_portal_resumo` devolve `'teto_renovacoes', NULL` fixo** e por isso o front precisa de uma segunda RPC (`parceiro_portal_teto_renovacoes`). T2 já esconde isso do front; consertar a RPC e apagar a segunda chamada é pendência:
    ```sql
    -- em parceiro_portal_resumo, trocar 'teto_renovacoes', NULL por 'teto_renovacoes', v_regra.teto_renovacoes
    ```
11. **`admin_listar_atendimento`, `admin_detalhe_usuario` e `admin_metricas_*` são monolíticas** e concentram muita lógica em PL/pgSQL. A API as chama fielmente de propósito, para esta onda não virar reescrita. Quebrar em consultas da API é projeto à parte.
