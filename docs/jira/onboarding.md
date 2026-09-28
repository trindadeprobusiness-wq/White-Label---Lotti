# Cadastro inicial e onboarding — auditoria de código

Tarefas: SCRUM-6, SCRUM-13, SCRUM-14, SCRUM-15, SCRUM-16
Base auditada: `main` em `052327d` (worktree `jira-sprint`), 2026-09-27.

**Como a auditoria foi feita.** Leitura do caminho de código (rotas, guards, hooks,
wizard, migrations e RPCs), execução dos testes existentes e criação de testes novos
que falham de propósito. Nenhuma conta foi criada, nenhuma chamada foi feita à produção
e nenhum código de produção foi alterado.

**Estado da produção.** O estado abaixo vem do `AI_HANDOFF.md` e não foi verificado de
novo nesta auditoria:

- A migration de onboarding `20260821130000_onboarding_ativacao.sql` **nunca foi
  aplicada** (registro de 2026-09-01: `onboarding_profiles` ausente).
- As migrations de CRM, Rotina, CNPJ no cadastro e Asaas **foram aplicadas**.
- Em 2026-08-20, o Auth público estava com `disable_signup = true`.

---

## 1. Mapa do fluxo

```
/auth ──login──▶ state.from (padrão "/")
                    │
/ (e demais rotas) ─▶ ProtectedRoute ─▶ OnboardingGate ─▶ DataLoader ─▶ AppLayout
                    │ sem sessão          │ onboarding não concluído
                    ▼                     │ e não dispensado
                  /auth                   ▼
                              /onboarding (ProtectedRoute, SEM gate)
```

- Rotas: `src/App.tsx:125` (`/auth`), `:136-143` (`/onboarding`, só com
  `ProtectedRoute`), `:146-154` (árvore protegida com `OnboardingGate` > `DataLoader`).
- `ProtectedRoute` (`src/components/auth/ProtectedRoute.tsx:13-26`) mostra um spinner
  enquanto a sessão carrega. Sem sessão, redireciona para `/auth` com
  `state.from = location`, que inclui pathname **e search**.
- `OnboardingGate` (`src/components/onboarding/OnboardingGate.tsx:11-24`):
  - mostra o spinner "Preparando sua operação..." enquanto carrega;
  - redireciona para `/onboarding` quando `deveAbrirOnboarding` é verdadeiro;
  - libera o app quando há erro.
- `deveAbrirOnboarding` (`src/lib/onboarding/contexto.ts:136-140`) retorna falso quando
  não há perfil, e também em `/onboarding` e `/admin`. Nos demais casos, retorna
  verdadeiro enquanto `concluidoEm` e `dispensadoEm` estiverem nulos.
- `useOnboarding` (`src/hooks/useOnboarding.ts`) usa a RPC `get_onboarding_contexto`
  (`:23-33`). Os erros `42P01`/`42883`/`PGRST202`/`PGRST205` são tratados como
  "migration não aplicada" e viram `null` (`:17-21`). A consulta usa `retry:false` e
  `staleTime` de 30 s (`:68-73`).
- Laços de redirecionamento **estruturais**: não há.
  - `ProtectedRoute` ↔ `Auth`: o Auth só redireciona com sessão
    (`src/pages/Auth.tsx:42-46`), e o `ProtectedRoute` só redireciona sem sessão.
  - `OnboardingGate` ↔ `/onboarding`: a rota do wizard fica fora do gate, e o
    `deveAbrirOnboarding` exclui `/onboarding`.
  - Concluir ou dispensar grava o contexto no cache (`setQueryData`,
    `useOnboarding.ts:92-95`) antes do `navigate`.
  - Os laços **funcionais** estão em B5 e B6.

---

## 2. Achados (referenciados nas tarefas)

