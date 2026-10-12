# WL-G1-QA — inventário de validação do snapshot G0

Responsável: Testes e QA, independente da implementação. Data: 2026-10-11.
Base de coordenação: `C:/Users/Gabri/Documents/Codex/Engenharia`.
Referência: `projetos/lotti-white-label`, branch `main`, HEAD confirmado `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`.

## Método e evidência

Inventário estático; nenhum teste, build, lint, typecheck, instalação, migration ou deploy executado. Não foram lidos `.env`, credenciais ou dados reais. Somente este relatório foi criado; core e handoff preservados conforme o brief. As referências abaixo são relativas à raiz do core e apontam para G0, não para ambientes publicados.

Comandos executados: `maestri list` (exit 0, Testes e QA conectado ao Orquestrador de Engenharia); `git rev-parse HEAD` (exit 0, SHA acima); `git branch --show-current` (`main`); `git status --short`, `git diff --stat` e `git diff --cached --stat` (saídas vazias). Leituras com `Get-Content`, inventário com `rg --files` e buscas dirigidas com `rg -n`. Uma busca inicial com glob literal em paths no PowerShell falhou (erro 123); foi substituída por diretórios e filtros `-g`. Isso é falha de busca, não defeito nem falha de teste.

Instruções aplicáveis: `../../AGENTS.md` da coordenação e `AGENTS.md:1`, que exige conferir Git e handoff. `AI_HANDOFF.md:1936` descreve a ambiguidade de múltiplas memberships e o índice de membership ativa única; o histórico não é evidência de testes executados nesta tarefa. Não atualizar o handoff é restrição explícita do brief atual. Nenhum AGENTS/HANDOFF adicional foi localizado nas áreas pesquisadas (`api`, `src`, `scripts`, `supabase`, `.github` e `sistema`).

## Suítes positivas e negativas localizadas

| Camada / referências | Casos positivos existentes | Casos negativos existentes / alcance |
|---|---|---|
| TenantDb unitário — `api/src/prisma/tenant-db.spec.ts:24` | Claims e papel authenticated aplicados antes da consulta na mesma transação; claims de suporte preservadas | Claims sem sub/anon recusadas antes de abrir transação. Prisma falso; não prova RLS sozinho |
| Harness SQL — `api/test/sql-real/harness.test.ts:43`, `:52` | Contexto A/B resolve corretor e lê seus registros pelo TenantDb real | Conta A não lê nem atualiza cliente B; claims anon/service_role/sem sub recusadas; erros reais SQL/RLS traduzidos |
| Baseline / cópia — `api/scripts/schema/baseline.test.mjs:65`, `:72`, `:116`; `api/scripts/dados/copiar.test.mjs:74` | Gatilho de cadastro cria corretor; visões RLS preservadas após cópia fictícia | Isolamento por claims, privilégios perigosos negados, histórico alheio bloqueado; não executa cópia de produção na QA |
| Login — `api/test/sql-real/auth.test.ts:38`, `:73`, `:103`; `api/src/auth/supabase-auth.guard.spec.ts:37` | JWT próprio válido, sub preservado resolve mesmo corretor, rotação/revogação de refresh | RLS sem policies em tabelas privadas; token ausente, Supabase, outra assinatura e configuração sem chave recusados |
| Imóveis — `api/test/sql-real/imoveis.test.ts:127`, `:191`, `:242` | Listagem própria e criação com corretor resolvido no banco | ID alheio/inexistente retorna 404; UUID malformado 400; lista de interessados sem vínculo fica vazia |
| Clientes — `api/test/sql-real/clientes.test.ts:442`, `:530`, `:538`, `:552` | Operações próprias nos fluxos da suíte | Histórico alheio recusado e ilegível; etapa, lead e cliente cruzados recusados; exclusão alheia 404 |
| Financeiro — `api/test/sql-real/financeiro.test.ts:203`, `:216`, `:246`, `:261`, `:283`, `:330`, `:345` | Listagens e alterações próprias, fatura idempotente, repasse próprio | Lançamento/fatura/contrato/repasse alheios recusados; TenantDb não lê tabela privada de credenciais |
| Contratos / arquivos — `api/test/sql-real/contratos.test.ts:172`, `:227`, `:344`, `:404`; `api/test/sql-real/arquivos.test.ts:57`, `:71`, `:81` | CRUD documental próprio; dono vê key de documento e anexo IA | Sem conta 403, sem cota 402, função privilegiada inacessível ao TenantDb; outra conta não recebe key; claims inválidas recusadas |
| IA — `api/test/sql-real/ia.test.ts:96`, `:107`, `:118`, `:132`, `:282`, `:383`, `:420`, `:435` | Conversas, mensagens, ferramentas e propostas da conta própria | Renomear/apagar/conversar/confirmar ação/anexar/descrever com IDs alheios bloqueado; cliente alheio não alterado |
| WhatsApp — `api/test/sql-real/whatsapp.test.ts:7`, `:209`, `:225` | RPCs e prévia da última mensagem da própria conta; envio com citação | RLS entre contas e citação inválida recusada; não equivale a envio real de WhatsApp |
| Rotina / org — `api/test/sql-real/rotina.test.ts:82`, `:93`, `:100`, `:141`, `:146`, `:158`, `:168`, `:216`, `:258`, `:272`, `:320` | Membership e organização próprias; CRUD, conflito, inbox, calendário | Membership suspended gera contexto null/403; membro/cliente/responsável/agenda/item/calendário de outra org bloqueado; tabela backend-only 42501 |
| Administração — `api/test/sql-real/parceiros.test.ts:364`, `:389`, `:533`; `supabase/migrations/admin-backoffice-authz.test.ts:203`, `:221`, `:245` | Rotas administrativas com papel autorizado; RPC com papel responde | Conta sem papel 403 e sem alteração; RPCs e tabelas fechadas; bootstrap super_admin inacessível a anon/authenticated |
| Suporte — `api/test/sql-real/suporte.test.ts:78`, `:94`, `:129`, `:185`, `:193`; `api/src/auth/supabase-auth.guard.suporte.spec.ts:110`, `:129`, `:188` | Admin abre sessão temporária do titular, escrita auditada e encerramento | Sem papel/conta elegível, sessão vencida/encerrada, papel revogado, ator/titular/sessão adulterados e falta de banco recusados |
| Público / integrações — `api/test/sql-real/publico-integracoes.test.ts:172`, `:199`, `:226`, `:243`, `:259`, `:277`; `supabase/migrations/public-security.test.ts:31`, `:47`, `:64` | Lead com imóvel vai ao dono; integrações consultam conta indicada; QR público permitido com campos restritos | Sem dono inequívoco não atribui a uma conta arbitrária; vínculo com imóvel/cliente alheio negado; rate limits e acessos diretos restritos |
| Front: cache e papéis — `src/lib/auth/isolamentoSessao.test.ts:14`, `:28`, `:37`; `src/hooks/useAuth.api.test.tsx:60`, `:79`; `src/lib/admin/permissoes.test.ts:51`, `:75` | Limpa QueryClient/CRM na troca de usuário/logout; mantém refresh da mesma pessoa; matriz admin/super_admin | Papel desconhecido/ausente não concede acesso; admin não concede papéis. Testes de função/hooks e mocks, não duas abas reais |
| Front: suporte — `src/hooks/useAuth.suporte.api.test.tsx:62`, `:73` | Usuário efetivo titular; encerramento volta ao backoffice | Falha de encerramento mantém sessão válida e informa erro; API mockada |

