# WL-G1 — Síntese do inventário

## Base e estado

Snapshot fixo: `main` em `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`. Relatórios de Frontend, Produto, Banco, QA e Backend confirmaram essa base e árvore limpa. Inventário de DevOps foi absorvido pelo Orquestrador via clone/CLI; sem resposta independente do terminal DevOps. O relatório de Segurança está pendente: seu terminal parou na solicitação de permitir leituras fora do diretório de trabalho e não foi concedida ampliação de acesso. Nenhum agente recebeu autorização para ler segredos/dados reais ou executar alterações no core.

## Recursos reais do canvas e posse desta onda

Todos os nomes abaixo foram obtidos por `maestri list`; nomes são terminais reais, não papéis presumidos. Para a onda G1, os agentes só leram o core; cada relatório em `sistema/lotti-white-label/` tem caminho exclusivo. O Orquestrador é o único escritor dos documentos de consolidação. Não houve paralelismo de escrita no core.

| Recurso real | Competência nesta onda | Responsabilidade / posse | Dependências |
|---|---|---|---|
| Orquestrador de Engenharia | Coordenação/integração | `ADR-000-repositorio-canonico.md`, `baseline.md`, `g1-synthesis.md`; único integrador local | Snapshot G0 |
| Explorador de Código | Descoberta de estrutura e fluxos | inventário G0 somente leitura já retornado na trilha de coordenação; sem escrita no core | Snapshot G0 |
| Arquitetura e Planejamento | Repositórios, decisões e arquitetura | parecer inicial: opção 2 até confirmar titularidade; no recheck considerou opção 1 adequada para preparação local, sem aprovar cutover; sem edição no core | Snapshot G0 |
| Produto e Requisitos | Jornadas, contratos e aceites | `g1-product.md` | Snapshot G0 |
| Engenharia de Frontend | Shell, providers, rotas, cache e UI | `g1-frontend.md` | Snapshot G0 |
| Banco de Dados | schema, migrations, ownership e RLS | `g1-database.md` | Snapshot G0 |
| Testes e QA | inventário de testes e lacunas | `g1-qa.md` | Snapshot G0 |
| Segurança | threat review estática | relatório solicitado `g1-security.md`, não entregue por bloqueio de leitura do terminal | Snapshot G0; acesso autorizado ao checkout ainda bloqueado |
| Engenharia de Backend | caminhos API/integrações | `g1-backend.md`, análise estática somente leitura; limitações e trilhas G2 registradas | Snapshot G0; sem teste, DB ou runtime externo |
| DevOps e Release | inventário operacional baseline | terminal atingiu limite de uso; fatos mecânicos verificados pelo controlador e anotados em `baseline.md`, sem revisão independente | Snapshot G0 |
| Depuração e Bugs | sem tarefa nesta onda | não acionado: baseline, não correção de bug | — |
| Revisão de Código | revisão independente | revisou documentos G0/G1 e diffs de handoff; nenhum diff de código do core | Snapshot G0 + branch local |
| Memória e Documentação | atualização documental | não acionado; relatórios exclusivos foram escritos pelos autores responsáveis | — |

## Mapa do produto e isolamento

- O pedido define um único SaaS para autônomo e imobiliária, mas o core divide ownership em três chaves por registro (`corretor_id`, `organization_id`, `owner_id`), além de superfícies globais/admin sem chave de tenant uniforme.
- A rotina organizacional existente é base parcial reutilizável. `routine_organizations.legacy_corretor_id` mantém ponte 1:1 com o legado; a membership ativa é exclusiva por usuário e funções escolhem membership com `LIMIT 1`.
- A camada de dados atual usa migrations Prisma como fonte vigente; migrations Supabase estão congeladas como histórico/paridade. Não misturar as duas filas.
- Backend/API Node e SPA React coexistem. O modelo Prisma não inclui todo o catálogo SQL: existem objetos em SQL/RLS/grants fora do schema Prisma, e alguns objetos/tabelas ainda ausentes da trilha ativa.
- Backend relata que a API ainda resolve o tenant como corretor via `get_corretor_id()` e não possui conceito de marca. O acesso observado divide-se entre `TenantDb`, `ServicoDb` e usos diretos de `PrismaService`; o papel real de `DATABASE_URL` não foi confirmado e os usos diretos não foram auditados linha a linha.
- Achado estático reportado como **alto no cenário WL**: token global do runtime de agente com endpoints de storage sem escopo por tenant. O runtime externo não estava no snapshot; não houve exploração nem teste. Outros riscos reportados: a rota de visitas recebe `corretorId` do runtime, sem prova de identidade do chamador; superfície presumida de bypass RLS em cerca de 30 arquivos `PrismaService`; jobs globais; e CORS/origem fixa no backend e em Edge Function. Ver `g1-backend.md` §§3–8.
- Frontend reutiliza shell, providers, rotas, tokens e guards; não tem branding de runtime nem administração de organização. Cache/estado persistente não está uniformemente particionado por organização — risco P0 quando houver troca de contexto.
- Produto separou regras já dadas, defaults reversíveis e cinco decisões explícitas de Gabriel. Multi-org simultânea e fronteira do backoffice global são requisitos determinados; prévia explícita do convite antes do aceite, seletor de organização, aviso de capacidade ao preparar convite e navegação Conta→Organização são defaults reversíveis. Os gates de Produto ainda abertos são canal de cadastro/convidado, entrega/reenvio, semântica de `max_users`, canal de assinatura e evento oficial de ativação.
- QA achou casos existentes de suspensão e IDs cruzados, mas não uma matriz E2E comprovando dois tenants/quatro papéis, troca em duas abas ou isolamento completo de cache.

