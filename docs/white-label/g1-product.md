# WL-G1-PRODUCT — descoberta de produto

## Escopo e base

- Snapshot de referência, somente leitura: `projetos/lotti-white-label`, `main` em `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`, com `git status --short` limpo no início da descoberta.
- Base de produto: `PRODUCT.md:5-30`. Público declarado: corretores autônomos e pequenas imobiliárias brasileiras. Propósito: unificar o ciclo do lead à cobrança, com dados confiáveis, rastreabilidade e pouca intervenção manual.
- Leitura dirigida de `AGENTS.md`, `AI_HANDOFF.md`, rotas, onboarding, assinatura, membership/convites e backoffice. Não foram lidos `.env`, segredos ou dados reais.
- Este relatório descreve o código do snapshot fixo. Entradas históricas do handoff foram usadas apenas para localizar contexto e não substituem o comportamento observável no snapshot.

## Síntese verificável

O produto observado possui um núcleo coerente para ativar uma operação imobiliária: escolhe persona, cria perfil, organização, primeiros registros reais e rotina; separa demonstração de dados reais; expõe plano e consumo; e oferece um backoffice amplo com autorização por papel. A jornada do gestor acrescenta empresa e equipe, enquanto o convidado entra em uma organização existente por token e e-mail correspondente.

As principais descontinuidades são de ponta a ponta, não de ausência de telas isoladas: o snapshot não oferece cadastro público dentro deste front, não apresenta os dados do convite antes do aceite, não oferece gestão do ciclo de vida de membros/convites, não aplica de forma observável a cota `max_users` ao convite, e mantém troca/cancelamento de plano desabilitados dentro do app. O backoffice é centrado em “contas Lotti” individuais, embora o domínio operacional de imobiliária seja organizacional.

## Comparação das jornadas observadas