Suítes adicionais em `api/test/sql-real/`: `assinatura`, `perfil-cadastro`, `funil`, `fachadas`, `imoveis-fotos`, `central-comercial`, `checkout`, `diagnostico-crescimento`, `agendamentos`, `visitas-agente`. Foram inventariadas por caminho; não atribuir a elas cobertura white-label completa sem revisar os casos. Em `diagnostico-crescimento.test.ts:323`, `:348`, `:415` há leitura admin autorizada, não-admin 403 e grants/RLS fechados para anon/usuário comum. Checkout cobre revogação após senha e conflito de conta em `checkout.test.ts:235`, `:286`.

## Fixtures e SQL manual

- `api/test/sql-real/harness.ts:89` define os IDs fictícios A/B; a interface de fixtures inclui `criarConta` e `criarBanco()` começa em `:453`. O banco aplica em memória as migrations de `api/prisma/migrations`, cria contas via gatilho `auth.users` e monta TenantDb real sobre adaptador Prisma falso. A tem assinatura ativa e limite de imóveis; B não tem plano. Logo uma negativa 402 por cota não deve ser confundida com negativa de isolamento.
- O harness usa PGlite local, extensões pgcrypto/uuid_ossp e timezone UTC, sem banco remoto. `inserir`/`sqlSuperusuario` montam fixtures fora de RLS; `semGatilhos` pode desligar triggers/FKs somente na preparação. Não contam como prova de autorização. O comentário inicial documenta PG18.3, conexão única, precisão de milissegundos e ausência de corrida real entre transações; o driver Prisma é adaptado, não conexão Prisma/Postgres real.
- `supabase/tests/admin_rls.sql:18` monta usuários/corretores fictícios em transação com rollback. Casos incluem corretor comum sem backoffice, RPC sem papel, admin sem autopromoção, auditoria append-only, suspensão (`:138`) e proibição de alterar próprio status (`:166`). Pré-requisito declarado: migrations `20260814*`. Script manual, fora do glob Vitest; não presumir atualizado ao runtime próprio.
- `supabase/tests/routine_rls.sql:17` monta proprietário, gestor, colaborador e outsider. Não monta um administrador para completar quatro papéis. Casos `:47`–`:233`: org externa bloqueada, privacidade de evento, delegação negada/permitida, credenciais backend-only, WITH CHECK em responsável, auditoria não forjável, vínculo CRM cruzado e CRUD. Pré-requisito declarado: migration `20260821004218`; termina em rollback. `onboarding_ativacao.sql` e `manual-inbox.sql` também existem como scripts manuais.
- Os testes em `supabase/migrations/*.test.ts` não são todos textuais: `public-security` e `admin-backoffice-authz` executam SQL com PGlite. Devem ser classificados individualmente; não equivalem automaticamente ao conjunto de migrations API G0.

