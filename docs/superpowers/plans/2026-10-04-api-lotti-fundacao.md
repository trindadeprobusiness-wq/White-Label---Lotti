# API Lotti — Etapa 1: fundação no padrão do Clix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir no Railway uma API NestJS própria da Lotti (Postgres + Redis), no mesmo padrão do Clix, já entregando a primeira rota real: a busca de imóveis com filtros, protegida pelo login atual.

**Architecture:** A pasta `api/` é um serviço NestJS separado dentro deste repositório. Ele se conecta direto ao Postgres do Supabase atual, sem a camada REST do Supabase. Cada consulta de usuário roda numa transação com `role authenticated` e as claims do JWT, então o RLS que já existe continua protegendo os dados durante toda a migração. O login continua sendo o Supabase Auth: a API só valida o token que o front já tem. O Redis entra como base para as filas (BullMQ), que a Etapa 2 usa para o agente do WhatsApp.

**Tech Stack:** Node 22, NestJS 10, Prisma 6, BullMQ 5 + ioredis, jose (JWT), class-validator, Jest 29 + ts-jest + supertest. Referência de padrão: `C:\Users\rafae\Clix\catalogo\apps\api`.

## Global Constraints

- **Nunca rodar `prisma migrate`, `prisma db push` ou `prisma db pull` contra o banco do Supabase.** O schema continua sendo das migrations SQL em `supabase/migrations/`. O Prisma aqui só lê, com modelos escritos à mão. `prisma generate` é o único comando Prisma permitido.
- Toda consulta feita em nome de um usuário passa por `TenantDb.run(claims, ...)`. Proibido usar `this.prisma.<modelo>` direto num controller ou service de usuário: isso ignora o RLS.
- Nenhuma rota devolve colunas do proprietário (`proprietario_nome`, `proprietario_cpf`, `proprietario_email`, `proprietario_telefone`) nem `endereco`.
- BullMQ: `jobId` customizado nunca contém `:` nem espaço (o BullMQ 5 rejeita; quebrou o follow-up do Clix). Use o helper `jobId()` da Task 6.
- Logs nunca contêm token, telefone, e-mail ou conteúdo de mensagem.
- Versões: `@nestjs/*` ^10.4.15, `prisma`/`@prisma/client` ^6.1.0, `bullmq` ^5.78.0, `jest` ^29.7.0, `ts-jest` ^29.2.5, Node >= 22.
- Os testes do front (`npm test` na raiz, Vitest) não podem pegar arquivos de `api/`.
- Textos de erro para o usuário em português. Código, nomes de arquivo e identificadores em inglês, como no Clix.

---

## Estrutura de arquivos

```
api/
  package.json            dependências, scripts e config do Jest
  tsconfig.json           compilação (decorators ligados)
  tsconfig.build.json     build sem os *.spec.ts
  Dockerfile              imagem do Railway
  .dockerignore
  prisma/schema.prisma    modelos escritos à mão (só leitura)
  src/
    main.ts               bootstrap: prefixo /api, CORS, ValidationPipe
    app.module.ts         registra os módulos
    config/env.ts         leitura e validação das variáveis
    config/env.spec.ts
    prisma/prisma.service.ts
    prisma/prisma.module.ts
    prisma/tenant-db.ts         transação com role authenticated + claims (RLS)
    prisma/tenant-db.spec.ts
    redis/redis.service.ts      conexão compartilhada + ping
    redis/redis.module.ts
    queue/job-id.ts             helper de jobId seguro para o BullMQ
    queue/job-id.spec.ts
    auth/supabase-auth.guard.ts valida o JWT do Supabase
    auth/claims.decorator.ts    @Claims()
    auth/supabase-auth.guard.spec.ts
    health/health.controller.ts GET /api/health (banco + Redis)
    health/health.controller.spec.ts
    imoveis/busca-imoveis.dto.ts
    imoveis/imoveis.service.ts
    imoveis/imoveis.controller.ts
    imoveis/imoveis.module.ts
    imoveis/imoveis.service.spec.ts
    imoveis/imoveis.controller.spec.ts
```

Também mudam, fora de `api/`:
- `vite.config.ts`: o Vitest passa a ignorar `api/**`.
- `.dockerignore` (raiz): ignora `api/` no build do front.
- `.github/workflows/security.yml`: job novo `api`.

---

### Task 1: Esqueleto do serviço e isolamento do front

**Files:**
- Create: `api/package.json`, `api/tsconfig.json`, `api/tsconfig.build.json`, `api/src/main.ts`, `api/src/app.module.ts`
- Modify: `vite.config.ts` (bloco `test`), `.dockerignore` (raiz)

**Interfaces:**
- Produces: `AppModule` (array `imports` que as próximas tasks completam); scripts `npm test`, `npm run build`, `npm run start:prod` dentro de `api/`.

- [ ] **Step 1: Criar `api/package.json`**

```json
{
  "name": "@lotti/api",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start:prod": "node dist/main.js",
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "@prisma/client": "^6.1.0",
    "bullmq": "^5.78.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^5.4.2",
    "jose": "^5.9.6",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.15",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.2",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "prisma": "^6.1.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.2"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.ts$": "ts-jest" },
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Criar `api/tsconfig.json` e `api/tsconfig.build.json`**

`api/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`api/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.spec.ts"]
}
```