| ID | Gravidade | Achado | Evidência | Teste |
|---|---|---|---|---|
| B1 | Alta | **Não existe caminho de criação de conta.** Detalhes abaixo da tabela. | `src/pages/Auth.tsx` (só login); commit `533bcc9`; `src/pages/Auth.visual.test.tsx:76-94`; `src/hooks/useAuth.tsx:140-166`; `src/services/paymentProvider.ts:48-73`; `src/pages/PlanoAssinatura.tsx:142-149`; `src/pages/PublicInfo.tsx:55,300`; `src/pages/RedirectParceiro.tsx:10-17,32,72`; `src/pages/Auth.tsx:131-138`; `20260821130000_onboarding_ativacao.sql:683-689` | análise |
| B2 | Alta | **Onboarding inativo em produção.** Sem a migration, o gate libera todo mundo. O `/onboarding` mostra a tela técnica "Onboarding aguardando ativação… migration ainda precisa ser aplicada". Os botões "Importar leads", "Importar" e "Usar demonstração" levam a essa tela. | `useOnboarding.ts:17-21,28`; `contexto.ts:137`; `src/pages/Onboarding.tsx:383-393`; `src/pages/Clientes.tsx:301`; `src/pages/Imoveis.tsx:224-225` | análise |
| B3 | Alta (segurança/deploy) | **Aplicar a migration de onboarding como está causa regressão.** Ela redefine `get_corretor_id()` com `LIMIT 1` e sem `status='ativo'` (`:194-201`). A versão atual de produção exige corretor ativo (`20260814100000_admin_papeis_auditoria.sql:271-279`). O bloco da Asaas que refina a função só roda se `onboarding_profiles` já existir (`20260831140000_asaas_conta_por_inquilino.sql:101-135`), e em produção não existia. Resultado: **corretor suspenso volta a ter acesso**. Há também o bootstrap `:377`: um usuário com vínculo ativo em outra organização viola `uq_routine_membership_ativa_por_usuario` (`20260831140000:93-95`) e aborta a migration. | arquivos citados | análise |
| B4 | Média | **Clique sem resposta quando `salvar_onboarding` falha.** `concluirEtapa` e `pularEtapa` são chamados com `void`, fora do `executar`: sem toast, sem spinner e sem trava de duplo clique. Afeta Boas-vindas, Persona, Objetivo, "Continuar com esta conta" (Asaas), "Continuar onboarding" (Equipe) e todo "Pular por agora". | `Onboarding.tsx:199-225,453,471`; mutação sem `onError` em `useOnboarding.ts:79-96` | `Onboarding.becos.test.tsx` (2 testes vermelhos) |
| B5 | Média | **`/onboarding` não tem "Sair", e toda saída depende de `salvar_onboarding`.** "Continuar depois" chama `explorar` → `salvar`. Se o salvamento falhar de forma persistente, digitar `/` na barra devolve ao wizard pelo gate. A única saída é fechar a aba. | `Onboarding.tsx:232-236,404`; `OnboardingGate.tsx:23-24` | análise |
| B6 | Média | **Links do próprio wizard voltam para o wizard.** "Conectar Google Agenda" aponta para `/rotina#google-agenda` e "Gerenciar assinatura" para `/plano`. Como as duas rotas estão atrás do gate, a pessoa é devolvida ao wizard e o clique parece não fazer nada. | `Onboarding.tsx:557,589`; `OnboardingGate.tsx:23-24`; `contexto.ts:138-139` | `OnboardingGate.becos.test.tsx` (2 testes vermelhos) |
| B7 | Média | **O token do convite se perde no login.** O `ProtectedRoute` guarda `from` completo, mas o Auth só devolve o `pathname`. O link `/onboarding?invite=…&etapa=aceitar_convite` (montado em `Onboarding.tsx:348`), aberto sem sessão, volta sem o token. | `Auth.tsx:34,44`; `ProtectedRoute.tsx:25` | `Auth.retorno-convite.test.tsx` (1 teste vermelho) |
| B8 | Média (perda de dado) | **Retomar o perfil sobrescreve o CRECI.** O rascunho só pré-preenche nome e telefone. `salvarPerfil` grava `creci: … \|\| 'PENDENTE'` e `creci_status: 'nao_informado'`. Contas legadas nascem concluídas em `conclusao` (`20260821130000:341-355`), e "Continuar configurando" leva à etapa Perfil. Cidade e estado também não são pré-preenchidos. | `Onboarding.tsx:150-151,250,254-255,565` | `Onboarding.becos.test.tsx` (vermelho) |
| B9 | Baixa/Média | **O pré-preenchimento não acontece no caminho real de conta nova.** O gate deixa o contexto em cache e redireciona antes de o `DataLoader` buscar o corretor (`App.tsx:146-152`). O efeito de inicialização roda uma vez com `corretor = null` e trava `inicializado`. Resultado: "Olá, você" e perfil vazio. | `Onboarding.tsx:141-155` | `Onboarding.becos.test.tsx` (vermelho) |
| B10 | Baixa | **"Importar planilha" não existe.** A tela pede para "continuar com cadastro manual" (`:534`), e `src/lib/onboarding/importacao.ts` só tem teste, sem uso. Para quem não tem a etapa `entrada_dados` (administrativo, convidado ou persona nula), o parâmetro `?etapa=entrada_dados` é ignorado e a pessoa cai em outra etapa. | `Onboarding.tsx:175-177,533-534`; `src/lib/onboarding/regras.ts:272-288` | análise |
| B11 | Baixa | **Erro de rede ou 500 no contexto mostra a mesma tela de "migration não aplicada"**, sem botão de "tentar novamente". | `useOnboarding.ts:28-29,204`; `Onboarding.tsx:383-393` | análise |
| B12 | Baixa | **Spinners sem timeout.** O gate ("Preparando sua operação...") e a `TelaCarregando` dependem da RPC responder. Se a requisição travar, a tela fica sem ação. | `OnboardingGate.tsx:11-19`; `Onboarding.tsx:382,592` | análise |
| B13 | Baixa (ferramenta) | **O script `supabase/tests/onboarding_ativacao.sql` aborta no primeiro bloco.** Ele usa `ON CONFLICT (user_id)` em `corretores`, mas nenhuma migration cria UNIQUE em `corretores.user_id` (`20260104131559:44-46`). | `supabase/tests/onboarding_ativacao.sql:24-28` | análise |
| B14 | Baixa | **O autosave grava o rascunho inteiro em `onboarding_profiles.metadata.draft`.** Isso inclui o token de convite em texto claro (o banco guarda só o hash, `:663`) e os dados de cliente digitados. | `Onboarding.tsx:55,157-167`; `20260821130000:501` | análise |