## Browser tests

- `scripts/security-smoke.mjs:1`: Chromium headless sobre `dist`, headers de `vercel.json`, servidor efêmero em loopback e tráfego externo interceptado. Asserts: login renderiza senha, CSP bloqueia script inline, `/rotina` sem login redireciona a `/auth`, sem pageerror. Não usa contas reais, API autenticada, dois tenants ou troca de aba.
- `scripts/screenshots.mjs:1`, `:12`, `:185`, `:191`: inspeção visual com JWT fictício no localStorage, mocks Supabase, `BASE_URL` default `http://localhost:8087`, `VIEWPORTS` opcional e diretório de saída por argumento (default `./shots`). Produz imagens, não aceite de RLS. A interceptação observada é Supabase; antes de usar com runtime API, exigir ambiente local sintético e bloqueio de rede adequado.
- `scripts/diagnostic-smoke.mjs:15`, `:21`: fluxo público em `http://127.0.0.1:8085/diagnostico`, mock da Edge commercial-diagnostic, viewports 375/390/430/1440, asserts de fluxo/overflow/submissão, saída em `output/diagnostico-smoke`. Não valida org autenticada.
- Não foi localizado runner/config Playwright Test na busca dirigida; Playwright é usado diretamente pelos scripts. Testes React com jsdom não são browser E2E; `useAuth.api.test.tsx:1`, `:16` declara jsdom e mocks da API.

## Scripts exatos e baseline futura (NÃO EXECUTADA)

`package.json`, objeto scripts:

```json
{
  "dev": "vite",
  "build": "vite build",
  "build:dev": "vite build --mode development",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit -p tsconfig.app.json",
  "audit:security": "npm audit --omit=dev --audit-level=low",
  "test:security-browser": "node scripts/security-smoke.mjs"
}
```

`api/package.json`, objeto scripts:

```json
{
  "postinstall": "prisma generate",
  "build": "prisma generate && tsc -p tsconfig.build.json",
  "start:prod": "prisma migrate deploy && node dist/main.js",
  "test": "jest && node --test scripts/schema/*.test.mjs scripts/dados/*.test.mjs && node --import tsx --test test/sql-real/*.test.ts",
  "typecheck": "tsc --noEmit",
  "schema:gerar": "node scripts/schema/schema-local.mjs && prisma format",
  "schema:producao": "node scripts/schema/gerar-schema.mjs"
}
```

| Local / comandos candidatos | Pré-condições / efeito |
|---|---|
| Root: `npm test`, `npm run typecheck`, `npm run lint` | Dependências já disponíveis e snapshot fixo; mocks e variáveis fictícias necessárias. Vitest exclui `api/**` em `vite.config.ts`; logo root test não substitui API test |
| API: `npm test`, `npm run typecheck` | Node >=22 (`api/package.json`), Jest/tsx/PGlite disponíveis e Prisma Client já gerado. Test agrega três etapas em sequência; falha inicial impede etapas seguintes |
| API isolado: `npx jest --runInBand`; `node --test scripts/schema/*.test.mjs scripts/dados/*.test.mjs`; `node --import tsx --test test/sql-real/*.test.ts` | Comandos derivados dos scripts; só usar npx com binário local já instalado, sem instalação automática. Globs do Node são os declarados no package; conferir compatibilidade do shell/Node do ambiente futuro |
| Root: `npm run build`, depois `npm run test:security-browser` | Build escreve `dist`, pode carregar env pelo Vite; rodar futuramente em ambiente isolado com env sintético. Chromium já provisionado; smoke inicia servidor e browser |
| API: `npm run build` | Gera Prisma Client e `dist`; não é comando somente leitura. Requer contexto separado/autorizado |
| SQL manual: arquivos `supabase/tests/*.sql` | PostgreSQL descartável com schema/migrations compatíveis, permissões para criar fixtures e alternar papel; executar arquivo integral com rollback. Nenhum comando remoto proposto para G1 |
| `node scripts/diagnostic-smoke.mjs`; `node scripts/screenshots.mjs` | Servidor local sintético nos endereços acima, Chromium, saída autorizada e integração real desligada; screenshots requer revisão de compatibilidade com API própria |

