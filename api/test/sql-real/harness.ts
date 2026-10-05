/**
 * Banco de teste com SQL real para os services da API.
 *
 * criarBanco() sobe um Postgres de verdade (PGlite, sem Docker nem rede), aplica TODAS as migrations
 * de api/prisma/migrations em ordem (como scripts/schema/baseline.test.mjs), cria as contas A e B pelo
 * gatilho de auth.users e devolve o TenantDb REAL (src/prisma/tenant-db.ts) montado sobre um
 * PrismaService falso. A recusa de claims, o set_config('request.jwt.claims', ..., true) e o
 * `set local role authenticated` são o código de produção; só a camada do Prisma é imitada aqui.
 * RLS, gatilhos, travas de plano e funções rodam como no Supabase.
 *
 * O que foi conferido no PGlite 0.5.8 (PostgreSQL 18.3) e como o adaptador imita o Prisma 6.19.3.
 * O lado do PGlite foi executado (harness.test.ts fixa os casos principais). O lado do Prisma não pôde
 * rodar aqui (o Prisma não conecta no PGlite sem rede/socket): vem do contrato §0.2 (conferido com
 * Prisma 6.19.3 contra PG17) e do mapeamento de tipos do $queryRaw do Prisma 4+.
 *
 * Parâmetros. O Prisma tipa cada parâmetro pelo valor JS (não deixa o Postgres deduzir). O adaptador
 * faz o mesmo passando `paramTypes` ao PGlite:
 *   string → text; inteiro → int8; número fracionário → numeric; boolean → bool; bigint → int8;
 *   Date → timestamptz; Prisma.Decimal → numeric; Uint8Array/Buffer → bytea; outro objeto → jsonb
 *   (JSON.stringify); null, undefined, NaN e Infinity → null sem tipo (o Postgres deduz);
 *   lista → array do tipo do 1º elemento não nulo (string[] → text[], number[] → int8[] ...);
 *   lista vazia, só de nulos ou com tipos misturados → sem tipo.
 *   Conferido: `where id = ${id}` sem cast falha com 42883 "operator does not exist: uuid = text"
 *   (como no Prisma); `${id}::uuid`, `${ids}::uuid[]` (text[] → uuid[]), `${n}::int` (int8 → int),
 *   `${json}::jsonb` (texto → objeto), `${b}::boolean`, `${t}::timestamptz` (texto ISO, instante
 *   preservado) e `${v}::public.status_funil` funcionam; `${1.5}::int` dá 2.
 *
 * Linhas de $queryRaw (o que o Prisma devolve; o PGlite puro devolveria outra coisa nos marcados com *):
 *   jsonb/json → objeto já parseado; uuid, text, varchar, bpchar, enum → string; uuid[] → string[];
 *   array de enum → string[] (*: só depois de refreshArrayTypes, feito aqui após as migrations);
 *   int2/int4 → number; bool → boolean; float4/float8 → number;
 *   int8 e oid → BigInt (*: PGlite dá number) — count(*) sem ::int chega BigInt, como no Prisma;
 *   numeric e money → Prisma.Decimal (*: PGlite dá string);
 *   date → Date à meia-noite UTC; timestamp (sem fuso) → Date lido como UTC (*: PGlite lê no fuso da
 *   máquina); timestamptz → Date (perde os microssegundos, como no Prisma); time/timetz → Date em
 *   1970-01-01 UTC (*: PGlite dá string); bytea → Uint8Array.
 *   Coluna de tipo que o Prisma não desserializa (void, interval, record, tsvector, range, regclass...),
 *   quando vem ao menos uma linha → P2010 com meta.code 'N/A' e a mensagem "Failed to deserialize column
 *   of type '<tipo>'..." do Prisma (ex.: `select funcao_void()` por $queryRaw falha; por $executeRaw passa).
 *   to_jsonb (o formato das rotas novas) sai igual ao PostgREST: numeric vira número JSON, date vira
 *   'YYYY-MM-DD' e timestamptz vira '2026-10-05T11:19:49.433+00:00' (fuso UTC, ver Sessão).
 *
 * $executeRaw devolve o número de linhas da etiqueta do comando (INSERT/UPDATE/DELETE: afetadas;
 * SELECT: devolvidas; SET: 0), como o Prisma.
 *
 * Erros. Todo erro do Postgres vira Prisma.PrismaClientKnownRequestError com code 'P2010' e
 * meta { code: SQLSTATE, message: '<severidade>: <mensagem>' + '\nDETAIL: <detalhe>' (se houver)
 * + '\nHINT: <dica>' (se houver) }, o mesmo texto do Display do DbError do tokio-postgres que o Prisma
 * repassa. A severidade vem do servidor ('ERROR', mensagens em inglês: lc_messages = C). Os tradutores
 * (*.erros.ts) só leem a 1ª linha e a linha DETAIL. Conferidos: P0001 com DETAIL (duplicate_client_phone),
 * P0001 PLAN_LIMIT_REACHED:max_imoveis, 42501 (RLS), 22P02, 23502 (DETAIL com a linha inteira), 42883
 * (com HINT), 42P01 e 25P02. Erro que não é do banco sobe como veio.
 *
 * Transação. Igual ao $transaction interativo do Prisma: BEGIN, trabalho, COMMIT; erro → ROLLBACK e o
 * erro original sobe. Um erro do banco engolido dentro do run deixa a transação abortada (25P02 nas
 * consultas seguintes) e o COMMIT vira ROLLBACK sem erro, exatamente como em produção; isso é contado
 * em `transacoes.commitsAbortados` (o falso do Jest não reproduz isso). Usar o tx depois do fim do run
 * dá P2028, como no Prisma. As consultas dentro do run são serializadas (o PGlite tem uma conexão só);
 * runs simultâneos esperam um pelo outro, e um run aberto DENTRO de outro run trava (em produção seria
 * outra conexão do pool). Fora de $queryRaw/$executeRaw(/Unsafe), qualquer tx.<algo> lança erro.
 *
 * Sessão. TimeZone = 'UTC' (Supabase e Railway são UTC; o PGlite herdaria o fuso da máquina, aqui
 * 'Etc/GMT+3'). Diferenças conhecidas para a produção: PostgreSQL 18.3 em vez do 15/17; now() com
 * precisão de milissegundos; uma conexão só (sem corrida real entre transações).
 *
 * Superusuário. sqlSuperusuario e inserir rodam como `postgres`, fora de RLS e sem a tipagem do
 * Prisma (o PGlite deduz os tipos dos parâmetros), para montar dados de teste. Não chame os dois de
 * dentro de um run: eles esperam o fim da transação e o teste trava.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { type Extension, PGlite, type QueryOptions, type Results, type Transaction } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { type SupabaseClaims, TenantDb } from '../../src/prisma/tenant-db';

// As extensões vêm por require: o package.json do PGlite aponta os tipos de contrib/* para .d.ts ESM, que o TS
// recusa num arquivo CommonJS (TS1479) e nem encontra com moduleResolution node10. Em runtime o .cjs existe.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto') as { pgcrypto: Extension };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp') as { uuid_ossp: Extension };

export const PASTA_MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');

/** user_id (auth.users.id) das contas fixas; v4 e diferentes dos ids "inexistentes" 1111.../2222.../3333... */
export const USUARIO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USUARIO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** max_imoveis do plano da conta A (assinatura 'active'). A conta B fica sem assinatura nenhuma. */
export const LIMITE_IMOVEIS_A = 1000;