**Detalhes do B1:**

- O Auth só tem login. A aba de cadastro foi removida no commit `533bcc9` (que se chama
  "refactor(mobile)"), e `Auth.visual.test.tsx:76-94` garante que ela continue ausente
  com a justificativa "o registro acontece via checkout".
- `signUp` continua em `useAuth.tsx:140-166`, mas sem nenhum uso.
- O "checkout" é um mock (`MockPaymentProvider`, que devolve `returnUrl`) e fica em
  `/plano`, rota que exige login.
- A página pública só oferece "Entrar".
- O link de parceiro `/r/:slug` promete o cadastro, mas cai em `/auth?ref=…`, que mostra
  "Você chegou pela indicação de…" e só permite entrar.
- O convite de equipe exige conta com o mesmo e-mail.

---

## SCRUM-6 — Concluir cadastro inicial sem telas interrompidas

O que falta para o fluxo "entrei pela primeira vez → operação configurada" funcionar
sem interrupções, em ordem de dependência:

1. **Decisão de produto sobre o cadastro (B1).** Opções:
   - reativar a aba de cadastro (o `signUp` e o schema com CNPJ ainda existem);
   - criar a conta no retorno do checkout real;
   - criar a conta por convite administrativo.

   Qualquer opção também exige ajustar `disable_signup` no Supabase e o teste
   `Auth.visual.test.tsx:76-94`. Sem isso, o link de parceiro e o convite de equipe
   continuam sem saída para quem não tem conta.
2. **Ativar o onboarding em produção sem a regressão B3.** A aplicação precisa:
   - reexecutar a definição de `get_corretor_id()` da Asaas (`20260831140000:101-135`)
     **depois** da migration de onboarding, ou criar uma migration de acompanhamento;
   - rodar antes o pré-check de vínculos (Apêndice, consulta A5).
3. **Correções de front, com testes vermelhos prontos:**
   - B4: `onNext` e "Pular" dentro de `executar`;
   - B6: rotas oferecidas pelo wizard liberadas no gate, ou ações feitas dentro do
     wizard;
   - B7: preservar `from.search` e `from.hash` no Auth;
   - B8 e B9: pré-preencher a partir do corretor quando ele chegar, sem sobrescrever
     CRECI, cidade e estado.
4. **Acabamento:**
   - B5: botão "Sair" no cabeçalho do wizard;
   - B10: esconder "Importar planilha" até existir importador;
   - B11/B12: mensagem de erro com "Tentar novamente" e timeout nos spinners.

**Roteiro manual (ponta a ponta, staging com a migration de onboarding aplicada):**

1. Crie a conta de teste conforme SCRUM-13, passo 1.
2. Abra o app em uma janela anônima e entre com a conta.
   - Esperado: redirecionamento para `/onboarding`, etapa Boas-vindas.
3. Percorra o caminho "Dono ou gestor" até a Conclusão e clique em "Ir para meu painel".
   - Esperado: nenhuma tela sem ação para avançar ou voltar, e o Painel abre com o
     checklist.
4. Repita os passos 2-3 com o DevTools em "Offline" durante um clique em
   "Configurar minha operação".
   - Esperado: mensagem de erro. Hoje não aparece nada (B4).
5. Na etapa Próxima ação, clique em "Conectar Google Agenda".
   - Esperado: abre a Rotina. Hoje volta ao wizard (B6).
6. Em outra janela, sem sessão, abra `/r/qualquer-slug`.
   - Esperado: caminho para criar conta. Hoje só há login (B1).

Status: **Em andamento — bloqueado.** Faltam a decisão de produto sobre o cadastro (B1)
e a ativação segura do onboarding em produção (B2/B3). As quatro correções de front
(B4, B6, B7, B8/B9) já têm testes vermelhos que definem o comportamento esperado.

---