| Jornada | Comportamentos evidentes | Lacunas observadas | Decisão de produto necessária |
|---|---|---|---|
| Corretor autônomo | A persona `corretor_autonomo` percorre boas-vindas, perfil, objetivo, Asaas, entrada de dados, primeiro imóvel, cliente, oportunidade, rotina e conclusão (`src/lib/onboarding/regras.ts:46-59`). O bootstrap cria uma organização individual e membership de proprietário (`supabase/migrations/20260821130000_onboarding_ativacao.sql:318-345`). O wizard grava registros nas tabelas operacionais e permite pular etapas opcionais ou sair para explorar (`src/pages/Onboarding.tsx:201-252`, `314-364`). | `Auth.tsx` é somente login, e não há consumidor de `useAuth.signUp` fora do hook; portanto este front não contém uma entrada observável para uma pessoa nova criar a conta (`src/pages/Auth.tsx:19-95`, `src/hooks/useAuth.tsx:176-218`). A estratégia “importação” avisa que o importador ainda não está operacional e orienta cadastro manual (`src/pages/Onboarding.tsx:556`). | Confirmar se a aquisição/cadastro pertence exclusivamente a outro produto/site. Se sim, documentar o contrato de retorno ao app e não prometer cadastro aqui; se não, definir a entrada pública e seus estados de sucesso, duplicidade, confirmação e retomada do onboarding. |
| Gestor de imobiliária | `gestor_imobiliaria` acrescenta as etapas Empresa e Equipe (`src/lib/onboarding/regras.ts:60-74`). Empresa atualiza a organização existente com nome, tipo e dados opcionais (`src/pages/Onboarding.tsx:283-293`). Equipe prepara um convite com e-mail e função, devolve link para compartilhamento explícito e não envia em nome do gestor (`src/pages/Onboarding.tsx:367-374`, `584`). | A criação começa por uma organização `individual` e depois a converte; falha na etapa Empresa deixa a conta tecnicamente individual. Não há tela encontrada para listar membros, convites pendentes/expirados, reenviar, revogar ou remover membro. | Decidir se “imobiliária” é apenas uma configuração da conta titular ou uma entidade administrável durante todo o ciclo. Para white-label e operação multiusuário, a segunda opção exige gestão pública de organização e membros. |
| Membership e convite | Só proprietário/administrador/gestor ativo pode convidar. O convite valida e-mail e papel, expira em 7 dias, revoga convite pendente anterior do mesmo e-mail e armazena apenas o hash do token (`supabase/migrations/20260821130000_onboarding_ativacao.sql:647-672`). O aceite exige sessão autenticada com o mesmo e-mail, revoga outras memberships ativas, ativa a nova organização e muda a persona para `usuario_convidado` (`supabase/migrations/20260821130000_onboarding_ativacao.sql:675-716`). O login preserva query e token do link (`src/pages/Auth.tsx:34-49`; teste em `src/pages/Auth.retorno-convite.test.tsx:36-55`). | A tela afirma que “o convite mostra a empresa e a função depois da validação”, mas oferece apenas textarea e um único botão que já aceita o convite; não há pré-visualização/confirmação separada (`src/pages/Onboarding.tsx:538`). Convidado sem conta chega a uma tela de login sem cadastro local. O aceite troca a organização ativa e revoga a anterior, sem seletor ou aviso de perda de contexto. A função de convite não consulta `max_users`, embora o catálogo exponha limite de usuários (`src/data/plansData.ts:122-129`; SQL do convite acima). | Definir: (1) prévia do convite antes do aceite; (2) caminho de convidado sem conta; (3) se um usuário pode pertencer a mais de uma organização; (4) quando e como a cota de usuários bloqueia preparar ou aceitar convite; (5) responsabilidades para revogar acesso. |
| Onboarding e ativação | O gate direciona contas incompletas ao wizard, mas falha de onboarding não bloqueia o CRM; suporte administrativo também ignora o gate (`src/components/onboarding/OnboardingGate.tsx:8-30`). Há quatro personas, retomada persistida, ajuda contextual, dados de demonstração isolados/removíveis, criação de registros reais e resumo de plano/trial (`src/lib/onboarding/regras.ts:46-96`; `src/pages/Onboarding.tsx:295-389`, `609-611`). | “Primeiro valor” exige simultaneamente imóvel, cliente, oportunidade e tarefa, independentemente do objetivo escolhido (`src/lib/onboarding/regras.ts:122-126`). Isso pode não representar valor para convidado, administrativo ou operações focadas em locação/contratos. A etapa Asaas pode ser pulada, mas está presente também para administrativo. No relatório administrativo, `asaas` não possui rótulo e pode aparecer como chave crua (`src/pages/admin/AdminOnboarding.tsx:15-21`). | Aprovar uma definição de ativação por persona/objetivo. Hipótese a validar: autônomo/gestor usam marcos operacionais; convidado usa convite aceito + perfil; administrativo usa perfil + primeira rotina ou acesso autorizado. |
| Planos e continuidade | `/plano` mostra status, ciclo, consumo, adicionais, comparação, downgrade incompatível e estados de teste vencido/somente leitura (`src/pages/PlanoAssinatura.tsx:129-181`, `196-224`, `226-353`). A checagem de cotas diferencia assinatura válida, conta legada e expiração (`src/hooks/useSubscription.ts:260-356`, `418-436`). | No snapshot, `billingIntegrationReady=false`; troca e cancelamento ficam bloqueados e o provider sempre falha explicitamente (`src/services/paymentProvider.ts:47-85`; aviso em `src/pages/PlanoAssinatura.tsx:183-195`). Portanto “gerenciar assinatura” é uma visão, não uma jornada transacional dentro do app. A FAQ estática promete troca e cancelamento direto na plataforma, o que não corresponde a esse estado (`src/data/plansData.ts:218-239`). | Escolher a fonte canônica da jornada comercial: checkout externo com retorno ao app ou gestão integral no app. Alinhar textos, CTAs e estados ao canal aprovado; não manter promessa de ação onde o controle está desabilitado. |
| Backoffice Lotti | Rotas `/admin/*` ficam fora da árvore operacional e exigem papel administrativo; navegação não substitui autorização no banco/API (`src/App.tsx:233-276`; `src/components/admin/AdminRoute.tsx:15-64`). Admin acessa operação; `super_admin` concentra configurações, hierarquia e ações financeiras sensíveis (`src/lib/admin/permissoes.ts:56-109`). Há visão geral, contas, assinaturas, pagamentos, cancelamentos, onboarding/atendimento, parceiros, comissões, repasses, receita, integrações e auditoria (`src/components/admin/AdminSidebar.tsx:50-89`). Atendimento permite abrir o painel de uma conta ativa em outra aba (`src/components/admin/ContasAtendimento.tsx:17-69`; `src/components/admin/AbrirPainelUsuario.tsx:4-10`). | A UI administrativa é centrada em `corretor_id`/conta individual. A camada de API mapeia listar/detalhar organizações, mas nenhuma página/hook/componente administrativo consome essa visão (`src/lib/admin/api.ts:182-186`). Assim, não há visão observável de imobiliária, membros e papéis como unidade operacional. A visão geral ainda diz que a cobrança de assinatura “não está ligada” quando não há receita, texto que pode confundir ausência de eventos com estado de integração (`src/pages/admin/AdminVisaoGeral.tsx:127-145`). | Definir a entidade primária do backoffice: conta titular, organização ou ambas. Para imobiliária/membership, a recomendação de requisito é navegação Conta → Organização → Membros/convites → Assinatura, com estados e auditoria próprios. |

