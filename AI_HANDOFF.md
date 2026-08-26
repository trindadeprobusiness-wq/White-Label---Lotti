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