## SCRUM-13 — Onboarding: Criar usuário de teste e confirmar cadastro de conta

**O que é criado quando uma conta nasce.** Tudo acontece no banco, por trigger, dentro
da mesma transação do `INSERT` em `auth.users`. Não há insert pelo cliente.

1. `auth.users` → trigger `on_auth_user_created`
   (`20260104131559_29aaba56-….sql:429-431`) → `handle_new_user()`, na versão com CNPJ
   (`20260820191200_cadastro_cnpj_auth.sql:4-35`, aplicada em produção). A função
   insere em `public.corretores`:
   - `nome` vem de metadata `nome`/`full_name`/`name`; sem metadata, usa o **prefixo do
     e-mail**;
   - `creci` fica `'PENDENTE'`;
   - `telefone` fica `''` sem metadata;
   - `cnpj_cpf` vem de metadata `cnpj`.
2. `AFTER INSERT` em `corretores`, na ordem alfabética dos triggers:
   - `tr_ensure_routine_organization`
     (`20260821004218_rotina_operacional.sql:169-194`) cria `routine_organizations`
     (nome = razão social, nome ou "Minha organização") e `routine_memberships`
     (`proprietario`, `active`);
   - `trg_bootstrap_onboarding` (`20260821130000:379-389`, **só se aplicada**) reforça
     a organização (tipo `individual`, copia CNPJ, telefone e e-mail) e cria
     `onboarding_profiles`, `onboarding_progress` (`boas_vindas`), preferências,
     checklist e o evento `signup_completed` (`:308-374`);
   - `trg_crm_seed_etapas` (`20260811150000_crm_module.sql:172-196`) cria as 9 etapas
     padrão do funil.
3. Não há assinatura criada no cadastro: nenhuma migration insere em `subscriptions`.

**Tratamento de falha.**

- Qualquer exceção em um desses triggers aborta a criação do usuário. O Supabase
  responde "Database error saving new user", sem conta pela metade.
- No front, `signUp` (`useAuth.tsx:140-166`) traduz o erro por `mensagemDeAuth`, mas:
  - "Database error…" e "Signups not allowed…" caem no texto genérico "Tente novamente
    em instantes" (`src/lib/auth/mensagens.ts:13`);
  - o tratamento de confirmação de e-mail (`precisaConfirmarEmail`, `:165`) é código
    morto, porque não existe tela de cadastro (B1).
- A confirmação de e-mail redirecionaria para `/` (`:145`).

**Roteiro manual.** Use sempre staging. Em produção, o cadastro público está desligado e
a conta sujaria métricas.

1. No painel do Supabase de staging, vá em Authentication → Users → *Add user* →
   *Create new user*.
   - E-mail sintético da equipe, por exemplo `qa-onboarding-<data>@<domínio de teste>`.
   - Senha forte gerada.
   - Marque **Auto Confirm User**.
   - Não use *Invite user*: o link de convite abre sessão sem senha e o app não tem
     tela para definir senha fora da recuperação.
   - Esperado: usuário criado sem erro.
2. No SQL Editor, rode as consultas A1–A4 do Apêndice.
   - Esperado:
     - 1 linha em `corretores` com `status='ativo'`, `creci='PENDENTE'` e nome igual ao
       prefixo do e-mail (não há metadata pelo painel);
     - 1 organização com vínculo `proprietario`/`active`;
     - 9 etapas de funil;
     - com o onboarding aplicado: perfil com `persona` nula, `current_step='boas_vindas'`
       e o evento `signup_completed`.
3. Em `/auth`, entre com a conta.
   - Esperado: sessão aberta.
   - Com o onboarding aplicado, redirecionamento para `/onboarding`; sem ele, abre o
     Painel.
4. Saia pela conta, no menu do app, e tente entrar com a senha errada.
   - Esperado: "E-mail ou senha incorretos."
5. Anote o `user_id` para SCRUM-14/15 e **não** registre a senha em tickets.

Status: **Bloqueado pela interface.** Não existe tela de cadastro (B1), então a conta de
teste só pode ser criada pelo painel ou pela API administrativa do Supabase (roteiro
acima). A cadeia de criação no banco foi auditada e está consistente e atômica. Falta
executar o roteiro em staging.

---

## SCRUM-14 — Onboarding: Confirmar criação da imobiliária ao cadastrar usuário

**Achados.**

- A "imobiliária" é a linha de `routine_organizations` criada **automaticamente no
  cadastro** pelo trigger da Rotina (ver SCRUM-13, item 2). Não depende do front.
- Nasce como organização **individual**:
  - em produção hoje, só com `name` e `timezone`, porque as colunas `organization_type`,
    `cnpj`, `trade_name` e outras vêm da migration de onboarding (`20260821130000:13-22`);
  - o CNPJ informado no cadastro fica só em `corretores.cnpj_cpf`; ele só é copiado para
    a organização pelo `bootstrap_onboarding_corretor` (`:318-330`), que não roda em
    produção;
  - sem metadata, o nome da organização é o prefixo do e-mail.
