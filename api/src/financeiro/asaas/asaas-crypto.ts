import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Porte de supabase/functions/_shared/asaas-crypto.ts com node:crypto.
 * Formato: 'v1.' + base64(iv(12) ‖ ciphertext ‖ tag(16)), exatamente o que o AES-GCM do WebCrypto
 * (Deno) produz, porque lá o tag vem colado no fim do texto cifrado. Assim os segredos gravados pelas
 * Edge Functions decifram aqui e vice-versa, com a mesma ASAAS_TOKEN_ENCRYPTION_KEY.
 */
const PREFIXO = 'v1.';
const NOME_CHAVE = 'ASAAS_TOKEN_ENCRYPTION_KEY';

/** Aceita 64 hex ou base64/base64url de 32 bytes. */
export function normalizarChave(bruto: string | undefined): Buffer {
  if (!bruto) throw new Error(`${NOME_CHAVE} não configurada`);
  const limpo = bruto.trim();
  if (/^[0-9a-fA-F]{64}$/.test(limpo)) return Buffer.from(limpo, 'hex');
  const b64 = limpo.replace(/-/g, '+').replace(/_/g, '/');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length === 32) return bytes;
  }
  throw new Error(`${NOME_CHAVE} deve ter 32 bytes (64 hex ou base64)`);
}

export function cifrar(valor: string, chaveBruta: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', normalizarChave(chaveBruta), iv);
  const corpo = Buffer.concat([cifra.update(valor, 'utf8'), cifra.final()]);
  return PREFIXO + Buffer.concat([iv, corpo, cifra.getAuthTag()]).toString('base64');
}

export function decifrar(valor: string | null | undefined, chaveBruta: string): string {
  if (!valor?.startsWith(PREFIXO)) throw new Error('segredo ausente ou em formato não suportado');
  const payload = Buffer.from(valor.slice(PREFIXO.length), 'base64');
  if (payload.length < 12 + 16) throw new Error('segredo ausente ou em formato não suportado');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(payload.length - 16);
  const corpo = payload.subarray(12, payload.length - 16);
  const decifra = createDecipheriv('aes-256-gcm', normalizarChave(chaveBruta), iv);
  decifra.setAuthTag(tag);
  return Buffer.concat([decifra.update(corpo), decifra.final()]).toString('utf8');
}

/** Token opaco (slug e segredo do webhook), base64url sem padding. */
export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Últimos dígitos da chave, para a tela mostrar QUAL chave está conectada; chave curta devolve vazio. */
export function finalDaChave(chave: string, quantos = 4): string {
  const limpo = (chave ?? '').trim();
  if (limpo.length <= quantos) return '';
  return limpo.slice(-quantos);
}