## Comportamentos evidentes consolidados

1. O onboarding é retomável e pode ser dispensado; não é um bloqueio permanente. Páginas explicitamente oferecidas pelo wizard (`/planejamento` e `/plano`) são liberadas para evitar loop (`src/lib/onboarding/contexto.ts:136-143`).
2. Os primeiros registros do onboarding são reais, salvo quando a pessoa escolhe demonstração; os registros demo são marcados, retirados das evidências reais e removíveis (`src/pages/Onboarding.tsx:295-312`; `src/lib/onboarding/contexto.ts:121-132`).
3. O convite é uma mudança de tenant: não apenas concede uma função, mas troca a organização ativa do usuário (`supabase/migrations/20260821130000_onboarding_ativacao.sql:696-713`).
4. O catálogo distingue público e capacidade por plano, inclusive usuários, porém a tela interna de assinatura deriva plano/uso do backend e mantém ações comerciais desabilitadas neste snapshot (`src/data/plansData.ts:36-129`; `src/pages/PlanoAssinatura.tsx:90-110`).
5. O backoffice tem separação de privilégios significativa: um admin pode operar contas/parceiros e aprovar comissão, mas pagamentos, estornos, receita, hierarquia e configurações sensíveis ficam com super-admin (`src/lib/admin/permissoes.ts:76-109`).

## Lacunas priorizadas

### P0 — continuidade e acesso

1. **Entrada de conta nova/convidado sem conta.** O app precisa ter contrato observável com o cadastro externo ou uma rota própria. Hoje o link de convite preserva o token após login, mas não resolve criação de conta.
2. **Aceite de convite informado.** Separar “validar” de “aceitar” e mostrar organização, função, e-mail-alvo, expiração e efeito sobre a organização ativa antes da confirmação.
3. **Cota de usuários.** Tornar explícito e verificável o ponto de bloqueio (`preparar convite`, `aceitar convite` ou ambos) e considerar adicionais. No código lido, o convite não chama `checar_cota(..., 'max_users')`.
4. **Canal de gestão da assinatura.** Remover a divergência entre promessa de autosserviço e botões desabilitados, apontando para o canal realmente aprovado.

### P1 — operação de imobiliária

5. **Gestão de organização/membros.** Listar membros e convites; permitir reenviar/revogar convite e remover/alterar função conforme autorização; exibir impacto sobre acesso e dados.
6. **Modelo multi-organização.** Aprovar se membership é exclusiva. O comportamento atual revoga todas as memberships ativas ao aceitar uma nova.
7. **Backoffice organizacional.** Dar ao operador Lotti visão da organização, titular, membros, plano/cota, convites e eventos, sem confundir cliente do CRM com cliente SaaS.

### P2 — mensuração e clareza

8. **Ativação por persona/objetivo.** Substituir ou justificar o mesmo critério de primeiro valor para todos.
9. **Importação.** Enquanto indisponível, tratá-la como interesse/espera, não como caminho equivalente ao cadastro manual.
10. **Textos de estado.** Corrigir rótulo administrativo de `asaas` e distinguir “sem eventos de receita” de “cobrança não integrada”.

## Aceites prioritários para o próximo brief