- Ela só passa a ser `imobiliaria` na etapa **Empresa** da persona "Dono ou gestor":
  - `salvarEmpresa` (`Onboarding.tsx:261-271`) faz `UPDATE` direto em
    `routine_organizations` (`useOnboarding.ts:123-140`), permitido pela policy só para
    `proprietario`/`administrador` (`20260821004218:967-970`);
  - não há campo para escolher o tipo, então o valor é sempre `'imobiliaria'`
    (`Onboarding.tsx:63`);
  - o `UPDATE` não usa `.select()`, então uma negação por RLS passaria como sucesso
    silencioso. Isso só acontece para quem não é dono, e essa persona não vê a etapa.
- Não é criada uma segunda organização:
  - `legacy_corretor_id` é UNIQUE e os dois triggers usam `ON CONFLICT`;
  - a partir da Asaas, há no máximo **um** vínculo ativo por usuário
    (`20260831140000:93-95`).
- O convite aceito move o usuário para a organização de quem convidou e revoga o vínculo
  com a organização própria (`20260821130000:696-713`).

**Roteiro manual (staging).**

1. Faça SCRUM-13, passos 1-2.
   - Esperado (A2): exatamente 1 organização para o `corretor_id`, 1 vínculo
     `proprietario` ativo e, com o onboarding, `organization_type='individual'`.
2. Entre, avance até Persona, escolha **Dono ou gestor**, preencha Perfil e, na etapa
   **Empresa**, informe nome "Imobiliária QA Teste" (CNPJ em branco) e clique em
   "Salvar empresa".
   - Esperado: avança para Objetivo.
3. Rode A2 de novo.
   - Esperado: mesma organização (mesmo `id`), `name='Imobiliária QA Teste'` e
     `organization_type='imobiliaria'`.
   - `onboarding_events` contém `organization_created`.
   - A1 continua mostrando 1 vínculo ativo.
4. Repita com outra conta escolhendo **Corretor autônomo**.
   - Esperado: não aparece a etapa Empresa e a organização continua `individual`.
5. **Sem a migration de onboarding** (espelho da produção):
   - Esperado: A2 mostra a organização com o nome da pessoa e sem tipo, e não há etapa
     Empresa. Registrar como limitação atual.

Status: **Parcialmente atendido.** A organização é criada automaticamente em todo
cadastro, inclusive em produção, pelo trigger da Rotina. Mas a configuração como
imobiliária (tipo, CNPJ, nome comercial) depende da etapa Empresa, inativa em produção
(B2/B3), e o CNPJ do cadastro não chega à organização em produção. Falta validar em
staging.

---

## SCRUM-15 — Onboarding: Retomar cadastro interrompido do ponto salvo

**Onde o progresso fica salvo.** Fica todo no servidor; nada vai para o
`localStorage`, que guarda só `lotti:ultimo-email` no Auth.

- `onboarding_progress` (`20260821130000:79-92`): `current_step`, `completed_steps`,
  `skipped_steps`, `completed_at`, `dismissed_at` e `metadata.action_ids`, que permite
  retomar a criação de imóvel, cliente e negócio sem duplicar (`:753-756`).
- `onboarding_profiles` (`:65-77`): `persona`, `primary_goal`, `data_entry_strategy` e
  `metadata.draft`. O draft recebe autosave 700 ms depois de cada digitação
  (`Onboarding.tsx:157-167`).
- `onboarding_steps`: estado por etapa.
- Tudo é gravado pela RPC `salvar_onboarding` (`:481-554`).
- `current_step` só é gravado ao **avançar ou pular** (`Onboarding.tsx:199-225`).
  "Voltar" só muda a URL (`:227-230`).

**Como a tela decide onde retomar** (`Onboarding.tsx:169-177`):

1. `?etapa=` na URL, se pertencer às etapas da persona;
2. senão, `current_step`;
3. senão, a primeira etapa.

A persona vem do rascunho ou do perfil. O rascunho é restaurado de `metadata.draft`
(`:145-155`).

**O que acontece em cada interrupção:**

- **Recarregar a página:** mantém a etapa, porque ela está na URL, e o rascunho já
  salvo.
- **Fechar a aba, sessão expirar ou entrar em outro dispositivo:** no próximo acesso a
  qualquer rota do app, o gate leva a `/onboarding` e a pessoa retoma em `current_step`.
- **"Continuar depois":** grava `dismissed_at` e `current_step` (`:232-236`).
  - O gate **deixa de redirecionar** (`contexto.ts:139`).
  - A retomada fica no checklist do Painel, pelo botão "Retomar configuração"
    (`OnboardingChecklist.tsx:23,43,69`; `Dashboard.tsx:145`), e volta à etapa salva.
