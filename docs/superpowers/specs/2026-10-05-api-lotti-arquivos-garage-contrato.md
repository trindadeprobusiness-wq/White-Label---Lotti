# Contrato da API Lotti: arquivos no Garage (S3 self-hosted), saindo do Supabase Storage

Esta fase tira o **Storage** do Supabase do caminho. Os arquivos (fotos, vídeos, documentos, anexos de IA e mídias do Inbox) passam a ser guardados no **Garage** — um S3 self-hosted já no ar no Railway. O banco continua no Supabase por enquanto; é só o armazenamento de arquivos que muda. Com isso o sistema fica sem nenhuma dependência de `supabase.storage`.

O Garage é **interno** ao Railway (`http://garage.railway.internal:3900`). O browser não fala com ele. Todo upload e download passa pela API Lotti (`api.plataformalotti.com.br`), que é quem tem a credencial S3 e a rota de rede até o Garage.

Base: contrato do módulo 2 (`docs/superpowers/specs/2026-10-04-api-lotti-modulo2-contrato.md`) e os contratos da onda 2/3 (`-contratos-`, `-financeiro-`, `-rotina-`, `-fachadas-`, `-assinatura-`, `-parceiros-`). **Tudo o que este contrato não redefine segue o módulo 2**: §0.2 (TenantDb, `Prisma.sql`, casts explícitos, `FORMATO_UUID`), §0.3 (formato de erro HTTP `{ codigo, message }`), §0.4 (tradutor de erros do banco) e §0.5 (os testes leem `.text`, fixtures em v4). Do contrato de rotina vem o padrão de **variável opcional lida de `process.env` com 503 de texto claro quando falta**.

Inventário de origem lido para este contrato: `src/hooks/useImovelFotos.ts`, `src/hooks/useVideos.ts`, `src/hooks/useDocumentos.ts`, `src/hooks/useFileUpload.ts`, `src/components/juridico/AnalisarContratoDialog.tsx`, `src/components/imoveis/ImovelMediaManager.tsx`, `src/features/whatsapp-inbox/ConnectedInbox.tsx`, `src/features/whatsapp-inbox/MessageComposer.tsx`, `supabase/functions/ai-process-file/index.ts`, `supabase/functions/lotti-whatsapp/index.ts` + `request.ts` (`buildAttachmentPath`), `api/src/main.ts`, `api/src/config/env.ts`, `api/src/prisma/tenant-db.ts`, `api/src/auth/supabase-auth.guard.ts`, `api/src/fachadas/publico/fachadas-publico.controller.ts`, `src/lib/api.ts`, `src/lib/api/http.ts`, `src/lib/api/contratos.ts`.

## Decisões fixas desta fase (não reabrir)

1. **As keys dos arquivos são preservadas exatamente.** A cópia Supabase→Garage é 1:1: mesmo `bucket`, mesma `key`, mesmo `content-type`. Os valores já gravados no banco (`imovel_fotos.arquivo_path`, `videos.video_path`, `documentos.arquivo_path`, `ai_attachments.storage_path`, `lotti_agent_messages.media_path`, `lotti_manual_sends.media_path`) continuam válidos como key, sem backfill de caminho.
2. **O browser não fala com o Garage.** Todo tráfego passa pela API em `api.plataformalotti.com.br`. **Nenhum domínio público do Garage é criado.**
3. **Nada de base64 em JSON para arquivo.** Upload e download são por **streaming** (corpo binário no upload; stream direto do S3 no download, com `Range` no vídeo). O limite de 21 MB do body JSON (`api/src/main.ts`) vale só para `application/json` e **não** toca as rotas de arquivo.
4. **Público vs privado.** Fotos e vídeos são públicos: rota pública (sem login) que faz stream do bucket público. Documentos, anexos de IA e Inbox são privados: a rota exige login **e** confere, pelo TenantDb/RLS, que o arquivo pertence à conta de quem pede **antes** de servir. Nunca servir arquivo privado de outra conta.
5. **Tudo atrás de `apiDisponivel()`/`VITE_API_URL`.** Sem a variável, o front continua falando com o Supabase Storage exatamente como hoje. Nenhuma mudança de comportamento sem a variável.

---

## 0. Regras comuns

### 0.1 Quem é dono de quê

| Frente | Arquivos (só estes) |
|---|---|
| **S** api-storage | cria tudo em `api/src/storage/**` (classe `StorageModule`) e `api/src/arquivos/**` (classe `ArquivosModule`); cria `api/test/sql-real/arquivos.test.ts` e `api/src/storage/storage.service.spec.ts`, `api/src/arquivos/arquivos.controller.spec.ts`; edita **só** `api/src/app.module.ts` (para registrar os dois módulos) e `api/package.json` (para somar as duas dependências da §1.2). |
| **F** front | cria `src/lib/api/arquivos.ts` e `src/lib/api/arquivos.test.ts`; edita `src/hooks/useImovelFotos.ts`, `src/hooks/useVideos.ts`, `src/hooks/useDocumentos.ts`, `src/hooks/useFileUpload.ts`, `src/components/juridico/AnalisarContratoDialog.tsx`, `src/components/imoveis/ImovelMediaManager.tsx`, `src/features/whatsapp-inbox/ConnectedInbox.tsx`, `src/features/whatsapp-inbox/MessageComposer.tsx`. |

Ninguém edita: `api/src/main.ts` (ver §0.6 — não precisa mudar), `api/src/prisma/*`, `api/prisma/*`, `api/src/auth/*`, `api/src/config/env.ts` (as variáveis S3 são lidas em `api/src/storage/storage.config.ts`, ver §1.3), `api/test/sql-real/harness.ts`, `src/lib/api.ts`, `src/lib/api/http.ts`, `supabase/**` (inclusive as Edge Functions — a migração do upload do Inbox e do `ai-process-file` para o Garage é pendência, §7), `AI_HANDOFF.md`, `docs/*` (fora deste arquivo).

