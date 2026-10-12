# WL-G1-FRONTEND — review do frontend

## Escopo e base verificada

- Tarefa: `WL-G1-FRONTEND`, report review somente leitura.
- Snapshot G0 fixo: `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`.
- Checkout inspecionado: `C:\Users\Gabri\Documents\Codex\Engenharia\projetos\lotti-white-label`.
- `git status --short` no checkout de referência não produziu saída antes da inspeção: árvore limpa.
- Instruções lidas de forma dirigida: `C:\Users\Gabri\Documents\Codex\Engenharia\AGENTS.md`, `projetos/lotti-white-label/AGENTS.md` e as entradas aplicáveis de `projetos/lotti-white-label/AI_HANDOFF.md`.
- Não foram lidos `.env`, segredos ou dados reais. Não houve execução do app, testes, instalação, migration, deploy ou alteração no código de referência.

## Conclusão executiva

O frontend é uma base **parcialmente reutilizável** para white-label. A composição React, o design system por tokens, os guards de autenticação/admin e a maior parte das telas operacionais podem ser reaproveitados. Porém, o produto atual ainda assume uma única marca Lotti e, para cada sessão, uma única conta/organização implícita. Não há um contrato frontend de `brand` nem um seletor de organização.

O principal risco não está nas telas em si, mas na fronteira de contexto: a troca de usuário limpa React Query e Zustand, enquanto uma futura troca de organização pelo mesmo usuário não acionaria essa limpeza. Muitas chaves de cache não carregam `organization_id`/`corretor_id`, e há estado operacional não namespaced em `localStorage`/`sessionStorage`. Portanto, habilitar troca de organização antes de introduzir um contexto explícito e uma política de invalidação criaria risco alto de exibição transitória de dados da organização anterior.

## Evidências de arquitetura e fluxo

### 1. Composição, rotas e providers

- `src/App.tsx:114-124` cria um `QueryClient` global com `staleTime: 60_000`.
- `src/App.tsx:138-149` compõe `QueryClientProvider`, `TooltipProvider`, `AuthProvider`, `BrowserRouter`, `ErrorBoundary`, `Suspense` e `SuporteBoundary`.
- `src/App.tsx:187-229` coloca as telas operacionais sob `ProtectedRoute > OnboardingGate > DataLoader > AppLayout`.
- `src/App.tsx:233-277` mantém o backoffice fora do `DataLoader` e o protege com `AdminRoute`/permissão por recurso.
- `src/App.tsx:197-228` expõe dashboard, Planejamento, WhatsApp, automações, clientes, imóveis, CRM/funil, financeiro, jurídico, mídias, configurações, plano, aluguéis, assistente e fachadas.
- `src/App.tsx:279-283` possui duas superfícies públicas: fachada por QR e redirecionamento de parceiro.
- `src/components/auth/ProtectedRoute.tsx:11-37` tem estados de carregamento e redirecionamento, preservando a rota de origem.
- `src/components/admin/AdminRoute.tsx:21-64` separa autenticação, schema administrativo ausente, papel administrativo e permissão por recurso. O próprio arquivo explicita que o guard de UI não substitui a autorização do backend (`:14-19`).

Leitura: a árvore de providers e o roteamento são coesos e reutilizáveis, mas `App.tsx` centraliza rotas, flags e importações da marca/produto; white-label por tenant ainda não participa dessa composição.

### 2. Autenticação e isolamento atual

- `src/hooks/useAuth.tsx:108-123` mantém uma única fonte de sessão no `AuthProvider`; o usuário efetivo pode ser substituído pela sessão de suporte.
- `src/hooks/useAuth.tsx:125-174` suporta dois transportes: login próprio da API, quando disponível, e Supabase Auth como fallback.
- `src/components/auth/ProtectedRoute.tsx:15-20` só preloa a rota protegida depois de confirmar sessão.
- `src/lib/auth/isolamentoSessao.ts:13-24` chama `queryClient.clear()` e `useCRMStore.getState().limparDadosDaSessao()` apenas quando o **ID do usuário** muda ou no logout.
- `src/lib/auth/isolamentoSessao.test.ts:22-34` confirma o contrato: limpa de `usuario-a` para `usuario-b`, mas deliberadamente não limpa para o mesmo usuário.
- `src/stores/crmStore.ts:166-177` limpa listas, perfil, `corretorContaId` e preferências quando essa fronteira é acionada.