- [ ] **Step 3: Criar `api/src/app.module.ts` e `api/src/main.ts`**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
})
export class AppModule {}
```

`api/src/main.ts`:
```ts
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}

void bootstrap();
```

- [ ] **Step 4: Instalar e conferir que compila**

Run: `cd api && npm install && npx tsc --noEmit`
Expected: sem erros, e `api/package-lock.json` criado.

- [ ] **Step 5: Impedir que o Vitest do front rode os testes da API**

Em `vite.config.ts`, acrescente no topo do arquivo a referência de tipos e o import, e o bloco `test` no objeto retornado, ao lado de `build`:

```ts
/// <reference types="vitest/config" />
import { configDefaults } from "vitest/config";
```

```ts
  test: {
    // api/ é um serviço Node à parte, testado com Jest dentro da própria pasta.
    exclude: [...configDefaults.exclude, "api/**"],
  },
```

- [ ] **Step 6: Ignorar `api/` no build do front**

Acrescente ao fim de `.dockerignore` da raiz:
```
api
```

- [ ] **Step 7: Conferir que o front segue igual**

Run (na raiz): `npm test`
Expected: mesma contagem de testes passando de antes, nenhum arquivo de `api/` listado.

- [ ] **Step 8: Commit**

```bash
git add api/package.json api/package-lock.json api/tsconfig.json api/tsconfig.build.json api/src vite.config.ts .dockerignore
git commit -m "feat(api): esqueleto do serviço NestJS isolado do front"
```

---

### Task 2: Variáveis de ambiente

**Files:**
- Create: `api/src/config/env.ts`
- Test: `api/src/config/env.spec.ts`

**Interfaces:**
- Produces: `interface AppEnv { isProd: boolean; port: number; databaseUrl: string; redisUrl: string; supabaseUrl: string; supabaseJwtSecret?: string; corsOrigins: string[] }`, `function loadEnv(source?: NodeJS.ProcessEnv): AppEnv`, `const ENV: unique symbol` (token de injeção) e `EnvModule` (global, fornece `ENV`).

- [ ] **Step 1: Escrever o teste que falha**

`api/src/config/env.spec.ts`:
```ts
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@db:5432/postgres',
  REDIS_URL: 'redis://redis:6379',
  SUPABASE_URL: 'https://abc.supabase.co',
};

