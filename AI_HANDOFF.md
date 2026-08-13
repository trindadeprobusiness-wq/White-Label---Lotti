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