`start:prod`, `schema:gerar`, `schema:producao`, `postinstall`, instalação e auditoria de rede não foram acionados. `start:prod` explicitamente aplica migrations; não deve ser usado como baseline de QA somente leitura.

CI real: somente `.github/workflows/security.yml` localizado. Dispara em push/PR, contents read.
- Job `api`, Ubuntu, cwd `api`, Node22, cache `api/package-lock.json`: `npm ci` → `npm test` → `npm run build`.
- Job `verify`, Ubuntu, Node24, timeout15min, env fictício `VITE_SUPABASE_URL=https://example.supabase.co` e `VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key`: `npm ci` → `npm run audit:security` → `npm test` → `npm run build` → `npx playwright install chromium --with-deps --only-shell` → `npm run test:security-browser`.
- Nenhum typecheck, lint, SQL manual ou browser autenticado multi-tenant declarado nesses jobs. Não executei nem consultei runs remotos de CI; sucesso histórico não é baseline G0 medida nesta tarefa.

## Lacunas adversariais para white-label

O contrato de quatro papéis white-label não foi fornecido nesta tarefa. Não inferir sua equivalência aos papéis globais admin/super_admin ou aos sete valores de rotina: `api/prisma/migrations/0_init/migration.sql:9966` admite proprietário, administrador, gestor, corretor, financeiro, jurídico e colaborador. O Orquestrador deve fixar a matriz de produto antes de definir aceite executável.

| Eixo | Evidência existente / lacuna | Aceite adversarial futuro proposto, sem implementação |
|---|---|---|
| Dois tenants | Fixtures A/B e negativas por corretor existem; não provam tenant white-label independente de org/corretor | Dois tenants com dados sintéticos equivalentes; CRUD, busca, agregação, exportação, anexos, jobs e rotas públicas. Dono permitido; outro tenant sem conteúdo e sem efeitos laterais; verificar estado depois da negativa |
| Quatro papéis | Proprietário/gestor/colaborador aparecem no SQL manual; admin/super_admin globais têm testes próprios; sem matriz 2×4 localizada | Um principal por papel em cada tenant, permissões de leitura/escrita/delegação/admin fixadas no brief; repetir por API e RLS, incluindo escalada via payload e RPC direta |
| Multi-org | `0_init/migration.sql:10622` tem índice único de membership active por usuário; `rotina.service.spec.ts:74` espera contexto `limit 1`; sem escolha multi-org comprovada | Decidir primeiro se múltiplas orgs simultaneamente ativas são permitidas. Testar cadastro/transição/seleção e contexto determinístico conforme decisão; não tratar violação do índice atual como bug sem novo contrato |
| Suspensão | SQL manual cobre corretor suspenso; rotina SQL cobre membership suspended; suporte cobre papel revogado | Suspender tenant/org/membro durante sessão, refresh, stream, job e requisição em voo; acesso seguinte recusado, caches limpos, nenhuma gravação após revogação; reativação não devolve privilégio indevido |
| Troca de aba | Cache é testado por mudança de usuário na mesma instância; suporte tem mocks; smoke não abre duas abas | Duas abas com login/logout/troca de tenant/org/suporte; storage e refresh compartilhados, resposta atrasada do tenant antigo e retorno ao foco; nenhuma renderização ou mutação com contexto anterior |
| IDs cruzados | Casos por cliente, imóvel, agenda, conversa, key e citação existem; não foi comprovada matriz uniforme de todos os endpoints | Tenant A com IDs de B em path/query/body, relações e listas mistas; org distinta no mesmo tenant e tenant distinto; negar sem alteração parcial e sem revelar dados. Repetir com papéis mínimos e privilegiados |
| Concorrência / produção | PGlite uma conexão + adaptador Prisma; sem teste de pool real localizado para esta matriz | PostgreSQL descartável com Prisma real e conexões concorrentes; confirmar claims locais não vazam pelo pool, revogação e corridas. Não usar dados ou credenciais de produção |

## Parecer e limites

Inventário G1 entregue; não é aprovação funcional ou de segurança do white-label. Testes existentes têm base útil de RLS/contas/org/suporte, mas a matriz white-label completa permanece não verificada. Não há percentual de cobertura medido, contagem de testes executados ou resultado verde nesta tarefa. SQL manual e handoff histórico não demonstram aplicação no ambiente atual. Nenhum novo teste foi criado. Próximo passo: Orquestrador fixar papéis e semântica multi-org e aprovar ambiente sintético de validação futura; manter G0 como referência imutável.
