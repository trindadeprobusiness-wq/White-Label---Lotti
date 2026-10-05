# Contrato da API Lotti: módulo financeiro (lançamentos, faturas, repasses e Asaas)

Duas frentes trabalham em paralelo e cada uma só toca os próprios arquivos. Tudo o que elas precisam combinar está fixado aqui: caminhos, DTOs, formato de resposta, códigos de erro, o porte das três Edge Functions e os nomes das funções do front. Nenhuma frente precisa falar com a outra.

**Revisão 1.** Molde: `docs/superpowers/specs/2026-10-04-api-lotti-modulo2-contrato.md` (chamado aqui de "contrato do módulo 2", ou só "M2"). Onde este documento diz "como no M2 §x", a regra de lá vale literalmente e não é repetida.

Fontes lidas para escrever este contrato: o inventário do financeiro (Codex, 2026-10-05), `api/prisma/migrations/0_init/migration.sql`, `api/src/prisma/tenant-db.ts`, `api/test/sql-real/harness.ts`, `src/lib/api.ts`, `src/lib/api/http.ts`, `src/hooks/useFinanceiro.ts`, `src/hooks/useAsaasConnection.ts`, `src/components/rental/*.tsx` e `supabase/functions/{asaas-sync,asaas-conexao,asaas-webhook,_shared}`.

---

## 0. Regras comuns às duas frentes

### 0.1 Quem é dono de quê

| Frente | Arquivos (só estes) |
|---|---|
| **F1** api-financeiro | cria tudo em `api/src/financeiro/**` (lista fechada em §1.1) e `api/test/sql-real/financeiro.test.ts`. |
| **F2** front | cria `src/lib/api/financeiro.ts` e `src/lib/api/financeiro.test.ts`. Edita `src/hooks/useFinanceiro.ts`, `src/hooks/useAsaasConnection.ts`, `src/components/configuracoes/AsaasConnectionPanel.tsx`, `src/components/rental/BillsList.tsx`, `src/components/rental/RepassesList.tsx`, `src/components/rental/DashboardCharts.tsx` e `src/components/rental/DashboardKPICards.tsx`. Pode criar testes novos ao lado desses arquivos (`*.api.test.ts(x)`). |

Nenhuma frente edita:
- `api/src/app.module.ts` (quem liga o `FinanceiroModule` é a integração, §5);
- `api/src/prisma/*`, `api/src/auth/*`, `api/src/config/*`, `api/prisma/*`, `api/src/main.ts`, `api/test/sql-real/harness.ts`;
- `src/lib/api.ts`, `src/lib/api/http.ts`, `src/lib/api/crm.ts`, `src/lib/api/imoveis.ts`;
- qualquer arquivo de outro módulo (`api/src/imoveis`, `api/src/crm`, `api/src/visitas`, `api/src/notificacoes`);
- `supabase/**` (as Edge Functions continuam lá, intactas, até a virada);
- `AI_HANDOFF.md` e `docs/*` (exceto este contrato, que só o arquiteto altera);
- os arquivos de §7.1 (fora do escopo; continuam no Supabase).

Também valem para as duas:
- nenhuma migration (mudança de banco vai para §7.2 com SQL proposto);
- nada de `prisma migrate`, `db push`, `db pull`, `migrate reset`;
- nada de commit, stash ou troca de branch;
- nada contra Supabase, Railway, Asaas ou rede. Nos testes o `fetch` do Asaas é sempre falso (§1.4);
- não ler segredos. Só os NOMES das variáveis aparecem no código e nos testes.

### 0.2 Acesso ao banco (F1)

Vale tudo do M2 §0.2, com estes acréscimos:

**Duas portas para o banco, e só duas.**

| Porta | Arquivo | Papel no Postgres | Quando usar |
|---|---|---|---|
| `TenantDb.run(claims, tx => ...)` | `api/src/prisma/tenant-db.ts` (já existe, não editar) | `authenticated` com as claims do usuário | Toda leitura e escrita pedida pelo usuário: lançamentos, faturas, repasses, estorno, leitura da conexão. Gatilhos que gravam `auth.uid()` (o `ator` de `handle_bill_payment`) e a posse de `estornar_pagamento_fatura` dependem disto. |
| `ServicoDb.run(tx => ...)` | `api/src/financeiro/servico-db.ts` (novo, F1) | `service_role` (BYPASSRLS, sem `sub`) | Só o que hoje a Edge Function faz com o cliente de serviço: ler/gravar `asaas_conexao_segredos`, `salvar_conexao_asaas`, DELETE da conexão, INSERT em `auditoria_financeira`, tudo do webhook (`asaas_webhook_events`, faturas e repasses do evento, `conciliar_transferencia_repasse`, `registrar_alerta_financeiro`). |

`ServicoDb` (código fixo, copie):

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Equivalente ao cliente service_role das Edge Functions: transação com o papel service_role
 * (BYPASSRLS) e claims só com role, sem sub. auth.uid() fica NULL, como no Supabase, e os gatilhos
 * gravam ator 'system'. Use só nos casos da tabela do contrato §0.2.
 */
@Injectable()
export class ServicoDb {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'service_role' })}, true)`;
      await tx.$executeRawUnsafe('set local role service_role');
      return work(tx);
    });
  }
}
```

- O papel `service_role` existe no Supabase e na baseline (`0_init`, linha 20, `BYPASSRLS`), então a mesma linha roda nos dois e no PGlite do harness.
- `ServicoDb` nunca recebe claims e nunca é usado a partir de um valor do corpo sem antes resolver o `corretor_id` pelo `TenantDb` (rotas autenticadas) ou pelo slug + token (webhook).

**Identidade do corretor.** Nas rotas que precisam do `corretor_id` (Asaas, criação de fatura, lançamentos): `select public.get_corretor_id()::text as id` no `TenantDb`. NULL vira `403 { codigo: 'corretor_nao_identificado', message: 'Não foi possível identificar o corretor.' }`. Mesmo critério de `asaas-sync` e `asaas-conexao` (que usam `rpc get_corretor_id` com o cliente do usuário).

**Nenhuma chamada HTTP ao Asaas dentro de um `run`.** Transação aberta esperando a rede segura conexão do pool e, se o Asaas responder depois de um erro do banco, a transação já estaria abortada (M2 §0.2, 25P02). O padrão de toda ação Asaas é:
1. `run` de leitura (TenantDb) → confirma;
2. leitura da credencial (`ServicoDb`) → confirma;
3. chamadas HTTP ao Asaas, fora de qualquer transação;
4. `run` de escrita (TenantDb) com o resultado;
5. `run` de auditoria (`ServicoDb`).
Se o passo 4 ou 5 falhar DEPOIS de o Asaas ter mudado algo, a rota responde `500 { codigo: 'gravacao_pos_asaas', message: 'A operação foi feita no Asaas, mas não consegui registrar aqui. Atualize a página e confira antes de tentar de novo.' }` e loga só `{ sqlstate, codigo, fatura_id }` (decisão D4, §6).

**Formato de resposta.** `to_jsonb(linha)` como no M2 §0.2. Embutidos do PostgREST (`imoveis(...)`, `clientes(...)`, `contratos(imoveis(titulo))`) são montados com subconsulta escalar `(select jsonb_build_object(...) from ... where ...)`, que sob RLS devolve `null` quando a linha relacionada não é visível, igual ao PostgREST com embed não-`!inner`.

**Casts.** Tabela do M2 §0.2, mais:

| Valor | Forma |
|---|---|
| data (`YYYY-MM-DD`) | `${d}::date` |
| limite de período do lançamento (`YYYY-MM-DD` comparado com timestamptz) | `${d}::timestamptz` (o PostgREST faz o mesmo cast; TimeZone UTC) |
| numérico de dinheiro | `${v}::numeric` |
| `mes_referencia` | `${m}::text` (coluna `char(7)`; o Postgres converte) |
| lista de texto (escopos) | `${xs}::text[]` |

**Teto de lista:** `LIMITE_LISTA = 1000` (max_rows do PostgREST), declarado em `financeiro.dto.ts`. Toda ordenação desempata por `id`.

### 0.3 Formato de erro HTTP

Igual ao M2 §0.3: `{ statusCode, codigo, message, ...extras }`, `message` sempre em português; o 400 de validação é o do ValidationPipe e todo decorator leva `{ message: '<português>' }`.

Extras deste módulo:
- `nao_conectado: true` no 409 `ASAAS_NAO_CONECTADO` (paridade com o corpo da Edge Function, que o front já lê pelo código);
- nenhum extra traz chave, token, CPF, e-mail ou corpo do Asaas.

**Códigos Asaas mantêm o nome da Edge Function** (o front compara `codigo`): `ASAAS_NAO_CONECTADO`, `ASAAS_CHAVE_INVALIDA`, `ASAAS_PERMISSOES_INSUFICIENTES`, `ASAAS_REJEITOU_CONEXAO`, `ASAAS_CONEXAO_FALHOU`. Os novos seguem o padrão minúsculo do M2.

### 0.4 Tradutor de erros do banco

`api/src/financeiro/financeiro.erros.ts` contém o código do M2 §0.4 **idêntico** (`ErroPg`, `erroPg`, `erroApi`, `OpcoesErro`, `traduzirErroBanco`), com `entidade?: 'imovel' | 'cliente'` mantido como está (não é usado aqui). Acrescenta, ANTES de chamar `traduzirErroBanco`, o tradutor do estorno:

```ts
/** RAISE EXCEPTION de estornar_pagamento_fatura (P0001, sem ERRCODE). Texto repassado porque já é para o usuário. */
const ESTORNO: Record<string, { status: number; codigo: string }> = {
  'Fatura não encontrada ou sem permissão.': { status: 404, codigo: 'fatura_nao_encontrada' },
  'Só é possível desfazer o pagamento de faturas pagas.': { status: 409, codigo: 'fatura_nao_paga' },
  'O repasse ao proprietário desta fatura já foi executado — não é possível desfazer automaticamente.': { status: 409, codigo: 'repasse_ja_executado' },
};

export function traduzirErroEstorno(e: unknown): never {
  const pg = erroPg(e);
  if (pg?.sqlstate === 'P0001' && ESTORNO[pg.mensagem]) {
    const { status, codigo } = ESTORNO[pg.mensagem];
    throw erroApi(status, codigo, pg.mensagem);
  }
  traduzirErroBanco(e);
}
```

E o erro do Asaas (classes portadas, §2.1):

```ts
export function traduzirErroAsaas(e: unknown): never {
  if (e instanceof AsaasNaoConectado) throw erroApi(409, 'ASAAS_NAO_CONECTADO', e.message, { nao_conectado: true });
  if (e instanceof AsaasError) {
    throw erroApi(e.status === 401 ? 502 : 400, 'asaas_recusou', e.descricao ?? 'O Asaas recusou a operação.');
  }
  throw e;
}
```

`e.descricao` é o `descricaoErroAsaas(body)` portado (primeiro `errors[].description` do Asaas). Paridade com `asaas-sync:520-529`.

### 0.5 Testes da API (F1)

Como no M2 §0.5 (Jest `*.spec.ts` lendo `.text`/`.values` com TenantDb falso; fixtures uuid v4; caso de paridade do `FORMATO_UUID` em cada controller), mais:
- **SQL real** em `api/test/sql-real/financeiro.test.ts`, no estilo de `funil.test.ts`: `criarBanco()`, serviços montados com `banco.db` (TenantDb real) e `new ServicoDb(banco.prisma as unknown as PrismaService)`; dados montados com `banco.inserir`/`banco.sqlSuperusuario`; contas A e B para isolamento. Rodar com `cd api && node --import tsx --test test/sql-real/financeiro.test.ts`.
- **Asaas sempre falso.** `AsaasHttp` recebe `fetch` por construtor (§2.1). Os testes passam um `fetch` falso que registra as chamadas e responde por tabela. Nenhum teste toca rede.
- **Cifra com chave de teste gerada no próprio teste** (`randomBytes(32).toString('hex')`), atribuída a `process.env.ASAAS_TOKEN_ENCRYPTION_KEY` dentro do teste e restaurada no `after`.

---

## 1. Frente F1: api-financeiro (`api/src/financeiro/`)

### 1.1 Estrutura (lista fechada)

```
api/src/financeiro/
  financeiro.module.ts          FinanceiroModule
  financeiro.dto.ts             todos os DTOs + FORMATO_UUID + LIMITE_LISTA
  financeiro.erros.ts           §0.4
  servico-db.ts                 §0.2
  lancamentos.controller.ts     §1.3.A
  lancamentos.service.ts
  faturas.controller.ts         §1.3.B e §1.3.C
  faturas.service.ts            leitura/escrita de faturas no banco
  repasses.controller.ts        §1.3.D
  repasses.service.ts
  asaas/
    asaas.config.ts             leitura das variáveis (§2.0)
    asaas-http.ts               AsaasHttp, AsaasError, AsaasNaoConectado, descricaoErroAsaas
    asaas-crypto.ts             cifrar/decifrar v1 (node:crypto)
    asaas-credencial.ts         resolverCredencial (sem chave global)
    asaas-regras.ts             funções puras portadas: normalizarApiKey, normalizarAmbiente, extrairDadosConta,
                                montarWebhookAsaas, EVENTOS_WEBHOOK_ASAAS, telefoneParaAsaas, vencimentoDaCobranca,
                                encargosDaCobranca, idDoEvento, tokensIguais, somarMeses
    asaas-cobranca.service.ts   porte de asaas-sync (§2.2)
    asaas-conexao.service.ts    porte de asaas-conexao (§2.3)
    asaas-conexao.controller.ts §1.3.E
    asaas-webhook.service.ts    porte de asaas-webhook (§2.4)
    asaas-webhook.controller.ts §1.3.F
    asaas-fila.ts               processador da fila (§2.4.4)
  *.spec.ts                     um por service, controller e asaas/*.ts com lógica
```

`FinanceiroModule`:
```ts
@Module({
  controllers: [LancamentosController, FaturasController, RepassesController, AsaasConexaoController, AsaasWebhookController],
  providers: [SupabaseAuthGuard, ServicoDb, LancamentosService, FaturasService, RepassesService,
    AsaasCobrancaService, AsaasConexaoService, AsaasWebhookService, AsaasFila,
    { provide: FETCH_ASAAS, useValue: globalThis.fetch.bind(globalThis) }],
})
export class FinanceiroModule {}
```
`FETCH_ASAAS` é um `Symbol` exportado de `asaas-http.ts`. `TenantDb` e `PrismaService` vêm do PrismaModule global.

Estrutura Nest como no M2 §0.2: `@UseGuards(SupabaseAuthGuard)` em todos os controllers, MENOS `AsaasWebhookController` (público); `@Claims()`; `ID_DA_ROTA` com `ParseUUIDPipe` e `id_invalido`; rotas estáticas antes das com `:id`; DELETE sem corpo `@HttpCode(204)`; POST que não cria registro `@HttpCode(200)`.

### 1.2 DTOs (`financeiro.dto.ts`)

```ts
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, Max,
} from 'class-validator';

export const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIMITE_LISTA = 1000;
export const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const MES_REFERENCIA = /^(0[1-9]|1[0-2])\/\d{4}$/;
const CATEGORIA = /^[A-Z][A-Z0-9_]{0,59}$/;

export const TIPOS_LANCAMENTO = ['RECEITA', 'DESPESA'] as const;
export const STATUS_LANCAMENTO = ['pago', 'pendente', 'cancelado'] as const;

export class FiltroLancamentosDto {
  @IsOptional() @IsIn(TIPOS_LANCAMENTO, { message: 'Tipo inválido.' }) tipo?: string;
  @IsOptional() @Matches(CATEGORIA, { message: 'Categoria inválida.' }) categoria?: string;
  @IsOptional() @Matches(DATA, { message: 'Data inicial inválida.' }) de?: string;
  @IsOptional() @Matches(DATA, { message: 'Data final inválida.' }) ate?: string;
}

export class CriarLancamentoDto {
  @IsIn(TIPOS_LANCAMENTO, { message: 'Tipo inválido.' }) tipo!: string;
  @Matches(CATEGORIA, { message: 'Categoria inválida.' }) categoria!: string;
  @IsString({ message: 'Informe a descrição.' }) @IsNotEmpty({ message: 'Informe a descrição.' })
  @MaxLength(500, { message: 'A descrição pode ter no máximo 500 caracteres.' }) descricao!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0, { message: 'O valor não pode ser negativo.' }) @Max(9999999999999.99, { message: 'Valor alto demais.' }) valor!: number;
  @Matches(DATA, { message: 'Data inválida.' }) data!: string;
  @IsOptional() @Matches(DATA, { message: 'Data de competência inválida.' }) data_competencia?: string;
  @IsOptional() @IsBoolean({ message: 'Recorrência inválida.' }) recorrente?: boolean;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Contrato inválido.' }) contrato_id?: string;
  @IsOptional() @Matches(FORMATO_UUID, { message: 'Imóvel inválido.' }) imovel_id?: string;
  @IsOptional() @IsIn(STATUS_LANCAMENTO, { message: 'Status inválido.' }) status?: string;
  @IsOptional() @IsBoolean({ message: 'Indicador de DRE inválido.' }) impacta_dre?: boolean;
  @IsOptional() @IsString({ message: 'Grupo do DRE inválido.' }) @MaxLength(60, { message: 'Grupo do DRE inválido.' }) grupo_dre?: string;
  @IsOptional() @IsString({ message: 'Subcategoria inválida.' }) @MaxLength(120, { message: 'Subcategoria inválida.' }) subcategoria?: string;
}

/** Mesmos campos que useFinanceiro.updateLancamento manda hoje. */
export class AlterarLancamentoDto {
  @IsOptional() @IsIn(TIPOS_LANCAMENTO, { message: 'Tipo inválido.' }) tipo?: string;
  @IsOptional() @Matches(CATEGORIA, { message: 'Categoria inválida.' }) categoria?: string;
  @IsOptional() @IsString({ message: 'Informe a descrição.' }) @IsNotEmpty({ message: 'Informe a descrição.' })
  @MaxLength(500, { message: 'A descrição pode ter no máximo 500 caracteres.' }) descricao?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0, { message: 'O valor não pode ser negativo.' }) @Max(9999999999999.99, { message: 'Valor alto demais.' }) valor?: number;
  @IsOptional() @Matches(DATA, { message: 'Data inválida.' }) data?: string;
  @IsOptional() @IsBoolean({ message: 'Recorrência inválida.' }) recorrente?: boolean;
}

export class CriarFaturaDto {
  @Matches(FORMATO_UUID, { message: 'Contrato inválido.' }) contrato_id!: string;
  @Matches(MES_REFERENCIA, { message: 'Mês de referência inválido.' }) mes_referencia!: string;
  @Matches(DATA, { message: 'Vencimento inválido.' }) data_vencimento!: string;
}

export class VencimentoDto {
  @Matches(DATA, { message: 'Vencimento inválido.' }) data_vencimento!: string;
}

export class BaixaDto {
  @Matches(DATA, { message: 'Data de pagamento inválida.' }) data_pagamento!: string;
}

export const ACOES_ASAAS = ['emitir_cobranca', 'atualizar_cobranca', 'receber_em_dinheiro', 'desfazer_recebimento', 'excluir_cobranca'] as const;
export class AcaoAsaasDto {
  @IsIn(ACOES_ASAAS, { message: 'Ação inválida.' }) acao!: (typeof ACOES_ASAAS)[number];
  @IsOptional() @Matches(DATA, { message: 'Data de pagamento inválida.' }) data_pagamento?: string;
}

export class ConectarAsaasDto {
  @IsString({ message: 'Informe a chave de API da Asaas.' }) @IsNotEmpty({ message: 'Informe a chave de API da Asaas.' })
  @MaxLength(512, { message: 'Chave de API inválida.' }) api_key!: string;
  @IsIn(['sandbox', 'producao'], { message: 'Ambiente inválido.' }) ambiente!: 'sandbox' | 'producao';
}
```