- **Sair (logout) no meio:** não existe botão "Sair" no wizard (B5). Na prática, sair é
  "Continuar depois" ou fechar a janela.
- **Troca de usuário no mesmo navegador:** os caches do React Query e do Zustand são
  limpos (`src/lib/auth/isolamentoSessao.ts:22-23`), então não há vazamento de contexto
  entre contas.

**Falhas na retomada:** B7 (convite perdido no login), B8 (retomar o Perfil apaga o
CRECI), B9 (dados do cadastro não pré-preenchem) e B14 (rascunho com token e dados
pessoais no banco).

**Roteiro manual (staging com onboarding aplicado, conta nova de SCRUM-13).**

1. Entre, escolha **Corretor autônomo**, vá até **Perfil profissional**, digite nome,
   telefone e cidade, **sem** clicar em "Salvar perfil". Aguarde 2 s e recarregue (F5).
   - Esperado: continua em Perfil com os campos preenchidos.
2. Feche a janela anônima, abra outra e entre de novo na raiz do app.
   - Esperado: redirecionamento para `/onboarding`, na etapa Perfil, com os campos
     preservados.
3. Entre com a mesma conta em outro navegador.
   - Esperado: mesma etapa e mesmos dados, porque o estado está no servidor.
4. Clique em "Salvar perfil", avance até **Primeiro imóvel**, crie o imóvel e recarregue
   na etapa seguinte.
   - Esperado: não há imóvel duplicado (consulta A3 do Apêndice: 1 imóvel com
     `tracking_data.origem='onboarding'`).
5. Clique em **Continuar depois**.
   - Esperado: abre o Painel, e recarregar **não** leva de volta ao wizard.
   - O Painel mostra "Retomar configuração", que volta à etapa em que você parou.
6. Faça estas verificações de regressão, que hoje devem falhar:
   - a) Na Boas-vindas de uma conta nova, a saudação deve ser "Olá, <nome>". Hoje
     aparece "Olá, você" (B9).
   - b) Numa conta com CRECI já preenchido em Configurações, abra
     `/onboarding?etapa=perfil`, preencha a cidade e salve. O CRECI deve permanecer.
     Hoje vira `PENDENTE` (B8).
   - c) Numa conta gestora, gere um convite na etapa Equipe. Em outro navegador **sem
     sessão**, abra o link e entre com a conta convidada. A pessoa deve cair na etapa
     Convite com o código preenchido. Hoje cai no wizard sem o convite (B7).

Status: **Implementado no código, mas inativo em produção** (B2). A retomada do ponto
salvo funciona pelo servidor (`current_step` + rascunho). Há três defeitos de retomada
com teste vermelho: B7, B8 e B9. A retomada depois de "Continuar depois" depende do
checklist do Painel.

---

## SCRUM-16 — Onboarding: Percorrer onboarding e registrar telas sem saída

**Etapas por persona** (`src/lib/onboarding/regras.ts:243-289`):

- Autônomo: 11 etapas.
- Gestor: 13 etapas.
- Convidado: 6 etapas.
- Administrativo: 7 etapas.

**Saídas por tela** (`Onboarding.tsx`). "Continuar depois" existe em todas as etapas,
no cabeçalho (`:404`). O rodapé com Voltar/Pular aparece em todas, exceto Boas-vindas e
Conclusão (`:468-473`). A barra lateral volta para etapas anteriores e bloqueia as
futuras (`:427`).

