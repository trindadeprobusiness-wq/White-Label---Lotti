# Contrato da API Lotti: fase 4, módulo contratos (contratos, documentos e IA de contratos)

Duas frentes trabalham em paralelo e sem conversar: **API** e **front**. Tudo o que elas precisam combinar está fixado aqui: caminhos, DTOs, respostas, códigos de erro, SQL, porte das Edge Functions e nomes das funções do front. Este contrato herda, sem repetir, as regras do contrato do módulo 2 (`docs/superpowers/specs/2026-10-04-api-lotti-modulo2-contrato.md`, abreviado **M2**). Onde este texto não diz nada, vale o M2. Onde diz diferente, vale este.

**Revisão 1** (2026-10-05). Base: inventário do módulo contratos, baseline `api/prisma/migrations/0_init/migration.sql` (**MIG**), Edge Functions `supabase/functions/gerar-contrato` e `supabase/functions/analisar-contrato`.

---

## 0. Regras comuns

### 0.1 Quem é dono de quê

| Frente | Arquivos (só estes) |
|---|---|
| **API** | cria tudo em `api/src/contratos/**` e `api/test/sql-real/contratos.test.ts`. Arquivos fixados: `contratos.module.ts` (classe `ContratosModule`), `contratos.controller.ts`, `contratos.service.ts`, `contratos.dto.ts`, `documentos.controller.ts`, `documentos.service.ts`, `documentos.dto.ts`, `contratos-ia.controller.ts`, `contratos-ia.service.ts`, `contratos-ia.dto.ts`, `contratos.erros.ts`, `ia/gemini.ts`, `ia/cota.ts`, `ia/prompts.ts`, `ia/dados-externos.ts`, `ia/extenso.ts`, `ia/sanitizar.ts`, e os specs `*.spec.ts` ao lado de cada um. |
| **Front** | cria `src/lib/api/contratos.ts` e `src/lib/api/contratos.test.ts`; edita `src/components/juridico/{AnalisarContratoDialog,ContratosCentral,DocumentoUploadArea,DocumentoViewer,EditarDocumentoDialog,GerarContratoDialog}.tsx`, `src/components/rental/{AutoContractDialog,NewContractDialog,ContractsList,ContractUpload}.tsx`, `src/hooks/useDocumentos.ts`, `src/hooks/crm/useContratosDosClientes.ts`, `src/services/contractExtractionService.ts`, `src/pages/Juridico.tsx` e, em `src/stores/crmStore.ts`, **só** `fetchContratos` e `addContrato`. Pode criar testes novos `*.api.test.ts(x)` ao lado desses arquivos. |

Ninguém edita:
- `api/src/app.module.ts`, `api/src/main.ts`, `api/src/prisma/*`, `api/src/auth/*`, `api/src/config/*`, `api/prisma/*`, `api/test/sql-real/harness.ts`;
- `src/lib/api.ts`, `src/lib/api/http.ts`, `src/lib/api/crm.ts`, `src/lib/api/imoveis.ts`, `src/lib/crm/*`, `AI_HANDOFF.md`, `docs/*`;
- arquivos de outro módulo, inclusive `BillsList.tsx`, `DashboardKPICards.tsx`, `DashboardCharts.tsx`, `useSubscription.ts`, `GlobalSearch` e o resto de `crmStore.ts` (§7.1).

Também valem para as duas: nenhuma migration; nada de `prisma migrate/db push/db pull`; nada de commit, stash ou troca de branch; nada contra Supabase, Railway ou rede (os testes nunca chamam o Gemini de verdade: `fetch` é sempre falso).

`ContratosCentral.tsx`, `DocumentoViewer.tsx` e `ContractUpload.tsx` estão na lista do front, mas os dois últimos só usam Storage, que fica no Supabase (§4.0). Eles não mudam, salvo o que §4.4 disser.

### 0.2 Banco, SQL, uuid, erros e logs

Valem **literalmente** M2 §0.2, §0.3 e §0.5, com estes acréscimos:

**Casts extras** (além da tabela do M2 §0.2):

| Valor | Forma |
|---|---|
| dinheiro e percentuais (valor, valor_aluguel, taxas) | `${n}::numeric` |
| data sem hora | `${d}::date` |
| enum de contrato | `${t}::public.tipo_contrato` |
| lista de uuid | `${ids}::uuid[]` (já no M2) |

**FORMATO_UUID** igual ao M2, declarado em `contratos.dto.ts` e importado por `documentos.dto.ts`. Nenhum `IsUUID`.

**Datas sem hora no corpo:** `@Matches(FORMATO_DATA, { message })` com `const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;`. A validade de calendário (31/02) fica para o banco (22008 → 400 `dados_invalidos`). `data_validade` de documentos é timestamptz e usa `@IsISO8601({}, { message })`.

**`corretor_id` nunca vem do cliente.** Vem de `select public.get_corretor_id()::text as id` no mesmo `run`. Null → `403 corretor_nao_identificado 'Não foi possível identificar o corretor.'`.

**Pertencimento das FKs.** A checagem de FK ignora RLS. Por isso, toda rota que grava `cliente_id` ou `imovel_id` confere antes, no mesmo `run`, que a linha é visível pelo RLS:

```ts
const [{ n }] = await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`select count(*)::int as n from public.clientes where id = ${id}::uuid`);
if (n === 0) throw erroApi(422, 'cliente_invalido', 'Cliente não encontrado nesta conta.');
// idem public.imoveis → 422 imovel_invalido 'Imóvel não encontrado nesta conta.'
```
Valor null ou ausente não é conferido.

**LIMITE_LISTA = 1000**, exportado de `contratos.dto.ts`. Toda listagem desempata por `id`.

**`updated_at` de contratos.** A tabela não tem gatilho (inventário D15). Todo UPDATE de contrato feito pela API escreve `updated_at = now()` no próprio SQL (sem parâmetro). `documentos` não tem a coluna e a API **nunca** a escreve.

**Erro dentro do `run`:** a regra do M2 §0.2 vale sem exceção. A rota de locação grava contrato e fatura no MESMO `run` (atômico, §6).

### 0.3 Formato de erro

O do M2 §0.3: `{ statusCode, codigo, message, ...extras }`. Todo decorator leva `{ message: '<português>' }`.

### 0.4 Tradutor de erros (`api/src/contratos/contratos.erros.ts`)

Copie **idêntico** o código do M2 §0.4 (`ErroPg`, `erroPg`, `erroApi`, `OpcoesErro`, `traduzirErroBanco`), trocando só o ramo de `PLAN_LIMIT_REACHED` por:

```ts
if (mensagem.startsWith('PLAN_LIMIT_REACHED:')) {
  const recurso = mensagem.slice('PLAN_LIMIT_REACHED:'.length);
  throw erroApi(402, 'PLAN_LIMIT_REACHED', recurso === 'max_contratos_locacao'
    ? 'Limite de contratos de locação atingido. Acesse Plano e Assinatura para liberar mais contratos.'
    : 'Limite do plano atingido. Acesse Plano e Assinatura.', { recurso });
}
```

O resto fica igual. `entidade` não é usada neste módulo (contrato não é bloqueado por contrato). Opções usadas:
- rotas de contratos: `{ semPermissao: 'Você não tem permissão para alterar contratos desta conta.' }`;
- rotas de documentos: `{ semPermissao: 'Você não tem permissão para gerenciar documentos desta conta.' }`.

Tabela do que este módulo realmente encontra:

| Postgres | Onde | HTTP | codigo |
|---|---|---|---|
| P0001 `PLAN_LIMIT_REACHED:max_contratos_locacao` | gatilho `contratos_limite_plano` (locação ATIVO) | 402 | `PLAN_LIMIT_REACHED` (+ `recurso`) |
| 42501 | RLS de documentos para membro de equipe (D3) | 403 | `sem_permissao` |
| 22P02 / 22008 / 23502 / 22003 | enum, data, NOT NULL, numeric(15,2) | 400 | `dados_invalidos` |
| 23503 | FK (cliente/imóvel apagado entre a checagem e o insert) | 422 | `referencia_invalida` |
| 23505 | `uq_fatura_contrato_mes` (impossível em contrato novo; tratado por segurança) | 409 | `registro_repetido` (`repetido: 'Já existe fatura deste contrato para este mês.'`) |

### 0.5 Variáveis de ambiente novas (lidas por `process.env` dentro do módulo)

| Nome | Obrigatória | Uso |
|---|---|---|
| `GEMINI_API_KEY` | só para as rotas `ia/*` | sem ela: `503 { codigo: 'ia_indisponivel', message: 'A IA de contratos está indisponível no momento.' }`, ANTES de reservar cota |
| `LOTTI_AI_FAST_MODEL` | não | modelo; padrão `'gemini-2.5-flash'` (mesmo de `_shared/ai/provider.ts`) |

Lidas a cada chamada (`process.env.X?.trim()`), não em `env.ts` (que não pode ser editado). Valor vazio conta como ausente. Nunca logar o valor.

---

## 1. API: estrutura

```ts
@Module({
  controllers: [ContratosIaController, ContratosController, DocumentosController],
  providers: [ContratosService, DocumentosService, ContratosIaService, SupabaseAuthGuard],
})
export class ContratosModule {}
```

- `ContratosIaController` vem primeiro no array (rotas `contratos/ia/*` registradas antes de `contratos/:id`).
- Todos os controllers: `@UseGuards(SupabaseAuthGuard)`, `@Claims() claims`, ids por `ParseUUIDPipe` com `exceptionFactory: () => erroApi(400, 'id_invalido', 'Identificador inválido.')`.
- `ContratosService` e `DocumentosService` recebem só `TenantDb`. `ContratosIaService` recebe `TenantDb` **e** `PrismaService` (único uso permitido de `PrismaService`, §3.3).
- Rotas estáticas antes de `:id`.

### 1.1 Constantes (`contratos.dto.ts`)

```ts
export const LIMITE_LISTA = 1000;
export const TIPOS_CONTRATO = ['COMPRA_VENDA','LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL','EXCLUSIVIDADE_VENDA','EXCLUSIVIDADE_LOCACAO','DISTRATO','PROCURACAO'] as const; // enum tipo_contrato (MIG:103); SEM 'OUTRO'
export const TIPOS_LOCACAO = ['LOCACAO_RESIDENCIAL','LOCACAO_COMERCIAL'] as const;
export const STATUS_CONTRATO = ['RASCUNHO','ATIVO','VIGENTE','ENCERRADO'] as const; // valores em uso; a coluna não tem CHECK
export const COLUNAS_CRIACAO = ['tipo','cliente_id','imovel_id','valor','data_inicio','data_fim','prazo_meses','dia_vencimento','indice_reajuste','conteudo','status','observacoes','arquivo_url','taxa_administracao_percentual','multa_atraso_percentual','juros_mora_diario_percentual','dia_vencimento_aluguel','dia_repasse_proprietario'] as const;
export const COLUNAS_LOCACAO = ['tipo','cliente_id','imovel_id','valor','data_inicio','dia_vencimento','conteudo','arquivo_url','multa_atraso_percentual','juros_mora_diario_percentual'] as const;
export const COLUNAS_ALTERACAO = ['status','arquivo_url','observacoes','data_fim'] as const;
```

`documentos.dto.ts`:
```ts
export const COLUNAS_DOC_CRIACAO = ['nome','tipo','arquivo_path','arquivo_url','cliente_id','imovel_id','data_validade','observacoes'] as const;
export const COLUNAS_DOC_ALTERACAO = ['nome','tipo','cliente_id','imovel_id','data_validade','observacoes','validado'] as const;
```

---

## 2. API: rotas de contratos e documentos

Mensagens comuns de DTO (use exatamente):
- uuid: `'Cliente inválido.'`, `'Imóvel inválido.'`
- tipo: `'Tipo de contrato inválido.'`
- valor: `'Informe um valor válido.'` (IsNumber, Min 0, Max 9999999999999.99)
- datas: `'Data de início inválida.'`, `'Data de término inválida.'`, `'Data de vencimento inválida.'`
- dia: `'Dia de vencimento inválido.'` (IsInt, Min 1, Max 31)
- percentuais: `'Percentual inválido.'` (IsNumber, Min 0, Max 100)
- textos: `'Texto muito longo.'` (MaxLength) e `'Texto inválido.'` (IsString)
- status: `'Status do contrato inválido.'`

Campos anuláveis usam `@ValidateIf((_, v) => v !== null)` + `@IsOptional()` (aceitam null e gravam NULL). Os demais `@IsOptional()` recusam null pelo decorator de tipo.

### 2.1 Tabela de rotas

Ordem de declaração em `ContratosController` (`@Controller('contratos')`):

| # | Método e caminho | Status | Corpo/consulta | Resposta |
|---|---|---|---|---|
| 1 | `GET /api/contratos` | 200 | — | `Linha[]` (todas as colunas, `to_jsonb`) |
| 2 | `GET /api/contratos/central` | 200 | — | `LinhaCentral[]` |
| 3 | `GET /api/contratos/locacao?tipo=` | 200 | `ListarLocacaoDto` | `LinhaLocacao[]` |
| 4 | `POST /api/contratos/por-clientes` | 200 | `ContratosDosClientesDto` | `LinhaDoCliente[]` |
| 5 | `POST /api/contratos/locacao` | 201 | `CriarLocacaoDto` | `{ contrato: Linha, fatura: Linha }` |
| 6 | `POST /api/contratos` | 201 | `CriarContratoDto` | `Linha` |
| 7 | `PATCH /api/contratos/:id/locacao` | 200 | `EditarLocacaoDto` | `{ contrato: Linha, faturas_emitidas: string[] }` |
| 8 | `PATCH /api/contratos/:id` | 200 | `AlterarContratoDto` | `Linha` |
| 9 | `DELETE /api/contratos/:id` | 204 | — | — |

`DocumentosController` (`@Controller('documentos')`):

| # | Método e caminho | Status | Corpo | Resposta |
|---|---|---|---|---|
| 10 | `GET /api/documentos` | 200 | — | `Linha[]` |
| 11 | `POST /api/documentos` | 201 | `CriarDocumentoDto` | `Linha` |
| 12 | `PATCH /api/documentos/:id` | 200 | `AlterarDocumentoDto` | `Linha` |
| 13 | `DELETE /api/documentos/:id` | 204 | — | — |

`ContratosIaController` (`@Controller('contratos/ia')`), §3:

| # | Método e caminho | Status | Corpo | Resposta |
|---|---|---|---|---|
| 14 | `POST /api/contratos/ia/gerar` | 200 | `GerarContratoIaDto` | `{ contrato, modelo_ia, prompt_version, tempo_geracao_ms }` |
| 15 | `POST /api/contratos/ia/analisar` | 200 | `AnalisarContratoIaDto` | `{ dados }` |

`Linha = Record<string, unknown>` (formato PostgREST, M2 §0.2).

### 2.2 `GET /api/contratos` (substitui `fetchContratos`)

```sql
select to_jsonb(c) as linha from public.contratos c
order by c.created_at desc, c.id
limit ${LIMITE_LISTA}::int
```
Sem filtro de corretor (RLS decide, inclusive "routine organization: contracts read").

### 2.3 `GET /api/contratos/central` (ContratosCentral)