Leitura: o isolamento entre logins distintos é explícito e testado. Não existe sinal de troca de organização no `AuthContextValue` (`src/hooks/useAuth.tsx:30-40`) nem parâmetro de organização em `aplicarSessao`. Consequentemente, o mecanismo não cobre a mesma identidade alternando entre organizações.

### 3. Contexto `corretor_id`, organização e legado

- O store operacional conserva `corretorContaId` como a conta efetiva retornada pelo backend (`src/stores/crmStore.ts:85-97`, `:245-282`). Para membros de equipe, o comentário registra que esse ID é o do dono da conta.
- `corretorIdDaContaApi()` reaproveita esse valor global ou busca `/api/perfil/corretor` uma vez (`src/stores/crmStore.ts:662-675`). Não recebe `organization_id`.
- No ramo Supabase, partes do frontend ainda resolvem a conta via `get_corretor_id()`, por exemplo `src/hooks/crm/useCrm.ts:60-63`; no ramo API, o servidor resolve o dono e o frontend omite `corretor_id` em operações novas (`src/hooks/crm/useCrm.ts:385-389`).
- A Rotina introduz o modelo mais próximo do alvo: `RoutineOrganization` contém `id` e `legacy_corretor_id` (`src/types/routine.ts:16-21`), e eventos/tarefas carregam `organization_id` (`:34-37`, `:67-70`).
- `useRoutineContext()` procura uma membership ativa do usuário com `.limit(1)` e sem seleção de organização (`src/hooks/routine/useRoutine.ts:43-71`). A API replica a mesma decisão em `api/src/rotina/rotina.contexto.ts:15-19`.
- A migration-base cria `routine_organizations.legacy_corretor_id` como `NOT NULL UNIQUE` e relaciona memberships a organizações (`supabase/migrations/20260821004218_rotina_operacional.sql:20-45`). O bootstrap liga a organização ao corretor legado (`:156-166`).
- O onboarding já cria/edita dados organizacionais e aceita convites: `src/hooks/useOnboarding.ts:141-160` atualiza `routine_organizations`; `:177-198` cria/aceita convite. A UI diferencia corretor autônomo, gestor, convidado e administrativo (`src/pages/Onboarding.tsx:536`) e descreve organização compartilhada (`:544`).

Leitura: `organization_id` existe na Rotina e no onboarding, mas o restante do produto continua ancorado na conta efetiva `corretor_id`. `legacy_corretor_id` é uma ponte 1:1 para dados legados, não um contexto selecionável de frontend. A busca arbitrária por uma membership ativa (`limit 1`, sem ordenação/seleção) não é contrato suficiente para multi-organização.

### 4. Query keys, store e persistência local

Pontos positivos:

- As queries de Rotina, exceto a de contexto, carregam organização nas chaves: membros, eventos, tarefas, atividade, inbox e Google (`src/hooks/routine/useRoutine.ts:25-36`). As consultas Supabase também filtram `organization_id` (`:76-185`).
- WhatsApp inclui `user?.id` em conversas, contadores, previews, mensagens, eventos e cliente (`src/features/whatsapp-inbox/ConnectedInbox.tsx:375-460`).
- Assinatura e uso carregam `corretorId` nas chaves (`src/hooks/useSubscription.ts:72`, `:97`, `:175`, `:222`).
- Existe limpeza global na mudança de usuário, cobrindo inclusive chaves legadas (`src/lib/auth/isolamentoSessao.ts:5-24`).

Riscos para troca de organização no mesmo usuário:

