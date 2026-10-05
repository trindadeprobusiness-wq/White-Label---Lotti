// Copia os arquivos dos 6 buckets do Supabase Storage para o Garage (S3 self-hosted no Railway),
// preservando bucket, key e content-type (cópia 1:1 — os valores já gravados no banco seguem válidos
// como key, sem backfill). Não apaga a origem, não cria bucket e não toca no banco.
//
// - Idempotente: antes de copiar, faz HEAD no Garage; se o objeto existe com o mesmo tamanho, pula.
// - Streaming ponta a ponta: o corpo vem da origem como stream e vai para o Upload multipart do S3.
//   Vídeo de 500 MB não é bufferizado em memória.
// - Segredos só por nome de variável; nenhum valor é impresso.
// - Conferência final por bucket (contagem e bytes origem × destino); sai com código 1 se faltar algo.
//
// Uso (variáveis no ambiente, nunca impressas):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE
//   node api/scripts/dados/copiar-storage.mjs
//
// Rodar ANTES de ligar VITE_API_URL em produção. Ordem: deploy da API → este script → VITE_API_URL.
import { Readable } from 'node:stream';
import {
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const BUCKETS = [
  'imoveis-fotos',
  'videos',
  'documentos',
  'ai-attachments',
  'lotti-inbox-files',
  'lotti-inbox-audio',
];

function exigir(nome) {
  const v = process.env[nome]?.trim();
  if (!v) {
    console.error(`Variável ${nome} ausente.`);
    process.exit(2);
  }
  return v;
}

const SUPABASE_URL = exigir('SUPABASE_URL').replace(/\/+$/, '');
const SERVICE_ROLE = exigir('SUPABASE_SERVICE_ROLE_KEY');

const s3 = new S3Client({
  endpoint: exigir('S3_ENDPOINT'),
  region: exigir('S3_REGION'),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() !== 'false',
  credentials: { accessKeyId: exigir('S3_ACCESS_KEY_ID'), secretAccessKey: exigir('S3_SECRET_ACCESS_KEY') },
});

const cabecalhoSupabase = { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE };

/** Lista todas as keys de um bucket, paginando a API Storage do Supabase (recursivo nas pastas). */
async function listarBucket(bucket, prefixo = '') {
  const keys = [];
  const limite = 100;
  let offset = 0;
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...cabecalhoSupabase, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: prefixo, limit: limite, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${bucket} (${res.status})`);
    const pagina = await res.json();
    for (const item of pagina) {
      const caminho = prefixo ? `${prefixo}${item.name}` : item.name;
      // Pasta: id/metadata nulos. Desce um nível.
      if (item.id === null || item.metadata === null || item.metadata === undefined) {
        keys.push(...(await listarBucket(bucket, `${caminho}/`)));
      } else {
        keys.push({ key: caminho, tamanho: item.metadata.size ?? null, contentType: item.metadata.mimetype ?? null });
      }
    }
    if (pagina.length < limite) break;
    offset += limite;
  }
  return keys;
}

async function headGarage(bucket, key) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { tamanho: typeof r.ContentLength === 'number' ? r.ContentLength : null };
  } catch (e) {
    if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

async function copiarObjeto(bucket, { key, tamanho, contentType }) {
  const existente = await headGarage(bucket, key);
  if (existente && tamanho !== null && existente.tamanho === tamanho) return 'pulado';

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURI(key)}`, { headers: cabecalhoSupabase });
  if (!res.ok || !res.body) throw new Error(`download ${bucket}/${key} (${res.status})`);
  const tipo = contentType ?? res.headers.get('content-type') ?? 'application/octet-stream';
  const corpo = Readable.fromWeb(res.body);
  await new Upload({ client: s3, params: { Bucket: bucket, Key: key, Body: corpo, ContentType: tipo } }).done();
  return 'copiado';
}

async function main() {
  let faltou = false;
  for (const bucket of BUCKETS) {
    const origem = await listarBucket(bucket);
    let copiados = 0;
    let pulados = 0;
    for (const obj of origem) {
      const r = await copiarObjeto(bucket, obj);
      if (r === 'copiado') copiados += 1;
      else pulados += 1;
    }
    // Conferência: toda key da origem precisa existir no destino com o mesmo tamanho.
    let destinoOk = 0;
    for (const obj of origem) {
      const head = await headGarage(bucket, obj.key);
      if (head && (obj.tamanho === null || head.tamanho === obj.tamanho)) destinoOk += 1;
    }
    const ok = destinoOk === origem.length;
    if (!ok) faltou = true;
    console.log(`[${bucket}] origem=${origem.length} copiados=${copiados} pulados=${pulados} destino_ok=${destinoOk} ${ok ? 'OK' : 'FALTANDO'}`);
  }
  if (faltou) {
    console.error('Conferência falhou: há objetos faltando no Garage.');
    process.exit(1);
  }
  console.log('Cópia concluída e conferida.');
}

main().catch((e) => {
  console.error('Falha na cópia:', e?.message ?? e);
  process.exit(1);
});
