import { inflateRawSync } from 'node:zlib';

// Porte dos auxiliares de extração de supabase/functions/ai-process-file/index.ts: mesmo algoritmo e
// mesmos textos. Só a descompressão troca o DecompressionStream do Deno pelo zlib do Node, e a leitura
// do ZIP respeita o byteOffset do Buffer (o Buffer do Node pode ser uma fatia de um ArrayBuffer maior).

export const MAX_TEXTO_EXTRAIDO = 50_000;

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function textoDoPdf(bytes: Uint8Array): string {
  const texto = new TextDecoder('latin1').decode(bytes);
  const blocos: string[] = [];
  const regex = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(texto)) !== null) {
    const decodificado = m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\\\/g, '\\')
      .replace(/\\([()])/g, '$1');
    if (decodificado.trim().length > 1) blocos.push(decodificado.trim());
  }
  const resultado = blocos.join(' ').slice(0, MAX_TEXTO_EXTRAIDO);
  return resultado || '[Não foi possível extrair texto do PDF — pode conter imagens ou estar protegido]';
}

/** Procura um arquivo no ZIP pelos cabeçalhos locais (PK\x03\x04), como a função. */
export function xmlNoZip(zip: Uint8Array, alvo: string): string | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let offset = 0;
  while (offset < zip.length - 30) {
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset++;
      continue;
    }
    const metodo = view.getUint16(offset + 8, true);
    const tamanho = view.getUint32(offset + 18, true);
    const tamanhoNome = view.getUint16(offset + 26, true);
    const tamanhoExtra = view.getUint16(offset + 28, true);
    const nome = new TextDecoder().decode(zip.slice(offset + 30, offset + 30 + tamanhoNome));
    const inicioDados = offset + 30 + tamanhoNome + tamanhoExtra;
    if (nome === alvo) {
      const dados = zip.slice(inicioDados, inicioDados + tamanho);
      if (metodo === 0) return new TextDecoder().decode(dados);
      try {
        return new TextDecoder().decode(inflateRawSync(dados));
      } catch {
        return null;
      }
    }
    offset = inicioDados + tamanho;
  }
  return null;
}

export function textoDoDocx(bytes: Uint8Array): string {
  try {
    const xml = xmlNoZip(bytes, 'word/document.xml');
    if (!xml) return '[Não foi possível extrair texto do DOCX]';
    const limpo = xml
      .replace(/<w:p[^>]*>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return limpo.slice(0, MAX_TEXTO_EXTRAIDO) || '[DOCX vazio]';
  } catch {
    return '[Erro ao processar DOCX]';
  }
}

export function textoDoXlsx(bytes: Uint8Array): string {
  try {
    const compartilhadas = xmlNoZip(bytes, 'xl/sharedStrings.xml');
    if (!compartilhadas) return '[Não foi possível extrair dados do XLSX]';
    const textos: string[] = [];
    const regex = /<t[^>]*>([^<]*)<\/t>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(compartilhadas)) !== null) {
      if (m[1].trim()) textos.push(m[1].trim());
    }
    return textos.join(', ').slice(0, MAX_TEXTO_EXTRAIDO) || '[XLSX vazio]';
  } catch {
    return '[Erro ao processar XLSX]';
  }
}

export interface Extraido {
  texto: string;
  metadata: Record<string, unknown>;
}

/** O ramo por tipo do ai-process-file; o storagePath entra só no metadata de imagem, como lá. */
export function extrair(bytes: Uint8Array, mime: string, nome: string, extensao: string, storagePath: string): Extraido {
  if (mime === 'text/plain' || mime === 'text/csv') {
    let texto = new TextDecoder().decode(bytes);
    if (texto.length > MAX_TEXTO_EXTRAIDO) texto = `${texto.slice(0, MAX_TEXTO_EXTRAIDO)}\n\n[...conteúdo truncado]`;
    return { texto, metadata: {} };
  }
  if (mime === 'application/pdf') {
    const texto = textoDoPdf(bytes);
    return { texto, metadata: { pages_estimated: Math.max(1, (texto.match(/\f/g) || []).length + 1) } };
  }
  if (mime === MIME_DOCX) return { texto: textoDoDocx(bytes), metadata: {} };
  if (mime === MIME_XLSX) return { texto: textoDoXlsx(bytes), metadata: { type: 'spreadsheet' } };
  if (mime.startsWith('image/')) return { texto: `[Imagem: ${nome}]`, metadata: { storage_path: storagePath, width: 0, height: 0 } };
  if (mime.startsWith('video/')) {
    const mb = bytes.length / (1024 * 1024);
    return {
      texto: `[Vídeo: ${nome}, ${mb.toFixed(1)}MB]`,
      metadata: { duration_estimate: 'unknown', size_mb: mb.toFixed(2), format: extensao },
    };
  }
  return { texto: `[Arquivo não suportado para extração: ${nome}]`, metadata: {} };
}