export interface ContaTeste {
  userId: string;
  corretorId: string;
  email: string;
  /** Claims no formato do JWT do Supabase (sub, role 'authenticated', aud, email, aal...). */
  claims: SupabaseClaims;
  /** Plano criado para a conta (com o entitlement max_imoveis), ou null se a conta não tem assinatura. */
  planoId: string | null;
}

export interface OpcoesConta {
  userId?: string;
  email?: string;
  nome?: string;
  /** Número: cria plano + entitlement max_imoveis com esse limite + assinatura 'active'. Omitido/null: sem assinatura. */
  limiteImoveis?: number | null;
}

export interface ContagemTransacoes {
  /** run que terminou com COMMIT de verdade. */
  commits: number;
  /** run que terminou com erro (ROLLBACK, erro repassado). */
  rollbacks: number;
  /** run que terminou sem erro, mas com a transação abortada: o COMMIT virou ROLLBACK e nada foi gravado. */
  commitsAbortados: number;
}

/** O pedaço do Prisma que os services usam: o tx de dentro do run (e o client de fora) expõem só isto. */
export interface ClienteSqlFalso {
  $queryRaw<T = unknown>(consulta: Prisma.Sql | TemplateStringsArray, ...valores: unknown[]): Promise<T>;
  $executeRaw(consulta: Prisma.Sql | TemplateStringsArray, ...valores: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string, ...valores: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...valores: unknown[]): Promise<number>;
}

