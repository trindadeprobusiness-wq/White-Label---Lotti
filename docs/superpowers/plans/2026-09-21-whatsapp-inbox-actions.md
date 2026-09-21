# WhatsApp Inbox Actions Implementation Plan

**Status:** implementação concluída e verificada em 2026-09-21; publicação da migration e Edge Function permanece externa ao PR.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar persistentes e funcionais as ações Nova conversa, editar nome e fechar/reabrir no Inbox conectado, preservando o visual Clix aprovado.

**Architecture:** Uma migration aditiva fornece três RPCs autenticadas e um gatilho de reabertura por nova mensagem. A Edge Function cria/localiza a conversa antes de reutilizar o envio manual idempotente já existente. Componentes de diálogo isolados mantêm o `ConnectedInbox` responsável apenas por consultas, mutations e composição da tela.

**Tech Stack:** React 18, TypeScript, TanStack Query, shadcn/Radix Dialog, Vitest/Testing Library, Supabase PostgreSQL/RLS, Supabase Edge Functions (Deno).

**Spec:** `docs/superpowers/specs/2026-09-21-whatsapp-inbox-actions-design.md`

## Global Constraints

- Alterar somente Nova conversa, edição do nome e fechar/reabrir conversa.
- Atribuição, tags, notas, busca por CPF, biblioteca de templates e anexos na primeira mensagem ficam fora do escopo.
- Nenhuma operação pode confiar em `corretor_id`, `channel_id` ou propriedade enviados pelo navegador.
- Envio inicial deve reutilizar a reserva/idempotência do envio manual atual.
- Erro preserva os dados digitados; diálogo fecha somente após confirmação persistente.
- Entrega em `codex/whatsapp-inbox-actions` por Pull Request, sem push direto para `main`.

---

### Task 1: Persistência autorizada das ações do Inbox

**Files:**
- Create: `supabase/migrations/20260921130000_lotti_inbox_actions.sql`
- Create: `supabase/migrations/lotti-inbox-actions.test.ts`
- Modify: `src/integrations/supabase/types.ts` somente se a geração local já representar migrations aditivas neste projeto; caso contrário, manter a projeção tipada local usada pelo Inbox.

**Interfaces:**
- Produces: `lotti_inbox_start_conversation(p_phone text, p_name text) returns uuid`
- Produces: `lotti_inbox_rename_client(p_conversation uuid, p_name text) returns text`
- Produces: `lotti_inbox_set_status(p_conversation uuid, p_status text) returns text`
- Produces: coluna `lotti_agent_conversations.status text not null default 'open' check (status in ('open','closed'))`

- [ ] **Step 1: Escrever o teste de banco que falha**

Criar um harness PGlite seguindo `supabase/migrations/public-security.test.ts`. Aplicar um schema mínimo com `auth.users`, `corretores`, `clientes`, `lotti_agent_channels`, `lotti_agent_conversations` e `lotti_agent_messages`, depois carregar a migration nova. Cobrir:

```ts
it('cria ou reutiliza cliente e conversa somente no canal conectado do usuário', async () => {
  const first = await rpcAs(ownerA, "select public.lotti_inbox_start_conversation('5562999999999','Maria') id");
  const again = await rpcAs(ownerA, "select public.lotti_inbox_start_conversation('(62) 99999-9999','Maria') id");
  expect(again.rows[0].id).toBe(first.rows[0].id);
  await expect(rpcAs(ownerB, `select public.lotti_inbox_rename_client('${first.rows[0].id}','Outro')`)).rejects.toThrow();
});

it('fecha, reabre e reabre automaticamente ao receber mensagem', async () => {
  await rpcAs(ownerA, `select public.lotti_inbox_set_status('${conversationId}','closed')`);
  expect(await status(conversationId)).toBe('closed');
  await insertInbound(conversationId, 'nova mensagem');
  expect(await status(conversationId)).toBe('open');
});
```

