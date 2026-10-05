# Contrato da API Lotti: fase 4, módulo 2 (imóveis e CRM)

Quatro frentes trabalham em paralelo e cada uma só toca os próprios arquivos. Tudo o que elas precisam combinar está fixado aqui: caminhos, DTOs, formato de resposta, códigos de erro e nomes das funções do front. Nenhuma frente precisa falar com outra.

**Revisão 3.** Esta versão resolve as quatro lacunas da revisão 2:
1. **Venda:** o savepoint saiu. O imóvel é gravado num `run` e confirmado. O cliente vai depois, num segundo `run`, em melhor esforço como hoje (§1). Nenhuma rota captura mais erro do banco dentro do `run` (§0.2). A fumaça do §5 também passa a fazer uma venda de ponta a ponta.
2. **uuid:** a URL, o corpo e o front usam uma regra só (`FORMATO_UUID`, §0.2). `IsUUID` não aparece em nenhum DTO. As fixtures têm de estar no formato v4, e cada controller tem um caso que prova a paridade (§0.5).
3. **Histórico:** `POST /api/clientes/:id/historico` grava sem RETURNING e monta a resposta com `now()` (§2). A pendência da migration manda aplicar o mesmo critério em INSERT e SELECT (§7.2.1).
4. **Excluir negócios:** o teto sobe para `LIMITE_LISTA` (1000), o mesmo da lista. Assim qualquer seleção possível no CrmPipeline cabe na chamada (§3, §6.11). A falta de onError ficou registrada como pendência (§7.2).

Três pontos de revisões anteriores continuam valendo:
- os testes leem `.text`, e não `.sql`, porque em `.sql` os parâmetros aparecem como `?`;
- o `CrmPipeline` só importa a API por import dinâmico (§4.4);
- `ativo` e `anunciado` não aceitam null.

---

## 0. Regras comuns às quatro frentes

### 0.1 Quem é dono de quê

| Frente | Arquivos (só estes) |
|---|---|
| **A** api-imoveis | edita `api/src/imoveis/imoveis.controller.ts`, `imoveis.module.ts` e `imoveis.controller.spec.ts`; cria `imoveis-gestao.service.ts`, `imoveis-gestao.dto.ts`, `imoveis.erros.ts`, `imoveis-gestao.service.spec.ts` e `imoveis-gestao.controller.spec.ts`. NÃO mexe em `imoveis.service.ts`, `busca-imoveis.dto.ts` nem `imoveis.service.spec.ts` (a busca fica como está). |
| **B** api-crm-clientes | cria em `api/src/crm/clientes/`: `crm-clientes.module.ts` (classe `CrmClientesModule`), `crm-clientes.controller.ts`, `crm-clientes.service.ts`, `crm-clientes.dto.ts`, `crm-clientes.erros.ts`, `crm-clientes.service.spec.ts` e `crm-clientes.controller.spec.ts`. |
| **C** api-crm-funil | cria em `api/src/crm/funil/`: `crm-funil.module.ts` (classe `CrmFunilModule`), `crm-funil.controller.ts`, `crm-funil.service.ts`, `crm-funil.dto.ts`, `crm-funil.erros.ts`, `crm-funil.service.spec.ts` e `crm-funil.controller.spec.ts`. |
| **D** front | cria `src/lib/api/http.ts`, `src/lib/api/imoveis.ts` e `src/lib/api/crm.ts`, com os testes `src/lib/api/http.test.ts`, `src/lib/api/imoveis.test.ts`, `src/lib/api/crm.test.ts`, `src/stores/crmStore.api.test.ts` e `src/hooks/crm/useCrm.api.test.tsx`. Edita os adaptadores em `src/stores/crmStore.ts`, `src/hooks/crm/useCrm.ts`, `src/components/crm/CrmPipeline.tsx`, `src/lib/crm/cadastroCliente.ts`, `src/features/whatsapp-inbox/ConnectedInbox.tsx`, `src/components/imoveis/NovoImovelDialog.tsx`, `src/pages/ImovelDetalhes.tsx`, `src/components/imoveis/VendaImovelDialog.tsx` e `src/components/clientes/SeletorImovel.tsx`. |

Nenhuma frente edita estes arquivos:
- `api/src/app.module.ts`: quem liga os módulos é a integração (§5);
- `api/src/prisma/*`, `api/src/auth/*`, `api/prisma/*`, `api/src/main.ts`, `src/lib/api.ts`, `src/lib/crm/duplicidade.ts`, `src/lib/errors.ts`, `AI_HANDOFF.md` e `docs/*`;
- qualquer arquivo citado em §7.1 (fora do escopo). Esses continuam falando com o Supabase como hoje.

Também valem para todas:
- nenhuma migration;
- nada de `prisma migrate`, `db push`, `db pull` ou `migrate reset`;
- nada de commit, stash ou troca de branch.

### 0.2 Acesso ao banco (A, B, C)

**Toda consulta de usuário passa pelo TenantDb.** Use `this.db.run(claims, (tx) => ...)`. Nas rotas novas, nunca use `this.prisma.<modelo>` nem `tx.<modelo>`.

**O SQL vai sempre por `tx.$queryRaw(Prisma.sql`...`)`.** Assim os testes leem `.text` e `.values` do objeto passado.
- A única exceção é o insert do histórico (frente B). Ele usa `tx.$executeRaw(Prisma.sql`...`)` porque não tem RETURNING (§2), e o objeto passado tem os mesmos `.text` e `.values`.
- Nenhuma rota usa `$executeRawUnsafe` nem `$queryRawUnsafe`.

O SQL cru tem dois motivos, ambos conferidos com Prisma 6.19.3 contra um Postgres 17 local:

1. **Formato igual ao do PostgREST.** `to_jsonb(linha)` já devolve as chaves em snake_case e os tipos do jeito que o PostgREST entrega:

   | Tipo no banco | Como sai |
   |---|---|
   | numeric | número JSON (450000.5) |
   | date | `'YYYY-MM-DD'` |
   | timestamptz | com microssegundos e fuso: `'2026-10-04T12:34:56.123456+00:00'`. O fuso segue o `TimeZone` do servidor, que é UTC no Supabase e no Railway; as comparações não dependem dele. |
   | jsonb | objeto |

   A API devolve esse objeto sem transformar nada.
2. **Erro do Postgres legível.** Todo erro chega como `PrismaClientKnownRequestError` com código `P2010`:
   - `meta.code` traz o SQLSTATE;
   - `meta.message` traz `'ERROR: <mensagem>\nDETAIL: <detalhe>'`. O prefixo muda com o idioma do servidor (`ERROR:` ou `ERRO:`);
   - o DETAIL do RAISE chega intacto. É ele que traz o uuid em `duplicate_client_phone`.

**Parâmetros e casts.** Todo valor que entra no SQL por `${...}` é parâmetro e leva cast explícito, sem exceção:

| Valor | Forma |
|---|---|
| uuid | `${id}::uuid` |
| lista de uuid | `${ids}::uuid[]` |
| inteiro (inclusive o teto de lista e a ordem da etapa) | `${n}::int` |
| booleano | `${b}::boolean` |
| texto, inclusive quando é null (nome, cor e tipo da etapa, cpf, conteúdo, tipo e direção do histórico na resposta, filtros de candidatos, corretor resolvido) | `${t}::text` |
| JSON | `${json}::jsonb` |
| token do mover | `${updated_at}::timestamptz` |
| enum | `${v}::public.status_funil`, `::public.canal_contato`, `::public.direcao_contato` |

- Valores escritos no próprio SQL (`'VENDIDO'`, `'FECHADO_GANHO'`, `true`, `now()`) não são parâmetros e não levam cast.
- Nomes de coluna entram por `Prisma.raw`, e só a partir de constantes. Também não são parâmetros.
- O teto de lista entra sempre como `limit ${LIMITE_LISTA}::int`, nunca como `limit 1000` escrito à mão.
- Contagens usam `count(*)::int`.
- Os testes conferem os casts em `.text`, onde os parâmetros aparecem como `$1..$n`.

**Formato de uuid: uma regra só para a URL, o corpo e o front.**
- A regra:
  ```ts
  /** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
  const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  ```
  É a regex `all` do `ParseUUIDPipe` (conferida em `api/node_modules/@nestjs/common/pipes/parse-uuid.pipe.js`). É também o `UUID` privado de `src/lib/crm/duplicidade.ts:40` e a regex que o `CrmPipeline` declara (§4.4).
- **Na URL:** `ParseUUIDPipe` sem versão, que já aplica essa regra.
- **No corpo:** `@Matches(FORMATO_UUID, { message })`, com `each: true` nas listas. `Matches` recusa qualquer valor que não seja string.
- **`IsUUID` não é usado em nenhum DTO.** No validator 13.15.35, `IsUUID('all')` exige versão de 1 a 8 e variante 8/9/a/b. Ele recusa `'11111111-1111-1111-1111-111111111111'`, que a URL aceita, e isso criaria duas regras.
- **Por que a regra larga.** As colunas uuid do banco aceitam qualquer valor nesse formato, e nada garante que todo id existente veio de `gen_random_uuid()` (cargas, dados de exemplo, cópias). Com regra estrita no corpo, um registro que existe levaria 400 ('Etapa inválida.', 'Imóvel inválido.') mesmo com a URL e o front aceitando o mesmo id.
- Cada frente declara `FORMATO_UUID` no próprio arquivo de DTO. O código das §1 a §3 já traz a declaração.
- As fixtures e o teste de paridade estão na §0.5.

**Criação e escrita parcial usam `jsonb_populate_record(null::public.<tabela>, $json::jsonb)`.** É a mesma conversão de tipos que o PostgREST faz (enum, numeric, date).
- A lista de colunas vem só de constantes do service e entra no SQL por `Prisma.raw`. Nunca vem de chave enviada pelo cliente.
- Com target ES2022, toda propriedade declarada no DTO existe como chave própria com valor `undefined`. Por isso o filtro abaixo compara com `!== undefined`.
- `null` é mantido e grava NULL.

Modelo (use igual):

```ts
function presentes<T extends string>(dados: object, permitidas: readonly T[]): T[] {
  return permitidas.filter((c) => (dados as Record<string, unknown>)[c] !== undefined);
}
// dentro do run:
const cols = presentes(dto, COLUNAS_EDICAO);
if (cols.length === 0) throw erroApi(400, 'nada_para_atualizar', 'Nada para atualizar.');
const json = JSON.stringify(Object.fromEntries(cols.map((c) => [c, (dto as Record<string, unknown>)[c]])));
const alvo = Prisma.raw(cols.join(', '));
const origem = Prisma.raw(cols.map((c) => `r.${c}`).join(', '));
const linhas = await tx.$queryRaw<Array<{ linha: Record<string, unknown> }>>(Prisma.sql`
  update public.imoveis t set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.imoveis, ${json}::jsonb) r)
  where t.id = ${id}::uuid returning to_jsonb(t) as linha`);
// criação: insert into public.<tabela> as x (corretor_id, ${alvo}) select ${corretorId}::uuid, ${origem} from jsonb_populate_record(null::public.<tabela>, ${json}::jsonb) r returning to_jsonb(x) as linha
```

O `set (col) = (select ...)` funciona também com uma coluna só (conferido em PG17).

**`corretor_id` nunca vem do cliente.**
- Se vier no corpo, o ValidationPipe (forbidNonWhitelisted) recusa com 400.
- Quando a linha nova precisa dele, use `select public.get_corretor_id()::text as id` no mesmo `run`.
- Se vier null: `403 { codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' }`.

**Listagens** não filtram por corretor. Quem decide é o RLS, exatamente como no PostgREST hoje, incluindo as policies "routine organization: ... read". O teto é `LIMITE_LISTA = 1000`, o mesmo max_rows padrão do PostgREST. Toda ordenação desempata por `id`.

**Erro dentro do `run` aborta a transação (25P02).**
- Nunca capture um erro do banco para seguir dentro do `run`. Não há exceção. Depois de um erro, o Postgres marca a transação como abortada, e o COMMIT do fim do `run` vira ROLLBACK sem erro nenhum: a rota responderia sucesso sem ter gravado nada. O TenantDb falso dos testes não reproduz isso, então só a regra protege.
- Um passo de melhor esforço vai num segundo `run`, que só começa depois do primeiro confirmado. O erro dele é capturado fora do `run`. Hoje só o cliente da venda é assim (§1).
- Traduza o erro fora do `run`: `try { return await this.db.run(...) } catch (e) { traduzirErroBanco(e, opcoes) }`.
- Uma HttpException lançada dentro do `run` (404, 409 etc.) passa intacta pelo tradutor.

**Logs:**
- nunca registrar nome, telefone, e-mail, CPF, conteúdo de mensagem ou `meta.message` (o texto do Postgres pode trazer a linha inteira, como no 23502);
- registrar só SQLSTATE e código.

**Estrutura do Nest:**
- `@UseGuards(SupabaseAuthGuard)` no controller e `@Claims() claims: SupabaseClaims` em cada rota.
- O módulo declara `providers: [Service, SupabaseAuthGuard]`. O `TenantDb` vem do PrismaModule global.
- Os ids de rota passam por `new ParseUUIDPipe({ exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.') })`.
- Rotas estáticas vêm declaradas ANTES das rotas com `:id`.
- Status de sucesso: DELETE usa `@HttpCode(204)`; POST que não cria registro usa `@HttpCode(200)`.

### 0.3 Formato de erro HTTP (todas as rotas novas)

Corpo: `{ statusCode, codigo, message, ...extras }`, montado com `new HttpException(corpo, status)`.
- `message` é sempre texto em português para o usuário.
- `extras` pode trazer:
  - `detalhe`: uuid do cliente que já tem o telefone;
  - `sqlstate`: `'23503'` nos bloqueios por contrato;
  - `recurso`: `'max_imoveis'`.

O 400 de validação continua sendo o do ValidationPipe: `{ statusCode: 400, message: string[], error }`.

**Decisão sobre mensagens (vale para A, B e C):**
- Todo decorator de validação leva `{ message: '<português>' }`: IsString, IsNotEmpty, MaxLength, IsIn, IsNumber, IsInt, Min, Max, IsBoolean, IsISO8601, IsObject, Matches (inclusive os de `FORMATO_UUID`), IsArray, ArrayMinSize, ArrayMaxSize e ValidateNested.
- `IsOptional`, `ValidateIf` e `Type` não validam nada e não levam mensagem.
- O código das §1 a §3 já está completo assim: copie literalmente. Sem mensagem, o class-validator responde em inglês ('dormitorios must not be greater than 999'), e o front mostraria esse texto.

O ValidationPipe tem três efeitos que o front trata e os testes fixam:
1. **Itens de lista.** O erro de um item de lista vem com o caminho na frente: `'etapas.0.Informe o nome da etapa.'`. O `lerErroApi` (§4.1) tira o prefixo.
2. **Mensagens repetidas.** Dois decorators que falham juntos repetem o texto (IsString e IsNotEmpty com a mesma mensagem). O `lerErroApi` tira as repetições.
3. **Chave desconhecida.** Uma chave fora do DTO gera `'property x should not exist'`, em inglês, e não há decorator que troque esse texto. Só acontece se o front mandar chave fora do DTO, o que o `escolher` (§4.1) impede. Os testes de controller conferem o 400, não o texto.

### 0.4 Tradutor de erros do banco

O código abaixo vai **idêntico** em `api/src/imoveis/imoveis.erros.ts` (A), `api/src/crm/clientes/crm-clientes.erros.ts` (B) e `api/src/crm/funil/crm-funil.erros.ts` (C). Juntar os três num arquivo só ficou como pendência (§7.2).