- `IsUUID` não aparece (M2 §0.2). `Matches` recusa não-string.
- `corretor_id`, `valor_aluguel`, `status`, `valor_pago`, `external_id` e qualquer coluna fora dos DTOs são recusados pelo `forbidNonWhitelisted` (400). O servidor deriva tudo isso.
- A validação fina da chave (20 a 512, sem espaço) fica em `normalizarApiKey` e responde 400 (§2.3, D10).

### 1.3 Rotas

Prefixo global `api`. Todas exigem JWT, menos §1.3.F.

#### A. Lançamentos (`@Controller('financeiro/lancamentos')`)

| Método e caminho | Entrada | Resposta 2xx | Erros |
|---|---|---|---|
| `GET /api/financeiro/lancamentos` | query `FiltroLancamentosDto` | 200 `Linha[]` | 400 validação; 403 `corretor_nao_identificado` |
| `POST /api/financeiro/lancamentos` | `CriarLancamentoDto` | 201 `Linha[]` (todas as linhas inseridas, na ordem de geração) | 400; 403; tradutor |
| `PATCH /api/financeiro/lancamentos/:id` | `AlterarLancamentoDto` | 200 `Linha` | 400 `nada_para_atualizar` 'Nada para atualizar.'; 404 `lancamento_nao_encontrado` 'Lançamento não encontrado.'; tradutor |
| `DELETE /api/financeiro/lancamentos/:id` | — | 204 | 400 `id_invalido` |

O controller lê a query com `@Query() filtro: FiltroLancamentosDto` (o ValidationPipe global valida a query).

**GET:**
```sql
select to_jsonb(l) as linha from public.lancamentos_financeiros l
 where l.corretor_id = public.get_corretor_id()
   and (${tipo}::text is null or l.tipo = ${tipo}::text)
   and (${categoria}::text is null or l.categoria = ${categoria}::text)
   and (${de}::timestamptz is null or l.data >= ${de}::timestamptz)
   and (${ate}::timestamptz is null or l.data <= ${ate}::timestamptz)
 order by l.data desc, l.id
 limit ${LIMITE_LISTA}::int
```
- `get_corretor_id()` antes do SELECT: se NULL, 403 (o hook hoje não busca sem `corretor.id`).
- Paridade: o hook filtra `eq corretor_id = corretor.id` e o PostgREST compara `'YYYY-MM-DD'` com timestamptz à meia-noite UTC; aqui é o mesmo cast.
- A RLS de hoje só deixa o dono da conta ver (D2). Não contornar.

**POST (porte de `useFinanceiro.addLancamento`, a recorrência passa para o servidor):**
1. `corretorId` por `get_corretor_id()` (NULL → 403).
2. Monta as linhas com a função pura `linhasDoLancamento(dto)` em `lancamentos.service.ts`:
   - linha 1: `{...dto, recorrente: dto.recorrente ?? false, data_competencia: dto.data_competencia || dto.data, status: dto.status || 'pago', impacta_dre: dto.impacta_dre ?? true}`;
   - se `recorrente`: mais 11 linhas, `i = 1..11`, `data = data_competencia = somarMeses(dto.data, i)`, `recorrente: true`, `descricao: \`${dto.descricao} (${i + 1}/12)\``, mesmos `status`/`impacta_dre`;
   - `somarMeses('YYYY-MM-DD', n)` reproduz `date-fns addMonths` sobre `new Date(data + 'T12:00:00')`: soma meses e, se o dia não existe no mês de destino, usa o último dia (31/01 + 1 → 28/02 ou 29/02). Função pura em `asaas-regras.ts`, sem fuso.
3. **Colunas gravadas (D1):** a lista candidata é `COLUNAS_LANCAMENTO = ['tipo','categoria','descricao','valor','data','data_competencia','recorrente','contrato_id','imovel_id','status','impacta_dre','grupo_dre','subcategoria']`. No mesmo `run`, antes do INSERT:
   ```sql
   select column_name::text as c from information_schema.columns
    where table_schema = 'public' and table_name = 'lancamentos_financeiros'
   ```
   e grava só a interseção (as colunas existem em produção se a migration DRE foi aplicada; na baseline não). Isso evita o erro de D1 sem esconder dado: se `status`/`impacta_dre` não existem, não há onde gravá-los. Uma coluna presente no DTO mas ausente no banco é descartada em silêncio e o fato vai para o log como `{ codigo: 'coluna_ausente', coluna }` uma vez por processo.
4. INSERT de todas as linhas num comando só:
   ```sql
   insert into public.lancamentos_financeiros as x (corretor_id, ${alvo})
   select ${corretorId}::uuid, ${origem}
     from jsonb_array_elements(${json}::jsonb) with ordinality e(v, n)
     cross join lateral jsonb_populate_record(null::public.lancamentos_financeiros, e.v) r
    order by e.n
   returning to_jsonb(x) as linha
   ```
   `json` é o array das linhas (só as colunas da interseção). A resposta é a lista na ordem do RETURNING (que segue a ordem de inserção).
5. Erros: `traduzirErroBanco(e)` fora do `run` (42501 da RLS → 403 `sem_permissao`; 23503 → 422 `referencia_invalida`).

**PATCH:** padrão `presentes` + `jsonb_populate_record` do M2 §0.2 com `COLUNAS_EDICAO = ['tipo','categoria','descricao','valor','data','recorrente']`; `where t.id = ${id}::uuid returning to_jsonb(t) as linha`; nenhuma linha → 404.

**DELETE:** `delete from public.lancamentos_financeiros where id = ${id}::uuid` por `$executeRaw`; responde 204 mesmo com 0 linhas (paridade: o supabase-js não acusa DELETE sem alvo).

#### B. Faturas e locação (`@Controller('financeiro')`)

| Método e caminho | Entrada | Resposta 2xx | Erros |
|---|---|---|---|
| `GET /api/financeiro/contratos-ativos` | — | 200 `Linha[]` | — |
| `GET /api/financeiro/locacao/resumo` | — | 200 `{ contratos_ativos: number, soma_valor: number }` | — |
| `GET /api/financeiro/faturas` | — | 200 `Linha[]` | — |
| `POST /api/financeiro/faturas` | `CriarFaturaDto` | 200 `{ id: string, criada: boolean }` | 404 `contrato_nao_encontrado` 'Contrato não encontrado.'; tradutor |
| `PATCH /api/financeiro/faturas/:id/vencimento` | `VencimentoDto` | 200 `Linha` | 404 `fatura_nao_encontrada` 'Fatura não encontrada.' |
| `POST /api/financeiro/faturas/:id/baixa` | `BaixaDto` | 200 `Linha` | 404; 409 `fatura_cancelada` 'Fatura cancelada.' |
| `POST /api/financeiro/faturas/:id/estorno` | — | 200 `{ status: string }` (o texto que a função devolve) | `traduzirErroEstorno` |
| `POST /api/financeiro/faturas/:id/cancelar` | — | 200 `Linha` | 404 |
| `POST /api/financeiro/faturas/:id/reativar` | — | 200 `Linha` | 404 |

Todas no `TenantDb`.

**contratos-ativos** (BillsList :82-89):
```sql
select to_jsonb(c)
    || jsonb_build_object(
         'imoveis', (select jsonb_build_object('titulo', i.titulo, 'endereco', i.endereco, 'proprietario_nome', i.proprietario_nome)
                       from public.imoveis i where i.id = c.imovel_id),
         'clientes', (select jsonb_build_object('nome', k.nome) from public.clientes k where k.id = c.cliente_id)
       ) as linha
  from public.contratos c
 where c.status = 'ATIVO'
 order by c.id
 limit ${LIMITE_LISTA}::int
```

**locacao/resumo** (DashboardCharts :16 e DashboardKPICards :13, que só usam `valor` dos contratos ativos):
```sql
select count(*)::int as contratos_ativos, coalesce(sum(c.valor), 0)::float8 as soma_valor
  from public.contratos c where c.status = 'ATIVO'
```
Sem teto (é agregado). Os cálculos de 10% continuam no front, iguais.