- [ ] **Step 2: Executar o teste e confirmar RED**

Run: `npm test -- --run supabase/migrations/lotti-inbox-actions.test.ts`  
Expected: FAIL porque migration/RPCs ainda não existem.

- [ ] **Step 3: Implementar a migration mínima**

Implementar:

```sql
alter table public.lotti_agent_conversations
  add column if not exists status text not null default 'open'
  check (status in ('open','closed'));

create or replace function public.lotti_inbox_start_conversation(p_phone text, p_name text default null)
returns uuid language plpgsql security definer set search_path='' as $$
-- resolve corretor por auth.uid(); normaliza para dígitos; exige 10..15 dígitos;
-- seleciona um canal enabled do próprio corretor; cria/reutiliza cliente e conversa;
-- nunca aceita owner/channel fornecido pelo cliente; retorna conversation.id.
$$;

create or replace function public.lotti_inbox_rename_client(p_conversation uuid, p_name text)
returns text language plpgsql security definer set search_path='' as $$
-- limita trim(name) a 120; exige conversa do corretor autenticado e cliente_id;
-- atualiza apenas esse cliente e retorna o nome salvo.
$$;

create or replace function public.lotti_inbox_set_status(p_conversation uuid, p_status text)
returns text language plpgsql security definer set search_path='' as $$
-- aceita open|closed; exige propriedade; ao fechar também muda mode para paused;
-- retorna o status persistido.
$$;
```

Adicionar gatilho `after insert on lotti_agent_messages` que atualiza `status='open'` apenas quando `new.direction='in'`. Revogar execução de `public/anon` e conceder somente a `authenticated` para os três RPCs.

- [ ] **Step 4: Executar teste e confirmar GREEN**

Run: `npm test -- --run supabase/migrations/lotti-inbox-actions.test.ts`  
Expected: PASS para autorização cruzada, idempotência, rename, fechamento e reabertura.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260921130000_lotti_inbox_actions.sql supabase/migrations/lotti-inbox-actions.test.ts
git commit -m "feat(whatsapp): persistir ações essenciais do inbox"
```

### Task 2: Início idempotente de conversa pela Edge Function

**Files:**
- Create: `supabase/functions/lotti-whatsapp/request.ts`
- Create: `supabase/functions/lotti-whatsapp/request.test.ts`
- Modify: `supabase/functions/lotti-whatsapp/index.ts`

**Interfaces:**
- Consumes: `lotti_inbox_start_conversation(phone, name) -> conversation_id`
- Produces: body `{ action:'start', phone:string, name?:string, text:string, request_id:string }`
- Produces: response `{ conversationId:string, sendStatus:'sent'|'sending'|'uncertain'|'failed'|'busy' }`

- [ ] **Step 1: Escrever testes falhando do contrato**

Extrair validação pura para `request.ts` e cobrir:

```ts
expect(parseLottiRequest({ action: 'start', phone: '(62) 99999-9999', name: ' Maria ', text: 'Olá', request_id: UUID }))
  .toEqual({ action: 'start', phone: '5562999999999', name: 'Maria', text: 'Olá', request_id: UUID });