```ts
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Erro do Postgres que o Prisma embrulha em P2010 nas consultas $queryRaw/$executeRaw. */
export interface ErroPg {
  sqlstate: string;
  mensagem: string; // primeira linha, sem "ERROR: "/"ERRO: "
  detalhe: string | null; // DETAIL do RAISE
  bruto: string; // meta.message inteira: só para testar padrão, nunca para responder ou logar
}

export function erroPg(e: unknown): ErroPg | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2010') return null;
  const meta = (e.meta ?? {}) as { code?: unknown; message?: unknown };
  if (typeof meta.code !== 'string') return null;
  const bruto = typeof meta.message === 'string' ? meta.message : '';
  const linhas = bruto.split('\n');
  const mensagem = (linhas[0] ?? '').replace(/^[A-ZÀ-Ý]+:\s+/, '').trim();
  const linhaDetalhe = linhas.find((l) => /^(DETAIL|DETALHE):/.test(l));
  const detalhe = linhaDetalhe ? linhaDetalhe.replace(/^(DETAIL|DETALHE):\s*/, '').trim() || null : null;
  return { sqlstate: meta.code, mensagem, detalhe, bruto };
}

export function erroApi(status: number, codigo: string, message: string, extra: Record<string, unknown> = {}): HttpException {
  return new HttpException({ statusCode: status, codigo, message, ...extra }, status);
}

export interface OpcoesErro {
  entidade?: 'imovel' | 'cliente'; // liga o bloqueio por contrato (23503)
  forbidden?: string;
  semPermissao?: string;
  repetido?: string;
}

const ROTULO = { imovel: 'imóvel', cliente: 'cliente' } as const;
const DADOS_INVALIDOS = new Set(['22P02', '22007', '22008', '22003', '22001', '23502', '23514']);

/** Responde com texto em português. Nunca repassa o texto do Postgres. Erro que não é do banco sobe como veio. */
export function traduzirErroBanco(e: unknown, op: OpcoesErro = {}): never {
  const pg = erroPg(e);
  if (!pg) throw e;
  const { sqlstate, mensagem, detalhe, bruto } = pg;
  if (sqlstate === 'P0001') {
    if (mensagem === 'forbidden') throw erroApi(403, 'forbidden', op.forbidden ?? 'Não foi possível identificar a sua conta. Entre novamente.');
    if (mensagem === 'invalid_name') throw erroApi(422, 'invalid_name', 'Informe o nome do cliente.');
    if (mensagem === 'invalid_stage') throw erroApi(422, 'invalid_stage', 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.');
    if (mensagem === 'duplicate_client_phone') throw erroApi(409, 'duplicate_client_phone', 'Este telefone já é de outro cliente do CRM.', { detalhe });
    if (mensagem.startsWith('PLAN_LIMIT_REACHED:')) {
      const recurso = mensagem.slice('PLAN_LIMIT_REACHED:'.length);
      throw erroApi(402, 'PLAN_LIMIT_REACHED', recurso === 'max_imoveis'
        ? 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.'
        : 'Limite do plano atingido. Acesse Plano e Assinatura.', { recurso });
    }
  }
  if (sqlstate === '42501') {
    if (mensagem === 'Atendimento expirado.') throw erroApi(403, 'atendimento_expirado', 'Atendimento expirado.');
    throw erroApi(403, 'sem_permissao', op.semPermissao ?? 'Você não tem permissão para fazer esta alteração.');
  }
  if (sqlstate === '23503') {
    if (op.entidade && /contratos/.test(bruto)) {
      throw erroApi(409, `${op.entidade}_com_contrato`, `Existem contratos vinculados a este ${ROTULO[op.entidade]}.`, { sqlstate: '23503' });
    }
    throw erroApi(422, 'referencia_invalida', 'Um registro relacionado não existe mais. Recarregue a página e tente de novo.');
  }
  if (sqlstate === '23505') throw erroApi(409, 'registro_repetido', op.repetido ?? 'Já existe um registro igual.');
  if (DADOS_INVALIDOS.has(sqlstate)) throw erroApi(400, 'dados_invalidos', 'Dados inválidos. Confira os campos e tente de novo.');
  throw e;
}
```

Resumo da tradução:

| Postgres | HTTP | codigo | message |
|---|---|---|---|
| P0001 `forbidden` | 403 | `forbidden` | `op.forbidden` ou 'Não foi possível identificar a sua conta. Entre novamente.' |
| P0001 `invalid_name` | 422 | `invalid_name` | 'Informe o nome do cliente.' |
| P0001 `invalid_stage` | 422 | `invalid_stage` | 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.' |
| P0001 `duplicate_client_phone` | 409 | `duplicate_client_phone` | 'Este telefone já é de outro cliente do CRM.' (+ `detalhe`: uuid) |
| P0001 `PLAN_LIMIT_REACHED:x` | 402 | `PLAN_LIMIT_REACHED` | 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.' (+ `recurso`) |
| 42501 'Atendimento expirado.' | 403 | `atendimento_expirado` | 'Atendimento expirado.' |
| 42501 (RLS) | 403 | `sem_permissao` | `op.semPermissao` |
| 23503 citando contratos | 409 | `imovel_com_contrato` / `cliente_com_contrato` | 'Existem contratos vinculados a este imóvel/cliente.' (+ `sqlstate: '23503'`) |
| outro 23503 | 422 | `referencia_invalida` | o texto acima |
| 23505 | 409 | `registro_repetido` | `op.repetido` |
| 22P02, 22007, 22008, 22003, 22001, 23502, 23514 | 400 | `dados_invalidos` | 'Dados inválidos. Confira os campos e tente de novo.' |
| qualquer outro | 500 | (o padrão do Nest) | (o front mostra o próprio texto padrão) |

O texto do 409 por contrato contém a palavra "contratos" de propósito: `Clientes.tsx` e `ImovelDetalhes.tsx` testam `e.code === '23503' && /contratos/.test(e.message)`.

### 0.5 Testes da API (A, B, C)

**Service**, com TenantDb falso:

```ts
const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() };
const db = { run: jest.fn(async (_c, w) => w(tx)) };
```
- Confira que `db.run` foi chamado com as claims. Quando a rota usa dois `run` (venda), confira as duas chamadas.
- Leia `tx.$queryRaw.mock.calls[i][0].text` (ou `tx.$executeRaw` no insert do histórico), que traz o SQL com `$1..$n`, e `.values`. Não use `.sql`: nele os parâmetros aparecem como `?`.
- Confira os casts no `.text` (por exemplo `/= \$\d+::uuid/`, `/limit \$\d+::int/`) e os valores em `.values`.
- O falso não simula a transação abortada (25P02). Por isso nenhum teste substitui a regra da §0.2 de não capturar erro dentro do `run`.

**Erro do banco falso:**

```ts
new Prisma.PrismaClientKnownRequestError('x', {
  code: 'P2010',
  clientVersion: 'teste',
  meta: { code: 'P0001', message: 'ERROR: duplicate_client_phone\nDETAIL: 11111111-1111-4111-8111-111111111111' },
});
```

**Fixtures de uuid em formato v4**, em todos os specs da API e em todos os testes do front:
- use `'11111111-1111-4111-8111-111111111111'`, `'22222222-2222-4222-8222-222222222222'`, `'33333333-3333-4333-8333-333333333333'` e assim por diante (terceiro grupo começando com 4 e quarto com 8), como em `notificacoes.spec.ts`;
- assim nenhum teste depende da regra larga para passar, e as frentes não divergem por causa de fixture;
- o formato não v4 só aparece no teste de paridade abaixo.

**Teste de paridade URL x corpo.** Cada `*.controller.spec.ts` tem um caso com o id NÃO v4 `'11111111-1111-1111-1111-111111111111'` ao mesmo tempo na URL e no corpo, e confere que a chamada chega ao service com os dois valores:
- A: `POST /api/imoveis/11111111-1111-1111-1111-111111111111/venda` com `{ cliente_id: '11111111-1111-1111-1111-111111111111' }`;
- B: `PUT /api/clientes/11111111-1111-1111-1111-111111111111/imovel-interesse` com `{ imovel_id: '11111111-1111-1111-1111-111111111111' }`;
- C: `PATCH /api/crm/oportunidades/11111111-1111-1111-1111-111111111111/mover` com `etapa_id` nesse formato, e também `PATCH /api/crm/etapas` com `etapas[0].id` nesse formato.

**Controller:** siga `notificacoes.spec.ts`.
- supertest com o guard sobrescrito;
- `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })`;
- `setGlobalPrefix('api')`;
- service falso com `useValue`;
- pelo menos um caso por DTO conferindo que o array `message` do 400 traz o texto em português.

**Comandos:**
- `cd api && npx jest <pasta>`
- `cd api && npx tsc --noEmit` (considere só os erros dos seus arquivos)

---

## 1. Frente A: api-imoveis (`api/src/imoveis/`)

### Estrutura

- **Controller:** continua um só, `ImoveisController`, em `@Controller('imoveis')`. O construtor passa a ser `constructor(private readonly imoveis: ImoveisService, private readonly gestao: ImoveisGestaoService)`.
- **Ordem de declaração:**
  1. `@Get('busca')`, que já existe e não muda;
  2. `@Get()`;
  3. `@Post()`;
  4. `@Get(':id')`;
  5. `@Get(':id/clientes-interessados')`;
  6. `@Patch(':id')`;
  7. `@Delete(':id')`;
  8. `@Post(':id/venda')`.
- **Módulo:** `providers: [ImoveisService, ImoveisGestaoService, SupabaseAuthGuard]`, `exports: [ImoveisService]`.
- **Service:** `ImoveisGestaoService` recebe `TenantDb` e declara `private readonly logger = new Logger(ImoveisGestaoService.name)`, usado só na venda.
- **Spec existente:** em `imoveis.controller.spec.ts`, acrescente `{ provide: ImoveisGestaoService, useValue: {...} }`. Os testes da busca continuam iguais e passando.
- **Constantes** (em `imoveis-gestao.dto.ts`, importadas pelo service):
  - reaproveite `TIPOS` e `FINALIDADES` de `busca-imoveis.dto.ts`;
  - `LIMITE_LISTA = 1000`;
  - `COLUNAS_CRIACAO = ['titulo','tipo','finalidade','valor','area_m2','dormitorios','garagem','suites','banheiros','endereco','bairro','cidade','proprietario_nome','ativo']`;
  - `COLUNAS_EDICAO = ['titulo','tipo','finalidade','valor','area_m2','dormitorios','garagem','suites','banheiros','endereco','bairro','cidade','proprietario_nome','anunciado']`. `descricao` fica de fora de propósito (§7.1, OrganizarFotosIA).
- **`LinhaImovel`:** `Record<string, unknown>`. São todas as colunas de `to_jsonb(public.imoveis)`, INCLUSIVE `proprietario_*`, porque é rota de gestão do próprio corretor:
  - id, corretor_id, titulo, tipo, valor, area_m2, dormitorios, garagem;
  - endereco, bairro, cidade, estado, cep, descricao, exclusividade_ate;
  - proprietario_nome, proprietario_cpf, proprietario_telefone, proprietario_email;
  - ativo, created_at, updated_at, tracking_data, status_venda, anunciado, finalidade, banheiros, descricao_curta, proprietario_id, suites, is_sample_data.

  A busca (`/busca`) continua sem nada do proprietário.

### DTOs (`imoveis-gestao.dto.ts`)

Duas regras de decorator:
- campo opcional que aceita null: `@IsOptional()`;
- campo opcional que NÃO aceita null: `@ValidateIf(definido)`.

`ativo` e `anunciado` aceitam null no banco, mas não aqui.

```ts
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { FINALIDADES, TIPOS } from './busca-imoveis.dto';

export const LIMITE_LISTA = 1000;
const definido = (_o: unknown, v: unknown) => v !== undefined;
const NUMERO = { allowNaN: false, allowInfinity: false };
/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MSG_TIPO = 'Tipo de imóvel inválido. Use apartamento, casa, comercial ou terreno.';
const MSG_FINALIDADE = 'Finalidade inválida. Use venda, locação ou ambos.';

export class CriarImovelDto {
  @IsString({ message: 'Informe o título do imóvel.' }) @IsNotEmpty({ message: 'Informe o título do imóvel.' }) @MaxLength(300, { message: 'O título pode ter até 300 caracteres.' }) titulo!: string;
  @IsIn(TIPOS, { message: MSG_TIPO }) tipo!: (typeof TIPOS)[number];
  @ValidateIf(definido) @IsIn(FINALIDADES, { message: MSG_FINALIDADE }) finalidade?: (typeof FINALIDADES)[number];
  @IsNumber(NUMERO, { message: 'Informe o valor do imóvel.' }) @Min(0, { message: 'O valor não pode ser negativo.' }) @Max(9999999999999.99, { message: 'Valor muito alto.' }) valor!: number;
  @IsOptional() @IsNumber(NUMERO, { message: 'Área inválida.' }) @Min(0, { message: 'Área inválida.' }) @Max(99999999.99, { message: 'Área inválida.' }) area_m2?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de dormitórios inválida.' }) @Min(0, { message: 'Quantidade de dormitórios inválida.' }) @Max(999, { message: 'Quantidade de dormitórios inválida.' }) dormitorios?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de vagas inválida.' }) @Min(0, { message: 'Quantidade de vagas inválida.' }) @Max(999, { message: 'Quantidade de vagas inválida.' }) garagem?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de suítes inválida.' }) @Min(0, { message: 'Quantidade de suítes inválida.' }) @Max(999, { message: 'Quantidade de suítes inválida.' }) suites?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de banheiros inválida.' }) @Min(0, { message: 'Quantidade de banheiros inválida.' }) @Max(999, { message: 'Quantidade de banheiros inválida.' }) banheiros?: number | null;
  // '' é aceito em endereco, cidade e proprietario_nome: o banco aceita e o NovoImovelDialog manda proprietario_nome ''.
  @IsString({ message: 'Informe o endereço.' }) @MaxLength(500, { message: 'O endereço pode ter até 500 caracteres.' }) endereco!: string;
  @IsOptional() @IsString({ message: 'Bairro inválido.' }) @MaxLength(200, { message: 'O bairro pode ter até 200 caracteres.' }) bairro?: string | null;
  @IsString({ message: 'Informe a cidade.' }) @MaxLength(200, { message: 'A cidade pode ter até 200 caracteres.' }) cidade!: string;
  @IsString({ message: 'Informe o nome do proprietário.' }) @MaxLength(300, { message: 'O nome do proprietário pode ter até 300 caracteres.' }) proprietario_nome!: string;
  @ValidateIf(definido) @IsBoolean({ message: 'Valor inválido para ativo.' }) ativo?: boolean;
}

export class AtualizarImovelDto {
  @ValidateIf(definido) @IsString({ message: 'Informe o título do imóvel.' }) @IsNotEmpty({ message: 'Informe o título do imóvel.' }) @MaxLength(300, { message: 'O título pode ter até 300 caracteres.' }) titulo?: string;
  @ValidateIf(definido) @IsIn(TIPOS, { message: MSG_TIPO }) tipo?: (typeof TIPOS)[number];
  @ValidateIf(definido) @IsIn(FINALIDADES, { message: MSG_FINALIDADE }) finalidade?: (typeof FINALIDADES)[number];
  @ValidateIf(definido) @IsNumber(NUMERO, { message: 'Informe o valor do imóvel.' }) @Min(0, { message: 'O valor não pode ser negativo.' }) @Max(9999999999999.99, { message: 'Valor muito alto.' }) valor?: number;
  @IsOptional() @IsNumber(NUMERO, { message: 'Área inválida.' }) @Min(0, { message: 'Área inválida.' }) @Max(99999999.99, { message: 'Área inválida.' }) area_m2?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de dormitórios inválida.' }) @Min(0, { message: 'Quantidade de dormitórios inválida.' }) @Max(999, { message: 'Quantidade de dormitórios inválida.' }) dormitorios?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de vagas inválida.' }) @Min(0, { message: 'Quantidade de vagas inválida.' }) @Max(999, { message: 'Quantidade de vagas inválida.' }) garagem?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de suítes inválida.' }) @Min(0, { message: 'Quantidade de suítes inválida.' }) @Max(999, { message: 'Quantidade de suítes inválida.' }) suites?: number | null;
  @IsOptional() @IsInt({ message: 'Quantidade de banheiros inválida.' }) @Min(0, { message: 'Quantidade de banheiros inválida.' }) @Max(999, { message: 'Quantidade de banheiros inválida.' }) banheiros?: number | null;
  @ValidateIf(definido) @IsString({ message: 'Informe o endereço.' }) @MaxLength(500, { message: 'O endereço pode ter até 500 caracteres.' }) endereco?: string;
  @IsOptional() @IsString({ message: 'Bairro inválido.' }) @MaxLength(200, { message: 'O bairro pode ter até 200 caracteres.' }) bairro?: string | null;
  @ValidateIf(definido) @IsString({ message: 'Informe a cidade.' }) @MaxLength(200, { message: 'A cidade pode ter até 200 caracteres.' }) cidade?: string;
  @ValidateIf(definido) @IsString({ message: 'Informe o nome do proprietário.' }) @MaxLength(300, { message: 'O nome do proprietário pode ter até 300 caracteres.' }) proprietario_nome?: string;
  @ValidateIf(definido) @IsBoolean({ message: 'Valor inválido para anunciado.' }) anunciado?: boolean;
}

export class RegistrarVendaDto {
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
}
```