**GET faturas** (BillsList :100): `select to_jsonb(f) as linha from public.faturas_aluguel f order by f.data_vencimento, f.id limit ${LIMITE_LISTA}::int`. Sem filtro além da RLS, como hoje.

**POST faturas (ensureFatura, :464-478).** O servidor lê o contrato e deriva os valores; o front só manda contrato, mês e vencimento:
```sql
with c as (
  select id, cliente_id, imovel_id, corretor_id, valor from public.contratos where id = ${contrato_id}::uuid
), novo as (
  insert into public.faturas_aluguel
    (contrato_id, cliente_id, imovel_id, corretor_id, valor_aluguel, status, data_vencimento, mes_referencia, gerada_por)
  select c.id, c.cliente_id, c.imovel_id, c.corretor_id, c.valor, 'PENDENTE', ${data_vencimento}::date, ${mes_referencia}::text, 'manual'
    from c
  on conflict (contrato_id, mes_referencia) do nothing
  returning id
)
select (select id::text from novo) as novo_id,
       (select f.id::text from public.faturas_aluguel f, c where f.contrato_id = c.id and f.mes_referencia = ${mes_referencia}::text) as existente_id,
       exists(select 1 from c) as tem_contrato
```
- `tem_contrato = false` → 404 `contrato_nao_encontrado`.
- `novo_id` → `{ id: novo_id, criada: true }`; senão `existente_id` → `{ id, criada: false }` (D10: hoje a corrida dá 23505 e erro na tela).
- `existente_id` NULL com `novo_id` NULL (fatura de outro dono que a RLS esconde) → 409 `registro_repetido` 'Já existe uma fatura deste contrato neste mês.'.

**vencimento:** `update public.faturas_aluguel f set data_vencimento = ${d}::date where f.id = ${id}::uuid returning to_jsonb(f) as linha`.

**baixa** (:526-535): 
```sql
update public.faturas_aluguel f
   set status = 'PAGO', data_pagamento = ${data_pagamento}::date, valor_pago = f.valor_total
 where f.id = ${id}::uuid and f.status <> 'CANCELADO'
returning to_jsonb(f) as linha
```
Nenhuma linha: segunda consulta `select status from ... where id` para distinguir 404 de 409 `fatura_cancelada`. `valor_pago = valor_total` do próprio banco (hoje vem de `bill.valor_total` do front, que é a mesma soma). O gatilho `handle_bill_payment` roda com `auth.uid()` do usuário (TenantDb), igual ao PostgREST. A API não cria repasse nem comissão.

**estorno:** `select public.estornar_pagamento_fatura(${id}::uuid) as status` → `{ status }`. Erros por `traduzirErroEstorno` (D2 continua: membro recebe 404 'Fatura não encontrada ou sem permissão.').

**cancelar** (:596-603, fatura sem cobrança): `update ... set status = 'CANCELADO' where id ... returning`. A rota não olha `external_id`; o front só a chama quando não há `externalId`, como hoje.

**reativar** (:626-638): `set status = 'PENDENTE', external_id = null, boleto_url = null, boleto_url_asaas = null, pix_qrcode_text = null`.

#### C. Ações Asaas sobre fatura e saldo (no mesmo `FaturasController`)

| Método e caminho | Entrada | Resposta 2xx | Erros |
|---|---|---|---|
| `POST /api/financeiro/faturas/:id/asaas` | `AcaoAsaasDto` | 200, corpo exato da Edge Function para a ação (§2.2) | §2.2 |
| `GET /api/financeiro/asaas/saldo` | — | 200 `{ balance: number }` ou `{ balance: null, unavailable: true, message: string }` | 409 `ASAAS_NAO_CONECTADO`; 503 `asaas_nao_configurado` |

`GET asaas/saldo` é declarada num controller com prefixo `financeiro` ANTES de qualquer `:id`. Implementação em `AsaasCobrancaService`.

#### D. Repasses (`@Controller('financeiro/repasses')`)

| Método e caminho | Entrada | Resposta 2xx | Erros |
|---|---|---|---|
| `GET /api/financeiro/repasses` | — | 200 `Linha[]` | — |
| `POST /api/financeiro/repasses/:id/confirmar` | — | 200 `Linha` | 404 `repasse_nao_encontrado` 'Repasse não encontrado.' |

GET (RepassesList :25-33):
```sql
select to_jsonb(r) || jsonb_build_object('contratos',
         (select jsonb_build_object('imoveis', (select jsonb_build_object('titulo', i.titulo) from public.imoveis i where i.id = c.imovel_id))
            from public.contratos c where c.id = r.contrato_id)) as linha
  from public.repasses_proprietario r
 order by r.data_prevista asc, r.id
 limit ${LIMITE_LISTA}::int
```

confirmar (D8, decisão em §6):
```sql
update public.repasses_proprietario r
   set status = 'CONFIRMADO', data_transferencia = coalesce(r.data_transferencia, current_date)
 where r.id = ${id}::uuid
returning to_jsonb(r) as linha
```
Sem auditoria nesta etapa (pendência §7.2.6).

#### E. Conexão Asaas (`@Controller('financeiro/asaas/conexao')`)

| Método e caminho | Entrada | Resposta 2xx | Erros |
|---|---|---|---|
| `GET /api/financeiro/asaas/conexao` | — | 200 `{ disponivel: true, conexao: Linha \| null }` | 403 |
| `POST /api/financeiro/asaas/conexao` | `ConectarAsaasDto` | 200 `{ ok: true, balance, aviso, conexao }` (§2.3) | §2.3 |
| `DELETE /api/financeiro/asaas/conexao` | — | 200 `{ ok: true, aviso: string \| null }` | 403; 503 |

GET (useAsaasConnection :45-48), TenantDb:
```sql
select jsonb_build_object('id', c.id, 'ambiente', c.ambiente, 'status', c.status, 'conta_nome', c.conta_nome,
  'conta_email', c.conta_email, 'chave_final', c.chave_final, 'escopos_faltando', to_jsonb(c.escopos_faltando),
  'validada_em', c.validada_em, 'webhook_configurado_em', c.webhook_configurado_em,
  'herdada_do_ambiente', c.herdada_do_ambiente, 'rotacao_pendente', c.rotacao_pendente) as linha
  from public.asaas_conexoes c where c.corretor_id = public.get_corretor_id()
```
O `jsonb_build_object` com timestamptz sai no mesmo formato do `to_jsonb`. Zero linhas → `conexao: null`. `disponivel` é sempre `true` na API (a tabela existe na baseline).

#### F. Webhook (`@Controller('financeiro/asaas/webhook')`, SEM guard)

| Método e caminho | Entrada | Resposta | Erros |
|---|---|---|---|
| `POST /api/financeiro/asaas/webhook?t=<slug>` | corpo JSON do Asaas; cabeçalho `asaas-access-token` (ou `x-hook-token`) | 200 `{ received: true }` ou `{ received: true, duplicate: true }` | 401 `{ statusCode: 401, codigo: 'webhook_recusado', message: 'Não autorizado.' }`; 503 `asaas_nao_configurado` |

`@HttpCode(200)`. O corpo é lido com `@Body() corpo: unknown` e `@Req()` só para os cabeçalhos; sem DTO (o ValidationPipe com whitelist não toca em `unknown`, que não é classe). Detalhes em §2.4.

---

## 2. Porte das Edge Functions

Regra geral: **porte fiel da lógica Deno** dos arquivos citados, trocando apenas (a) `Deno.env` por `asaas.config.ts`, (b) WebCrypto por `node:crypto`, (c) cliente supabase-js por SQL no `TenantDb`/`ServicoDb`, (d) `EdgeRuntime.waitUntil` por `setImmediate` + fila (§2.4.4), (e) as decisões D4, D5, D6 e D10 de §6. Onde o texto abaixo não diz nada, o comportamento é o do arquivo Deno, linha a linha. As funções puras de `_shared/*.ts` são copiadas para `asaas-regras.ts`/`asaas-http.ts` e os testes `_shared/*.test.ts` correspondentes são portados para `*.spec.ts` (mesmos casos).

### 2.0 Variáveis de ambiente (lidas só por `asaas.config.ts`, de `process.env`, a cada chamada)

| Nome | Obrigatória? | Uso | Falta → |
|---|---|---|---|
| `ASAAS_TOKEN_ENCRYPTION_KEY` | para qualquer rota Asaas | AES-256-GCM, 64 hex ou base64 de 32 bytes (mesma chave das Edge Functions) | 503 `asaas_nao_configurado` 'Integração com a Asaas indisponível no momento.' |
| `ASAAS_BASE_URL` | não | sobrescreve a URL só para `producao` | padrões `https://api.asaas.com/v3` e `https://api-sandbox.asaas.com/v3` |
| `ASAAS_WEBHOOK_URL_BASE` | para `conectar` | URL pública da API, sem barra no fim (ex.: `https://api.exemplo.com`). Webhook = `${base}/api/financeiro/asaas/webhook?t=<slug>` (D6) | 503 `asaas_nao_configurado` no `conectar` |
| `ASAAS_PROCESSAR_FILA` | não | `'true'` liga o processador periódico (§2.4.4) | desligado |

