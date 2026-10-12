# WL-G0 — Baseline local do core de referência

- Classificação: MAINTENANCE / Gate 0, inventário e verificações somente locais.
- Repositório de referência: `C:\Users\Gabri\Documents\Codex\Engenharia\projetos\lotti-white-label`.
- Branch/SHA: `main` / `40d7e84e2a5b12a23b5a4de4c3fe33353a267a86`.
- Node: `v24.11.0`; npm: `11.6.1`.
- `git status --short` antes e depois: vazio; nenhum arquivo versionado do core alterado.
- Dependências locais instaladas via `npm ci --ignore-scripts --no-audit --no-fund` no root e `api`. Build da API executado em seguida e gerou Prisma Client v6.19.3. Conteúdo de `node_modules` é ignorado pelo Git.
- O controlador não abriu nem exibiu conteúdo de `.env`, segredo, dado pessoal ou cliente. Listagem de nomes no topo do checkout root/API encontrou apenas `.env.example` na raiz; o arquivo não foi lido. Comandos que carregam configuração automaticamente não foram auditados internamente. Nos testes da API, variáveis de banco/Supabase/provedores foram removidas apenas do processo filho; na SPA, foram usadas somente as duas strings fictícias do CI.

## SPA / root

| Comando | Resultado observado | Notas |
|---|---|---|
| `npm test` | Falhou no ambiente sem configuração: 9 arquivos falhos, 199 passaram; 5 testes falharam, 1.558 passaram, 3 expected-fail e 9 skipped | Incluiu erros `supabaseUrl is required` e falhas de inicialização/timeout de workers; não é comparável ao CI que injeta valores fictícios |
| `npm test -- --minWorkers=1 --maxWorkers=2` | Falhou imediatamente | Vitest 4.1.11 não reconhece `--minWorkers`; nenhum teste iniciou |
| Com `VITE_SUPABASE_URL=https://example.supabase.co` e `VITE_SUPABASE_PUBLISHABLE_KEY=test-public-key`, `npm test -- --maxWorkers=4` | Resumo Vitest: 1 arquivo falhou, 212 passaram; 1 teste falhou por timeout, 1.716 passaram, 3 expected-fail; nenhum skipped indicado. A falha foi `src/pages/ImovelDetalhes.webhook.api.test.tsx` acima de 5 s. Após o resumo, o wrapper foi interrompido; exit code do Vitest não foi preservado | Diferença para a primeira execução: variáveis faltantes foram preenchidas com valores fictícios e a suíte coletou 5 arquivos adicionais; primeira execução também teve worker boot timeouts. Não comparar contagens como se fossem o mesmo conjunto coletado. Strings fictícias iguais às do workflow CI; sem serviço/credencial real |
| `npm run typecheck` | Falhou (exit 1), com 174 linhas reportadas e múltiplos erros TS | Exemplos: tipos Supabase não incluem tabelas consumidas (`ai_conversations`, `fachada_templates`, `subscription_addons`); fixtures `AIConversation` incompletas; incompatibilidades em props/types. Não corrigido por ser baseline |
| `npm run lint` | Falhou (exit 1): 157 errors e 33 warnings | Varreu também `api/dist` gerado e ignorado; regra TypeScript ausente em arquivos emitidos; vários `any`, control chars e outras violações no snapshot. Não corrigido |
| `npm run build` com as duas variáveis fictícias do CI | Passou (exit 0), Vite transformou 4.478 módulos | Avisos: `VITE_API_URL` indefinida em `index.html` e valor inválido de tema Tailwind `[scrollbar-color:theme(colors.border)_transparent]` |
| `npm run audit:security` | Passou (exit 0), `found 0 vulnerabilities` | É `npm audit --omit=dev --audit-level=low`; cobre dependências de produção nesta instalação |

## API

| Comando | Resultado observado | Notas |
|---|---|---|
| `npm run build` | Passou (exit 0) | Executado anteriormente; build gera Prisma Client e compila API |
| `npm run typecheck` | Passou (exit 0) | `tsc --noEmit` |
| `npm test` com variáveis de banco/Supabase/provedores removidas no processo filho | Incompleto; múltiplos testes Jest excederam timeout de 5 s e a execução foi encerrada pelo controlador depois de vários timeouts, sem resumo Jest final | Exemplos observados em `crm-clientes.controller.spec.ts`, `rotina.controller.spec.ts`, `crm-funil.controller.spec.ts`, `repasses.controller.spec.ts`, `asaas-conexao.controller.spec.ts` e `notificacoes.spec.ts`. Processo permaneceu lento por vários minutos sob carga; wrapper reportou interrupção/exit 1. Não classificar como falha funcional confirmada. Fases subsequentes schema/dados/SQL não foram alcançadas |

## Não executado

- `npm run test:security-browser`/Playwright: não executado; dependência de browser pode exigir instalação de binário.
- Lint/typecheck da API além do typecheck já executado; a API não declara lint próprio no script usado.
- `supabase` CLI, database remoto, SQL real contra ambiente conectado, migration, E2E autenticado multi-tenant, preview/staging, deploy e push.
- Nenhuma falha foi corrigida; isto é baseline, não aceite funcional ou de segurança.