expect(() => parseLottiRequest({ action: 'start', phone: '12', text: 'Olá', request_id: UUID })).toThrow('invalid_phone');
expect(() => parseLottiRequest({ action: 'start', phone: '5562999999999', text: '', request_id: UUID })).toThrow('invalid_text');
```

Adicionar teste de handler com dependências injetadas: `start` chama uma vez `startConversation`, depois encaminha ao bridge como `action:'send'`, `kind:'text'`, o `conversation_id` resolvido e o mesmo `request_id`.

- [ ] **Step 2: Executar e confirmar RED**

Run: `npm test -- --run supabase/functions/lotti-whatsapp/request.test.ts`  
Expected: FAIL porque parser/ação `start` não existem.

- [ ] **Step 3: Implementar ação mínima**

Em `index.ts`, manter autenticação e resolução do corretor atuais. Para `start`:

```ts
const { data: conversationId, error: startError } = await userClient.rpc(
  'lotti_inbox_start_conversation',
  { p_phone: request.phone, p_name: request.name ?? null },
);
if (startError || !conversationId) return json({ error: 'conversation_unavailable' }, 409);
const bridgeBody = {
  action: 'send',
  corretor_id: owner.id,
  conversation_id: conversationId,
  request_id: request.request_id,
  kind: 'text',
  text: request.text,
};
```

Retornar `conversationId` junto de `sendStatus`; preservar o mapeamento atual de `busy`, `failed` e `uncertain`.

- [ ] **Step 4: Executar e confirmar GREEN**

Run: `npm test -- --run supabase/functions/lotti-whatsapp/request.test.ts`  
Expected: PASS.

- [ ] **Step 5: Verificar bundle da função**

Run: `npx esbuild supabase/functions/lotti-whatsapp/index.ts --bundle --platform=neutral --format=esm --outfile="$env:TEMP/lotti-whatsapp-actions.mjs" --external:https:* --external:npm:* --external:jsr:*`  
Expected: bundle concluído sem erro de resolução local.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/lotti-whatsapp/index.ts supabase/functions/lotti-whatsapp/request.ts supabase/functions/lotti-whatsapp/request.test.ts
git commit -m "feat(whatsapp): iniciar conversa pelo canal conectado"
```

### Task 3: Diálogos funcionais no Inbox conectado

**Files:**
- Create: `src/features/whatsapp-inbox/InboxActionDialogs.tsx`
- Create: `src/features/whatsapp-inbox/InboxActionDialogs.test.tsx`
- Modify: `src/features/whatsapp-inbox/ConnectedInbox.tsx`
- Modify: `src/features/whatsapp-inbox/ConnectedInbox.test.tsx`

**Interfaces:**
- Produces: `NewConversationDialog({ open, onOpenChange, onSubmit, pending, error })`
- Produces: `RenameContactDialog({ open, initialName, onOpenChange, onSubmit, pending, error })`
- Produces: `ConversationStatusDialog({ open, status, onOpenChange, onConfirm, pending, error })`
- Consumes: Edge action `start`; RPCs `lotti_inbox_rename_client` e `lotti_inbox_set_status`.

- [ ] **Step 1: Escrever testes falhando dos diálogos**

Usar Testing Library para verificar:

```tsx
await user.click(screen.getByRole('button', { name: 'Nova' }));
expect(screen.getByRole('dialog', { name: 'Nova conversa' })).toBeVisible();
await user.type(screen.getByLabelText('Telefone'), '(62) 99999-8888');
await user.type(screen.getByLabelText('Nome (opcional)'), 'Maria');
await user.type(screen.getByLabelText('Mensagem inicial'), 'Olá Maria');
await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
expect(startConversation).toHaveBeenCalledWith({ phone: '5562999998888', name: 'Maria', text: 'Olá Maria' });
```

Cobrir também: lápis abre nome atual e só fecha após sucesso; `Aberta` abre `Fechar conversa?`; status `closed` exibe `Fechada` e confirmação `Reabrir conversa?`; erro mantém diálogo/campos.

- [ ] **Step 2: Executar e confirmar RED**

Run: `npm test -- --run src/features/whatsapp-inbox/InboxActionDialogs.test.tsx src/features/whatsapp-inbox/ConnectedInbox.test.tsx`  
Expected: FAIL porque botões não abrem os fluxos.

- [ ] **Step 3: Implementar componentes de diálogo mínimos**

Usar `Dialog`, `Input`, `Button` e mensagens `role="alert"`. Regras:

```ts
const phone = rawPhone.replace(/\D/g, '');
const validPhone = phone.length >= 10 && phone.length <= 15;
const validName = name.trim().length >= 1 && name.trim().length <= 120;
const validMessage = text.trim().length >= 1 && text.trim().length <= 8000;
```