```sql
select jsonb_build_object(
  'id', c.id, 'tipo', c.tipo, 'status', c.status, 'valor', c.valor,
  'data_inicio', c.data_inicio, 'data_fim', c.data_fim, 'observacoes', c.observacoes,
  'arquivo_url', c.arquivo_url, 'imovel_id', c.imovel_id, 'cliente_id', c.cliente_id,
  'created_at', c.created_at,
  'imoveis', case when i.id is null then null else jsonb_build_object('titulo', i.titulo) end,
  'clientes', case when cl.id is null then null else jsonb_build_object('nome', cl.nome) end
) as linha
from public.contratos c
left join public.imoveis i on i.id = c.imovel_id
left join public.clientes cl on cl.id = c.cliente_id
order by c.data_fim asc nulls last, c.id
limit ${LIMITE_LISTA}::int
```
O join roda sob RLS, como o embed do PostgREST: imóvel/cliente invisível vira `null`.

### 2.4 `GET /api/contratos/locacao` (ContractsList)

DTO `ListarLocacaoDto { @IsOptional() @IsIn(TIPOS_LOCACAO, {message:'Tipo de contrato inválido.'}) tipo?: string }`. Padrão `'LOCACAO_RESIDENCIAL'` (o service aplica).

```sql
select to_jsonb(c) || jsonb_build_object(
  'clientes', case when cl.id is null then null else jsonb_build_object('nome', cl.nome, 'telefone', cl.telefone) end,
  'imoveis', case when i.id is null then null else jsonb_build_object('titulo', i.titulo, 'endereco', i.endereco, 'proprietario_nome', i.proprietario_nome) end
) as linha
from public.contratos c
left join public.clientes cl on cl.id = c.cliente_id
left join public.imoveis i on i.id = c.imovel_id
where c.tipo = ${tipo}::public.tipo_contrato
order by c.created_at desc, c.id
limit ${LIMITE_LISTA}::int
```

### 2.5 `POST /api/contratos/por-clientes` (useContratosDosClientes)

DTO: `cliente_ids: string[]` com `@IsArray({message:'Informe os clientes.'})`, `@ArrayMinSize(1, {message:'Informe os clientes.'})`, `@ArrayMaxSize(LIMITE_LISTA, {message:'Clientes demais de uma vez.'})`, `@Matches(FORMATO_UUID, {each:true, message:'Cliente inválido.'})`. POST porque 1000 uuids não cabem numa URL.

```sql
select jsonb_build_object('id', c.id, 'cliente_id', c.cliente_id, 'tipo', c.tipo, 'status', c.status,
  'imoveis', case when i.id is null then null else jsonb_build_object('titulo', i.titulo) end) as linha
from public.contratos c
left join public.imoveis i on i.id = c.imovel_id
where c.cliente_id = any(${ids}::uuid[])
order by c.created_at desc, c.id
limit ${LIMITE_LISTA}::int
```

### 2.6 `POST /api/contratos` (addContrato e AnalisarContratoDialog)

`CriarContratoDto`:

| Campo | Regra |
|---|---|
| `tipo` | obrigatório, `IsIn(TIPOS_CONTRATO)` |
| `cliente_id`, `imovel_id` | opcionais, anuláveis, `Matches(FORMATO_UUID)` |
| `valor` | obrigatório, IsNumber, 0 a 9999999999999.99 |
| `data_inicio` | obrigatório, `Matches(FORMATO_DATA)` |
| `data_fim` | opcional, anulável, `Matches(FORMATO_DATA)` |
| `prazo_meses` | opcional, anulável, IsInt 0..1200 (`'Prazo inválido.'`) |
| `dia_vencimento`, `dia_vencimento_aluguel`, `dia_repasse_proprietario` | opcionais, anuláveis, IsInt 1..31 |
| `indice_reajuste` | opcional, anulável, IsString, MaxLength 50 |
| `conteudo` | obrigatório, IsString (vazio aceito), MaxLength 200000 |
| `status` | opcional, `IsIn(STATUS_CONTRATO)`; ausente → default do banco `'RASCUNHO'` |
| `observacoes` | opcional, anulável, MaxLength 5000 |
| `arquivo_url` | opcional, anulável, MaxLength 1000 |
| `taxa_administracao_percentual`, `multa_atraso_percentual`, `juros_mora_diario_percentual` | opcionais, IsNumber 0..100 |

Não existem no DTO (e dão 400 se vierem): `corretor_id`, `versao`, `modelo_ia`, `tempo_geracao_ms`, `id`, `created_at`, `updated_at`.

SQL num `run`: corretor (§0.2) → pertencimento de `cliente_id`/`imovel_id` → insert do M2:

```sql
insert into public.contratos as x (corretor_id, ${alvo})
select ${corretorId}::uuid, ${origem} from jsonb_populate_record(null::public.contratos, ${json}::jsonb) r
returning to_jsonb(x) as linha
```
`cols = presentes(dto, COLUNAS_CRIACAO)`. Erros: 402 PLAN_LIMIT_REACHED (locação ATIVO acima da cota), 400 `dados_invalidos`, 422 `cliente_invalido`/`imovel_invalido`.

### 2.7 `POST /api/contratos/locacao` (NewContractDialog e AutoContractDialog, criação)

`CriarLocacaoDto`:

| Campo | Regra |
|---|---|
| `tipo` | opcional, `IsIn(TIPOS_LOCACAO)`; ausente → `'LOCACAO_RESIDENCIAL'` (o service põe no json) |
| `cliente_id`, `imovel_id` | **obrigatórios**, `Matches(FORMATO_UUID)` |
| `valor` | obrigatório, IsNumber, `Min(0.01)` (`'Informe um valor válido.'`), Max 9999999999999.99 |
| `data_inicio` | obrigatório, FORMATO_DATA |
| `dia_vencimento` | obrigatório, IsInt 1..31 |
| `conteudo` | obrigatório, IsString, MaxLength 200000 (o JSON de obs/dia_repasse/taxa que a tela já monta) |
| `arquivo_url` | opcional, anulável, MaxLength 1000 |
| `multa_atraso_percentual`, `juros_mora_diario_percentual` | opcionais, IsNumber 0..100 |
| `primeira_fatura` | obrigatório, `@IsObject` + `@ValidateNested` + `@Type(() => PrimeiraFaturaDto)` (`'Informe a primeira fatura.'`) |

`PrimeiraFaturaDto { data_vencimento: FORMATO_DATA; mes_referencia: Matches(/^(0[1-9]|1[0-2])\/\d{4}$/, {message:'Mês de referência inválido.'}) }`.

`status` não vem do cliente: é `'ATIVO'` sempre (como as duas telas hoje).

Um `run` só (atômico):
1. corretor; pertencimento de cliente e imóvel;
2. insert do contrato com `cols = presentes(dto, COLUNAS_LOCACAO)` mais `status` fixo:
   ```sql
   insert into public.contratos as x (corretor_id, status, ${alvo})
   select ${corretorId}::uuid, 'ATIVO', ${origem} from jsonb_populate_record(null::public.contratos, ${json}::jsonb) r
   returning to_jsonb(x) as linha
   ```
3. insert da fatura:
   ```sql
   insert into public.faturas_aluguel as f
     (contrato_id, cliente_id, imovel_id, corretor_id, valor_aluguel, data_vencimento, status, mes_referencia)
   values (${contratoId}::uuid, ${clienteId}::uuid, ${imovelId}::uuid, ${corretorId}::uuid, ${valor}::numeric,
     ${venc}::date,
     case when ${venc}::date <= (now() at time zone 'America/Sao_Paulo')::date then 'ATRASADO' else 'PENDENTE' end,
     ${mes}::text)
   returning to_jsonb(f) as linha
   ```
   `<=` reproduz a regra da tela (`dueDate` à meia-noite `< now`: o próprio dia já conta como atrasado). `gerada_por` fica no default do banco, como hoje.