## Estado das ameaças do Gate 1

| Ameaça/controle | Estado desta descoberta | Evidência/limite |
|---|---|---|
| Mistura de ownership entre tenants | Confirmado como risco arquitetural | Banco documenta três chaves por registro (`corretor_id`, `organization_id`, `owner_id`) e superfícies globais/admin; ainda não é prova de exploração |
| Seleção explícita de tenant e membership suspensa | Parcial/insuficiente para multi-org | Membership exclusiva + `LIMIT 1`; comportamento da nova arquitetura requer design |
| Cache ao alternar organização | Risco indicado pela inspeção frontend | Chaves e stores não particionados uniformemente; troca de org ainda não existe; sem teste dinâmico |
| RLS/IDs cruzados | Controles e testes estáticos existem; cobertura incompleta | Testes não demonstram matriz uniforme nem execução contra DB real |
| Token global do runtime e Storage de agente | Risco reportado como alto no cenário WL; não reproduzido | Backend identificou token compartilhado e rotas de storage sem amarração a tenant; runtime externo não auditado (`g1-backend.md` §§2, 5.4–5.5, 6 R1–R2) |
| Bypass RLS por `PrismaService` | Risco presumido; auditoria incompleta | Cerca de 30 arquivos usam serviço diretamente; papel de `DATABASE_URL` desconhecido e somente uma amostra revisada (`g1-backend.md` §4, §8) |
| Quotas/convites | Requisito parcial | Produto não encontrou `checar_cota(..., 'max_users')` no caminho observado do convite; falta definir momento de consumo |
| Storage/URLs assinadas, webhooks, jobs e IA entre tenants | Inventário estático parcial de Banco e Backend; revisão independente de Segurança indisponível | Asaas resolve conexão por slug/token e registra eventos; unicidade global e retry/jobs pedem avaliação; sem exploração dinâmica, banco real ou avaliação de payload real (`g1-backend.md` §§5.3, 5.6, 6 R5–R8) |
| Webhooks/callbacks n8n, captura pública de leads e Google Agenda | Não verificados em detalhe pelo Backend | `g1-backend.md` §§5.2, 8 lista serviços/repositórios e policies RLS tabela a tabela não lidos; atribuição de tenant e replay continuam sem dono verificado |
| Origem/domínio por marca | Ausente no snapshot e parcialmente rígido | Backend reporta origem fixa em CORS e origem hardcoded na Edge `lotti-whatsapp`; não houve teste de domínio/ambiente (`g1-backend.md` §6 R4) |
| Domínio, suporte privilegiado e segredos | Não verificado integralmente | Sem DNS/ambiente remoto, sem segredos e sem validação operacional de privilégio |

## Gate status

- Gate 0: estratégia alvo opção 1 adotada para preparação local sob a instrução expressa de prosseguir sem nova permissão; sem push/configuração remota. Arquitetura revisou a atualização e considerou a opção adequada somente para preparação local, sem aprovar cutover externo. Cutover externo continua condicionado a titularidade/acessos, política de congelamento ou escrita única do core, responsáveis e automações/CI revisados.
- Gate 1: Frontend, Produto, Banco, QA e Backend têm relatórios estáticos com caminhos/linhas; baseline parcial executado pelo Orquestrador, sem revisão independente. **Gate ainda aberto** porque a concordância independente de Segurança não foi obtida e não houve teste dinâmico abrangente. Para G2 continuam a auditoria linha a linha dos usos de `PrismaService`, o contrato de tenant para tokens/runtime, webhooks/callbacks n8n, captura pública de leads, Google Agenda e policies RLS tabela a tabela. Qualquer adaptação Asaas/Gemini depende de decisão humana explícita conforme a restrição registrada no projeto.
- Gate 2 não iniciado: cinco decisões de Produto dependem de decisão explícita de Gabriel (classe c em `g1-product-decisions.md`): canal de cadastro/entrada de convidado, entrega/reenvio de convites, semântica de consumo de `max_users`, canal de assinatura e evento oficial de ativação. Defaults reversíveis sugeridos (não aprovados) incluem prévia do convite, seletor explícito de organização, aviso de capacidade ao preparar convite e navegação Conta→Organização. Dentro do gate `max_users`, recomenda-se provisoriamente consumir a vaga no aceite; isso continua dependendo de decisão de Gabriel. Já determinados pelo brief: produto único, memberships simultâneas, contexto ativo validado pelo servidor, convite vinculado ao e-mail autenticado, backoffice global separado, capabilities/scopes e nenhum preço sem dados. A trilha de Segurança ainda precisa concluir o threat model. Nenhuma migration criada.

Threat model preliminar redigido pelo Orquestrador em `g1-threat-model-preliminary.md`; não substitui validação de Segurança.