| Tela / estado | Avançar | Voltar | Pular | Em erro |
|---|---|---|---|---|
| Boas-vindas (`:512`) | "Configurar minha operação" | — | — | **nada acontece (B4)** |
| Persona (`:514`) | "Continuar" (desabilitado sem escolha) | sim | — | **B4** |
| Convite (`:516`, convidado) | "Validar e aceitar convite" | sim (trocar persona) | não | toast; sem conta: **B1**; link sem sessão: **B7** |
| Perfil (`:518`) | "Salvar perfil" (exige nome, telefone e cidade) | sim | não | toast; **B8/B9** |
| Empresa (`:520-523`, gestor) | "Salvar empresa" | sim | sim | toast |
| Objetivo (`:525-528`) | "Personalizar minha Lotti" | sim | não | **B4** |
| Asaas (`:568-583`) | "Continuar com esta conta" (só se conectada) | sim | sim | **B4** no Pular |
| Primeiros dados (`:532-535`) | "Continuar" / "Criar demonstração segura" | sim | sim | toast; Importar inexistente (**B10**) |
| Primeiro imóvel (`:537`) | "Criar primeiro imóvel" | sim | sim | toast |
| Primeiro cliente (`:539`) | "Cadastrar cliente" | sim | sim | toast |
| Oportunidade (`:541`) | "Criar no funil" (desabilitado sem cliente; o aviso manda voltar ou pular) | sim | sim | toast "cliente inválido" sem orientação quando o 1º cliente foi pulado |
| Próxima ação (`:543-560`) | "Agendar próxima ação" | sim | sim | toast; "Conectar Google Agenda" → **laço B6** |
| Equipe (`:562`, gestor) | "Preparar convite" → "Continuar onboarding" | sim | sim | **B4** no "Continuar onboarding" |
| Conclusão (`:564-565`) | "Ir para meu painel" / "Continuar configurando" | pela barra lateral | — | toast |
| Painel "Conta e plano" (`:589`) | "Gerenciar assinatura" → **laço B6** | — | — | — |
| "Aguardando ativação" (`:383-393`) | "Continuar para o painel" | — | — | texto técnico (**B2/B11**) |
| Spinners: gate e `TelaCarregando` | — | — | — | sem timeout (**B12**) |
| `/auth` | Entrar / "Esqueci minha senha" | — | — | **sem cadastro (B1)** |
| `/r/:slug` | redireciona para `/auth?ref=` | — | — | **B1** |

**Telas sem saída e laços confirmados:**

- **Com teste vermelho:**
  - B4: clique sem resposta em falha;
  - B6: Google Agenda e assinatura voltam ao wizard;
  - B7: convite perdido no login.
- **Por análise:**
  - B1: visitante e convidado sem conta não têm saída;
  - B5: sem "Sair" e todas as saídas dependem do salvamento.
- **Não encontrados:** laços de redirecionamento entre `OnboardingGate`,
  `ProtectedRoute` e `Auth` (ver seção 1).

**Roteiro manual (staging com onboarding aplicado).**

1. Para cada persona (autônomo, gestor, convidado e administrativo), use uma conta nova
   e percorra todas as etapas. Em cada tela, teste Avançar, Voltar, Pular (quando
   houver) e a barra lateral.
   - Esperado: toda tela tem como seguir e como voltar, como na tabela acima.
2. Em Boas-vindas, Persona e Objetivo, deixe o DevTools em Network "Offline" e clique
   no botão principal. Depois clique em "Pular" em Asaas.
   - Esperado: mensagem de erro e botão reativado. Hoje nada acontece (B4).
3. Em Próxima ação, clique em "Conectar Google Agenda". No painel lateral, clique em
   "Gerenciar assinatura".
   - Esperado: abrem Rotina e Plano. Hoje voltam ao wizard (B6).
4. Com o onboarding em andamento, digite `/clientes` na barra.
   - Esperado (comportamento atual, correto): o gate devolve ao wizard.
   - Clique em "Continuar depois" e repita.
   - Esperado: Clientes abre.
5. Depois de concluir, clique em "Importar leads" em Clientes (com a lista vazia).
   - Esperado: um importador. Hoje abre a etapa Primeiros dados com o aviso de
     importador não habilitado (B10).
6. Na persona Convidado, sem código, verifique que o único caminho é Voltar/trocar
   persona ou "Continuar depois". Registre como comportamento esperado.
7. Em uma janela sem sessão, abra `/r/slug-inexistente`.
   - Esperado: caminho para criar conta. Hoje só há login (B1).

Status: **Concluído como auditoria de código.** 19 telas e estados foram mapeados com
suas saídas. Foram registrados 3 becos ou laços confirmados por teste (B4, B6, B7) e
2 por análise (B1, B5), além de achados menores (B10-B12). Falta a execução manual do
roteiro em staging.

---

## 3. Testes executados

Todos com `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key npx vitest run <caminhos>`.

- **Existentes de autenticação/onboarding** (`src/lib/auth`, `src/lib/onboarding`,
  `src/pages/Auth.visual.test.tsx`, `src/components/layout/AppLayout*.test.ts*`):
  **10 arquivos, 49/49 testes passaram.**
  - Não há teste de `OnboardingGate`, `ProtectedRoute`, `DataLoader` nem da página
    `Onboarding.tsx`.
  - `importacao.test.ts` testa um módulo sem uso.
- **Novos, que falham de propósito** (sem alteração de código de produção):

  | Arquivo | Testes | Por que falha hoje |
  |---|---|---|
  | `src/pages/Onboarding.becos.test.tsx` | 4 | B4 (2): rejeição sem tratamento e sem toast; B8: `creci: 'PENDENTE'` em vez de `12345-F`; B9: nome vazio após o corretor carregar |
  | `src/components/onboarding/OnboardingGate.becos.test.tsx` | 2 | B6: `/rotina` e `/plano` renderizam o wizard |
  | `src/pages/Auth.retorno-convite.test.tsx` | 1 | B7: volta `/onboarding` sem `?invite=…` |

