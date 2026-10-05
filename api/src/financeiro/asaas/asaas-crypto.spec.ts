import { randomBytes, webcrypto } from 'node:crypto';
import { cifrar, decifrar, finalDaChave, normalizarChave, tokenAleatorio } from './asaas-crypto';

const CHAVE_HEX = randomBytes(32).toString('hex');
const CHAVE_B64 = Buffer.from(CHAVE_HEX, 'hex').toString('base64');

/** O que a Edge Function (WebCrypto do Deno) grava: 'v1.' + base64(iv ‖ ciphertext‖tag). */
async function cifrarComoDeno(valor: string, chaveHex: string): Promise<string> {
  const chave = await webcrypto.subtle.importKey('raw', Buffer.from(chaveHex, 'hex'), 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, new TextEncoder().encode(valor)));
  return 'v1.' + Buffer.concat([Buffer.from(iv), Buffer.from(cifrado)]).toString('base64');
}

async function decifrarComoDeno(valor: string, chaveHex: string): Promise<string> {
  const payload = Buffer.from(valor.slice(3), 'base64');
  const chave = await webcrypto.subtle.importKey('raw', Buffer.from(chaveHex, 'hex'), 'AES-GCM', false, ['decrypt']);
  const plano = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, 12) }, chave, payload.subarray(12));
  return new TextDecoder().decode(plano);
}

describe('asaas-crypto', () => {
  it('aceita hex e base64 (e base64url) e chega nos mesmos 32 bytes', () => {
    const hex = normalizarChave(CHAVE_HEX);
    expect(hex).toHaveLength(32);
    expect(normalizarChave(CHAVE_B64).equals(hex)).toBe(true);
    expect(normalizarChave(CHAVE_B64.replace(/\+/g, '-').replace(/\//g, '_')).equals(hex)).toBe(true);
  });

  it('recusa chave ausente, de 31 bytes ou com tamanho errado', () => {
    expect(() => normalizarChave(undefined)).toThrow(/não configurada/);
    expect(() => normalizarChave(randomBytes(31).toString('hex'))).toThrow(/32 bytes/);
    expect(() => normalizarChave(randomBytes(31).toString('base64'))).toThrow(/32 bytes/);
    expect(() => normalizarChave('curta')).toThrow(/32 bytes/);
  });

  it('ida e volta, IV aleatório, prefixo v1. e o valor nunca aparece no texto cifrado', () => {
    const a = cifrar('$aact_segredo', CHAVE_HEX);
    const b = cifrar('$aact_segredo', CHAVE_HEX);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('segredo');
    expect(decifrar(a, CHAVE_HEX)).toBe('$aact_segredo');
    expect(decifrar(a, CHAVE_B64)).toBe('$aact_segredo');
  });

  it('compatível com o WebCrypto da Edge Function, nos dois sentidos', async () => {
    expect(decifrar(await cifrarComoDeno('chave-da-edge', CHAVE_HEX), CHAVE_HEX)).toBe('chave-da-edge');
    expect(await decifrarComoDeno(cifrar('chave-da-api', CHAVE_HEX), CHAVE_HEX)).toBe('chave-da-api');
  });

  it('não decifra com outra chave nem valor sem prefixo', () => {
    const c = cifrar('x', CHAVE_HEX);
    expect(() => decifrar(c, randomBytes(32).toString('hex'))).toThrow();
    expect(() => decifrar(null, CHAVE_HEX)).toThrow(/formato não suportado/);
    expect(() => decifrar('v2.abc', CHAVE_HEX)).toThrow(/formato não suportado/);
  });

  it('final da chave e token aleatório seguro para URL', () => {
    expect(finalDaChave('$aact_123456789')).toBe('6789');
    expect(finalDaChave('1234')).toBe('');
    const t = tokenAleatorio(24);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t).not.toBe(tokenAleatorio(24));
  });
});