O modal Nova mostra somente telefone, nome opcional e mensagem inicial. O botão final diz `Enviar mensagem`.

- [ ] **Step 4: Ligar mutations reais no ConnectedInbox**

Adicionar `status` ao select/tipo de conversa. Criar mutations:

```ts
start: supabase.functions.invoke('lotti-whatsapp', { body: { action:'start', phone, name, text, request_id: crypto.randomUUID() } });
rename: db.rpc('lotti_inbox_rename_client', { p_conversation: selected.id, p_name: name });
setStatus: db.rpc('lotti_inbox_set_status', { p_conversation: selected.id, p_status: nextStatus });
```

Após sucesso, invalidar conversas, previews, mensagens e cliente; selecionar `conversationId` retornado por `start`. Exibir `Aberta` com ponto verde e `Fechada` com ponto cinza, ambos como botão compacto.

- [ ] **Step 5: Executar e confirmar GREEN**

Run: `npm test -- --run src/features/whatsapp-inbox/InboxActionDialogs.test.tsx src/features/whatsapp-inbox/ConnectedInbox.test.tsx`  
Expected: PASS para os três fluxos e falhas.

- [ ] **Step 6: Commit**

```bash
git add src/features/whatsapp-inbox/InboxActionDialogs.tsx src/features/whatsapp-inbox/InboxActionDialogs.test.tsx src/features/whatsapp-inbox/ConnectedInbox.tsx src/features/whatsapp-inbox/ConnectedInbox.test.tsx
git commit -m "feat(whatsapp): ativar ações do inbox conectado"
```

### Task 4: Verificação integrada, documentação e Pull Request

**Files:**
- Modify: `AI_HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-21-whatsapp-inbox-actions.md` para marcar passos concluídos.

**Interfaces:**
- Consumes: implementação completa das Tasks 1–3.
- Produces: branch publicada e PR contra `main`.

- [ ] **Step 1: Rodar suíte direcionada**

Run:

```powershell
$env:VITE_SUPABASE_URL='https://example.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='test-public-key'
npm test -- --run supabase/migrations/lotti-inbox-actions.test.ts supabase/functions/lotti-whatsapp/request.test.ts src/features/whatsapp-inbox/InboxActionDialogs.test.tsx src/features/whatsapp-inbox/ConnectedInbox.test.tsx
```

Expected: todos passam.

- [ ] **Step 2: Rodar validação completa**

Run: `npm test -- --run` com as mesmas variáveis fictícias.  
Run: `npm run build`.  
Run: `npx eslint` somente nos TS/TSX alterados.  
Run: `git diff --check`.  
Expected: todos com exit code 0.

- [ ] **Step 3: Inspecionar no navegador**

Abrir `/whatsapp` autenticado em 1600×900 e conferir: modal Nova compacto; lápis abre edição; status verde abre confirmação; fechar muda para neutro; reabrir restaura verde; layout 306/330 e ausência de `IA Lotti` permanecem.

- [ ] **Step 4: Atualizar o handoff com fatos verificáveis**

Registrar migrations/RPCs criados, testes executados, inspeção visual realizada e pendências externas: migration e Edge Function ainda não publicadas até o dono aprovar/aplicar o PR.

- [ ] **Step 5: Commit documental**

```bash
git add AI_HANDOFF.md docs/superpowers/plans/2026-09-21-whatsapp-inbox-actions.md
git commit -m "docs: registrar ações funcionais do Inbox"
```

- [ ] **Step 6: Publicar branch e abrir PR**

```bash
git push -u origin codex/whatsapp-inbox-actions
gh pr create --base main --head codex/whatsapp-inbox-actions --title "feat: ativar ações essenciais do Inbox" --body-file <arquivo-temporario-com-resumo-e-testes>
```

Após criar o PR, anexá-lo à tarefa com `attach_artifact` e entregar a URL ao usuário para encaminhar ao dono.
