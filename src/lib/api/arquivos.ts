import { chamarApi } from '@/lib/api';
import { lerErroApi, lerJson } from './http';

// Arquivos (fotos, vídeos, documentos, anexos de IA e mídias do Inbox) pela API Lotti.
// O browser nunca fala com o Garage (S3 interno); tudo passa por api.plataformalotti.com.br.
// Só é chamado atrás de apiDisponivel(). Nada de base64 em JSON: upload manda o File cru
// (streaming) e download recebe o binário como blob.
//
// REGRA DE OURO: a `key` é preservada exatamente como já está no banco. Nunca remontamos
// caminho — a cópia Supabase→Garage é 1:1, então os valores gravados seguem válidos.

// Mesma leitura de VITE_API_URL do src/lib/api.ts: a base das URLs públicas, que não
// levam token e são servidas pela rota pública da API.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '');

/** Codifica a key preservando as barras: cada segmento vira encodeURIComponent, o `/` fica. */
export function encodeKey(key: string): string {
  return key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

export type GrupoUpload = 'foto' | 'video' | 'documento';
export type GrupoPrivado = 'documento' | 'anexo-ia';
export type BucketInbox = 'lotti-inbox-files' | 'lotti-inbox-audio';

/** URL pública (sem login) de uma foto, servida pela API que faz stream do bucket público. */
export function urlPublicaFoto(key: string): string {
  return `${BASE}/api/arquivos/publico/foto/${encodeKey(key)}`;
}

/** URL pública (sem login) de um vídeo; a rota honra Range, então o <video> consegue buscar. */
export function urlPublicaVideo(key: string): string {
  return `${BASE}/api/arquivos/publico/video/${encodeKey(key)}`;
}

/**
 * Sobe um arquivo pela API (PUT com o corpo binário cru — nunca base64/JSON).
 * O Content-Type é o do próprio arquivo. Devolve a key confirmada pelo servidor.
 * Vídeo de até 500 MB passa por aqui: o File vai como corpo da requisição, sem bufferizar.
 */
export async function enviarArquivoApi(grupo: GrupoUpload, key: string, file: File): Promise<string> {
  const res = await chamarApi(`/api/arquivos/${grupo}/${encodeKey(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const json = await lerJson<{ ok?: boolean; key?: string }>(res, 'Não foi possível enviar o arquivo.');
  return json.key ?? key;
}

/** Sobe uma mídia do Inbox (bucket privado) pela API, também por streaming. */
export async function enviarInboxApi(bucket: BucketInbox, key: string, file: File): Promise<string> {
  const res = await chamarApi(`/api/arquivos/inbox/${bucket}/${encodeKey(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const json = await lerJson<{ ok?: boolean; key?: string }>(res, 'Não foi possível enviar o arquivo.');
  return json.key ?? key;
}

/** Pede à API o caminho de armazenamento de um anexo do Inbox (espelha buildAttachmentPath). */
export async function prepararInboxApi(dados: {
  request_id: string;
  name: string;
  mime: string;
  size: number;
}): Promise<{ storage_path: string }> {
  const res = await chamarApi('/api/arquivos/inbox/preparar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
  });
  return lerJson<{ storage_path: string }>(res, 'Não foi possível preparar o envio.');
}

/**
 * Baixa um arquivo privado (documento ou anexo de IA) pela API e devolve uma object URL.
 * O token vai no cabeçalho (nunca na URL). Quem chamar é responsável por revogar a URL
 * com URL.revokeObjectURL quando terminar.
 */
export async function baixarPrivadoApi(grupo: GrupoPrivado, key: string): Promise<string> {
  const res = await chamarApi(`/api/arquivos/${grupo}/${encodeKey(key)}`);
  if (!res.ok) throw await lerErroApi(res, 'Não foi possível acessar o arquivo.');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Tempo que a object URL de um arquivo aberto numa aba nova fica viva (o visualizador de PDF relê o blob). */
const VIDA_ABA_MS = 10 * 60 * 1000;

/**
 * Abre um arquivo privado numa aba nova (no lugar de `window.open(signedUrl)`). A aba é aberta antes do
 * download, ainda dentro do clique, para o bloqueador de pop-up não barrar; o blob entra nela depois. A object
 * URL é revogada sozinha depois de um tempo. Se o download falhar, a aba vazia é fechada e o erro sobe.
 */
export async function abrirPrivadoApi(grupo: GrupoPrivado, key: string): Promise<void> {
  const aba = window.open('', '_blank');
  try {
    const url = await baixarPrivadoApi(grupo, key);
    if (aba) aba.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), VIDA_ABA_MS);
  } catch (e) {
    aba?.close();
    throw e;
  }
}

/** Baixa uma mídia privada do Inbox pela API e devolve uma object URL (revogar depois). */
export async function baixarInboxApi(bucket: BucketInbox, key: string): Promise<string> {
  const res = await chamarApi(`/api/arquivos/inbox/${bucket}/${encodeKey(key)}`);
  if (!res.ok) throw await lerErroApi(res, 'Não foi possível acessar o arquivo.');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Apaga um arquivo pela API (idempotente no servidor). */
export async function apagarArquivoApi(grupo: GrupoUpload, key: string): Promise<void> {
  const res = await chamarApi(`/api/arquivos/${grupo}/${encodeKey(key)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await lerErroApi(res, 'Não foi possível remover o arquivo.');
}