- **Suíte completa no momento da execução:** 88 arquivos; 754 passaram, 5 falharam de
  forma esperada (`expected fail`) e 22 falharam.
  - Das 22 falhas, 7 são os testes acima.
  - As outras 15 são de outras frentes de auditoria em paralelo
    (`supabase/migrations/admin-backoffice-authz.test.ts`, SCRUM-27/29, e
    `planos-cota-servidor.test.ts`), sem relação com onboarding.
  - Nenhum teste que passava antes quebrou.

---

## Apêndice — consultas de verificação (somente leitura, staging)

Substitua `<email-de-teste>` e `<user_id>`. Não copie resultados com dados pessoais para
o Jira.

```sql
-- A1. Conta, perfil de corretor e vínculos ativos
select u.id as user_id, u.email_confirmed_at is not null as confirmado,
       c.id as corretor_id, c.status, c.creci, (c.cnpj_cpf is not null) as tem_documento,
       (select count(*) from public.routine_memberships m
         where m.user_id = u.id and m.status = 'active') as vinculos_ativos
from auth.users u
left join public.corretores c on c.user_id = u.id
where u.email = '<email-de-teste>';

-- A2. Organização ("imobiliária") e papel
select o.id, o.name, m.role, m.status,
       (select count(*) from public.routine_organizations o2
         where o2.legacy_corretor_id = c.id) as organizacoes_do_corretor
from public.corretores c
join public.routine_organizations o on o.legacy_corretor_id = c.id
join public.routine_memberships m on m.organization_id = o.id and m.user_id = c.user_id
where c.user_id = '<user_id>';
-- Só com a migration de onboarding (as colunas não existem sem ela):
-- select organization_type, trade_name, cnpj from public.routine_organizations o
--   join public.corretores c on c.id = o.legacy_corretor_id where c.user_id = '<user_id>';

-- A3. Funil padrão e registros criados pelo onboarding
select (select count(*) from public.crm_etapas e where e.corretor_id = c.id) as etapas_funil,
       (select count(*) from public.imoveis i
         where i.corretor_id = c.id and i.tracking_data->>'origem' = 'onboarding') as imoveis_onboarding
from public.corretores c where c.user_id = '<user_id>';

-- A4. Estado do onboarding (se aplicado)
select to_regclass('public.onboarding_profiles') is not null as onboarding_aplicado;
select p.persona, pr.current_step, pr.completed_steps, pr.skipped_steps,
       pr.completed_at, pr.dismissed_at
from public.onboarding_profiles p
join public.onboarding_progress pr on pr.profile_id = p.id
where p.user_id = '<user_id>';
select event_name, step_key, criado_em from public.onboarding_events
where user_id = '<user_id>' order by criado_em;

-- A5. Pré-check antes de aplicar 20260821130000 (B3): usuários cujo vínculo ativo
-- NÃO é a própria organização. O bootstrap da linha 377 falharia para eles.
select m.user_id, m.organization_id
from public.routine_memberships m
join public.corretores c on c.user_id = m.user_id
join public.routine_organizations o on o.legacy_corretor_id = c.id
where m.status = 'active' and m.organization_id <> o.id;
```

## Correções aplicadas nesta branch (Claude, 2026-09-27)

- B4: "Configurar minha operação" e "Pular por agora" passam pelo mesmo tratamento de erro dos demais botões (mensagem e botão liberado quando salvar falha) — `src/pages/Onboarding.tsx`.
- B6: `/rotina` e `/plano`, oferecidos pelo próprio wizard, não mandam mais de volta ao onboarding — `src/lib/onboarding/contexto.ts`.
- B7: o login devolve o destino completo (caminho, query e hash), preservando o token do convite — `src/pages/Auth.tsx`.
- B8: salvar o perfil mantém o CRECI já cadastrado em vez de gravar `PENDENTE`; B9: nome, telefone e CRECI são preenchidos quando o cadastro do corretor chega depois do contexto — `src/pages/Onboarding.tsx`.
- B2: a tela de indisponibilidade deixou de falar em migration; explica em linguagem de usuário e mantém o botão para o painel.
- B3: `supabase/migrations/20260927110000_onboarding_corretor_ativo.sql` reaplica a `get_corretor_id()` da 20260831140000 (exige corretor ativo); aplicar logo depois da 20260821130000. Teste `onboarding-corretor-ativo.test.ts` (2/2).
- B13: `supabase/tests/onboarding_ativacao.sql` não usa mais `ON CONFLICT (user_id)` em `corretores`.
- Os 7 testes que falhavam de propósito passam. Continuam abertos: B1 (não há cadastro público nem checkout real — decisão de produto), B5 (wizard sem sair/logout) e a aplicação da migration de onboarding em produção.