- O contexto da Rotina usa a chave fixa `['routine','context']` (`src/hooks/routine/useRoutine.ts:25-28`, `:43-50`). Com o `staleTime` global de 60 segundos, uma troca não representada na chave pode manter a organização antiga como fresca.
- O Zustand `crmStore` é singleton e armazena clientes, imóveis, contratos, alertas, perfil e `corretorContaId` sem namespace (`src/stores/crmStore.ts:77-104`, `:154-177`). `DataLoader` carrega essas listas apenas na montagem e não depende de organização (`src/components/DataLoader.tsx:10-33`).
- As chaves do CRM são globais: `['crm', ...]`, sem usuário ou organização (`src/hooks/crm/useCrm.ts:42-50`).
- As chaves de Asaas também são globais (`src/hooks/useAsaasConnection.ts:35-38`).
- Há várias chaves estáticas de locação, por exemplo `['rental-kpis']`/`['rental-resumo']` em `src/components/rental/DashboardKPICards.tsx:12-16`, `['rental-charts']` em `src/components/rental/DashboardCharts.tsx:15-22`, e `['rental-contracts']`, `['rental-bills']`, `['clients-select']` em `src/components/rental/NewContractDialog.tsx:125-176` e `:501-504`.
- Admin usa uma raiz global `['admin']` (`src/hooks/admin/usePapeis.ts:16-41`). Isso é coerente para o painel SaaS global, e a troca de usuário limpa o cache; não é um modelo para administração por organização.
- A etapa clássica do Funil e seus overrides são gravados sem tenant em `localStorage`: `lotti_funil_stages_v2` e `lotti_funil_client_stage_v1` (`src/pages/FunilVendas.tsx:84-108`, `:304`, `:685`).
- Configuração e logo de marca d'água também são globais no navegador (`src/components/midias/FotosIA.tsx:63-64`, `:368-403`, `:457-460`).
- Configuração local do agente usa `lotti:agent-settings` sem namespace (`src/features/ai-agent/settings.ts:4`, `:413-426`).
- A conversa aberta do Inbox usa `sessionStorage` fixo `lotti:inbox:conversa-aberta` (`src/features/whatsapp-inbox/ConnectedInbox.tsx:310`, `:332-341`). Mesmo que a API rejeite um ID de outra conta, a UI tentará restaurá-lo após uma troca de organização na mesma aba.

Classificação do risco: **alto para confidencialidade visual/transitória e integridade de UX** se a troca de organização for adicionada hoje. A autorização do servidor/RLS continua sendo a barreira de segurança, mas não impede que dados já presentes na memória/cache do navegador sejam renderizados até a nova leitura. Também há risco de preferências e IDs locais de uma organização contaminarem outra.

### 5. Feature flags

- `src/lib/flags.ts:13-30` possui somente duas flags de build: CRM (ligada por padrão, desligada apenas com `VITE_CRM_ENABLED=false`) e OAuth Microsoft derivada de `VITE_OAUTH_PROVIDERS`.
- O próprio arquivo registra corretamente que `VITE_*` é público e apenas esconde interface, sem proteger dados (`:4-10`).
- `src/App.tsx:210-220` usa `FLAGS.crm` para decidir entre CRM e funil clássico.

Leitura: o mecanismo serve para rollout global por build, não para capacidades por marca, plano, organização ou usuário. Não há provider, payload ou cache de capabilities por tenant.

### 6. Screens administrativas

- O backoffice tem layout e navegação dedicados, lazy loading e guard de papel: `src/App.tsx:95-112`, `:233-277`; `src/components/admin/AdminRoute.tsx:14-64`.
- As screens cobrem visão geral, contas, onboarding, parceiros, assinatura, pagamentos, cancelamentos, comissões, repasses, campanha, integrações, receita, auditoria e configurações (`src/App.tsx:245-276`).
- `adminKeys` organiza cache por domínio/filtro (`src/hooks/admin/usePapeis.ts:16-41`) e hooks de leitura/mutação centralizam invalidação (`src/hooks/admin/useAdminDados.ts:39-136`; `src/hooks/admin/useSaasDados.ts:33-164`).
- A semântica é de operador da plataforma: a sidebar chama usuários de “Contas Lotti” e renderiza `LottiLogo` diretamente (`src/components/admin/AdminSidebar.tsx:59-64`, `:102`, `:187`).
- `AdminConfiguracoes` lê/grava diretamente `admin_config` (`src/pages/admin/AdminConfiguracoes.tsx:32-73`), enquanto `useSaasDados` também expõe `admin_listar_config`/`admin_salvar_config` (`src/hooks/admin/useSaasDados.ts:287-316`). Essa duplicidade é evidência de transição de transporte, não de configuração de marca.