**Não são lidas:** `ASAAS_API_KEY`, `ASAAS_PERMITIR_CHAVE_GLOBAL`, `ASAAS_WEBHOOK_TOKEN` (D5), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`. Nenhuma entra em `api/src/config/env.ts`.

Chave mal formada → mesmo 503 (o texto de `normalizarChave` vai só para o log como `codigo: 'chave_cifra_invalida'`, sem a chave).

### 2.1 Base comum

**`asaas-http.ts`** (porte de `_shared/asaas.ts:20-233`):
- `class AsaasError extends Error { status: number; body: unknown; descricao: string | null }`;
- `class AsaasNaoConectado extends Error` com mensagem igual à Deno;
- `class AsaasHttp { constructor(baseUrl: string, apiKey: string, fetchImpl: typeof fetch) ; get/post/put/delete<T>(path, body?) }` com cabeçalhos `access_token`, `Content-Type: application/json`, `User-Agent: Lotti/1.0`; não-2xx → `AsaasError(status, body)`; timeout de 20 s por `AbortSignal.timeout(20000)` (a Edge não tinha; erro de timeout vira `AsaasError(504, null)` → 400 `asaas_recusou` 'O Asaas não respondeu a tempo.');
- `baseUrlPara(ambiente)` idêntica, lendo `ASAAS_BASE_URL` de `asaas.config.ts`.

**`asaas-crypto.ts`**: `cifrar(texto, chave?)` e `decifrar(v1, chave?)`. Formato `v1.` + base64(iv(12) ‖ ciphertext ‖ tag(16)) — é exatamente o que o WebCrypto do Deno produz (o tag vem colado no fim do ciphertext). Implementação com `createCipheriv('aes-256-gcm')`/`getAuthTag`/`setAuthTag`. `normalizarChave` portada igual (hex 64 ou base64/base64url de 32 bytes).

**`asaas-credencial.ts`** (porte de `resolverCredencial`, SEM chave global, D5):
```sql
-- ServicoDb
select c.id::text, c.ambiente, c.status, c.herdada_do_ambiente, s.api_key_ciphertext
  from public.asaas_conexoes c left join public.asaas_conexao_segredos s on s.conexao_id = c.id
 where c.corretor_id = ${corretorId}::uuid
```
1. sem linha → `AsaasNaoConectado`;
2. `status = 'invalida'` → `AsaasNaoConectado`;
3. com ciphertext → `decifrar`; vazio → `AsaasNaoConectado`;
4. sem ciphertext (inclusive `herdada_do_ambiente`) → `AsaasNaoConectado`.
Devolve `{ apiKey, ambiente, conexaoId }`.

### 2.2 `asaas-sync` → `AsaasCobrancaService`

Entradas: `acao(claims, faturaId, dto)` e `saldo(claims)`.

**Identidade:** `get_corretor_id()` no TenantDb (NULL → 403 `corretor_nao_identificado`, texto 'Não foi possível identificar o corretor da sua sessão.' — mantém o texto da Edge).

**saldo:** credencial → `GET /finance/balance` → `{ balance: Number(bal?.balance ?? 0) }`. `AsaasError` 401/403 → 200 `{ balance: null, unavailable: true, message }` com a mesma `message` da Edge (`asaas-sync:148-155`). Outros erros por `traduzirErroAsaas`.

**Leitura da fatura** (TenantDb, mesmo recorte de `faturas_aluguel *, contratos(*), clientes(*), imoveis(*)`):
```sql
select to_jsonb(f) as fatura,
       (select to_jsonb(c) from public.contratos c where c.id = f.contrato_id) as contrato,
       (select to_jsonb(k) from public.clientes k where k.id = f.cliente_id) as cliente,
       (select to_jsonb(i) from public.imoveis i where i.id = f.imovel_id) as imovel
  from public.faturas_aluguel f where f.id = ${faturaId}::uuid
