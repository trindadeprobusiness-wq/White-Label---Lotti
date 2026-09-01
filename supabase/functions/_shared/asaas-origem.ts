// De qual inquilino é um evento que chegou no webhook da Asaas.
//
// Vive aqui, e não dentro de `asaas-webhook/index.ts`, por um motivo prático:
// o index chama `serve()` no topo do módulo e não pode ser importado por um
// teste. Este é o portão que decide de quem é o dinheiro — precisa de teste.

export type Origem =
    | { ok: true; corretorId: string | null; legado: boolean }
    | { ok: false; motivo: string };

export interface ConexaoOrigem {
    id: string;
    corretor_id: string;
}

export interface FontesOrigem {
    buscarConexaoPorSlug: (slug: string) => Promise<ConexaoOrigem | null>;
    buscarTokenCifrado: (conexaoId: string) => Promise<string | null>;
    decifrar: (ciphertext: string) => Promise<string>;
    tokenGlobal: () => string | undefined;
    buscarHerdada: () => Promise<{ corretor_id: string } | null>;
}

/**
 * Comparação em tempo constante sobre digests.
 *
 * Comparar as strings direto sai no primeiro byte diferente, e essa diferença
 * de tempo é medível o bastante para descobrir o token byte a byte. Passar pelo
 * SHA-256 antes também iguala o comprimento, então nem o tamanho vaza.
 */
export async function tokensIguais(fornecido: string | null, esperado: string): Promise<boolean> {
    if (!fornecido) return false;
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest("SHA-256", enc.encode(fornecido)),
        crypto.subtle.digest("SHA-256", enc.encode(esperado)),
    ]);
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
    return diff === 0;
}

/**
 * Com conta por inquilino, cada corretor cadastra o webhook no painel DELE, e a
 * URL leva `?t=<webhook_slug>`. O slug diz de quem PROVAVELMENTE é o evento; o
 * token cifrado daquela conexão é o que prova. O slug sozinho não autoriza nada.
 *
 * Sem slug o evento vem do webhook legado, de quando existia uma conta só. Ele
 * segue válido pelo token global e é atribuído a quem herdou a chave do
 * ambiente — é essa atribuição que tira o `null` da conciliação de repasse.
 */
export async function resolverOrigem(
    fontes: FontesOrigem,
    entrada: { slug: string | null; tokenRecebido: string | null },
): Promise<Origem> {
    const { slug, tokenRecebido } = entrada;

    if (slug) {
        const conexao = await fontes.buscarConexaoPorSlug(slug);
        if (!conexao) return { ok: false, motivo: "origem desconhecida" };

        const cifrado = await fontes.buscarTokenCifrado(conexao.id);
        if (!cifrado) return { ok: false, motivo: "conexão sem token de webhook" };

        let esperado: string;
        try {
            esperado = await fontes.decifrar(cifrado);
        } catch {
            // Token ilegível é falha de configuração, não autorização concedida.
            return { ok: false, motivo: "token de webhook ilegível" };
        }

        if (!(await tokensIguais(tokenRecebido, esperado))) {
            return { ok: false, motivo: "token inválido" };
        }
        return { ok: true, corretorId: conexao.corretor_id, legado: false };
    }

    const global = fontes.tokenGlobal();
    if (!global) return { ok: false, motivo: "ASAAS_WEBHOOK_TOKEN não configurado" };
    if (!(await tokensIguais(tokenRecebido, global))) return { ok: false, motivo: "token inválido" };

    const herdada = await fontes.buscarHerdada();
    return { ok: true, corretorId: herdada?.corretor_id ?? null, legado: true };
}