export interface PrismaFalso extends ClienteSqlFalso {
  /** Só a forma interativa: $transaction(async (tx) => ...). */
  $transaction<T>(trabalho: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

export interface BancoTeste {
  pglite: PGlite;
  /** PrismaService falso sobre o PGlite (fora de transação roda como superusuário, como a conexão da API). */
  prisma: PrismaFalso;
  /** O TenantDb real de src/prisma/tenant-db.ts sobre o PrismaService falso. Passe para `new XService(banco.db)`. */
  db: TenantDb;
  contaA: ContaTeste;
  contaB: ContaTeste;
  claimsA: SupabaseClaims;
  claimsB: SupabaseClaims;
  corretorA: string;
  corretorB: string;
  /** Contadores acumulados de todos os runs deste banco. */
  transacoes: ContagemTransacoes;
  /** SQL livre como superusuário (sem RLS). Os valores das linhas saem já convertidos como o Prisma faria. */
  sqlSuperusuario<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Insere UMA linha como superusuário e devolve to_jsonb da linha gravada. Colunas omitidas ficam com o
   * default do banco. `semGatilhos` desliga os gatilhos (e a checagem de FK) só neste insert, com
   * session_replication_role = replica (ex.: imóvel da conta B, que não tem plano). `tabela` aceita
   * 'clientes' (public) ou 'schema.tabela'.
   */
  inserir(tabela: string, dados: Record<string, unknown>, opcoes?: { semGatilhos?: boolean }): Promise<Record<string, unknown>>;
  /** Cria mais uma conta pelo gatilho de auth.users (o corretor e as 9 etapas do funil vêm dos gatilhos). */
  criarConta(opcoes?: OpcoesConta): Promise<ContaTeste>;
  fechar(): Promise<void>;
}

// ---------------------------------------------------------------- tipos do Postgres

const OID = {
  bool: 16, bytea: 17, char: 18, name: 19, int8: 20, int2: 21, int4: 23, text: 25, oid: 26, json: 114, xml: 142,
  cidr: 650, float4: 700, float8: 701, unknown: 705, money: 790, inet: 869, bpchar: 1042, varchar: 1043, date: 1082,
  time: 1083, timestamp: 1114, timestamptz: 1184, timetz: 1266, bit: 1560, varbit: 1562, numeric: 1700, uuid: 2950,
  jsonb: 3802,
} as const;

/** Tipos que o Prisma desserializa numa linha de $queryRaw (além de enum e de array desses). */
const ESCALARES_DO_PRISMA = new Set<number>(Object.values(OID));
const TEXTO_POR_NOME = new Set(['citext', 'ltree', 'lquery', 'ltxtquery']);
const ARRAY_DE: Record<number, number> = {
  [OID.text]: 1009, [OID.int8]: 1016, [OID.numeric]: 1231, [OID.bool]: 1000, [OID.timestamptz]: 1185,
  [OID.jsonb]: 3807, [OID.bytea]: 1001,
};

interface InfoTipo { typname: string; typtype: string; typcategory: string; typelem: number }
type CatalogoTipos = Map<number, InfoTipo>;

const SQL_TIPOS = `select oid::int as oid, typname::text as typname, typtype::text as typtype,
  typcategory::text as typcategory, typelem::int as typelem from pg_catalog.pg_type`;

async function carregarTipos(alvo: Executor, catalogo: CatalogoTipos, oid?: number): Promise<void> {
  const r = await alvo.query<InfoTipo & { oid: number }>(oid === undefined ? SQL_TIPOS : `${SQL_TIPOS} where oid = $1::int`, oid === undefined ? [] : [oid]);
  for (const { oid: o, ...info } of r.rows) catalogo.set(o, info);
}

function suportadoPeloPrisma(oid: number, catalogo: CatalogoTipos): boolean {
  if (ESCALARES_DO_PRISMA.has(oid)) return true;
  const t = catalogo.get(oid);
  if (!t) return false;
  if (t.typtype === 'e' || TEXTO_POR_NOME.has(t.typname)) return true;
  return t.typcategory === 'A' && t.typelem !== 0 && suportadoPeloPrisma(t.typelem, catalogo);
}

// ---------------------------------------------------------------- parâmetros (como o Prisma tipa)

function tipoEscalar(v: unknown): number {
  if (v === null || v === undefined) return 0;
  switch (typeof v) {
    case 'string': return OID.text;
    case 'boolean': return OID.bool;
    case 'bigint': return OID.int8;
    case 'number': return !Number.isFinite(v) ? 0 : Number.isInteger(v) ? OID.int8 : OID.numeric;
    default: break;
  }
  if (v instanceof Date) return OID.timestamptz;
  if (Prisma.Decimal.isDecimal(v)) return OID.numeric;
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) return OID.bytea;
  if (typeof v === 'object') return OID.jsonb;
  return 0;
}

function tipoDoParametro(v: unknown): number {
  if (!Array.isArray(v)) return tipoEscalar(v);
  const tipos = new Set(v.filter((x) => x !== null && x !== undefined).map((x) => (Array.isArray(x) ? -1 : tipoEscalar(x))));
  if (tipos.size !== 1) return 0;
  const [t] = [...tipos];
  return ARRAY_DE[t] ?? 0;
}

/** O que o Prisma manda pelo fio: undefined/NaN/Infinity viram null (JSON), Decimal vira texto. */
function valorDoParametro(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  if (Array.isArray(v)) return v.map(valorDoParametro);
  if (Prisma.Decimal.isDecimal(v)) return v.toString();
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

// ---------------------------------------------------------------- linhas (como o Prisma devolve)

const INSTANTE = /^(\d{4,})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)?$/;

/** Texto do Postgres (DateStyle ISO) → Date. Sem fuso é UTC, como o Prisma lê `timestamp`. */
function instante(x: string): Date {
  const m = INSTANTE.exec(x);
  if (!m) return new Date(x); // infinity, BC: fora do que o Prisma representa
  const [, ano, mes, dia, h, mi, s, frac = '', sinal, oh = '0', om = '0', os = '0'] = m;
  const d = new Date(0);
  d.setUTCFullYear(Number(ano), Number(mes) - 1, Number(dia));
  d.setUTCHours(Number(h), Number(mi), Number(s), Number(frac.padEnd(3, '0').slice(0, 3)));
  const deslocamento = sinal ? (sinal === '-' ? -1 : 1) * (Number(oh) * 3600 + Number(om) * 60 + Number(os)) * 1000 : 0;
  return new Date(d.getTime() - deslocamento);
}

function instalarConversoesDoPrisma(pg: PGlite): void {
  const p = pg.parsers;
  p[OID.int8] = (x: string) => BigInt(x);
  p[OID.oid] = (x: string) => BigInt(x);
  p[OID.numeric] = (x: string) => new Prisma.Decimal(x);
  p[OID.money] = (x: string) => new Prisma.Decimal(x.replace(/[^0-9.-]/g, ''));
  p[OID.date] = (x: string) => instante(`${x} 00:00:00`);
  p[OID.timestamp] = (x: string) => instante(x);
  p[OID.timestamptz] = (x: string) => instante(x);
  p[OID.time] = (x: string) => instante(`1970-01-01 ${x}`);
  p[OID.timetz] = (x: string) => instante(`1970-01-01 ${x}`);
}

// ---------------------------------------------------------------- erros (como o Prisma entrega)

interface ErroDoPostgres extends Error { code: string; severity: string; detail?: string; hint?: string }

function ehErroDoPostgres(e: unknown): e is ErroDoPostgres {
  return e instanceof Error && typeof (e as Partial<ErroDoPostgres>).code === 'string' && typeof (e as Partial<ErroDoPostgres>).severity === 'string';
}

function erroP2010(metodo: string, code: string, message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Invalid \`${metodo}()\` invocation:\n\n\nRaw query failed. Code: \`${code}\`. Message: \`${message}\``,
    { code: 'P2010', clientVersion: Prisma.prismaVersion.client, meta: { code, message } },
  );
}

