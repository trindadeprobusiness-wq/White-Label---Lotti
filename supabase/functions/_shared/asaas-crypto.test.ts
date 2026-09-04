import { describe, expect, it } from "vitest";
import {
    cifrar,
    decifrar,
    finalDaChave,
    iguaisEmTempoConstante,
    normalizarChave,
    tokenAleatorio,
} from "./asaas-crypto";

// 32 bytes em hex e o mesmo valor em base64, para provar que os dois formatos
// que um gerador de chave costuma cuspir levam à mesma chave.
const CHAVE_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const CHAVE_B64 = Buffer.from(CHAVE_HEX, "hex").toString("base64");
const OUTRA_CHAVE = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";

describe("normalizarChave", () => {
    it("aceita hex e base64 e chega nos mesmos 32 bytes", () => {
        expect(Array.from(normalizarChave(CHAVE_HEX)))
            .toEqual(Array.from(normalizarChave(CHAVE_B64)));
        expect(normalizarChave(CHAVE_HEX)).toHaveLength(32);
    });

    it("recusa chave ausente, curta ou com tamanho errado", () => {
        expect(() => normalizarChave(undefined)).toThrow("não configurada");
        expect(() => normalizarChave("curta")).toThrow("32 bytes");
        expect(() => normalizarChave("aa".repeat(16))).toThrow("32 bytes");
    });
});

describe("cifrar/decifrar", () => {
    it("devolve o mesmo texto no fim da ida e volta", async () => {
        const chaveApi = "$aact_prod_exemplo_para_teste_000";
        const cifrado = await cifrar(chaveApi, CHAVE_HEX);
        expect(await decifrar(cifrado, CHAVE_HEX)).toBe(chaveApi);
    });

    it("nunca deixa o valor original aparecer no texto cifrado", async () => {
        const cifrado = await cifrar("$aact_segredo_visivel", CHAVE_HEX);
        expect(cifrado).not.toContain("aact");
        expect(cifrado).not.toContain("segredo");
    });

    it("cifra o mesmo valor de forma diferente a cada vez (IV aleatório)", async () => {
        const a = await cifrar("mesmo valor", CHAVE_HEX);
        const b = await cifrar("mesmo valor", CHAVE_HEX);
        expect(a).not.toBe(b);
        expect(await decifrar(a, CHAVE_HEX)).toBe(await decifrar(b, CHAVE_HEX));
    });

    it("marca a versão no texto cifrado, para poder trocar o algoritmo depois", async () => {
        expect(await cifrar("x", CHAVE_HEX)).toMatch(/^v1\./);
    });

    it("não decifra com a chave de outra integração", async () => {
        const cifrado = await cifrar("$aact_prod", CHAVE_HEX);
        await expect(decifrar(cifrado, OUTRA_CHAVE)).rejects.toThrow();
    });

    it("recusa valor ausente ou sem o prefixo de versão", async () => {
        await expect(decifrar(null, CHAVE_HEX)).rejects.toThrow("ausente");
        await expect(decifrar("", CHAVE_HEX)).rejects.toThrow("ausente");
        await expect(decifrar("texto cru", CHAVE_HEX)).rejects.toThrow("não suportado");
    });
});

describe("finalDaChave", () => {
    it("mostra só os últimos dígitos", () => {
        expect(finalDaChave("$aact_prod_abcdef1234")).toBe("1234");
    });

    it("devolve vazio quando a chave é curta demais para esconder algo", () => {
        expect(finalDaChave("123")).toBe("");
        expect(finalDaChave("1234")).toBe("");
        expect(finalDaChave("")).toBe("");
    });
});

describe("tokenAleatorio", () => {
    it("não repete e é seguro para URL", () => {
        const a = tokenAleatorio();
        expect(a).not.toBe(tokenAleatorio());
        expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    });
});

describe("iguaisEmTempoConstante", () => {
    it("compara conteúdo, não identidade", () => {
        expect(iguaisEmTempoConstante("abc", "abc")).toBe(true);
        expect(iguaisEmTempoConstante("abc", "abd")).toBe(false);
        expect(iguaisEmTempoConstante("abc", "abcd")).toBe(false);
    });
});