Resposta 201 `{ contrato, fatura }`. Erros: os da §2.6. Se a fatura falhar, nada é gravado (§6).

### 2.8 `PATCH /api/contratos/:id/locacao` (NewContractDialog, edição)

`EditarLocacaoDto`: os mesmos campos e regras de `CriarLocacaoDto`, **sem** `primeira_fatura`. Todos obrigatórios como lá (a tela sempre manda o objeto inteiro).

Um `run`:
1. `select to_jsonb(c) as linha from public.contratos c where c.id = ${id}::uuid for update` → nenhuma linha: `404 contrato_nao_encontrado 'Contrato não encontrado.'`. Guarde `diaAntigo = Number(linha.dia_vencimento)`;
2. pertencimento de cliente e imóvel;
3. update (padrão M2) com `cols = presentes(dto, COLUNAS_LOCACAO)`, mais `status = 'ATIVO'` e `updated_at = now()` escritos no SQL:
   ```sql
   update public.contratos t set (${alvo}) = (select ${origem} from jsonb_populate_record(null::public.contratos, ${json}::jsonb) r),
     status = 'ATIVO', updated_at = now()
   where t.id = ${id}::uuid returning to_jsonb(t) as linha
   ```
4. sincronização das faturas abertas (porte de `NewContractDialog.tsx:300-345`), com `diaMudou = diaAntigo !== dto.dia_vencimento`:
   ```sql
   update public.faturas_aluguel f set
     valor_aluguel = ${valor}::numeric,
     data_vencimento = case when ${diaMudou}::boolean then
       (to_date(f.mes_referencia, 'MM/YYYY')
         + (least(${dia}::int, extract(day from to_date(f.mes_referencia, 'MM/YYYY') + interval '1 month - 1 day')::int) - 1))::date
       else f.data_vencimento end
   where f.contrato_id = ${id}::uuid and f.status in ('PENDENTE', 'ATRASADO')
   returning f.id::text as id, f.external_id
   ```

Resposta 200 `{ contrato, faturas_emitidas }`, onde `faturas_emitidas` é a lista de `id` das faturas atualizadas com `external_id` não nulo. O front chama `asaas-sync` para elas, como hoje.

### 2.9 `PATCH /api/contratos/:id` (ContractsList: encerrar)

`AlterarContratoDto`: `status?` IsIn(STATUS_CONTRATO); `arquivo_url?` anulável, MaxLength 1000; `observacoes?` anulável, MaxLength 5000; `data_fim?` anulável, FORMATO_DATA. Sem campos → `400 nada_para_atualizar 'Nada para atualizar.'`.

Update padrão M2 com `cols = presentes(dto, COLUNAS_ALTERACAO)` e `, updated_at = now()`. Zero linhas → 404 `contrato_nao_encontrado`. Reativar locação acima da cota → 402.

### 2.10 `DELETE /api/contratos/:id`

```sql
delete from public.contratos where id = ${id}::uuid returning id::text as id
```
Zero linhas → 404 `contrato_nao_encontrado`. As faturas e renegociações vão junto por CASCADE, como hoje (§6, §7.2).

### 2.11 Documentos

**GET:** `select to_jsonb(d) as linha from public.documentos d order by d.created_at desc, d.id limit ${LIMITE_LISTA}::int`.

**POST** `CriarDocumentoDto`:

| Campo | Regra |
|---|---|
| `nome` | obrigatório, IsString, IsNotEmpty (`'Informe o nome do documento.'`), MaxLength 255 |
| `tipo` | obrigatório, IsString, IsNotEmpty (`'Informe o tipo do documento.'`), MaxLength 100 |
| `arquivo_path` | obrigatório, IsString, IsNotEmpty (`'Arquivo inválido.'`), MaxLength 1000 |
| `arquivo_url` | opcional, anulável, MaxLength 2000 |
| `cliente_id`, `imovel_id` | opcionais, anuláveis, FORMATO_UUID |
| `data_validade` | opcional, anulável, IsISO8601 (`'Data de validade inválida.'`) |
| `observacoes` | opcional, anulável, MaxLength 5000 |

Um `run`: corretor → `arquivo_path` tem de começar com `${corretorId}/`, senão `422 arquivo_invalido 'O arquivo não pertence a esta conta.'` → pertencimento → insert padrão M2 com `(corretor_id, validado, ${alvo})` e `select ${corretorId}::uuid, false, ${origem} ...`. Resposta 201 `Linha`.

**PATCH** `AlterarDocumentoDto`: os campos de `COLUNAS_DOC_ALTERACAO`, todos opcionais, com as regras acima (`nome`/`tipo` não anuláveis) e `validado?` IsBoolean (`'Valor inválido.'`). Sem campos → 400 `nada_para_atualizar`. Pertencimento → update padrão M2 **sem** `updated_at`. Zero linhas → `404 documento_nao_encontrado 'Documento não encontrado.'`.

**DELETE:** `delete from public.documentos where id = ${id}::uuid returning id::text as id`; zero → 404 `documento_nao_encontrado`. O arquivo do Storage é removido pelo front antes, como hoje.

A policy de `documentos` é só do dono da conta (D3). Um membro de equipe recebe 403 `sem_permissao` no POST (WITH CHECK) e lista vazia/404 nas outras rotas, igual ao comportamento atual. A correção é a migration 2 (§7.2).

---

## 3. API: porte das Edge Functions (`contratos-ia.*` e `ia/*`)

### 3.1 Regras do porte

- Porte **fiel** da lógica Deno: prompts, versões de prompt, sanitização, limites e temperaturas são copiados literalmente de `supabase/functions/gerar-contrato/index.ts`, `supabase/functions/analisar-contrato/index.ts`, `supabase/functions/_shared/ai/contracts.ts` (`escapePromptData`, `externalDataBlock`), `_shared/ai/prompt-registry.ts` (`contracts.generation@2026-08-20.1`, `contracts.extraction@2026-08-20.1`) e `_shared/ai/provider.ts` (URLs, corpo das requisições).
- Arquivos: `ia/prompts.ts` (textos e versões), `ia/dados-externos.ts` (`escapePromptData`, `externalDataBlock`), `ia/extenso.ts` (`valorParaExtenso`), `ia/sanitizar.ts` (`asString`, `asNumber`, `asMoney`, `asParte`, `montarIso`, `toIsoDate`, `addDays`, `sanitizeExtraction`, `sanitizeCentral`, `sanitizarPedidoGeracao`), `ia/gemini.ts` (`chatGemini`, `conteudoGemini`), `ia/cota.ts` (`reservarCota`, `finalizarCota`). Todas as funções de `ia/*` exceto `cota.ts` são puras ou recebem `fetch` injetável (`fetchImpl = globalThis.fetch`) para teste.
- Autenticação: a do guard (401 do guard substitui "Unauthorized"/"Invalid session"/"Sua sessão expirou..."). `get_corretor_id()` via `TenantDb.run` → null → 403 `corretor_nao_identificado`.
- CORS e `OPTIONS` deixam de existir (o Nest cuida).
- Logs: só status do provedor, código e tempo. Nunca prompt, base64, resposta da IA ou dados de pessoas.

### 3.2 Gemini (`ia/gemini.ts`)