function paraErroDoPrisma(e: unknown, metodo: string): unknown {
  if (!ehErroDoPostgres(e)) return e;
  let message = `${e.severity}: ${e.message}`;
  if (e.detail) message += `\nDETAIL: ${e.detail}`;
  if (e.hint) message += `\nHINT: ${e.hint}`;
  return erroP2010(metodo, e.code, message);
}

function transacaoFechada(metodo: string): Prisma.PrismaClientKnownRequestError {
  const error = 'Transaction already closed: A query cannot be executed on a closed transaction.';
  return new Prisma.PrismaClientKnownRequestError(`Invalid \`${metodo}()\` invocation:\n\n\nTransaction API error: ${error}`, {
    code: 'P2028', clientVersion: Prisma.prismaVersion.client, meta: { error },
  });
}

// ---------------------------------------------------------------- execução

interface Executor {
  query<T>(query: string, params?: unknown[], options?: QueryOptions): Promise<Results<T>>;
}

interface Consulta { text: string; values: unknown[] }

function consultaDe(metodo: string, primeiro: unknown, resto: unknown[]): Consulta {
  if (Array.isArray(primeiro) && 'raw' in primeiro) {
    const sql = Prisma.sql(primeiro as unknown as TemplateStringsArray, ...(resto as Prisma.Sql[]));
    return { text: sql.text, values: sql.values };
  }
  // Prisma.Sql só existe como tipo no namespace Prisma: o objeto é reconhecido por .text e .values.
  if (typeof primeiro === 'object' && primeiro !== null
    && typeof (primeiro as Consulta).text === 'string' && Array.isArray((primeiro as Consulta).values)) {
    if (resto.length > 0) throw new TypeError(`${metodo}: passe só o Prisma.sql, sem valores soltos.`);
    return { text: (primeiro as Consulta).text, values: (primeiro as Consulta).values };
  }
  throw new TypeError(`${metodo} é uma tag function: use ${metodo}\`...\` ou ${metodo}(Prisma.sql\`...\`).`);
}