```
Sem linha, ou `fatura.corretor_id !== corretorId` → 404 `fatura_nao_encontrada` 'Fatura não encontrada'. (texto da Edge, sem ponto final).

Por ação (respostas são os corpos JSON da Edge, chave por chave; `avisos` sempre array):

| Ação | Regras (Edge, linhas) | Resposta 200 | Erros próprios |
|---|---|---|---|
| `emitir_cobranca` | `asaas-sync:400-515`. 409 se PAGO ('Fatura já está paga') ou CANCELADO ('Fatura cancelada'). Com `external_id` → `{ ok: true, already: true, ... }` igual à Edge. Sem CPF → 422 `cpf_ausente` 'O inquilino precisa ter CPF cadastrado para emitir a cobrança.'. Cliente Asaas: `asaas_customer_id` → `GET /customers?cpfCnpj=` → `POST /customers`; grava `clientes.asaas_customer_id` num `run` TenantDb próprio (antes do POST de pagamento). Telefone: `PUT /customers/{id}` sem bloquear (falha → aviso). **Antes do `POST /payments`, `GET /payments?externalReference=<fatura.id>`**: se houver cobrança não `DELETED`, reaproveita-a em vez de criar outra (D4). Depois pix, UPDATE e auditoria `COBRANCA_EMITIDA`. | `{ ok: true, external_id, boleto_url, pix, status, avisos }` | 409, 422, `gravacao_pos_asaas` |
| `atualizar_cobranca` | `asaas-sync:195-262`. Mesmos 409 de status. Sem `external_id` → 409 `cobranca_nao_emitida` 'Esta cobrança ainda não foi emitida.'. `GET /payments/{id}` pago → 409 `cobranca_paga` 'Cobrança já foi paga/confirmada — não é possível alterar.'. `PUT` com `{billingType, dueDate, value: valor_total, description, externalReference, fine, interest}`, pix sem bloquear, UPDATE (`data_vencimento, boleto_url_asaas, pix_qrcode_text, asaas_status`), auditoria `COBRANCA_ATUALIZADA`. | corpo da Edge (:252-260) | idem |
| `receber_em_dinheiro` | `asaas-sync:264-315`. `data_pagamento` do DTO (padrão: hoje em America/Sao_Paulo, como a data que o front manda). | `{ ok, sem_cobranca, avisos }` / `{ ok, already, status, avisos }` / `{ ok, status, avisos }` | `gravacao_pos_asaas` |
| `desfazer_recebimento` | `asaas-sync:317-352`. | `{ ok, sem_cobranca, avisos }` / aviso / `{ ok, status, avisos }` | idem |
| `excluir_cobranca` | `asaas-sync:354-398` + `excluirCobrancaNoAsaas`. 409 `fatura_paga` 'Fatura já está paga — use 'Desfazer pagamento' se foi um erro.' / `fatura_cancelada` 'Fatura já está cancelada.'. UPDATE `{CANCELADO, asaas_status 'DELETED', external_id/boleto_url/boleto_url_asaas/pix_qrcode_text = null}` e auditoria `COBRANCA_EXCLUIDA`. | `{ ok: true, avisos: [] }` | idem |

Regras puras portadas em `asaas-regras.ts` (com spec):
- `vencimentoDaCobranca(fatura, contrato, hoje)`: `data_vencimento` ISO válido, senão `mes_referencia` + `dia_vencimento` (padrão 10, limitado ao fim do mês); nunca antes de `hoje`. `hoje` é parâmetro (data em America/Sao_Paulo), para teste determinístico.
- `encargosDaCobranca(contrato)`: `fine = { value: multa_atraso_percentual ?? 0, type: 'PERCENTAGE' }`, `interest = { value: (juros_mora_diario_percentual ?? 0) * 30 }`, sempre enviados.
- `telefoneParaAsaas`, `descricaoErroAsaas` idênticas.

**Escritas e auditoria:**
- UPDATE da fatura: TenantDb (`update public.faturas_aluguel f set ... where f.id = ${id}::uuid returning f.id::text as id`); **zero linhas ou erro → `gravacao_pos_asaas`** (D4).
- Auditoria: ServicoDb,
  ```sql
  insert into public.auditoria_financeira (corretor_id, entidade, entidade_id, acao, dados_antes, dados_depois, origem, ator)
  values (${corretorId}::uuid, 'fatura', ${faturaId}::uuid, ${acao}::text, ${antes}::jsonb, ${depois}::jsonb, 'ui', ${claims.sub}::text)
  ```
  `ator` = `claims.sub` (a Edge grava o id do usuário). Falha → `gravacao_pos_asaas`.
- `clientes.asaas_customer_id`: TenantDb; falha → `gravacao_pos_asaas` (o cliente Asaas existe e será reencontrado por `cpfCnpj` na próxima tentativa).

### 2.3 `asaas-conexao` → `AsaasConexaoService`

**Identidade:** `get_corretor_id()` (TenantDb). NULL → 403 `corretor_nao_identificado`.

**conectar(dto):** porte de `asaas-conexao/index.ts:90-270`, passos 1 a 10 do inventário, com:
- `normalizarApiKey`/`normalizarAmbiente`/`extrairDadosConta` lançando `ErroValidacaoAsaas` (classe nova), traduzido para **400** `chave_invalida` com a mensagem da própria função (D10; hoje vira 500);
- URL do webhook com `ASAAS_WEBHOOK_URL_BASE` (D6);
- `webhookToken` = `randomBytes(36).toString('base64url')`, slug novo = `randomBytes(24).toString('base64url')`, reaproveitando o slug existente quando houver (mesma regra);
- leitura da conexão atual (`id, webhook_id, webhook_slug`) por ServicoDb filtrando `corretor_id`;
- gravação: ServicoDb
  ```sql
  select public.salvar_conexao_asaas(${corretorId}::uuid, ${ambiente}::text, ${status}::text, ${nome}::text, ${email}::text,
    ${cpfCnpj}::text, ${chaveFinal}::text, ${escopos}::text[], ${webhookId}::text, ${slug}::text, ${keyCifrada}::text, ${tokenCifrado}::text)::text as id
  ```
  Falha → apaga o webhook recém-criado (melhor esforço) e responde 500 `ASAAS_CONEXAO_FALHOU` 'Não foi possível salvar a conexão com a Asaas. Tente de novo.';
- mapeamento de erros Asaas igual à Edge: 401 → 400 `ASAAS_CHAVE_INVALIDA`; 403 → 400 `ASAAS_PERMISSOES_INSUFICIENTES`; outros → `ASAAS_REJEITOU_CONEXAO` (502 se ≥500, senão 400); desconhecido → 500 `ASAAS_CONEXAO_FALHOU`. As mensagens são as da Edge.
- Resposta: `{ ok: true, balance, aviso, conexao: { id, ambiente, status, conta_nome, conta_email, chave_final, escopos_faltando, webhook_configurado: true } }`.

**desconectar:** ServicoDb lê `id, webhook_id, webhook_slug`; sem conexão → `{ ok: true, aviso: null }`. Com conexão: credencial, `DELETE /webhooks/{id}` (404 ignorado; outra falha → `aviso` com o texto da Edge); depois `delete from public.asaas_conexoes where corretor_id = ${corretorId}::uuid` (ServicoDb; segredos em cascata). Falha da credencial (chave não decifra) não impede o DELETE local; vira aviso.

**Proibido:** logar `api_key`, token, ciphertext, e-mail ou CPF da conta.

### 2.4 `asaas-webhook` → `AsaasWebhookService`

#### 2.4.1 Origem (porte de `_shared/asaas-origem.ts`)
- Token fornecido: cabeçalho `asaas-access-token`, senão `x-hook-token`.
- **Com `?t=<slug>`:** ServicoDb
  ```sql
  select c.corretor_id::text, s.webhook_token_ciphertext from public.asaas_conexoes c
    join public.asaas_conexao_segredos s on s.conexao_id = c.id where c.webhook_slug = ${slug}::text
  ```
  decifra e compara com `tokensIguais` (SHA-256 dos dois + `timingSafeEqual`). Igual → dono = `corretor_id`.
- **Sem slug:** 401 (D5: o webhook legado global não é portado).
- Recusa → 401 `webhook_recusado`. Falta de chave de cifra → 503.

#### 2.4.2 Recebimento
- `event_id = payload.id ?? sha256Hex(\`${event}:${entidadeId}:${entidadeCriadaEm}\`)` com `entidadeId = payment?.id ?? transfer?.id` e `entidadeCriadaEm = payment?.dateCreated ?? transfer?.dateCreated ?? ''` (`asaas-webhook:515-521`). Função pura `idDoEvento` com spec.
- ServicoDb:
  ```sql
  insert into public.asaas_webhook_events (event_id, event_type, payment_id, payload, status, corretor_id)
  values (${eventId}::text, ${tipo}::text, ${paymentId}::text, ${payload}::jsonb, 'RECEIVED', ${dono}::uuid)
  returning id::text as id
  ```
  23505 → 200 `{ received: true, duplicate: true }` (erro tratado FORA do `run`).
- Responde 200 `{ received: true }` e agenda `setImmediate(() => this.processar(id))`; o `processar` captura tudo e só loga `{ codigo, event_type }`.

#### 2.4.3 `processar(eventRowId)` (porte de `processEvent`, `asaas-webhook:307-500`)
Reserva (ServicoDb, confirma sozinha):
```sql
update public.asaas_webhook_events set status = 'PROCESSING', attempts = attempts + 1
 where id = ${id}::uuid and status in ('RECEIVED', 'FAILED')
returning event_type, payload, corretor_id::text
```
Nenhuma linha → sai. Depois, num **segundo** `run` ServicoDb, toda a lógica do evento (TRANSFER_* e pagamento) exatamente como na Edge, inclusive:
- busca da fatura por `external_id` e depois por `externalReference` (FORMATO_UUID antes do cast), ambas com `and corretor_id = ${dono}::uuid` quando há dono;
- `RECEIVED/CONFIRMED/RECEIVED_IN_CASH`, `OVERDUE`, `DELETED`, `REFUNDED`, transferências, `conciliar_transferencia_repasse`, `registrar_alerta_financeiro` (este com `select public.registrar_alerta_financeiro(...)::text`, pois devolve uuid);
- o UPDATE para PAGO dispara `handle_bill_payment` com `auth.uid()` NULL → ator `'system'`, como hoje;
- **toda escrita confere o resultado** (D4): UPDATE que precisava afetar linha e afetou zero, ou erro, aborta o `run`.
Ao fim, terceiro `run`: `status = 'PROCESSED' | 'IGNORED' | 'FAILED'`, `processed_at = now()`, `last_error` (texto curto do código, nunca payload). Exceção no segundo `run` → `FAILED` com `last_error`.

O alerta de pagamento "sem bloquear" da Edge vai num `run` separado depois do segundo, com erro capturado fora do `run`.

#### 2.4.4 Fila (D3) — `asaas-fila.ts`
- Só liga se `ASAAS_PROCESSAR_FILA === 'true'` (padrão desligado: enquanto as Edge Functions e o `pg_cron` existirem, quem processa é a Edge).
- `OnModuleInit` cria `setInterval` de 60 s (com `unref()`), `OnModuleDestroy` limpa.
- A cada volta, ServicoDb:
  ```sql
  select id::text from public.asaas_webhook_events
   where (status = 'RECEIVED' and received_at < now() - interval '1 minute')
      or (status = 'FAILED' and attempts < 5)
   order by received_at, id limit 20
  ```
  e chama `processar(id)` em sequência. A reserva condicional impede processamento duplo com a Edge ou com outra réplica.
- O sweeper do `pg_cron` (PROCESSING > 10 min → RECEIVED) continua no banco; a API não o reimplementa.

---

## 3. Testes obrigatórios da API (F1)

### 3.1 Jest (`*.spec.ts`, TenantDb/ServicoDb falsos lendo `.text` e `.values`)
1. **Lançamentos:** GET monta os quatro filtros com `::text`/`::timestamptz` e `limit $n::int`; POST não recorrente gera 1 linha com padrões (`status 'pago'`, `impacta_dre true`, `data_competencia = data`); recorrente gera 12 com `(2/12)`..`(12/12)`; `somarMeses('2026-01-31', 1) === '2026-02-28'` e `('2028-01-31',1) === '2028-02-29'`; colunas ausentes no `information_schema` não entram em `alvo`; PATCH vazio → 400 `nada_para_atualizar`; 404 sem linha.
2. **Faturas:** POST manda só `contrato_id`, `mes_referencia`, `data_vencimento` como parâmetros (nenhum valor de dinheiro vem do cliente); `criada:false` quando `novo_id` é null; baixa usa `f.valor_total`; 404 vs 409 cancelada.
3. **Estorno:** cada uma das três mensagens P0001 vira o status/código da tabela de §0.4.
4. **Cripto:** ida e volta; **compatibilidade com WebCrypto** — cifrar com `globalThis.crypto.subtle` (AES-GCM, IV 12, mesmo formato `v1.`), decifrar com `decifrar`, e o inverso; chave hex e base64 aceitas; 31 bytes recusados.
5. **Credencial:** os quatro ramos de §2.1 dão `AsaasNaoConectado`; `herdada_do_ambiente` sem ciphertext NÃO usa variável nenhuma (e o teste define `ASAAS_API_KEY` no `process.env` para provar que é ignorada).
6. **AsaasHttp:** cabeçalhos `access_token` e `User-Agent: Lotti/1.0`; não-2xx → `AsaasError` com `descricao`.
7. **Cobrança:** com `fetch` falso — emitir idempotente (`already`), reaproveita cobrança achada por `externalReference` sem `POST /payments`, 422 sem CPF, 404 de outro corretor ANTES de qualquer chamada `fetch` (o falso conta zero chamadas), UPDATE com 0 linhas depois do `POST /payments` → 500 `gravacao_pos_asaas`; `receber_em_dinheiro` com `RECEIVED` devolve aviso e não chama `receiveInCash`; nenhum teste vê `POST /transfers`.
8. **Conexão:** chave com espaço → 400 `chave_invalida` sem chamar `fetch`; 401 do Asaas → 400 `ASAAS_CHAVE_INVALIDA`; 403 em `/finance/balance` → `sem_permissao` com `['FINANCIAL_TRANSACTION:READ']`; URL do webhook = `${ASAAS_WEBHOOK_URL_BASE}/api/financeiro/asaas/webhook?t=`; sem `ASAAS_WEBHOOK_URL_BASE` → 503; falha do `salvar_conexao_asaas` apaga o webhook criado; os 13 eventos e `NON_SEQUENTIALLY`.
9. **Webhook:** sem slug → 401; token errado → 401; duplicado (23505) → 200 `duplicate`; `idDoEvento` com pagamento e com transferência; reserva sem linha não processa.
10. **Fila:** desligada sem a variável; ligada consulta com `limit 20` e chama `processar`.
11. **Controllers:** `FORMATO_UUID` aceita `11111111-1111-1111-1111-111111111111` no corpo e na URL (paridade, M2 §0.5); `corretor_id` no corpo → 400; webhook sem guard, demais com `SupabaseAuthGuard` (ler metadados).
12. **Logs:** espião no `Logger` prova que `api_key`, token e CPF nunca aparecem.

### 3.2 SQL real (`api/test/sql-real/financeiro.test.ts`)
Obrigatórios, contra o PGlite com a baseline:
1. **Formato:** `GET faturas` devolve chaves snake_case, `valor_total` número, `data_vencimento` 'YYYY-MM-DD', `created_at` com `+00:00`.
2. **Isolamento A×B:** fatura, repasse e lançamento de B não aparecem para A; ação Asaas de A sobre fatura de B → 404 sem `fetch`.
3. **Lançamento na baseline (D1):** POST com `status`/`impacta_dre`/`data_competencia` grava (colunas descartadas), devolve a linha e não falha; recorrente grava 12.
4. **Baixa dispara o gatilho:** depois da baixa existe 1 repasse AGENDADO e 1 lançamento `COMISSAO_LOCACAO`, e a auditoria do gatilho tem `ator` = id do usuário A; segunda baixa não duplica.
5. **Estorno:** depois da baixa, estorno volta a fatura para PENDENTE/ATRASADO e remove repasse e comissão; estorno de não paga → 409 `fatura_nao_paga`.
6. **ensureFatura:** dois POST iguais → `criada: true` e depois `criada: false` com o mesmo id; contrato inexistente → 404.
7. **ServicoDb:** grava em `auditoria_financeira` (que não tem política de INSERT) e lê `asaas_conexao_segredos`; o TenantDb da conta A NÃO lê `asaas_conexao_segredos` (erro 42501 traduzido para 403).
8. **Conexão:** `salvar_conexao_asaas` pelo ServicoDb + `GET conexao` pela conta A traz a linha; conta B vê `null`.
9. **Webhook ponta a ponta** (fetch não usado): conexão de A com token cifrado; evento `PAYMENT_RECEIVED` com `externalReference` = fatura de A → fatura PAGO, repasse criado com ator `'system'`, evento `PROCESSED`; mesmo evento de novo → `duplicate`; evento com slug de A apontando fatura de B → `FAILED`.
10. **Transação:** nenhum teste termina com `transacoes.commitsAbortados > 0`.

---

## 4. Frente F2: front

### 4.0 Premissas
- Vale o M2 §4.0 (um banco só) e a Regra geral: **sem `VITE_API_URL`, todo ramo Supabase atual continua byte a byte**; com ela, cada ponto abaixo usa a API atrás de `apiDisponivel()` (de `@/lib/api`).
- `src/lib/api/financeiro.ts` importa `chamarApi` de `@/lib/api` e `lerJson`, `corpoJson`, `escolher`, `ErroApi` de `@/lib/api/http` (sem editar esses arquivos).
- Testes que já existem e rodam sem `VITE_API_URL` continuam passando sem mudança.
- Comandos: `npx vitest run <arquivos>` e `npx tsc --noEmit -p tsconfig.app.json` (só os erros dos seus arquivos).

### 4.1 `src/lib/api/financeiro.ts` (funções fixas)

```ts
type Linha = Record<string, unknown>;
export const CHAVES_NOVO_LANCAMENTO = ['tipo','categoria','descricao','valor','data','data_competencia','recorrente','contrato_id','imovel_id','status','impacta_dre','grupo_dre','subcategoria'] as const;
export const CHAVES_ALTERAR_LANCAMENTO = ['tipo','categoria','descricao','valor','data','recorrente'] as const;

export function listarLancamentosApi(f?: { tipo?: string; categoria?: string; de?: string; ate?: string }): Promise<Linha[]>;
//   GET /api/financeiro/lancamentos?tipo=&categoria=&de=&ate= (só os definidos, URLSearchParams)
export function criarLancamentoApi(dados: object): Promise<Linha[]>;          // POST, corpo = escolher(dados, CHAVES_NOVO_LANCAMENTO)
export function alterarLancamentoApi(id: string, dados: object): Promise<Linha>; // PATCH, escolher(..., CHAVES_ALTERAR_LANCAMENTO)
export function excluirLancamentoApi(id: string): Promise<void>;               // DELETE

export function listarContratosAtivosApi(): Promise<Linha[]>;
export function resumoLocacaoApi(): Promise<{ contratos_ativos: number; soma_valor: number }>;
export function listarFaturasApi(): Promise<Linha[]>;
export function garantirFaturaApi(a: { contrato_id: string; mes_referencia: string; data_vencimento: string }): Promise<{ id: string; criada: boolean }>;
export function alterarVencimentoApi(id: string, data_vencimento: string): Promise<Linha>;
export function darBaixaApi(id: string, data_pagamento: string): Promise<Linha>;
export function estornarFaturaApi(id: string): Promise<{ status: string }>;
export function cancelarFaturaApi(id: string): Promise<Linha>;
export function reativarFaturaApi(id: string): Promise<Linha>;
export function acaoAsaasApi(id: string, acao: string, extra?: { data_pagamento?: string }): Promise<Record<string, any>>;
export function saldoAsaasApi(): Promise<{ balance: number | null; unavailable?: boolean; message?: string }>;

export function listarRepassesApi(): Promise<Linha[]>;
export function confirmarRepasseApi(id: string): Promise<Linha>;

export function statusConexaoAsaasApi(): Promise<{ disponivel: boolean; conexao: Linha | null }>;
export function conectarAsaasApi(api_key: string, ambiente: 'sandbox' | 'producao'): Promise<Record<string, any>>;
export function desconectarAsaasApi(): Promise<{ ok: boolean; aviso: string | null }>;
```
- Todas usam `encodeURIComponent` nos ids e `lerJson(res, '<texto padrão>')`; textos padrão: 'Não foi possível carregar os lançamentos.', '... salvar o lançamento.', '... carregar as faturas.', '... concluir a operação no Asaas.', '... carregar os repasses.', 'Não foi possível concluir a conexão com a Asaas.'.
- Os erros são `ErroApi` (`message` em português, `codigo` preenchido). `codigo` não está em `CODIGOS_DO_BANCO`, então `message` é o texto da API.

### 4.2 Onde cada tela troca (sempre `if (apiDisponivel()) { API } else { ramo atual intacto }`)

**`useFinanceiro.ts`**
- `fetchLancamentos`: `listarLancamentosApi({ tipo, categoria, de: format(dataInicio,'yyyy-MM-dd'), ate: ... })`. A guarda `if (!corretor?.id) return;` continua antes (paridade).
- `addLancamento`: com API, NÃO monta as 12 linhas no cliente; chama `criarLancamentoApi(novoLancamento)` e usa a lista devolvida exatamente como hoje usa `data` (junta, ordena, devolve `[0]`).
- `updateLancamento` / `deleteLancamento`: `alterarLancamentoApi` / `excluirLancamentoApi`.
- Projeção anual (:203-208): `listarLancamentosApi({ de: '<ano>-01-01', ate: '<ano>-12-31' })`.

**`useAsaasConnection.ts`**
- `buscarStatus`: `statusConexaoAsaasApi()` (o ramo `recursoAindaNaoAplicado` fica só no Supabase).
- `invocar`: `action 'conectar'` → `conectarAsaasApi(api_key, ambiente)`; `'desconectar'` → `desconectarAsaasApi()`. Erro: lança `new Error(e.message)` (a mesma forma de hoje).
- `AsaasConnectionPanel.tsx`: só muda se precisar ler `codigo`; o texto exibido continua sendo `error.message`. Se nada precisar mudar, não editar.

**`BillsList.tsx`**
- contratos ativos (:82) → `listarContratosAtivosApi()`; faturas (:100) → `listarFaturasApi()`.
- `ensureFatura` → `garantirFaturaApi({ contrato_id: bill.contract.id, mes_referencia: bill.mesReferencia || referenceMonthStr, data_vencimento: bill.dueDate.toISOString().split('T')[0] })` e devolve `.id`.
- `chamarAsaas(action, faturaId, extra)` → `acaoAsaasApi(faturaId, action, extra)`; o `catch` continua igual (lê `e.message`).
- baixa (:526) → `darBaixaApi(faturaId, dataPagamento)` (a ordem Asaas-antes-do-banco não muda).
- estorno (:558) → `estornarFaturaApi(bill.id)`.
- excluir sem `externalId` → `cancelarFaturaApi(bill.id)`; com `externalId` → `chamarAsaas('excluir_cobranca', ...)` (já roteado).
- reativar → `reativarFaturaApi(bill.id)`; vencimento → `alterarVencimentoApi(faturaId, newDueDate)`.
- saldo (:744) → `saldoAsaasApi()`; no `catch`, `(e as ErroApi).codigo === 'ASAAS_NAO_CONECTADO'` → mesmo ramo `setNaoConectado(true)`; `unavailable` → mesma nota.
- Storage, `documentos` e `clientes` do mesmo arquivo NÃO mudam (§7.1).

**`RepassesList.tsx`**: lista → `listarRepassesApi()`; confirmar → `confirmarRepasseApi(payoutId)` (o `confirm()` nativo continua; pendência §7.2).

**`DashboardCharts.tsx` / `DashboardKPICards.tsx`**: com API, `resumoLocacaoApi()`; `totalRent`/`totalReceivable = soma_valor`, `activeContracts = contratos_ativos`; os 10% e os gráficos idênticos. Charts e KPI podem importar `@/lib/api` estaticamente (já importam o cliente do Supabase).

### 4.3 Testes do front (F2)
1. `src/lib/api/financeiro.test.ts`: com `chamarApi` mockado, cada função usa o método, caminho e corpo de §1.3 (inclusive query string só com filtros definidos e `encodeURIComponent`); `criarLancamentoApi` descarta chave fora de `CHAVES_NOVO_LANCAMENTO` (ex.: `corretor_id`); erro 409 `ASAAS_NAO_CONECTADO` vira `ErroApi` com `codigo` e `message` em português.
2. `src/hooks/useFinanceiro.api.test.ts(x)`: com `apiDisponivel` = true, `addLancamento` recorrente faz UMA chamada e nenhuma ao supabase; com false, o ramo Supabase é chamado como antes (12 linhas).
3. `src/components/rental/BillsList.api.test.tsx` (ou teste do helper extraído no mesmo arquivo): saldo com `ASAAS_NAO_CONECTADO` mostra o convite; `ensureFatura` usa `garantirFaturaApi`.
4. Nenhum teste existente é editado para passar.

---

## 5. Integração (orquestrador, depois das duas frentes)
1. `api/src/app.module.ts`: `import { FinanceiroModule } from './financeiro/financeiro.module';` e `FinanceiroModule` em `imports`.
2. `cd api && npx jest && npx tsc --noEmit && node --import tsx --test test/sql-real/*.test.ts`; na raiz `npx vitest run`.
3. Variáveis no Railway (só nomes; quem define é o dono): `ASAAS_TOKEN_ENCRYPTION_KEY` (a MESMA das Edge Functions, senão nenhum segredo existente decifra), `ASAAS_WEBHOOK_URL_BASE`, opcionalmente `ASAAS_BASE_URL`. `ASAAS_PROCESSAR_FILA` fica ausente até a virada do webhook (§7.2.4).
4. Fumaça no ensaio, só pela API e só com conta de teste em `sandbox`: `GET /api/financeiro/faturas`, `/repasses`, `/lancamentos`, `/asaas/conexao`, `/asaas/saldo`. Nada de `conectar` contra produção.
5. `VITE_API_URL` segue a regra do M2 §4.0.
6. Registrar no `AI_HANDOFF.md` e em `docs/pendencias-migracao.md`.

---

## 6. Decisões que mudam comportamento (só com `VITE_API_URL` ou só na API)

| # | Decisão | Antes | Depois |
|---|---|---|---|
| D1 | Lançamento grava só colunas que existem | INSERT falha (PGRST204) se a migration DRE não está aplicada | grava as colunas da baseline; `status`/`impacta_dre`/`data_competencia` entram quando existirem |
| D1b | Recorrência no servidor | front monta 12 linhas | API monta, mesma regra |
| D2 | Não corrigido | membro não vê lançamentos nem estorna | igual (pendência §7.2.2) |
| D3 | Fila reprocessa RECEIVED/FAILED | eventos ficam parados | processador opcional, desligado por padrão |
| D4 | Gravação depois do Asaas é conferida | erro ignorado, resposta de sucesso | 500 `gravacao_pos_asaas`; webhook vira FAILED; emitir procura cobrança por `externalReference` antes de criar |
| D5 | Sem chave global nem webhook global | `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` como reserva | 409 `ASAAS_NAO_CONECTADO` / 401. Conexões `herdada_do_ambiente` sem segredo precisam reconectar |
| D6 | URL do webhook da API | `${SUPABASE_URL}/functions/v1/asaas-webhook` | `${ASAAS_WEBHOOK_URL_BASE}/api/financeiro/asaas/webhook`, só para quem conectar pela API |
| D8 | Confirmar repasse grava `data_transferencia` | só status | status + `coalesce(data_transferencia, current_date)` |
| D10a | Chave mal formada | 500 genérico | 400 `chave_invalida` |
| D10b | Corrida na fatura do mês | 23505 na tela | devolve a fatura existente (`criada: false`) |
| D10c | Timeout no Asaas | sem limite | 20 s, 400 com texto |
| — | Baixa recusa fatura CANCELADO | atualizava | 409 `fatura_cancelada` |
| — | Listas com teto 1000 e ordem estável | faturas sem ordem | `data_vencimento, id` (o front reordena no cliente) |

---

## 7. Fora do escopo e pendências

### 7.1 Fora do escopo (continuam no Supabase, ninguém edita)
- `src/components/rental/NewContractDialog.tsx` (:306-336 e :373-384) e `src/components/rental/AutoContractDialog.tsx` (:284-295): criação/recálculo de faturas no fluxo de contrato (módulo de contratos). D9 e o fuso de `toISOString()` (D10) ficam para lá.
- `src/pages/Financeiro.tsx` e `src/components/financeiro/NovoLancamentoDialog.tsx`: continuam usando `useFinanceiro` sem mudança.
- Storage, `documentos` e `clientes` dentro de `BillsList.tsx`.
- `AdminIntegracoes.tsx`, `AdminPagamentos.tsx`, `asaas_checkout_events` (assinatura SaaS).
- As tarefas `pg_cron` (`gerar-faturas-mensais`, `marcar-faturas-atrasadas`, `sweeper-webhook-events`): continuam no banco; a API não as duplica.
- As Edge Functions `asaas-sync`, `asaas-conexao`, `asaas-webhook`: continuam publicadas até a virada.

### 7.2 Pendências
1. **Migration DRE (D1).** A de `supabase/migrations/20260926170000_dre_financeiro_evolucao.sql` falha na baseline (`ALTER TYPE categoria_financeira` inexistente). SQL proposto (não aplicar):
   ```sql
   ALTER TABLE public.lancamentos_financeiros
     ADD COLUMN IF NOT EXISTS data_competencia date,
     ADD COLUMN IF NOT EXISTS data_pagamento date,
     ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','pendente','cancelado')),
     ADD COLUMN IF NOT EXISTS impacta_dre boolean NOT NULL DEFAULT true,
     ADD COLUMN IF NOT EXISTS grupo_dre text,
     ADD COLUMN IF NOT EXISTS subcategoria text,
     ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
     ADD COLUMN IF NOT EXISTS source_id uuid;
   UPDATE public.lancamentos_financeiros SET data_competencia = data::date WHERE data_competencia IS NULL;
   ```
   Antes, conferir em produção (só leitura, pelo dono) se as colunas já existem.
2. **Membros da equipe (D2).** SQL proposto:
   ```sql
   DROP POLICY IF EXISTS <cada uma das 4 políticas> ON public.lancamentos_financeiros;
   CREATE POLICY lancamentos_select ON public.lancamentos_financeiros FOR SELECT TO authenticated USING (corretor_id = (SELECT public.get_corretor_id()));
   CREATE POLICY lancamentos_insert ON public.lancamentos_financeiros FOR INSERT TO authenticated WITH CHECK (corretor_id = (SELECT public.get_corretor_id()));
   CREATE POLICY lancamentos_update ON public.lancamentos_financeiros FOR UPDATE TO authenticated USING (corretor_id = (SELECT public.get_corretor_id())) WITH CHECK (corretor_id = (SELECT public.get_corretor_id()));
   CREATE POLICY lancamentos_delete ON public.lancamentos_financeiros FOR DELETE TO authenticated USING (corretor_id = (SELECT public.get_corretor_id()));
   -- em estornar_pagamento_fatura: trocar a checagem por corretores.user_id = auth.uid() por f.corretor_id = public.get_corretor_id()
   REVOKE EXECUTE ON FUNCTION public.estornar_pagamento_fatura(uuid) FROM PUBLIC, anon;
   ```
3. **Webhooks existentes (D6).** As conexões atuais apontam para o Supabase. Plano: na virada, script do dono (fora da API) que, por conexão, decifra a chave e faz `PUT /webhooks/{id}` com a URL nova, ou pedir reconexão. Até lá a Edge `asaas-webhook` tem de continuar publicada.
4. **Fila (D3).** Ligar `ASAAS_PROCESSAR_FILA` só depois que o webhook apontar para a API.
5. **Conexões herdadas (D5).** Levantar (dono, só leitura) quantas linhas têm `herdada_do_ambiente = true` sem `api_key_ciphertext`; elas param de cobrar pela API até reconectar.
6. **Auditoria da confirmação de repasse (D8)** e troca do `confirm()` nativo por AlertDialog.
7. **CHECKs:** `VALIDATE CONSTRAINT chk_faturas_status` e `CHECK (status IN ('AGENDADO','ENVIADO','CONFIRMADO','ERRO'))` em `repasses_proprietario`, depois de conferir os dados.
8. **Passo do guia (D7):** `GRANT UPDATE (passo_guia) ON public.asaas_conexoes TO authenticated;` quando o front passar a usar.
9. **anon com DML** em faturas/lançamentos/repasses/eventos: revogar (ver `05-permissoes-anon.md`).
10. **Tradutor duplicado:** `financeiro.erros.ts` é a quarta cópia do M2 §0.4; unificar junto com a pendência do M2.
11. **Confirmar o papel `service_role` no banco do Railway** (a baseline cria; conferir que `set local role service_role` funciona com o usuário do `DATABASE_URL` — precisa de `GRANT service_role TO <usuário>`, como já vale para `authenticated`).