`AtualizarImovelDto` NÃO aceita `ativo`, `status_venda`, `descricao` nem `corretor_id`. Chave desconhecida dá 400.

### Rotas

**GET /api/imoveis** → 200 `LinhaImovel[]` (substitui `fetchImoveis`)
- SQL: `select to_jsonb(i) as linha from public.imoveis i order by i.created_at desc nulls first, i.id limit ${LIMITE_LISTA}::int`
- Sem filtro de `ativo` nem de `status_venda`.

**GET /api/imoveis/:id** → 200 `LinhaImovel` (substitui `ImovelDetalhes.fetchImovel`)
- SQL: `select to_jsonb(i) as linha from public.imoveis i where i.id = ${id}::uuid`
- Sem linha (não existe ou o RLS esconde): `404 { codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' }`.

**GET /api/imoveis/:id/clientes-interessados** → 200 `Array<{ id, nome, telefone, status_funil }>` (junta as duas consultas do `ImovelDetalhes`)
- SQL:
  ```sql
  select jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'status_funil', c.status_funil) as linha
  from public.cliente_imovel ci
  join public.clientes c on c.id = ci.cliente_id
  where ci.imovel_id = ${id}::uuid
  order by c.created_at desc nulls first, c.id
  limit ${LIMITE_LISTA}::int
  ```
- Imóvel sem vínculo ou inexistente devolve `[]` com 200.

**POST /api/imoveis** → 201 `LinhaImovel` (criação no NovoImovelDialog e no SeletorImovel)
- Corpo: `CriarImovelDto`.
- Num único `run`:
  1. `select public.get_corretor_id()::text as id`. Se vier null: `403 corretor_nao_identificado`.
  2. Insert pelo modelo da §0.2: `insert into public.imoveis as i (corretor_id, <cols>) select ${corretorId}::uuid, <r.cols> from jsonb_populate_record(null::public.imoveis, ${json}::jsonb) r returning to_jsonb(i) as linha`.
- Só entram as colunas presentes no corpo. As omitidas ficam com o default do banco: finalidade VENDA, ativo true, estado SP, status_venda DISPONIVEL e anunciado false.
- Erros: `traduzirErroBanco(e, { entidade: 'imovel', semPermissao: 'Você não tem permissão para cadastrar imóveis nesta conta.' })`.
  - Gatilho de cota → **402** `{ codigo: 'PLAN_LIMIT_REACHED', recurso: 'max_imoveis', message: 'Limite de imóveis atingido. Acesse Plano e Assinatura para liberar mais imóveis.' }`.
  - `tipo: 'RURAL'` (vem do SeletorImovel) → 400 de validação com `MSG_TIPO`.

**PATCH /api/imoveis/:id** → 200 `LinhaImovel` (edição do NovoImovelDialog e switch "anunciado" do ImovelDetalhes)
- Corpo: `AtualizarImovelDto`. Nenhuma coluna presente → `400 nada_para_atualizar`.
- Update parcial pelo modelo da §0.2, com `returning to_jsonb(t) as linha`. Nunca toca as colunas ausentes: ativo, estado, cep, descricao, exclusividade_ate, proprietario_cpf/telefone/email, status_venda, tracking_data, descricao_curta e proprietario_id.
- Zero linhas → `404 imovel_nao_encontrado` ('Imóvel não encontrado.').
- O gatilho de cota não dispara, porque `ativo` e `corretor_id` não são editáveis.
- Erros: `traduzirErroBanco(e, { entidade: 'imovel', semPermissao: 'Você não tem permissão para alterar este imóvel.' })`.

**DELETE /api/imoveis/:id** → 204 sem corpo
- SQL: `delete from public.imoveis where id = ${id}::uuid returning id`
- Zero linhas → `404 { codigo: 'imovel_nao_encontrado', message: 'Nada foi apagado: o imóvel não existe ou você não tem permissão.' }`.
- Contrato vinculado (FK RESTRICT) → `409 { codigo: 'imovel_com_contrato', sqlstate: '23503', message: 'Existem contratos vinculados a este imóvel.' }`.
- Erros: `traduzirErroBanco(e, { entidade: 'imovel' })`.