function criarClienteSql(alvo: Executor, prefixo: string, catalogo: CatalogoTipos, aberto: () => boolean): ClienteSqlFalso {
  async function rodar(metodo: string, consulta: Consulta): Promise<Results<Record<string, unknown>>> {
    if (!aberto()) throw transacaoFechada(metodo);
    try {
      return await alvo.query<Record<string, unknown>>(consulta.text, consulta.values.map(valorDoParametro), {
        paramTypes: consulta.values.map(tipoDoParametro),
      });
    } catch (e) {
      throw paraErroDoPrisma(e, metodo);
    }
  }

  async function linhas<T>(metodo: string, consulta: Consulta): Promise<T> {
    const r = await rodar(metodo, consulta);
    // O Prisma converte linha a linha: sem linha, tipo não suportado não chega a falhar.
    for (const campo of r.rows.length > 0 ? r.fields : []) {
      if (!catalogo.has(campo.dataTypeID) && !ESCALARES_DO_PRISMA.has(campo.dataTypeID)) await carregarTipos(alvo, catalogo, campo.dataTypeID);
      if (!suportadoPeloPrisma(campo.dataTypeID, catalogo)) {
        const tipo = catalogo.get(campo.dataTypeID)?.typname ?? String(campo.dataTypeID);
        throw erroP2010(metodo, 'N/A', `Failed to deserialize column of type '${tipo}'. If you're using $queryRaw and this column is explicitly marked as \`Unsupported\` in your Prisma schema, try casting this column to any supported Prisma type such as \`String\`.`);
      }
    }
    return r.rows as T;
  }

  async function contagem(metodo: string, consulta: Consulta): Promise<number> {
    const r = await rodar(metodo, consulta);
    return r.rowCount ?? r.affectedRows ?? 0;
  }

  return {
    $queryRaw: <T>(c: Prisma.Sql | TemplateStringsArray, ...v: unknown[]) => linhas<T>(`${prefixo}.$queryRaw`, consultaDe(`${prefixo}.$queryRaw`, c, v)),
    $executeRaw: (c: Prisma.Sql | TemplateStringsArray, ...v: unknown[]) => contagem(`${prefixo}.$executeRaw`, consultaDe(`${prefixo}.$executeRaw`, c, v)),
    $queryRawUnsafe: <T>(sql: string, ...v: unknown[]) => linhas<T>(`${prefixo}.$queryRawUnsafe`, { text: sql, values: v }),
    $executeRawUnsafe: (sql: string, ...v: unknown[]) => contagem(`${prefixo}.$executeRawUnsafe`, { text: sql, values: v }),
  };
}