Valem também: **nenhuma migration aplicada** (as propostas estão em §7.2, só descritas, com o SQL); nada de `prisma migrate`, `db push`, `db pull`, `migrate reset`; nada de commit, stash ou troca de branch; nada contra Supabase, Railway, Garage ou rede (os testes não usam rede, nem S3 nem Garage reais — tudo por mock, §6); segredos só por nome, nunca por valor — nenhum teste imprime `S3_SECRET_ACCESS_KEY` nem o service key do Supabase.

### 0.2 Os buckets e o que cada um guarda

| Bucket | Acesso | Tabela/coluna que guarda a key | Formato da key (preservado) |
|---|---|---|---|
| `imoveis-fotos` | **público** | `imovel_fotos.arquivo_path` | `<imovelId>/<timestamp>_<nome>` |
| `videos` | **público** | `videos.video_path` | `<corretorId>/<imovelId|geral>/<timestamp>_<nome>` |
| `documentos` | privado | `documentos.arquivo_path` e `contratos.arquivo_url` (guarda o path) | `<corretorId>/<pasta>/<timestamp>_<nome>` |
| `ai-attachments` | privado | `ai_attachments.storage_path` | `<userId>/<timestamp>.<ext>` |
| `lotti-inbox-files` | privado | `lotti_agent_messages.media_path`, `lotti_manual_sends.media_path` | `<corretorId>/<requestId>/<nome>` |
| `lotti-inbox-audio` | privado | `lotti_agent_messages.media_path`, `lotti_manual_sends.media_path` | `<corretorId>/<requestId>/<nome>` |

> **Pendência P1 (§7):** o enunciado fala em "5 buckets", mas o uso real soma **seis** (acima). Confirmar no Garage que `lotti-inbox-audio` existe como bucket próprio e privado. `avatars` aparece no tipo de `useFileUpload` mas **não tem nenhum uso real no front** (ver §4.4) — não entra nesta fase.

### 0.3 Como a API fala com o Garage (resumo)

`StorageService` (§1.4) é um cliente S3 único (`@aws-sdk/client-s3`), configurado pelas variáveis `S3_*`. As rotas de `ArquivosController` (§2) recebem `(bucket, key)`, conferem acesso quando o bucket é privado, e então:
- **download:** `GetObjectCommand` devolve o corpo como stream; a rota faz `pipe` direto para a resposta HTTP, com `Content-Type`/`Content-Length`/`ETag` do objeto e suporte a `Range` no vídeo (206).
- **upload:** o corpo da requisição (`req`, um `Readable`) é passado ao `Upload` do `@aws-sdk/lib-storage` (multipart, sem bufferizar os 500 MB do vídeo na memória).
- **apagar:** `DeleteObjectCommand`.

Nenhuma rota devolve `supabase.storage` nem URL assinada do Supabase. Nenhuma rota serializa o arquivo em JSON/base64.

### 0.4 Formato de erro

Igual ao módulo 2 §0.3: `{ codigo, message }` com o status certo. Erros desta fase:

| Status | `codigo` | Quando |
|---|---|---|
| 400 | `key_invalida` | key vazia, com `..`, com `\`, começando por `/`, ou com segmento vazio |
| 401 | — (`UnauthorizedException` do guard) | rota privada sem sessão válida |
| 403 | `arquivo_de_outra_conta` | rota privada: a key não pertence à conta do solicitante (nenhuma linha visível pelo RLS) |
| 404 | `arquivo_nao_encontrado` | o objeto não existe no Garage (`NoSuchKey`/404 do S3) |
| 413 | `arquivo_grande_demais` | upload acima do teto do grupo (§2.3) |
| 503 | `storage_indisponivel` | faltam variáveis `S3_*` (ver §1.3) ou o Garage não respondeu |

O corpo de erro é sempre JSON, mesmo nas rotas de stream (o erro acontece **antes** do primeiro byte do corpo; depois do primeiro byte, a resposta só é interrompida e registrada, nunca "emendada" com JSON).

### 0.5 Validação da key (compartilhada)

A key chega como **splat** (resto do caminho), porque contém `/`. É validada por uma função única `validarKey(key: string)` em `api/src/arquivos/arquivos.dto.ts`:
- decodifica cada segmento (`decodeURIComponent`);
- recusa (400 `key_invalida`): vazia; qualquer segmento `..` ou `.`; qualquer `\`; início com `/`; segmento vazio (`//`); comprimento total > 1024.
- o resultado é a key canônica (segmentos reunidos com `/`), exatamente como está gravada no banco.

Nenhum valor do cliente é concatenado em SQL ou em comando de shell. A key só entra no S3 como parâmetro `Key` do SDK e no SQL como `$queryRaw` parametrizado (`::text`).

### 0.6 Por que `api/src/main.ts` não muda

`app.useBodyParser('json', { limit: '21mb' })` só intercepta `Content-Type: application/json`. As rotas de upload usam `application/octet-stream` (ou o mime do arquivo) e **não** são tocadas pelo parser de JSON — o corpo chega como stream em `req`. Não há parser global de `raw`/`urlencoded`, então nada mais consome o corpo antes do `Upload`. O `setGlobalPrefix('api')` continua valendo (todas as rotas abaixo são `/api/...`). **Confirmar no teste de controller (§6.3) que o corpo binário chega íntegro ao serviço** — se num ambiente o parser pegasse algo, seria preciso excluir a rota, mas pela configuração atual não é.

---

## 1. Módulo de storage na API (`api/src/storage/**`)

### 1.1 Estrutura