- `chatGemini({ chave, modelo, mensagens, temperature, timeoutMs })`: `POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, header `Authorization: Bearer <chave>`, corpo `{ model, messages, temperature }` como em `provider.ts`. Sem retentativa (`retries 0`, como a função).
- `conteudoGemini({ chave, modelo, partes, generationConfig, timeoutMs })`: `POST .../v1beta/models/{modelo}:generateContent?key=<chave>` com o corpo da função (`inline_data`, `response_mime_type: 'application/json'`, `temperature 0.1`, `thinkingConfig.thinkingBudget 0`, `maxOutputTokens 8192`).
- Timeout 90 s com `AbortSignal.timeout(90_000)`. Timeout ou erro de rede viram a falha do provedor de cada rota (502).
- Modelo: `process.env.LOTTI_AI_FAST_MODEL?.trim() || 'gemini-2.5-flash'`.

### 3.3 Cota (`ia/cota.ts`): o caminho privilegiado

`reserve_contract_quota` e `finish_contract_quota` só têm EXECUTE para `service_role` (MIG:12755, :13213); o `TenantDb` usa `authenticated` e não chega nelas (D16). Por isso:

```ts
// ÚNICO uso de PrismaService no módulo: fora de transação, com o papel da conexão da API (dono das funções).
reservarCota(prisma, corretorId) =
  prisma.$queryRaw<Array<{ allowed: boolean; reservation_id: string | null; used: number; quota: number | null }>>(Prisma.sql`
    select allowed, reservation_id::text as reservation_id, used, quota from public.reserve_contract_quota(${corretorId}::uuid)`)
finalizarCota(prisma, id, ok) =
  prisma.$executeRaw(Prisma.sql`select public.finish_contract_quota(${id}::uuid, ${ok}::boolean)`)