/** Qualquer outra coisa no tx (tx.imoveis, tx.$transaction...) falha alto: as rotas novas só usam SQL cru. */
function soSqlCru<T extends object>(alvo: T): T {
  return new Proxy(alvo, {
    get(t, p, r) {
      if (typeof p === 'symbol' || p === 'then' || p === 'toJSON' || p === 'constructor' || p in t) return Reflect.get(t, p, r);
      throw new Error(`tx.${p} não existe no banco de teste: as rotas novas só usam tx.$queryRaw e tx.$executeRaw (contrato §0.2).`);
    },
  });
}

function criarPrismaFalso(pg: PGlite, catalogo: CatalogoTipos, transacoes: ContagemTransacoes): PrismaFalso {
  const fora = criarClienteSql(pg, 'prisma', catalogo, () => true);
  return {
    ...fora,
    async $transaction<T>(trabalho: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      if (typeof trabalho !== 'function') throw new TypeError('PrismaFalso: só o $transaction interativo, $transaction(async (tx) => ...).');
      let aberta = true;
      let abortada = false;
      try {
        const resultado = await pg.transaction(async (ptx: Transaction) => {
          const tx = soSqlCru(criarClienteSql(ptx, 'tx', catalogo, () => aberta)) as unknown as Prisma.TransactionClient;
          try {
            const r = await trabalho(tx);
            // O Prisma manda COMMIT sem olhar; numa transação abortada o Postgres responde ROLLBACK sem erro.
            try {
              await ptx.query('select 1');
            } catch (e) {
              if (!ehErroDoPostgres(e) || e.code !== '25P02') throw e;
              abortada = true;
            }
            return r;
          } finally {
            aberta = false;
          }
        });
        if (abortada) transacoes.commitsAbortados += 1;
        else transacoes.commits += 1;
        return resultado;
      } catch (e) {
        transacoes.rollbacks += 1;
        throw paraErroDoPrisma(e, 'prisma.$transaction');
      }
    },
  };
}

// ---------------------------------------------------------------- fixture

async function criarContaNoBanco(pg: PGlite, opcoes: OpcoesConta = {}): Promise<ContaTeste> {
  const userId = opcoes.userId ?? randomUUID();
  const email = opcoes.email ?? `${userId.slice(0, 8)}@teste.lotti.local`;
  const nome = opcoes.nome ?? 'Conta de teste';
  await pg.query(
    `insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     values ($1::uuid, 'authenticated', 'authenticated', $2::text, now(), $3::jsonb, $4::jsonb)`,
    [userId, email, JSON.stringify({ provider: 'email', providers: ['email'] }), JSON.stringify({ nome })],
  );
  const corretor = await pg.query<{ id: string }>('select id::text as id from public.corretores where user_id = $1::uuid', [userId]);
  const corretorId = corretor.rows[0]?.id;
  if (!corretorId) throw new Error('o gatilho on_auth_user_created não criou o corretor');

  let planoId: string | null = null;
  if (opcoes.limiteImoveis !== undefined && opcoes.limiteImoveis !== null) {
    const plano = await pg.query<{ id: string }>(
      `insert into public.plans (code, name, monthly_price, annual_price) values ($1::text, $2::text, 0, 0) returning id::text as id`,
      [`teste-${userId}`, `Plano de teste (${opcoes.limiteImoveis} imóveis)`],
    );
    planoId = plano.rows[0].id;
    await pg.query(
      `insert into public.plan_entitlements (plan_id, feature_key, feature_name, enabled, limit_value, unlimited)
       values ($1::uuid, 'max_imoveis', 'Imóveis ativos', true, $2::int, false)`,
      [planoId, opcoes.limiteImoveis],
    );
    await pg.query(
      `insert into public.subscriptions (corretor_id, plan_id, status, current_period_start, current_period_end)
       values ($1::uuid, $2::uuid, 'active', now(), now() + interval '30 days')`,
      [corretorId, planoId],
    );
  }

  const claims: SupabaseClaims = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    email,
    aal: 'aal1',
    is_anonymous: false,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { nome },
  };
  return { userId, corretorId, email, claims, planoId };
}

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