```
api/src/storage/
  storage.module.ts     // @Global, provê e exporta StorageService
  storage.config.ts      // lê S3_* de process.env; 503 quando falta
  storage.service.ts     // cliente S3 único; enviar/obter/apagar/existe
  storage.service.spec.ts
```

`StorageModule` é `@Global()` e exporta `StorageService`, para `ArquivosModule` (§2) injetá-lo sem reimportar. É registrado em `api/src/app.module.ts` em `imports`, antes de `ArquivosModule`.

### 1.2 Dependências a somar em `api/package.json`

```jsonc
"@aws-sdk/client-s3": "^3.700.0",
"@aws-sdk/lib-storage": "^3.700.0"
```

`client-s3` para `GetObject`/`PutObject`/`DeleteObject`/`HeadObject`; `lib-storage` para o `Upload` multipart por stream (upload de tamanho desconhecido/grande sem `ContentLength`). Nenhuma outra dependência. As versões são alinhadas entre si (mesma major/minor do SDK v3).

### 1.3 Configuração (`storage.config.ts`) — padrão "variável opcional + 503"

Lê de `process.env` (não mexe em `api/src/config/env.ts`), no padrão do módulo rotina:

```ts
export interface S3Config {
  endpoint: string; region: string;
  accessKeyId: string; secretAccessKey: string;
  forcePathStyle: boolean;
}
export function lerS3Config(src: NodeJS.ProcessEnv = process.env): S3Config | null {
  const endpoint = src.S3_ENDPOINT?.trim();
  const region = src.S3_REGION?.trim();
  const accessKeyId = src.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = src.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) return null; // → 503 na rota
  return {
    endpoint, region, accessKeyId, secretAccessKey,
    forcePathStyle: (src.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() !== 'false',
  };
}
```

Valores esperados em produção (Railway): `S3_ENDPOINT=http://garage.railway.internal:3900`, `S3_REGION=garage`, `S3_FORCE_PATH_STYLE=true`. `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` são segredos — **nunca lidos por valor** nesta fase, só por nome. Config `null` ⇒ toda rota de arquivo responde 503 `storage_indisponivel` (texto claro), sem derrubar o processo e sem afetar os outros módulos da API.

### 1.4 `StorageService`

Injeta a config; monta **um** `S3Client` no primeiro uso (lazy), reaproveitado. Interface pública (tudo por stream, nenhum buffer completo em memória):

```ts
@Injectable()
export class StorageService {
  disponivel(): boolean;                     // lerS3Config() !== null

  // download: devolve o corpo como stream + metadados; aceita Range opcional.
  obter(bucket: string, key: string, range?: string): Promise<{
    corpo: Readable; contentType?: string; contentLength?: number;
    etag?: string; contentRange?: string; statusCode: 200 | 206;
  }>;

  // upload por stream (multipart via lib-storage). Não exige contentLength.
  enviar(bucket: string, key: string, corpo: Readable, contentType?: string): Promise<void>;

  apagar(bucket: string, key: string): Promise<void>;

  // HEAD: usado pela checagem de existência e pelo script da §5 (idempotência).
  existe(bucket: string, key: string): Promise<boolean>;
}
```

Regras:
- Config ausente ⇒ cada método lança `erroApi(503, 'storage_indisponivel', ...)`.
- `NoSuchKey`/`404`/`NotFound` do S3 em `obter` ⇒ `erroApi(404, 'arquivo_nao_encontrado', ...)`.
- `range` repassado como `Range` ao `GetObjectCommand`; quando presente e o S3 responde 206, devolve `statusCode: 206`, `contentRange` e `contentLength` do pedaço.
- `enviar` usa `new Upload({ client, params: { Bucket, Key, Body: corpo, ContentType } }).done()`.
- Nenhum log imprime credenciais; erros do S3 são reduzidos a `{ name, $metadata.httpStatusCode }` ao registrar.

---

## 2. As rotas de arquivo (`api/src/arquivos/**`)

### 2.1 Estrutura

```
api/src/arquivos/
  arquivos.module.ts       // controllers + ArquivosService; importa StorageModule (global) e SupabaseAuthGuard
  arquivos.controller.ts   // rotas públicas, privadas e de upload
  arquivos.service.ts      // checagem de dono (TenantDb) + orquestra StorageService
  arquivos.dto.ts          // validarKey, FORMATO_UUID (reexport se preciso), tetos
  arquivos.controller.spec.ts
```

`ArquivosModule` entra em `api/src/app.module.ts`. Ordem dos controllers: as rotas públicas e as de grupo fixo (`/publico/...`, `/documento/...`, etc.) não colidem entre si porque têm prefixos distintos; não há `:param` que engula outra rota.

A key é capturada como **splat** do Express. Em Nest/Express 5 o splat nomeado chega em `req.params['key']` (rota `':bucket/*key'`) ou, na forma clássica, em `req.params[0]`. O controller lê o splat, roda `validarKey`, e repassa a key canônica. **Fixar a forma concreta no spec (§6.3): a rota declara o splat e o teste confere que `a/b/c.pdf` chega inteiro.**

Todas as respostas de stream usam `@Res({ passthrough: false })` (o controller controla a resposta) e **não** retornam valor — o corpo é o `pipe`. Erros antes do primeiro byte viram o JSON de §0.4; `res.on('error')` só encerra a resposta.

### 2.2 Rotas públicas (sem login)

Sem `@UseGuards`, no espírito de `FachadasPublicoController` (landing sem sessão). Servem apenas **GET** e só os dois buckets públicos.