**POST /api/imoveis/:id/venda** → 200 `{ imovel_id, status_venda: 'VENDIDO', cliente_atualizado: boolean }` (`@HttpCode(200)`)
- Corpo: `RegistrarVendaDto`.
- **Duas transações, sem savepoint.** O imóvel é gravado e confirmado antes de qualquer coisa tocar o cliente. Assim a falha do cliente, que hoje acontece sempre (22P02 do gatilho `lotti_inbox_record_legacy_stage`, §7.2.2), não tem como abortar a transação do imóvel.
- Passo 1, primeiro `run`. Um erro aqui sobe traduzido e o passo 2 não roda:
  ```ts
  try {
    await this.db.run(claims, async (tx) => {
      const linhas = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.imoveis set status_venda = 'VENDIDO' where id = ${id}::uuid returning id`);
      if (linhas.length === 0) throw erroApi(404, 'imovel_nao_encontrado', 'Imóvel não encontrado.');
    });
  } catch (e) {
    traduzirErroBanco(e, { entidade: 'imovel', semPermissao: 'Você não tem permissão para alterar este imóvel.' });
  }
  ```
- Passo 2, só se veio `cliente_id`, num segundo `run`, depois do commit do passo 1. É melhor esforço, como hoje:
  ```ts
  let cliente_atualizado = false;
  if (dto.cliente_id) {
    try {
      const linhas = await this.db.run(claims, (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update public.clientes set status_funil = 'FECHADO_GANHO' where id = ${dto.cliente_id}::uuid returning id`));
      cliente_atualizado = linhas.length === 1;
    } catch (e) {
      // O imóvel já foi gravado: falha do cliente não desfaz a venda (igual ao front de hoje).
      this.logger.warn(`venda sem cliente atualizado: ${erroPg(e)?.sqlstate ?? (e instanceof Error ? e.name : 'desconhecido')}`);
    }
  }
  return { imovel_id: id, status_venda: 'VENDIDO', cliente_atualizado };
  ```
- Sem `cliente_id`: `cliente_atualizado = false` e um `run` só.
- O passo 2 engole qualquer erro, de banco ou não. O imóvel já está VENDIDO, e um 500 levaria o usuário a achar que a venda falhou. O log registra só o SQLSTATE ou o nome do erro.
- O valor final da venda não é gravado, igual a hoje.

### Testes mínimos (A)

**Service:**
1. Cada método roda no TenantDb com as claims.
2. Listagem: `to_jsonb`, `order by i.created_at desc nulls first, i.id` e `limit $n::int`, com 1000 em `.values`.
3. Criar:
   - lê `get_corretor_id()`;
   - o corretor vai como parâmetro `::uuid` e não vem do DTO;
   - só as colunas presentes entram no SQL;
   - `get_corretor_id` null → 403.
4. Atualizar: zero linhas → 404; corpo vazio → 400.
5. P0001 `PLAN_LIMIT_REACHED:max_imoveis` → 402 com a mensagem acima.
6. 23503 com "contratos" → 409 com `sqlstate: '23503'`.
7. Venda:
   - com `cliente_id`: `db.run` chamado duas vezes, ambas com as claims. O `.text` do primeiro `$queryRaw` atualiza `imoveis` e o do segundo atualiza `clientes`, com `= $n::uuid` nos dois;
   - o segundo `$queryRaw` rejeita com P2010 `22P02` (por exemplo `mockResolvedValueOnce([{ id }]).mockRejectedValueOnce(erro)`): a resposta é `{ imovel_id, status_venda: 'VENDIDO', cliente_atualizado: false }`, sem lançar;
   - o segundo devolve uma linha: `cliente_atualizado: true`. Zero linhas: `false`;
   - imóvel inexistente (zero linhas no primeiro): 404, com `db.run` chamado uma vez só (o cliente não é tocado);
   - sem `cliente_id`: um `run` só, `cliente_atualizado: false`;
   - nenhum `.text` contém `savepoint`.

**Controller:**
1. `GET /api/imoveis/busca` continua chamando `buscar` (não é capturada por `:id`).
2. `GET /api/imoveis/nao-uuid` → 400 `id_invalido`.
3. `POST`:
   - com `tipo: 'RURAL'` → 400 com `MSG_TIPO` em `message`;
   - com `corretor_id` → 400;
   - com `dormitorios: 1000` → 400 com 'Quantidade de dormitórios inválida.';
   - com `ativo: null` → 400.
4. `DELETE` → 204.
5. `PATCH {}` chega ao service, que responde 400.
6. Venda:
   - `cliente_id: 'x'` → 400 com 'Cliente inválido.';
   - paridade (§0.5): id não v4 na URL e em `cliente_id` chega ao service.

---

## 2. Frente B: api-crm-clientes (`api/src/crm/clientes/`)

### Estrutura

- `CrmClientesController` em `@Controller('clientes')`, com `@UseGuards(SupabaseAuthGuard)`.
- `CrmClientesModule`: `controllers: [CrmClientesController]`, `providers: [CrmClientesService, SupabaseAuthGuard]`.
- **Ordem de declaração:**
  1. `@Get()`;
  2. `@Get('candidatos')`;
  3. `@Post()`;
  4. `@Post('converter-lead')`;
  5. `@Get(':id')`;
  6. `@Patch(':id')`;
  7. `@Delete(':id')`;
  8. `@Patch(':id/status')`;
  9. `@Put(':id/imovel-interesse')`;
  10. `@Post(':id/completar-cpf')`;
  11. `@Get(':id/historico')`;
  12. `@Post(':id/historico')`.
- **Constantes** (em `crm-clientes.dto.ts`):
  - `STATUS_FUNIL = ['QUALIFICACAO','VISITA_PROPOSTA','DOCUMENTACAO','FECHADO_GANHO','FECHADO_PERDIDO']`;
  - `TIPOS_INTERESSE = ['COMPRA','LOCACAO','AMBOS']`;
  - `CANAIS_CONTATO = ['WHATSAPP','EMAIL','TELEFONE','PRESENCIAL','OUTRO']`;
  - `DIRECOES_CONTATO = ['IN','OUT']`;
  - `LIMITE_LISTA = 1000`;
  - `COLUNAS_EDICAO_CLIENTE = ['nome','telefone','email','tipo_interesse','observacoes','ultimo_contato']`. `cpf` fica de fora de propósito (§7.1, BillsList e NewContractDialog).
- **`LinhaCliente`:** colunas de `to_jsonb(public.clientes)`: id, corretor_id, nome, telefone, email, cpf, rg, nacionalidade, estado_civil, profissao, endereco_completo, tipo_interesse, status_funil, ultimo_contato, proximo_followup, observacoes, created_at, updated_at, tracking_data, asaas_customer_id e is_sample_data.

### DTOs (`crm-clientes.dto.ts`)

```ts
import { IsIn, IsISO8601, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

const definido = (_o: unknown, v: unknown) => v !== undefined;
/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CriarClienteDto {
  // Nome vazio passa de propósito: quem responde é a função do banco (invalid_name → 422), e o front já tem o texto para isso.
  @IsString({ message: 'Informe o nome do cliente.' }) @MaxLength(200, { message: 'O nome pode ter até 200 caracteres.' }) nome!: string;
  @IsString({ message: 'Informe o telefone.' }) @MaxLength(40, { message: 'Telefone inválido.' }) telefone!: string; // '' é aceito
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'O e-mail pode ter até 200 caracteres.' }) email?: string | null; // '' é aceito (sem IsEmail)
  @IsOptional() @IsString({ message: 'CPF/CNPJ inválido.' }) @MaxLength(40, { message: 'CPF/CNPJ inválido.' }) cpf?: string | null;
  @ValidateIf(definido) @IsIn(TIPOS_INTERESSE, { message: 'Tipo de interesse inválido.' }) tipo_interesse?: string;
  @ValidateIf(definido) @IsIn(STATUS_FUNIL, { message: 'Etapa do funil inválida.' }) status_funil?: string;
  @IsOptional() @IsString({ message: 'Observações inválidas.' }) @MaxLength(5000, { message: 'As observações podem ter até 5000 caracteres.' }) observacoes?: string | null;
  @IsOptional() @IsISO8601({}, { message: 'Data do último contato inválida.' }) ultimo_contato?: string | null;
  @IsOptional() @IsObject({ message: 'Dados de rastreamento inválidos.' }) tracking_data?: Record<string, unknown> | null;
}

export class BuscarCandidatosDto { // query string
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) @MaxLength(40, { message: 'Telefone inválido.' }) telefone?: string;
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString({ message: 'CPF/CNPJ inválido.' }) @MaxLength(40, { message: 'CPF/CNPJ inválido.' }) cpf?: string;
}

export class AtualizarClienteDto {
  @ValidateIf(definido) @IsString({ message: 'Informe o nome do cliente.' }) @MaxLength(200, { message: 'O nome pode ter até 200 caracteres.' }) nome?: string;
  @ValidateIf(definido) @IsString({ message: 'Informe o telefone.' }) @MaxLength(40, { message: 'Telefone inválido.' }) telefone?: string;
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'O e-mail pode ter até 200 caracteres.' }) email?: string | null;
  @ValidateIf(definido) @IsIn(TIPOS_INTERESSE, { message: 'Tipo de interesse inválido.' }) tipo_interesse?: string;
  @IsOptional() @IsString({ message: 'Observações inválidas.' }) @MaxLength(5000, { message: 'As observações podem ter até 5000 caracteres.' }) observacoes?: string | null;
  @IsOptional() @IsISO8601({}, { message: 'Data do último contato inválida.' }) ultimo_contato?: string | null;
}

export class MoverClienteDto {
  @IsIn(STATUS_FUNIL, { message: 'Etapa do funil inválida.' }) status_funil!: string;
}

export class DefinirImovelInteresseDto {
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) imovel_id?: string | null;
}

export class CompletarCpfDto {
  @Matches(/^(\d{11}|\d{14})$/, { message: 'CPF/CNPJ deve ter 11 ou 14 dígitos.' }) cpf!: string;
}

export class RegistrarHistoricoDto {
  @IsIn(CANAIS_CONTATO, { message: 'Canal de contato inválido.' }) tipo!: string;
  @ValidateIf(definido) @IsIn(DIRECOES_CONTATO, { message: 'Direção inválida.' }) direcao?: string;
  @IsString({ message: 'Descreva o contato.' }) @MaxLength(5000, { message: 'O texto pode ter até 5000 caracteres.' }) conteudo!: string; // '' é aceito
  @IsOptional() @IsObject({ message: 'Metadados inválidos.' }) metadata?: Record<string, unknown> | null;
}

export class ConverterLeadDto {
  @Matches(FORMATO_UUID, { message: 'Lead inválido.' }) lead_id!: string;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Etapa inválida.' }) etapa_id?: string | null;
  @IsOptional() @IsString({ message: 'Nome inválido.' }) @MaxLength(200, { message: 'O nome pode ter até 200 caracteres.' }) nome?: string;
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) @MaxLength(40, { message: 'Telefone inválido.' }) telefone?: string;
  @IsOptional() @IsString({ message: 'E-mail inválido.' }) @MaxLength(200, { message: 'O e-mail pode ter até 200 caracteres.' }) email?: string | null;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
}
```

### Rotas

**GET /api/clientes** → 200 `Array<LinhaCliente & { cliente_imovel: Array<{ imovel_id }> }>` (substitui `fetchClientes`)
- SQL:
  ```sql
  select to_jsonb(c) || jsonb_build_object('cliente_imovel',
    coalesce((select jsonb_agg(jsonb_build_object('imovel_id', ci.imovel_id))
              from public.cliente_imovel ci where ci.cliente_id = c.id), '[]'::jsonb)) as linha
  from public.clientes c
  order by c.created_at desc nulls first, c.id
  limit ${LIMITE_LISTA}::int
  ```
- A chave aninhada `cliente_imovel` tem o mesmo formato do embed do PostgREST. Sem vínculo, vem `[]`.

**GET /api/clientes/candidatos?telefone=&email=&cpf=** → 200 `Array<{ id, nome, motivo: 'telefone'|'cpf'|'email' }>` (rpc `crm_clientes_por_telefone`)
- SQL: `select public.crm_clientes_por_telefone(${q.telefone ?? null}::text, ${q.email ?? null}::text, ${q.cpf ?? null}::text) as r`
- Devolve `r ?? []` como veio: até 5 itens, na ordem do banco.
- Erros: `traduzirErroBanco(e)`. `forbidden` → 403.

**POST /api/clientes** → 200 (`@HttpCode(200)`) com o jsonb da função tal como vem (rpc `crm_criar_cliente`):
- `{ status: 'created', cliente_id }`, ou
- `{ status: 'duplicate', candidatos: [{ id, nome, motivo }] }`.

Detalhes:
- SQL: `select public.crm_criar_cliente(${JSON.stringify(dto)}::jsonb) as r`. O `JSON.stringify` descarta os `undefined`; null fica.
- Nunca grava com insert direto. O teste de arquitetura do front e a trava 716 exigem a RPC.
- `duplicate` NÃO é erro.
- Erros: `traduzirErroBanco(e)`:
  - `forbidden` → 403 'Não foi possível identificar a sua conta. Entre novamente.';
  - `invalid_name` → 422;
  - `duplicate_client_phone` (corrida com o gatilho) → 409 com `detalhe` = uuid lido do DETAIL.

**POST /api/clientes/converter-lead** → 200 (`@HttpCode(200)`) com o jsonb da função tal como vem (rpc `crm_converter_lead`):
- `{ status: 'converted', cliente_id, created, oportunidade_id }`;
- `{ status: 'ja_convertido', cliente_id }`;
- `{ status: 'duplicate', candidatos }`.

Detalhes:
- Monta `dados = { nome, telefone, email }`. As chaves `undefined` somem; `email: null` fica.
- SQL: `select public.crm_converter_lead(${dto.lead_id}::uuid, ${dto.etapa_id ?? null}::uuid, ${JSON.stringify(dados)}::jsonb, ${dto.cliente_id ?? null}::uuid) as r`
- Erros: `traduzirErroBanco(e, { forbidden: 'Este lead não é de uma fachada sua, ou o cliente escolhido é de outra conta.' })`. `invalid_stage` → 422.

**GET /api/clientes/:id** → 200 `LinhaCliente` (ConnectedInbox)
- SQL: `select to_jsonb(c) as linha from public.clientes c where c.id = ${id}::uuid`
- Sem linha → `404 { codigo: 'cliente_nao_encontrado', message: 'Cliente não encontrado.' }`.

**PATCH /api/clientes/:id** → 200 `LinhaCliente` (`updateCliente` e o passo 2 do registro de contato por WhatsApp)
- Update parcial com `COLUNAS_EDICAO_CLIENTE`, pelo modelo da §0.2 (`jsonb_populate_record(null::public.clientes, ${json}::jsonb)`, `returning to_jsonb(t) as linha`).
- Sem coluna → 400 `nada_para_atualizar`. Zero linhas → `404 cliente_nao_encontrado`.
- Erros: `traduzirErroBanco(e, { semPermissao: 'Você não tem permissão para alterar este cliente.' })`. Trocar para o telefone de outro cliente faz o gatilho levantar `duplicate_client_phone` → **409** com `detalhe` = uuid do outro cliente.

**PATCH /api/clientes/:id/status** → 200 `{ id }` (`updateClienteStatus`)
- SQL: `update public.clientes set status_funil = ${dto.status_funil}::public.status_funil where id = ${id}::uuid returning id`
- Zero linhas → `404 cliente_nao_encontrado`.
- Erros: `traduzirErroBanco(e)`. Até sair a migration da §7.2.2, o bug do gatilho legado faz esta rota responder 400 `dados_invalidos` (SQLSTATE 22P02). O front mostra o próprio toast.

**DELETE /api/clientes/:id** → 204 (`removeCliente`)
- SQL: `delete from public.clientes where id = ${id}::uuid returning id`
- Zero linhas → `404 { codigo: 'cliente_nao_encontrado', message: 'Nada foi apagado: o cliente não existe ou você não tem permissão.' }`.
- Erros: `traduzirErroBanco(e, { entidade: 'cliente' })`. Contrato vinculado → `409 { codigo: 'cliente_com_contrato', sqlstate: '23503', message: 'Existem contratos vinculados a este cliente.' }`.

**PUT /api/clientes/:id/imovel-interesse** → 200 `{ cliente_id, imovel_id: string | null }` (`vincularClienteImovel`, que hoje faz delete e depois insert)
- Num único `run`, atômico:
  1. `select corretor_id::text as corretor_id from public.clientes where id = ${id}::uuid`. Sem linha → `404 cliente_nao_encontrado` ('Cliente não encontrado.').
  2. Se `imovel_id` não for null: `select 1 from public.imoveis where id = ${dto.imovel_id}::uuid and corretor_id = ${corretorDoCliente}::uuid`. Sem linha → `404 { codigo: 'imovel_nao_encontrado', message: 'Imóvel não encontrado.' }`. Esta conferência é nova: hoje a policy não confere o imóvel.
  3. `delete from public.cliente_imovel where cliente_id = ${id}::uuid`.
  4. Se `imovel_id` não for null: `insert into public.cliente_imovel (cliente_id, imovel_id) values (${id}::uuid, ${dto.imovel_id}::uuid) on conflict (cliente_id, imovel_id) do nothing`.
- `imovel_id` null ou ausente remove o vínculo.
- Erros: `traduzirErroBanco(e, { semPermissao: 'Você não tem permissão para alterar este cliente.' })`.

**POST /api/clientes/:id/completar-cpf** → 200 `{ atualizado: boolean }` (`completarCpfDoCliente`, `@HttpCode(200)`)
- SQL: `update public.clientes set cpf = ${dto.cpf}::text where id = ${id}::uuid and cpf is null returning id`
- Zero linhas dá `{ atualizado: false }`, sem 404, igual a hoje: o cliente já tinha CPF, é de outra conta ou não existe.
- Só preenche CPF nulo. Não serve para sobrescrever, que é o que o NewContractDialog faz (§7.1).
- Erros: `traduzirErroBanco(e)`.

**GET /api/clientes/:id/historico** → 200 `Array<{ id, cliente_id, tipo, direcao, conteudo, metadata, data_contato, created_at }>` (`fetchHistorico`)
- SQL: `select to_jsonb(h) as linha from public.historico_contatos h where h.cliente_id = ${id}::uuid order by h.data_contato desc, h.id limit ${LIMITE_LISTA}::int`
- Cliente inexistente ou sem histórico → `[]`.
- O RLS (`historico_corretor_read`) só deixa o dono da conta ler. Um membro da equipe recebe `[]` até a migration da §7.2.1.

**POST /api/clientes/:id/historico** → 201 `{ id, cliente_id, tipo, direcao, conteudo, metadata, data_contato, created_at }` (`addHistorico` e o passo 1 do registro por WhatsApp)
- **Sem RETURNING, de propósito.** Um INSERT com RETURNING exige que a linha nova também passe nas policies de SELECT. A única policy de leitura, `historico_corretor_read`, libera só o dono da conta (`corretores.user_id = auth.uid()`). Quando a migration da §7.2.1 liberar o INSERT para a equipe, um RETURNING faria a API responder 403 (42501) a um membro que o Supabase deixa gravar, já que o front insere sem `.select()`.
- Num único `run`:
  1. `const id = randomUUID()`, com `import { randomUUID } from 'node:crypto'`. O servidor gera o id; o cliente não manda.
  2. Insert por `$executeRaw`:
     ```ts
     const direcao = dto.direcao ?? 'OUT';
     const metadata = JSON.stringify(dto.metadata ?? {});
     await tx.$executeRaw(Prisma.sql`
       insert into public.historico_contatos (id, cliente_id, tipo, direcao, conteudo, metadata)
       values (${id}::uuid, ${clienteId}::uuid, ${dto.tipo}::public.canal_contato, ${direcao}::public.direcao_contato,
               ${dto.conteudo}::text, ${metadata}::jsonb)`);
     ```
  3. Resposta montada sem ler a tabela:
     ```sql
     select jsonb_build_object('id', ${id}::uuid, 'cliente_id', ${clienteId}::uuid, 'tipo', ${dto.tipo}::text,
       'direcao', ${direcao}::text, 'conteudo', ${dto.conteudo}::text, 'metadata', ${metadata}::jsonb,
       'data_contato', now(), 'created_at', now()) as linha
     ```
     Na mesma transação, `now()` devolve o mesmo instante que os defaults de `data_contato` e `created_at` gravaram. Por isso a resposta é igual à linha gravada e sai no formato do `to_jsonb`.
- O front não lê a resposta hoje: `addHistorico` relê com `fetchHistorico`.
- Erros: `traduzirErroBanco(e, { semPermissao: 'Sua conta não tem permissão para registrar contatos deste cliente.' })`.
- **Hoje esta rota responde 403 sempre em produção.** A baseline só tem policy de INSERT para service_role, e o front direto no Supabase falha do mesmo jeito. A correção é a pendência de migration da §7.2.1.

### Testes mínimos (B)

**Service:**
1. Tudo roda no TenantDb.
2. Criar:
   - chama `crm_criar_cliente` com `::jsonb` e o JSON do DTO, sem `corretor_id`;
   - devolve `duplicate` como 200.
3. P0001 `invalid_name` → 422. P0001 `forbidden` → 403.
4. P0001 `duplicate_client_phone` com DETAIL → 409 e `detalhe` = uuid.
5. Remover:
   - 23503 com "contratos" → 409 `cliente_com_contrato` com `sqlstate: '23503'`;
   - zero linhas → 404.
6. Atualizar:
   - só as colunas da lista;
   - zero linhas → 404.
7. Status:
   - zero linhas → 404;
   - o valor vai com `::public.status_funil`.
8. Imóvel de interesse:
   - imóvel de outra conta → 404;
   - `imovel_id` null só apaga;
   - as consultas seguem a ordem delete → insert.
9. Completar CPF:
   - `cpf = $n::text` e `cpf is null` no WHERE;
   - `atualizado: false` sem 404.
10. Histórico (gravar):
    - o insert vai por `tx.$executeRaw`, e o `.text` dele não contém `returning`;
    - `conteudo` com `::text`, os enums com `::public.canal_contato` e `::public.direcao_contato`, `direcao` 'OUT' quando ausente;
    - o `id` em `.values` está no formato v4 e é o mesmo na resposta;
    - o `.text` da resposta usa `now()` para `data_contato` e `created_at`;
    - P2010 `42501` → 403 `sem_permissao` com 'Sua conta não tem permissão para registrar contatos deste cliente.'.
11. Converter-lead: `forbidden` → 403 com o texto da conversão.

**Controller:**
1. `GET /api/clientes/candidatos` não é capturada por `:id`.
2. `POST /api/clientes`:
   - com `corretor_id` → 400;
   - com `nome: ''` chega ao service;
   - com `observacoes` de 5001 caracteres → 400 com 'As observações podem ter até 5000 caracteres.'.
3. `completar-cpf` com `'123'` → 400 com 'CPF/CNPJ deve ter 11 ou 14 dígitos.'.
4. `DELETE` → 204.
5. Imóvel de interesse:
   - `imovel_id: 'x'` → 400 com 'Imóvel inválido.';
   - paridade (§0.5): id não v4 na URL e em `imovel_id` chega ao service.

---

## 3. Frente C: api-crm-funil (`api/src/crm/funil/`)

### Estrutura

- `CrmFunilController` em `@Controller('crm')`, com `@UseGuards(SupabaseAuthGuard)`.
- `CrmFunilModule`: `controllers: [CrmFunilController]`, `providers: [CrmFunilService, SupabaseAuthGuard]`.
- **Ordem de declaração:**
  1. `@Get('etapas')`;
  2. `@Patch('etapas')`;
  3. `@Get('oportunidades')`;
  4. `@Post('oportunidades')`;
  5. `@Post('oportunidades/excluir')`;
  6. `@Patch('oportunidades/:id/mover')`;
  7. `@Get('tarefas')`;
  8. `@Post('tarefas')`;
  9. `@Patch('tarefas/:id/concluir')`.
- **Constantes** (em `crm-funil.dto.ts`, exportadas e importadas pelo service):
  - `TIPOS_ETAPA = ['ABERTA','GANHO','PERDIDO']`;
  - `TIPOS_TAREFA = ['LIGACAO','WHATSAPP','EMAIL','REUNIAO','VISITA','PROPOSTA','OUTRO']`;
  - `LIMITE_LISTA = 1000`, usado também como teto do excluir;
  - `COLUNAS_NOVA_OPORTUNIDADE = ['etapa_id','titulo','cliente_id','imovel_id','valor_estimado','probabilidade','data_prevista_fechamento','motivo_perda','origem','ordem','observacoes']`;
  - `COLUNAS_NOVA_TAREFA = ['titulo','descricao','tipo','data_prevista','oportunidade_id','cliente_id']`.
- **Modo do CRM:** nenhuma rota. Com a API, o front trata o modo como sempre `'completo'` (§4).

### DTOs (`crm-funil.dto.ts`)

```ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export const TIPOS_ETAPA = ['ABERTA', 'GANHO', 'PERDIDO'] as const;
export const TIPOS_TAREFA = ['LIGACAO', 'WHATSAPP', 'EMAIL', 'REUNIAO', 'VISITA', 'PROPOSTA', 'OUTRO'] as const;
export const LIMITE_LISTA = 1000;
// COLUNAS_NOVA_OPORTUNIDADE e COLUNAS_NOVA_TAREFA também ficam aqui (lista acima).

const definido = (_o: unknown, v: unknown) => v !== undefined;
const NUMERO = { allowNaN: false, allowInfinity: false };
/** Mesma regra do ParseUUIDPipe sem versão: qualquer 8-4-4-4-12 hexadecimal. */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EtapaEditadaDto {
  @Matches(FORMATO_UUID, { message: 'Etapa inválida.' }) id!: string;
  @IsString({ message: 'Informe o nome da etapa.' }) @IsNotEmpty({ message: 'Informe o nome da etapa.' }) @MaxLength(60, { message: 'O nome da etapa pode ter até 60 caracteres.' }) nome!: string;
  @IsString({ message: 'Cor inválida.' }) @Matches(/^[a-z]{2,20}$/, { message: 'Cor inválida.' }) cor!: string;
  @IsIn(TIPOS_ETAPA, { message: 'Tipo de etapa inválido.' }) tipo!: string;
  @IsInt({ message: 'Ordem inválida.' }) @Min(0, { message: 'Ordem inválida.' }) @Max(1000, { message: 'Ordem inválida.' }) ordem!: number;
}

export class SalvarEtapasDto {
  @IsArray({ message: 'Envie a lista de etapas.' }) @ArrayMinSize(1, { message: 'Envie ao menos uma etapa.' }) @ArrayMaxSize(50, { message: 'Envie no máximo 50 etapas.' })
  @ValidateNested({ each: true, message: 'Etapa inválida.' }) @Type(() => EtapaEditadaDto) etapas!: EtapaEditadaDto[];
}

export class MoverOportunidadeDto {
  @Matches(FORMATO_UUID, { message: 'Etapa inválida.' }) etapa_id!: string;
  @IsInt({ message: 'Posição inválida.' }) @Min(0, { message: 'Posição inválida.' }) @Max(100000, { message: 'Posição inválida.' }) ordem!: number;
  // Token de concorrência: a string exatamente como veio da listagem (com microssegundos).
  @IsString({ message: 'Versão do negócio ausente.' }) @IsNotEmpty({ message: 'Versão do negócio ausente.' }) @MaxLength(64, { message: 'Versão do negócio inválida.' }) updated_at!: string;
}

export class ExcluirOportunidadesDto {
  // Mesmo teto da listagem: toda seleção possível no CrmPipeline cabe numa chamada.
  @IsArray({ message: 'Escolha ao menos um negócio.' }) @ArrayMinSize(1, { message: 'Escolha ao menos um negócio.' }) @ArrayMaxSize(LIMITE_LISTA, { message: 'Escolha no máximo 1000 negócios por vez.' })
  @Matches(FORMATO_UUID, { each: true, message: 'Negócio inválido.' }) ids!: string[];
}

export class CriarOportunidadeDto {
  @Matches(FORMATO_UUID, { message: 'Etapa inválida.' }) etapa_id!: string;
  @IsString({ message: 'Informe o título.' }) @IsNotEmpty({ message: 'Informe o título.' }) @MaxLength(200, { message: 'O título pode ter até 200 caracteres.' }) titulo!: string;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) imovel_id?: string | null;
  @ValidateIf(definido) @IsNumber(NUMERO, { message: 'Valor inválido.' }) @Min(0, { message: 'Valor inválido.' }) @Max(9999999999999.99, { message: 'Valor inválido.' }) valor_estimado?: number;
  @ValidateIf(definido) @IsInt({ message: 'Probabilidade inválida.' }) @Min(0, { message: 'Probabilidade inválida.' }) @Max(100, { message: 'Probabilidade inválida.' }) probabilidade?: number;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, { message: 'Data prevista inválida.' }) data_prevista_fechamento?: string | null;
  @IsOptional() @IsString({ message: 'Motivo da perda inválido.' }) @MaxLength(500, { message: 'O motivo da perda pode ter até 500 caracteres.' }) motivo_perda?: string | null;
  @IsOptional() @IsString({ message: 'Origem inválida.' }) @MaxLength(50, { message: 'Origem inválida.' }) origem?: string | null;
  @ValidateIf(definido) @IsInt({ message: 'Posição inválida.' }) @Min(0, { message: 'Posição inválida.' }) @Max(100000, { message: 'Posição inválida.' }) ordem?: number;
  @IsOptional() @IsString({ message: 'Observações inválidas.' }) @MaxLength(5000, { message: 'As observações podem ter até 5000 caracteres.' }) observacoes?: string | null;
}

export class ConcluirTarefaDto {
  @IsBoolean({ message: 'Informe se a tarefa foi concluída.' }) concluida!: boolean;
}

export class CriarTarefaDto {
  @IsString({ message: 'Informe o título da tarefa.' }) @IsNotEmpty({ message: 'Informe o título da tarefa.' }) @MaxLength(200, { message: 'O título pode ter até 200 caracteres.' }) titulo!: string;
  @IsOptional() @IsString({ message: 'Descrição inválida.' }) @MaxLength(5000, { message: 'A descrição pode ter até 5000 caracteres.' }) descricao?: string | null;
  @ValidateIf(definido) @IsIn(TIPOS_TAREFA, { message: 'Tipo de tarefa inválido.' }) tipo?: string;
  @IsOptional() @IsISO8601({}, { message: 'Data prevista inválida.' }) data_prevista?: string | null;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Negócio inválido.' }) oportunidade_id?: string | null;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Cliente inválido.' }) cliente_id?: string | null;
}
```

### Rotas

**GET /api/crm/etapas** → 200 `Array<{ id, corretor_id, nome, ordem, cor, tipo, ativo, created_at }>` (`useEtapas`, modo completo)
- SQL: `select to_jsonb(e) as linha from public.crm_etapas e where e.ativo = true order by e.ordem, e.nome, e.id limit ${LIMITE_LISTA}::int`
- Etapas com a mesma ordem saem por nome, como em `lotti_crm_primeira_etapa` (§6).

**PATCH /api/crm/etapas** → 200 `{ atualizadas: number }` (`GerenciarEtapas.salvar`)
- Num único `run`, atômico. Para cada item, em sequência: `update public.crm_etapas set nome = ${e.nome}::text, cor = ${e.cor}::text, tipo = ${e.tipo}::text, ordem = ${e.ordem}::int where id = ${e.id}::uuid returning id`.
- Um item com zero linhas (oculto pelo RLS ou inexistente) só deixa de contar, sem erro. Hoje também é ignorado.
- Não cria nem desativa etapa.
- Erros: `traduzirErroBanco(e, { repetido: 'Já existe uma etapa com este nome.' })`. O 23505 do unique `(corretor_id, nome)` → 409, e nada é gravado.

**GET /api/crm/oportunidades** → 200 `Array<{ ...colunas, clientes: { nome, telefone } | null, imoveis: { titulo } | null }>` (`useOportunidades`, modo completo)
- SQL:
  ```sql
  select to_jsonb(o) || jsonb_build_object(
    'clientes', (select jsonb_build_object('nome', c.nome, 'telefone', c.telefone) from public.clientes c where c.id = o.cliente_id),
    'imoveis',  (select jsonb_build_object('titulo', i.titulo) from public.imoveis i where i.id = o.imovel_id)
  ) as linha
  from public.crm_oportunidades o
  order by o.ordem, o.id
  limit ${LIMITE_LISTA}::int
  ```
- Colunas: id, corretor_id, cliente_id, imovel_id, etapa_id, titulo, valor_estimado (número), probabilidade, data_prevista_fechamento ('YYYY-MM-DD'), motivo_perda, origem, ordem, observacoes, fechada_em, created_at, **updated_at com microssegundos** e is_sample_data.
- Embed oculto pelo RLS ou inexistente → `null`, igual ao PostgREST.

**POST /api/crm/oportunidades** → 201 `{ id }` (`useCriarOportunidade`, hoje sem chamador)
- Num único `run`:
  1. `select public.get_corretor_id()::text as id`. Se vier null: `403 corretor_nao_identificado`.
  2. `select 1 from public.crm_etapas where id = ${dto.etapa_id}::uuid`. Sem linha → `422 { codigo: 'etapa_invalida', message: 'A etapa do pipeline não existe mais. Recarregue a página e tente de novo.' }`.
  3. Se veio `cliente_id`: `select 1 from public.clientes where id = ${dto.cliente_id}::uuid and corretor_id = ${corretor}::uuid`. Sem linha → `422 { codigo: 'cliente_invalido', message: 'Cliente não encontrado nesta conta.' }`.
  4. Se veio `imovel_id`: `select 1 from public.imoveis where id = ${dto.imovel_id}::uuid and corretor_id = ${corretor}::uuid`. Sem linha → `422 { codigo: 'imovel_invalido', message: 'Imóvel não encontrado nesta conta.' }`.
  5. Insert pelo modelo: `insert into public.crm_oportunidades as o (corretor_id, <cols>) select ${corretor}::uuid, <r.cols> from jsonb_populate_record(null::public.crm_oportunidades, ${json}::jsonb) r returning o.id`.
- Erros: `traduzirErroBanco(e)`.

**POST /api/crm/oportunidades/excluir** → 200 `{ excluidas: number }` (`useExcluirOportunidades`, `@HttpCode(200)`)
- Corpo: `ExcluirOportunidadesDto`, com 1 a 1000 ids (`LIMITE_LISTA`).
- SQL: `delete from public.crm_oportunidades where id = any(${dto.ids}::uuid[]) returning id`
- Zero linhas é sucesso, igual a hoje. As tarefas do negócio somem por cascata.
- O teto é o mesmo da listagem de propósito. O CrmPipeline só seleciona negócios da lista carregada, que vem com no máximo 1000. O botão Excluir não tem onError (§7.2), então um teto menor faria a exclusão falhar sem nenhum aviso.
- Erros: `traduzirErroBanco(e)`.

**PATCH /api/crm/oportunidades/:id/mover** → 200 `{ id }` (`useMoverOportunidade`, modo completo)
- Num único `run`:
  1. `select 1 from public.crm_etapas where id = ${dto.etapa_id}::uuid`. Sem linha → `422 etapa_invalida`, com o texto acima.
  2. `update public.crm_oportunidades set etapa_id = ${dto.etapa_id}::uuid, ordem = ${dto.ordem}::int where id = ${id}::uuid and updated_at = ${dto.updated_at}::timestamptz returning id`
- Zero linhas no passo 2 → **`409 { codigo: 'CONFLITO', message: 'Este negócio foi movido em outro lugar.' }`**. Isso cobre o membro que só tem leitura e o registro alterado em outra aba.
- `updated_at` mal formado → 22007/22008 → 400 `dados_invalidos`.
- Os gatilhos `trg_crm_oport_updated_at` e `lotti_inbox_record_crm_stage` rodam com as claims do usuário.
- Erros: `traduzirErroBanco(e)`.

**GET /api/crm/tarefas** → 200 `Array<{ ...colunas, clientes: { nome } | null }>` (`useTarefas`, modo completo)
- SQL:
  ```sql
  select to_jsonb(t) || jsonb_build_object('clientes',
    (select jsonb_build_object('nome', c.nome) from public.clientes c where c.id = t.cliente_id)) as linha
  from public.crm_tarefas t
  order by t.data_prevista asc nulls last, t.id
  limit ${LIMITE_LISTA}::int
  ```
- Colunas: id, corretor_id, oportunidade_id, cliente_id, titulo, descricao, tipo, data_prevista, concluida, concluida_em, created_at e is_sample_data.

**POST /api/crm/tarefas** → 201 com a linha `to_jsonb` (`useCriarTarefa`, hoje sem chamador)
- Mesmo roteiro da criação de oportunidade:
  - `corretor_nao_identificado` → 403;
  - `oportunidade_id` precisa existir em `public.crm_oportunidades` com `corretor_id = ${corretor}::uuid`; senão, `422 { codigo: 'oportunidade_invalida', message: 'Negócio não encontrado nesta conta.' }`;
  - `cliente_id` passa pela mesma checagem → `422 cliente_invalido`.
- Insert com `COLUNAS_NOVA_TAREFA` via `jsonb_populate_record(null::public.crm_tarefas, ${json}::jsonb)`, com `returning to_jsonb(x) as linha`.

**PATCH /api/crm/tarefas/:id/concluir** → 200 com a linha `to_jsonb` (`useConcluirTarefa`)
- SQL: `update public.crm_tarefas t set concluida = ${dto.concluida}::boolean, concluida_em = case when ${dto.concluida}::boolean then now() else null end where t.id = ${id}::uuid returning to_jsonb(t) as linha`
- Zero linhas → `404 { codigo: 'tarefa_nao_encontrada', message: 'Tarefa não encontrada.' }`.

### Testes mínimos (C)

**Service:**
1. Listagens com `to_jsonb`, embeds, as ordenações exatas (etapas: `order by e.ordem, e.nome, e.id`) e `limit $n::int`.
2. Mover:
   - etapa invisível → 422 `etapa_invalida`;
   - zero linhas → 409 `CONFLITO`;
   - o `updated_at` vai como parâmetro com `::timestamptz`, sem conversão para Date.
3. Salvar etapas:
   - N updates num `run` só, com `nome`, `cor` e `tipo` em `::text` e `ordem` em `::int`;
   - devolve `atualizadas`;
   - 23505 → 409 com 'Já existe uma etapa com este nome.'.
4. Excluir usa `any(...::uuid[])` e devolve `excluidas`.
5. Criar oportunidade:
   - `get_corretor_id` null → 403;
   - cliente de outra conta → 422;
   - o `corretor_id` do insert é o resolvido no servidor.
6. Concluir com zero linhas → 404.

**Controller:**
1. `PATCH etapas` com id `'novo-123'` → 400.
2. Chave extra em item de etapa → 400.
3. `PATCH etapas` com `nome: ''` → 400, com `'etapas.0.Informe o nome da etapa.'` no array `message`. O prefixo é do ValidationPipe; o front tira.
4. `mover` sem `updated_at` → 400.
5. `excluir`:
   - `ids: ['x']` → 400 com 'Negócio inválido.';
   - 1000 ids v4 distintos → chega ao service;
   - 1001 ids → 400 com 'Escolha no máximo 1000 negócios por vez.'.
6. Paridade (§0.5): id não v4 na URL e em `etapa_id` do `mover` chega ao service; `PATCH etapas` com `etapas[0].id` não v4 também chega.

---

## 4. Frente D: front

### 4.0 Premissa: um banco só

Com `VITE_API_URL`, o front fala com duas origens ao mesmo tempo:
- a API, para o que está neste contrato;
- o supabase-js, para tudo o que está em §7.1, mais login, storage, Realtime e Edge Functions.

Várias telas encadeiam as duas origens no mesmo fluxo:
- **NovoImovelDialog:** cria o imóvel pela API e grava `imovel_fotos` (FK para `imoveis`) e `videos` pelo Supabase;
- **AnalisarContratoDialog:** cria o cliente pela API (via `cadastroCliente.ts`), insere o contrato (FK para `clientes`) e, se falhar, apaga o cliente e o imóvel pelo Supabase;
- **AutoContractDialog:** faz o mesmo, com contrato e `faturas_aluguel`;
- **useSubscription:** conta imóveis ativos pelo Supabase para o `checkLimit`, enquanto o gatilho de cota roda no banco da API;
- **useConverterLead:** converte pela API, e o `useLeadsPendentes` relê `fachada_leads` pelo Supabase;
- **Clientes.tsx:** consulta contratos pelo Supabase (`useContratosDosClientes`) e depois exclui o cliente pela API;
- **ConnectedInbox:** renomeia pelo RPC `lotti_inbox_update_contact` no Supabase e relê o cliente pela API;
- **Onboarding:** cria pelo RPC `onboarding_executar_acao` no Supabase e relê clientes e imóveis pela API;
- **Edge Functions e agente** (lead-capture, inbox-suggest, n8n): gravam no banco do Supabase, e a API precisa enxergar o que eles gravam.

Isso só funciona se os dois lados lerem e gravarem o MESMO Postgres. A regra:

**`VITE_API_URL` só pode ser definida num build do front em que o `DATABASE_URL` da API aponta para o mesmo banco do projeto Supabase de `VITE_SUPABASE_URL`.** Vale para produção, Railway, Vercel e previews.

Na prática:
- **Hoje a premissa não vale em lugar nenhum.** A API do Railway aponta para a cópia do ensaio (Postgres 18.6 do Railway), e o front aponta para o Supabase de produção. Por isso `VITE_API_URL` fica ausente em todos os builds.
  - Ligar a variável no ensaio quebraria a FK de `imovel_fotos` (imóvel criado só na cópia) e deixaria contrato sem cliente (cliente criado só na cópia).
  - O ensaio só é exercitado pela API direto (curl, §5), nunca pelo front.
- **Para ligar `VITE_API_URL` num build, valem as duas condições:**
  - o `DATABASE_URL` da API aponta para o banco do Supabase daquele `VITE_SUPABASE_URL`: host `db.<ref>.supabase.co`, ou pooler com usuário `postgres.<ref>`, onde `<ref>` é o do `VITE_SUPABASE_URL`. Depois da virada (fase 6) vale o inverso: nenhum dado pode mais ser lido pelo supabase-js;
  - a conferência de banco único do §5 (passo 4) passou nesse ambiente.
- **Nenhuma frente escreve código para detectar ou contornar a mistura** (sem fallback e sem sincronização). A regra é de operação e é conferida no §5.

### Regra geral

**Sem `VITE_API_URL`, nada muda:** todo ramo Supabase atual continua byte a byte. Com ela, cada ponto abaixo usa a API, sempre atrás de `apiDisponivel()` (importado de `@/lib/api`).

Os testes atuais continuam passando porque rodam sem `VITE_API_URL`:
- `src/stores/crmStore.clientes.test.ts`, `src/lib/crm/cadastroCliente.test.ts`, `src/lib/crm/duplicidade.test.ts`, `src/lib/crm/historico.test.ts`;
- `src/lib/crm/cadastroUnico.arquitetura.test.ts`, `src/hooks/crm/useConverterLead.test.tsx`;
- `src/components/crm/CrmLeadsInbox.test.tsx`, `src/components/crm/CrmPipeline.visual.test.tsx`;
- `src/components/juridico/AnalisarContratoDialog.test.tsx`, `src/components/rental/AutoContractDialog.test.tsx`;
- `src/components/clientes/NovoClienteDialog.test.tsx`, `src/components/imoveis/NovoImovelDialog.campos.test.tsx`;
- `src/features/whatsapp-inbox/ConnectedInbox.test.tsx`, `src/components/layout/funil-sidebar-visual.test.tsx`;
- `src/pages/Clientes.lote.test.tsx`, `src/pages/Dashboard.inicio.test.tsx`, `src/pages/Onboarding.becos.test.tsx`;
- `src/lib/auth/isolamentoSessao.test.ts`, `src/lib/api.test.ts`.

**Import da API:**
- `src/lib/api/http.ts` não importa nada do Supabase nem de `@/lib/api`.
- `imoveis.ts` e `crm.ts` importam `chamarApi` de `@/lib/api`, que importa o cliente do Supabase.
- Nos arquivos que já importam o cliente do Supabase de forma estática, o import estático da API não muda nada.
- O `CrmPipeline.tsx` é a exceção. Ele só usa o Supabase por import dinâmico, porque o `CrmPipeline.visual.test.tsx` roda em node sem mock do cliente, e o `client.ts` usa `window` ao carregar. Por isso o `CrmPipeline.tsx` importa `@/lib/api` e `@/lib/api/crm` só por `await import(...)`, dentro do `salvar` (§4.4).

**Comandos:**
- `npx vitest run <arquivos>`
- `npx tsc --noEmit -p tsconfig.app.json` (só os erros dos seus arquivos)

### 4.1 `src/lib/api/http.ts`

```ts
/** Códigos que o front compara em `e.message` (vindos das funções do banco ou do mover). */
export const CODIGOS_DO_BANCO = ['forbidden', 'invalid_name', 'invalid_stage', 'duplicate_client_phone', 'CONFLITO'] as const;

/** O ValidationPipe põe o caminho do campo antes da mensagem de item de lista ("etapas.0.Informe..."). */
const PREFIXO_CAMPO = /^(?:[a-z_][a-z0-9_]*\.(?:\d+\.)*)+/;

/** Erro da API no formato que codigoDoErro, clienteDoTelefone, mensagemDeErro e barradoPorContrato já leem. */
export class ErroApi extends Error {
  status: number; codigo: string | null; details: string | null; code: string | null;
  constructor(status: number, codigo: string | null, message: string, details: string | null = null, code: string | null = null) {
    super(message); this.name = 'ErroApi';
    this.status = status; this.codigo = codigo; this.details = details; this.code = code;
  }
}

export async function lerErroApi(res: Response, padrao: string): Promise<ErroApi> {
  let corpo: Record<string, unknown> = {};
  try { corpo = ((await res.json()) ?? {}) as Record<string, unknown>; } catch { /* sem corpo */ }
  const codigo = typeof corpo.codigo === 'string' ? corpo.codigo : null;
  const bruto = corpo.message;
  const texto = res.status >= 500 ? ''
    : Array.isArray(bruto)
      ? [...new Set(bruto.filter((s): s is string => typeof s === 'string').map((s) => s.replace(PREFIXO_CAMPO, '')))].join(' ')
      : typeof bruto === 'string' ? bruto : '';
  const message = codigo && (CODIGOS_DO_BANCO as readonly string[]).includes(codigo) ? codigo : (texto || padrao);
  return new ErroApi(res.status, codigo, message,
    typeof corpo.detalhe === 'string' ? corpo.detalhe : null,
    typeof corpo.sqlstate === 'string' ? corpo.sqlstate : null);
}

export async function lerJson<T>(res: Response, padrao: string): Promise<T> {
  if (!res.ok) throw await lerErroApi(res, padrao);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const corpoJson = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', corpo?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});

/** Mesmo formato { data, error } do supabase-js, para os ramos existentes seguirem iguais. */
export async function comoResultado<T>(p: Promise<T>): Promise<{ data: T | null; error: unknown }> {
  try { return { data: await p, error: null }; } catch (error) { return { data: null, error }; }
}

/** Copia só as chaves aceitas pela rota (o DTO recusa as outras com 400), sem as que estão undefined. */
export function escolher<K extends string>(obj: object, chaves: readonly K[]): Partial<Record<K, unknown>> {
  const fonte = obj as Record<string, unknown>;
  const saida: Partial<Record<K, unknown>> = {};
  for (const k of chaves) if (fonte[k] !== undefined) saida[k] = fonte[k];
  return saida;
}
```

As quatro ligações com o código existente funcionam sem mudança:
- `codigoDoErro` lê `e.message`, que é igual ao código do banco nos casos da lista.
- `clienteDoTelefone` lê `e.message === 'duplicate_client_phone'` e o uuid em `e.details`.
- O `barradoPorContrato` de `Clientes.tsx` lê `e.code === '23503'` e "contratos" em `e.message`.
- O `useMoverOportunidade` compara `e.message === 'CONFLITO'`.

Nos demais casos, `e.message` é o texto em português da API (sem prefixo de campo e sem repetição) ou o texto padrão da função. Como `ErroApi` estende `Error`, o `mensagemDeErro` devolve só `e.message`.

### 4.2 `src/lib/api/imoveis.ts`

Todos os ids vão com `encodeURIComponent`. As chamadas usam `chamarApi` de `@/lib/api` e `lerJson` de `./http`.

| Função | Rota | Retorno | Texto padrão de erro |
|---|---|---|---|
| `listarImoveisApi()` | GET `/api/imoveis` | `Promise<LinhaImovel[]>` | 'Não foi possível carregar os imóveis.' |
| `obterImovelApi(id: string)` | GET `/api/imoveis/{id}` | `Promise<LinhaImovel>` | 'Imóvel não encontrado.' |
| `listarClientesInteressadosApi(imovelId: string)` | GET `/api/imoveis/{id}/clientes-interessados` | `Promise<ClienteInteressado[]>` | 'Não foi possível carregar os clientes interessados.' |
| `criarImovelApi(dados: DadosImovelApi)` | POST `/api/imoveis` | `Promise<LinhaImovel>` | 'Não foi possível cadastrar o imóvel.' |
| `atualizarImovelApi(id: string, dados: AlteracaoImovelApi)` | PATCH `/api/imoveis/{id}` | `Promise<LinhaImovel>` | 'Não foi possível atualizar o imóvel.' |
| `removerImovelApi(id: string)` | DELETE `/api/imoveis/{id}` | `Promise<void>` | 'Não foi possível excluir o imóvel.' |
| `registrarVendaImovelApi(id: string, clienteId: string \| null)` | POST `/api/imoveis/{id}/venda`, corpo `{ cliente_id: clienteId }` | `Promise<{ imovel_id: string; status_venda: 'VENDIDO'; cliente_atualizado: boolean }>` | 'Não foi possível registrar a venda.' |

Tipos:
- `LinhaImovel = Record<string, unknown> & { id: string }`
- `ClienteInteressado = { id: string; nome: string; telefone: string; status_funil: string }`
- `DadosImovelApi = { titulo: string; tipo: string; finalidade?: string; valor: number; area_m2?: number | null; dormitorios?: number | null; garagem?: number | null; suites?: number | null; banheiros?: number | null; endereco: string; bairro?: string | null; cidade: string; proprietario_nome: string; ativo?: boolean }`
- `AlteracaoImovelApi = Partial<Omit<DadosImovelApi, 'ativo'>> & { anunciado?: boolean }`

### 4.3 `src/lib/api/crm.ts`

Constantes exportadas:
- `CHAVES_CRIAR_CLIENTE = ['nome','telefone','email','cpf','tipo_interesse','status_funil','observacoes','ultimo_contato','tracking_data'] as const`
- `CHAVES_ALTERAR_CLIENTE = ['nome','telefone','email','tipo_interesse','observacoes','ultimo_contato'] as const`
- `CHAVES_NOVA_OPORTUNIDADE = ['etapa_id','titulo','cliente_id','imovel_id','valor_estimado','probabilidade','data_prevista_fechamento','motivo_perda','origem','ordem','observacoes'] as const`
- `CHAVES_NOVA_TAREFA = ['titulo','descricao','tipo','data_prevista','oportunidade_id','cliente_id'] as const`

| Função | Rota | Retorno | Texto padrão de erro |
|---|---|---|---|
| `listarClientesApi()` | GET `/api/clientes` | `Promise<Array<Record<string, unknown> & { id: string; cliente_imovel?: Array<{ imovel_id: string }> }>>` | 'Não foi possível carregar os clientes.' |
| `obterClienteApi(id: string)` | GET `/api/clientes/{id}` | `Promise<Record<string, unknown>>` | 'Cliente não encontrado.' |
| `criarClienteApi(dados: Record<string, unknown>)` | POST `/api/clientes` | `Promise<{ status: string; cliente_id?: string; candidatos?: unknown }>` | 'Não foi possível cadastrar o cliente.' |
| `buscarCandidatosApi(q: { telefone?: string \| null; email?: string \| null; cpf?: string \| null })` | GET `/api/clientes/candidatos?…`. Só vão as chaves que não são null nem undefined; `''` vai como `telefone=`. | `Promise<unknown>` | 'Não foi possível procurar clientes parecidos.' |
| `atualizarClienteApi(id: string, dados: Record<string, unknown>)` | PATCH `/api/clientes/{id}` | `Promise<Record<string, unknown>>` | 'Não foi possível atualizar o cliente.' |
| `moverClienteNoFunilApi(id: string, status: string)` | PATCH `/api/clientes/{id}/status`, corpo `{ status_funil }` | `Promise<{ id: string }>` | 'Não foi possível mover o cliente no funil.' |
| `removerClienteApi(id: string)` | DELETE `/api/clientes/{id}` | `Promise<void>` | 'Não foi possível excluir o cliente.' |
| `definirImovelDeInteresseApi(clienteId: string, imovelId: string \| null)` | PUT `/api/clientes/{id}/imovel-interesse`, corpo `{ imovel_id }` | `Promise<{ cliente_id: string; imovel_id: string \| null }>` | 'Não foi possível vincular o imóvel ao cliente.' |
| `completarCpfApi(clienteId: string, cpf: string)` | POST `/api/clientes/{id}/completar-cpf`, corpo `{ cpf }` | `Promise<{ atualizado: boolean }>` | 'Não foi possível guardar o CPF do cliente.' |
| `listarHistoricoApi(clienteId: string)` | GET `/api/clientes/{id}/historico` | `Promise<Array<Record<string, unknown>>>` | 'Não foi possível carregar o histórico.' |
| `registrarHistoricoApi(clienteId: string, r: { tipo: string; direcao?: 'IN' \| 'OUT'; conteudo: string; metadata?: Record<string, unknown> })` | POST `/api/clientes/{id}/historico` | `Promise<Record<string, unknown>>` | 'Não foi possível registrar o contato.' |
| `converterLeadApi(a: { lead_id: string; etapa_id: string \| null; nome?: string; telefone?: string; email?: string \| null; cliente_id?: string \| null })` | POST `/api/clientes/converter-lead` | `Promise<unknown>` (jsonb cru da função) | 'Não foi possível converter o lead.' |
| `listarEtapasApi()` | GET `/api/crm/etapas` | `Promise<CrmEtapa[]>` | 'Não foi possível carregar as etapas.' |
| `salvarEtapasApi(etapas: Array<{ id: string; nome: string; cor: string; tipo: string; ordem: number }>)` | PATCH `/api/crm/etapas`, corpo `{ etapas }` | `Promise<{ atualizadas: number }>` | 'Não foi possível salvar as etapas.' |
| `listarOportunidadesApi()` | GET `/api/crm/oportunidades` | `Promise<CrmOportunidade[]>` | 'Não foi possível carregar os negócios.' |
| `moverOportunidadeApi(a: { id: string; etapaId: string; ordem: number; updatedAt: string })` | PATCH `/api/crm/oportunidades/{id}/mover`, corpo `{ etapa_id, ordem, updated_at }` | `Promise<{ id: string }>` | 'Não foi possível mover o negócio.' |
| `excluirOportunidadesApi(ids: string[])` | POST `/api/crm/oportunidades/excluir`, corpo `{ ids }` (até 1000) | `Promise<{ excluidas: number }>` | 'Não foi possível excluir os negócios.' |
| `criarOportunidadeApi(nova: Record<string, unknown>)` | POST `/api/crm/oportunidades` | `Promise<{ id: string }>` | 'Não foi possível criar a oportunidade.' |
| `listarTarefasApi()` | GET `/api/crm/tarefas` | `Promise<CrmTarefa[]>` | 'Não foi possível carregar as tarefas.' |
| `concluirTarefaApi(id: string, concluida: boolean)` | PATCH `/api/crm/tarefas/{id}/concluir`, corpo `{ concluida }` | `Promise<Record<string, unknown>>` | 'Não foi possível atualizar a tarefa.' |
| `criarTarefaApi(nova: Record<string, unknown>)` | POST `/api/crm/tarefas` | `Promise<Record<string, unknown>>` | 'Não foi possível criar a tarefa.' |

`CrmEtapa`, `CrmOportunidade` e `CrmTarefa` vêm de `@/lib/crm/tipos`. `criarOportunidadeApi` e `criarTarefaApi` recebem o objeto já filtrado por `CHAVES_NOVA_OPORTUNIDADE` e `CHAVES_NOVA_TAREFA`, e nunca recebem `id` nem `corretor_id`.

### 4.4 Adaptadores, ponto a ponto

Em todos os pontos, o ramo Supabase atual fica intacto no `else`.

**`src/stores/crmStore.ts`**
- **`donoDoTelefone`:** com API, `const data = await buscarCandidatosApi({ telefone }).catch(() => null)`. O resto não muda: mesmo filtro e mesmo fallback `[{ id: existente, nome: '', motivo: 'telefone' }]`.
- **`fetchClientes`:** com API, `data = await listarClientesApi()`. O mapeamento é o mesmo (`documentos: []`, `imoveis_interesse` a partir de `cliente_imovel`), e o tratamento de erro também (console.error, estado mantido).
- **`fetchImoveis`:** com API, `data = await listarImoveisApi()`. O mapeamento `clientes_interessados: []` é o mesmo.
- **`fetchHistorico(clienteId)`:** com API e com `clienteId`, `set({ historico: await listarHistoricoApi(clienteId) })`. Sem `clienteId` continua no Supabase; não há chamador assim hoje.
- **`addCliente`:** `const { data, error } = apiDisponivel() ? await comoResultado(criarClienteApi(escolher(cliente, CHAVES_CRIAR_CLIENTE))) : await db.rpc(...)`. O resto da função fica igual: `clienteDoTelefone` funciona com `ErroApi`, `duplicate` vem em `data`, e os toasts de forbidden e invalid_name saem por `codigoDoErro`.
- **`updateCliente`:** `const { error } = apiDisponivel() ? await comoResultado(atualizarClienteApi(id, escolher(data, CHAVES_ALTERAR_CLIENTE))) : await db.from(...)`. O resto fica igual, e o 404 cai no toast 'Erro ao atualizar cliente'.
- **`updateClienteStatus`:** o otimista continua. Com API, `await moverClienteNoFunilApi(id, status)` no lugar do update; qualquer erro cai no mesmo catch, que reverte e mostra o toast.
- **`removeCliente`:** com API, `await removerClienteApi(id); get().fetchClientes(); return { success: true }`. O catch devolve `{ success: false, error }` com o `ErroApi`, e o `barradoPorContrato` de `Clientes.tsx` continua funcionando.
- **`addHistorico`:** monta `registro = paraRegistro(...)` como hoje. Com API, `await registrarHistoricoApi(historico.cliente_id, { tipo: registro.tipo, direcao: registro.direcao, conteudo: registro.conteudo, metadata: registro.metadata })`. `data_contato` não vai, porque quem preenche é o servidor. Sucesso e erro seguem como hoje.
- **`vincularClienteImovel`:** com API, `await definirImovelDeInteresseApi(clienteId, imovelId && imovelId !== 'none' ? imovelId : null); get().fetchClientes()`. O catch mantém o toast 'Erro ao vincular imóvel ao cliente'.
- **Não mudam** (fora do escopo, §7.1): fetchContratos, fetchCorretor, fetchAlertas, marcarAlertaLido, addContrato e updateCorretor.

**`src/hooks/crm/useCrm.ts`**
- **`useModoCrm`:** com API, `return 'completo'` sem nenhuma chamada. As tabelas `crm_*` existem na baseline da produção e no Railway, e assim um erro passageiro não prende a sessão no modo legado.
- **`useEtapas`:** no modo legado continua `ETAPAS_LEGADO`; com API, `return await listarEtapasApi()`.
- **`useOportunidades` e `useTarefas`:** no modo completo com API, `listarOportunidadesApi()` e `listarTarefasApi()`. Os ramos legados não mudam; com API ficam inalcançáveis.
- **`useClientesParecidos`:** com API, `candidatosValidos(await buscarCandidatosApi({ telefone: chave.telefone || null, email: chave.email || null, cpf: chave.cpf || null }))`.
- **`useExcluirOportunidades`:** o modo legado continua lançando o erro. Com API, `await excluirOportunidadesApi(ids); return ids`. Os ids vêm da seleção do CrmPipeline, que só contém negócios da lista carregada (até 1000), e a rota aceita até 1000 (§3). O hook continua sem onError nos dois ramos (pendência §7.2).
- **`useMoverOportunidade`:** no modo completo com API, `return await moverOportunidadeApi(args)`. O 409 vira `ErroApi` com `message === 'CONFLITO'`, que dispara o mesmo `toast.warning`. onMutate, onError e onSettled ficam iguais.
- **`useCriarOportunidade`:** com API, `return await criarOportunidadeApi(escolher(nova, CHAVES_NOVA_OPORTUNIDADE))`, sem `corretorId()`.
- **`useRegistrarContatoWhatsApp`:** com API:
  1. `await registrarHistoricoApi(args.clienteId, { tipo: 'WHATSAPP', direcao: 'OUT', conteudo: args.mensagem.slice(0, 500), metadata: { tipo_ui: 'WHATSAPP', via: 'wa.me' } })`;
  2. `await atualizarClienteApi(args.clienteId, { ultimo_contato: new Date().toISOString() }).catch(() => undefined)`, em melhor esforço como hoje.
- **`useConcluirTarefa`:** com API, `await concluirTarefaApi(args.id, args.concluida)`.
- **`useCriarTarefa`:** com API, `await criarTarefaApi(escolher(nova, CHAVES_NOVA_TAREFA))`.
- **`useConverterLead`:** com API:
  ```ts
  const data = await converterLeadApi({
    lead_id: args.lead.id,
    etapa_id: modo === 'completo' ? args.etapaId : null,
    nome: limpo.nome,
    telefone: limpo.telefone,
    email: limpo.email,
    cliente_id: args.clienteExistente ?? null,
  });
  ```
  O pós-processamento, o onSuccess e o onError são os mesmos. As mensagens de forbidden e invalid_stage saem por `codigoDoErro`.
- **`useLeadsPendentes`:** não muda (`fachada_leads` está fora do escopo, §7.1).

**`src/components/crm/CrmPipeline.tsx` (`GerenciarEtapas.salvar`)**
- No topo do arquivo, a frente D declara a própria regex:
  ```ts
  // Mesma regra da API na URL e no corpo (8-4-4-4-12 hexadecimal): id que passa aqui passa na rota.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  ```
  É a mesma expressão do `UUID` privado de `src/lib/crm/duplicidade.ts:40`, que continua privado e não é exportado, e a mesma `FORMATO_UUID` da API (§0.2).
- Imports estáticos novos (nenhum dos dois carrega o Supabase): `import { toast } from 'sonner'` e `import { mensagemDeErro } from '@/lib/errors'`.
- `@/lib/api` e `@/lib/api/crm` entram SÓ por import dinâmico, como o Supabase já entra hoje. O `salvar` fica assim:
  ```ts
  const salvar = async () => {
    // Dinâmico de propósito: o teste visual roda em node sem mock do cliente do Supabase.
    const { apiDisponivel } = await import('@/lib/api');
    if (apiDisponivel()) {
      // Itens 'novo-…' não vão: hoje também nunca criam nada.
      const etapas = draft.filter((e) => UUID.test(e.id)).map(({ id, nome, cor, tipo, ordem }) => ({ id, nome, cor, tipo, ordem }));
      if (etapas.length > 0) {
        try {
          const { salvarEtapasApi } = await import('@/lib/api/crm');
          await salvarEtapasApi(etapas);
        } catch (e) {
          toast.error(mensagemDeErro(e, 'Não foi possível salvar as etapas.'));
          return; // diálogo fica aberto com o rascunho; nada foi gravado (rota atômica)
        }
      }
      aoSalvar(); onOpenChange(false);
      return;
    }
    const { supabase } = await import('@/integrations/supabase/client');
    // ...ramo atual, intacto: laço de updates, depois aoSalvar(); onOpenChange(false)
  };
  ```
- **Sem etapa válida** (rascunho vazio ou só com itens `'novo-…'`): não chama a API, mas roda `aoSalvar()` (refetch de etapas e oportunidades) e fecha. É o mesmo fim do laço de hoje.
- **Em erro:** sem `aoSalvar()`, toast com o texto da API ('Já existe uma etapa com este nome.', 'Informe o nome da etapa.' etc.), e o diálogo fica aberto.
- **Botão Excluir da barra de seleção:** não muda. Ele chama `useExcluirOportunidades`, que usa a API (acima).

**`src/lib/crm/cadastroCliente.ts`**
- **`cadastrarOuReaproveitarCliente`:** `const { data, error } = apiDisponivel() ? await comoResultado(criarClienteApi(dados)) : await db.rpc(...)`. O resto fica igual. O `throw error` lança o `ErroApi`, e `message: 'invalid_name'` mantém o `toMatchObject` do teste. Com `VITE_API_URL`, os chamadores (AnalisarContratoDialog e AutoContractDialog) passam a criar o cliente pela API e continuam gravando o contrato pelo Supabase (premissa do §4.0).
- **`completarCpfDoCliente`:** com API, depois do mesmo filtro de dígitos, `await completarCpfApi(clienteId, digitos).catch((e) => console.error('Não foi possível guardar o CPF do cliente:', e))`.

**`src/features/whatsapp-inbox/ConnectedInbox.tsx` (query `client`)**
- Mesma queryKey e mesmo `enabled`.
- Com API: `const c = await obterClienteApi(selected!.cliente_id!)`.
- Devolve `{ nome: c.nome, email: c.email, telefone: c.telefone, created_at: c.created_at, status_funil: c.status_funil, tipo_interesse: c.tipo_interesse }`, com o mesmo tipo de hoje.
- Qualquer erro, inclusive 404, deixa a query em erro, e a tela cai nos fallbacks atuais.
- `fetchConversations` (embed `clientes(nome)`) e as RPCs `lotti_inbox_*` não mudam (§7.1).

**`src/components/imoveis/NovoImovelDialog.tsx` (`handleSubmit`)**
- A checagem de plano no cliente fica.
- Com API, nada de `rpc('get_corretor_id')`:
  ```ts
  imovel = isEditing ? await atualizarImovelApi(imovelToEdit.id, campos) : await criarImovelApi(campos)
  ```
  `campos` é o mesmo objeto montado hoje, sem `corretor_id`: titulo, tipo, finalidade, valor, area_m2, dormitorios, garagem, endereco, bairro, cidade, proprietario_nome, suites e banheiros.
- Fotos, vídeo, toasts, `onCreated` e `fetchImoveis` seguem iguais. Fotos e vídeo continuam no Supabase (premissa do §4.0).
- No catch:
  - se `error instanceof ErroApi && error.status === 402`: toast destrutivo 'Limite de imóveis atingido' / 'Acesse Plano e Assinatura para liberar mais imóveis.', o mesmo da checagem no cliente;
  - senão, o toast atual 'Erro ao salvar imóvel' com `error.message`.

**`src/pages/ImovelDetalhes.tsx`**
- **`fetchImovel`:** com API, `try { setImovel(await obterImovelApi(id) as ImovelData); setLoading(false) } catch (error) { ... }`. O catch é o tratamento atual: console.error, toast 'Imóvel não encontrado' e `navigate('/imoveis')`.
- **`fetchClientesInteressados`:** com API, `const lista = await listarClientesInteressadosApi(id).catch(() => [])`. Só chama `setClientesInteressados(lista)` se `lista.length > 0`, igual a hoje.
- **`handleDelete`:** com API, `try { await removerImovelApi(id) } catch (error) { ... }`.
  - `comContrato = error.code === '23503' && /contratos/.test(error.message ?? '')`;
  - mesmos toasts;
  - em sucesso, 'Imóvel excluído com sucesso' e `navigate('/imoveis')`.
- **`handleToggleAnunciado`:** o otimista continua. Com API, `try { await atualizarImovelApi(imovel.id, { anunciado: checked }) } catch (e) { reverte e toast 'Erro ao atualizar status' com e.message; return }`. Os toasts de sucesso são os mesmos.
- Fotos e vídeos (`useImovelFotos`, `useVideos`) não mudam (§7.1).

**`src/components/imoveis/VendaImovelDialog.tsx`**
- Com API, os passos 1 e 2 viram uma chamada só: `await registrarVendaImovelApi(imovel.id, selectedClienteId !== 'none' ? selectedClienteId : null)`.
- O `cliente_atualizado` da resposta não é lido: hoje a falha do cliente também é ignorada.
- A busca do `cliente` no store para montar o payload continua.
- Os passos 3 e 4 (payload e `webhook_logs` pelo Supabase, mais o fetch do UTMify) NÃO mudam: estão fora do escopo (§7.1).
- O erro cai no catch atual ('Erro ao registrar venda' com `e.message`). Só o imóvel pode gerar erro.

**`src/components/clientes/SeletorImovel.tsx` (`salvar`)**
- Com API, a guarda `corretor?.id` não é necessária: o servidor resolve a conta.
- A guarda `podeSalvar` fica.
- Chama `criarImovelApi({ titulo: titulo.trim(), tipo, valor: numeroValor, endereco: endereco.trim(), cidade: cidade.trim(), proprietario_nome: 'A definir', ativo: true })` e lê `data.id`. O resto é igual.
- O erro aparece por `mensagemDeErro`, já em português: `MSG_TIPO` para RURAL, 'Limite de imóveis atingido. …' para cota, 'O valor não pode ser negativo.' para valor negativo.

### 4.5 Testes do front (D)

Todas as fixtures de uuid estão no formato v4 (§0.5).

**`http.test.ts`:**
1. Códigos do banco viram `message`, com `details` e `code` preenchidos.
2. 400 com array de mensagens:
   - junta os textos;
   - tira o prefixo de campo: `['etapas.0.Informe o nome da etapa.']` vira 'Informe o nome da etapa.';
   - tira as repetições: duas vezes 'Informe o título do imóvel.' vira uma.
3. 500 usa o texto padrão.
4. 204 devolve `undefined`.
5. `escolher` descarta as chaves fora da lista e as `undefined`, e mantém `null`.

**`imoveis.test.ts` e `crm.test.ts`:** siga o padrão de `src/lib/api.test.ts`: `vi.mock('@/integrations/supabase/client', ...)` com sessão falsa, `vi.resetModules`, `vi.stubEnv('VITE_API_URL', ...)`, `import()` dinâmico e `fetch` falso. Confira:
1. caminho, método e corpo exatos;
2. token no cabeçalho;
3. query string de candidatos sem as chaves nulas;
4. id codificado.

**`crmStore.api.test.ts`.** Mocks:
```ts
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true, chamarApi: vi.fn(), listarAlertasApi: vi.fn(), marcarAlertasLidosApi: vi.fn() }));
vi.mock('@/lib/api/crm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/crm')>()), // mantém CHAVES_*
  criarClienteApi: vi.fn(), buscarCandidatosApi: vi.fn(), removerClienteApi: vi.fn(),
  definirImovelDeInteresseApi: vi.fn(), listarClientesApi: vi.fn().mockResolvedValue([]),
}));
```
O `ErroApi` vem de `@/lib/api/http`, que não é mockado. Casos:
1. `addCliente` created;
2. `addCliente` duplicate sem toast;
3. `ErroApi` `duplicate_client_phone` com details → candidatos via `buscarCandidatosApi`;
4. `invalid_name` → toast com 'Informe o nome do cliente.';
5. `removeCliente` 409 → `{ success: false, error }` com `code` '23503';
6. `vincularClienteImovel('x', 'none')` chama com `null`.

**`useCrm.api.test.tsx`:** os mesmos mocks de `@/integrations/supabase/client` e `@/lib/api` (com `importOriginal` em `@/lib/api/crm`). Casos:
1. modo `'completo'` sem chamada de rede;
2. mover com 409 `CONFLITO` → `toast.warning`.

---

## 5. Integração (depois das quatro frentes, feita pelo orquestrador)

1. Em `api/src/app.module.ts`, acrescentar:
   - `import { CrmClientesModule } from './crm/clientes/crm-clientes.module';`
   - `import { CrmFunilModule } from './crm/funil/crm-funil.module';`
   - `CrmClientesModule, CrmFunilModule` no array `imports`.
2. Rodar:
   - `cd api && npx jest && npx tsc --noEmit`
   - `npx vitest run`
3. **Fumaça no ensaio do Railway, só pela API** (curl com token real de uma conta de teste; os usuários foram copiados para o ensaio):
   - GET `/api/imoveis`, `/api/clientes`, `/api/crm/etapas` e `/api/crm/oportunidades`;
   - um mover, para conferir o token de concorrência;
   - **uma venda de ponta a ponta**, para confirmar que a falha do cliente não leva o imóvel junto:
     1. escolher um imóvel de teste da conta: criar por `POST /api/imoveis` ou, se der 402, usar um imóvel já existente da conta de teste no ensaio;
     2. `POST /api/imoveis/:id/venda` com o `cliente_id` de um cliente de teste da conta. Esperado no ensaio de hoje: 200 com `cliente_atualizado: false`, por causa do bug do gatilho (§7.2.2);
     3. `GET /api/imoveis/:id` precisa trazer `status_venda: 'VENDIDO'`. Se não trouxer, a venda está perdendo o imóvel: parar e corrigir antes de seguir;
     4. se o imóvel foi criado na fumaça, apagar com `DELETE /api/imoveis/:id`.

   Nenhum front com `VITE_API_URL` aponta para essa API, porque o banco dela é a cópia (§4.0).
4. **Conferência de banco único.** É obrigatória antes de definir `VITE_API_URL` em qualquer build. No ensaio de hoje ela tem de FALHAR, e o resultado vai para o registro como prova de que o front fica sem a variável. Com o token de uma conta de teste:
   1. `GET /api/crm/oportunidades` e escolher um negócio X; anotar `etapa_id`, `ordem` e `updated_at`.
   2. `PATCH /api/crm/oportunidades/X/mover` com a MESMA `etapa_id`, a mesma `ordem` e o `updated_at` anotado. Nada visível muda: o gatilho `trg_crm_oport_updated_at` grava um `updated_at` novo e, como a etapa não muda, `lotti_inbox_record_crm_stage` não grava evento.
   3. Ler X pelo PostgREST com o mesmo token: `GET {VITE_SUPABASE_URL}/rest/v1/crm_oportunidades?id=eq.X&select=updated_at` (cabeçalhos `apikey` e `Authorization`).
   4. Comparar com o `updated_at` de X num novo `GET /api/crm/oportunidades`:
      - iguais entre si e diferentes do anotado no passo 1: mesmo banco, e `VITE_API_URL` pode ser ligada nesse ambiente;
      - diferentes: bancos separados, e `VITE_API_URL` continua ausente.
5. Registrar:
   - no `AI_HANDOFF.md`: o estado, as validações, o resultado da venda de ponta a ponta e o do passo 4;
   - em `docs/pendencias-migracao.md`: a lista de §7.1, a regra do §4.0 e as pendências da §7.2.

---

## 6. Decisões que mudam comportamento (só com VITE_API_URL)

1. **Modo do CRM:** `useModoCrm` devolve `'completo'` sem sonda. Hoje qualquer erro passageiro deixa a sessão inteira no modo legado.
2. **Zero linhas afetadas vira 404** no update e no delete de imóvel, no switch "anunciado", em `updateCliente` (inclusive o `ultimo_contato` do RegistrarContatoDialog), na venda (passo do imóvel) e em concluir tarefa. Hoje é sucesso silencioso. Continuam como hoje, sem erro: o delete de oportunidades e o completar-CPF.
3. **Vínculo cliente↔imóvel atômico:**
   - 'none' remove o vínculo sem mostrar o toast de erro de hoje;
   - o imóvel precisa ser da mesma conta do cliente, conferência que a policy não faz.
4. **Relógio do servidor (`now()`)** em `data_contato` do histórico e em `concluida_em` das tarefas. Hoje vem do navegador.
5. **GerenciarEtapas atômico:** um nome repetido desfaz tudo e mostra toast com o diálogo aberto. Hoje os erros são ignorados e o diálogo fecha. Itens novos continuam sem ser criados. Sem etapa válida, o diálogo fecha e recarrega como hoje.
6. **Venda em duas transações, na mesma sequência de hoje:** primeiro o imóvel, gravado e confirmado; depois o cliente, num segundo `run`, em melhor esforço. A falha do cliente continua ignorada e não desfaz o imóvel. A diferença é que agora ela aparece na resposta como `cliente_atualizado: false` e no log como SQLSTATE.
7. **Teto de 1000 linhas por lista**, o mesmo max_rows padrão do PostgREST, com desempate por id. Excluir negócios aceita o mesmo teto.
8. **Valor negativo de imóvel recusado** (400 'O valor não pode ser negativo.'). Hoje o SeletorImovel deixa passar.
9. **Cota com HTTP 402** e texto em português. Hoje o usuário vê `PLAN_LIMIT_REACHED:max_imoveis` cru.
10. **SeletorImovel não espera o corretor carregar no store:** o servidor resolve a conta, e um membro de equipe sem linha própria em `corretores` também consegue.
11. **Recusas novas de validação** (400 com texto em português). Hoje todas gravam, salvo onde está indicado:
    - **etapa:**
      - nome vazio ('Informe o nome da etapa.') ou com mais de 60 caracteres ('O nome da etapa pode ter até 60 caracteres.');
      - cor fora de `^[a-z]{2,20}$` (nenhuma etapa tem cor assim hoje: a paleta e a semente usam nomes como blue e slate);
      - ordem fora de 0..1000;
      - mais de 50 etapas num salvar. Nenhuma conta chega perto: a semente cria 9, e a tela não cria etapa. Se acontecer, sai o toast 'Envie no máximo 50 etapas.' e nada é gravado;
    - **cliente (criar, editar, converter lead):**
      - nome com mais de 200 caracteres;
      - telefone com mais de 40. O telefone que a IA lê de um contrato vai cru quando não vira um número válido, e pode passar disso; o mesmo vale para o telefone irrecuperável de um lead. Hoje grava;
      - e-mail com mais de 200, CPF/CNPJ com mais de 40 e observações com mais de 5000;
    - **busca de candidatos:** telefone com mais de 40, e-mail com mais de 200 ou CPF com mais de 40. O `useClientesParecidos` fica em erro e a tela segue sem candidatos; o `donoDoTelefone` cai no fallback;
    - **histórico:** conteúdo com mais de 5000. O registro por WhatsApp corta em 500 e não chega lá;
    - **imóvel:**
      - título com mais de 300, endereço com mais de 500, bairro ou cidade com mais de 200 e nome do proprietário com mais de 300;
      - dormitórios, vagas, suítes ou banheiros acima de 999, e área negativa;
      - valor acima de 9.999.999.999.999,99 e área acima de 99.999.999,99 já falham hoje (22003); agora a recusa vem com texto em português;
      - `ativo` ou `anunciado` null;
    - **excluir negócios:** não há recusa nova. O teto é 1000, igual ao da lista, e o CrmPipeline só seleciona negócios da lista carregada;
    - **uuid:** nenhuma recusa nova. URL e corpo aceitam qualquer 8-4-4-4-12 hexadecimal, como o PostgREST aceita hoje qualquer uuid válido (§0.2).

    Nenhuma tela de hoje manda esses valores no uso normal: o efeito fica nos extremos.
12. **Etapas com a mesma ordem saem por nome** (`order by e.ordem, e.nome, e.id`), como em `lotti_crm_primeira_etapa`. Hoje (`order('ordem')`), a ordem entre elas é a que o banco devolver.
13. **Mensagens de erro em português** em todas as rotas novas, inclusive as de validação. Hoje o usuário vê o texto cru do Postgres ou do PostgREST (violates row-level security policy, PGRST116, invalid input value for enum).

## 7. Fora do escopo e pendências

### 7.1 Fora do escopo desta etapa (continuam no Supabase, ninguém edita)

Todos dependem da premissa do §4.0 quando `VITE_API_URL` estiver ligada.

**Escritas em imoveis e clientes:**

| Onde | O que faz | Por que fica | Vai com o módulo |
|---|---|---|---|
| `src/components/juridico/AnalisarContratoDialog.tsx:232`, `:262`, `:291`, `:329` | `rpc get_corretor_id`; insert em `imoveis` com `corretor_id` do navegador; insert em `contratos`; desfazer que apaga os `imoveis` e `clientes` criados na tentativa | O mesmo `corretor_id` monta o caminho no bucket `documentos` (1ª pasta) e entra no insert de `contratos`, que fica no Supabase. Trocar só o insert do imóvel por `criarImovelApi` não tira o `get_corretor_id` do navegador e dividiria o desfazer entre duas origens. O RLS (WITH CHECK `corretor_id = get_corretor_id()`) já recusa corretor de outra conta. Com `VITE_API_URL`, o cliente é criado pela API (via `cadastroCliente.ts`) e o desfazer o apaga pelo Supabase. | contratos (usará `criarImovelApi`, `removerImovelApi` e `removerClienteApi`) |
| `src/components/rental/AutoContractDialog.tsx:173`, `:210` | `rpc get_corretor_id`; insert em `imoveis` com `corretor_id` do navegador | O mesmo motivo do item acima: o `corretor_id` também serve ao storage, a `contratos` e a `faturas_aluguel`. | contratos / locação |
| `src/components/rental/BillsList.tsx:409`, `:423`, `:429` | lê `telefone, email` de `clientes`; grava `cpf` e completa telefone e e-mail vazios; repete sem o telefone em `duplicate_client_phone` | O `PATCH /api/clientes/:id` não aceita `cpf` (`COLUNAS_EDICAO_CLIENTE`), e o completar-cpf só preenche CPF nulo, sem telefone nem e-mail. É o fluxo de cobrança (Asaas). | financeiro + asaas |
| `src/components/rental/NewContractDialog.tsx:408` | grava `clientes.cpf` por cima do que houver, sem `cpf is null` | Sobrescrever é outra regra; `completarCpfApi` não equivale. Nesta etapa não há rota que sobrescreva CPF. | contratos |
| `src/components/imoveis/OrganizarFotosIA.tsx:43`, `:99` | lê `titulo, tipo, bairro, cidade, descricao` e grava `imoveis.descricao` | Faz parte do fluxo de fotos com IA (Edge Function `analisar-fotos-imovel` e ordem de `imovel_fotos`). Nesta etapa o `PATCH /api/imoveis/:id` não aceita `descricao`. | fotos, vídeos e storage (acrescenta `descricao` a `COLUNAS_EDICAO`) |
| `src/hooks/useOnboarding.ts:100` | `rpc onboarding_executar_acao`, que cria imóvel, cliente, negócio e tarefa e remove dados de exemplo | A RPC é SECURITY DEFINER, idempotente e atômica; partir em rotas perderia isso. | onboarding |
| `src/features/whatsapp-inbox/ConnectedInbox.tsx:310`, `:314` | `rpc lotti_inbox_update_contact` / `lotti_inbox_merge_conversations`, que gravam nome e telefone em `clientes` | Regras próprias da inbox (conflito de telefone, envio pendente). | whatsapp |

**Leituras de imoveis e clientes:**

| Onde | O que lê | Vai com o módulo |
|---|---|---|
| `src/components/juridico/ContratosCentral.tsx:77` (embeds `imoveis(titulo)`, `clientes(nome)` em `contratos`) e `:87-88` (listas `id, titulo, endereco` / `id, nome`) | listas para filtros e rótulos | contratos |
| `src/pages/Juridico.tsx:153-154` | listas `id, nome` / `id, titulo` | contratos |
| `src/components/juridico/DocumentoUploadArea.tsx:117`, `src/components/juridico/EditarDocumentoDialog.tsx:106` | lista `id, titulo, endereco` | documentos |
| `src/components/midias/EditarVideoDialog.tsx:43`, `src/components/midias/VideoUploadArea.tsx:49`, `src/pages/Midias.tsx:61` | lista `id, titulo` | fotos, vídeos e storage |
| `src/components/rental/AutoContractDialog.tsx:80`, `:89` e `src/components/rental/NewContractDialog.tsx:110`, `:135` | listas de clientes (com `cpf` no NewContractDialog) e de imóveis ativos com `proprietario_nome` | contratos / locação |
| `src/features/whatsapp-inbox/ReplySuggestion.tsx:21-23` | `get_corretor_id` e imóveis ativos do corretor, por título, até 200 (filtro só de leitura; o RLS vale igual) | whatsapp (junto com a Edge Function `inbox-suggest`) |
| `src/hooks/useSubscription.ts:93` | contagem de imóveis ativos por `corretor.id`, que alimenta o `checkLimit` do NovoImovelDialog e do AutoContractDialog | assinatura |
| `src/hooks/crm/useContratosDosClientes.ts:52` | `contratos` com embed `imoveis(titulo)`, antes de excluir cliente | contratos |
| `src/features/whatsapp-inbox/ConnectedInbox.tsx:29-45` | embed `clientes(nome)` em `lotti_agent_conversations` | whatsapp |
| `src/features/broadcasts/api.ts:129` | embed `clientes(nome)` via conversas | whatsapp |
| `src/hooks/useFachadas.ts:28` | embed `imovel:imoveis(...)` em `fachadas` | fachadas |

**Outros acessos que tocam os mesmos dados:**
- **Fotos e vídeos do imóvel:** `NovoImovelDialog.tsx:229` e `:235` (`uploadMultipleFotos`, e `uploadVideo` com `get_corretor_id`), `useImovelFotos` e `useVideos` no `ImovelDetalhes`, e `src/pages/Imoveis.tsx:96` (`imovel_fotos`). Vão com fotos, vídeos e storage.
- **`webhook_logs` e UTMify no `VendaImovelDialog`:** vão com a decisão da §7.2.4.
- **`fachada_leads` no `useLeadsPendentes`:** vai com fachadas.
- **`fetchContratos`, `addContrato`, `fetchCorretor`, `updateCorretor`, `fetchAlertas` e `marcarAlertaLido` (ramo Supabase) no crmStore:** vão com contratos, conta e notificações.
- **`get_corretor_id` em outras tabelas:** `CriarFachadaDialog.tsx:162`, `CompartilharVideoDialog.tsx:60`, `useDocumentos.ts:63`, `useFachadas.ts:62`, `useVideos.ts:65` e `FachadasInteligentes.tsx:164/200`. Cada um vai com o seu módulo.

### 7.2 Pendências

1. **Migration: gravar e ler histórico com o mesmo critério.** Em produção, `historico_contatos` só tem duas policies:
   - `historico_corretor_read`: SELECT só para o dono da conta (`corretores.user_id = auth.uid()`);
   - `historico_service_all`: escrita só para service_role.

   Não há policy de INSERT para authenticated. Por isso "Registrar contato" falha hoje pelo Supabase, e `POST /api/clientes/:id/historico` responde 403. A migration decide o critério (só o dono, ou a equipe por `get_corretor_id()`) e aplica o MESMO critério ao INSERT e ao SELECT:
   - **policy de SELECT junto com a de INSERT.** Uma policy só de INSERT que valha para membros deixa o membro gravar sem ver o que gravou: `GET .../historico` volta `[]` e a timeline do ClienteDetalhes fica vazia;
   - **a rota da API não depende da policy de SELECT para gravar.** Ela não usa RETURNING (§2) e monta a resposta com `now()`. Quem reintroduzir RETURNING na rota, ou `.select()` no insert do front, precisa da policy de SELECT valendo para os mesmos usuários do INSERT. Sem ela, o membro recebe 403 (42501 no RETURNING) mesmo podendo gravar;
   - **alternativa:** uma função SECURITY DEFINER que confere o dono do cliente no banco, grava e devolve a linha. Nesse caso a rota passa a chamar a função por `$queryRaw`, e a resposta fica igual.
2. **Migration: gatilho `lotti_inbox_record_legacy_stage`.** O trecho `coalesce(old.status_funil, 'Sem etapa')` faz QUALQUER mudança de `clientes.status_funil` falhar com 22P02. Afeta mover cliente no funil e o cliente da venda (que agora volta `cliente_atualizado: false`, sem afetar o imóvel). Correção: `coalesce(old.status_funil::text, 'Sem etapa')`.
3. **Contratos e corretores no próximo módulo:**
   - fetchContratos, addContrato e updateCorretor. O `addContrato` envia `versao`, `modelo_ia` e `tempo_geracao_ms`, que não existem na tabela, além de tipo 'OUTRO' e `data_inicio` vazia;
   - os itens de contratos da §7.1: insert de imóvel com `corretor_id` do navegador e desfazer de imóvel e cliente nos dois diálogos, CPF sobrescrito no NewContractDialog e CPF/telefone/e-mail no BillsList. Esse módulo decide se cria uma rota que sobrescreve CPF.
4. **`webhook_logs` na venda falha sempre.** A coluna `endpoint_url` não existe e não há policy. Falta decidir o destino do evento de conversão.
5. **SeletorImovel oferece o tipo RURAL,** que não existe no enum. Tirar a opção do front ou criar o valor por migration.
6. **GerenciarEtapas** não cria nem remove etapa de verdade.
7. **Próximos módulos:**
   - `fachada_leads` (useLeadsPendentes);
   - as RPCs `lotti_inbox_*` e o embed `clientes(nome)` do ConnectedInbox, mais o ReplySuggestion;
   - fotos, vídeos e storage, incluindo o OrganizarFotosIA, com `descricao` em `COLUNAS_EDICAO`;
   - onboarding (`onboarding_executar_acao`);
   - assinatura (contagem do useSubscription).
8. **Juntar os três `*.erros.ts`** idênticos em `api/src/prisma/erro-banco.ts`, e junto as três declarações de `FORMATO_UUID`.
9. **Paginação** no lugar do teto de 1000. Quando chegar, o teto do `ExcluirOportunidadesDto` (`LIMITE_LISTA`) tem de ser revisto junto, porque hoje ele acompanha o tamanho máximo da lista.
10. **A virada (fase 6) depende de zerar a §7.1.** Cada linha ali ainda lê ou grava pelo supabase-js no banco do Supabase. Enquanto houver uma, o banco não pode trocar sem quebrar a premissa do §4.0.
11. **Fuso do `to_jsonb`.** O TenantDb não fixa `TimeZone`, então o fuso do `timestamptz` segue o servidor (UTC no Supabase e no Railway). Se isso mudar, acrescentar `set local timezone = 'UTC'` ao TenantDb (fora desta etapa, porque `api/src/prisma` não pode ser editado).
12. **Texto em inglês do forbidNonWhitelisted** ('property x should not exist'). Só aparece com chave fora do DTO, o que o front não manda. Se um dia for preciso, uma `exceptionFactory` global no `main.ts` resolve (fora desta etapa).
13. **Excluir negócios sem aviso de erro.** Nem `useExcluirOportunidades` nem o CrmPipeline têm onError. Qualquer falha (RLS, rede, 500) passa calada hoje e continua calada com a API: o botão volta ao normal e nada some. A correção é um `onError` com `toast.error(mensagemDeErro(e, 'Não foi possível excluir os negócios.'))`. Ela muda também o ramo Supabase, então fica para uma tarefa própria, fora da regra "sem VITE_API_URL nada muda".