/**
 * Sobe um banco novo (≈3 s): PGlite com pgcrypto e uuid_ossp, TimeZone UTC, todas as migrations em ordem,
 * conversões do Prisma e as contas A (plano com max_imoveis = LIMITE_IMOVEIS_A) e B (sem plano: imóvel → 402).
 * Cada chamada é um banco isolado; feche com `fechar()`.
 */
export async function criarBanco(): Promise<BancoTeste> {
  const pglite = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await pglite.waitReady;
  await pglite.exec(`do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'UTC'); end $$;
    set timezone to 'UTC';`);
  const migrations = readdirSync(PASTA_MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const nome of migrations) await pglite.exec(readFileSync(join(PASTA_MIGRATIONS, nome, 'migration.sql'), 'utf8'));
  // Os arrays de tipos criados pelas migrations (enum[]) só são reconhecidos depois disto.
  await pglite.refreshArrayTypes();
  const catalogo: CatalogoTipos = new Map();
  await carregarTipos(pglite, catalogo);
  instalarConversoesDoPrisma(pglite);

  const transacoes: ContagemTransacoes = { commits: 0, rollbacks: 0, commitsAbortados: 0 };
  const prisma = criarPrismaFalso(pglite, catalogo, transacoes);
  const db = new TenantDb(prisma as unknown as PrismaService);

  const contaA = await criarContaNoBanco(pglite, { userId: USUARIO_A, email: 'conta-a@teste.lotti.local', nome: 'Corretora A', limiteImoveis: LIMITE_IMOVEIS_A });
  const contaB = await criarContaNoBanco(pglite, { userId: USUARIO_B, email: 'conta-b@teste.lotti.local', nome: 'Corretor B' });

  return {
    pglite,
    prisma,
    db,
    contaA,
    contaB,
    claimsA: contaA.claims,
    claimsB: contaB.claims,
    corretorA: contaA.corretorId,
    corretorB: contaB.corretorId,
    transacoes,
    async sqlSuperusuario<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      return (await pglite.query<T>(sql, params)).rows;
    },
    async inserir(tabela, dados, opcoes = {}) {
      const partes = tabela.split('.');
      if (partes.length > 2 || !partes.every((p) => IDENTIFICADOR.test(p))) throw new Error(`tabela inválida: ${tabela}`);
      const alvo = partes.length === 2 ? tabela : `public.${tabela}`;
      const cols = Object.keys(dados).filter((c) => dados[c] !== undefined);
      const invalida = cols.find((c) => !IDENTIFICADOR.test(c));
      if (invalida) throw new Error(`coluna inválida: ${invalida}`);
      const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, dados[c]])), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      const sql = cols.length === 0
        ? `insert into ${alvo} as t default values returning to_jsonb(t) as linha`
        : `insert into ${alvo} as t (${cols.join(', ')}) select ${cols.map((c) => `r.${c}`).join(', ')}
           from jsonb_populate_record(null::${alvo}, $1::jsonb) r returning to_jsonb(t) as linha`;
      const params = cols.length === 0 ? [] : [json];
      const r = opcoes.semGatilhos
        ? await pglite.transaction(async (t) => {
          await t.exec('set local session_replication_role = replica');
          return t.query<{ linha: Record<string, unknown> }>(sql, params);
        })
        : await pglite.query<{ linha: Record<string, unknown> }>(sql, params);
      return r.rows[0].linha;
    },
    criarConta: (opcoes) => criarContaNoBanco(pglite, opcoes),
    fechar: () => pglite.close(),
  };
}

/** Espera um HttpException (o que os services lançam) e devolve status e corpo; qualquer outro erro sobe. */
export async function capturarErroHttp(promessa: Promise<unknown>): Promise<{ status: number; corpo: Record<string, unknown> }> {
  try {
    await promessa;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), corpo: e.getResponse() as Record<string, unknown> };
    throw e;
  }
  throw new Error('era esperado um HttpException, mas a promessa resolveu');
}