| Método | Caminho | Bucket | Observações |
|---|---|---|---|
| GET | `/api/arquivos/publico/foto/*key` | `imoveis-fotos` | `Content-Type` do objeto; `Cache-Control: public, max-age=86400`; `ETag` repassado; responde 304 se `If-None-Match` casar. |
| GET | `/api/arquivos/publico/video/*key` | `videos` | honra `Range` (vídeo até 500 MB): repassa `Range` ao S3, devolve 206 com `Content-Range` e `Accept-Ranges: bytes`; sem `Range`, 200 com `Content-Length`. `Cache-Control: public, max-age=86400`. |

Erros: key inválida 400; objeto ausente 404; storage off 503. Sem corpo de requisição. Nenhuma dessas rotas aceita `key` no corpo nem em query.

### 2.3 Rotas de upload (login obrigatório, streaming binário)

`@UseGuards(SupabaseAuthGuard)`. Corpo = binário cru do arquivo; `Content-Type` do header é o mime gravado no objeto. A key vem no caminho (o front a gera, preservando o formato de hoje — §4). A resposta é `200 { ok: true, key }` (a key canônica, para o front gravar no banco).

| Método | Caminho | Bucket | Dono conferido? | Teto |
|---|---|---|---|---|
| PUT | `/api/arquivos/foto/*key` | `imoveis-fotos` | não (bucket público; hoje qualquer `authenticated` grava) | 5 MB |
| PUT | `/api/arquivos/video/*key` | `videos` | prefixo: a key deve começar por `<get_corretor_id()>/` | 500 MB |
| PUT | `/api/arquivos/documento/*key` | `documentos` | prefixo: key começa por `<get_corretor_id()>/` (igual ao `documentos.service` de hoje) | 25 MB |
| PUT | `/api/arquivos/inbox/:bucket/*key` | `lotti-inbox-files` ou `lotti-inbox-audio` | prefixo: key começa por `<get_corretor_id()>/` | 100 MB |
| POST | `/api/arquivos/inbox/preparar` | — | sim (corretor da sessão) | — |

- O teto é checado pelo header `Content-Length` **antes** de abrir o stream (413 `arquivo_grande_demais`); se o cliente omitir `Content-Length`, o serviço limita o stream e aborta ao estourar o teto.
- `:bucket` do Inbox é validado contra a allowlist `{ 'lotti-inbox-files', 'lotti-inbox-audio' }` (qualquer outro ⇒ 400 `key_invalida`).
- `POST /api/arquivos/inbox/preparar` recebe `{ request_id, name, mime, size }` e devolve `{ storage_path }` calculado **igual** ao `buildAttachmentPath` da Edge Function (`<corretorId>/<request_id>/<safeName>`, com `get_corretor_id()` no lugar de `owner.id`). É o espelho do `prepare_upload` para o front saber a key antes de dar o PUT. A validação de `name/mime/size` repete a da Edge Function (ver `request.ts`); mime/size fora da allowlist ⇒ 400.
- O prefixo de dono (`get_corretor_id()`) é obtido num `TenantDb.run` curto antes do stream; `null` ⇒ 403 `arquivo_de_outra_conta`. A key que não começa pelo corretor da sessão ⇒ 403.

### 2.4 Rotas privadas de download (login + dono)

`@UseGuards(SupabaseAuthGuard)`. Confere o dono pelo **TenantDb/RLS** (§3) antes de qualquer byte; só então faz stream do bucket privado.

| Método | Caminho | Bucket | Checagem de dono (§3) |
|---|---|---|---|
| GET | `/api/arquivos/documento/*key` | `documentos` | existe linha em `public.documentos` com `arquivo_path = key` **ou** em `public.contratos` com `arquivo_url = key`, visível pelo RLS |
| GET | `/api/arquivos/anexo-ia/*key` | `ai-attachments` | existe linha em `public.ai_attachments` com `storage_path = key`, visível pelo RLS |
| GET | `/api/arquivos/inbox/:bucket/*key` | `lotti-inbox-files`/`lotti-inbox-audio` | existe linha em `public.lotti_agent_messages` **ou** `public.lotti_manual_sends` com `media_path = key`, visível pelo RLS |

- Nenhuma linha visível ⇒ 403 `arquivo_de_outra_conta` (não 404: não vazamos existência de arquivo de outra conta — o 403 é o mesmo para "não é seu" e "não existe no banco", e o 404 fica reservado para "a key passou na checagem de dono mas o objeto sumiu do Garage").
- `Content-Type` do objeto; `Cache-Control: private, no-store` (arquivo privado não entra em cache compartilhado). `Range` honrado também aqui (documentos/áudio longos).
- A checagem de dono roda em `TenantDb.run(claims, tx => ...)`, com `::text` na key, `limit 1`, `select 1`. É o RLS que decide — a rota **não** filtra por corretor no SQL (só confere "existe linha visível").

---

## 3. Checagem de dono (SQL, dentro do TenantDb)

`ArquivosService` recebe `claims` (do `@Claims()`) e a key canônica. Para cada grupo privado, roda uma consulta de existência. Padrão módulo 2 §0.2 (`Prisma.sql`, cast explícito, sem `Unsafe`):

```ts
// documento (ou contrato que aponta para o mesmo arquivo)
await this.db.run(claims, (tx) => tx.$queryRaw`
  select 1 from public.documentos where arquivo_path = ${key}::text
  union all
  select 1 from public.contratos where arquivo_url = ${key}::text
  limit 1`);

// anexo de IA
await this.db.run(claims, (tx) => tx.$queryRaw`
  select 1 from public.ai_attachments where storage_path = ${key}::text limit 1`);

// inbox (files e audio compartilham as mesmas tabelas; o bucket não entra no SQL)
await this.db.run(claims, (tx) => tx.$queryRaw`
  select 1 from public.lotti_agent_messages where media_path = ${key}::text
  union all
  select 1 from public.lotti_manual_sends where media_path = ${key}::text
  limit 1`);
```