Leitura: boa base para o **backoffice central do operador SaaS**, mas apenas parcial para um **admin de organização/white-label**. Não há screen de seleção de organização, branding por organização, domínio, tema, logo do app, nome do produto ou capabilities do tenant.

### 7. Screen de organização e Rotina

- Organização existe dentro do onboarding, não como contexto global selecionável. `useOnboarding` expõe perfil, organização, convite, checklist e tour (`src/hooks/useOnboarding.ts:75-244`).
- Não foi encontrada rota `/organization`, `/organizacao` ou screen dedicada no mapa de `src/App.tsx:150-285`.
- A Rotina/Planejamento possui estados relevantes: skeleton inicial (`src/pages/Rotina.tsx:26-37`), ausência de contexto/migration (`:85-100`), erro da agenda (`:169-175`) e UI responsiva que inicia em dia no mobile e semana em telas maiores (`:45-47`).
- As ações da Rotina fazem leitura e escrita por organização no ramo Supabase e pelo contexto resolvido no servidor no ramo API (`src/hooks/routine/useRoutine.ts:76-218`, `:238-469`).
- Os query keys de itens incluem organização; a chave de contexto e a resolução `limit 1` continuam sendo o ponto incompleto.

Leitura: Rotina é o módulo mais preparado para adaptação ao modelo organizacional, mas não implementa troca de organização e ainda depende da ponte `legacy_corretor_id` para integrar CRM legado.

### 8. Branding e tema

Pontos reutilizáveis:

- O design system concentra cores semânticas em CSS custom properties (`src/index.css:7-122`) e mantém uma variante dark (`:124-182`). Componentes usam tokens como `primary`, `background`, `muted`, `border` e status.
- O logo vetorial usa `currentColor`, facilitando recoloração (`src/components/brand/LottiLogo.tsx:3-30`, `:60-87`).
- `ThemeProvider` centraliza tema e persistência via `next-themes` (`src/components/theme-provider.tsx:16-27`).

Acoplamentos à marca:

- A paleta é declarada explicitamente como “PALETA LOTTI” e contém escala `--brand-*` fixa (`src/index.css:8-13`, `:87-101`).
- `ThemeProvider` documenta e força a identidade Lotti como default (`src/components/theme-provider.tsx:5-21`).
- Logo, wordmark e `aria-label` são Lotti hard-coded (`src/components/brand/LottiLogo.tsx:24`, `:53`, `:64-87`), usados diretamente nas sidebars do app e do admin (`src/components/layout/AppSidebar.tsx:207-211`; `src/components/admin/AdminSidebar.tsx:102`, `:187`).
- Metadados e favicon são fixos: `index.html:6-13` e `:26`.
- Textos de produto permanecem fixos em telas, como “Assistente Lotti” (`src/components/ai/AIConversationList.tsx:91`) e “IA Lotti” (`src/components/ai/AIChatWidget.tsx:81-114`, `:236-245`).
- Não foi encontrado `BrandProvider`, contrato `Brand`, carregamento de branding por hostname/organização ou atualização dinâmica de `document.title`/favicon.

Leitura: os tokens tornam a aparência adaptável, mas a fonte dos valores e os assets/textos continuam estáticos. Branding runtime está ausente.

## Matriz de classificação

