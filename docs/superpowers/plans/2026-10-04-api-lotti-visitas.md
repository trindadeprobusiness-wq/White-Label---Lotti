# API Lotti — Etapa 2: visita pedida no WhatsApp vira agendamento com alerta urgente

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o lead pede visita no WhatsApp com dia e horário, a visita entra na agenda do corretor, ou vai para o gestor se o horário estiver ocupado, e um alerta vermelho no sino pede a confirmação com um botão "Confirmar visita".

**Architecture:** O agente atual (`n8n-agent-lotti/runtime`) passa a extrair `visitRequest {date, time}` da conversa. Depois de entregar a resposta, ele chama a API Lotti (`POST /api/agente/visitas`, autenticado por segredo compartilhado). A API confere conflito com `routine_detect_conflicts` agindo como o corretor, via `TenantDb`.
- **Horário livre:** a API cria `routine_events` com `status='pending_confirmation'`, `priority='urgent'` e `source='ai'`. A sincronização do Google já existente (cron de 30 min) leva o evento para o Google Agenda do corretor.
- **Horário ocupado:** a API não cria evento. Ela alerta o corretor e os gestores da organização.
- **Confirmação:** o botão no sino chama `POST /api/visitas/:visitaId/confirmar` com o JWT de quem clicou. A visita é confirmada, ou criada, no caso de conflito decidido pelo gestor, e os alertas dela são marcados como lidos.

**Tech Stack:** API da Etapa 1 (NestJS 10, Prisma 6, `TenantDb`); runtime Node ESM com `node:test`; front React + Vitest.

## Global Constraints