describe('loadEnv', () => {
  it('lê as obrigatórias e aplica padrões', () => {
    const env = loadEnv({ ...base });
    expect(env).toEqual({
      isProd: false,
      port: 3001,
      databaseUrl: base.DATABASE_URL,
      redisUrl: base.REDIS_URL,
      supabaseUrl: 'https://abc.supabase.co',
      supabaseJwtSecret: undefined,
      corsOrigins: [],
    });
  });

  it('separa as origens de CORS e tira a barra final da URL do Supabase', () => {
    const env = loadEnv({ ...base, SUPABASE_URL: 'https://abc.supabase.co/', CORS_ORIGINS: 'https://app.plataformalotti.com.br, http://127.0.0.1:8085', PORT: '8080' });
    expect(env.supabaseUrl).toBe('https://abc.supabase.co');
    expect(env.corsOrigins).toEqual(['https://app.plataformalotti.com.br', 'http://127.0.0.1:8085']);
    expect(env.port).toBe(8080);
  });

  it('recusa subir sem variável obrigatória e diz qual falta', () => {
    expect(() => loadEnv({ REDIS_URL: base.REDIS_URL, SUPABASE_URL: base.SUPABASE_URL })).toThrow('DATABASE_URL');
  });

  it('em produção exige ao menos uma origem de CORS', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow('CORS_ORIGINS');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx jest config/env.spec.ts`
Expected: FAIL com "Cannot find module './env'".

- [ ] **Step 3: Implementar**

`api/src/config/env.ts`:
```ts
import { Global, Module } from '@nestjs/common';

export interface AppEnv {
  isProd: boolean;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  supabaseUrl: string;
  /** Projetos com chave JWT legada (HS256). Vazio: valida pelas chaves públicas (JWKS). */
  supabaseJwtSecret?: string;
  corsOrigins: string[];
}

export const ENV = Symbol('ENV');

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (!value || value.trim() === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value.trim();
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const isProd = source.NODE_ENV === 'production';
  const corsOrigins = (source.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (isProd && corsOrigins.length === 0) throw new Error('Variável de ambiente obrigatória ausente: CORS_ORIGINS');
  return {
    isProd,
    port: Number(source.PORT ?? 3001),
    databaseUrl: required(source, 'DATABASE_URL'),
    redisUrl: required(source, 'REDIS_URL'),
    supabaseUrl: required(source, 'SUPABASE_URL').replace(/\/+$/, ''),
    supabaseJwtSecret: source.SUPABASE_JWT_SECRET?.trim() || undefined,
    corsOrigins,
  };
}

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx jest config/env.spec.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Registrar o módulo e usar a porta e o CORS no bootstrap**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';

@Module({
  imports: [EnvModule],
})
export class AppModule {}
```

Em `api/src/main.ts`, substitua o corpo de `bootstrap` por:
```ts
  const app = await NestFactory.create(AppModule);
  const env = app.get<AppEnv>(ENV);
  app.enableCors({ origin: env.corsOrigins, credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(env.port, '0.0.0.0');
```
e acrescente o import `import { AppEnv, ENV } from './config/env';`.

- [ ] **Step 6: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add api/src/config api/src/app.module.ts api/src/main.ts
git commit -m "feat(api): leitura e validação das variáveis de ambiente"
```

---

### Task 3: Prisma e TenantDb (RLS preservado)

**Files:**
- Create: `api/prisma/schema.prisma`, `api/src/prisma/prisma.service.ts`, `api/src/prisma/prisma.module.ts`, `api/src/prisma/tenant-db.ts`
- Test: `api/src/prisma/tenant-db.spec.ts`

**Interfaces:**
- Consumes: `ENV`/`AppEnv` (Task 2).
- Produces: `PrismaService` (estende `PrismaClient`); `interface SupabaseClaims { sub: string; role: string; email?: string; [key: string]: unknown }`; `TenantDb.run<T>(claims: SupabaseClaims, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>`; `PrismaModule` (global, exporta `PrismaService` e `TenantDb`).

- [ ] **Step 0: Conferir que o usuário do banco pode assumir o papel `authenticated` (só leitura)**

Run:
```bash
C:/Users/rafae/bin/supabase db query --linked "select current_user, pg_has_role(current_user,'authenticated','member') as pode"
```
Expected: `pode = true`. Se vier `false`, **pare e reporte**: o TenantDb depende disso, e conceder o papel (`grant authenticated to <usuário>`) é mudança no banco de produção que precisa de autorização.

- [ ] **Step 1: Conferir os tipos reais das colunas em produção (só leitura)**

Run (raiz do repo, binário da CLI usado neste projeto):
```bash
C:/Users/rafae/bin/supabase db query --linked "select column_name, data_type, udt_name, is_nullable from information_schema.columns where table_schema='public' and table_name='imoveis' order by ordinal_position"
```
Expected: lista das colunas. Anote o `data_type` de `valor` e `area_m2` (esperado `numeric`) e de `dormitorios`, `suites`, `garagem` (esperado `integer`). Se algum for diferente, use no Step 2 o tipo Prisma correspondente: `numeric` → `Decimal @db.Decimal`, `integer` → `Int`, `double precision` → `Float`, `real` → `Float @db.Real`.

- [ ] **Step 2: Criar `api/prisma/schema.prisma`**

```prisma
// Modelos escritos à mão, só para leitura. O schema real é das migrations SQL
// em supabase/migrations. NUNCA rodar prisma migrate, db push ou db pull aqui.
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum TipoImovel {
  APARTAMENTO
  CASA
  COMERCIAL
  TERRENO

  @@map("tipo_imovel")
}

enum FinalidadeImovel {
  VENDA
  LOCACAO
  AMBOS

  @@map("finalidade_imovel")
}

model Imovel {
  id          String           @id @db.Uuid
  corretorId  String           @map("corretor_id") @db.Uuid
  titulo      String
  tipo        TipoImovel
  finalidade  FinalidadeImovel
  valor       Decimal          @db.Decimal
  cidade      String
  bairro      String?
  dormitorios Int?
  suites      Int?
  garagem     Int?
  areaM2      Decimal?         @map("area_m2") @db.Decimal
  ativo       Boolean?

  @@map("imoveis")
}
```

- [ ] **Step 3: Gerar o client e automatizar a geração**

Em `api/package.json`, troque os scripts `build` e acrescente `postinstall`, para o `npm ci` do CI e do Docker já gerar o client:
```json
    "postinstall": "prisma generate",
    "build": "prisma generate && tsc -p tsconfig.build.json",
```

Run: `cd api && npx prisma generate`
Expected: "Generated Prisma Client". Não precisa de banco para isso.

- [ ] **Step 4: Escrever o teste que falha do TenantDb**

`api/src/prisma/tenant-db.spec.ts`:
```ts
import { TenantDb } from './tenant-db';

function fakePrisma() {
  const calls: string[] = [];
  const tx = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`raw:${strings.join('?')}|${JSON.stringify(values)}`);
      return 1;
    }),
    $executeRawUnsafe: jest.fn(async (sql: string) => {
      calls.push(`unsafe:${sql}`);
      return 0;
    }),
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma, tx, calls };
}

describe('TenantDb', () => {
  const claims = { sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' };

  it('aplica as claims e o papel authenticated antes da consulta, na mesma transação', async () => {
    const { prisma, tx, calls } = fakePrisma();
    const db = new TenantDb(prisma as never);
    const result = await db.run(claims, async (t) => {
      expect(t).toBe(tx);
      calls.push('work');
      return 42;
    });
    expect(result).toBe(42);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      `raw:select set_config('request.jwt.claims', ?, true)|${JSON.stringify([JSON.stringify(claims)])}`,
      'unsafe:set local role authenticated',
      'work',
    ]);
  });

  it('recusa claims sem usuário autenticado', async () => {
    const { prisma } = fakePrisma();
    const db = new TenantDb(prisma as never);
    await expect(db.run({ sub: '', role: 'authenticated' }, async () => 1)).rejects.toThrow('claims_invalidas');
    await expect(db.run({ sub: claims.sub, role: 'anon' }, async () => 1)).rejects.toThrow('claims_invalidas');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `cd api && npx jest prisma/tenant-db.spec.ts`
Expected: FAIL com "Cannot find module './tenant-db'".

- [ ] **Step 6: Implementar PrismaService, TenantDb e PrismaModule**

`api/src/prisma/prisma.service.ts`:
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

`api/src/prisma/tenant-db.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface SupabaseClaims {
  sub: string;
  role: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * Roda a consulta como o próprio usuário: mesmas claims que o PostgREST aplica,
 * papel `authenticated`, tudo dentro de uma transação. Assim as policies RLS e
 * get_corretor_id() continuam valendo enquanto a API substitui o Supabase.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(claims: SupabaseClaims, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!claims?.sub || claims.role !== 'authenticated') throw new Error('claims_invalidas');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx.$executeRawUnsafe('set local role authenticated');
      return work(tx);
    });
  }
}
```

`api/src/prisma/prisma.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantDb } from './tenant-db';

@Global()
@Module({
  providers: [PrismaService, TenantDb],
  exports: [PrismaService, TenantDb],
})
export class PrismaModule {}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd api && npx jest prisma/tenant-db.spec.ts`
Expected: PASS, 2 testes.

- [ ] **Step 8: Registrar no AppModule**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [EnvModule, PrismaModule],
})
export class AppModule {}
```

- [ ] **Step 9: Commit**

```bash
git add api/prisma api/src/prisma api/src/app.module.ts api/package.json
git commit -m "feat(api): Prisma só leitura e TenantDb que preserva o RLS"
```

---

### Task 4: Login — validação do JWT do Supabase

**Files:**
- Create: `api/src/auth/supabase-auth.guard.ts`, `api/src/auth/claims.decorator.ts`
- Test: `api/src/auth/supabase-auth.guard.spec.ts`

**Interfaces:**
- Consumes: `ENV`/`AppEnv` (Task 2), `SupabaseClaims` (Task 3).
- Produces: `SupabaseAuthGuard` (`CanActivate`; grava `request.claims`); decorator `@Claims()` que devolve `SupabaseClaims`.

- [ ] **Step 1: Escrever o teste que falha**

`api/src/auth/supabase-auth.guard.spec.ts`:
```ts
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AppEnv } from '../config/env';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const secret = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const env: AppEnv = {
  isProd: false, port: 3001, databaseUrl: 'x', redisUrl: 'x',
  supabaseUrl: 'https://abc.supabase.co', supabaseJwtSecret: secret, corsOrigins: [],
};

async function token(overrides: Record<string, unknown> = {}, key = secret) {
  return new SignJWT({ role: 'authenticated', email: 'corretor@exemplo.com', ...overrides })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-1111-1111-1111-111111111111')
    .setIssuer('https://abc.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(key));
}

function context(authorization?: string) {
  const request: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  const ctx = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('SupabaseAuthGuard', () => {
  const guard = new SupabaseAuthGuard(env);

  it('aceita token válido e grava as claims na requisição', async () => {
    const { ctx, request } = context(`Bearer ${await token()}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.claims).toMatchObject({ sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' });
  });

  it('recusa requisição sem token', async () => {
    await expect(guard.canActivate(context().ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token assinado com outra chave', async () => {
    const { ctx } = context(`Bearer ${await token({}, 'outra-chave-qualquer-com-mais-de-32-caracteres')}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token anônimo (role anon)', async () => {
    const { ctx } = context(`Bearer ${await token({ role: 'anon' })}`);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx jest auth/supabase-auth.guard.spec.ts`
Expected: FAIL com "Cannot find module './supabase-auth.guard'".

- [ ] **Step 3: Implementar o guard e o decorator**

`api/src/auth/supabase-auth.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppEnv, ENV } from '../config/env';
import { SupabaseClaims } from '../prisma/tenant-db';

/** Aceita o mesmo token que o front já recebe do Supabase Auth. */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const header = request.headers?.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException('Sessão ausente.');
    let payload: JWTPayload;
    try {
      payload = (await this.verify(token)).payload;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    request.claims = payload as SupabaseClaims;
    return true;
  }

  private verify(token: string) {
    const options = { issuer: `${this.env.supabaseUrl}/auth/v1`, audience: 'authenticated' };
    if (this.env.supabaseJwtSecret) {
      return jwtVerify(token, new TextEncoder().encode(this.env.supabaseJwtSecret), options);
    }
    this.jwks ??= createRemoteJWKSet(new URL(`${this.env.supabaseUrl}/auth/v1/.well-known/jwks.json`));
    return jwtVerify(token, this.jwks, options);
  }
}
```

`api/src/auth/claims.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SupabaseClaims } from '../prisma/tenant-db';

export const Claims = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SupabaseClaims => ctx.switchToHttp().getRequest().claims,
);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx jest auth/supabase-auth.guard.spec.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Commit**

```bash
git add api/src/auth
git commit -m "feat(api): valida o JWT do Supabase Auth"
```

---

### Task 5: Busca de imóveis

**Files:**
- Create: `api/src/imoveis/busca-imoveis.dto.ts`, `api/src/imoveis/imoveis.service.ts`, `api/src/imoveis/imoveis.controller.ts`, `api/src/imoveis/imoveis.module.ts`
- Test: `api/src/imoveis/imoveis.service.spec.ts`, `api/src/imoveis/imoveis.controller.spec.ts`

**Interfaces:**
- Consumes: `TenantDb.run` e `SupabaseClaims` (Task 3), `SupabaseAuthGuard` e `@Claims()` (Task 4).
- Produces: `GET /api/imoveis/busca` → `ImovelResumo[]`; `interface ImovelResumo { id: string; titulo: string; tipo: string; finalidade: string; valor: number; cidade: string; bairro: string | null; dormitorios: number | null; suites: number | null; garagem: number | null; areaM2: number | null }`; `function buildWhere(f: BuscaImoveisDto): Prisma.ImovelWhereInput`. A Etapa 2 usa `ImoveisService.buscar(claims, filtros)` como ferramenta do agente.

- [ ] **Step 1: Escrever o teste que falha do service**

`api/src/imoveis/imoveis.service.spec.ts`:
```ts
import { Prisma } from '@prisma/client';
import { buildWhere, ImoveisService } from './imoveis.service';

describe('buildWhere', () => {
  it('sempre filtra imóveis ativos', () => {
    expect(buildWhere({})).toEqual({ ativo: true });
  });

  it('busca cidade e bairro sem diferenciar maiúsculas', () => {
    expect(buildWhere({ cidade: 'Anápolis', bairro: 'Jundiaí' })).toEqual({
      ativo: true,
      cidade: { contains: 'Anápolis', mode: 'insensitive' },
      bairro: { contains: 'Jundiaí', mode: 'insensitive' },
    });
  });

  it('venda também traz imóvel marcado como AMBOS; AMBOS não filtra', () => {
    expect(buildWhere({ finalidade: 'VENDA' }).finalidade).toEqual({ in: ['VENDA', 'AMBOS'] });
    expect(buildWhere({ finalidade: 'AMBOS' }).finalidade).toBeUndefined();
  });

  it('monta faixa de valor e mínimo de dormitórios', () => {
    expect(buildWhere({ valorMin: 200000, valorMax: 450000, dormitoriosMin: 2, tipo: 'APARTAMENTO' })).toEqual({
      ativo: true,
      tipo: 'APARTAMENTO',
      valor: { gte: 200000, lte: 450000 },
      dormitorios: { gte: 2 },
    });
  });
});

describe('ImoveisService.buscar', () => {
  it('consulta dentro do TenantDb, sem colunas do proprietário, e converte decimais', async () => {
    const findMany = jest.fn(async () => [
      { id: 'i1', titulo: 'Apto Jundiaí', tipo: 'APARTAMENTO', finalidade: 'VENDA', valor: new Prisma.Decimal('350000.00'),
        cidade: 'Anápolis', bairro: 'Jundiaí', dormitorios: 3, suites: 1, garagem: 2, areaM2: new Prisma.Decimal('82.5') },
    ]);
    const tenantDb = { run: jest.fn(async (_claims: unknown, work: (tx: unknown) => unknown) => work({ imovel: { findMany } })) };
    const service = new ImoveisService(tenantDb as never);
    const claims = { sub: 'u1', role: 'authenticated' };

    const result = await service.buscar(claims, { cidade: 'Anápolis', limit: 5 });

    expect(tenantDb.run).toHaveBeenCalledWith(claims, expect.any(Function));
    const query = findMany.mock.calls[0][0];
    expect(query.take).toBe(5);
    expect(query.orderBy).toEqual({ valor: 'asc' });
    expect(Object.keys(query.select).sort()).toEqual(
      ['areaM2', 'bairro', 'cidade', 'dormitorios', 'finalidade', 'garagem', 'id', 'suites', 'tipo', 'titulo', 'valor'],
    );
    expect(result).toEqual([
      { id: 'i1', titulo: 'Apto Jundiaí', tipo: 'APARTAMENTO', finalidade: 'VENDA', valor: 350000,
        cidade: 'Anápolis', bairro: 'Jundiaí', dormitorios: 3, suites: 1, garagem: 2, areaM2: 82.5 },
    ]);
  });

  it('usa 20 resultados quando o limite não vem', async () => {
    const findMany = jest.fn(async () => []);
    const tenantDb = { run: jest.fn(async (_c: unknown, work: (tx: unknown) => unknown) => work({ imovel: { findMany } })) };
    await new ImoveisService(tenantDb as never).buscar({ sub: 'u1', role: 'authenticated' }, {});
    expect(findMany.mock.calls[0][0].take).toBe(20);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx jest imoveis/imoveis.service.spec.ts`
Expected: FAIL com "Cannot find module './imoveis.service'".

- [ ] **Step 3: Implementar o DTO e o service**

`api/src/imoveis/busca-imoveis.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const TIPOS = ['APARTAMENTO', 'CASA', 'COMERCIAL', 'TERRENO'] as const;
export const FINALIDADES = ['VENDA', 'LOCACAO', 'AMBOS'] as const;

export class BuscaImoveisDto {
  @IsOptional() @IsString() @MaxLength(80) cidade?: string;
  @IsOptional() @IsString() @MaxLength(80) bairro?: string;
  @IsOptional() @IsIn(TIPOS) tipo?: (typeof TIPOS)[number];
  @IsOptional() @IsIn(FINALIDADES) finalidade?: (typeof FINALIDADES)[number];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) valorMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) valorMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) dormitoriosMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
```

`api/src/imoveis/imoveis.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { BuscaImoveisDto } from './busca-imoveis.dto';

export interface ImovelResumo {
  id: string;
  titulo: string;
  tipo: string;
  finalidade: string;
  valor: number;
  cidade: string;
  bairro: string | null;
  dormitorios: number | null;
  suites: number | null;
  garagem: number | null;
  areaM2: number | null;
}

// Projeção explícita: nada do proprietário nem endereço exato sai daqui.
const PROJECAO = {
  id: true, titulo: true, tipo: true, finalidade: true, valor: true, cidade: true,
  bairro: true, dormitorios: true, suites: true, garagem: true, areaM2: true,
} satisfies Prisma.ImovelSelect;

export function buildWhere(f: BuscaImoveisDto): Prisma.ImovelWhereInput {
  const where: Prisma.ImovelWhereInput = { ativo: true };
  if (f.cidade) where.cidade = { contains: f.cidade, mode: 'insensitive' };
  if (f.bairro) where.bairro = { contains: f.bairro, mode: 'insensitive' };
  if (f.tipo) where.tipo = f.tipo;
  // Quem procura venda também quer o imóvel anunciado para venda e locação.
  if (f.finalidade && f.finalidade !== 'AMBOS') where.finalidade = { in: [f.finalidade, 'AMBOS'] };
  if (f.valorMin !== undefined || f.valorMax !== undefined) {
    where.valor = {
      ...(f.valorMin !== undefined ? { gte: f.valorMin } : {}),
      ...(f.valorMax !== undefined ? { lte: f.valorMax } : {}),
    };
  }
  if (f.dormitoriosMin !== undefined) where.dormitorios = { gte: f.dormitoriosMin };
  return where;
}

@Injectable()
export class ImoveisService {
  constructor(private readonly db: TenantDb) {}

  async buscar(claims: SupabaseClaims, filtros: BuscaImoveisDto): Promise<ImovelResumo[]> {
    const rows = await this.db.run(claims, (tx) =>
      tx.imovel.findMany({ where: buildWhere(filtros), select: PROJECAO, orderBy: { valor: 'asc' }, take: filtros.limit ?? 20 }),
    );
    return rows.map((r) => ({
      ...r,
      valor: Number(r.valor),
      areaM2: r.areaM2 === null ? null : Number(r.areaM2),
    }));
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx jest imoveis/imoveis.service.spec.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Escrever o teste que falha do controller (HTTP de verdade, com supertest)**

`api/src/imoveis/imoveis.controller.spec.ts`:
```ts
import { CanActivate, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ImoveisController } from './imoveis.controller';
import { ImoveisService } from './imoveis.service';

describe('GET /api/imoveis/busca', () => {
  let app: INestApplication;
  const buscar = jest.fn(async () => [{ id: 'i1' }]);
  let permitir = true;
  const guard: CanActivate = {
    canActivate: (ctx) => {
      if (!permitir) return false;
      ctx.switchToHttp().getRequest().claims = { sub: 'u1', role: 'authenticated' };
      return true;
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ImoveisController],
      providers: [{ provide: ImoveisService, useValue: { buscar } }],
    }).overrideGuard(SupabaseAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => { buscar.mockClear(); permitir = true; });

  it('converte os filtros da query e repassa com as claims', async () => {
    const res = await request(app.getHttpServer()).get('/api/imoveis/busca?cidade=An%C3%A1polis&valorMax=450000&dormitoriosMin=2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'i1' }]);
    expect(buscar).toHaveBeenCalledWith({ sub: 'u1', role: 'authenticated' }, { cidade: 'Anápolis', valorMax: 450000, dormitoriosMin: 2 });
  });

  it('recusa filtro inválido com 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/imoveis/busca?tipo=CASTELO');
    expect(res.status).toBe(400);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('recusa parâmetro desconhecido com 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/imoveis/busca?corretor_id=outro');
    expect(res.status).toBe(400);
  });

  it('sem login responde 403 e não consulta', async () => {
    permitir = false;
    const res = await request(app.getHttpServer()).get('/api/imoveis/busca');
    expect(res.status).toBe(403);
    expect(buscar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `cd api && npx jest imoveis/imoveis.controller.spec.ts`
Expected: FAIL com "Cannot find module './imoveis.controller'".

- [ ] **Step 7: Implementar controller e módulo**

`api/src/imoveis/imoveis.controller.ts`:
```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Claims } from '../auth/claims.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { SupabaseClaims } from '../prisma/tenant-db';
import { BuscaImoveisDto } from './busca-imoveis.dto';
import { ImovelResumo, ImoveisService } from './imoveis.service';

@Controller('imoveis')
@UseGuards(SupabaseAuthGuard)
export class ImoveisController {
  constructor(private readonly imoveis: ImoveisService) {}

  @Get('busca')
  buscar(@Claims() claims: SupabaseClaims, @Query() filtros: BuscaImoveisDto): Promise<ImovelResumo[]> {
    return this.imoveis.buscar(claims, filtros);
  }
}
```

`api/src/imoveis/imoveis.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { ImoveisController } from './imoveis.controller';
import { ImoveisService } from './imoveis.service';

@Module({
  controllers: [ImoveisController],
  providers: [ImoveisService, SupabaseAuthGuard],
  exports: [ImoveisService],
})
export class ImoveisModule {}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `cd api && npx jest imoveis`
Expected: PASS, 10 testes.

Se o teste "converte os filtros" falhar porque o objeto repassado tem chaves `undefined` extras, isso vem do `transform` do ValidationPipe com `@Type`. Nesse caso troque a asserção para `expect.objectContaining({ cidade: 'Anápolis', valorMax: 450000, dormitoriosMin: 2 })`. Não mexa no DTO.

- [ ] **Step 9: Registrar no AppModule**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { ImoveisModule } from './imoveis/imoveis.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [EnvModule, PrismaModule, ImoveisModule],
})
export class AppModule {}
```

- [ ] **Step 10: Commit**

```bash
git add api/src/imoveis api/src/app.module.ts
git commit -m "feat(api): busca de imóveis com filtros, protegida pelo login"
```

---

### Task 6: Redis, jobId seguro e health check

**Files:**
- Create: `api/src/redis/redis.service.ts`, `api/src/redis/redis.module.ts`, `api/src/queue/job-id.ts`, `api/src/health/health.controller.ts`
- Test: `api/src/queue/job-id.spec.ts`, `api/src/health/health.controller.spec.ts`

**Interfaces:**
- Consumes: `ENV`/`AppEnv` (Task 2), `PrismaService` (Task 3).
- Produces: `RedisService { readonly connection: { url: string }; ping(): Promise<boolean> }` (a Etapa 2 cria `new Queue(nome, { connection: redis.connection })`); `function jobId(...parts: Array<string | number>): string`; `GET /api/health` → `{ status: 'ok' | 'degraded', checks: { database: 'ok' | 'fail', redis: 'ok' | 'fail' } }`, com 503 quando algum check falha.

- [ ] **Step 1: Escrever os testes que falham**

`api/src/queue/job-id.spec.ts`:
```ts
import { jobId } from './job-id';

describe('jobId', () => {
  it('junta as partes com hífen', () => {
    expect(jobId('agg', 'lotti-abc', 5562999990000)).toBe('agg-lotti-abc-5562999990000');
  });

  it('recusa dois-pontos e espaço, que o BullMQ 5 rejeita', () => {
    expect(() => jobId('agg', 'a:b')).toThrow('jobid_invalido');
    expect(() => jobId('agg', 'a b')).toThrow('jobid_invalido');
  });

  it('recusa id vazio', () => {
    expect(() => jobId()).toThrow('jobid_invalido');
    expect(() => jobId('')).toThrow('jobid_invalido');
  });
});
```

`api/src/health/health.controller.spec.ts`:
```ts
import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';

const prismaOk = { $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) };
const prismaFail = { $queryRaw: jest.fn(async () => { throw new Error('down'); }) };
const redis = (ok: boolean) => ({ ping: jest.fn(async () => ok) });

describe('HealthController', () => {
  it('ok quando banco e Redis respondem', async () => {
    const body = await new HealthController(prismaOk as never, redis(true) as never).health();
    expect(body).toMatchObject({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('503 quando o banco falha', async () => {
    await expect(new HealthController(prismaFail as never, redis(true) as never).health()).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ status: 'degraded', checks: { database: 'fail', redis: 'ok' } }),
    });
  });

  it('503 quando o Redis falha', async () => {
    const promise = new HealthController(prismaOk as never, redis(false) as never).health();
    await expect(promise).rejects.toBeInstanceOf(HttpException);
    await expect(promise).rejects.toMatchObject({ status: 503 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd api && npx jest queue health`
Expected: FAIL com "Cannot find module './job-id'" e "Cannot find module './health.controller'".

- [ ] **Step 3: Implementar**

`api/src/queue/job-id.ts`:
```ts
/**
 * jobId customizado para o BullMQ. O BullMQ 5 rejeita ':' em id customizado
 * (salvo exatamente 3 partes), o que já quebrou o follow-up do Clix.
 */
export function jobId(...parts: Array<string | number>): string {
  const id = parts.map(String).join('-');
  if (!id || /[:\s]/.test(id) || parts.some((p) => String(p) === '')) throw new Error('jobid_invalido');
  return id;
}
```

`api/src/redis/redis.service.ts`:
```ts
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppEnv, ENV } from '../config/env';

@Injectable()
export class RedisService implements OnModuleDestroy {
  /** Formato aceito pelo BullMQ: new Queue(nome, { connection: redis.connection }). */
  readonly connection: { url: string };
  private readonly client: Redis;

  constructor(@Inject(ENV) env: AppEnv) {
    this.connection = { url: env.redisUrl };
    this.client = new Redis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
```

`api/src/redis/redis.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

`api/src/health/health.controller.ts`:
```ts
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  @Get()
  async health() {
    let database: 'ok' | 'fail' = 'fail';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch {
      database = 'fail';
    }
    const redis: 'ok' | 'fail' = (await this.redis.ping()) ? 'ok' : 'fail';
    const ok = database === 'ok' && redis === 'ok';
    const body = { status: ok ? 'ok' : 'degraded', timestamp: new Date().toISOString(), checks: { database, redis } };
    if (!ok) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd api && npx jest queue health`
Expected: PASS, 6 testes.

- [ ] **Step 5: Registrar no AppModule**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { EnvModule } from './config/env';
import { HealthController } from './health/health.controller';
import { ImoveisModule } from './imoveis/imoveis.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule, ImoveisModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 6: Suíte inteira e build**

Run: `cd api && npm test && npm run build`
Expected: todos os testes passam (4 + 2 + 4 + 10 + 6 = 26) e `dist/main.js` é criado.

- [ ] **Step 7: Commit**

```bash
git add api/src/redis api/src/queue api/src/health api/src/app.module.ts
git commit -m "feat(api): Redis, jobId seguro para o BullMQ e health check"
```

---

### Task 7: Imagem, CI e serviço no Railway

**Files:**
- Create: `api/Dockerfile`, `api/.dockerignore`
- Modify: `.github/workflows/security.yml` (job novo `api`)

**Interfaces:**
- Consumes: scripts `build`, `test` e `start:prod` (Task 1); `GET /api/health` (Task 6).
- Produces: serviço `api` no Railway (projeto "Lotti", ambiente production), com root directory `api` e domínio temporário `*.up.railway.app`.

- [ ] **Step 1: Criar `api/Dockerfile` e `api/.dockerignore`**

`api/Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
# O schema vem antes do npm ci: o postinstall roda prisma generate.
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
EXPOSE 3001
# Sem prisma migrate: o schema é das migrations do Supabase.
CMD ["npm", "run", "start:prod"]
```

`api/.dockerignore`:
```
node_modules
dist
.env
.env.*
```

`npm prune --omit=dev` remove o pacote `prisma` (CLI), mas mantém o client já gerado em `node_modules/.prisma`, que é o que roda.

- [ ] **Step 2: Job de CI**

Em `.github/workflows/security.yml`, acrescente em `jobs:` (mesmo nível do job existente):
```yaml
  api:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: api/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build
```

- [ ] **Step 3: Conferir localmente o que o CI roda**

Run: `cd api && npm ci && npm test && npm run build`
Expected: 26 testes passando, build sem erro.

- [ ] **Step 4: Commit, push e PR**

```bash
git add api/Dockerfile api/.dockerignore .github/workflows/security.yml
git commit -m "build(api): imagem do Railway e job de CI"
git push -u origin HEAD
gh pr create --draft --title "feat(api): fundação da API Lotti (Etapa 1)" --body "Plano: docs/superpowers/plans/2026-10-04-api-lotti-fundacao.md"
```
Expected: CI verde nos dois jobs (o do front e o `api`).

- [ ] **Step 5: Criar o serviço no Railway (pelo painel ou CLI, sem gravar segredo em arquivo)**

No projeto **Lotti**, ambiente **production**:
1. Novo serviço **Redis** chamado `api-redis` (banco do Railway). Não reaproveitar o `evolution-redis`.
2. Novo serviço `api` a partir de `Lotti-ADM/casa-mente-contrato`, branch do PR, **Root Directory `api`**, builder Dockerfile.
3. Variáveis do `api`:
   - `DATABASE_URL`: connection string **do pooler do Supabase em modo transaction, porta 6543, com `?pgbouncer=true&connection_limit=5`**. Fica em Supabase → Project Settings → Database. Copie direto no Railway.
   - `REDIS_URL`: referência ao `api-redis` (`${{api-redis.REDIS_URL}}`).
   - `SUPABASE_URL`: `https://dqlolypbmsjgqrvdesev.supabase.co`.
   - `SUPABASE_JWT_SECRET`: só se o projeto ainda usar a chave JWT legada (Supabase → Project Settings → JWT Keys). Se usar as chaves novas, deixe sem.
   - `CORS_ORIGINS`: `https://app.plataformalotti.com.br`.
   - `PORT`: `3001`.
4. **Generate Domain**, porta 3001.

- [ ] **Step 6: Validar no ar**

Run:
```bash
curl -s https://<dominio-do-api>/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://<dominio-do-api>/api/imoveis/busca
```
Expected: o primeiro responde `{"status":"ok",...,"checks":{"database":"ok","redis":"ok"}}`; o segundo, `401`.

Depois, com uma sessão real: entre em `app.plataformalotti.com.br`, abra o DevTools e rode no console:
```js
const t = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.endsWith('-auth-token')))).access_token;
await fetch('https://<dominio-do-api>/api/imoveis/busca?limit=3', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json());
```
Expected: até 3 imóveis **só do corretor logado**, sem campos do proprietário. Essa é a prova de que o RLS valeu através da API.

- [ ] **Step 7: Registrar no `AI_HANDOFF.md`**

Entrada curta com o serviço, o domínio, o commit e o resultado dos dois testes do Step 6, sem segredos.

---

## Próximas etapas (planos separados, depois desta)

Cada uma vira um plano próprio quando a anterior estiver no ar:

1. **Etapa 2 — Agente do WhatsApp na API, com BullMQ.** O webhook da Evolution passa a entrar em `/api/webhooks/evolution`. A espera de alguns segundos para juntar mensagens vira um job atrasado com `jobId('agg', instancia, telefone)` (padrão do Clix). O processamento roda num `Worker` com `attempts: 1`, para nunca responder em dobro. A busca de imóveis da Etapa 1 vira ferramenta do agente, com o card do imóvel montado em código (ver `clix-comportamento-da-ia.md`). Substitui o worker do PR #21 do runtime.
2. **Etapa 3 — Agendamento com alerta urgente.** O agente detecta o pedido de visita e cria o agendamento. O corretor recebe um alerta vermelho de "confirme a visita com Fulano, dia X às Y". Se o horário está livre no Google Agenda dele, o evento é criado; se não, um gestor confirma. Reaproveita o desenho do `google-calendar` do Clix (`CalendarBusyBlock`).
3. **Etapa 4 — Busca entre corretores parceiros.** Precisa antes da decisão de negócio: todos da cidade ou só da mesma imobiliária (entidade imobiliária no banco).
4. **Etapas 5+ — CRM, contratos, aluguéis/Asaas, depois login e arquivos.** Um módulo por vez, sempre pelo `TenantDb`.
5. **Última — banco no Postgres do Railway.** Com 38 MB, é dump e restauração em minutos. A partir daí o Prisma passa a ser dono do schema.