| Área | Classificação | Evidência resumida | Risco/limite |
|---|---|---|---|
| Providers e shell React | **reutilizar** | Provider tree único, lazy routes, error/loading boundaries (`src/App.tsx:114-149`) | Precisa receber contexto de marca/org sem duplicar providers |
| Roteamento operacional | **adaptar** | Rotas completas e guardadas (`src/App.tsx:187-229`) | Mapa central acoplado a flags de build e produto único |
| Auth e guards | **adaptar** | Sessão única, API/Supabase, guards e limpeza entre usuários (`src/hooks/useAuth.tsx`, `src/lib/auth/isolamentoSessao.ts`) | Não modela organização selecionada pelo mesmo usuário |
| Contexto de organização | **parcial** | Rotina/onboarding têm organization/membership e `legacy_corretor_id` | Seleção ausente; `limit 1`; restante do produto usa conta implícita |
| Zustand operacional | **parcial** | Store central e limpeza explícita (`src/stores/crmStore.ts:154-177`) | Singleton sem namespace por organização |
| React Query | **parcial** | Rotina e algumas telas incluem org/user; invalidações estão consolidadas | Muitas keys globais; contexto da Rotina fixo; `staleTime` amplifica janela |
| Persistência browser | **adaptar** | Preferências locais bem isoladas por finalidade | Funil, watermark, agente e Inbox não têm namespace de org |
| Feature flags | **obsoleto para white-label** | Flags de build honestamente limitadas (`src/lib/flags.ts`) | Não atende capabilities runtime por marca/org/plano |
| Backoffice SaaS | **reutilizar** | Guard, layout, paginação/filtros e hooks administrativos | É painel central Lotti, não admin de tenant |
| Admin de organização/branding | **ausente** | Nenhuma rota/screen/contrato de branding por organização encontrado | Bloqueia gestão self-service da marca |
| Rotina/Planejamento | **adaptar** | Dados e keys majoritariamente por `organization_id` | Contexto arbitrário `limit 1`; ponte 1:1 para corretor legado |
| Branding visual | **parcial** | Tokens CSS e SVG com `currentColor` | Nome, assets, metadados, paleta e copy hard-coded |
| Screens operacionais | **reutilizar/adaptar** | Cobertura ampla e estados de loading/error em módulos centrais | Dependem de conta implícita e textos Lotti em pontos transversais |

## Restrições verificadas antes de qualquer implementação

1. O frontend atual não possui uma operação de “trocar organização”; portanto, não há comportamento existente a preservar para esse fluxo nem teste de regressão correspondente.
2. `corretor_id` ainda é o eixo efetivo da maior parte dos dados. `organization_id` não pode simplesmente substituí-lo no frontend sem contrato de backend, pois `legacy_corretor_id` é usado como ponte para clientes, imóveis e contratos existentes.
3. A limpeza de cache atual está associada ao usuário. Qualquer futura seleção de organização precisará ser uma fronteira de isolamento tão explícita quanto a troca de sessão; apenas invalidar algumas queries não cobre Zustand e storage do navegador.
4. A configuração de marca não existe como fonte de dados. Trocar apenas CSS/logo local criaria um fork visual, não white-label runtime.
5. O backoffice administrativo existente é global e Lotti-branded. Reaproveitá-lo como admin de tenant sem separar papéis/capabilities alteraria o modelo de autorização, não apenas a interface.

## Validação e limitações deste review

- Verificado por leitura estática no snapshot informado, com referências de arquivo/linha e busca dirigida por `corretor_id`, `legacy_corretor_id`, `organization_id`, query keys, stores, auth, flags, admin, Rotina e branding.
- Confirmados `HEAD` e árvore limpa antes da leitura.
- Não executado: app, testes, build, navegador, fluxos autenticados ou inspeção de dados reais. Assim, estados visuais e comportamento runtime não foram revalidados nesta tarefa.
- Não avaliado em profundidade: contratos de backend além do necessário para confirmar como o frontend resolve o contexto da Rotina; segurança do banco/RLS não é objeto deste relatório.
- Nenhuma proposta de implementação foi convertida em código; a evidência acima deve preceder decisões de arquitetura/produto sobre seleção de organização, resolução de marca e capabilities.