Resultado vazio ⇒ 403 `arquivo_de_outra_conta`. O RLS dessas tabelas (as mesmas policies que o PostgREST aplica hoje) garante que linha de outra conta nem aparece. As policies de `ai_attachments` passam por `ai_messages → ai_conversations → corretor`; as de `lotti_agent_*` por conta pareada; as de `documentos`/`contratos` por `corretor_id in (corretores do auth.uid())`. **A API não reimplementa esse filtro** — apenas pergunta "existe linha visível com esta key?".

> Observação de segurança registrada: a key `documentos` tem o `<corretorId>/` como primeiro segmento, mas a prova de dono **não** é o prefixo e sim a linha no banco (um corretor poderia ter mais de um `corretor_id`? não — mas mesmo assim o RLS é a fonte da verdade). O prefixo só é usado no **upload** (§2.3), onde ainda não há linha no banco.

---

## 4. Onde o front troca a chamada do `supabase.storage` pela API

Regra geral (decisão 5): cada ponto fica `apiDisponivel() ? <API> : <supabase.storage de hoje>`. O adaptador novo mora em `src/lib/api/arquivos.ts` e usa `chamarApi`/`API_URL` de `src/lib/api.ts` (sem editar `api.ts`).

### 4.0 `src/lib/api/arquivos.ts` (novo)

```ts
import { chamarApi, apiDisponivel } from '@/lib/api';
// Base pública (sem token) para <img>/<video>: usa VITE_API_URL direto.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

const enc = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/** URL pública de foto/vídeo servida pela API (vai direto no src da <img>/<video>). */
export function urlPublicaFoto(key: string): string { return `${BASE}/api/arquivos/publico/foto/${enc(key)}`; }
export function urlPublicaVideo(key: string): string { return `${BASE}/api/arquivos/publico/video/${enc(key)}`; }

/** Upload por streaming (corpo binário). Devolve a key canônica. */
export async function enviarArquivoApi(grupo: 'foto'|'video'|'documento', key: string, file: File): Promise<string> {
  const res = await chamarApi(`/api/arquivos/${grupo}/${enc(key)}`, {
    method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  });
  if (!res.ok) throw await lerErroApi(res, 'Falha no upload.'); // lerErroApi importado de ./http
  return (await res.json()).key as string;
}
export async function enviarInboxApi(bucket: 'lotti-inbox-files'|'lotti-inbox-audio', key: string, file: Blob, mime: string): Promise<string> { /* PUT /api/arquivos/inbox/<bucket>/<key> */ }
export async function prepararInboxApi(body: {request_id:string;name:string;mime:string;size:number}): Promise<{storage_path:string}> { /* POST /api/arquivos/inbox/preparar */ }

/** Download privado: busca com token e devolve um object URL (para <img>/<a>/<audio>). */
export async function baixarPrivadoApi(grupo: 'documento'|'anexo-ia', key: string): Promise<string>;
export async function baixarInboxApi(bucket: 'lotti-inbox-files'|'lotti-inbox-audio', key: string): Promise<string>;
```

- `baixarPrivadoApi`/`baixarInboxApi` fazem `chamarApi(... )` (token no header, nunca na URL — decisão de privacidade de `src/lib/api.ts`), lêem `res.blob()` e devolvem `URL.createObjectURL(blob)`. Quem chama **revoga** o object URL ao desmontar (igual aos `createSignedUrl` de hoje já faziam com os timers). Erro ⇒ lança `ErroApi` (texto da §0.4).
- `enc` preserva a key (cada segmento é codificado, as `/` ficam).

### 4.1 `src/hooks/useImovelFotos.ts` (bucket `imoveis-fotos`, público)

| Linha (hoje) | Vira |
|---|---|
| `uploadFoto`: `supabase.storage.from('imoveis-fotos').upload(filePath, file)` | `apiDisponivel() ? await enviarArquivoApi('foto', filePath, file) : <hoje>` |
| `uploadFoto`: `getPublicUrl(filePath)` → `arquivo_url` | `apiDisponivel() ? urlPublicaFoto(filePath) : urlData.publicUrl` |
| `deleteFoto`: `remove([arquivoPath])` | `apiDisponivel() ? await apagarArquivoApi('foto', arquivoPath) : <hoje>` |

`arquivo_path` continua `${imovelId}/${timestamp}_${name}` (key preservada). O `insert` em `imovel_fotos` não muda (grava `arquivo_url` = URL da API e `arquivo_path` = key).

> **Apagar:** o `remove` precisa de rota. Adicionar ao §2 uma rota **DELETE** `/api/arquivos/foto/*key`, `/video/*key`, `/documento/*key` (login; dono por prefixo no vídeo/documento, livre na foto como hoje) e `baixarPrivado`/`apagarArquivoApi('foto'|'video'|'documento', key)` no adaptador. *(Ver §2.5 abaixo — fechamento dos pontos de delete.)*

### 4.2 `src/components/imoveis/ImovelMediaManager.tsx` (exibição de foto/vídeo)

Hoje a grade usa `foto.arquivo_url` e `video.video_url` (URLs do Supabase gravadas no banco). Para **ler do Garage** sem depender do valor antigo gravado, a exibição deriva da key quando a API está ligada:

- `<img src={apiDisponivel() ? urlPublicaFoto(foto.arquivo_path) : foto.arquivo_url}>`
- `<video src={apiDisponivel() ? urlPublicaVideo(video.video_path) : video.video_url}>`

Assim as linhas antigas (cujo `arquivo_url`/`video_url` ainda aponta para o Supabase) passam a ser servidas pela API a partir da key, que é idêntica — sem backfill. (A reescrita do `arquivo_url`/`video_url` gravado é pendência P2, §7.2, só para o dia em que o Supabase sair do ar; enquanto ele existir, as duas formas funcionam.)

