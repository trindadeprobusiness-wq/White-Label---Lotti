# ADR-000 — Repositório canônico do White Label

- Estado: estratégia local autorizada; cutover externo permanece pendente de checkpoint próprio; sem alteração remota.
- Snapshot de referência: `main` em `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`.
- Destino pretendido: `https://github.com/trindadeprobusiness-wq/White-Label---Lotti.git`.
- Autor: Orquestrador de Engenharia.

## Contexto observado

O pedido define o repositório White Label como destino do produto e descreve um único produto para corretor autônomo e imobiliária. O destino foi consultado por `git ls-remote --symref <URL> HEAD refs/heads/*`: comando terminou com código 0 e não retornou refs. Isso indica ausência de refs visíveis nessa consulta, não comprova permissão de escrita nem configurações do GitHub.

O core de referência foi clonado localmente para leitura em `projetos/lotti-white-label`; `main` estava em `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`, árvore limpa, sem tags/submódulos e com 72 refs remotas. A inspeção de ancestralidade mostrou 59 dessas branches já alcançadas por `core/main` e 13 não alcançadas; nomes/SHA/data/assunto foram registrados em `branches-g0.tsv` e precisam de triagem antes de qualquer migração externa. O core é uma aplicação única com SPA e API, migrações Prisma ativas e migrações Supabase históricas congeladas. Não há checkout anterior detectado para o destino.

O relatório preliminar de Arquitetura recomendou manter o core como canônico enquanto a transferência de titularidade não estivesse confirmada. O Orquestrador reavaliou essa recomendação diante da instrução explícita para executar o plano e do requisito que identifica o repositório White Label como destino. Em recheck deste ADR, Arquitetura considerou a opção 1 adequada somente para preparação local e não aprovou cutover externo. Gabriel instruiu: “execute esse plano ... não precisa me pedir permissão pode prosseguir até finalizar”. O corte externo não está implícito nessa preparação e exige o checkpoint de publicação aplicável.

## Opções

| Opção | Vantagens | Custos e riscos | Adequação agora |
|---|---|---|---|
| 1. Importar histórico do core e tornar White Label o canônico | Um histórico auditável e um único produto; autonomia de ciclo de vida no destino; mantém modos autônomo e organizacional na mesma árvore | Exige inventário e transferência explícita de branches úteis, CI, acessos e integrações; risco de dois canônicos se o core continuar recebendo mudanças | **Recomendada**, porque o pedido nomeia o destino como repositório de produto; iniciar com `main` e preservar/inventariar refs antes de qualquer descarte |
| 2. Manter core canônico e usar o destino para docs/infra | Menor migração imediata e preserva o fluxo atual | Divide documentação/infra do código e pode criar dois lugares operacionais; não atende ao destino como lar do produto | Alternativa se a titularidade do core precisar permanecer inalterada |
| 3. Extrair pacotes compartilhados | Pode desacoplar componentes se houver vários consumidores reais | Publicação, versionamento e compatibilidade adicionais; sem segundo consumidor confirmado, cria custo sem benefício demonstrado | Adiar; reavaliar quando existirem ao menos dois consumidores e contratos estáveis |

## Recomendação e limites

Recomendo e adotarei a opção 1 como arquitetura alvo da preparação local: o repositório White Label torna-se a fonte canônica de código; o core é referência de origem. A preparação local ainda não altera o estado nem o fluxo do core. Antes do cutover externo, confirmar titularidade/acessos do destino, política explícita de congelamento ou escrita somente no novo canônico, responsáveis pelo corte e automações/CI. Assim evita-se manter dois canônicos ativos. Preservar o histórico de `main` exatamente no SHA registrado; inventariar cada branch antes de decidir importar ou não, sem apagar refs na origem. Não criar forks por imobiliária nem branches permanentes por persona/cliente.

Fluxo proposto: `main` estável; branches curtas `feat/wl-<id>` e `fix/wl-<id>`; integração local controlada pelo Orquestrador depois de staging explícito e revisão independente. CODEOWNERS lógico será mapeado a caminhos e identidades reais antes de configuração. Migrations continuam via trilha Prisma documentada no projeto, com revisão de SQL, testes e plano compensatório; migração remota exige checkpoint próprio.

## Consequências e checkpoints

- Preparação local concluída em `projetos/White-Label---Lotti`, clonada a partir do snapshot local confirmado. `main` permanece no SHA `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`, árvore limpa. `origin` aponta ao destino, para o qual não havia refs visíveis no último `ls-remote`; `core` aponta ao repositório fonte e contém 72 refs rastreadas. Não foi configurado upstream automático para `main`; nenhum push ocorreu. Não há transferência de issues/PRs/permissões/configuração do GitHub pelo histórico Git.
- Não executar push, alterar configuração remota, protections, Actions, DNS, deploy, migration ou ambientes externos neste ADR.
- A autorização geral para continuar cobre trabalho local. O primeiro push/cutover externo continua dependente do checkpoint específico de produção/publicação e da comprovação de titularidade do destino, acessos, automações/CI, política de escrita única no core e inventário das branches.
- Antes dos briefs de implementação afetados, cinco gates dependem de decisão explícita de Gabriel (classe c em `g1-product-decisions.md`): canal de cadastro/entrada de convidado, entrega/reenvio de convites, semântica de consumo de `max_users`, canal de assinatura e evento oficial de ativação. Produto e Arquitetura podem preparar opções e defaults, mas não aprovar esses itens em nome de Gabriel. Já estão determinados pelo brief: produto único, memberships simultâneas, contexto ativo validado pelo servidor, convite vinculado ao e-mail autenticado, backoffice global separado, capabilities/scopes e nenhum preço sem dados. Defaults reversíveis, não aprovados: prévia do convite, seletor explícito de organização, aviso de capacidade ao preparar convite e navegação Conta→Organização. Dentro do gate `max_users`, recomenda-se provisoriamente consumir a vaga no aceite; a decisão continua dependendo de Gabriel. A trilha de Segurança ainda precisa concluir o threat model.

## Critérios de reabertura

Reabrir se a titularidade do core não puder ser transferida, se houver consumidor independente comprovado que exija pacote versionado, ou se workflows/branches ativos dependerem do repositório original de modo incompatível com o cutover.

## Evidências

- `snapshot-g0.json`: URL de origem, destino, commit e contagens de refs.
- `g1-product.md`, `g1-product-decisions.md`, `g1-frontend.md`, `g1-database.md`, `g1-qa.md`: descoberta do Gate 1 no mesmo SHA.
- `baseline.md`: comandos locais e resultados observados.