```
- `corretorId` vem SEMPRE do `get_corretor_id()` resolvido antes no `TenantDb` com as claims. Nunca do corpo.
- `finish` é `void`: usa `$executeRaw` (o `$queryRaw` falharia ao desserializar `void`).
- Fluxo comum às duas rotas:
  1. corretor (TenantDb);
  2. chave do Gemini → ausente: 503 `ia_indisponivel` (sem reservar);
  3. reserva → `allowed=false`: `402 { codigo: 'PLAN_LIMIT_REACHED', message: 'Limite mensal de operações com IA atingido.', recurso: 'ai_contracts_monthly', usado: used, limite: quota }`;
  4. chamada ao Gemini;
  5. sucesso → `finalizarCota(id, true)` e resposta; erro do `finish(true)` só é logado (código), a resposta segue 200;
  6. em `finally`, se reservou e não finalizou com sucesso: `finalizarCota(id, false)` em melhor esforço (erro só logado).

### 3.4 `POST /api/contratos/ia/gerar` (porte de `gerar-contrato`)

`GerarContratoIaDto`:
- `tipo`: IsString, IsNotEmpty, MaxLength 100 (`'tipo de contrato inválido'`);
- `tipoPersonalizado?`: IsString, MaxLength 100;
- `cliente`, `imovel`, `detalhes`: `@IsObject({ message: 'Dados do contrato inválidos.' })` (objetos simples, sem ValidateNested: o whitelist não mexe dentro deles);
- `proprietario?`, `corretor?`: `@IsOptional() @IsObject(...)`.

Depois do DTO, o service aplica as checagens da função com as mesmas mensagens e responde `400 { codigo: 'pedido_invalido', message }`:

| Checagem (como na função) | message |
|---|---|
| `cliente.nome` string, até 200 | `'Nome do cliente inválido'` |
| `imovel.endereco` string, até 500 | `'Endereço do imóvel inválido'` |
| `detalhes.valor` número entre 0 e 1e9 | `'Valor inválido'` |

Sanitização idêntica (remove `<>`, corta nome, endereço, cláusulas a 3000, profissão, estado civil, `proprietario.nome`). **Correção D14:** `proprietario` e `corretor` ausentes são tratados como `{}` (hoje 500).

Chamada: `chatGemini` com o prompt de sistema e o do usuário da função (`externalDataBlock('contract_request', ..., 16000)` e `valorParaExtenso`), `temperature 0.2`.

| Situação | HTTP | codigo | message |
|---|---|---|---|
| provedor 429 | 429 | `ia_limite_requisicoes` | `'Limite de requisições excedido. Tente novamente em alguns minutos.'` |
| provedor 402 | 402 | `ia_sem_creditos` | `'Créditos insuficientes. Adicione créditos à sua conta.'` |
| outro status, timeout, rede | 502 | `ia_falhou` | `'Erro ao gerar contrato. Tente novamente.'` |
| resposta sem `choices[0].message.content` | 502 | `ia_resposta_invalida` | `'Resposta da IA inválida'` |

(A função devolvia 500 nos dois últimos; 502 é a mesma falha com corpo legível.)

Resposta 200: `{ contrato: string, modelo_ia: string, prompt_version: 'contracts.generation@2026-08-20.1', tempo_geracao_ms: number }`.

### 3.5 `POST /api/contratos/ia/analisar` (porte de `analisar-contrato`)

`AnalisarContratoIaDto`:
- `fileBase64`: IsString, IsNotEmpty, MaxLength 15_000_000, todos com `'Arquivo inválido ou muito grande'`;
- `mimeType`: `IsIn(['application/pdf','image/jpeg','image/png','image/webp'], { message: 'Formato inválido. Envie PDF ou imagem (JPG, PNG, WEBP).' })`;
- `modo?`: `IsIn(['central'], { message: 'Modo inválido.' })`.

Prompt `EXTRACTION_PROMPT` ou `CENTRAL_PROMPT` (com `modo==='central'`), idênticos. Saída por `sanitizeExtraction` ou `sanitizeCentral`, idênticos, **inclusive aceitando `'OUTRO'` em `TIPOS_CONTRATO` da IA** (porte fiel; o risco fica com o gravador, §6).

| Situação | HTTP | codigo | message |
|---|---|---|---|
| provedor não ok, timeout, rede | 502 | `ia_falhou` | `'Falha ao analisar o contrato com a IA'` |
| JSON ilegível | 502 | `ia_sem_estrutura` | `'A IA não conseguiu estruturar os dados do contrato'` |
| outra exceção | 500 | padrão do Nest | — |

Resposta 200 `{ dados }`.

**Tamanho do corpo.** O Express do Nest aceita 100 kB por padrão; um PDF de 10 MB em base64 leva 413 antes do DTO. Até a integração (§5) mudar `main.ts`, a rota só funciona com arquivos pequenos. A frente API não contorna isso.

---

## 4. Front

### 4.0 Premissas

Valem M2 §4.0 (um banco só) e a regra geral: **sem `VITE_API_URL`, todo ramo Supabase atual fica byte a byte igual.** Com ela, cada ponto abaixo usa a API atrás de `apiDisponivel()`.

Continuam no Supabase em qualquer caso: login, `supabase.rpc('get_corretor_id')` usado para montar o caminho do Storage, todo o Storage (`upload`, `remove`, `createSignedUrl`, `download`, `getPublicUrl`) e a Edge Function `asaas-sync`.

### 4.1 `src/lib/api/contratos.ts`

Importa `chamarApi` de `@/lib/api` e `lerJson`, `corpoJson`, `escolher`, `ErroApi` de `@/lib/api/http`. Tipos: `type Linha = Record<string, unknown>`.

```ts
export const CHAVES_CRIAR_CONTRATO = ['tipo','cliente_id','imovel_id','valor','data_inicio','data_fim','prazo_meses','dia_vencimento','indice_reajuste','conteudo','status','observacoes','arquivo_url','taxa_administracao_percentual','multa_atraso_percentual','juros_mora_diario_percentual','dia_vencimento_aluguel','dia_repasse_proprietario'] as const;
export const CHAVES_LOCACAO = ['tipo','cliente_id','imovel_id','valor','data_inicio','dia_vencimento','conteudo','arquivo_url','multa_atraso_percentual','juros_mora_diario_percentual'] as const;
export const CHAVES_ALTERAR_CONTRATO = ['status','arquivo_url','observacoes','data_fim'] as const;
export const CHAVES_CRIAR_DOCUMENTO = ['nome','tipo','arquivo_path','arquivo_url','cliente_id','imovel_id','data_validade','observacoes'] as const;
export const CHAVES_ALTERAR_DOCUMENTO = ['nome','tipo','cliente_id','imovel_id','data_validade','observacoes','validado'] as const;
```

| Função | Chamada | Texto padrão do erro |
|---|---|---|
| `listarContratosApi(): Promise<Linha[]>` | `GET /api/contratos` | 'Não foi possível carregar os contratos.' |
| `listarContratosCentralApi(): Promise<Linha[]>` | `GET /api/contratos/central` | idem |
| `listarContratosLocacaoApi(tipo = 'LOCACAO_RESIDENCIAL')` | `GET /api/contratos/locacao?tipo=` (com `encodeURIComponent`) | idem |
| `listarContratosDosClientesApi(ids: string[])` | `[]` sem chamar se `ids` vazio; senão `POST /api/contratos/por-clientes` `{cliente_ids}` | 'Não foi possível verificar os contratos dos clientes.' |
| `criarContratoApi(dados: object): Promise<Linha>` | `POST /api/contratos` com `escolher(dados, CHAVES_CRIAR_CONTRATO)` | 'Erro ao salvar contrato.' |
| `criarLocacaoApi(dados: object, primeiraFatura: { data_vencimento: string; mes_referencia: string })` → `{ contrato: Linha; fatura: Linha }` | `POST /api/contratos/locacao` com `{ ...escolher(dados, CHAVES_LOCACAO), primeira_fatura }` | 'Erro ao salvar contrato.' |
| `editarLocacaoApi(id, dados)` → `{ contrato: Linha; faturas_emitidas: string[] }` | `PATCH /api/contratos/:id/locacao` com `escolher(dados, CHAVES_LOCACAO)` | 'Erro ao salvar contrato.' |
| `alterarContratoApi(id, dados): Promise<Linha>` | `PATCH /api/contratos/:id` com `escolher(dados, CHAVES_ALTERAR_CONTRATO)` | 'Não foi possível alterar o contrato.' |
| `removerContratoApi(id): Promise<void>` | `DELETE /api/contratos/:id` | 'Não foi possível excluir o contrato.' |
| `listarDocumentosApi(): Promise<Linha[]>` | `GET /api/documentos` | 'Não foi possível carregar os documentos.' |
| `criarDocumentoApi(dados): Promise<Linha>` | `POST /api/documentos` com `escolher(..., CHAVES_CRIAR_DOCUMENTO)` | 'Não foi possível salvar o documento.' |
| `alterarDocumentoApi(id, dados): Promise<Linha>` | `PATCH /api/documentos/:id` com `escolher(..., CHAVES_ALTERAR_DOCUMENTO)` | 'Não foi possível atualizar o documento.' |
| `removerDocumentoApi(id): Promise<void>` | `DELETE /api/documentos/:id` | 'Não foi possível excluir o documento.' |
| `gerarContratoIaApi(corpo: object)` → `{ contrato: string; modelo_ia: string; prompt_version: string; tempo_geracao_ms: number }` | `POST /api/contratos/ia/gerar` (corpo como hoje vai à função) | 'Erro ao gerar contrato.' |
| `analisarContratoIaApi(corpo: { fileBase64: string; mimeType: string; modo?: 'central' }): Promise<unknown>` | `POST /api/contratos/ia/analisar`; devolve `json.dados` | 'Erro interno ao analisar contrato' |

Ids na URL sempre com `encodeURIComponent`. Erros sempre por `lerJson` (lança `ErroApi`). `escolher` remove `corretor_id`, `versao`, `modelo_ia`, `tempo_geracao_ms` e qualquer chave fora da lista.

### 4.2 Adaptadores, ponto a ponto

| Arquivo | Hoje (fica igual sem API) | Com `apiDisponivel()` |
|---|---|---|
| `crmStore.ts` `fetchContratos` | select `*` | `listarContratosApi()`; erro → `console.error` como hoje |
| `crmStore.ts` `addContrato` | rpc + insert | `criarContratoApi({ ...contrato, status: 'RASCUNHO' })` (sem rpc; `versao/modelo_ia/tempo_geracao_ms` caem no `escolher`); sucesso → `fetchContratos()` e devolve `id`; erro → `console.error` e `null`, como hoje |
| `GerarContratoDialog.tsx:208` | `functions.invoke('gerar-contrato')` | `gerarContratoIaApi(mesmo corpo)`; qualquer erro → o mesmo fallback `generateLocalContract` |
| `contractExtractionService.ts` `extractContractData` | invoke + fallback | `analisarContratoIaApi({fileBase64, mimeType})`. Fallback pdfjs+IA quando o erro é `TypeError` (rede) ou `ErroApi` com status 404, 413 ou 503. Outro `ErroApi` → `throw new Error(e.message)` |
| `contractExtractionService.ts` `analisarContratoCentral` | invoke, sem fallback | `analisarContratoIaApi({..., modo: 'central'})`; erro → `throw new Error(e.message)` (sem fallback) |
| `ContratosCentral.tsx:76` | select com embeds | `listarContratosCentralApi()`; erro ignorado como hoje (lista vazia) |
| `ContratosCentral.tsx:87-88` e `Juridico.tsx:153-154` | selects de imóveis/clientes | `listarImoveisApi()` / `listarClientesApi()` (módulo 2), mapeados para as mesmas colunas e ordenados no cliente com `localeCompare('pt-BR')` por `titulo`/`nome` |
| `DocumentoUploadArea.tsx:117`, `EditarDocumentoDialog.tsx:106` | select de imóveis | `listarImoveisApi()` mapeado para `id, titulo, endereco`, ordenado por `titulo` |
| `EditarDocumentoDialog.tsx:145` | update com `updated_at` | `alterarDocumentoApi(id, campos)` (sem `updated_at`) |
| `useDocumentos.ts` | select/insert/delete/update | lista: `listarDocumentosApi()`; upload: Storage igual e depois `criarDocumentoApi(...)`; excluir: Storage igual e depois `removerDocumentoApi(id)`; validar: `alterarDocumentoApi(id, { validado })`; editar: `alterarDocumentoApi(id, campos)`. Toasts iguais |
| `useContratosDosClientes.ts:52` | select `.in` | `listarContratosDosClientesApi(ids)`; erro lançado para o React Query |
| `ContractsList.tsx` | select/delete/update | lista: `listarContratosLocacaoApi('LOCACAO_RESIDENCIAL')`; excluir: `removerContratoApi`; encerrar: `alterarContratoApi(id, { status: 'ENCERRADO' })`. Toasts e `reload` iguais |
| `NewContractDialog.tsx:110,:135` | selects | `listarClientesApi()` (`id, nome, cpf`) e `listarImoveisApi()` filtrando `ativo === true` (`id, titulo, proprietario_nome, endereco`) |
| `NewContractDialog.tsx:237` | `corretores.user_id` | `supabase.rpc('get_corretor_id')` (só para o caminho do Storage; corrige D4) |
| `NewContractDialog.tsx:291` (editar) | update + sincronização | `editarLocacaoApi(id, contractData)`; para cada id de `faturas_emitidas` invoca `asaas-sync` como hoje; toasts iguais |
| `NewContractDialog.tsx:350` (criar) | insert + fatura | `criarLocacaoApi(contractData, primeira)` com `primeira.data_vencimento = yyyy-MM-dd` local (`format(dueDate,'yyyy-MM-dd')`) e `mes_referencia = format(dueDate,'MM/yyyy')`; toast "Contrato e fatura criados" |
| `NewContractDialog.tsx:408` | update de CPF | `completarCpfApi(clientId, cpfClean)` (módulo 2; só preenche se vazio, §6) |
| `AutoContractDialog.tsx:80,:89` | selects | como no NewContractDialog |
| `AutoContractDialog.tsx:210` | insert de imóvel | `criarImovelApi({...mesmos campos, sem corretor_id})` (módulo 2) |
| `AutoContractDialog.tsx:256` + fatura `~290` | insert + insert | `criarLocacaoApi(dados, primeira)` com a data de `makeDueDate` formatada `yyyy-MM-dd`; `completarCpfDoCliente` igual |
| `AnalisarContratoDialog.tsx:261` | insert de imóvel | `criarImovelApi` |
| `AnalisarContratoDialog.tsx:291` | insert de contrato | `criarContratoApi({...mesmos campos, conteudo: '', status: 'VIGENTE'})`; `tipo` `'OUTRO'` → 400 da API mostrado no mesmo toast de erro |
| `AnalisarContratoDialog.tsx:322-335` | desfazer pelo Supabase | Storage igual; imóvel: `removerImovelApi`; cliente: `removerClienteApi` (corrige D7). Falhas continuam somadas na mesma mensagem |
| `DocumentoViewer.tsx`, `ContractUpload.tsx` | só Storage | sem mudança |

`corretor_id` nunca vai no corpo das chamadas à API (o `escolher` garante).

### 4.3 Testes do front

`src/lib/api/contratos.test.ts` (vitest, `fetch` falso, `vi.mock('@/lib/api')` devolvendo `chamarApi` sobre o fetch falso):
- cada função chama o método e caminho da §4.1, com `encodeURIComponent` no id;
- `criarContratoApi` descarta `corretor_id`, `versao`, `modelo_ia`, `tempo_geracao_ms`;
- `criarLocacaoApi` manda `primeira_fatura` e só as `CHAVES_LOCACAO`;
- `listarContratosDosClientesApi([])` não chama `fetch`;
- 402 com `codigo: 'PLAN_LIMIT_REACHED'` vira `ErroApi` com a `message` da API; 500 vira o texto padrão;
- `analisarContratoIaApi` devolve `dados`.

Testes de adaptador novos (`*.api.test.ts(x)`), com `apiDisponivel` mockado `true`: `crmStore` (`addContrato` devolve id e não chama `supabase.from`), `useDocumentos` (validar não manda `updated_at`), `contractExtractionService` (503 → fallback; 400 → erro com a mensagem), `NewContractDialog` ou função extraída (data da fatura `yyyy-MM-dd` sem deslocamento de fuso).

Os testes atuais (`AnalisarContratoDialog.test.tsx`, `AutoContractDialog.test.tsx` e os de M2 §4) continuam passando sem `VITE_API_URL`. Fixtures de uuid v4 (M2 §0.5).

Comandos: `npx vitest run <arquivos>`; `npx tsc --noEmit -p tsconfig.app.json`.

---

## 5. Testes da API

### 5.1 Jest (texto do SQL, `cd api && npx jest src/contratos`)

Padrão M2 §0.5 (`tx` falso, leitura de `.text` e `.values`). Obrigatórios:

**`contratos.service.spec.ts`**
- listar: `order by c.created_at desc, c.id` e `limit $n::int` com `1000` em `.values`;
- locação: `c.tipo = $n::public.tipo_contrato`; padrão `'LOCACAO_RESIDENCIAL'`;
- por-clientes: `any($n::uuid[])`;
- criar: chama `get_corretor_id`, confere pertencimento (`count(*)::int`), usa `jsonb_populate_record(null::public.contratos`, nunca põe `versao/modelo_ia/tempo_geracao_ms` no json; corretor null → 403;
- criar locação: contrato e fatura no MESMO `db.run` (1 chamada); `'ATIVO'` literal; fatura com `::numeric`, `::date`, `<= (now() at time zone 'America/Sao_Paulo')::date`;
- editar locação: `for update`; `diaMudou` false quando o dia não muda (valor `false` em `.values`); `updated_at = now()`; resposta só com ids que têm `external_id`; 404;
- alterar sem campos → 400 `nada_para_atualizar`; delete sem linha → 404;
- tradutor: P0001 `PLAN_LIMIT_REACHED:max_contratos_locacao` → 402 com `recurso` e a mensagem da §0.4.

**`documentos.service.spec.ts`**: `arquivo_path` de outra conta → 422 `arquivo_invalido`; insert com `false` literal para `validado`; update nunca contém `updated_at`; 42501 → 403 com a mensagem de documentos.

**Controllers** (supertest, M2 §0.5): ordem das rotas (`GET /api/contratos/central` não cai em `:id`); 400 em português para um campo de cada DTO; `corretor_id` no corpo → 400; teste de paridade com o id não v4 `'11111111-1111-1111-1111-111111111111'` em `PATCH /api/contratos/:id/locacao` (URL) e `cliente_id` (corpo); DELETE → 204.

**`contratos-ia.service.spec.ts`** (`fetch`, `TenantDb` e `PrismaService` falsos):
- sem `GEMINI_API_KEY` → 503 e **nenhuma** chamada a `reserve_contract_quota`;
- `allowed=false` → 402 com `recurso`, `usado`, `limite`, sem chamar `fetch`;
- sucesso → `finish_contract_quota(id, true)` uma vez e nenhum `false`;
- provedor 429/402/500 → 429/402/502 e `finish(…, false)`;
- `gerar` sem `proprietario` → 200 (D14);
- a URL do `fetch` de `analisar` contém `:generateContent?key=` e o corpo `thinkingBudget: 0`; a de `gerar` é a `openai/chat/completions` com `temperature: 0.2`;
- modelo de `LOTTI_AI_FAST_MODEL` quando definido.

**`ia/*.spec.ts`**: casos de `toIsoDate` (ISO, `dd/mm/aaaa`, por extenso, inválido → null), `asMoney` (`'R$ 1.234,56'` → 1234.56), `sanitizeCentral` (data_fim calculada por `prazo_dias`), `valorParaExtenso`, `externalDataBlock` (escapa e corta no limite). Se `supabase/functions/_shared/ai/contracts.test.ts` tiver casos dessas funções, repita-os.

Comandos: `cd api && npx jest src/contratos` e `cd api && npx tsc --noEmit`.

### 5.2 SQL real (`api/test/sql-real/contratos.test.ts`, `node:test` sobre o harness)

Como `funil.test.ts`: `criarBanco()`, `new ContratosService(banco.db)`, `new DocumentosService(banco.db)`, corpos passados por `plainToInstance` + `validateSync` com `{ whitelist: true, forbidNonWhitelisted: true }`, erros por `capturarErroHttp`. Fixtures por `banco.inserir(...)` (cliente e imóvel da conta A e da B; imóvel de B com `semGatilhos`). Obrigatórios:

1. **Formato:** `listar` devolve as colunas de `to_jsonb(public.contratos)`, `valor` número, `data_inicio` `'YYYY-MM-DD'`, `created_at` com `+00:00`; `central` traz `imoveis: {titulo}` e `clientes: {nome}` e `null` quando não há vínculo; ordem `data_fim asc nulls last`.
2. **Isolamento:** contrato e documento de B não aparecem para A; `PATCH`/`DELETE` de A no id de B → 404; criar contrato de A com `cliente_id` de B → 422 `cliente_invalido`.
3. **Criação:** `criar` sem `status` grava `'RASCUNHO'`; `tipo: 'OUTRO'` → barrado pelo DTO; por `semValidacao`, chega ao banco e vira 400 `dados_invalidos` (22P02).
4. **Cota de locação:** com a conta sem cota de `max_contratos_locacao` (ou com limite 0 inserido pelo superusuário), `criarLocacao` → 402 `PLAN_LIMIT_REACHED` com `recurso: 'max_contratos_locacao'`, e **nenhuma** fatura nem contrato gravados (`sqlSuperusuario` conta 0).
5. **Locação atômica:** sucesso grava 1 contrato `ATIVO` e 1 fatura com `data_vencimento` igual ao enviado (sem deslocar), `mes_referencia` igual, status `ATRASADO` para vencimento de ontem e de hoje (fuso São Paulo) e `PENDENTE` para amanhã; `banco.transacoes.commitsAbortados` não muda.
6. **Edição:** faturas PENDENTE/ATRASADO recebem o novo `valor_aluguel`; PAGO não muda; dia 31 em `02/2027` vira `2027-02-28`; dia igual não mexe em `data_vencimento`; `faturas_emitidas` só com as que têm `external_id`; `updated_at` avança.
7. **Exclusão:** DELETE apaga o contrato e as faturas dele (CASCADE, comportamento atual registrado).
8. **Documentos:** criar/listar/alterar `validado`/excluir para o dono; `arquivo_path` sem o prefixo do corretor → 422; update não falha por `updated_at` (a coluna não existe e a API não a envia).
9. **Cota de IA (caminho privilegiado):** `reservarCota(banco.prisma, corretorA)` funciona fora do `TenantDb` e `finalizarCota(id, false)` devolve 1 ao contador (`usage_counters`); a mesma chamada dentro de `banco.db.run` falha com 42501 (prova de D16). Se o harness não tiver plano com `ai_contracts_monthly`, insira-o pelo superusuário.

Comando: o mesmo dos outros arquivos de `api/test/sql-real` (`cd api && node --test -r ts-node/register test/sql-real/contratos.test.ts`, ou o script que `funil.test.ts` usa no `package.json`).

---

## 6. Decisões que mudam comportamento (só com `VITE_API_URL`)

1. **`addContrato` passa a gravar** (D1): os três campos inexistentes são descartados. `tipo 'OUTRO'` e `data_inicio ''` continuam falhando (400 em vez de PGRST204/22P02), com o mesmo toast.
2. **Locação atômica** (D5): contrato e primeira fatura entram juntos ou nada entra. Hoje o contrato fica sem fatura. A edição também: se a sincronização falhar, o contrato não muda (hoje muda e só avisa).
3. **Data da fatura sem fuso** (D5): vai como `yyyy-MM-dd`; o status `ATRASADO/PENDENTE` é decidido pelo servidor no dia de São Paulo, com a mesma regra (`<=` hoje).
4. **`updated_at` de contratos avança** em todo UPDATE da API (D15).
5. **Edição de documentos passa a funcionar** (D2): a API não envia `updated_at`.
6. **NewContractDialog** usa `get_corretor_id` (D4) e **não sobrescreve CPF** já preenchido (D8, via `completarCpfApi`).
7. **AutoContract/Analisar criam imóvel pela API** com `corretor_id` do servidor; o desfazer do Analisar fica todo na API (D7).
8. **`gerar` sem `proprietario` responde 200** (D14). Falhas do provedor viram 502 com corpo (antes 500).
9. **Pertencimento conferido:** cliente/imóvel de outra conta → 422 (hoje o FK aceitava silenciosamente).
10. **`documentos.arquivo_path` precisa começar pelo corretor_id** (422). A policy de Storage já exige isso no upload.
11. **Ordenação dos selects de imóveis/clientes** passa a ser `localeCompare('pt-BR')` no cliente (antes a collation do banco).
12. Não muda: exclusão de contrato apaga faturas (CASCADE); ContractsList só lista `LOCACAO_RESIDENCIAL`; erros de leitura ignorados em ContratosCentral; documentos só para o dono da conta; AutoContract não desfaz cliente/imóvel; `analisar` aceita `'OUTRO'`.

---

## 7. Fora do escopo e pendências

### 7.1 Fora do escopo (continuam no Supabase, ninguém edita)

`BillsList.tsx` (contratos ATIVO, `arquivo_url`, upload e IA de extração: usa `extractContractData`, que passa a ir pela API quando ligada; nada mais muda), `DashboardKPICards.tsx`, `DashboardCharts.tsx`, `useSubscription.ts` (contagem de locação), `GlobalSearch` (lê o store), o resto de `crmStore.ts`, `asaas-sync`, `ai-assistant` (fallback de extração), Storage e a policy de Storage.

### 7.2 Pendências

**Integração (orquestrador, depois das duas frentes):**
- ligar `ContratosModule` em `api/src/app.module.ts`;
- `api/src/main.ts`: `NestFactory.create<NestExpressApplication>(AppModule)` e `app.useBodyParser('json', { limit: '21mb' })` (15 M caracteres de base64 + folga). Sem isso, `ia/analisar` dá 413 para PDFs acima de ~75 kB, e o front cai no fallback (decisão §4.2);
- definir `GEMINI_API_KEY` (e opcionalmente `LOTTI_AI_FAST_MODEL`) no Railway;
- **confirmar que o papel do `DATABASE_URL` da API tem EXECUTE em `reserve_contract_quota` e `finish_contract_quota`** (é o dono `postgres` no Supabase; no Railway, conferir). Se não tiver, migration 6;
- fumaça por curl: `GET /api/contratos`, `POST /api/contratos/locacao` + `DELETE`, `POST /api/contratos/ia/gerar` com chave de teste;
- desligar as Edge Functions `gerar-contrato`/`analisar-contrato` só na virada (fase 6).

**Código (fora deste módulo):** BillsList, Dashboard* e useSubscription passarem para a API; juntar os `*.erros.ts` (M2 §7.2); desfazer no AutoContractDialog; aviso antes de excluir contrato com faturas pagas/emitidas (D11); ContractsList incluir `LOCACAO_COMERCIAL` (D13); erro visível em ContratosCentral/Dashboard (D12); `arquivo_url` morto em documentos (D10).

**Migrations necessárias (propostas, nenhuma aplicada):**

```sql
-- 1) documentos.updated_at (o caminho Supabase do front ainda envia; sem ela, editar/validar falha sem API)
alter table public.documentos add column updated_at timestamptz not null default now();

-- 2) documentos: mesmo critério de equipe de contratos/faturas (D3)
drop policy if exists "Corretor ver documentos" on public.documentos;
drop policy if exists "Corretor criar documentos" on public.documentos;
drop policy if exists "Corretor editar documentos" on public.documentos;
drop policy if exists "Corretor deletar documentos" on public.documentos;
create policy "Corretor gerencia documentos" on public.documentos for all to authenticated
  using (corretor_id = (select public.get_corretor_id()))
  with check (corretor_id = (select public.get_corretor_id()));
-- (conferir os nomes exatos das quatro policies na baseline antes de aplicar)

-- 3) gatilho de updated_at (contratos; e documentos depois da 1)
create or replace function public.tocar_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger contratos_updated_at before update on public.contratos for each row execute function public.tocar_updated_at();
create trigger documentos_updated_at before update on public.documentos for each row execute function public.tocar_updated_at();

-- 4) "OUTRO" (D9): ou tirar do front/IA, ou
alter type public.tipo_contrato add value if not exists 'OUTRO';

-- 5) rastreio da geração por IA (opcional; sem ela, a API descarta os campos)
alter table public.contratos
  add column modelo_ia text, add column tempo_geracao_ms integer, add column versao integer not null default 1;

-- 6) só se a conexão da API não for dona das funções de cota
grant execute on function public.reserve_contract_quota(uuid) to <papel_da_api>;
grant execute on function public.finish_contract_quota(uuid, boolean) to <papel_da_api>;

-- 7) tirar de anon os grants de contratos (o RLS barra, mas é superfície desnecessária)
revoke all on table public.contratos from anon;
```

Se a 5 for aplicada, `versao/modelo_ia/tempo_geracao_ms` entram em `COLUNAS_CRIACAO` e `CHAVES_CRIAR_CONTRATO` numa revisão deste contrato. Se a 4 for aplicada, `'OUTRO'` entra em `TIPOS_CONTRATO`.
