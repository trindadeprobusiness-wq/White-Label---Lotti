import { webcrypto } from 'node:crypto';
import { chaveAes, cifrar, compararSegredo, decifrar, sha256Base64Url, tokenAleatorio } from './cripto';

const BYTES = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const HEX = Buffer.from(BYTES).toString('hex');
const B64 = Buffer.from(BYTES).toString('base64');
const B64URL = B64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const IV = Uint8Array.from({ length: 12 }, (_, i) => 200 - i);

/** Igual a encryptSecret do Deno, mas com iv fixo. */
async function cifrarWebCrypto(texto: string): Promise<string> {
  const chave = await webcrypto.subtle.importKey('raw', BYTES, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const enc = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: IV }, chave, new TextEncoder().encode(texto)));
  const payload = new Uint8Array(IV.length + enc.length);
  payload.set(IV);
  payload.set(enc, IV.length);
  return `v1.${Buffer.from(payload).toString('base64')}`;
}

async function decifrarWebCrypto(valor: string): Promise<string> {
  const chave = await webcrypto.subtle.importKey('raw', BYTES, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const payload = Buffer.from(valor.slice(3), 'base64');
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, 12) }, chave, payload.subarray(12));
  return new TextDecoder().decode(plain);
}

describe('cripto (compatível com o WebCrypto do Deno)', () => {
  it('vetor fixo do WebCrypto é decifrado pelo Node', async () => {
    const vetor = await cifrarWebCrypto('refresh-token-sensível');
    expect(vetor.startsWith('v1.')).toBe(true);
    expect(decifrar(vetor, B64)).toBe('refresh-token-sensível');
  });

  it('o que o Node cifra o WebCrypto decifra; iv aleatório', async () => {
    const a = cifrar('segredo', HEX);
    const b = cifrar('segredo', HEX);
    expect(a).not.toBe(b);
    expect(await decifrarWebCrypto(a)).toBe('segredo');
    expect(Buffer.from(a.slice(3), 'base64').length).toBe(12 + 'segredo'.length + 16);
  });

  it('aceita chave hex, base64 e base64url; recusa tamanho errado', () => {
    expect(chaveAes(HEX)).toEqual(Buffer.from(BYTES));
    expect(chaveAes(B64)).toEqual(Buffer.from(BYTES));
    expect(chaveAes(B64URL)).toEqual(Buffer.from(BYTES));
    expect(() => chaveAes('curta')).toThrow('invalid_encryption_key');
    expect(() => chaveAes('ab'.repeat(31))).toThrow('invalid_encryption_key');
    expect(decifrar(cifrar('x', B64URL), HEX)).toBe('x');
  });

  it('tag adulterada, prefixo ausente ou chave errada → token_decrypt_failed', () => {
    const c = cifrar('segredo', HEX);
    const buf = Buffer.from(c.slice(3), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decifrar(`v1.${buf.toString('base64')}`, HEX)).toThrow('token_decrypt_failed');
    expect(() => decifrar('sem-prefixo', HEX)).toThrow('token_decrypt_failed');
    expect(() => decifrar(null, HEX)).toThrow('token_decrypt_failed');
    expect(() => decifrar(c, 'cd'.repeat(32))).toThrow('token_decrypt_failed');
  });

  it('sha256Base64Url é estável e sem padding; tokenAleatorio é base64url', () => {
    expect(sha256Base64Url('state')).toBe(sha256Base64Url('state'));
    expect(sha256Base64Url('state')).not.toBe('state');
    expect(sha256Base64Url('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenAleatorio(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenAleatorio(64)).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });

  it('compararSegredo', () => {
    expect(compararSegredo('abc', 'abc')).toBe(true);
    expect(compararSegredo('abc', 'abd')).toBe(false);
    expect(compararSegredo('abc', 'abcd')).toBe(false);
    expect(compararSegredo(null, 'abc')).toBe(false);
  });
});
