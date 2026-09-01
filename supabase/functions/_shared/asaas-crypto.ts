/**
 * Cifra dos segredos da Asaas.
 *
 * Mesmo desenho já usado no Google Calendar e na Meta: AES-256-GCM com IV
 * aleatório por operação e prefixo de versão no texto cifrado. O prefixo é o
 * que permite trocar o algoritmo depois sem precisar adivinhar como cada linha
 * antiga foi gravada.
 *
 * A chave vive só no ambiente da Edge Function, em ASAAS_TOKEN_ENCRYPTION_KEY.
 * Ela NÃO é a mesma da Meta nem a do Google: chave compartilhada entre
 * integrações transforma o vazamento de uma no vazamento de todas.
 *
 * Todas as funções aceitam a chave por parâmetro. Isso não é enfeite de teste:
 * é o que permite exercitar a cifra no vitest, que roda em Node e não tem
 * `Deno`. Sem isso, a única cobertura possível seria em produção.
 */

declare const Deno: { env: { get(name: string): string | undefined } } | undefined;

const PREFIXO = "v1.";
const NOME_CHAVE = "ASAAS_TOKEN_ENCRYPTION_KEY";

/** Lê a chave do ambiente sem explodir onde `Deno` não existe (vitest). */
function chaveDoAmbiente(): string | undefined {
    return typeof Deno !== "undefined" ? Deno?.env.get(NOME_CHAVE) : undefined;
}

/**
 * Aceita 64 hex ou base64 de 32 bytes — os dois formatos que um gerador de
 * chave costuma cuspir. Recusar um deles só produziria um erro obscuro na
 * primeira cobrança, e não no momento de configurar.
 */
export function normalizarChave(bruto: string | undefined): Uint8Array {
    if (!bruto) throw new Error(`${NOME_CHAVE} não configurada`);

    const limpo = bruto.trim();

    if (/^[0-9a-fA-F]{64}$/.test(limpo)) {
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) bytes[i] = parseInt(limpo.slice(i * 2, i * 2 + 2), 16);
        return bytes;
    }

    try {
        const bin = atob(limpo.replace(/-/g, "+").replace(/_/g, "/"));
        if (bin.length === 32) {
            const bytes = new Uint8Array(32);
            for (let i = 0; i < 32; i++) bytes[i] = bin.charCodeAt(i);
            return bytes;
        }
    } catch {
        // cai no erro abaixo
    }

    throw new Error(`${NOME_CHAVE} deve ter 32 bytes (64 hex ou base64)`);
}

async function chaveAes(chaveBruta?: string): Promise<CryptoKey> {
    const bytes = normalizarChave(chaveBruta ?? chaveDoAmbiente());
    return crypto.subtle.importKey(
        "raw",
        bytes.buffer as ArrayBuffer,
        "AES-GCM",
        false,
        ["encrypt", "decrypt"],
    );
}

function base64(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function deBase64(valor: string): Uint8Array {
    const bin = atob(valor);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

export async function cifrar(valor: string, chaveBruta?: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cifrado = new Uint8Array(await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await chaveAes(chaveBruta),
        new TextEncoder().encode(valor),
    ));
    const payload = new Uint8Array(iv.length + cifrado.length);
    payload.set(iv, 0);
    payload.set(cifrado, iv.length);
    return PREFIXO + base64(payload);
}

export async function decifrar(valor: string | null | undefined, chaveBruta?: string): Promise<string> {
    if (!valor?.startsWith(PREFIXO)) throw new Error("segredo ausente ou em formato não suportado");
    const payload = deBase64(valor.slice(PREFIXO.length));
    const iv = payload.slice(0, 12);
    const cifrado = payload.slice(12);
    const plano = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await chaveAes(chaveBruta), cifrado);
    return new TextDecoder().decode(plano);
}

/** Token opaco para o slug e o segredo do webhook por inquilino. */
export function tokenAleatorio(bytes = 32): string {
    const buf = crypto.getRandomValues(new Uint8Array(bytes));
    return base64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Os últimos dígitos da chave, para a interface mostrar QUAL chave está
 * conectada sem revelá-la. Chave curta demais devolve vazio em vez de
 * expor a coisa inteira — o caso degenerado aqui é justamente o perigoso.
 */
export function finalDaChave(chave: string, quantos = 4): string {
    const limpo = (chave ?? "").trim();
    if (limpo.length <= quantos) return "";
    return limpo.slice(-quantos);
}

/** Comparação em tempo constante — usada no token do webhook. */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diferenca = 0;
    for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diferenca === 0;
}
