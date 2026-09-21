import { describe, expect, it } from "vitest";
import { resolverOrigem, tokensIguais, type FontesOrigem } from "./asaas-origem";

const TOKEN_A = "token-do-corretor-A";
const TOKEN_GLOBAL = "token-global-legado";

function fontes(over: Partial<FontesOrigem> = {}): FontesOrigem {
    return {
        buscarConexaoPorSlug: async (slug) =>
            slug === "slug-a" ? { id: "cx-a", corretor_id: "corretor-A" } : null,
        buscarTokenCifrado: async (id) => (id === "cx-a" ? `cifrado:${TOKEN_A}` : null),
        decifrar: async (c) => c.replace(/^cifrado:/, ""),
        tokenGlobal: () => TOKEN_GLOBAL,
        buscarHerdada: async () => ({ corretor_id: "corretor-oliver" }),
        ...over,
    };
}

describe("resolverOrigem — webhook por inquilino", () => {
    it("identifica o corretor pelo slug quando o token daquela conexão confere", async () => {
        const r = await resolverOrigem(fontes(), { slug: "slug-a", tokenRecebido: TOKEN_A });
        expect(r).toEqual({ ok: true, corretorId: "corretor-A", legado: false });
    });

    it("recusa o token de OUTRO inquilino no slug de um inquilino", async () => {
        // O ataque óbvio: quem conhece o próprio token tenta usá-lo na URL alheia.
        const r = await resolverOrigem(fontes(), { slug: "slug-a", tokenRecebido: "token-do-corretor-B" });
        expect(r).toEqual({ ok: false, motivo: "token inválido" });
    });

    it("recusa o token global num slug de inquilino", async () => {
        const r = await resolverOrigem(fontes(), { slug: "slug-a", tokenRecebido: TOKEN_GLOBAL });
        expect(r.ok).toBe(false);
    });

    it("recusa slug desconhecido sem sequer olhar o token", async () => {
        let olhou = false;
        const r = await resolverOrigem(
            fontes({ buscarTokenCifrado: async () => { olhou = true; return "x"; } }),
            { slug: "slug-inexistente", tokenRecebido: TOKEN_A },
        );
        expect(r).toEqual({ ok: false, motivo: "origem desconhecida" });
        expect(olhou).toBe(false);
    });

    it("recusa conexão que ainda não tem token de webhook", async () => {
        const r = await resolverOrigem(
            fontes({ buscarTokenCifrado: async () => null }),
            { slug: "slug-a", tokenRecebido: TOKEN_A },
        );
        expect(r).toEqual({ ok: false, motivo: "conexão sem token de webhook" });
    });

    it("token ilegível NEGA em vez de deixar passar", async () => {
        const r = await resolverOrigem(
            fontes({ decifrar: async () => { throw new Error("chave errada"); } }),
            { slug: "slug-a", tokenRecebido: TOKEN_A },
        );
        expect(r).toEqual({ ok: false, motivo: "token de webhook ilegível" });
    });
});

describe("resolverOrigem — webhook legado, sem slug", () => {
    it("aceita o token global e atribui a quem herdou a conta do ambiente", async () => {
        const r = await resolverOrigem(fontes(), { slug: null, tokenRecebido: TOKEN_GLOBAL });
        expect(r).toEqual({ ok: true, corretorId: "corretor-oliver", legado: true });
    });

    it("recusa token errado no caminho legado", async () => {
        const r = await resolverOrigem(fontes(), { slug: null, tokenRecebido: "errado" });
        expect(r).toEqual({ ok: false, motivo: "token inválido" });
    });

    it("recusa quando não há token global configurado", async () => {
        const r = await resolverOrigem(
            fontes({ tokenGlobal: () => undefined }),
            { slug: null, tokenRecebido: TOKEN_GLOBAL },
        );
        expect(r.ok).toBe(false);
        expect((r as { motivo: string }).motivo).toContain("não configurado");
    });

    it("sem conexão herdada, devolve inquilino nulo em vez de inventar um", async () => {
        // Preserva o comportamento antigo durante a migração; inventar dono aqui
        // daria baixa de repasse na conta errada.
        const r = await resolverOrigem(
            fontes({ buscarHerdada: async () => null }),
            { slug: null, tokenRecebido: TOKEN_GLOBAL },
        );
        expect(r).toEqual({ ok: true, corretorId: null, legado: true });
    });

    it("recusa requisição sem token nenhum", async () => {
        const r = await resolverOrigem(fontes(), { slug: null, tokenRecebido: null });
        expect(r.ok).toBe(false);
    });
});

describe("tokensIguais", () => {
    it("compara conteúdo e recusa ausência", async () => {
        expect(await tokensIguais("abc", "abc")).toBe(true);
        expect(await tokensIguais("abc", "abd")).toBe(false);
        expect(await tokensIguais(null, "abc")).toBe(false);
        expect(await tokensIguais("", "abc")).toBe(false);
    });

    it("não vaza o comprimento: tokens de tamanhos diferentes continuam só 'diferentes'", async () => {
        expect(await tokensIguais("a", "aaaaaaaaaaaaaaaaaaaa")).toBe(false);
    });
});