### 4.3 `src/hooks/useVideos.ts` (bucket `videos`, público)

| Hoje | Vira |
|---|---|
| `uploadVideo`: `supabase.storage.from('videos').upload(filePath, file)` | `apiDisponivel() ? await enviarArquivoApi('video', filePath, file) : <hoje>` — **sem base64, por streaming** (resolve o vídeo de 500 MB) |
| `uploadVideo`: `getPublicUrl` → `video_url` | `apiDisponivel() ? urlPublicaVideo(filePath) : urlData.publicUrl` |
| `deleteVideo`: `remove([videoPath])` | `apiDisponivel() ? await apagarArquivoApi('video', videoPath) : <hoje>` |
| `getTemporaryShareUrl`: `createSignedUrl(videoPath, ...)` | `apiDisponivel() ? urlPublicaVideo(videoPath) : <hoje>` (bucket público: o link de compartilhar é a própria URL pública, sem expiração) |

`video_path` continua `${corretorId}/${folder}/${timestamp}_${name}`. A barra de progresso simulada pode ser mantida; o `fetch`/`PUT` por streaming não entrega progresso (como hoje o upload do Supabase também não), então a simulação permanece.

### 4.4 `src/hooks/useFileUpload.ts` (genérico)

Hoje só é chamado com `'imoveis-fotos'` (em `CriarFachadaDialog.tsx` e `FachadasInteligentes.tsx`, **fora** do nosso escopo de edição). O hook ganha o desvio por `apiDisponivel()` mantendo a assinatura:

- `upload(file, path)`: `apiDisponivel() ? { path: await enviarArquivoApi('foto', path, file), url: urlPublicaFoto(path) }` : `<hoje>` — mapeando o `bucket` do hook para o grupo da API (`imoveis-fotos→foto`, `documentos→documento`; `avatars` não tem rota porque não tem uso — se algum dia aparecer, vira pendência).
- `remove(path)`: `apiDisponivel() ? apagarArquivoApi(<grupo do bucket>, path) : <hoje>`.

`ai-attachments` **não** passa por este hook. O upload de anexo de IA acontece **dentro** da Edge Function `supabase/functions/ai-process-file/index.ts` (o browser manda o arquivo em `multipart/form-data` para a função, e a função grava em `ai-attachments`). Migrar esse upload para o Garage exige mexer na Edge Function (fora do escopo desta fase) — **pendência P3, §7**. A rota privada de download `/api/arquivos/anexo-ia/*key` (§2.4) já fica pronta para quando o front precisar servir esses arquivos.

### 4.5 `src/components/juridico/AnalisarContratoDialog.tsx` (bucket `documentos`, privado)

| Hoje | Vira |
|---|---|
| `salvar`: `supabase.storage.from('documentos').upload(path, file, { upsert:false })` | `apiDisponivel() ? await enviarArquivoApi('documento', path, file) : <hoje>` |
| rollback: `supabase.storage.from('documentos').remove([arquivoPath])` | `apiDisponivel() ? await apagarArquivoApi('documento', arquivoPath).catch(()=>undefined) : <hoje>` |

A key `path` continua `${corretorId}/contratos/${Date.now()}_${safeName}` (prefixo do corretor — a rota de upload confere). O `criarContratoApi`/insert grava `arquivo_url = path` (já é o path, não a URL — o módulo contratos já guarda a key aqui). Nada mais muda nesse diálogo (análise de IA do contrato segue em base64 pela rota `/api/contratos/ia/analisar`; é texto/PDF ≤ 15 MB e **não** é armazenamento — fica fora desta fase).

### 4.6 `src/hooks/useDocumentos.ts` (bucket `documentos`, privado)

| Hoje | Vira |
|---|---|
| `uploadDocumento`: `upload(filePath, file)` | `apiDisponivel() ? await enviarArquivoApi('documento', filePath, file) : <hoje>` |
| `uploadDocumento`: `getPublicUrl(filePath)` → `arquivo_url` | bucket é **privado**: grava `arquivo_url = filePath` (a key), não uma URL pública. (Hoje já grava `publicUrl` mas o bucket é privado e a leitura usa `createSignedUrl`; passar a gravar a key é consistente com o módulo contratos.) |
| `getSignedUrl(arquivoPath)` | `apiDisponivel() ? await baixarPrivadoApi('documento', arquivoPath) : <hoje createSignedUrl>` — devolve object URL |
| `downloadDocumento(arquivoPath, nome)` | `apiDisponivel() ?` buscar via `baixarPrivadoApi('documento', arquivoPath)` e disparar o `<a download>` `: <hoje download>` |
| `deleteDocumento`: `remove([arquivoPath])` | `apiDisponivel() ? await apagarArquivoApi('documento', arquivoPath) : <hoje>` |

`filePath` continua `${corretorId}/${folder}/${timestamp}_${name}`. Quem usa o object URL de `getSignedUrl`/`downloadDocumento` deve `URL.revokeObjectURL` depois (o download revoga logo após o clique).

### 4.7 `src/features/whatsapp-inbox/ConnectedInbox.tsx` (download de `lotti-inbox-files`)

`MessageBody` hoje faz `supabase.storage.from('lotti-inbox-files').createSignedUrl(media_path, 3600)` e renova num timer. Vira:

- `apiDisponivel() ? await baixarInboxApi('lotti-inbox-files', media_path) : <hoje createSignedUrl>`.
- Com object URL não há expiração: o timer de renovação (50 min) só roda no caminho Supabase; no caminho API o object URL vive enquanto o componente estiver montado e é revogado no cleanup do `useEffect`.

Só o **download/exibição** do Inbox muda agora. (Ver §4.8 para o motivo de o upload do Inbox ficar para depois.)