### A1 — convidado entra com consciência e sem perder o token

- Dado um link válido aberto sem sessão, ao autenticar ou criar conta pelo canal aprovado, a pessoa retorna ao mesmo convite.
- Antes do aceite, vê organização, função, e-mail destinatário e validade; nenhum vínculo é alterado nessa consulta.
- Ao aceitar, somente o e-mail destinatário entra; convite inválido, expirado, revogado ou de outro e-mail mostra causa e próxima ação.
- Se a mudança substituir uma organização ativa, o efeito é informado e exige confirmação específica.
- O aceite respeita a decisão aprovada de cota de usuários e não deixa membership parcialmente aplicada.

### A2 — gestor administra equipe de ponta a ponta

- Gestor autorizado vê membros ativos e convites pendentes, aceitos, expirados e revogados da própria organização.
- Pode preparar/reemitir e revogar convite, alterar função e remover acesso apenas quando autorizado.
- Cada ação informa efeito, preserva dados da organização e gera evento auditável sem expor token.
- Limite do plano aparece antes da ação e retorna correção possível; o catálogo e a regra de servidor usam a mesma fonte.

### A3 — jornada de plano tem um canal único

- Plano atual, consumo e bloqueios continuam visíveis mesmo quando checkout estiver indisponível.
- Cada CTA de upgrade, downgrade ou cancelamento executa pelo canal aprovado ou explica claramente indisponibilidade e alternativa; nunca anuncia sucesso sem confirmação.
- Promessas de trial, somente leitura, troca e cancelamento são iguais no catálogo, app e checkout aprovado.
- Downgrade com uso incompatível lista recursos a reduzir e não altera assinatura.

### A4 — backoffice acompanha a unidade correta

- Operador autorizado localiza conta e organização sem confundir usuário SaaS com cliente do CRM.
- A tela da organização mostra titular, membros, convites, assinatura, uso e eventos de onboarding.
- Suporte abre somente conta elegível, em contexto destacado, com encerramento e auditoria.
- Ausência de receita é mostrada como ausência de eventos; estado da integração é exibido por diagnóstico próprio.

### A5 — ativação mensurável por persona

- Cada persona possui um marco de ativação aprovado e derivado de eventos reais.
- Pular etapa não conta como evidência operacional.
- Dados demo nunca contam como primeiro valor.
- Backoffice mostra funil de ativação com rótulos públicos e permite separar por persona/objetivo.

## Checkpoints para o Orquestrador

1. **Produto — origem do cadastro:** o cadastro de conta nova é responsabilidade exclusiva de outro site/checkout ou deve existir neste app?
2. **Produto/tenant — membership:** uma pessoa pode manter acesso simultâneo a várias organizações ou o vínculo ativo é exclusivo, como no SQL atual?
3. **Produto/comercial — usuários:** a cota é consumida por membership ativa, convite pendente ou apenas por aceite? Quem pode comprar/adicionar capacidade?
4. **Produto — convite:** o gestor compartilha link manualmente por desenho permanente ou haverá entrega transacional e reenvio pela Lotti?
5. **Produto/comercial — assinatura:** o canal canônico de troca/cancelamento será externo ou dentro do app?
6. **Produto/dados — ativação:** aprovar marcos diferentes por persona antes de alterar métricas e backoffice.
7. **Arquitetura, após decisões:** revisar modelo de tenant, enforcement server-side de `max_users`, preflight seguro de convite e entidade raiz do backoffice. Este checkpoint é posterior às decisões de produto; este relatório não impõe solução.

## Evidência e limitações

- Comandos: `maestri list`; `git status --short`; `git rev-parse HEAD`; buscas dirigidas com `rg`; leitura pontual com `Get-Content`.
- Resultado: agente de retorno identificado como `Orquestrador de Engenharia`; snapshot confirmado em `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`; árvore de referência limpa no início.
- Não foram executados testes, navegador, banco, rede, instalação, migration ou deploy. Os testes existentes foram lidos apenas como evidência de intenção/regressão (`Auth.retorno-convite`, `Onboarding.becos`, `OnboardingGate.becos`, `PlanoAssinatura`, `permissoes`, `ContasAtendimento`). Comportamento em produção não foi verificado.
