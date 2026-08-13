# Memória compartilhada — Codex ↔ Claude

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

Última leitura: **2026-08-12 — Codex**.

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

- `package.json` oferece: `npm run typecheck`, `npm test`, `npm run build` e `npm run lint`.
- `npm test -- --run supabase/functions/_shared/telefone.test.ts`: **8/8 passaram**.
- `npm run build`: **passou** (4466 módulos).
- Smoke test da função publicada: HTTP 401 sem token, resposta esperada da autenticação
  interna e confirmação de que o endpoint versão 6 está ativo.
- `npm run typecheck`: ainda falha na baseline de outras áreas (tipos desatualizados do
  Supabase, assinatura e fachadas). A filtragem não encontrou erro nos arquivos desta
  correção de cobrança.

## Próximos passos sugeridos

1. Rodar o teste específico de `src/lib/crm/historico.test.ts`.
2. Rodar `npm run typecheck` e `npm run build`.
3. Corrigir somente erros introduzidos por este conjunto de mudanças; separar baseline.
4. Revisar a migration do inbox contra o schema e os tipos atuais do Supabase.
5. Testar manualmente: abrir cliente, carregar timeline e registrar contato/WhatsApp.

## Diário de handoff

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

### 2026-08-13 — Claude (produção destravada: merge da autenticação + deploy)

**Sintoma:** a produção ficou 13 horas servindo código velho, sem ninguém ser avisado.
Três deploys de produção criados pelos pushes do Rafael (22:18, 22:30 e 22:58 de 12/08)
nunca chegaram a `Ready`, então o alias `olivercrm.vercel.app` continuou preso ao deploy
das 22:00 (`b221ynn14`, commit `5423d70`). O commit `chore: dispara novo deploy` mostra
que ele percebeu e tentou forçar; a tentativa seguinte falhou igual.

**O webhook não falhou** — os três deploys existem, com `target: production`. O problema
foi o build não completar, não o gatilho.

**Causa: transitória, do lado da plataforma.** Descartado que fosse o código: `npm ci` +
`npm run build` no commit `14e85f7`, em worktree limpo, **passou em 48s**; nenhum import
`@/` quebrado ou com caixa errada nos 191 arquivos (o clássico "passa no Windows, quebra
no Linux"); `package.json` intacto e o diff do lock só removendo marcadores `"peer"`.
Corroborando: o primeiro `git push` desta sessão foi rejeitado pelo GitHub com
`Internal Server Error` e funcionou na segunda tentativa, sem nenhuma alteração.

**O que foi publicado:** `b3d8cb7` (merge), deploy `jfnhcdror`, **Ready em 25s**.

Ordem usada no Git, e ela importa:

1. `git revert --no-edit 5423d70` na `main` **antes** do merge (gerou `6fe3478`). A base
   comum entre `main` e `feat/auth-multiusuario` é o próprio `7ccd1be`; num merge direto o
   revert venceria e as correções de segurança sumiriam em silêncio — junto com o retorno
   do contorno antigo em `BillsList.tsx`, que este arquivo manda não restaurar.
2. `git merge feat/auth-multiusuario`. Conflito em **um único arquivo**, `src/App.tsx`
   (rotas de recuperação de senha vs. os preloaders de rota do Rafael). Resolvido mantendo
   os dois lados.

**Validações:** `npm test` **71/71**; `npm run typecheck` **74 erros — a mesma baseline,
nenhum novo**; lint só com o aviso de `react-refresh` em `useAuth.tsx`; `npm run build` OK.

**Verificação em produção, por conteúdo e não por painel:** `olivercrm.vercel.app` serve
`<title>Lotti</title>` (mudança do Rafael, antes era o título antigo); `/recuperar-senha` e
`/nova-senha` respondem 200; e o bundle servido contém `AuthProvider`,
`E-mail ou senha incorretos` e `lotti:ultimo-email`.

**Falta conferir com credencial real:** login de um usuário existente. A troca do `useAuth`
de hook para Context é a mudança mais arriscada do lote e nenhum teste automatizado cobre
esse caminho.

**Continua aberto, e o deploy verde NÃO resolveu:** as migrations de
`supabase/migrations/` voltaram ao repositório, mas migration em arquivo não é migration
aplicada. Enquanto o conteúdo de `deploy-manual/` não for colado no painel do Supabase, um
usuário ainda alcança dado de outro. Também segue pendente rotacionar a chave da Evolution.

**Observação de higiene:** o commit `5954157` trouxe ~10 MB de binários (`output/*.pptx`,
`docs/*.xlsx`) que agora estão na `main`. Não quebram o build nem entram no bundle, mas não
pertencem ao repositório da aplicação.