### 4.8 `src/features/whatsapp-inbox/MessageComposer.tsx` (`lotti-inbox-files`/`lotti-inbox-audio`)

- **Download (`AudioMessage`):** hoje `createSignedUrl` em `lotti-inbox-audio`. Vira `apiDisponivel() ? await baixarInboxApi('lotti-inbox-audio', path) : <hoje>`, com revogação no cleanup.
- **Upload (send de arquivo/áudio):** hoje é `prepare_upload` (Edge Function → signed upload URL do Supabase) + `uploadToSignedUrl` + `send`. A rota da API existe (§2.3: `preparar` + `PUT inbox`), **mas o switch do upload fica desligado nesta fase**, porque o envio ao WhatsApp depende de a **ponte** (runtime do agente, na VPS) ler o arquivo para mandar no WhatsApp — e a ponte lê do Supabase Storage. Trocar só o lado do browser deixaria o arquivo no Garage e a ponte sem achá-lo. Enquanto a ponte não ler do Garage (pendência P4, §7), `MessageComposer` **continua** fazendo `prepare_upload`/`uploadToSignedUrl` no Supabase para o **send**, mesmo com `apiDisponivel()`. O áudio em base64 (texto curto, ≤ 4 MB) também segue pelo caminho atual do `send`.

Essa é a única assimetria do contrato: Inbox **lê** do Garage já; Inbox **escreve** ainda no Supabase até a ponte virar. Está registrado para não ficar ponto em aberto.

### 2.5 Fechamento: rotas DELETE (releitura)

Para cobrir todos os `remove(...)` do front (§4.1, 4.3, 4.5, 4.6), o §2.3 ganha as rotas de exclusão (login; mesma regra de dono do upload):

| Método | Caminho | Bucket | Dono |
|---|---|---|---|
| DELETE | `/api/arquivos/foto/*key` | `imoveis-fotos` | livre (público, como o insert/delete de hoje em `authenticated`) |
| DELETE | `/api/arquivos/video/*key` | `videos` | prefixo `<get_corretor_id()>/` |
| DELETE | `/api/arquivos/documento/*key` | `documentos` | linha visível em `documentos`/`contratos` (como §3) |

Respondem 204. Objeto inexistente no Garage ⇒ 204 mesmo assim (delete idempotente, como o `remove` do Supabase hoje, que não falha quando o path já sumiu). `apagarArquivoApi(grupo, key)` no adaptador (§4.0) cobre os três.

Inbox e anexo-IA **não** têm DELETE de arquivo pelo front (o front nunca apaga esses objetos hoje), então não ganham rota de exclusão.

---

## 5. Script de cópia `scripts/dados/copiar-storage.mjs` (só descrito; não escrever agora)

Objetivo: copiar os objetos dos seis buckets do Supabase para o Garage, com a **mesma key** e o **mesmo content-type**. Não apaga nada no Supabase.

Entradas (variáveis de ambiente, nunca hard-coded):
- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (service key — lida só por nome; o script a usa via `@supabase/supabase-js` com `storage.from(bucket).list/download`).
- Garage/S3: as mesmas `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (via `@aws-sdk/client-s3`).

Comportamento:
1. Para cada bucket em `['imoveis-fotos','videos','documentos','ai-attachments','lotti-inbox-files','lotti-inbox-audio']`:
   - lista recursivamente todos os objetos (o `list` do Supabase é por "pasta"; o script desce em cada prefixo — as keys têm `/`), paginando;
   - para cada objeto: `HEAD` no Garage (`existe`); se já existe **com o mesmo tamanho**, pula (idempotente); senão, `download` do Supabase (stream) e `Upload` para o Garage com `ContentType` = o `metadata.mimetype`/`content-type` do objeto de origem (preservado);
   - acumula contagem e bytes copiados/pulados.
2. **Conferência final por bucket:** total de objetos na origem × total no destino (via `list`/`ListObjectsV2`) e soma de bytes; imprime uma tabela `bucket | origem(obj,bytes) | destino(obj,bytes) | faltando`. Sai com código ≠ 0 se algum bucket tiver `faltando > 0`.
3. Streaming ponta a ponta (sem carregar o arquivo inteiro na memória — o vídeo de 500 MB passa como stream). Reexecutável quantas vezes for preciso (idempotência por `HEAD`).

O script é só de migração de dados: **não** toca o banco, **não** apaga origem, **não** cria bucket (os buckets já existem no Garage). Rodado manualmente pelo dono, uma vez, antes da virada de `VITE_API_URL`/`S3_*` em produção.

---

## 6. Testes obrigatórios

### 6.1 Front (Vitest) — `src/lib/api/arquivos.test.ts`
- `urlPublicaFoto`/`urlPublicaVideo`: montam `${BASE}/api/arquivos/publico/foto/<key codificada>` preservando `/` entre segmentos e codificando caracteres especiais do nome; sem `BASE`, o teste cobre que os hooks caem no ramo Supabase (via `apiDisponivel()` mockado `false`).
- `enviarArquivoApi`: faz `PUT` com `Content-Type` = `file.type`, corpo = o `File` (não base64, não JSON), caminho com a key; devolve `key` do corpo; em `!ok`, lança `ErroApi` com o texto certo.
- `prepararInboxApi`: `POST` com `{request_id,name,mime,size}`; devolve `{storage_path}`.
- `baixarPrivadoApi`/`baixarInboxApi`: chamam `chamarApi` (token no header — conferir que **não** vai token na URL), leem `blob`, devolvem `URL.createObjectURL`; 403 ⇒ lança.
- Mock de `fetch`/`chamarApi` e de `URL.createObjectURL`. Nenhuma rede.

### 6.2 Front (Vitest) — adaptadores nos hooks
- `useImovelFotos`, `useVideos`, `useDocumentos`, `useFileUpload`, `AnalisarContratoDialog`, `ImovelMediaManager`, `ConnectedInbox.MessageBody`, `MessageComposer.AudioMessage`: com `apiDisponivel()` mockado, cobrir os **dois ramos** (com e sem API) em cada ponto trocado, conferindo que:
  - a key gravada/usada é idêntica nos dois ramos (preservação 1:1);
  - sem `VITE_API_URL`, nenhuma chamada à API acontece (o `supabase.storage` é o único chamado) — prova da decisão 5;
  - no Inbox, o **upload** continua no Supabase mesmo com API ligada (§4.8), e só o **download** troca.

### 6.3 API (Jest, texto/mocks do S3) — `api/src/storage/storage.service.spec.ts` e `api/src/arquivos/arquivos.controller.spec.ts`
- `StorageService` com o `S3Client` **mockado** (nenhuma rede): `obter` repassa `Range` e devolve 206 com `Content-Range`; `NoSuchKey` ⇒ `erroApi(404,...)`; config ausente ⇒ `503 storage_indisponivel`; `enviar` chama `Upload.done` com `Bucket/Key/Body/ContentType`; nunca loga credencial.
- `ArquivosController`/`Service`: rota pública serve sem guard; rota privada chama a checagem de dono (TenantDb mockado) **antes** do `obter` e, com resultado vazio, responde 403 `arquivo_de_outra_conta` sem chamar o S3; `validarKey` recusa `..`, `\`, `//`, início com `/` (400 `key_invalida`); o splat entrega `a/b/c.pdf` inteiro; upload acima do teto ⇒ 413; `PUT` de documento com key fora do prefixo do corretor ⇒ 403; corpo binário chega íntegro ao serviço (prova do §0.6).
- Os testes seguem o §0.5 do módulo 2 (lêem `.text`), sem Supabase, sem Garage, sem rede.