- Depende da Etapa 1 (PR #51) no ar, com `DATABASE_URL` configurada. Todas as regras dela continuam: sem `prisma migrate`, consultas de usuário só via `TenantDb.run`, logs sem telefone, e-mail ou conteúdo.
- Nenhuma migration nova. Tudo usa o que já existe em produção (verificado em 2026-10-04):
  - `routine_events`: `status` aceita `draft|pending_confirmation|confirmed|completed|cancelled`; `priority` aceita `low|medium|high|urgent`; `source` aceita `lotti|google|automation|ai|other_user`; `sync_status` aceita `local|pending|synced|conflict|error`; `visibility` aceita `team|private`.
  - `alertas`: colunas `id, cliente_id, corretor_id, tipo, mensagem, metadata, lido, created_at, read_at, origem, entidade_tipo, entidade_id`. **Não existe coluna `prioridade`**: a prioridade vai em `metadata.prioridade`.
  - `tipo_alerta` aceita `FOLLOWUP,DOCUMENTO,EXCLUSIVIDADE,GERAL,LEAD_QUENTE,PAGAMENTO,TRANSFERENCIA`. Usar `GERAL`.
  - `routine_memberships.role` aceita `proprietario|administrador|gestor|corretor|financeiro|juridico|colaborador`.
  - `routine_detect_conflicts(p_assigned_to uuid, p_start_at timestamptz, p_end_at timestamptz, p_exclude_event_id uuid)` exige `auth.uid()`, por isso roda dentro de `TenantDb.run` como o corretor.
  - O usuário `postgres` tem `BYPASSRLS`: os alertas para outros usuários (gestores) são gravados fora do `TenantDb`, só no serviço chamado pelo agente.
- A sincronização com o Google empurra **todos** os `routine_events` do usuário, sem filtrar status. Por isso, no conflito, **nenhum evento é criado** antes da decisão do gestor.
- Horários sempre em Brasília (`-03:00`, sem horário de verão desde 2019). Visita dura 60 minutos.
- `metadata` dos alertas de visita tem sempre: `prioridade: 'ALTA'`, `tipo: 'visita_confirmar' | 'visita_conflito'`, `visita_id` (uuid, o mesmo em todos os alertas da mesma visita), `conversation_id`, `inicio`, `fim` (ISO), `imovel_id` (ou null), `routine_event_id` (ou null), `corretor_user_id`.
- O agente nunca confirma horário para o lead (regra que já existe no prompt). Esta etapa não envia mensagem ao lead.

---

## Estrutura de arquivos

**API (`api/`, repo casa-mente-contrato):**
```
api/src/config/env.ts                      + agentApiToken
api/src/config/env.spec.ts                 + 1 teste
api/src/auth/agent-token.guard.ts          segredo compartilhado com o agente
api/src/auth/agent-token.guard.spec.ts
api/src/visitas/visitas.repo.ts            SQL (únicas consultas desta etapa)
api/src/visitas/visitas.service.ts         regras: livre x conflito, alertas, confirmação
api/src/visitas/visitas.service.spec.ts
api/src/visitas/solicitar-visita.dto.ts
api/src/visitas/agente-visitas.controller.ts   POST /api/agente/visitas
api/src/visitas/visitas.controller.ts          POST /api/visitas/:visitaId/confirmar
api/src/visitas/visitas.controllers.spec.ts
api/src/visitas/visitas.module.ts
api/src/app.module.ts                      + VisitasModule
api/scripts/visitas-prova.sql              prova das consultas no banco real, com rollback
```

**Front (raiz, repo casa-mente-contrato):**
```
src/lib/notificacoes.ts            prioridadeDoAlerta() + ehVisitaPendente()
src/lib/notificacoes.test.ts       + testes
src/lib/api.ts                     chamada autenticada à API Lotti
src/components/shell/PainelNotificacoes.tsx   botão "Confirmar visita"
.env.example                       + VITE_API_URL
```

**Runtime (repo Lotti-ADM/n8n-agent-lotti, branch a partir de `claude/webhook-direto`):**
```
runtime/qualification.mjs     + visitRequest no schema Gemini e normalização
runtime/openai.mjs            + visitRequest no schema estrito
runtime/visits.mjs            chamada à API depois da entrega
runtime/visits.test.mjs
runtime/turn.mjs              afterDelivery chama requestVisit
runtime/qualification.test.mjs + testes
.env.example                  + AGENT_API_URL, AGENT_API_TOKEN
```

---

### Task 1: Segredo do agente na API

**Files:**
- Modify: `api/src/config/env.ts`, `api/src/config/env.spec.ts`
- Create: `api/src/auth/agent-token.guard.ts`
- Test: `api/src/auth/agent-token.guard.spec.ts`

**Interfaces:**
- Produces: `AppEnv.agentApiToken?: string` (vem de `AGENT_API_TOKEN`; vazio quando ausente ou com menos de 32 caracteres); `AgentTokenGuard` (`CanActivate`). Sem token configurado responde 503; header `x-lotti-agent` errado responde 401.

- [ ] **Step 1: Teste que falha do env**

Acrescente em `api/src/config/env.spec.ts`, dentro do `describe`:
```ts
  it('lê o segredo do agente só quando tem 32+ caracteres', () => {
    expect(loadEnv({ ...base, AGENT_API_TOKEN: 'curto' }).agentApiToken).toBeUndefined();
    expect(loadEnv({ ...base, AGENT_API_TOKEN: 'a'.repeat(32) }).agentApiToken).toBe('a'.repeat(32));
  });
```
E no primeiro teste (`lê as obrigatórias e aplica padrões`), acrescente `agentApiToken: undefined,` ao objeto esperado.

- [ ] **Step 2: Teste que falha do guard**

`api/src/auth/agent-token.guard.spec.ts`:
```ts
import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AppEnv } from '../config/env';
import { AgentTokenGuard } from './agent-token.guard';

const env = (agentApiToken?: string): AppEnv => ({
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x', supabaseUrl: 'https://abc.supabase.co', corsOrigins: [], agentApiToken,
});
const ctx = (header?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers: header ? { 'x-lotti-agent': header } : {} }) }) }) as unknown as ExecutionContext;
const token = 't'.repeat(40);

describe('AgentTokenGuard', () => {
  it('aceita o segredo certo', () => {
    expect(new AgentTokenGuard(env(token)).canActivate(ctx(token))).toBe(true);
  });
  it('recusa segredo errado ou ausente com 401', () => {
    expect(() => new AgentTokenGuard(env(token)).canActivate(ctx('x'.repeat(40)))).toThrow(UnauthorizedException);
    expect(() => new AgentTokenGuard(env(token)).canActivate(ctx())).toThrow(UnauthorizedException);
  });
  it('sem segredo configurado responde 503, nunca aceita', () => {
    expect(() => new AgentTokenGuard(env()).canActivate(ctx(token))).toThrow(ServiceUnavailableException);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd api && npx jest config auth/agent-token`
Expected: FAIL. O env não tem `agentApiToken` e o módulo `./agent-token.guard` não existe.

- [ ] **Step 4: Implementar**

Em `api/src/config/env.ts`:
- acrescente ao `interface AppEnv`:
  ```ts
  /** Segredo compartilhado com o agente do WhatsApp (header x-lotti-agent). */
  agentApiToken?: string;
  ```
- no objeto retornado por `loadEnv`, depois de `corsOrigins,`:
  ```ts
    agentApiToken: (source.AGENT_API_TOKEN?.trim().length ?? 0) >= 32 ? source.AGENT_API_TOKEN!.trim() : undefined,
  ```

`api/src/auth/agent-token.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppEnv, ENV } from '../config/env';

/** Rotas chamadas pelo agente do WhatsApp, não por um usuário logado. */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.env.agentApiToken;
    if (!expected) throw new ServiceUnavailableException('Integração do agente não configurada.');
    const header = ctx.switchToHttp().getRequest().headers?.['x-lotti-agent'];
    const actual = Buffer.from(typeof header === 'string' ? header : '');
    const wanted = Buffer.from(expected);
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw new UnauthorizedException();
    return true;
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd api && npx jest config auth`
Expected: PASS (5 do env + 4 do JWT + 3 do agente = 12).

- [ ] **Step 6: Commit**

```bash
git add api/src/config api/src/auth/agent-token.guard.ts api/src/auth/agent-token.guard.spec.ts
git commit -m "feat(api): segredo compartilhado com o agente do WhatsApp"
```

---

### Task 2: Consultas da visita (repo) com prova no banco real

**Files:**
- Create: `api/src/visitas/visitas.repo.ts`, `api/scripts/visitas-prova.sql`

**Interfaces:**
- Consumes: `PrismaService`, `TenantDb`, `SupabaseClaims` (Etapa 1).
- Produces a classe `VisitasRepo` com:
  - `conversa(conversationId: string): Promise<{ corretorId: string; clienteId: string | null; nome: string | null } | null>`
  - `corretor(corretorId: string): Promise<{ userId: string; nome: string } | null>`
  - `organizacao(userId: string): Promise<string | null>`
  - `gestores(organizationId: string, excetoUserId: string): Promise<string[]>` (ids de `corretores` dos gestores)
  - `existente(userId: string, inicio: Date, clienteId: string | null): Promise<string | null>` (id de `routine_events`)
  - `conflitos(claims: SupabaseClaims, userId: string, inicio: Date, fim: Date): Promise<number>`
  - `criarEvento(claims: SupabaseClaims, e: NovoEvento): Promise<string>`
  - `confirmarEvento(claims: SupabaseClaims, eventId: string): Promise<boolean>`
  - `alertasDaVisita(claims: SupabaseClaims, visitaId: string): Promise<Array<{ id: string; metadata: Record<string, unknown> }>>`
  - `criarAlertas(alertas: NovoAlerta[]): Promise<void>`
  - `marcarLidos(visitaId: string): Promise<void>`
  - os tipos exportados `NovoEvento` e `NovoAlerta`.

- [ ] **Step 1: Implementar o repo**

`api/src/visitas/visitas.repo.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';

export interface NovoEvento {
  organizationId: string;
  assignedTo: string;
  createdBy: string;
  titulo: string;
  inicio: Date;
  fim: Date;
  clienteId: string | null;
  imovelId: string | null;
  status: 'pending_confirmation' | 'confirmed';
}

export interface NovoAlerta {
  corretorId: string;
  clienteId: string | null;
  mensagem: string;
  entidadeId: string | null;
  metadata: Record<string, unknown>;
}

const GESTORES = ['proprietario', 'administrador', 'gestor'];

/** Todo o SQL da visita. As consultas de usuário passam pelo TenantDb (RLS). */
@Injectable()
export class VisitasRepo {
  constructor(private readonly prisma: PrismaService, private readonly db: TenantDb) {}

  async conversa(conversationId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ corretor_id: string; cliente_id: string | null; contact_name: string | null }>>`
      select corretor_id, cliente_id, contact_name from public.lotti_agent_conversations where id = ${conversationId}::uuid`;
    return rows[0] ? { corretorId: rows[0].corretor_id, clienteId: rows[0].cliente_id, nome: rows[0].contact_name } : null;
  }

  async corretor(corretorId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string; nome: string }>>`
      select user_id, nome from public.corretores where id = ${corretorId}::uuid`;
    return rows[0] ? { userId: rows[0].user_id, nome: rows[0].nome } : null;
  }

  async organizacao(userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ organization_id: string }>>`
      select organization_id from public.routine_memberships
      where user_id = ${userId}::uuid and status = 'active' order by created_at limit 1`;
    return rows[0]?.organization_id ?? null;
  }

  async gestores(organizationId: string, excetoUserId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      select co.id from public.routine_memberships m join public.corretores co on co.user_id = m.user_id
      where m.organization_id = ${organizationId}::uuid and m.status = 'active'
        and m.role = any(${GESTORES}::text[]) and m.user_id <> ${excetoUserId}::uuid`;
    return rows.map((r) => r.id);
  }

  async existente(userId: string, inicio: Date, clienteId: string | null) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      select id from public.routine_events
      where assigned_to = ${userId}::uuid and start_at = ${inicio} and source = 'ai'
        and client_id is not distinct from ${clienteId}::uuid and deleted_at is null and status <> 'cancelled'
      limit 1`;
    return rows[0]?.id ?? null;
  }

  conflitos(claims: SupabaseClaims, userId: string, inicio: Date, fim: Date) {
    return this.db.run(claims, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ event_id: string }>>`
        select event_id from public.routine_detect_conflicts(${userId}::uuid, ${inicio}, ${fim}, null)`;
      return rows.length;
    });
  }

  criarEvento(claims: SupabaseClaims, e: NovoEvento) {
    return this.db.run(claims, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        insert into public.routine_events
          (organization_id, assigned_to, created_by, title, activity_type, status, priority, start_at, end_at,
           timezone, visibility, source, client_id, property_id, sync_status)
        values (${e.organizationId}::uuid, ${e.assignedTo}::uuid, ${e.createdBy}::uuid, ${e.titulo}, 'visita', ${e.status}, 'urgent',
           ${e.inicio}, ${e.fim}, 'America/Sao_Paulo', 'team', 'ai', ${e.clienteId}::uuid, ${e.imovelId}::uuid, 'pending')
        returning id`;
      return rows[0].id;
    });
  }

  confirmarEvento(claims: SupabaseClaims, eventId: string) {
    return this.db.run(claims, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        update public.routine_events set status = 'confirmed', sync_status = 'pending'
        where id = ${eventId}::uuid and source = 'ai' and status = 'pending_confirmation' and deleted_at is null
        returning id`;
      return rows.length === 1;
    });
  }

  alertasDaVisita(claims: SupabaseClaims, visitaId: string) {
    return this.db.run(claims, (tx) =>
      tx.$queryRaw<Array<{ id: string; metadata: Record<string, unknown> }>>`
        select id, metadata from public.alertas where metadata->>'visita_id' = ${visitaId} order by created_at`,
    );
  }

  async criarAlertas(alertas: NovoAlerta[]) {
    for (const a of alertas) {
      await this.prisma.$executeRaw`
        insert into public.alertas (corretor_id, cliente_id, tipo, mensagem, metadata, lido, origem, entidade_tipo, entidade_id)
        values (${a.corretorId}::uuid, ${a.clienteId}::uuid, 'GERAL', ${a.mensagem}, ${JSON.stringify(a.metadata)}::jsonb,
                false, 'ia', 'visita', ${a.entidadeId}::uuid)`;
    }
  }

  async marcarLidos(visitaId: string) {
    await this.prisma.$executeRaw`
      update public.alertas set lido = true, read_at = now() where metadata->>'visita_id' = ${visitaId} and lido is not true`;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Prova das consultas no banco real, sem gravar nada**

`api/scripts/visitas-prova.sql` exercita as consultas com o primeiro corretor que tem membership ativa e desfaz tudo:
```sql
-- Prova das consultas da visita. Tudo dentro de transação desfeita no fim.
begin;
create temp table prova as
  select co.id as corretor_id, co.user_id, m.organization_id
  from public.corretores co join public.routine_memberships m on m.user_id = co.user_id and m.status = 'active'
  limit 1;
select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true) from prova;
set local role authenticated;
select count(*)::text as conflitos_amanha_10h
  from prova, public.routine_detect_conflicts(prova.user_id, (current_date + 1 + time '10:00') at time zone 'America/Sao_Paulo',
       (current_date + 1 + time '11:00') at time zone 'America/Sao_Paulo', null);
insert into public.routine_events (organization_id, assigned_to, created_by, title, activity_type, status, priority, start_at, end_at,
  timezone, visibility, source, client_id, property_id, sync_status)
select organization_id, user_id, user_id, 'Visita: prova', 'visita', 'pending_confirmation', 'urgent',
  now() + interval '1 day', now() + interval '1 day 1 hour', 'America/Sao_Paulo', 'team', 'ai', null, null, 'pending' from prova;
select count(*)::text as eventos_prova from public.routine_events where title = 'Visita: prova';
reset role;
insert into public.alertas (corretor_id, cliente_id, tipo, mensagem, metadata, lido, origem, entidade_tipo, entidade_id)
select corretor_id, null, 'GERAL', 'prova', '{"visita_id":"prova","prioridade":"ALTA"}'::jsonb, false, 'ia', 'visita', null from prova;
select count(*)::text as alertas_prova from public.alertas where metadata->>'visita_id' = 'prova';
rollback;
```

Run (raiz do repo): `C:/Users/rafae/bin/supabase db query --linked -f api/scripts/visitas-prova.sql`
Expected: `conflitos_amanha_10h` é um número (sem erro de permissão), `eventos_prova = 1` e `alertas_prova = 1`. Depois, rode `select count(*) from public.routine_events where title = 'Visita: prova'` e confira que é **0**, prova de que o rollback desfez tudo. Se a inserção do evento falhar por policy, **pare e reporte o erro exato**: significa que o corretor não pode criar item na própria agenda, e o desenho precisa mudar.

- [ ] **Step 4: Commit**

```bash
git add api/src/visitas/visitas.repo.ts api/scripts/visitas-prova.sql
git commit -m "feat(api): consultas da visita, com prova no banco real"
```

---

### Task 3: Regra da visita (livre x conflito)

**Files:**
- Create: `api/src/visitas/visitas.service.ts`
- Test: `api/src/visitas/visitas.service.spec.ts`

**Interfaces:**
- Consumes: `VisitasRepo` (Task 2).
- Produces:
  - `interface PedidoVisita { conversationId: string; corretorId: string; data: string; hora: string; imovelId?: string | null }` (data `YYYY-MM-DD`, hora `HH:MM`, em Brasília);
  - `VisitasService.solicitar(p: PedidoVisita, agora?: Date): Promise<{ visitaId: string; situacao: 'agendada' | 'conflito' | 'existente'; routineEventId: string | null }>`;
  - `VisitasService.confirmar(claims: SupabaseClaims, visitaId: string): Promise<{ routineEventId: string }>`;
  - erros `NotFoundException` (conversa, corretor ou visita inexistente), `ForbiddenException` (conversa de outro corretor) e `UnprocessableEntityException('visita_no_passado' | 'visita_sem_organizacao')`.
  - O módulo também exporta a função pura `inicioEmBrasilia(data: string, hora: string): Date`.

- [ ] **Step 1: Escrever o teste que falha**

`api/src/visitas/visitas.service.spec.ts`:
```ts
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { inicioEmBrasilia, VisitasService } from './visitas.service';

const AGORA = new Date('2026-10-05T12:00:00-03:00');
const pedido = { conversationId: 'conv1', corretorId: 'cor1', data: '2026-10-07', hora: '15:30', imovelId: 'imo1' };

function repo(over: Record<string, unknown> = {}) {
  return {
    conversa: jest.fn(async () => ({ corretorId: 'cor1', clienteId: 'cli1', nome: 'Maria Souza' })),
    corretor: jest.fn(async () => ({ userId: 'user1', nome: 'João Corretor' })),
    organizacao: jest.fn(async () => 'org1'),
    gestores: jest.fn(async () => ['gest1']),
    existente: jest.fn(async () => null),
    conflitos: jest.fn(async () => 0),
    criarEvento: jest.fn(async () => 'evt1'),
    confirmarEvento: jest.fn(async () => true),
    alertasDaVisita: jest.fn(async () => []),
    criarAlertas: jest.fn(async () => undefined),
    marcarLidos: jest.fn(async () => undefined),
    ...over,
  };
}

describe('inicioEmBrasilia', () => {
  it('interpreta data e hora no fuso de Brasília', () => {
    expect(inicioEmBrasilia('2026-10-07', '15:30').toISOString()).toBe('2026-10-07T18:30:00.000Z');
  });
});

describe('VisitasService.solicitar', () => {
  it('horário livre: cria evento pendente na agenda do corretor e alerta só o corretor', async () => {
    const r = repo();
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toMatchObject({ situacao: 'agendada', routineEventId: 'evt1' });
    expect(r.conflitos).toHaveBeenCalledWith({ sub: 'user1', role: 'authenticated' }, 'user1',
      new Date('2026-10-07T18:30:00.000Z'), new Date('2026-10-07T19:30:00.000Z'));
    expect(r.criarEvento).toHaveBeenCalledWith({ sub: 'user1', role: 'authenticated' }, {
      organizationId: 'org1', assignedTo: 'user1', createdBy: 'user1', titulo: 'Visita: Maria Souza',
      inicio: new Date('2026-10-07T18:30:00.000Z'), fim: new Date('2026-10-07T19:30:00.000Z'),
      clienteId: 'cli1', imovelId: 'imo1', status: 'pending_confirmation',
    });
    const alertas = r.criarAlertas.mock.calls[0][0];
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({
      corretorId: 'cor1', clienteId: 'cli1', entidadeId: 'evt1',
      mensagem: 'Maria Souza pediu visita em 07/10 às 15:30. Confirme o agendamento.',
      metadata: { prioridade: 'ALTA', tipo: 'visita_confirmar', visita_id: out.visitaId, conversation_id: 'conv1',
        inicio: '2026-10-07T18:30:00.000Z', fim: '2026-10-07T19:30:00.000Z', imovel_id: 'imo1',
        routine_event_id: 'evt1', corretor_user_id: 'user1' },
    });
  });

  it('horário ocupado: não cria evento e alerta corretor e gestores', async () => {
    const r = repo({ conflitos: jest.fn(async () => 2) });
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toMatchObject({ situacao: 'conflito', routineEventId: null });
    expect(r.criarEvento).not.toHaveBeenCalled();
    const alertas = r.criarAlertas.mock.calls[0][0];
    expect(alertas.map((a: { corretorId: string }) => a.corretorId)).toEqual(['cor1', 'gest1']);
    expect(alertas[0].mensagem).toBe('Maria Souza pediu visita em 07/10 às 15:30, mas a agenda de João Corretor está ocupada. Um gestor precisa confirmar ou remarcar.');
    expect(alertas.every((a: { metadata: { tipo: string; visita_id: string } }) => a.metadata.tipo === 'visita_conflito' && a.metadata.visita_id === out.visitaId)).toBe(true);
  });

  it('mesma visita pedida de novo não duplica', async () => {
    const r = repo({ existente: jest.fn(async () => 'evt9') });
    const out = await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(out).toEqual({ visitaId: expect.any(String), situacao: 'existente', routineEventId: 'evt9' });
    expect(r.criarEvento).not.toHaveBeenCalled();
    expect(r.criarAlertas).not.toHaveBeenCalled();
  });

  it('recusa visita no passado, conversa de outro corretor e conversa inexistente', async () => {
    await expect(new VisitasService(repo() as never).solicitar({ ...pedido, data: '2026-10-05', hora: '09:00' }, AGORA))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(new VisitasService(repo({ conversa: jest.fn(async () => ({ corretorId: 'outro', clienteId: null, nome: null })) }) as never).solicitar(pedido, AGORA))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(new VisitasService(repo({ conversa: jest.fn(async () => null) }) as never).solicitar(pedido, AGORA))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem nome do contato usa "Contato do WhatsApp"', async () => {
    const r = repo({ conversa: jest.fn(async () => ({ corretorId: 'cor1', clienteId: null, nome: null })) });
    await new VisitasService(r as never).solicitar(pedido, AGORA);
    expect(r.criarEvento.mock.calls[0][1].titulo).toBe('Visita: Contato do WhatsApp');
  });
});

describe('VisitasService.confirmar', () => {
  const claims = { sub: 'quem-clicou', role: 'authenticated' };
  const meta = (extra: Record<string, unknown>) => ({ visita_id: 'v1', inicio: '2026-10-07T18:30:00.000Z', fim: '2026-10-07T19:30:00.000Z',
    corretor_user_id: 'user1', imovel_id: 'imo1', conversation_id: 'conv1', ...extra });

  it('visita com evento pendente: confirma o evento e marca os alertas', async () => {
    const r = repo({ alertasDaVisita: jest.fn(async () => [{ id: 'a1', metadata: meta({ routine_event_id: 'evt1' }) }]) });
    expect(await new VisitasService(r as never).confirmar(claims, 'v1')).toEqual({ routineEventId: 'evt1' });
    expect(r.confirmarEvento).toHaveBeenCalledWith(claims, 'evt1');
    expect(r.marcarLidos).toHaveBeenCalledWith('v1');
  });

  it('conflito decidido pelo gestor: cria o evento já confirmado na agenda do corretor', async () => {
    const r = repo({
      alertasDaVisita: jest.fn(async () => [{ id: 'a1', metadata: meta({ routine_event_id: null }) }]),
      conversa: jest.fn(async () => ({ corretorId: 'cor1', clienteId: 'cli1', nome: 'Maria Souza' })),
      criarEvento: jest.fn(async () => 'evt2'),
    });
    expect(await new VisitasService(r as never).confirmar(claims, 'v1')).toEqual({ routineEventId: 'evt2' });
    expect(r.criarEvento).toHaveBeenCalledWith(claims, expect.objectContaining({
      organizationId: 'org1', assignedTo: 'user1', createdBy: 'quem-clicou', status: 'confirmed', titulo: 'Visita: Maria Souza',
    }));
    expect(r.marcarLidos).toHaveBeenCalledWith('v1');
  });

  it('visita que o usuário não enxerga responde 404', async () => {
    await expect(new VisitasService(repo() as never).confirmar(claims, 'v1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('evento já confirmado por outra pessoa responde 404 e não marca nada', async () => {
    const r = repo({
      alertasDaVisita: jest.fn(async () => [{ id: 'a1', metadata: meta({ routine_event_id: 'evt1' }) }]),
      confirmarEvento: jest.fn(async () => false),
    });
    await expect(new VisitasService(r as never).confirmar(claims, 'v1')).rejects.toBeInstanceOf(NotFoundException);
    expect(r.marcarLidos).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx jest visitas/visitas.service`
Expected: FAIL com "Cannot find module './visitas.service'".

- [ ] **Step 3: Implementar**

`api/src/visitas/visitas.service.ts`:
```ts
import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseClaims } from '../prisma/tenant-db';
import { VisitasRepo } from './visitas.repo';

export interface PedidoVisita {
  conversationId: string;
  corretorId: string;
  data: string;
  hora: string;
  imovelId?: string | null;
}

const DURACAO_MS = 60 * 60 * 1000;
const SEM_NOME = 'Contato do WhatsApp';

/** Brasília não tem horário de verão desde 2019: o fuso é sempre -03:00. */
export function inicioEmBrasilia(data: string, hora: string): Date {
  return new Date(`${data}T${hora}:00-03:00`);
}

const quando = (inicio: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(inicio).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
};

const comoCorretor = (userId: string): SupabaseClaims => ({ sub: userId, role: 'authenticated' });

@Injectable()
export class VisitasService {
  constructor(private readonly repo: VisitasRepo) {}

  async solicitar(p: PedidoVisita, agora = new Date()) {
    const inicio = inicioEmBrasilia(p.data, p.hora);
    if (!(inicio.getTime() > agora.getTime())) throw new UnprocessableEntityException('visita_no_passado');
    const fim = new Date(inicio.getTime() + DURACAO_MS);

    const conversa = await this.repo.conversa(p.conversationId);
    if (!conversa) throw new NotFoundException('conversa_inexistente');
    if (conversa.corretorId !== p.corretorId) throw new ForbiddenException();
    const corretor = await this.repo.corretor(p.corretorId);
    if (!corretor) throw new NotFoundException('corretor_inexistente');
    const visitaId = randomUUID();

    const repetida = await this.repo.existente(corretor.userId, inicio, conversa.clienteId);
    if (repetida) return { visitaId, situacao: 'existente' as const, routineEventId: repetida };

    const organizationId = await this.repo.organizacao(corretor.userId);
    if (!organizationId) throw new UnprocessableEntityException('visita_sem_organizacao');
    const nome = conversa.nome?.trim() || SEM_NOME;
    const ocupado = (await this.repo.conflitos(comoCorretor(corretor.userId), corretor.userId, inicio, fim)) > 0;
    const routineEventId = ocupado ? null : await this.repo.criarEvento(comoCorretor(corretor.userId), {
      organizationId, assignedTo: corretor.userId, createdBy: corretor.userId, titulo: `Visita: ${nome}`,
      inicio, fim, clienteId: conversa.clienteId, imovelId: p.imovelId ?? null, status: 'pending_confirmation',
    });

    const metadata = {
      prioridade: 'ALTA', tipo: ocupado ? 'visita_conflito' : 'visita_confirmar', visita_id: visitaId,
      conversation_id: p.conversationId, inicio: inicio.toISOString(), fim: fim.toISOString(),
      imovel_id: p.imovelId ?? null, routine_event_id: routineEventId, corretor_user_id: corretor.userId,
    };
    const mensagem = ocupado
      ? `${nome} pediu visita em ${quando(inicio)}, mas a agenda de ${corretor.nome} está ocupada. Um gestor precisa confirmar ou remarcar.`
      : `${nome} pediu visita em ${quando(inicio)}. Confirme o agendamento.`;
    const destinos = ocupado ? [p.corretorId, ...(await this.repo.gestores(organizationId, corretor.userId))] : [p.corretorId];
    await this.repo.criarAlertas(destinos.map((corretorId) => ({
      corretorId, clienteId: conversa.clienteId, mensagem, entidadeId: routineEventId, metadata,
    })));
    return { visitaId, situacao: ocupado ? ('conflito' as const) : ('agendada' as const), routineEventId };
  }

  async confirmar(claims: SupabaseClaims, visitaId: string) {
    const alertas = await this.repo.alertasDaVisita(claims, visitaId);
    if (alertas.length === 0) throw new NotFoundException('visita_inexistente');
    const m = alertas[0].metadata as Record<string, string | null>;
    let routineEventId: string;
    if (m.routine_event_id) {
      if (!(await this.repo.confirmarEvento(claims, m.routine_event_id))) throw new NotFoundException('visita_ja_resolvida');
      routineEventId = m.routine_event_id;
    } else {
      const assignedTo = String(m.corretor_user_id);
      const organizationId = await this.repo.organizacao(assignedTo);
      if (!organizationId) throw new UnprocessableEntityException('visita_sem_organizacao');
      const conversa = m.conversation_id ? await this.repo.conversa(m.conversation_id) : null;
      routineEventId = await this.repo.criarEvento(claims, {
        organizationId, assignedTo, createdBy: claims.sub, titulo: `Visita: ${conversa?.nome?.trim() || SEM_NOME}`,
        inicio: new Date(String(m.inicio)), fim: new Date(String(m.fim)), clienteId: conversa?.clienteId ?? null,
        imovelId: m.imovel_id ?? null, status: 'confirmed',
      });
    }
    await this.repo.marcarLidos(visitaId);
    return { routineEventId };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx jest visitas/visitas.service`
Expected: PASS, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add api/src/visitas/visitas.service.ts api/src/visitas/visitas.service.spec.ts
git commit -m "feat(api): visita livre vira agendamento pendente; ocupada vai para o gestor"
```

---

### Task 4: Rotas da visita

**Files:**
- Create: `api/src/visitas/solicitar-visita.dto.ts`, `api/src/visitas/agente-visitas.controller.ts`, `api/src/visitas/visitas.controller.ts`, `api/src/visitas/visitas.module.ts`
- Modify: `api/src/app.module.ts`
- Test: `api/src/visitas/visitas.controllers.spec.ts`

**Interfaces:**
- Consumes: `VisitasService` (Task 3), `AgentTokenGuard` (Task 1), `SupabaseAuthGuard` e `@Claims()` (Etapa 1).
- Produces:
  - `POST /api/agente/visitas` com corpo `{ conversationId: uuid, corretorId: uuid, data: 'YYYY-MM-DD', hora: 'HH:MM', imovelId?: uuid | null }`. Responde 201 com `{ visitaId, situacao, routineEventId }`.
  - `POST /api/visitas/:visitaId/confirmar`, com `:visitaId` sendo uuid. Responde 201 com `{ routineEventId }`.

- [ ] **Step 1: Escrever o teste que falha**

`api/src/visitas/visitas.controllers.spec.ts`:
```ts
import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AgenteVisitasController } from './agente-visitas.controller';
import { VisitasController } from './visitas.controller';
import { VisitasService } from './visitas.service';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('rotas da visita', () => {
  let app: INestApplication;
  const service = {
    solicitar: jest.fn(async () => ({ visitaId: 'v1', situacao: 'agendada', routineEventId: 'evt1' })),
    confirmar: jest.fn(async () => ({ routineEventId: 'evt1' })),
  };
  const libera: CanActivate = {
    canActivate: (ctx) => { ctx.switchToHttp().getRequest().claims = { sub: 'u1', role: 'authenticated' }; return true; },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgenteVisitasController, VisitasController],
      providers: [{ provide: VisitasService, useValue: service }],
    }).overrideGuard(AgentTokenGuard).useValue(libera).overrideGuard(SupabaseAuthGuard).useValue(libera).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('agente pede visita com corpo válido', async () => {
    const body = { conversationId: UUID, corretorId: UUID, data: '2026-10-07', hora: '15:30', imovelId: null };
    const res = await request(app.getHttpServer()).post('/api/agente/visitas').send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ visitaId: 'v1', situacao: 'agendada', routineEventId: 'evt1' });
    expect(service.solicitar).toHaveBeenCalledWith(body);
  });

  it('recusa data ou hora em formato errado', async () => {
    for (const bad of [{ data: '07/10/2026', hora: '15:30' }, { data: '2026-10-07', hora: '25:00' }, { data: '2026-10-07', hora: '9h' }]) {
      const res = await request(app.getHttpServer()).post('/api/agente/visitas').send({ conversationId: UUID, corretorId: UUID, ...bad });
      expect(res.status).toBe(400);
    }
    expect(service.solicitar).not.toHaveBeenCalled();
  });

  it('confirmar repassa as claims de quem clicou', async () => {
    const res = await request(app.getHttpServer()).post(`/api/visitas/${UUID}/confirmar`);
    expect(res.status).toBe(201);
    expect(service.confirmar).toHaveBeenCalledWith({ sub: 'u1', role: 'authenticated' }, UUID);
  });

  it('confirmar recusa id que não é uuid', async () => {
    const res = await request(app.getHttpServer()).post('/api/visitas/abc/confirmar');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx jest visitas/visitas.controllers`
Expected: FAIL com "Cannot find module './agente-visitas.controller'".

- [ ] **Step 3: Implementar**

`api/src/visitas/solicitar-visita.dto.ts`:
```ts
import { IsOptional, IsUUID, Matches, ValidateIf } from 'class-validator';

export class SolicitarVisitaDto {
  @IsUUID() conversationId!: string;
  @IsUUID() corretorId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/) data!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) hora!: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() imovelId?: string | null;
}
```

`api/src/visitas/agente-visitas.controller.ts`:
```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { SolicitarVisitaDto } from './solicitar-visita.dto';
import { VisitasService } from './visitas.service';

/** Chamado pelo agente do WhatsApp quando o lead pede visita com dia e horário. */
@Controller('agente/visitas')
@UseGuards(AgentTokenGuard)
export class AgenteVisitasController {
  constructor(private readonly visitas: VisitasService) {}

  @Post()
  solicitar(@Body() body: SolicitarVisitaDto) {
    return this.visitas.solicitar(body);
  }
}
```

`api/src/visitas/visitas.controller.ts`:
```ts
import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { VisitasService } from './visitas.service';

@Controller('visitas')
@UseGuards(SupabaseAuthGuard)
export class VisitasController {
  constructor(private readonly visitas: VisitasService) {}

  @Post(':visitaId/confirmar')
  confirmar(@Claims() claims: SupabaseClaims, @Param('visitaId', ParseUUIDPipe) visitaId: string) {
    return this.visitas.confirmar(claims, visitaId);
  }
}
```

`api/src/visitas/visitas.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AgentTokenGuard } from '../auth/agent-token.guard';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { AgenteVisitasController } from './agente-visitas.controller';
import { VisitasController } from './visitas.controller';
import { VisitasRepo } from './visitas.repo';
import { VisitasService } from './visitas.service';

@Module({
  controllers: [AgenteVisitasController, VisitasController],
  providers: [VisitasRepo, VisitasService, AgentTokenGuard, SupabaseAuthGuard],
})
export class VisitasModule {}
```

Em `api/src/app.module.ts`, importe `VisitasModule` (`import { VisitasModule } from './visitas/visitas.module';`) e acrescente ao array `imports`, depois de `ImoveisModule`.

- [ ] **Step 4: Rodar a suíte inteira e o build**

Run: `cd api && npm test && npm run build`
Expected: Etapa 1 (26) + env (1) + agente (3) + service (10) + rotas (4) = **44 testes passando**, build ok.

Se o teste "agente pede visita" falhar porque `imovelId: null` some do objeto repassado, troque a asserção para `expect.objectContaining({ conversationId: UUID, data: '2026-10-07', hora: '15:30' })`. Não mexa no DTO.

- [ ] **Step 5: Commit**

```bash
git add api/src/visitas api/src/app.module.ts
git commit -m "feat(api): rotas para o agente pedir visita e para confirmar no sino"
```

---

### Task 5: Sino — alerta vermelho e botão "Confirmar visita"

**Files:**
- Modify: `src/lib/notificacoes.ts`, `src/lib/notificacoes.test.ts`, `src/components/shell/PainelNotificacoes.tsx`, `.env.example`
- Create: `src/lib/api.ts`

**Interfaces:**
- Produces:
  - `prioridadeDoAlerta(a: Pick<AlertaNotificacao, 'prioridade' | 'metadata'>): string | null` (coluna, senão `metadata.prioridade`);
  - `visitaPendente(a: AlertaNotificacao): string | null` (devolve o `visita_id` de um alerta de visita não lido);
  - `confirmarVisita(visitaId: string): Promise<void>` em `src/lib/api.ts` (lança `Error` com mensagem em português).

- [ ] **Step 1: Testes que falham**

Acrescente ao fim de `src/lib/notificacoes.test.ts` (e inclua `prioridadeDoAlerta` e `visitaPendente` no import de `./notificacoes` no topo do arquivo):
```ts
describe('alertas de visita', () => {
  const base = { id: 'a1', tipo: 'GERAL', prioridade: null, mensagem: 'x', lido: false, created_at: '2026-10-05T12:00:00Z' };

  it('prioridade vem de metadata quando a coluna não existe', () => {
    expect(prioridadeDoAlerta({ prioridade: null, metadata: { prioridade: 'ALTA' } })).toBe('ALTA');
    expect(prioridadeDoAlerta({ prioridade: 'MEDIA', metadata: { prioridade: 'ALTA' } })).toBe('MEDIA');
    expect(prioridadeDoAlerta({ prioridade: null, metadata: null })).toBeNull();
  });

  it('identifica visita pendente só quando não lida', () => {
    const visita = { ...base, metadata: { tipo: 'visita_conflito', visita_id: 'v1' } };
    expect(visitaPendente(visita)).toBe('v1');
    expect(visitaPendente({ ...visita, lido: true })).toBeNull();
    expect(visitaPendente({ ...base, metadata: { tipo: 'outro', visita_id: 'v1' } })).toBeNull();
  });

  it('alerta de visita fica vermelho', () => {
    expect(tomDoAlerta({ tipo: 'GERAL', prioridade: prioridadeDoAlerta({ prioridade: null, metadata: { prioridade: 'ALTA' } }) })).toBe('destructive');
  });
});
```

Run: `npx vitest run src/lib/notificacoes.test.ts`
Expected: FAIL com "prioridadeDoAlerta is not a function" (ou export ausente).

- [ ] **Step 2: Implementar as funções**

Acrescente em `src/lib/notificacoes.ts`, logo depois da interface `AlertaNotificacao`:
```ts
/** A tabela alertas não tem coluna prioridade em produção: quem grava põe em metadata. */
export function prioridadeDoAlerta(
  alerta: Pick<AlertaNotificacao, 'prioridade' | 'metadata'>,
): string | null {
  if (alerta.prioridade) return alerta.prioridade;
  const p = alerta.metadata?.prioridade;
  return typeof p === 'string' ? p : null;
}

/** visita_id de um pedido de visita ainda não confirmado, para o botão do sino. */
export function visitaPendente(alerta: AlertaNotificacao): string | null {
  if (alerta.lido) return null;
  const m = alerta.metadata;
  const tipo = m?.tipo;
  const id = m?.visita_id;
  return (tipo === 'visita_confirmar' || tipo === 'visita_conflito') && typeof id === 'string' ? id : null;
}
```

Run: `npx vitest run src/lib/notificacoes.test.ts`
Expected: PASS.

- [ ] **Step 3: Chamada à API**

`src/lib/api.ts`:
```ts
import { supabase } from '@/integrations/supabase/client';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

export const apiDisponivel = () => !!API_URL;

/** Confirma uma visita pedida pelo agente. Lança Error com texto para o usuário. */
export async function confirmarVisita(visitaId: string): Promise<void> {
  if (!API_URL) throw new Error('Confirmação de visita indisponível no momento.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre de novo.');
  const res = await fetch(`${API_URL}/api/visitas/${encodeURIComponent(visitaId)}/confirmar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) throw new Error('Esta visita já foi resolvida por outra pessoa.');
  if (!res.ok) throw new Error('Não foi possível confirmar a visita. Tente de novo.');
}
```

Acrescente ao `.env.example`:
```
# API Lotti (Railway). Ex.: https://api-production-7ff5.up.railway.app
VITE_API_URL=
```

- [ ] **Step 4: Ligar no painel**

Em `src/components/shell/PainelNotificacoes.tsx`:
1. Acrescente `prioridadeDoAlerta,` e `visitaPendente,` ao import de `@/lib/notificacoes`, e `import { apiDisponivel, confirmarVisita } from '@/lib/api';`.
2. Ache **todas** as chamadas `tomDoAlerta(` e os usos `.prioridade === 'ALTA'` no arquivo. Em cada uma, passe o alerta com a prioridade resolvida. Por exemplo, `tomDoAlerta(alerta)` vira `tomDoAlerta({ ...alerta, prioridade: prioridadeDoAlerta(alerta) })`. Faça o mesmo onde o arquivo passa a lista para `contarNaoLidas`/`ordenarNotificacoes`, mapeando antes: `const alertasComPrioridade = useMemo(() => alertas.map((a) => ({ ...a, prioridade: prioridadeDoAlerta(a) })), [alertas]);`, e use `alertasComPrioridade` no lugar de `alertas` dali em diante.
3. No JSX que renderiza cada linha de alerta, logo abaixo do texto da mensagem, acrescente:
```tsx
{apiDisponivel() && visitaPendente(alerta) && (
  <Button
    size="sm"
    variant="destructive"
    className="mt-2 h-8"
    onClick={async (e) => {
      e.stopPropagation();
      try {
        await confirmarVisita(visitaPendente(alerta)!);
        toast.success('Visita confirmada.');
        void useCRMStore.getState().fetchAlertas();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível confirmar a visita.');
      }
    }}
  >
    Confirmar visita
  </Button>
)}
```
(A variável da linha pode ter outro nome no arquivo, como `a` ou `item`. Use o nome que o `map` já usa.)

- [ ] **Step 5: Rodar os testes do front e o build**

Run: `npx vitest run src/lib/notificacoes.test.ts src/components/shell && npm run build`
Expected: os testes de notificações passam, nenhum teste de `src/components/shell` quebra e o build termina.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notificacoes.ts src/lib/notificacoes.test.ts src/lib/api.ts src/components/shell/PainelNotificacoes.tsx .env.example
git commit -m "feat(sino): alerta de visita em vermelho com botão Confirmar visita"
```

---

### Task 6: Agente extrai o pedido de visita e chama a API

Repositório `Lotti-ADM/n8n-agent-lotti`. Crie a branch `claude/visita-agendada` a partir de `claude/webhook-direto`, que é o código de produção mais as correções do Railway.

**Files:**
- Modify: `runtime/qualification.mjs`, `runtime/openai.mjs`, `runtime/turn.mjs`, `runtime/server.mjs`, `runtime/qualification.test.mjs`, `.env.example`
- Create: `runtime/visits.mjs`
- Test: `runtime/visits.test.mjs`

**Interfaces:**
- Consumes: `POST {AGENT_API_URL}/api/agente/visitas` (Task 4), header `x-lotti-agent: AGENT_API_TOKEN`.
- Produces:
  - campo `visitRequest: {date:'YYYY-MM-DD', time:'HH:MM'} | null` no resultado da qualificação;
  - `createVisitRequester({env, request, log}) → async (job) => void`, que nunca lança erro.

- [ ] **Step 1: Testes que falham da normalização**

Acrescente em `runtime/qualification.test.mjs` (garanta `validateQualification` no import):
```js
test('visitRequest válido passa; inválido vira null sem derrubar a resposta', () => {
  const base = {response:'Ótimo! Vou pedir ao corretor para confirmar.',stage:'qualificando',temperature:'morno',priority:'normal',
    reason:'x',humanRequested:false,evidence:[],profile:{intent:null,region:null,budget:null,needs:null,nextStep:null}};
  const ctx = {messages:[{direction:'in',content:'quero visitar quarta 15h'}],properties:[]};
  assert.deepEqual(validateQualification({...base,visitRequest:{date:'2026-10-07',time:'15:00'}},ctx).visitRequest,{date:'2026-10-07',time:'15:00'});
  assert.equal(validateQualification({...base,visitRequest:{date:'07/10',time:'15h'}},ctx).visitRequest,null);
  assert.equal(validateQualification({...base},ctx).visitRequest,null);
});
```

Run: `cd runtime && node --test qualification.test.mjs`
Expected: FAIL (`visitRequest` é `undefined`).

- [ ] **Step 2: Schema e normalização**

Em `runtime/qualification.mjs`:
1. Em `systemInstruction`, acrescente antes da linha `Retorne somente JSON conforme o esquema...`:
```
Se o cliente pediu visita e disse dia e horário claros, preencha visitRequest com date (AAAA-MM-DD, calcule a partir de hoje em Brasília) e time (HH:MM, 24h); caso contrário visitRequest é null. Isso não confirma nada: continue dizendo que o corretor confirma o horário.
```
2. Em `responseSchema.properties`, acrescente:
```js
    visitRequest:{type:'OBJECT',nullable:true,required:['date','time'],properties:{date:{type:'STRING'},time:{type:'STRING'}}},
```
3. Em `validateQualification`, troque a linha final `return {...value,evidence,humanRequested:value.humanRequested===true};` por:
```js
  const v=value.visitRequest;
  const visitRequest=v&&/^\d{4}-\d{2}-\d{2}$/.test(v.date)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)?{date:v.date,time:v.time}:null;
  return {...value,evidence,humanRequested:value.humanRequested===true,visitRequest};
```

Em `runtime/openai.mjs`, no `schema`:
- acrescente `'visitRequest'` ao fim do array `required` de nível superior;
- acrescente a `properties`:
```js
  visitRequest:{anyOf:[{type:'object',additionalProperties:false,required:['date','time'],properties:{date:{type:'string'},time:{type:'string'}}},{type:'null'}]},
```

O modelo precisa saber a data de hoje para calcular "quarta". Em `runtime/turn.mjs`, na montagem do `context` dentro de `qualify`, acrescente o campo `today`:
```js
  const context={messages,properties,previousProfile:job.profile,today:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',weekday:'long',year:'numeric',month:'2-digit',day:'2-digit'}).format(at)};
```
Confira em `openai.mjs` e `gemini.mjs` como o `context` vira texto para o modelo: procure `previousProfile` nos dois arquivos e acrescente `today` do mesmo jeito que `previousProfile` é incluído.

Run: `cd runtime && node --test qualification.test.mjs openai.test.mjs`
Expected: PASS. Se algum teste de `openai.test.mjs` comparar o schema inteiro, atualize a expectativa com o campo novo.

- [ ] **Step 3: Teste que falha do requester**

`runtime/visits.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisitRequester} from './visits.mjs';

const env={AGENT_API_URL:'http://api.railway.internal:3001',AGENT_API_TOKEN:'t'.repeat(40)};
const job={id:'conv1',corretor_id:'cor1',sandbox:false,result:{visitRequest:{date:'2026-10-07',time:'15:30'},profile:{propertyId:'imo1'}}};

test('pede a visita à API com o segredo e os dados da conversa',async()=>{
 const calls=[];
 const req=createVisitRequester({env,request:async(url,opts)=>{calls.push({url,opts});return {situacao:'agendada'};},log:()=>{}});
 await req(job);
 assert.equal(calls[0].url,'http://api.railway.internal:3001/api/agente/visitas');
 assert.equal(calls[0].opts.headers['x-lotti-agent'],env.AGENT_API_TOKEN);
 assert.deepEqual(JSON.parse(calls[0].opts.body),{conversationId:'conv1',corretorId:'cor1',data:'2026-10-07',hora:'15:30',imovelId:'imo1'});
});

test('não chama sem pedido de visita, em sandbox ou sem configuração',async()=>{
 let n=0;const request=async()=>{n++;};
 await createVisitRequester({env,request,log:()=>{}})({...job,result:{visitRequest:null}});
 await createVisitRequester({env,request,log:()=>{}})({...job,sandbox:true});
 await createVisitRequester({env:{},request,log:()=>{}})(job);
 assert.equal(n,0);
});

test('falha da API só gera log, sem conteúdo, e nunca lança',async()=>{
 const logs=[];
 await createVisitRequester({env,request:async()=>{throw Error('upstream_500');},log:l=>logs.push(l)})(job);
 assert.deepEqual(logs,['{"event":"lotti.visit","error":"upstream_500"}']);
});

test('imóvel que não é uuid vai como null',async()=>{
 const calls=[];
 await createVisitRequester({env,request:async(u,o)=>{calls.push(JSON.parse(o.body));},log:()=>{}})({...job,result:{...job.result,profile:{propertyId:'apto-centro'}}});
 assert.equal(calls[0].imovelId,null);
});
```

Run: `cd runtime && node --test visits.test.mjs`
Expected: FAIL com "Cannot find module './visits.mjs'".

- [ ] **Step 4: Implementar e ligar**

`runtime/visits.mjs`:
```js
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Depois da resposta entregue: um pedido de visita com dia e horário vai para a
// API Lotti, que agenda (horário livre) ou chama o gestor (ocupado). Nunca
// derruba a conversa: falha só vira log, sem telefone nem conteúdo.
export function createVisitRequester({env,request,log=console.error}){
 return async function requestVisit(job){
  const v=job?.result?.visitRequest;
  if(!v||job.sandbox||!env.AGENT_API_URL||!env.AGENT_API_TOKEN||!job.id||!job.corretor_id)return;
  const propertyId=job.result?.profile?.propertyId;
  try{
   await request(env.AGENT_API_URL.replace(/\/+$/,'')+'/api/agente/visitas',{
    method:'POST',headers:{'Content-Type':'application/json','x-lotti-agent':env.AGENT_API_TOKEN},
    body:JSON.stringify({conversationId:job.id,corretorId:job.corretor_id,data:v.date,hora:v.time,imovelId:uuid.test(propertyId||'')?propertyId:null})
   });
  }catch(e){log(JSON.stringify({event:'lotti.visit',error:String(e.message).startsWith('upstream_')?e.message:'failed'}));}
 };
}
```

Em `runtime/turn.mjs`:
- mude a assinatura para `export function createTurn({sb,rpc,loadSettings,loadCatalog,generate,followUpEnabled=()=>false,requestVisit=async()=>{},now=()=>new Date()}){`;
- na primeira linha de `afterDelivery`, antes do `if(job?.handoff)`, acrescente `await requestVisit(job);`.

Em `runtime/server.mjs`:
- importe `import {createVisitRequester} from './visits.mjs';`;
- na criação do `turn`, acrescente `requestVisit:createVisitRequester({env,request})` ao objeto de opções de `createTurn`.

Em `.env.example`, acrescente:
```
# API Lotti: visita pedida no WhatsApp vira agendamento. Ex.: http://api.railway.internal:3001
AGENT_API_URL=
# Mesmo valor de AGENT_API_TOKEN no serviço api (32+ caracteres).
AGENT_API_TOKEN=
```

- [ ] **Step 5: Rodar tudo**

Run: `cd runtime && node --test *.test.mjs`
Expected: todos passam (157 da branch base + 1 + 4 = 162).

- [ ] **Step 6: Commit, push e PR**

```bash
git add runtime .env.example
git commit -m "feat(runtime): pedido de visita com dia e hora vai para a API Lotti"
git push -u origin claude/visita-agendada
gh pr create -R Lotti-ADM/n8n-agent-lotti --draft --base main --title "feat(runtime): visita pedida vira agendamento" --body "Depende da API Lotti (casa-mente-contrato PR #51 + Etapa 2). Plano: casa-mente-contrato docs/superpowers/plans/2026-10-04-api-lotti-visitas.md"
```

---

### Task 7: No ar e prova de ponta a ponta

**Files:** nenhum. Só configuração e validação.

- [ ] **Step 1: Segredo compartilhado**

Gere um segredo de 48 caracteres, sem mostrar no chat nem gravar em arquivo, e cadastre o **mesmo valor** em `AGENT_API_TOKEN` nos serviços `api` e `agent` do Railway:
```bash
node -e "process.stdout.write(require('crypto').randomBytes(36).toString('base64url'))" | railway variables --service api --set "AGENT_API_TOKEN=$(cat)"
```
Se o `railway variables --set` não aceitar entrada por pipe, cadastre pelo painel, colando o valor gerado direto no campo.

No `agent`: `AGENT_API_URL=http://api.railway.internal:3001`.

No front (`casa-mente-contrato`): `VITE_API_URL=https://api-production-7ff5.up.railway.app`. Exige novo deploy do front, porque a variável entra no build.

- [ ] **Step 2: Prova da API com um pedido real**

Com o segredo, chame a rota contra uma conversa **sandbox** (ou crie uma, com autorização do Rafael), para amanhã às 10:00:
```bash
curl -s -X POST https://api-production-7ff5.up.railway.app/api/agente/visitas \
  -H "x-lotti-agent: $AGENT_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"conversationId":"<uuid>","corretorId":"<uuid>","data":"<amanhã>","hora":"10:00"}'
```
Expected: 201 com `situacao: "agendada"`. O sino do corretor mostra o alerta **vermelho** com "Confirmar visita". Clicar confirma (toast "Visita confirmada.") e o evento aparece na Rotina como confirmado. Em até 30 min, aparece no Google Agenda conectado.

Repita no mesmo horário com um evento já existente na agenda. Expected: `situacao: "conflito"`, alerta para o corretor e para o gestor, e nenhum evento criado até o gestor confirmar.

Ao final, cancele os eventos de teste pela Rotina.

- [ ] **Step 3: Registrar no `AI_HANDOFF.md`** (sem segredos)

---

## Fora desta etapa

- Mensagem de confirmação para o lead no WhatsApp depois do clique: Etapa 2b.
- Busca de imóveis como ferramenta do agente, com card montado em código (padrão do Clix): Etapa 2c.
- Remarcar ou recusar visita pelo sino (hoje só confirmar; recusar é feito na Rotina).
