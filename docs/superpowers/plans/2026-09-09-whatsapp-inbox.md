# WhatsApp Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma primeira versão navegável e responsiva do WhatsApp Inbox dentro da Lotti, com dados demonstrativos e estados locais preparados para integração futura.

**Architecture:** Uma página própria compõe lista, conversa e perfil a partir de tipos e fixtures isolados. A navegação e o carregamento seguem os padrões existentes; interações ficam locais e nenhuma API externa é chamada nesta etapa.

**Tech Stack:** React 18, TypeScript, React Router, Tailwind CSS, shadcn/ui, Lucide e Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-whatsapp-inbox-design.md`

## Global Constraints

- O menu atual continua sempre visível, sem grupos recolhíveis.
- A integração real com Evolution API, VPS e Supabase não faz parte desta entrega.
- A tela precisa funcionar em tema claro e escuro e oferecer navegação móvel entre lista, conversa e perfil.
- Nenhuma chave, QR Code ou credencial pode aparecer no frontend.

---

### Task 1: Contratos e dados demonstrativos

**Files:**
- Create: `src/features/whatsapp-inbox/types.ts`
- Create: `src/features/whatsapp-inbox/demoData.ts`
- Test: `src/features/whatsapp-inbox/demoData.test.ts`

**Interfaces:**
- Produces: `WhatsAppConversation`, `WhatsAppMessage`, `WhatsAppContactProfile`, `WhatsAppServiceMode`, `demoConversations`, `demoMessagesByConversation`, `demoProfilesByContact`.

- [x] **Step 1: Write the failing test**

```ts
expect(demoConversations.length).toBeGreaterThan(2);
expect(demoMessagesByConversation[demoConversations[0].id].length).toBeGreaterThan(0);
expect(demoProfilesByContact[demoConversations[0].contactId].name).toBeTruthy();
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/features/whatsapp-inbox/demoData.test.ts`
Expected: FAIL because the fixture modules do not exist.

- [x] **Step 3: Write minimal implementation**

Create typed fixtures covering unread, AI-active and human-service conversations.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/features/whatsapp-inbox/demoData.test.ts`
Expected: PASS.

### Task 2: Responsive Inbox behavior

**Files:**
- Create: `src/features/whatsapp-inbox/WhatsAppInbox.tsx`
- Create: `src/pages/WhatsAppInbox.tsx`
- Test: `src/features/whatsapp-inbox/WhatsAppInbox.test.tsx`

**Interfaces:**
- Consumes: fixtures and types from Task 1.
- Produces: `<WhatsAppInbox />` and the default route page.

- [x] **Step 1: Write the failing behavior tests**

```tsx
expect(html).toContain('Conversas');
expect(html).toContain('Perfil do contato');
expect(html).toContain('Conexão demonstrativa');
```

Add browser-like tests for search, selecting a conversation, local send, IA/human switch and mobile panel navigation.

- [x] **Step 2: Run tests and verify RED**

Run: `npm test -- --run src/features/whatsapp-inbox/WhatsAppInbox.test.tsx`
Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement the three-panel Inbox**

Build internally scrollable desktop columns, responsive mobile panels, search/filter controls, message bubbles, a fixed composer, profile data, tags, notes, timeline and explicit service mode controls.

- [x] **Step 4: Run tests and verify GREEN**

Run: `npm test -- --run src/features/whatsapp-inbox/WhatsAppInbox.test.tsx`
Expected: PASS.

### Task 3: Navigation and route integration

**Files:**
- Modify: `src/components/layout/AppSidebar.tsx`
- Modify: `src/components/layout/funil-sidebar-visual.test.tsx`
- Modify: `src/lib/routePreloaders.ts`
- Modify: `src/lib/routePreloaders.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: default page export from Task 2.
- Produces: sidebar link and protected `/whatsapp` route.

- [x] **Step 1: Extend failing navigation tests**

Assert that `WhatsApp` is visible before `Clientes` and that the `/whatsapp` preloader resolves through the route registry.

- [x] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run src/components/layout/funil-sidebar-visual.test.tsx src/lib/routePreloaders.test.ts`
Expected: FAIL because the navigation and loader are absent.

- [x] **Step 3: Register navigation, loader and route**

Add the `MessageCircle` item, `whatsappLoader`, route registry entry, lazy page and protected route.

- [x] **Step 4: Verify the complete delivery**

Run: `npm test -- --run src/features/whatsapp-inbox/demoData.test.ts src/features/whatsapp-inbox/WhatsAppInbox.test.tsx src/components/layout/funil-sidebar-visual.test.tsx src/lib/routePreloaders.test.ts`

Run: `npm run build`

Run: `git diff --check`

Expected: all commands pass.