### 6.4 API (sql-real) — `api/test/sql-real/arquivos.test.ts`
Usa `api/test/sql-real/harness.ts` (sem editá-lo). Aplica a cadeia de migrations do harness (as tabelas `documentos`, `contratos`, `ai_attachments`, `lotti_agent_messages`, `lotti_manual_sends` com seu RLS) e prova, com **duas contas**:
- `select 1 ... where arquivo_path = key` (e as variantes de §3) devolve linha só para o dono; key de outra conta volta vazio (⇒ 403 na rota);
- key de `contratos.arquivo_url` do próprio corretor libera o download de documento;
- a consulta roda sob `TenantDb` (claims `authenticated`) — claims inválidas ⇒ `claims_invalidas`.

---

## 7. Pendências

### 7.1 Variáveis e provisionamento
- **P1** — Confirmar no Garage os seis buckets (incluindo `lotti-inbox-audio`); `imoveis-fotos` e `videos` com **leitura pública** no Garage e os demais privados. (O enunciado diz "5"; o uso real são 6.)
- Variáveis na API (Railway): `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` — já recebidas, confirmar valores (não lidos por valor aqui).
- `VITE_API_URL` no front só deve ser ligada **depois** de rodar `copiar-storage.mjs` e conferir contagem/bytes por bucket (§5). Antes disso, o front segue no Supabase (decisão 5).
- Ordem da virada: (1) deploy da API com `StorageModule`/`ArquivosModule` e `S3_*`; (2) rodar o script de cópia; (3) ligar `VITE_API_URL` no front.

### 7.2 Migrations propostas (não aplicar; só descritas, com SQL)
- **P2 — reescrever as URLs públicas gravadas** (opcional, só para o dia em que o Supabase Storage sair do ar). Enquanto o Supabase existir, a exibição deriva da key (§4.2) e isto é dispensável. SQL (idempotente, por conta):
  ```sql
  -- troca o host do Supabase pela rota pública da API, preservando a key
  update public.imovel_fotos
     set arquivo_url = 'https://api.plataformalotti.com.br/api/arquivos/publico/foto/' || arquivo_path
   where arquivo_url like 'http%/storage/v1/object/%/imoveis-fotos/%';
  update public.videos
     set video_url = 'https://api.plataformalotti.com.br/api/arquivos/publico/video/' || video_path
   where video_url like 'http%/storage/v1/object/%/videos/%';
  ```
  Nenhuma coluna nova; só reescrita de valor. Não mexe em `arquivo_path`/`video_path` (as keys).
- Nenhuma migration é necessária para `documentos`/`ai_attachments`/`lotti_*`: a key já está guardada (`arquivo_path`/`storage_path`/`media_path`) e o download privado usa a key como está.

### 7.3 Edge Functions e ponte (fase seguinte, fora deste escopo)
- **P3 — `supabase/functions/ai-process-file/index.ts`**: hoje grava o anexo de IA em `ai-attachments` no Supabase. Migrar para o Garage (via a mesma API ou um cliente S3 no Deno) e então ligar o download `/api/arquivos/anexo-ia` no front onde for preciso.
- **P4 — Inbox outbound + ponte**: enquanto a ponte (runtime do agente, VPS) ler o arquivo do Supabase para enviar ao WhatsApp, o **upload** do Inbox (`MessageComposer` send + `prepare_upload` da Edge Function `lotti-whatsapp`) permanece no Supabase (§4.8). Virar quando a ponte passar a buscar a mídia pela API/Garage. O **download/exibição** do Inbox já migra nesta fase.

### 7.4 Observações de escopo
- `avatars` (no tipo de `useFileUpload`) não tem uso real no front; sem rota nesta fase.
- A análise de contrato por IA (`/api/contratos/ia/analisar`, base64 ≤ 15 MB) **não** é armazenamento e segue como está — o limite de 21 MB do body JSON (`main.ts`) continua valendo só para JSON e não é tocado.
