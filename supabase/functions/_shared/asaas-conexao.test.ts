import { describe, expect, it } from "vitest";
import {
    EVENTOS_WEBHOOK_ASAAS,
    descricaoErroAsaas,
    extrairDadosConta,
    montarWebhookAsaas,
    normalizarAmbiente,
    normalizarApiKey,
} from "./asaas-conexao";

describe("conexão Asaas self-service", () => {
    it("aceita uma chave plausível sem depender do prefixo atual da Asaas", () => {
        expect(normalizarApiKey("  $aact_prod_12345678901234567890  "))
            .toBe("$aact_prod_12345678901234567890");
        expect(() => normalizarApiKey("curta")).toThrow(/formato válido/);
        expect(() => normalizarApiKey("$aact_prod_1234567890 com espaço"))
            .toThrow(/formato válido/);
    });

    it("produção é o padrão e sandbox precisa ser explícito", () => {
        expect(normalizarAmbiente("producao")).toBe("producao");
        expect(normalizarAmbiente("qualquer-coisa")).toBe("producao");
        expect(normalizarAmbiente("sandbox")).toBe("sandbox");
    });

    it("extrai somente metadados seguros e usa o e-mail da sessão como fallback", () => {
        expect(extrairDadosConta({ companyName: "Imobiliária Horizonte", cpfCnpj: "00000000000100" }, "dono@exemplo.com"))
            .toEqual({ nome: "Imobiliária Horizonte", email: "dono@exemplo.com", cpfCnpj: "00000000000100" });
    });

    it("provisiona o webhook com token próprio e todos os eventos financeiros tratados", () => {
        const payload = montarWebhookAsaas(
            "https://projeto.supabase.co/functions/v1/asaas-webhook?t=slug-opaco",
            "dono@exemplo.com",
            "token-opaco-com-pelo-menos-trinta-e-dois-caracteres",
        );
        expect(payload.authToken).not.toContain("aact");
        expect(payload.events).toEqual(EVENTOS_WEBHOOK_ASAAS);
        expect(payload.events).toContain("PAYMENT_RECEIVED");
        expect(payload.events).toContain("TRANSFER_DONE");
    });

    it("extrai a descrição da resposta Asaas sem depender de uma forma única", () => {
        expect(descricaoErroAsaas({ errors: [{ description: "Chave inválida" }] })).toBe("Chave inválida");
        expect(descricaoErroAsaas({ message: "Sem permissão" })).toBe("Sem permissão");
        expect(descricaoErroAsaas(null)).toBeNull();
    });
});
