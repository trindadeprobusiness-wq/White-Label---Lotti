import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Compatível byte a byte com _shared/routine/google.ts (WebCrypto AES-GCM):
 * 'v1.' + base64(iv[12] ‖ ciphertext ‖ tag[16]).
 */
export function chaveAes(raw: string): Buffer {
  const valor = raw.trim();
  let bytes: Buffer;
  if (/^[0-9a-f]{64}$/i.test(valor)) {
    bytes = Buffer.from(valor, 'hex');
  } else {
    const b64 = valor.replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) throw new Error('invalid_encryption_key');
    bytes = Buffer.from(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='), 'base64');
  }
  if (bytes.length !== 32) throw new Error('invalid_encryption_key');
  return bytes;
}

function chavePadrao(): string {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw?.trim()) throw new Error('invalid_encryption_key');
  return raw;
}

export function cifrar(texto: string, chave: string = chavePadrao()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', chaveAes(chave), iv);
  const corpo = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, corpo, cipher.getAuthTag()]).toString('base64')}`;
}

export function decifrar(valor: string | null | undefined, chave: string = chavePadrao()): string {
  if (!valor?.startsWith('v1.')) throw new Error('token_decrypt_failed');
  const chaveBytes = chaveAes(chave);
  try {
    const buf = Buffer.from(valor.slice(3), 'base64');
    if (buf.length < 12 + 16) throw new Error('curto');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const corpo = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', chaveBytes, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(corpo), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('token_decrypt_failed');
  }
}

export function base64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function sha256Base64Url(texto: string): string {
  return base64Url(createHash('sha256').update(texto, 'utf8').digest());
}

export function tokenAleatorio(n = 32): string {
  return base64Url(randomBytes(n));
}

/** Compara em tempo constante sobre os hashes (os dois lados têm o mesmo tamanho). */
export function compararSegredo(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
